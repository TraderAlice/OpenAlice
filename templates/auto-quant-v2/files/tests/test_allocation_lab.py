from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import jsonschema
import numpy as np
import pandas as pd

from autoquant.allocation_explorer import (
    ALLOCATION_DIAGNOSTICS_JSON_SCHEMA,
    load_allocation_diagnostics,
)
from autoquant.allocation_policies import (
    ALLOCATION_POLICY,
    load_allocation_contract,
)
from autoquant.briefs import validate_research_request
from autoquant.intake import (
    OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
    load_project_intake,
    prepare_project_intake,
)
from autoquant.orientation import build_agent_work_brief
from autoquant.project_templates.ohlcv_allocation_lab.allocation_core import (
    construct_erc_targets,
    solve_equal_risk_contribution,
)
from autoquant.runs import execute_study
from autoquant.studio import build_studio_snapshot
from autoquant.templates import ALLOCATION_STUDY_ID
from autoquant.workspace import (
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
)
from tests.intake_helpers import write_intake_inputs


def _rehash_run(run_root: Path) -> None:
    manifest_path = run_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"] = {
        path.relative_to(run_root).as_posix(): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in sorted(run_root.rglob("*"))
        if path.is_file() and path != manifest_path
    }
    manifest["resultHash"] = manifest["files"]["result.json"]
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


class AllocationContractTests(unittest.TestCase):
    def test_request_accepts_only_funded_fixed_weight_reference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "allocation",
                template="ohlcv-allocation-lab",
            )
            request = json.loads(
                (project.root_dir / "request.json").read_text(encoding="utf-8")
            )
            normalized = validate_research_request(request)
            self.assertEqual(
                normalized["allocationPolicy"]["kind"],
                "equal-risk-contribution",
            )
            self.assertEqual(
                normalized["benchmarkPolicy"]["weights"],
                {"ALPHA": 0.6, "BRAVO": 0.4},
            )
            malformed = json.loads(json.dumps(request))
            malformed["benchmarkPolicy"]["weights"] = {
                "ALPHA": 0.6,
                "BRAVO": 0.3,
            }
            with self.assertRaises(AutoQuantValidationError) as caught:
                validate_research_request(malformed)
            self.assertIn(
                "request.benchmark-funded",
                {issue.code for issue in caught.exception.issues},
            )
            unknown = json.loads(json.dumps(request))
            unknown["allocationPolicy"]["optimizer"] = "magic"
            with self.assertRaises(AutoQuantValidationError) as caught:
                validate_research_request(unknown)
            self.assertIn(
                "schema.unknown",
                {issue.code for issue in caught.exception.issues},
            )


class EqualRiskContributionTests(unittest.TestCase):
    def test_solver_discloses_cap_induced_parity_gap(self) -> None:
        assets = pd.Index(["LOW", "MID", "HIGH"])
        covariance = pd.DataFrame(
            np.diag([0.01, 0.04, 0.09]),
            index=assets,
            columns=assets,
        )
        unconstrained = solve_equal_risk_contribution(
            covariance,
            pd.Series(1.0, index=assets),
            tolerance=1e-5,
        )
        self.assertTrue(unconstrained.converged)
        np.testing.assert_allclose(
            unconstrained.risk_contribution_shares.to_numpy(),
            np.repeat(1.0 / 3.0, 3),
            atol=1e-8,
        )
        capped = solve_equal_risk_contribution(
            covariance,
            pd.Series({"LOW": 0.35, "MID": 1.0, "HIGH": 1.0}),
            tolerance=0.01,
        )
        self.assertEqual(capped.cap_binding_assets, ("LOW",))
        self.assertFalse(capped.converged)
        self.assertGreater(capped.maximum_contribution_error, 0.01)

    def test_target_construction_is_prefix_causal(self) -> None:
        index = pd.bdate_range("2024-01-02", periods=90)
        returns = pd.DataFrame(
            {
                "A": 0.001 + 0.004 * np.sin(np.arange(90) / 5),
                "B": 0.0005 + 0.003 * np.cos(np.arange(90) / 7),
                "C": 0.0002 + 0.005 * np.sin(np.arange(90) / 9),
            },
            index=index,
        )
        closes = 100 * (1 + returns).cumprod()
        contract = {
            "universe": ["A", "B", "C"],
            "tradableAssets": ["A", "B", "C"],
            "method": {
                "covarianceWindow": 20,
                "minimumObservations": 10,
                "contributionTolerance": 0.20,
            },
            "portfolioPolicy": {
                "maxAbsWeight": 0.60,
                "assetMaxAbsWeights": {},
            },
        }
        mask = pd.Series(False, index=index)
        mask.iloc[[20, 40, 60, 80]] = True
        full, _ = construct_erc_targets(closes, contract, mask)
        changed = closes.copy()
        changed.iloc[61:] *= pd.Series({"A": 1.8, "B": 0.7, "C": 1.2})
        changed_targets, _ = construct_erc_targets(changed, contract, mask)
        pd.testing.assert_frame_equal(
            full.loc[: index[60]],
            changed_targets.loc[: index[60]],
        )


class AllocationLabTests(unittest.TestCase):
    def test_mixed_class_intake_keeps_context_reference_out_of_erc(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            roles = {
                "AAPL": "long-only",
                "NVDA": "long-only",
                "GLD": "long-only",
                "TLT": "long-only",
                "SPY": "context-only",
            }
            request_path, package_path = write_intake_inputs(
                root,
                observations=643,
                assets=("AAPL", "NVDA", "GLD", "TLT", "SPY"),
                request_assets=("AAPL", "NVDA", "GLD", "TLT", "SPY"),
                asset_position_roles=roles,
                portfolio_policy={
                    "annualizedVolatilityCeiling": 0.20,
                    "assetMaxAbsWeights": {
                        "AAPL": 0.30,
                        "NVDA": 0.30,
                        "GLD": 0.30,
                        "TLT": 0.30,
                    },
                    "baseCostBps": 5.0,
                    "decisionSchedule": {
                        "kind": "calendar-month-end",
                    },
                    "grossLimit": 1.0,
                    "maxAbsWeight": 0.30,
                    "noTradeOneWay": 0.02,
                    "referenceNav": 100_000.0,
                },
                benchmark_policy={
                    "kind": "fixed-weights",
                    "weights": {"SPY": 0.60, "TLT": 0.40},
                },
            )
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["allocationPolicy"] = {
                "kind": "equal-risk-contribution",
                "covarianceWindow": 126,
                "minimumObservations": 126,
                "contributionTolerance": 0.01,
                "scaleUp": False,
            }
            requested_classes = {
                "AAPL": "equity",
                "NVDA": "equity",
                "GLD": "fund",
                "TLT": "fund",
                "SPY": "fund",
            }
            for asset in request["assets"]:
                asset["assetClass"] = requested_classes[asset["symbol"]]
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["assetClass"] = "mixed"
            for asset in package["assets"]:
                asset["assetClass"] = requested_classes[asset["symbol"]]
            package_path.write_text(
                json.dumps(package, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            jsonschema.validate(
                package,
                OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
            )

            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-allocation-lab",
            )
            self.assertEqual(prepared.package["assetClass"], "mixed")
            self.assertEqual(
                {
                    asset.symbol: asset.asset_class
                    for asset in prepared.assets
                },
                requested_classes,
            )
            workspace = initialize_workspace(root / "workspace")
            project = create_project(
                workspace.root_dir,
                "mixed-allocation",
                template=prepared.template,
                template_intake=prepared,
            )
            intake = load_project_intake(project)
            assert intake is not None
            self.assertEqual(
                {
                    asset["symbol"]: asset["assetClass"]
                    for asset in intake["dataset"]["assets"]
                },
                requested_classes,
            )
            contract = load_allocation_contract(
                project.root_dir / ALLOCATION_POLICY
            )
            self.assertEqual(
                contract["tradableAssets"],
                ["AAPL", "NVDA", "GLD", "TLT"],
            )
            self.assertEqual(contract["contextAssets"], ["SPY"])
            self.assertEqual(
                contract["benchmark"]["weights"],
                {"SPY": 0.60, "TLT": 0.40},
            )

            run = execute_study(project, ALLOCATION_STUDY_ID)
            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            diagnostics = load_allocation_diagnostics(
                project,
                run.result["id"],
            )
            self.assertEqual(
                diagnostics["dataset"]["assetClasses"],
                requested_classes,
            )
            self.assertEqual(
                diagnostics["dataset"]["assetClassSource"],
                "per-asset",
            )
            self.assertEqual(
                diagnostics["latestDecision"]["targetWeights"]["SPY"],
                0.0,
            )
            self.assertEqual(
                diagnostics["latestDecision"]["executedWeights"]["SPY"],
                0.0,
            )
            self.assertEqual(
                diagnostics["latestDecision"][
                    "targetRiskContributionShares"
                ]["SPY"],
                0.0,
            )
            validation_fidelity = diagnostics["constructionFidelity"][
                "bySplit"
            ]["validation"]
            self.assertEqual(
                validation_fidelity["scheduledDecisions"],
                6,
            )
            self.assertEqual(
                validation_fidelity["eligibleDecisions"],
                6,
            )
            self.assertEqual(
                validation_fidelity["withinToleranceDecisions"]
                + validation_fidelity["capInducedParityGapDecisions"],
                6,
            )
            self.assertAlmostEqual(
                validation_fidelity["withinToleranceRate"],
                validation_fidelity["withinToleranceDecisions"] / 6,
            )
            self.assertGreater(
                validation_fidelity["maximumContributionError"],
                0.01,
            )
            self.assertGreaterEqual(
                validation_fidelity["latestEligibleDecision"]["asOf"],
                diagnostics["splitProtocol"]["splits"]["validation"][
                    "start"
                ],
            )
            self.assertLessEqual(
                validation_fidelity["latestEligibleDecision"]["asOf"],
                diagnostics["splitProtocol"]["splits"]["validation"]["end"],
            )
            self.assertEqual(
                validation_fidelity["latestEligibleDecision"]["status"],
                "cap-induced-parity-gap",
            )
            self.assertEqual(
                diagnostics["conclusion"]["scope"],
                "relative-performance-only",
            )
            self.assertEqual(
                run.result["metrics"]["construction_fidelity"]["bySplit"][
                    "validation"
                ]["eligibleDecisions"],
                diagnostics["constructionFidelity"]["bySplit"][
                    "validation"
                ]["eligibleDecisions"],
            )
            snapshot = build_studio_snapshot(project.root_dir)
            self.assertTrue(snapshot["valid"])
            self.assertEqual(snapshot["diagnostics"], [])
            studio_project = snapshot["projects"][0]
            self.assertEqual(
                {
                    asset["symbol"]: asset["assetClass"]
                    for asset in studio_project["intake"]["dataset"]["assets"]
                },
                requested_classes,
            )
            studio_contract = studio_project["allocationExplorer"]["contract"]
            self.assertEqual(
                studio_project["allocationExplorer"]["dataset"][
                    "assetClasses"
                ],
                requested_classes,
            )
            self.assertEqual(
                studio_contract["tradableAssets"],
                ["AAPL", "NVDA", "GLD", "TLT"],
            )
            self.assertEqual(studio_contract["contextAssets"], ["SPY"])
            self.assertEqual(
                studio_contract["benchmark"]["weights"],
                {"SPY": 0.60, "TLT": 0.40},
            )
            self.assertEqual(
                studio_project["allocationExplorer"][
                    "constructionFidelity"
                ],
                diagnostics["constructionFidelity"],
            )
            self.assertEqual(
                studio_project["agentWorkBrief"]["constructionFidelity"],
                diagnostics["constructionFidelity"],
            )

            dataset_snapshot_path = (
                project.root_dir / "data" / "ohlcv" / "snapshot.json"
            )
            dataset_snapshot = json.loads(
                dataset_snapshot_path.read_text(encoding="utf-8")
            )
            dataset_snapshot["assets"][0]["assetClass"] = "fund"
            dataset_snapshot_path.write_text(
                json.dumps(
                    dataset_snapshot,
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            intake_path = project.root_dir / "intake.json"
            intake_manifest = json.loads(
                intake_path.read_text(encoding="utf-8")
            )
            intake_manifest["datasetSnapshotHash"] = hashlib.sha256(
                dataset_snapshot_path.read_bytes()
            ).hexdigest()
            intake_path.write_text(
                json.dumps(
                    intake_manifest,
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as caught:
                load_project_intake(project)
            self.assertIn(
                "intake.snapshot-request-asset-classes",
                {issue.code for issue in caught.exception.issues},
            )

    def test_template_run_explorer_and_studio_are_strict(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "allocation",
                template="ohlcv-allocation-lab",
            )
            study = json.loads(
                (
                    project.root_dir
                    / "studies"
                    / ALLOCATION_STUDY_ID
                    / "study.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(study["editable"]["paths"], [])
            self.assertEqual(
                study["dependencies"]["paths"],
                [ALLOCATION_POLICY],
            )
            contract = load_allocation_contract(
                project.root_dir / ALLOCATION_POLICY
            )
            self.assertEqual(contract["tradingAuthority"], "none")
            run = execute_study(project, ALLOCATION_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            self.assertEqual(
                {item["kind"] for item in run.result["artifacts"]},
                {
                    "allocation-report",
                    "allocation-daily",
                    "allocation-targets",
                    "allocation-weights",
                    "allocation-reference-weights",
                    "allocation-decisions",
                },
            )
            diagnostics = load_allocation_diagnostics(
                project,
                run.result["id"],
                points=60,
            )
            jsonschema.validate(
                diagnostics,
                ALLOCATION_DIAGNOSTICS_JSON_SCHEMA,
            )
            self.assertTrue(diagnostics["verification"]["strict"])
            self.assertFalse(
                diagnostics["conclusion"]["testUsedForSelection"]
            )
            self.assertEqual(
                diagnostics["latestDecision"]["tradingAuthority"],
                "none",
            )
            self.assertTrue(
                diagnostics["verification"]["riskContributionsReconciled"]
            )
            self.assertTrue(
                diagnostics["verification"]["currentStateReconciled"]
            )
            self.assertTrue(
                diagnostics["verification"][
                    "constructionFidelityReconciled"
                ]
            )
            self.assertEqual(
                diagnostics["conclusion"]["scope"],
                "relative-performance-only",
            )
            self.assertEqual(
                diagnostics["currentState"]["tradingAuthority"],
                "none",
            )
            self.assertEqual(
                set(diagnostics["currentState"]["candidatePretradeWeights"]),
                set(contract["universe"]),
            )
            snapshot = build_studio_snapshot(project.root_dir)
            observed = snapshot["projects"][0]
            request_path = project.root_dir / "request.json"
            self.assertEqual(
                observed["agentWorkBrief"]["question"],
                {
                    "title": "Synthetic equal-risk-contribution allocation",
                    "text": (
                        "Does fixed ERC improve on a fixed 60/40 reference?"
                    ),
                    "origin": "project-request",
                    "sourcePath": str(request_path),
                    "requestPath": str(request_path),
                },
            )
            self.assertEqual(
                observed["allocationExplorer"]["run"]["id"],
                run.result["id"],
            )
            self.assertIsNone(
                observed["agentWorkBrief"]["primaryAction"]
            )
            self.assertIn(
                "run.allocation",
                {command["id"] for command in observed["commands"]},
            )
            brief = build_agent_work_brief(project)
            self.assertEqual(
                brief["constructionFidelity"],
                diagnostics["constructionFidelity"],
            )
            self.assertIsNone(brief["primaryAction"])
            self.assertEqual(brief["focus"]["operatingMode"], "observe")
            self.assertEqual(brief["review"]["status"], "complete")
            self.assertIn(
                "Write and return the decision-support answer",
                brief["review"]["next"],
            )
            self.assertEqual(
                [item["id"] for item in brief["supportingActions"]],
                ["run.allocation"],
            )
            self.assertEqual(
                brief["supportingActions"][0]["effect"],
                "read-only",
            )
            self.assertEqual(
                brief["supportingActions"][0]["expectedEvidenceKind"],
                "allocation-diagnostics",
            )
            self.assertEqual(
                brief["researchAgenda"]["run"]["inputHash"],
                run.result["inputHash"],
            )
            self.assertTrue(observed["valid"])

    def test_explorer_derives_split_fidelity_for_legacy_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "allocation",
                template="ohlcv-allocation-lab",
            )
            run = execute_study(project, ALLOCATION_STUDY_ID)
            report_path = (
                run.root_dir / "artifacts" / "allocation-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            expected = report.pop("constructionFidelity")
            report["conclusion"].pop("scope")
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            _rehash_run(run.root_dir)

            diagnostics = load_allocation_diagnostics(
                project,
                run.result["id"],
            )
            jsonschema.validate(
                diagnostics["constructionFidelity"],
                ALLOCATION_DIAGNOSTICS_JSON_SCHEMA["properties"][
                    "constructionFidelity"
                ],
            )
            self.assertEqual(
                diagnostics["constructionFidelity"]["bySplit"][
                    "validation"
                ]["eligibleDecisions"],
                expected["bySplit"]["validation"]["eligibleDecisions"],
            )
            self.assertAlmostEqual(
                diagnostics["constructionFidelity"]["bySplit"][
                    "validation"
                ]["maximumContributionError"],
                expected["bySplit"]["validation"][
                    "maximumContributionError"
                ],
            )
            self.assertEqual(
                diagnostics["conclusion"]["scope"],
                "relative-performance-only",
            )

    def test_explorer_rejects_rehashed_split_fidelity_tamper(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "allocation",
                template="ohlcv-allocation-lab",
            )
            run = execute_study(project, ALLOCATION_STUDY_ID)
            report_path = (
                run.root_dir / "artifacts" / "allocation-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["constructionFidelity"]["bySplit"]["validation"][
                "withinToleranceRate"
            ] = 0.123
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            _rehash_run(run.root_dir)

            with self.assertRaises(AutoQuantValidationError) as caught:
                load_allocation_diagnostics(project, run.result["id"])
            self.assertIn(
                "allocation.reconcile",
                {issue.code for issue in caught.exception.issues},
            )

    def test_explorer_rejects_rehashed_accounting_tamper(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "allocation",
                template="ohlcv-allocation-lab",
            )
            run = execute_study(project, ALLOCATION_STUDY_ID)
            daily_path = (
                run.root_dir / "artifacts" / "allocation-daily.csv"
            )
            daily = pd.read_csv(daily_path)
            daily.loc[50, "excess_net_return"] += 0.01
            daily.to_csv(daily_path, index=False)
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as caught:
                load_allocation_diagnostics(project, run.result["id"])
            self.assertIn(
                "allocation.excess",
                {issue.code for issue in caught.exception.issues},
            )

    def test_explorer_rejects_rehashed_risk_contribution_tamper(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "allocation",
                template="ohlcv-allocation-lab",
            )
            run = execute_study(project, ALLOCATION_STUDY_ID)
            decisions_path = (
                run.root_dir / "artifacts" / "allocation-decisions.csv"
            )
            decisions = pd.read_csv(decisions_path)
            eligible = decisions[
                decisions["solver_status"] != "insufficient-history"
            ]
            latest = eligible["timestamp"].max()
            row = decisions.index[
                (decisions["timestamp"] == latest)
                & (decisions["asset"] == "ALPHA")
            ][0]
            decisions.loc[row, "target_risk_contribution_share"] += 0.01
            decisions.to_csv(decisions_path, index=False)
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as caught:
                load_allocation_diagnostics(project, run.result["id"])
            self.assertIn(
                "allocation.reconcile",
                {issue.code for issue in caught.exception.issues},
            )
