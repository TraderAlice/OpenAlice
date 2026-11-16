from __future__ import annotations

import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import jsonschema
import pandas as pd

from autoquant.book_risk_explorer import (
    BOOK_RISK_DIAGNOSTICS_JSON_SCHEMA,
    load_book_risk_diagnostics,
)
from autoquant.project_templates.ohlcv_book_risk_lab.judge import (
    _drawdown_analysis,
)
from autoquant.intake import (
    load_project_intake,
    load_study_dataset_snapshot,
    prepare_project_intake,
)
from autoquant.orientation import (
    AGENT_WORK_BRIEF_JSON_SCHEMA,
    build_agent_work_brief,
)
from autoquant.position_snapshots import (
    POSITION_SNAPSHOT,
    load_position_snapshot,
)
from autoquant.runs import execute_study
from autoquant.run_reports import load_run_report, publish_run_report
from autoquant.sessions import start_session
from autoquant.studies import hash_file, load_study
from autoquant.studio import build_studio_snapshot
from autoquant.templates import BOOK_RISK_STUDY_ID
from autoquant.workspace import (
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
)
from tests.intake_helpers import write_intake_inputs


PROJECT_DIR = Path(__file__).resolve().parents[1]


def _run_cli(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "autoquant", *arguments],
        cwd=PROJECT_DIR,
        capture_output=True,
        check=False,
        text=True,
    )


def _book_request(path: Path) -> None:
    request = json.loads(path.read_text(encoding="utf-8"))
    request["assets"] = [
        {
            "symbol": symbol,
            "assetClass": "equity",
            "venue": "US-COMPOSITE",
            "positionRole": "long-only",
        }
        for symbol in ("AAPL", "MSFT", "NVDA", "QQQ")
    ]
    request["direction"] = "research-only"
    request["positionSnapshot"] = {
        "kind": "reported-weights",
        "asOf": "2024-12-30T21:00:00Z",
        "baseCurrency": "USD",
        "weights": {
            "AAPL": 0.20,
            "MSFT": 0.25,
            "NVDA": 0.30,
            "QQQ": 0.25,
        },
        "cashWeight": 0.0,
    }
    path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _book_scenario_request(path: Path) -> None:
    _book_request(path)
    request = json.loads(path.read_text(encoding="utf-8"))
    request["assets"].append(
        {
            "symbol": "TSLA",
            "assetClass": "equity",
            "venue": "US-COMPOSITE",
            "positionRole": "long-only",
        }
    )
    request["positionScenarios"] = [
        {
            "id": "fund-tsla-from-nvda",
            "name": "Fund TSLA from NVDA",
            "kind": "hypothetical-weights",
            "asOf": "2024-12-30T21:00:00Z",
            "baseCurrency": "USD",
            "weights": {
                "AAPL": 0.20,
                "MSFT": 0.25,
                "NVDA": 0.20,
                "QQQ": 0.25,
                "TSLA": 0.10,
            },
            "cashWeight": 0.0,
        },
        {
            "id": "fund-tsla-from-qqq",
            "name": "Fund TSLA from QQQ",
            "kind": "hypothetical-weights",
            "asOf": "2024-12-30T21:00:00Z",
            "baseCurrency": "USD",
            "weights": {
                "AAPL": 0.20,
                "MSFT": 0.25,
                "NVDA": 0.30,
                "QQQ": 0.15,
                "TSLA": 0.10,
            },
            "cashWeight": 0.0,
        },
    ]
    path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _same_book_scenario_request(path: Path) -> None:
    _book_request(path)
    request = json.loads(path.read_text(encoding="utf-8"))
    request["title"] = "Compare two retained-book reallocations"
    request["question"] = (
        "How do two caller-supplied reallocations change historical book risk?"
    )
    request["positionScenarios"] = [
        {
            "id": "fund-aapl-from-nvda",
            "name": "Fund AAPL from NVDA",
            "kind": "hypothetical-weights",
            "asOf": "2024-12-30T21:00:00Z",
            "baseCurrency": "USD",
            "weights": {
                "AAPL": 0.30,
                "MSFT": 0.25,
                "NVDA": 0.20,
                "QQQ": 0.25,
            },
            "cashWeight": 0.0,
        },
        {
            "id": "fund-msft-from-nvda",
            "name": "Fund MSFT from NVDA",
            "kind": "hypothetical-weights",
            "asOf": "2024-12-30T21:00:00Z",
            "baseCurrency": "USD",
            "weights": {
                "AAPL": 0.20,
                "MSFT": 0.35,
                "NVDA": 0.20,
                "QQQ": 0.25,
            },
            "cashWeight": 0.0,
        },
    ]
    path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _book_sizing_request(
    path: Path,
    *,
    ceiling: float = 0.15,
    lookback: int = 252,
) -> None:
    _book_request(path)
    request = json.loads(path.read_text(encoding="utf-8"))
    request["positionSizing"] = {
        "kind": "one-asset-against-cash-for-volatility-ceiling",
        "asset": "NVDA",
        "direction": "decrease",
        "minimumWeight": 0.0,
        "annualizedVolatilityCeiling": ceiling,
        "lookbackBars": lookback,
    }
    path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _book_entry_sizing_request(
    path: Path,
    *,
    ceiling: float = 0.03,
    maximum_weight: float = 0.5,
) -> None:
    _book_request(path)
    request = json.loads(path.read_text(encoding="utf-8"))
    request["positionSnapshot"]["weights"] = {
        "AAPL": 0.15,
        "MSFT": 0.15,
        "QQQ": 0.20,
    }
    request["positionSnapshot"]["cashWeight"] = 0.50
    request["positionSizing"] = {
        "kind": "one-asset-against-cash-for-volatility-ceiling",
        "asset": "NVDA",
        "direction": "increase",
        "maximumWeight": maximum_weight,
        "annualizedVolatilityCeiling": ceiling,
        "lookbackBars": 252,
    }
    path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _book_report_analysis(run_id: str, title: str) -> dict:
    reference = {
        "kind": "run",
        "id": run_id,
        "artifactPath": "artifacts/book-risk-report.json",
    }
    return {
        "schemaVersion": 1,
        "kind": "autoquant-research-report-analysis",
        "title": title,
        "executiveSummary": (
            "The fixed Book Risk Run provides bounded historical evidence."
        ),
        "findings": [
            {
                "id": "fixed-book-risk-evidence",
                "claim": "The conclusion is anchored to one immutable Run.",
                "confidence": "high",
                "evidenceRefs": [reference],
            }
        ],
        "recommendations": [],
        "limitations": ["This evidence grants no trading authority."],
        "unresolvedQuestions": [],
    }


def _rehash_run(run_root: Path) -> None:
    manifest_path = run_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"] = {
        path.relative_to(run_root).as_posix(): hash_file(path)
        for path in sorted(run_root.rglob("*"))
        if path.is_file() and path != manifest_path
    }
    manifest["resultHash"] = manifest["files"]["result.json"]
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


class BookRiskLabTests(unittest.TestCase):
    def test_static_weight_drawdown_conventions_are_deterministic(self) -> None:
        weights = pd.Series({"AAPL": 1.0})
        initial = pd.Timestamp("2024-01-01")
        no_loss = _drawdown_analysis(
            pd.DataFrame(
                {"AAPL": [0.10, 0.05]},
                index=pd.to_datetime(["2024-01-02", "2024-01-03"]),
            ),
            weights,
            initial,
        )
        self.assertEqual(no_loss["summary"]["maximumDrawdown"], 0.0)
        self.assertEqual(
            no_loss["summary"]["peakTimestamp"],
            "2024-01-01",
        )
        self.assertEqual(
            no_loss["summary"]["troughTimestamp"],
            "2024-01-01",
        )
        self.assertEqual(
            no_loss["summary"]["recoveryTimestamp"],
            "2024-01-01",
        )
        self.assertEqual(
            [round(row["nav"], 6) for row in no_loss["rows"]],
            [1.0, 1.1, 1.155],
        )

        unrecovered = _drawdown_analysis(
            pd.DataFrame(
                {"AAPL": [0.10, -0.20, 0.05]},
                index=pd.to_datetime(
                    ["2024-01-02", "2024-01-03", "2024-01-04"]
                ),
            ),
            weights,
            initial,
        )
        self.assertAlmostEqual(
            unrecovered["summary"]["maximumDrawdown"],
            -0.20,
        )
        self.assertEqual(
            unrecovered["summary"]["peakTimestamp"],
            "2024-01-02",
        )
        self.assertEqual(
            unrecovered["summary"]["troughTimestamp"],
            "2024-01-03",
        )
        self.assertIsNone(unrecovered["summary"]["recoveryTimestamp"])
        self.assertFalse(unrecovered["summary"]["recovered"])
        self.assertEqual(
            [round(row["cumulativeReturn"], 6) for row in unrecovered["rows"]],
            [0.0, 0.1, -0.12, -0.076],
        )

        recovered = _drawdown_analysis(
            pd.DataFrame(
                {"AAPL": [0.10, -0.20, 0.30]},
                index=pd.to_datetime(
                    ["2024-01-02", "2024-01-03", "2024-01-04"]
                ),
            ),
            weights,
            initial,
        )
        self.assertEqual(
            recovered["summary"]["recoveryTimestamp"],
            "2024-01-04",
        )
        self.assertTrue(recovered["summary"]["recovered"])

    def _real_project(self, root: Path):
        request_path, package_path = write_intake_inputs(
            root,
            observations=260,
            request_assets=("AAPL", "MSFT", "NVDA", "QQQ"),
            asset_position_roles={
                "AAPL": "long-only",
                "MSFT": "long-only",
                "NVDA": "long-only",
                "QQQ": "long-only",
            },
        )
        _book_request(request_path)
        prepared = prepare_project_intake(
            request_path,
            package_path,
            "ohlcv-book-risk-lab",
        )
        workspace = initialize_workspace(root / "workspace")
        return create_project(
            workspace.root_dir,
            "reported-book",
            template=prepared.template,
            template_intake=prepared,
        )

    def _scenario_project(self, root: Path):
        request_path, package_path = write_intake_inputs(
            root,
            observations=260,
            assets=("AAPL", "MSFT", "NVDA", "QQQ", "TSLA"),
            request_assets=("AAPL", "MSFT", "NVDA", "QQQ", "TSLA"),
            asset_position_roles={
                "AAPL": "long-only",
                "MSFT": "long-only",
                "NVDA": "long-only",
                "QQQ": "long-only",
                "TSLA": "long-only",
            },
        )
        _book_scenario_request(request_path)
        prepared = prepare_project_intake(
            request_path,
            package_path,
            "ohlcv-book-risk-lab",
        )
        workspace = initialize_workspace(root / "workspace")
        return create_project(
            workspace.root_dir,
            "reported-book-scenarios",
            template=prepared.template,
            template_intake=prepared,
        )

    def _sizing_project(
        self,
        root: Path,
        *,
        ceiling: float = 0.15,
        lookback: int = 252,
    ):
        request_path, package_path = write_intake_inputs(
            root,
            observations=260,
            request_assets=("AAPL", "MSFT", "NVDA", "QQQ"),
            asset_position_roles={
                "AAPL": "long-only",
                "MSFT": "long-only",
                "NVDA": "long-only",
                "QQQ": "long-only",
            },
        )
        _book_sizing_request(
            request_path,
            ceiling=ceiling,
            lookback=lookback,
        )
        prepared = prepare_project_intake(
            request_path,
            package_path,
            "ohlcv-book-risk-lab",
        )
        workspace = initialize_workspace(root / "workspace")
        return create_project(
            workspace.root_dir,
            "reported-book-sizing",
            template=prepared.template,
            template_intake=prepared,
        )

    def _entry_sizing_project(
        self,
        root: Path,
        *,
        ceiling: float = 0.03,
        maximum_weight: float = 0.5,
    ):
        request_path, package_path = write_intake_inputs(
            root,
            observations=260,
            request_assets=("AAPL", "MSFT", "NVDA", "QQQ"),
            asset_position_roles={
                "AAPL": "long-only",
                "MSFT": "long-only",
                "NVDA": "long-only",
                "QQQ": "long-only",
            },
        )
        _book_entry_sizing_request(
            request_path,
            ceiling=ceiling,
            maximum_weight=maximum_weight,
        )
        prepared = prepare_project_intake(
            request_path,
            package_path,
            "ohlcv-book-risk-lab",
        )
        workspace = initialize_workspace(root / "workspace")
        return create_project(
            workspace.root_dir,
            "reported-book-entry-sizing",
            template=prepared.template,
            template_intake=prepared,
        )

    def _single_holding_entry_project(self, root: Path):
        request_path, package_path = write_intake_inputs(
            root,
            observations=260,
            request_assets=("QQQ", "NVDA"),
            asset_position_roles={
                "QQQ": "long-only",
                "NVDA": "long-only",
            },
        )
        _book_entry_sizing_request(
            request_path,
            ceiling=0.50,
            maximum_weight=0.20,
        )
        request = json.loads(request_path.read_text(encoding="utf-8"))
        request["assets"] = [
            asset
            for asset in request["assets"]
            if asset["symbol"] in {"QQQ", "NVDA"}
        ]
        request["positionSnapshot"]["weights"] = {"QQQ": 0.70}
        request["positionSnapshot"]["cashWeight"] = 0.30
        request_path.write_text(
            json.dumps(request, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        prepared = prepare_project_intake(
            request_path,
            package_path,
            "ohlcv-book-risk-lab",
        )
        workspace = initialize_workspace(root / "workspace")
        project = create_project(
            workspace.root_dir,
            "single-holding-entry-sizing",
            template=prepared.template,
            template_intake=prepared,
        )
        scenarios_path = (
            project.root_dir / "strategies" / "book-risk-scenarios.json"
        )
        scenarios = json.loads(scenarios_path.read_text(encoding="utf-8"))
        scenarios["minimumObservations"] = 126
        scenarios_path.write_text(
            json.dumps(scenarios, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return project

    def test_position_sizing_freezes_one_bounded_caller_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._sizing_project(Path(directory))
            snapshot = load_position_snapshot(
                project.root_dir / POSITION_SNAPSHOT
            )
            self.assertEqual(snapshot["scenarios"], [])
            self.assertEqual(
                snapshot["sizingPolicy"],
                {
                    "kind": (
                        "one-asset-against-cash-for-volatility-ceiling"
                    ),
                    "asset": "NVDA",
                    "direction": "decrease",
                    "minimumWeight": 0.0,
                    "annualizedVolatilityCeiling": 0.15,
                    "lookbackBars": 252,
                    "authority": {
                        "decisionPath": (
                            "caller-bounded-historical-sizing"
                        ),
                        "tradingAuthority": "none",
                    },
                },
            )

    def test_cash_entry_sizing_freezes_absent_asset_and_exact_direction(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._entry_sizing_project(Path(directory))
            snapshot = load_position_snapshot(
                project.root_dir / POSITION_SNAPSHOT
            )
            self.assertNotIn("NVDA", snapshot["weights"])
            self.assertEqual(snapshot["cashWeight"], 0.5)
            self.assertEqual(
                snapshot["sizingPolicy"],
                {
                    "kind": (
                        "one-asset-against-cash-for-volatility-ceiling"
                    ),
                    "asset": "NVDA",
                    "direction": "increase",
                    "maximumWeight": 0.5,
                    "annualizedVolatilityCeiling": 0.03,
                    "lookbackBars": 252,
                    "authority": {
                        "decisionPath": (
                            "caller-bounded-historical-sizing"
                        ),
                        "tradingAuthority": "none",
                    },
                },
            )

    def test_position_sizing_rejects_ambiguous_or_unauthorized_paths(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                observations=260,
                request_assets=("AAPL", "MSFT", "NVDA", "QQQ"),
                asset_position_roles={
                    "AAPL": "long-only",
                    "MSFT": "long-only",
                    "NVDA": "long-only",
                    "QQQ": "long-only",
                },
            )
            _book_sizing_request(request_path)
            request = json.loads(
                request_path.read_text(encoding="utf-8")
            )
            request["positionSizing"]["asset"] = "UNREQUESTED"
            request["positionSizing"]["direction"] = "sideways"
            request["positionSizing"]["lookbackBars"] = 100
            request["positionSizing"][
                "annualizedVolatilityCeiling"
            ] = 0
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            codes = {issue.code for issue in captured.exception.issues}
            self.assertIn("request.position-sizing-direction", codes)
            self.assertIn("request.position-sizing-lookback", codes)
            self.assertIn("request.position-sizing-ceiling", codes)

            _book_sizing_request(request_path)
            request = json.loads(
                request_path.read_text(encoding="utf-8")
            )
            request["positionSizing"]["asset"] = "UNREQUESTED"
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            self.assertIn(
                "request.position-sizing-held-long",
                {issue.code for issue in captured.exception.issues},
            )

            _book_scenario_request(request_path)
            request = json.loads(
                request_path.read_text(encoding="utf-8")
            )
            request["positionSizing"] = {
                "kind": (
                    "one-asset-against-cash-for-volatility-ceiling"
                ),
                "asset": "NVDA",
                "direction": "decrease",
                "minimumWeight": 0.0,
                "annualizedVolatilityCeiling": 0.15,
                "lookbackBars": 252,
            }
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            self.assertIn(
                "request.position-sizing-scenarios",
                {issue.code for issue in captured.exception.issues},
            )

            _book_entry_sizing_request(request_path)
            request = json.loads(
                request_path.read_text(encoding="utf-8")
            )
            request["positionSnapshot"]["cashWeight"] = 0.0
            request["positionSnapshot"]["weights"]["AAPL"] = 0.65
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            self.assertIn(
                "request.position-sizing-positive-cash",
                {issue.code for issue in captured.exception.issues},
            )

            _book_entry_sizing_request(request_path)
            request = json.loads(
                request_path.read_text(encoding="utf-8")
            )
            del request["positionSizing"]["maximumWeight"]
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            self.assertIn(
                "schema.missing",
                {issue.code for issue in captured.exception.issues},
            )

            _book_entry_sizing_request(request_path)
            request = json.loads(
                request_path.read_text(encoding="utf-8")
            )
            request["positionSizing"]["maximumWeight"] = 0.0
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            self.assertIn(
                "request.position-sizing-directional-bound",
                {issue.code for issue in captured.exception.issues},
            )

    def test_cash_entry_sizing_solves_largest_compliant_weight(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._entry_sizing_project(Path(directory))
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            diagnostics = load_book_risk_diagnostics(
                project,
                run.result["id"],
            )
            sizing = diagnostics["positionSizing"]
            self.assertEqual(sizing["status"], "sized")
            self.assertEqual(
                sizing["bindingConstraint"],
                "volatility-ceiling",
            )
            self.assertEqual(sizing["result"]["startingWeight"], 0.0)
            self.assertGreater(sizing["result"]["weightChange"], 0.0)
            self.assertAlmostEqual(
                sizing["result"]["resultingWeight"],
                sizing["result"]["weightChange"],
            )
            self.assertAlmostEqual(
                sizing["result"]["cashWeightChange"],
                -sizing["result"]["weightChange"],
            )
            self.assertAlmostEqual(
                sizing["result"]["annualizedVolatility"],
                0.03,
                places=10,
            )
            self.assertEqual(
                set(sizing["result"]["weights"]),
                {"AAPL", "MSFT", "NVDA", "QQQ"},
            )
            self.assertTrue(sizing["result"]["ceilingSatisfied"])

        with tempfile.TemporaryDirectory() as directory:
            project = self._entry_sizing_project(
                Path(directory),
                ceiling=0.50,
            )
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            sizing = load_book_risk_diagnostics(
                project,
                run.result["id"],
            )["positionSizing"]
            self.assertEqual(sizing["status"], "fully-funded-compliant")
            self.assertEqual(
                sizing["bindingConstraint"],
                "available-cash",
            )
            self.assertAlmostEqual(
                sizing["result"]["resultingWeight"],
                0.5,
            )
            self.assertAlmostEqual(
                sizing["result"]["resultingCashWeight"],
                0.0,
            )

    def test_absent_candidate_and_caller_maximum_are_fixed_authority(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._single_holding_entry_project(Path(directory))
            snapshot = load_position_snapshot(
                project.root_dir / POSITION_SNAPSHOT
            )
            self.assertEqual(snapshot["weights"], {"QQQ": 0.70})
            self.assertNotIn("NVDA", snapshot["weights"])
            self.assertEqual(
                snapshot["sizingPolicy"]["maximumWeight"],
                0.20,
            )

            run = execute_study(project, BOOK_RISK_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            self.assertEqual(run.result["metrics"]["held_assets"], 1)
            diagnostics = load_book_risk_diagnostics(
                project,
                run.result["id"],
            )
            jsonschema.validate(
                diagnostics,
                BOOK_RISK_DIAGNOSTICS_JSON_SCHEMA,
            )
            sizing = diagnostics["positionSizing"]
            self.assertEqual(sizing["status"], "maximum-weight-compliant")
            self.assertEqual(
                sizing["resultMeaning"],
                "caller-maximum-weight-compliant",
            )
            self.assertEqual(
                sizing["bindingConstraint"],
                "caller-weight-bound",
            )
            self.assertAlmostEqual(
                sizing["result"]["startingWeight"],
                0.0,
            )
            self.assertAlmostEqual(
                sizing["result"]["resultingWeight"],
                0.20,
            )
            self.assertAlmostEqual(
                sizing["result"]["resultingCashWeight"],
                0.10,
            )
            self.assertEqual(
                sizing["result"]["weights"],
                {"QQQ": 0.70, "NVDA": 0.20},
            )
            self.assertEqual(
                [
                    (
                        row["leftAsset"],
                        row["rightAsset"],
                    )
                    for row in sizing["pairwiseCorrelations"]
                ],
                [("QQQ", "NVDA")],
            )
            self.assertLessEqual(
                abs(sizing["pairwiseCorrelations"][0]["correlation"]),
                1.0,
            )
            self.assertLessEqual(
                sizing["drawdown"]["maximumDrawdown"],
                0.0,
            )
            human = _run_cli(
                "run",
                "book-risk",
                str(project.root_dir),
                "--run",
                run.result["id"],
            )
            self.assertEqual(human.returncode, 0, human.stderr)
            self.assertIn(
                "Strongest pair: unavailable for a one-asset reported baseline",
                human.stdout,
            )
            machine = _run_cli(
                "run",
                "book-risk",
                str(project.root_dir),
                "--run",
                run.result["id"],
                "--json",
            )
            self.assertEqual(machine.returncode, 0, machine.stderr)
            studio = build_studio_snapshot(project.root_dir)
            observed = studio["projects"][0]["bookRiskExplorer"]
            self.assertEqual(
                observed["positionSizing"]["bindingConstraint"],
                "caller-weight-bound",
            )

    def test_position_sizing_solves_exact_boundary_and_infeasible_path(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._sizing_project(
                Path(directory),
                ceiling=0.027,
            )
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            diagnostics = load_book_risk_diagnostics(
                project,
                run.result["id"],
            )
            sizing = diagnostics["positionSizing"]
            self.assertEqual(sizing["status"], "sized")
            self.assertLess(sizing["result"]["weightChange"], 0)
            self.assertLess(
                sizing["result"]["resultingWeight"],
                sizing["result"]["startingWeight"],
            )
            self.assertAlmostEqual(
                sizing["result"]["annualizedVolatility"],
                0.027,
                places=10,
            )
            self.assertTrue(sizing["result"]["ceilingSatisfied"])
            human = _run_cli(
                "run",
                "book-risk",
                str(project.root_dir),
                "--run",
                run.result["id"],
            )
            self.assertEqual(human.returncode, 0, human.stderr)
            self.assertIn(
                "Caller-bounded position sizing: sized",
                human.stdout,
            )
            self.assertIn(
                "not a future-volatility guarantee",
                human.stdout,
            )
            brief = build_agent_work_brief(project)
            self.assertIn(
                "target-position sizing evidence",
                brief["supportingActions"][0]["description"],
            )
            studio = build_studio_snapshot(project.root_dir)
            observed = studio["projects"][0]["bookRiskExplorer"]
            self.assertEqual(
                observed["positionSizing"]["status"],
                "sized",
            )

        with tempfile.TemporaryDirectory() as directory:
            project = self._sizing_project(
                Path(directory),
                ceiling=0.02,
            )
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            diagnostics = load_book_risk_diagnostics(
                project,
                run.result["id"],
            )
            sizing = diagnostics["positionSizing"]
            self.assertEqual(sizing["status"], "infeasible")
            self.assertFalse(sizing["result"]["ceilingSatisfied"])
            self.assertEqual(
                sizing["resultMeaning"],
                "constrained-minimum-evidence-not-recommendation",
            )

        with tempfile.TemporaryDirectory() as directory:
            project = self._sizing_project(
                Path(directory),
                ceiling=0.50,
            )
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            sizing = load_book_risk_diagnostics(
                project,
                run.result["id"],
            )["positionSizing"]
            self.assertEqual(sizing["status"], "unchanged-compliant")
            self.assertEqual(
                sizing["resultMeaning"],
                "unchanged-compliant-book",
            )
            self.assertAlmostEqual(
                sizing["result"]["weightChange"],
                0.0,
            )

    def test_sizing_lookback_is_the_primary_book_risk_window(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._sizing_project(
                Path(directory),
                ceiling=0.027,
                lookback=126,
            )
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            diagnostics = load_book_risk_diagnostics(
                project,
                run.result["id"],
            )
            report_path = (
                run.root_dir / "artifacts" / "book-risk-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            governing = next(
                row
                for row in diagnostics["lookbacks"]
                if row["lookbackBars"] == 126
            )

            self.assertEqual(report["method"]["primaryLookbackBars"], 126)
            self.assertEqual(diagnostics["current"]["lookbackBars"], 126)
            self.assertEqual(
                run.result["metrics"]["primary_lookback_bars"],
                126,
            )
            self.assertEqual(diagnostics["equityPath"]["totalRows"], 127)
            self.assertAlmostEqual(
                diagnostics["current"]["annualizedVolatility"],
                governing["annualizedVolatility"],
            )
            self.assertEqual(
                diagnostics["reductionPriority"],
                governing["reductionRanking"],
            )
            human = _run_cli(
                "run",
                "book-risk",
                str(project.root_dir),
                "--run",
                run.result["id"],
            )
            self.assertEqual(human.returncode, 0, human.stderr)
            self.assertIn(
                "Annualized volatility (126-bar primary):",
                human.stdout,
            )

            report["method"]["primaryLookbackBars"] = 252
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_risk_diagnostics(project, run.result["id"])
            self.assertIn(
                "book-risk.position-sizing-primary-lookback",
                {issue.code for issue in captured.exception.issues},
            )

    def test_position_sizing_explorer_rejects_rehashed_solution_tamper(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._sizing_project(
                Path(directory),
                ceiling=0.027,
            )
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            report_path = (
                run.root_dir / "artifacts" / "book-risk-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["positionSizing"]["quadratic"][
                "coefficientB"
            ] += 0.001
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_risk_diagnostics(project, run.result["id"])
            self.assertIn(
                "book-risk.reconcile",
                {issue.code for issue in captured.exception.issues},
            )

        for field, value, expected_code in (
            (
                "pairwiseCorrelations",
                [
                    {
                        "leftAsset": "AAPL",
                        "rightAsset": "MSFT",
                        "correlation": 2.0,
                    }
                ],
                "book-risk.position-sizing-correlations",
            ),
            (
                "drawdown",
                {
                    "method": "daily-constant-weight-close-to-close",
                    "returnConvention": (
                        "Supplied asset weights are applied to each "
                        "same-clock close-to-close simple-return row; cash "
                        "return is zero."
                    ),
                    "initialNav": 1.0,
                    "maximumDrawdown": 0.1,
                    "peakTimestamp": "2024-01-01",
                    "troughTimestamp": "2024-01-02",
                    "recoveryTimestamp": None,
                    "recovered": False,
                },
                "book-risk.position-sizing-drawdown",
            ),
        ):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                project = self._entry_sizing_project(Path(directory))
                run = execute_study(project, BOOK_RISK_STUDY_ID)
                report_path = (
                    run.root_dir / "artifacts" / "book-risk-report.json"
                )
                report = json.loads(
                    report_path.read_text(encoding="utf-8")
                )
                report["positionSizing"][field] = value
                report_path.write_text(
                    json.dumps(report, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                _rehash_run(run.root_dir)
                with self.assertRaises(AutoQuantValidationError) as captured:
                    load_book_risk_diagnostics(project, run.result["id"])
                self.assertIn(
                    expected_code,
                    {issue.code for issue in captured.exception.issues},
                )

    def test_request_bound_snapshot_runs_and_projects_strict_evidence(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._real_project(Path(directory))
            intake = load_project_intake(project)
            assert intake is not None
            self.assertTrue(intake["study"]["current"])
            self.assertEqual(intake["manifest"]["status"], "ready-for-run")
            snapshot = load_position_snapshot(
                project.root_dir / POSITION_SNAPSHOT
            )
            self.assertEqual(snapshot["weights"]["NVDA"], 0.30)
            self.assertEqual(
                snapshot["authority"]["tradingAuthority"],
                "none",
            )

            run = execute_study(project, BOOK_RISK_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            diagnostics = load_book_risk_diagnostics(
                project,
                run.result["id"],
                point_limit=20,
            )
            jsonschema.validate(
                diagnostics,
                BOOK_RISK_DIAGNOSTICS_JSON_SCHEMA,
            )
            self.assertEqual(
                {row["asset"] for row in diagnostics["riskContributions"]},
                {"AAPL", "MSFT", "NVDA", "QQQ"},
            )
            self.assertEqual(
                [row["rank"] for row in diagnostics["reductionPriority"]],
                [1, 2, 3, 4],
            )
            self.assertEqual(len(diagnostics["lookbacks"]), 3)
            self.assertTrue(
                all(
                    row["firstReductionAsset"]
                    in {"AAPL", "MSFT", "NVDA", "QQQ"}
                    for row in diagnostics["lookbacks"]
                )
            )
            self.assertTrue(
                all(
                    [item["rank"] for item in row["reductionRanking"]]
                    == [1, 2, 3, 4]
                    for row in diagnostics["lookbacks"]
                )
            )
            self.assertTrue(
                all(
                    row["reductionRanking"][0]["asset"]
                    == row["firstReductionAsset"]
                    for row in diagnostics["lookbacks"]
                )
            )
            primary_lookback = next(
                row
                for row in diagnostics["lookbacks"]
                if row["lookbackBars"]
                == diagnostics["current"]["lookbackBars"]
            )
            self.assertEqual(
                primary_lookback["reductionRanking"],
                diagnostics["reductionPriority"],
            )
            self.assertEqual(
                diagnostics["authority"]["tradingAuthority"],
                "none",
            )
            self.assertLessEqual(
                diagnostics["drawdown"]["maximumDrawdown"],
                0.0,
            )
            self.assertEqual(
                diagnostics["equityPath"]["totalRows"],
                253,
            )
            self.assertEqual(
                diagnostics["current"]["maximumDrawdown"],
                diagnostics["drawdown"]["maximumDrawdown"],
            )
            self.assertEqual(
                run.result["metrics"]["current_maximum_drawdown"],
                diagnostics["drawdown"]["maximumDrawdown"],
            )
            human = _run_cli(
                "run",
                "book-risk",
                str(project.root_dir),
                "--run",
                run.result["id"],
            )
            self.assertEqual(human.returncode, 0, human.stderr)
            self.assertIn("Historical maximum drawdown:", human.stdout)
            self.assertIn(
                "daily constant-weight close-to-close research path",
                human.stdout,
            )

            brief = build_agent_work_brief(project)
            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertIsNone(brief["primaryAction"])
            self.assertEqual(
                [item["id"] for item in brief["supportingActions"]],
                ["run.book-risk"],
            )
            self.assertEqual(
                brief["supportingActions"][0]["expectedEvidenceKind"],
                "book-risk-diagnostics",
            )
            self.assertEqual(brief["review"]["status"], "complete")
            self.assertIn(
                "Write and return the decision-support answer",
                brief["review"]["next"],
            )
            self.assertEqual(
                brief["researchAgenda"]["status"],
                "descriptive-audit-complete",
            )
            self.assertEqual(brief["researchAgenda"]["moves"], [])
            self.assertEqual(
                brief["researchAgenda"]["run"]["inputHash"],
                run.result["inputHash"],
            )
            self.assertEqual(
                brief["authority"]["researchAuthority"],
                "fixed-descriptive-audit",
            )

            studio = build_studio_snapshot(project.root_dir)
            observed = studio["projects"][0]
            self.assertEqual(
                observed["bookRiskExplorer"]["run"]["id"],
                run.result["id"],
            )
            self.assertEqual(
                observed["bookRiskExplorer"]["drawdown"],
                diagnostics["drawdown"],
            )
            self.assertIn(
                "run.book-risk",
                {command["id"] for command in observed["commands"]},
            )
            self.assertEqual(
                [command["id"] for command in observed["intake"]["commands"]],
                ["run.execute"],
            )
            self.assertIsNone(observed["factorExplorer"])
            self.assertIsNone(observed["portfolioExplorer"])

            with self.assertRaises(AutoQuantValidationError) as captured:
                start_session(project, BOOK_RISK_STUDY_ID)
            self.assertIn(
                "session.descriptive-study",
                {issue.code for issue in captured.exception.issues},
            )

    def test_pre_0819_book_risk_run_remains_readable_without_drawdown(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._real_project(Path(directory))
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            report_path = (
                run.root_dir / "artifacts" / "book-risk-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report.pop("drawdown")
            report["authority"].pop("drawdownMeaning")
            report["current"].pop("maximumDrawdown")
            for row in report["lookbacks"]:
                row.pop("maximumDrawdown")
                row.pop("reductionRanking")
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            equity_path = (
                run.root_dir / "artifacts" / "book-risk-equity-path.csv"
            )
            equity_path.unlink()
            result_path = run.root_dir / "result.json"
            result = json.loads(result_path.read_text(encoding="utf-8"))
            result["harness"]["version"] = "0.8.18"
            result["metrics"].pop("current_maximum_drawdown")
            result["artifacts"] = [
                item
                for item in result["artifacts"]
                if item["kind"] != "book-risk-equity-path"
            ]
            result_path.write_text(
                json.dumps(result, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            _rehash_run(run.root_dir)

            diagnostics = load_book_risk_diagnostics(
                project,
                run.result["id"],
            )
            jsonschema.validate(
                diagnostics,
                BOOK_RISK_DIAGNOSTICS_JSON_SCHEMA,
            )
            self.assertFalse(diagnostics["drawdown"]["available"])
            self.assertFalse(diagnostics["equityPath"]["available"])
            self.assertTrue(
                all(
                    "reductionRanking" not in row
                    for row in diagnostics["lookbacks"]
                )
            )
            self.assertNotIn(
                "book-risk-equity-path",
                diagnostics["artifacts"],
            )
            human = _run_cli(
                "run",
                "book-risk",
                str(project.root_dir),
                "--run",
                run.result["id"],
            )
            self.assertEqual(human.returncode, 0, human.stderr)
            self.assertIn(
                "Historical maximum drawdown: unavailable for this legacy Run",
                human.stdout,
            )
            studio = build_studio_snapshot(project.root_dir)
            observed = studio["projects"][0]["bookRiskExplorer"]
            self.assertFalse(observed["drawdown"]["available"])

    def test_cli_intake_routes_book_risk_to_fixed_run_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                observations=260,
                request_assets=("AAPL", "MSFT", "NVDA", "QQQ"),
                asset_position_roles={
                    "AAPL": "long-only",
                    "MSFT": "long-only",
                    "NVDA": "long-only",
                    "QQQ": "long-only",
                },
            )
            _book_request(request_path)
            workspace = root / "workspace"
            initialized = _run_cli(
                "workspace",
                "init",
                str(workspace),
                "--json",
            )
            self.assertEqual(initialized.returncode, 0, initialized.stderr)
            created = _run_cli(
                "project",
                "intake",
                str(workspace),
                "reported-book",
                "--request",
                str(request_path),
                "--dataset",
                str(package_path),
                "--template",
                "ohlcv-book-risk-lab",
                "--json",
            )
            self.assertEqual(created.returncode, 0, created.stderr or created.stdout)
            envelope = json.loads(created.stdout)
            self.assertEqual(
                envelope["data"]["intake"]["manifest"]["status"],
                "ready-for-run",
            )
            self.assertEqual(
                [action["id"] for action in envelope["nextActions"]],
                ["study.inspect", "run.execute"],
            )

    def test_cli_appends_independent_book_risk_study_over_retained_dataset(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = self._real_project(root)
            original_run = execute_study(project, BOOK_RISK_STUDY_ID)
            original_report = publish_run_report(
                project,
                BOOK_RISK_STUDY_ID,
                original_run.result["id"],
                _book_report_analysis(
                    original_run.result["id"],
                    "Original Book Risk conclusion",
                ),
            )
            original_diagnostics = load_book_risk_diagnostics(
                project,
                original_run.result["id"],
                point_limit=20,
            )
            fixed_roots = [
                project.root_dir / "request.json",
                project.root_dir / "intake.json",
                project.root_dir / "strategies" / "position-snapshot.json",
                project.root_dir / "studies" / BOOK_RISK_STUDY_ID,
                original_run.root_dir,
                original_report.root_dir,
            ]
            original_hashes = {
                path.relative_to(project.root_dir).as_posix(): hash_file(path)
                for root_path in fixed_roots
                for path in (
                    sorted(root_path.rglob("*"))
                    if root_path.is_dir()
                    else [root_path]
                )
                if path.is_file()
            }

            follow_up = root / "follow-up-request.json"
            follow_up.write_bytes((project.root_dir / "request.json").read_bytes())
            _same_book_scenario_request(follow_up)
            created = _run_cli(
                "study",
                "intake",
                str(project.root_dir),
                "scenario-follow-up",
                "--request",
                str(follow_up),
                "--json",
            )
            self.assertEqual(created.returncode, 0, created.stderr or created.stdout)
            envelope = json.loads(created.stdout)
            self.assertEqual(envelope["command"], "study.intake")
            self.assertEqual(
                envelope["data"]["intake"]["sourceProjectStudyId"],
                BOOK_RISK_STUDY_ID,
            )
            study = load_study(project, "scenario-follow-up")
            self.assertEqual(study.editable_hashes, {})
            self.assertEqual(
                study.definition.judge.arguments,
                [
                    "--position-snapshot",
                    "strategies/book-risk-studies/scenario-follow-up/position-snapshot.json",
                    "--scenarios",
                    "strategies/book-risk-studies/scenario-follow-up/book-risk-scenarios.json",
                ],
            )
            self.assertEqual(
                study.dataset_hash,
                load_study(project, BOOK_RISK_STUDY_ID).dataset_hash,
            )

            follow_up_run = execute_study(project, "scenario-follow-up")
            self.assertEqual(follow_up_run.result["status"], "succeeded")
            follow_up_diagnostics = load_book_risk_diagnostics(
                project,
                follow_up_run.result["id"],
                point_limit=20,
            )
            self.assertEqual(
                [
                    row["id"]
                    for row in follow_up_diagnostics["scenarioComparison"]["scenarios"]
                ],
                ["fund-aapl-from-nvda", "fund-msft-from-nvda"],
            )
            follow_up_report = publish_run_report(
                project,
                "scenario-follow-up",
                follow_up_run.result["id"],
                _book_report_analysis(
                    follow_up_run.result["id"],
                    "Scenario follow-up conclusion",
                ),
            )
            self.assertEqual(
                follow_up_report.report["request"]["title"],
                "Compare two retained-book reallocations",
            )
            self.assertEqual(
                [
                    item["id"]
                    for item in follow_up_report.report["request"][
                        "positionScenarios"
                    ]
                ],
                ["fund-aapl-from-nvda", "fund-msft-from-nvda"],
            )
            self.assertEqual(
                load_run_report(
                    project,
                    original_report.report["id"],
                ).report["request"]["title"],
                "US leadership durability",
            )
            self.assertEqual(
                load_book_risk_diagnostics(
                    project,
                    original_run.result["id"],
                    point_limit=20,
                )["positionSnapshot"],
                original_diagnostics["positionSnapshot"],
            )
            for relative, expected in original_hashes.items():
                self.assertEqual(
                    hash_file(project.root_dir / relative),
                    expected,
                    relative,
                )
            studio = build_studio_snapshot(project.root_dir)["projects"][0]
            self.assertEqual(studio["counts"]["reports"], 2)
            self.assertEqual(
                studio["bookRiskExplorer"]["run"]["id"],
                follow_up_run.result["id"],
            )

    def test_book_risk_study_intake_rejects_dataset_drift_without_artifacts(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = self._real_project(root)
            follow_up = root / "follow-up-request.json"
            follow_up.write_bytes((project.root_dir / "request.json").read_bytes())
            _same_book_scenario_request(follow_up)
            request = json.loads(follow_up.read_text(encoding="utf-8"))
            request["assets"][0]["venue"] = "XNYS"
            follow_up.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            rejected = _run_cli(
                "study",
                "intake",
                str(project.root_dir),
                "dataset-drift",
                "--request",
                str(follow_up),
                "--json",
            )
            self.assertEqual(rejected.returncode, 1)
            envelope = json.loads(rejected.stdout)
            self.assertEqual(
                envelope["error"]["issues"][0]["code"],
                "study-intake.dataset-assets",
            )
            self.assertFalse(
                (project.root_dir / "studies" / "dataset-drift").exists()
            )
            self.assertFalse(
                (project.root_dir / "strategies" / "book-risk-studies").exists()
            )
            self.assertFalse(
                (project.root_dir / "judges" / "book-risk-studies").exists()
            )

    def test_cli_appends_newer_study_owned_book_risk_dataset_vintage(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = self._real_project(root)
            original_study = load_study(project, BOOK_RISK_STUDY_ID)
            original_run = execute_study(project, BOOK_RISK_STUDY_ID)
            original_report = publish_run_report(
                project,
                BOOK_RISK_STUDY_ID,
                original_run.result["id"],
                _book_report_analysis(
                    original_run.result["id"],
                    "Original data-vintage conclusion",
                ),
            )
            original_hashes = {
                path.relative_to(project.root_dir).as_posix(): hash_file(path)
                for path in sorted(project.root_dir.rglob("*"))
                if path.is_file()
            }

            refresh_root = root / "refresh"
            refresh_root.mkdir()
            request_path, package_path = write_intake_inputs(
                refresh_root,
                observations=261,
                dataset_version="2024-v2",
                request_assets=("AAPL", "MSFT", "NVDA", "QQQ"),
                asset_position_roles={
                    "AAPL": "long-only",
                    "MSFT": "long-only",
                    "NVDA": "long-only",
                    "QQQ": "long-only",
                },
            )
            _book_request(request_path)
            refreshed_request = json.loads(
                request_path.read_text(encoding="utf-8")
            )
            refreshed_request["positionSnapshot"]["asOf"] = (
                "2024-12-31T21:00:00Z"
            )
            request_path.write_text(
                json.dumps(refreshed_request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            created = _run_cli(
                "study",
                "intake",
                str(project.root_dir),
                "year-end-refresh",
                "--request",
                str(request_path),
                "--dataset",
                str(package_path),
                "--json",
            )
            self.assertEqual(created.returncode, 0, created.stderr or created.stdout)
            envelope = json.loads(created.stdout)
            intake = envelope["data"]["intake"]
            self.assertEqual(intake["datasetMode"], "study-owned-refresh")
            self.assertEqual(
                intake["datasetSnapshotPath"],
                "data/studies/year-end-refresh/ohlcv/snapshot.json",
            )
            self.assertEqual(
                intake["datasetTimeRange"],
                {"start": "2024-01-02", "end": "2024-12-31"},
            )

            refreshed_study = load_study(project, "year-end-refresh")
            self.assertNotEqual(
                refreshed_study.dataset_hash,
                original_study.dataset_hash,
            )
            self.assertEqual(
                refreshed_study.definition.dataset.paths,
                ["studies/year-end-refresh/ohlcv/**"],
            )
            self.assertEqual(
                refreshed_study.definition.judge.arguments[-2:],
                ["--dataset-root", "studies/year-end-refresh"],
            )
            snapshot = load_study_dataset_snapshot(project, refreshed_study)
            self.assertIsNotNone(snapshot)
            self.assertEqual(snapshot["version"], "2024-v2")
            self.assertEqual(snapshot["studyId"], "year-end-refresh")

            refreshed_run = execute_study(project, "year-end-refresh")
            self.assertEqual(refreshed_run.result["status"], "succeeded")
            self.assertEqual(
                refreshed_run.result["dataset"]["hash"],
                refreshed_study.dataset_hash,
            )
            load_book_risk_diagnostics(
                project,
                refreshed_run.result["id"],
                point_limit=20,
            )
            refreshed_report = publish_run_report(
                project,
                "year-end-refresh",
                refreshed_run.result["id"],
                _book_report_analysis(
                    refreshed_run.result["id"],
                    "Refreshed data-vintage conclusion",
                ),
            )
            self.assertEqual(
                refreshed_report.report["request"]["positionSnapshot"]["asOf"],
                "2024-12-31T21:00:00Z",
            )
            self.assertEqual(
                load_run_report(
                    project,
                    original_report.report["id"],
                ).report["request"]["positionSnapshot"]["asOf"],
                "2024-12-30T21:00:00Z",
            )
            for relative, expected in original_hashes.items():
                self.assertEqual(
                    hash_file(project.root_dir / relative),
                    expected,
                    relative,
                )
            validated = _run_cli(
                "validate",
                str(project.root_dir),
                "--json",
            )
            self.assertEqual(
                validated.returncode,
                0,
                validated.stderr or validated.stdout,
            )
            studio = build_studio_snapshot(project.root_dir)["projects"][0]
            self.assertEqual(studio["counts"]["studies"], 2)
            self.assertEqual(studio["counts"]["runs"], 2)
            self.assertEqual(studio["counts"]["reports"], 2)
            self.assertEqual(
                studio["bookRiskExplorer"]["run"]["id"],
                refreshed_run.result["id"],
            )
            fixed_request_path = (
                project.root_dir
                / "strategies/book-risk-studies/year-end-refresh/request.json"
            )
            tampered_request = json.loads(
                fixed_request_path.read_text(encoding="utf-8")
            )
            tampered_request["title"] = "Tampered refresh request"
            fixed_request_path.write_text(
                json.dumps(tampered_request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rejected = _run_cli(
                "validate",
                str(project.root_dir),
                "--json",
            )
            self.assertEqual(rejected.returncode, 1)
            self.assertIn(
                "study.dataset-request-hash",
                {
                    issue["code"]
                    for issue in json.loads(rejected.stdout)["error"]["issues"]
                },
            )

    def test_study_owned_refresh_rejects_non_newer_or_occupied_vintage(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = self._real_project(root)

            same_root = root / "same-vintage"
            same_root.mkdir()
            same_request, same_package = write_intake_inputs(
                same_root,
                observations=260,
                dataset_version="2024-v2",
                request_assets=("AAPL", "MSFT", "NVDA", "QQQ"),
                asset_position_roles={
                    symbol: "long-only"
                    for symbol in ("AAPL", "MSFT", "NVDA", "QQQ")
                },
            )
            _book_request(same_request)
            rejected = _run_cli(
                "study",
                "intake",
                str(project.root_dir),
                "not-newer",
                "--request",
                str(same_request),
                "--dataset",
                str(same_package),
                "--json",
            )
            self.assertEqual(rejected.returncode, 1)
            self.assertIn(
                "study-intake.dataset-not-newer",
                {
                    issue["code"]
                    for issue in json.loads(rejected.stdout)["error"]["issues"]
                },
            )
            for relative in (
                "studies/not-newer",
                "strategies/book-risk-studies/not-newer",
                "judges/book-risk-studies/not-newer",
                "data/studies/not-newer",
            ):
                self.assertFalse((project.root_dir / relative).exists())

            refresh_root = root / "occupied-vintage"
            refresh_root.mkdir()
            refresh_request, refresh_package = write_intake_inputs(
                refresh_root,
                observations=261,
                dataset_version="2024-v3",
                request_assets=("AAPL", "MSFT", "NVDA", "QQQ"),
                asset_position_roles={
                    symbol: "long-only"
                    for symbol in ("AAPL", "MSFT", "NVDA", "QQQ")
                },
            )
            _book_request(refresh_request)
            request = json.loads(refresh_request.read_text(encoding="utf-8"))
            request["positionSnapshot"]["asOf"] = "2024-12-31T21:00:00Z"
            refresh_request.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            occupied = project.root_dir / "data/studies/occupied-refresh"
            occupied.mkdir(parents=True)
            sentinel = occupied / "sentinel.txt"
            sentinel.write_text("caller-owned\n", encoding="utf-8")
            rejected = _run_cli(
                "study",
                "intake",
                str(project.root_dir),
                "occupied-refresh",
                "--request",
                str(refresh_request),
                "--dataset",
                str(refresh_package),
                "--json",
            )
            self.assertEqual(rejected.returncode, 1)
            self.assertEqual(
                json.loads(rejected.stdout)["error"]["issues"][0]["code"],
                "study.exists",
            )
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "caller-owned\n")
            for relative in (
                "studies/occupied-refresh",
                "strategies/book-risk-studies/occupied-refresh",
                "judges/book-risk-studies/occupied-refresh",
            ):
                self.assertFalse((project.root_dir / relative).exists())

    def test_caller_supplied_funded_scenarios_share_one_fixed_run(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._scenario_project(Path(directory))
            snapshot = load_position_snapshot(
                project.root_dir / POSITION_SNAPSHOT
            )
            self.assertEqual(
                [item["id"] for item in snapshot["scenarios"]],
                ["fund-tsla-from-nvda", "fund-tsla-from-qqq"],
            )
            self.assertEqual(
                {
                    item["authority"]["positionTruth"]
                    for item in snapshot["scenarios"]
                },
                {"caller-hypothetical-not-authenticated"},
            )
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            self.assertEqual(run.result["metrics"]["scenario_count"], 2)
            diagnostics = load_book_risk_diagnostics(
                project,
                run.result["id"],
                point_limit=20,
            )
            jsonschema.validate(
                diagnostics,
                BOOK_RISK_DIAGNOSTICS_JSON_SCHEMA,
            )
            comparison = diagnostics["scenarioComparison"]
            self.assertEqual(
                comparison["comparisonUniverse"],
                ["AAPL", "MSFT", "NVDA", "QQQ", "TSLA"],
            )
            self.assertEqual(len(comparison["baselineLookbacks"]), 3)
            self.assertEqual(len(comparison["scenarios"]), 2)
            for lookback_index in range(3):
                self.assertEqual(
                    sorted(
                        int(scenario["lookbacks"][lookback_index][
                            "volatilityRank"
                        ])
                        for scenario in comparison["scenarios"]
                    ),
                    [1, 2],
                )
            for scenario in comparison["scenarios"]:
                self.assertEqual(
                    len(scenario["primaryContributions"]),
                    5,
                )
                self.assertAlmostEqual(
                    sum(
                        row["scenarioAbsoluteRiskShare"]
                        for row in scenario["primaryContributions"]
                    ),
                    1.0,
                )
            observed = build_studio_snapshot(project.root_dir)["projects"][0]
            self.assertEqual(
                len(
                    observed["bookRiskExplorer"][
                        "scenarioComparison"
                    ]["scenarios"]
                ),
                2,
            )
            brief = build_agent_work_brief(project)
            self.assertEqual(
                brief["researchAgenda"]["status"],
                "descriptive-audit-complete",
            )
            self.assertEqual(brief["researchAgenda"]["moves"], [])

    def test_position_scenarios_reject_ambiguous_or_unauthorized_books(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                assets=("AAPL", "MSFT", "NVDA", "QQQ", "TSLA"),
                request_assets=("AAPL", "MSFT", "NVDA", "QQQ", "TSLA"),
                asset_position_roles={
                    "AAPL": "long-only",
                    "MSFT": "long-only",
                    "NVDA": "long-only",
                    "QQQ": "long-only",
                    "TSLA": "long-only",
                },
            )
            _book_scenario_request(request_path)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["positionScenarios"][1]["id"] = request[
                "positionScenarios"
            ][0]["id"]
            request["positionScenarios"][1]["asOf"] = (
                "2024-12-29T21:00:00Z"
            )
            request["positionScenarios"][1]["weights"] = dict(
                request["positionSnapshot"]["weights"]
            )
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            codes = {issue.code for issue in captured.exception.issues}
            self.assertIn("request.position-scenario-duplicate-id", codes)
            self.assertIn("request.position-scenario-time", codes)
            self.assertIn("request.position-scenario-duplicate-book", codes)

            _book_scenario_request(request_path)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["positionScenarios"][0]["weights"]["UNREQUESTED"] = 0.10
            request["positionScenarios"][0]["weights"]["NVDA"] -= 0.10
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            self.assertIn(
                "request.position-scenario-unrequested",
                {issue.code for issue in captured.exception.issues},
            )

    def test_book_risk_intake_requires_funded_position_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            self.assertIn(
                "request.position-snapshot-required",
                {issue.code for issue in captured.exception.issues},
            )

            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["positionSnapshot"] = {
                "kind": "reported-weights",
                "asOf": "2024-12-30T21:00:00Z",
                "baseCurrency": "USD",
                "weights": {"AAPL": 0.6, "MSFT": 0.5},
                "cashWeight": 0.0,
            }
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            self.assertIn(
                "request.position-snapshot-funded",
                {issue.code for issue in captured.exception.issues},
            )

            request["positionSnapshot"] = {
                "kind": "reported-weights",
                "asOf": "2025-01-30T21:00:00Z",
                "baseCurrency": "USD",
                "weights": {"AAPL": 0.5, "MSFT": 0.5},
                "cashWeight": 0.0,
            }
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-book-risk-lab",
                )
            self.assertIn(
                "request.position-snapshot-range",
                {issue.code for issue in captured.exception.issues},
            )

            request["positionSnapshot"]["asOf"] = "2024-12-30T21:00:00Z"
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-factor-lab",
                )
            self.assertIn(
                "request.position-snapshot-template",
                {issue.code for issue in captured.exception.issues},
            )

    def test_explorer_rejects_rehashed_cross_artifact_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._real_project(Path(directory))
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            report_path = (
                run.root_dir / "artifacts" / "book-risk-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["contributions"][0]["absoluteRiskShare"] += 0.01
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_risk_diagnostics(project, run.result["id"])
            self.assertIn(
                "book-risk.contributions",
                {issue.code for issue in captured.exception.issues},
            )

        with tempfile.TemporaryDirectory() as directory:
            project = self._real_project(Path(directory))
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            path = (
                run.root_dir / "artifacts" / "book-risk-equity-path.csv"
            )
            with path.open("r", encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle)
                rows = list(reader)
                fields = list(reader.fieldnames or [])
            rows[-1]["drawdown"] = str(float(rows[-1]["drawdown"]) + 0.01)
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_risk_diagnostics(project, run.result["id"])
            self.assertIn(
                "book-risk.reconcile",
                {issue.code for issue in captured.exception.issues},
            )

    def test_explorer_rejects_rehashed_snapshot_and_method_tampering(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._real_project(Path(directory))
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            report_path = (
                run.root_dir / "artifacts" / "book-risk-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            frozen_path = (
                run.root_dir
                / "inputs"
                / "dependency-sources"
                / "strategies"
                / "position-snapshot.json"
            )
            frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
            frozen["asOf"] = "2024-12-30"
            report["positionSnapshot"] = frozen
            frozen_path.write_text(
                json.dumps(frozen, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_risk_diagnostics(project, run.result["id"])
            self.assertIn(
                "position-snapshot.identity",
                {issue.code for issue in captured.exception.issues},
            )

        with tempfile.TemporaryDirectory() as directory:
            project = self._real_project(Path(directory))
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            report_path = (
                run.root_dir / "artifacts" / "book-risk-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["method"]["selectionAuthority"] = "invented"
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_risk_diagnostics(project, run.result["id"])
            self.assertIn(
                "book-risk.schema",
                {issue.code for issue in captured.exception.issues},
            )

    def test_explorer_rejects_rehashed_scenario_delta_and_csv_tampering(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._scenario_project(Path(directory))
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            report_path = (
                run.root_dir / "artifacts" / "book-risk-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["scenarioComparison"]["scenarios"][0]["lookbacks"][0][
                "annualizedVolatilityDelta"
            ] += 0.01
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_risk_diagnostics(project, run.result["id"])
            self.assertIn(
                "book-risk.reconcile",
                {issue.code for issue in captured.exception.issues},
            )

        with tempfile.TemporaryDirectory() as directory:
            project = self._scenario_project(Path(directory))
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            csv_path = (
                run.root_dir
                / "artifacts"
                / "book-risk-scenario-comparisons.csv"
            )
            with csv_path.open(
                "r",
                encoding="utf-8",
                newline="",
            ) as handle:
                reader = csv.DictReader(handle)
                rows = list(reader)
                fields = list(reader.fieldnames or [])
            rows[0]["annualizedVolatilityDelta"] = str(
                float(rows[0]["annualizedVolatilityDelta"]) + 0.01
            )
            with csv_path.open(
                "w",
                encoding="utf-8",
                newline="",
            ) as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_risk_diagnostics(project, run.result["id"])
            self.assertIn(
                "book-risk.scenario-comparisons",
                {issue.code for issue in captured.exception.issues},
            )

        with tempfile.TemporaryDirectory() as directory:
            project = self._scenario_project(Path(directory))
            run = execute_study(project, BOOK_RISK_STUDY_ID)
            report_path = (
                run.root_dir / "artifacts" / "book-risk-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            primary = next(
                row
                for row in report["scenarioComparison"]["scenarios"][0][
                    "lookbacks"
                ]
                if row["lookbackBars"]
                == report["method"]["primaryLookbackBars"]
            )
            replacement = next(
                asset
                for asset in report["scenarioComparison"][
                    "comparisonUniverse"
                ]
                if asset
                != primary["largestAbsoluteRiskContributor"]
            )
            primary["largestAbsoluteRiskContributor"] = replacement
            comparison_path = (
                run.root_dir
                / "artifacts"
                / "book-risk-scenario-comparisons.csv"
            )
            with comparison_path.open(
                "r",
                encoding="utf-8",
                newline="",
            ) as handle:
                reader = csv.DictReader(handle)
                rows = list(reader)
                fields = list(reader.fieldnames or [])
            for row in rows:
                if (
                    row["scenarioId"]
                    == report["scenarioComparison"]["scenarios"][0]["id"]
                    and int(row["lookbackBars"])
                    == report["method"]["primaryLookbackBars"]
                ):
                    row["largestAbsoluteRiskContributor"] = replacement
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with comparison_path.open(
                "w",
                encoding="utf-8",
                newline="",
            ) as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_risk_diagnostics(project, run.result["id"])
            self.assertIn(
                "book-risk.scenario-contributor",
                {issue.code for issue in captured.exception.issues},
            )
