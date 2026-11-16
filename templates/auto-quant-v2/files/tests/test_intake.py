from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import jsonschema
import pandas as pd

from autoquant.briefs import load_research_request
from autoquant.checks import execute_candidate_check
from autoquant.factor_explorer import (
    FACTOR_DIAGNOSTICS_JSON_SCHEMA,
    load_factor_diagnostics,
)
from autoquant.factor_claims import FACTOR_CLAIM, load_factor_claim
from autoquant.horizons import (
    RESEARCH_HORIZON,
    load_research_horizon,
)
from autoquant.intake import (
    OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
    load_project_intake,
    materialize_intake_dataset,
    prepare_project_intake,
    prepare_study_dataset_intake,
)
from autoquant.mandates import (
    PORTFOLIO_MANDATE,
    load_portfolio_mandate,
)
from autoquant.intervals import load_multi_interval_asset
from autoquant.portfolio_explorer import (
    PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA,
    load_portfolio_diagnostics,
)
from autoquant.prediction_modes import (
    FACTOR_POPULATION,
    load_factor_population,
)
from autoquant.orientation import build_agent_work_brief
from autoquant.rl_explorer import (
    RL_DIAGNOSTICS_JSON_SCHEMA,
    load_rl_diagnostics,
)
from autoquant.reports import publish_report
from autoquant.run_reports import publish_run_report
from autoquant.runs import RUN_RESULT_JSON_SCHEMA, execute_study
from autoquant.sessions import start_session
from autoquant.studio import build_studio_snapshot
from autoquant.studies import hash_file, load_study
from autoquant.templates import (
    OHLCV_STUDY_ID,
    PORTFOLIO_STUDY_ID,
    RL_STUDY_ID,
)
from autoquant.workspace import (
    AutoQuantValidationError,
    create_or_intake_project,
    create_project,
    initialize_workspace,
    load_workspace,
)
from tests.intake_helpers import (
    write_cross_market_daily_inputs,
    write_configurable_continuous_inputs,
    write_intake_inputs,
    write_multi_interval_inputs,
    write_observed_intraday_inputs,
    write_session_interval_inputs,
)
from tests.test_cli import run_cli


CONSTANT_TEMPORAL_FACTOR = """\
from __future__ import annotations

import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    return pd.Series(1.0, index=panel.index)
"""


SPARSE_TEMPORAL_FACTOR = """\
from __future__ import annotations

import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    value = panel.groupby("asset", sort=False)["volume"].pct_change(
        fill_method=None
    )
    return value.where(panel["timestamp"].dt.hour.eq(0))
"""


VOLUME_TEMPORAL_FACTOR = """\
from __future__ import annotations

import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    return panel.groupby("asset", sort=False)["volume"].pct_change(
        fill_method=None
    )
"""


CROSS_MARKET_ASOF_FACTOR = """\
from __future__ import annotations

import numpy as np
import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    result = pd.Series(np.nan, index=panel.index, dtype=float)
    target = (
        panel.loc[panel["asset"].eq("7203.T"), ["timestamp"]]
        .assign(row_index=lambda frame: frame.index)
        .sort_values("timestamp", kind="stable")
    )
    context = (
        panel.loc[panel["asset"].eq("SPY"), ["timestamp", "close"]]
        .sort_values("timestamp", kind="stable")
    )
    context["completed_context_return"] = context["close"].pct_change(
        fill_method=None
    )
    aligned = pd.merge_asof(
        target,
        context[["timestamp", "completed_context_return"]],
        on="timestamp",
        direction="backward",
        allow_exact_matches=True,
    )
    result.loc[aligned["row_index"].to_numpy()] = aligned[
        "completed_context_return"
    ].to_numpy()
    return result
"""


class RequestDrivenIntakeTests(unittest.TestCase):
    def _single_asset_temporal_project(
        self,
        root: Path,
        project_id: str,
        candidate: str,
        *,
        constant_target: bool = False,
    ):
        request_path, package_path = write_multi_interval_inputs(root)
        request = json.loads(request_path.read_text(encoding="utf-8"))
        request["assets"] = [
            {
                "symbol": "BTC",
                "assetClass": "crypto",
                "venue": "CRYPTO-COMPOSITE",
            }
        ]
        request["factorPolicy"] = {
            "claim": "decision-signal",
            "knownStyle": None,
            "predictionAssets": ["BTC"],
        }
        request_path.write_text(
            json.dumps(request, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        if constant_target:
            source = package_path.parent / "BTC.csv"
            frame = pd.read_csv(source)
            frame["open"] = 100.0
            frame["high"] = 101.0
            frame["low"] = 99.0
            frame["close"] = 100.0
            frame.to_csv(source, index=False)
        prepared = prepare_project_intake(
            request_path,
            package_path,
            "ohlcv-factor-lab",
        )
        project = create_project(
            initialize_workspace(root / "workspace").root_dir,
            project_id,
            template=prepared.template,
            template_intake=prepared,
        )
        (project.root_dir / "factors" / "candidate.py").write_text(
            candidate,
            encoding="utf-8",
        )
        return project

    def test_temporal_primary_validation_reports_candidate_variation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._single_asset_temporal_project(
                Path(directory),
                "constant-temporal-factor",
                CONSTANT_TEMPORAL_FACTOR,
            )

            run = execute_study(project, OHLCV_STUDY_ID)

            self.assertEqual(run.result["status"], "failed")
            self.assertEqual(
                run.result["failureDisposition"],
                "scientific-limit",
            )
            error = run.result["errors"][0]
            self.assertEqual(
                error["code"],
                "factor.temporal-primary-candidate-variation",
            )
            self.assertIn("evaluationMode=single-asset-temporal", error["message"])
            self.assertIn("split=validation", error["message"])
            self.assertIn("distinctFactorValues=1", error["message"])
            self.assertNotIn("TypeError", error["message"])

            brief = build_agent_work_brief(project)
            self.assertEqual(brief["evidence"]["runId"], run.result["id"])
            self.assertEqual(brief["evidence"]["runStatus"], "failed")
            self.assertEqual(
                brief["evidence"]["failureDisposition"],
                "scientific-limit",
            )
            self.assertEqual(
                brief["reasons"][0]["code"],
                "scientific-limit-report-required",
            )
            self.assertEqual(brief["primaryAction"]["id"], "report.publish")
            self.assertEqual(
                brief["supportingActions"][0]["id"],
                "report.draft",
            )
            self.assertIn("--study", brief["supportingActions"][0]["argv"])
            self.assertIn(run.result["id"], brief["supportingActions"][0]["argv"])
            self.assertEqual(brief["researchAgenda"]["status"], "scientific-limit")
            self.assertNotIn(
                "run.execute",
                [
                    action["id"]
                    for action in [
                        brief["primaryAction"],
                        *brief["supportingActions"],
                    ]
                    if action is not None
                ],
            )

            report = publish_run_report(
                project,
                OHLCV_STUDY_ID,
                run.result["id"],
                {
                    "schemaVersion": 1,
                    "kind": "autoquant-research-report-analysis",
                    "title": "Fixed temporal Factor is unevaluable",
                    "executiveSummary": (
                        "The validation population has no candidate variation, "
                        "so the exact fixed temporal Factor cannot be evaluated."
                    ),
                    "findings": [
                        {
                            "id": "fixed-factor-unevaluable",
                            "claim": (
                                "The immutable Run records a scientific limit "
                                "rather than usable Factor evidence."
                            ),
                            "confidence": "high",
                            "evidenceRefs": [
                                {
                                    "kind": "run",
                                    "id": run.result["id"],
                                    "artifactPath": None,
                                }
                            ],
                        }
                    ],
                    "recommendations": [],
                    "limitations": [
                        "A different hypothesis or Event Study is separate work."
                    ],
                    "unresolvedQuestions": [],
                },
            )
            self.assertEqual(
                report.report["evidence"]["run"]["failureDisposition"],
                "scientific-limit",
            )
            self.assertEqual(
                report.report["evidence"]["run"]["errors"][0]["code"],
                "factor.temporal-primary-candidate-variation",
            )

            terminal = build_agent_work_brief(project)
            self.assertIsNone(terminal["primaryAction"])
            self.assertEqual(
                terminal["reasons"][0]["code"],
                "scientific-limit-reported",
            )
            self.assertEqual(terminal["evidence"]["reportId"], report.report["id"])
            snapshot = build_studio_snapshot(project.root_dir)
            observed = snapshot["projects"][0]
            self.assertEqual(
                observed["runs"][-1]["failureDisposition"],
                "scientific-limit",
            )
            self.assertEqual(
                observed["agentWorkBrief"]["reasons"][0]["code"],
                "scientific-limit-reported",
            )

    def test_temporal_primary_validation_reports_too_few_pairs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._single_asset_temporal_project(
                Path(directory),
                "sparse-temporal-factor",
                SPARSE_TEMPORAL_FACTOR,
            )

            run = execute_study(project, OHLCV_STUDY_ID)

            self.assertEqual(run.result["status"], "failed")
            error = run.result["errors"][0]
            self.assertEqual(
                error["code"],
                "factor.temporal-primary-observations",
            )
            self.assertIn("minimumObservations=20", error["message"])
            self.assertNotIn("TypeError", error["message"])

    def test_temporal_primary_validation_reports_target_variation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._single_asset_temporal_project(
                Path(directory),
                "constant-temporal-target",
                VOLUME_TEMPORAL_FACTOR,
                constant_target=True,
            )

            run = execute_study(project, OHLCV_STUDY_ID)

            self.assertEqual(run.result["status"], "failed")
            error = run.result["errors"][0]
            self.assertEqual(
                error["code"],
                "factor.temporal-primary-target-variation",
            )
            self.assertIn("distinctTargetValues=1", error["message"])
            self.assertNotIn("TypeError", error["message"])

    def test_relative_value_primary_validation_uses_same_preflight(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                request_assets=("NVDA", "QQQ", "SPY"),
                asset_position_roles={
                    "NVDA": "two-sided",
                    "QQQ": "two-sided",
                    "SPY": "context-only",
                },
                factor_policy={
                    "claim": "decision-signal",
                    "knownStyle": None,
                },
            )
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["direction"] = "relative-value"
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "constant-relative-value-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            (project.root_dir / "factors" / "candidate.py").write_text(
                CONSTANT_TEMPORAL_FACTOR,
                encoding="utf-8",
            )

            run = execute_study(project, OHLCV_STUDY_ID)

            self.assertEqual(run.result["status"], "failed")
            error = run.result["errors"][0]
            self.assertEqual(
                error["code"],
                "factor.temporal-primary-candidate-variation",
            )
            self.assertIn(
                "evaluationMode=two-asset-relative-value",
                error["message"],
            )
            self.assertIn("distinctFactorValues=1", error["message"])

    def test_generic_study_owned_profile_admits_aligned_v1_v2_v3_only(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for expected, writer in (
                (1, write_intake_inputs),
                (2, write_multi_interval_inputs),
                (3, write_session_interval_inputs),
            ):
                with self.subTest(schema_version=expected):
                    fixture = root / f"v{expected}"
                    fixture.mkdir()
                    request, package = writer(fixture)
                    prepared = prepare_study_dataset_intake(request, package)
                    self.assertEqual(
                        prepared.package["schemaVersion"],
                        expected,
                    )
                    self.assertEqual(prepared.template, "study-owned-ohlcv")

            v4 = root / "v4"
            v4.mkdir()
            request, package = write_intake_inputs(v4)
            manifest = json.loads(package.read_text(encoding="utf-8"))
            manifest["schemaVersion"] = 4
            manifest["panelPolicy"] = {
                "alignment": "observed-only",
                "missingObservation": "absent-no-fill",
            }
            package.write_text(
                json.dumps(manifest, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as caught:
                prepare_study_dataset_intake(request, package)
            self.assertIn(
                "dataset.ragged-factor-only",
                {issue.code for issue in caught.exception.issues},
            )

    def test_intake_hydrates_pristine_scaffold_and_preserves_agent_notes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(root / "workspace")
            scaffold = create_project(
                workspace.root_dir,
                "brief-first-factor",
                name="Brief First Factor",
                description="Clarify before binding strict authority.",
                template="ohlcv-factor-lab",
            )
            research = "# Preserved research brief\n\nCaller intent is clear.\n"
            needs = "# Preserved framework needs\n\nNo needs yet.\n"
            (scaffold.root_dir / "research.md").write_text(
                research,
                encoding="utf-8",
            )
            (scaffold.root_dir / "framework-needs.md").write_text(
                needs,
                encoding="utf-8",
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )

            project = create_or_intake_project(
                workspace.root_dir,
                scaffold.manifest.id,
                name="Strict Factor Project",
                description=prepared.request["question"],
                template="ohlcv-factor-lab",
                template_intake=prepared,
            )

            self.assertEqual(
                (project.root_dir / "research.md").read_text(encoding="utf-8"),
                research,
            )
            self.assertEqual(
                (project.root_dir / "framework-needs.md").read_text(
                    encoding="utf-8"
                ),
                needs,
            )
            self.assertEqual(project.manifest.name, "Strict Factor Project")
            self.assertIsNotNone(load_project_intake(project))
            self.assertTrue((project.root_dir / "data/ohlcv/snapshot.json").is_file())

    def test_intake_refuses_to_replace_scaffold_with_candidate_work(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(root / "workspace")
            scaffold = create_project(
                workspace.root_dir,
                "worked-factor",
                template="ohlcv-factor-lab",
            )
            candidate = scaffold.root_dir / "factors/candidate.py"
            candidate.write_text(
                candidate.read_text(encoding="utf-8") + "\n# researched\n",
                encoding="utf-8",
            )
            before = candidate.read_bytes()
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )

            with self.assertRaises(AutoQuantValidationError) as caught:
                create_or_intake_project(
                    workspace.root_dir,
                    scaffold.manifest.id,
                    name=None,
                    description=prepared.request["question"],
                    template="ohlcv-factor-lab",
                    template_intake=prepared,
                )

            self.assertIn(
                "project.intake-scaffold-modified",
                {issue.code for issue in caught.exception.issues},
            )
            self.assertEqual(candidate.read_bytes(), before)
            self.assertIsNone(load_project_intake(scaffold))

    def test_daily_factor_demonstrator_declares_only_base_surface(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "daily-factor-baseline",
                template=prepared.template,
                template_intake=prepared,
            )
            candidate = (
                project.root_dir / "factors" / "candidate.py"
            ).read_text(encoding="utf-8")
            self.assertIn(
                "AVAILABLE_FEATURE_INTERVALS = []",
                candidate,
            )
            self.assertIn("API demonstrator", candidate)
            research = (
                project.root_dir / "research.md"
            ).read_text(encoding="utf-8")
            self.assertIn("Do not execute it as the caller's baseline", research)
            self.assertNotIn("aq run execute", research)
            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            self.assertEqual(
                [
                    item["id"]
                    for item in run.result["metrics"]["factor_components"][
                        "declaration"
                    ]["components"]
                ],
                ["base_momentum_10"],
            )

    def test_manifest_root_intakes_nested_staged_sources_without_intermediate_copy(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, original_package_path = write_intake_inputs(root)
            package = json.loads(
                original_package_path.read_text(encoding="utf-8")
            )
            staging = root / "workspace" / "staging"
            raw = staging / "raw-ohlcv"
            raw.mkdir(parents=True)
            source_hashes: dict[str, str] = {}
            for asset in package["assets"]:
                symbol = asset["symbol"]
                original = original_package_path.parent / asset["path"]
                staged = raw / f"{symbol}.csv"
                original.replace(staged)
                asset["path"] = f"raw-ohlcv/{symbol}.csv"
                source_hashes[symbol] = hash_file(staged)

            package_path = staging / "dataset-package.json"
            package_path.write_text(
                json.dumps(package, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            original_package_path.unlink()

            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )

            self.assertEqual(
                {
                    asset.symbol: asset.source_relative_path
                    for asset in prepared.assets
                },
                {
                    symbol: f"raw-ohlcv/{symbol}.csv"
                    for symbol in source_hashes
                },
            )
            self.assertEqual(
                {
                    asset.symbol: asset.source_hash
                    for asset in prepared.assets
                },
                source_hashes,
            )
            self.assertEqual(
                sorted(path.name for path in raw.glob("*.csv")),
                sorted(f"{symbol}.csv" for symbol in source_hashes),
            )
            self.assertEqual(
                list(staging.glob("*.csv")),
                [],
                "intake preparation must not create a sibling raw-data copy",
            )

    def test_aligned_package_asset_classes_are_complete_and_truthful(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            legacy = json.loads(package_path.read_text(encoding="utf-8"))
            jsonschema.validate(
                legacy,
                OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            self.assertFalse(prepared.per_asset_classes)

            partial = json.loads(json.dumps(legacy))
            partial["assets"][0]["assetClass"] = "equity"
            with self.assertRaises(jsonschema.ValidationError):
                jsonschema.validate(
                    partial,
                    OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
                )
            package_path.write_text(
                json.dumps(partial, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as caught:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-factor-lab",
                )
            self.assertIn(
                "dataset.partial-asset-classes",
                {issue.code for issue in caught.exception.issues},
            )

            unsupported = json.loads(json.dumps(legacy))
            for asset in unsupported["assets"]:
                asset["assetClass"] = "security"
            with self.assertRaises(jsonschema.ValidationError):
                jsonschema.validate(
                    unsupported,
                    OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
                )
            package_path.write_text(
                json.dumps(unsupported, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as caught:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-factor-lab",
                )
            self.assertIn(
                "dataset.asset-class",
                {issue.code for issue in caught.exception.issues},
            )

            wrong_summary = json.loads(json.dumps(legacy))
            classes = {
                "AAPL": "equity",
                "MSFT": "equity",
                "NVDA": "equity",
                "QQQ": "fund",
                "SPY": "fund",
            }
            for asset in wrong_summary["assets"]:
                asset["assetClass"] = classes[asset["symbol"]]
            jsonschema.validate(
                wrong_summary,
                OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
            )
            package_path.write_text(
                json.dumps(wrong_summary, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as caught:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-factor-lab",
                )
            self.assertIn(
                "dataset.asset-class-summary",
                {issue.code for issue in caught.exception.issues},
            )

    def test_v1_through_v4_freeze_complete_per_asset_classes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "workspace")
            fixtures = []
            for version, writer in (
                (1, write_intake_inputs),
                (2, write_multi_interval_inputs),
                (3, write_session_interval_inputs),
                (4, write_intake_inputs),
            ):
                fixture_root = root / f"v{version}"
                fixture_root.mkdir()
                request_path, package_path = writer(fixture_root)
                package = json.loads(
                    package_path.read_text(encoding="utf-8")
                )
                if version == 4:
                    package["schemaVersion"] = 4
                    package["panelPolicy"] = {
                        "alignment": "observed-only",
                        "missingObservation": "absent-no-fill",
                    }
                request = json.loads(
                    request_path.read_text(encoding="utf-8")
                )
                requested_classes = {
                    asset["symbol"]: asset["assetClass"]
                    for asset in request["assets"]
                }
                expected_classes = {}
                for asset in package["assets"]:
                    asset_class = requested_classes.get(
                        asset["symbol"],
                        "fund",
                    )
                    asset["assetClass"] = asset_class
                    expected_classes[asset["symbol"]] = asset_class
                package["assetClass"] = "mixed"
                package_path.write_text(
                    json.dumps(package, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                fixtures.append(
                    (
                        version,
                        request_path,
                        package_path,
                        expected_classes,
                    )
                )

            for version, request_path, package_path, expected_classes in fixtures:
                package = json.loads(
                    package_path.read_text(encoding="utf-8")
                )
                jsonschema.validate(
                    package,
                    OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
                )
                prepared = prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-factor-lab",
                )
                self.assertTrue(prepared.per_asset_classes)
                self.assertEqual(
                    {
                        asset.symbol: asset.asset_class
                        for asset in prepared.assets
                    },
                    expected_classes,
                )
                project = create_project(
                    workspace.root_dir,
                    f"classified-v{version}",
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
                    expected_classes,
                )

    def test_unknown_provider_retrieval_time_is_explicit_and_preserved(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["provider"]["retrievedAt"] = None
            package_path.write_text(
                json.dumps(package, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            jsonschema.validate(
                package,
                OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
            )
            retrieved_schema = (
                OHLCV_DATASET_PACKAGE_JSON_SCHEMA["oneOf"][0]["properties"][
                    "provider"
                ]["properties"]["retrievedAt"]
            )
            self.assertIn(
                "never substitute a later packaging timestamp",
                retrieved_schema["description"],
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            self.assertIsNone(prepared.package["provider"]["retrievedAt"])
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "unknown-retrieval-time",
                template=prepared.template,
                template_intake=prepared,
            )
            intake = load_project_intake(project)
            assert intake is not None
            self.assertIsNone(
                intake["dataset"]["provider"]["retrievedAt"]
            )
            studio = build_studio_snapshot(project.root_dir)
            self.assertIsNone(
                studio["projects"][0]["intake"]["dataset"]["provider"][
                    "retrievedAt"
                ]
            )

            for invalid in ("", "2026-07-30T00:00:00", 123):
                package["provider"]["retrievedAt"] = invalid
                package_path.write_text(
                    json.dumps(package, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                with self.assertRaises(
                    AutoQuantValidationError
                ) as captured:
                    prepare_project_intake(
                        request_path,
                        package_path,
                        "ohlcv-factor-lab",
                    )
                self.assertIn(
                    "dataset.retrieved-at",
                    {issue.code for issue in captured.exception.issues},
                )
            with self.assertRaises(
                AutoQuantValidationError
            ) as captured:
                prepare_project_intake(
                    request_path,
                    package_path.parent,
                    "ohlcv-factor-lab",
                )
            self.assertEqual(
                captured.exception.issues[0].code,
                "dataset.manifest-path-required",
            )
            self.assertIn(
                "manifest file, not its containing directory",
                captured.exception.issues[0].message,
            )

    def test_unknown_retrieval_time_is_shared_by_every_package_route(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixtures: list[tuple[Path, Path, str]] = []
            for name, writer, template in (
                (
                    "v1",
                    write_intake_inputs,
                    "ohlcv-factor-lab",
                ),
                (
                    "v2",
                    write_multi_interval_inputs,
                    "ohlcv-research-desk",
                ),
                (
                    "v3",
                    write_session_interval_inputs,
                    "ohlcv-factor-lab",
                ),
                (
                    "v5",
                    write_observed_intraday_inputs,
                    "ohlcv-factor-lab",
                ),
            ):
                fixture_root = root / name
                fixture_root.mkdir()
                request_path, package_path = writer(fixture_root)
                fixtures.append((request_path, package_path, template))
            v4_root = root / "v4"
            v4_root.mkdir()
            request_path, package_path = write_intake_inputs(v4_root)
            v4_package = json.loads(
                package_path.read_text(encoding="utf-8")
            )
            v4_package["schemaVersion"] = 4
            v4_package["panelPolicy"] = {
                "alignment": "observed-only",
                "missingObservation": "absent-no-fill",
            }
            package_path.write_text(
                json.dumps(v4_package, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            fixtures.append(
                (request_path, package_path, "ohlcv-factor-lab")
            )

            observed_versions: list[int] = []
            for request_path, package_path, template in fixtures:
                package = json.loads(
                    package_path.read_text(encoding="utf-8")
                )
                package["provider"]["retrievedAt"] = None
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
                    template,
                )
                self.assertIsNone(
                    prepared.package["provider"]["retrievedAt"]
                )
                observed_versions.append(
                    prepared.package["schemaVersion"]
                )
            self.assertEqual(sorted(observed_versions), [1, 2, 3, 4, 5])

    def test_research_desk_rejects_pre_factor_claim_intake(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "legacy-factor-desk",
                template=prepared.template,
                template_intake=prepared,
            )

            claim_path = project.root_dir / FACTOR_CLAIM
            study_path = (
                project.root_dir
                / "studies"
                / OHLCV_STUDY_ID
                / "study.json"
            )
            study = json.loads(study_path.read_text(encoding="utf-8"))
            study["dependencies"]["paths"].remove(FACTOR_CLAIM)
            study_path.write_text(
                json.dumps(study, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            claim_path.unlink()

            legacy_study = load_study(project, OHLCV_STUDY_ID)
            intake_path = project.root_dir / "intake.json"
            intake = json.loads(intake_path.read_text(encoding="utf-8"))
            intake["studyHash"] = legacy_study.study_hash
            intake["studyInputHash"] = legacy_study.input_hash
            intake_path.write_text(
                json.dumps(intake, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "strategies/factor-claim.json",
            ):
                load_project_intake(project)

    def test_request_predeclares_and_locks_known_style_claim(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                factor_policy={
                    "claim": "known-style-validation",
                    "knownStyle": "reversal_5",
                },
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "known-style-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            claim = load_factor_claim(project.root_dir / FACTOR_CLAIM)
            self.assertEqual(claim["claim"], "known-style-validation")
            self.assertEqual(claim["knownStyle"], "reversal_5")
            self.assertEqual(
                claim["source"]["factorPolicy"],
                "caller-supplied",
            )
            candidate = (
                project.root_dir / "factors" / "candidate.py"
            ).read_text(encoding="utf-8")
            self.assertIn(
                "KNOWN_STYLE = 'reversal_5'",
                candidate,
            )
            self.assertIn(
                "Generated by AutoQuant intake",
                candidate,
            )
            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            self.assertEqual(run.result["metrics"]["factor_claim"], claim)
            projection = load_factor_diagnostics(project, run.result["id"])
            jsonschema.validate(
                projection,
                FACTOR_DIAGNOSTICS_JSON_SCHEMA,
            )
            self.assertEqual(
                projection["factorQualification"]["claim"],
                claim,
            )
            self.assertEqual(
                projection["factorQualification"]["selection"]["criterion"],
                "request-predeclared-known-style",
            )
            selected = next(
                item
                for item in projection["factorQualification"]["selection"][
                    "candidates"
                ]
                if item["style"] == "reversal_5"
            )
            self.assertAlmostEqual(
                selected["meanRankCorrelation"],
                1.0,
            )
            self.assertNotEqual(
                projection["factorQualification"]["diagnosis"]["stage"],
                "known-style-identity-mismatch",
            )

            claim_path = project.root_dir / FACTOR_CLAIM
            changed = json.loads(claim_path.read_text(encoding="utf-8"))
            changed["knownStyle"] = "momentum_20"
            claim_path.write_text(
                json.dumps(changed, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError):
                load_project_intake(project)

    def test_factor_policy_rejects_ambiguous_claims(self) -> None:
        cases = (
            {
                "claim": "novel-factor",
                "knownStyle": "reversal_5",
            },
            {
                "claim": "known-style-validation",
                "knownStyle": None,
            },
        )
        for index, policy in enumerate(cases):
            with self.subTest(policy=policy), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                request_path, package_path = write_intake_inputs(root)
                request = json.loads(request_path.read_text(encoding="utf-8"))
                request["factorPolicy"] = policy
                request_path.write_text(
                    json.dumps(request, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                with self.assertRaises(AutoQuantValidationError):
                    prepare_project_intake(
                        request_path,
                        package_path,
                        "ohlcv-factor-lab",
                    )

    def test_risk_outcome_rejects_downstream_and_ambiguous_populations(
        self,
    ) -> None:
        policy = {
            "claim": "decision-signal",
            "knownStyle": None,
            "outcome": "forward-realized-volatility",
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                assets=("AAPL", "MSFT", "NVDA", "QQQ", "SPY"),
                request_assets=("AAPL", "MSFT", "NVDA", "QQQ", "SPY"),
                factor_policy=policy,
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-portfolio-lab",
                )
            self.assertIn(
                "request.factor-outcome-template",
                {issue.code for issue in captured.exception.issues},
            )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                assets=("AAPL", "MSFT"),
                request_assets=("AAPL", "MSFT"),
                factor_policy=policy,
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-factor-lab",
                )
            self.assertIn(
                "request.factor-outcome-population",
                {issue.code for issue in captured.exception.issues},
            )

    def test_intake_rejects_horizon_without_purged_split_capacity(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                observations=260,
                horizon_policy={
                    "primaryForwardBars": 21,
                    "diagnosticForwardBars": [5, 21, 63],
                },
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-factor-lab",
                )
            self.assertIn(
                "horizon.insufficient-history",
                {item.code for item in captured.exception.issues},
            )

    def test_caller_horizon_governs_factor_selection_and_artifacts(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy = {
                "primaryForwardBars": 5,
                "diagnosticForwardBars": [1, 5, 20],
            }
            request_path, package_path = write_intake_inputs(
                root,
                horizon_policy=policy,
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "caller-horizon-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            horizon = load_research_horizon(
                project.root_dir / RESEARCH_HORIZON
            )
            self.assertEqual(horizon["primaryForwardBars"], 5)
            self.assertEqual(horizon["diagnosticForwardBars"], [1, 5, 20])
            self.assertEqual(
                horizon["source"]["horizonPolicy"],
                "caller-supplied",
            )
            study = load_study(project, OHLCV_STUDY_ID)
            self.assertEqual(
                study.definition.dependencies,
                {
                    "paths": [
                        "strategies/factor-claim.json",
                        FACTOR_POPULATION,
                        RESEARCH_HORIZON,
                    ]
                },
            )

            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            metrics = run.result["metrics"]
            self.assertEqual(metrics["research_horizon"], horizon)
            self.assertEqual(
                metrics["validation"],
                metrics["horizon_quality"]["5"]["validation"],
            )
            self.assertAlmostEqual(
                metrics["validation_mean_ic"],
                metrics["horizon_quality"]["5"]["validation"]["mean_ic"],
            )
            self.assertEqual(
                set(metrics["split_protocol"]["horizons"]),
                {"1", "5", "20"},
            )

            projection = load_factor_diagnostics(
                project,
                run.result["id"],
            )
            self.assertEqual(projection["researchHorizon"], horizon)
            self.assertEqual(
                [item["horizon"] for item in projection["horizonProfile"]],
                [1, 5, 20],
            )
            self.assertEqual(projection["protocol"]["primaryHorizon"], 5)
            jsonschema.validate(
                projection,
                FACTOR_DIAGNOSTICS_JSON_SCHEMA,
            )

    def test_decision_signal_factor_uses_independent_prediction_assets(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            requested = ("AAPL", "MSFT", "NVDA", "QQQ")
            request_path, package_path = write_intake_inputs(
                root,
                request_assets=requested,
                factor_policy={
                    "claim": "decision-signal",
                    "knownStyle": None,
                },
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "request-bound-factor-population",
                template=prepared.template,
                template_intake=prepared,
            )
            study = load_study(project, OHLCV_STUDY_ID)
            self.assertIn(
                FACTOR_POPULATION,
                study.definition.dependencies["paths"],
            )
            self.assertNotIn(
                PORTFOLIO_MANDATE,
                study.definition.dependencies["paths"],
            )
            self.assertFalse(
                (project.root_dir / PORTFOLIO_MANDATE).exists()
            )
            fixed_population = load_factor_population(
                project.root_dir / FACTOR_POPULATION
            )
            self.assertEqual(
                fixed_population["predictionAssets"],
                list(requested),
            )

            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            population = run.result["metrics"]["prediction_universe"]
            self.assertEqual(
                population["authority"],
                "caller-factor-policy-prediction-assets",
            )
            self.assertEqual(population["prediction_assets"], list(requested))
            self.assertEqual(population["context_assets"], ["SPY"])
            self.assertEqual(run.result["metrics"]["prediction_assets"], 4)
            self.assertEqual(
                set(
                    run.result["metrics"]["stability"]["per_asset"][
                        "validation"
                    ]
                ),
                set(requested),
            )

            projection = load_factor_diagnostics(project, run.result["id"])
            self.assertEqual(
                projection["predictionUniverse"]["predictionAssets"],
                list(requested),
            )
            self.assertEqual(
                projection["predictionUniverse"]["contextAssets"],
                ["SPY"],
            )
            jsonschema.validate(
                projection,
                FACTOR_DIAGNOSTICS_JSON_SCHEMA,
            )

    def test_small_decision_population_does_not_borrow_context_targets(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                request_assets=("AAPL", "MSFT", "NVDA"),
                factor_policy={
                    "claim": "decision-signal",
                    "knownStyle": None,
                },
            )
            with self.assertRaises(AutoQuantValidationError) as raised:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-factor-lab",
                )
            self.assertIn(
                "factor-population.size",
                {issue.code for issue in raised.exception.issues},
            )
            self.assertIn(
                "three-asset basket",
                str(raised.exception),
            )

    def test_two_asset_relative_value_uses_temporal_spread_evaluation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                request_assets=("NVDA", "QQQ", "SPY"),
                asset_position_roles={
                    "NVDA": "two-sided",
                    "QQQ": "two-sided",
                    "SPY": "context-only",
                },
                factor_policy={
                    "claim": "decision-signal",
                    "knownStyle": None,
                },
            )
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["direction"] = "relative-value"
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "two-asset-relative-value-factor",
                template=prepared.template,
                template_intake=prepared,
            )

            run = execute_study(project, OHLCV_STUDY_ID)

            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            metrics = run.result["metrics"]
            population = metrics["prediction_universe"]
            self.assertEqual(
                population["evaluation_mode"],
                "two-asset-relative-value",
            )
            self.assertEqual(population["prediction_assets"], ["NVDA", "QQQ"])
            self.assertIn("SPY", population["context_assets"])
            self.assertEqual(
                population["relative_value_pair"],
                {
                    "left_asset": "NVDA",
                    "right_asset": "QQQ",
                    "factor_contrast": (
                        "factor(left_asset)-factor(right_asset)"
                    ),
                    "target_contrast": (
                        "forward_return(left_asset)-"
                        "forward_return(right_asset)"
                    ),
                    "portfolio_construction_authority": "none",
                },
            )
            self.assertEqual(
                metrics["input_availability"][
                    "minimum_assets_per_factor_timestamp"
                ],
                2,
            )
            self.assertEqual(
                set(metrics["stability"]["per_asset"]["validation"]),
                {"NVDA", "QQQ"},
            )
            components = metrics["factor_components"]
            self.assertEqual(
                components["method"],
                "candidate-declared-components-v3",
            )
            self.assertEqual(
                components["semantics"]["evaluation_mode"],
                "two-asset-relative-value",
            )
            self.assertEqual(
                components["validation_diagnosis"][
                    "strongest_raw_component"
                ],
                "base_momentum_10",
            )
            projection = load_factor_diagnostics(project, run.result["id"])
            self.assertEqual(
                projection["predictionUniverse"]["evaluationMode"],
                "two-asset-relative-value",
            )
            self.assertEqual(
                projection["quantileEvidence"]["status"],
                "protocol-unavailable",
            )
            self.assertEqual(
                projection["quantileEvidence"]["reasonCode"],
                "temporal-tertiles-not-defined",
            )
            self.assertEqual(
                projection["quantileEvidence"]["artifactRows"],
                0,
            )
            self.assertEqual(
                projection["predictionUniverse"]["relativeValuePair"],
                population["relative_value_pair"],
            )
            self.assertEqual(
                projection["factorQualification"]["method"],
                "request-claim-aware-one-style-temporal-neutralization-v1",
            )
            self.assertTrue(projection["factorComponents"]["available"])
            self.assertEqual(
                projection["factorComponents"]["evaluationMode"],
                "two-asset-relative-value",
            )
            jsonschema.validate(
                projection,
                FACTOR_DIAGNOSTICS_JSON_SCHEMA,
            )

    def test_relative_value_portfolio_reconciles_translation_window_stress(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                request_assets=("NVDA", "QQQ", "SPY"),
                asset_position_roles={
                    "NVDA": "two-sided",
                    "QQQ": "two-sided",
                    "SPY": "context-only",
                },
                factor_policy={
                    "claim": "decision-signal",
                    "knownStyle": None,
                },
            )
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["direction"] = "relative-value"
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "relative-value-translation-stress",
                template=prepared.template,
                template_intake=prepared,
            )

            run = execute_study(project, PORTFOLIO_STUDY_ID)

            self.assertEqual(run.result["status"], "succeeded", run.result["errors"])
            metric = run.result["metrics"]["translation_robustness"]
            self.assertTrue(metric["applicable"])
            self.assertEqual(
                [
                    profile["window"]
                    for profile in metric["policy"]["profiles"]
                ],
                [40, 60, 120],
            )
            self.assertEqual(
                metric["diagnosis"]["selection_split"],
                "validation",
            )
            self.assertFalse(
                metric["diagnosis"]["test_enters_diagnosis"]
            )
            self.assertIn(
                "portfolio-translation-robustness",
                {artifact["kind"] for artifact in run.result["artifacts"]},
            )
            projection = load_portfolio_diagnostics(
                project,
                run.result["id"],
            )
            robustness = projection["translationRobustness"]
            self.assertTrue(robustness["applicable"])
            self.assertEqual(
                [
                    profile["windowObservations"]
                    for profile in robustness["validation"]["profiles"]
                ],
                [40, 60, 120],
            )
            self.assertEqual(
                robustness["policy"]["selectionAuthority"],
                "context-only",
            )
            self.assertEqual(
                set(robustness["current"]["profiles"]),
                {"short-history", "base", "long-history"},
            )
            monetization = projection["signalMonetization"]
            self.assertEqual(
                monetization["semantics"],
                {
                    "contribution": (
                        "additive-weight-times-next-bar-return"
                    ),
                    "evaluationMode": "two-asset-relative-value",
                    "intentConstruction": (
                        "capped-complementary-relative-value-pair"
                    ),
                    "equalIntent": (
                        "prediction-mode-aware-mandate-constrained-"
                        "signal-state-diagnostic"
                    ),
                    "counterfactualCompounding": False,
                    "entersSelection": False,
                },
            )
            validation_monetization = monetization["validation"]
            self.assertGreater(
                validation_monetization["coverage"][
                    "equalIntentActiveDates"
                ],
                0,
            )
            self.assertEqual(
                validation_monetization["coverage"][
                    "equalIntentActiveDates"
                ],
                validation_monetization["coverage"][
                    "rawTargetActiveDates"
                ],
            )
            monetization_stages = {
                item["id"]: item
                for item in validation_monetization["stages"]
            }
            self.assertAlmostEqual(
                monetization_stages["equalIntent"]["totalContribution"],
                monetization_stages["preGovernorSizing"][
                    "totalContribution"
                ],
                places=12,
            )
            self.assertEqual(
                monetization["diagnosis"]["outcome"],
                "monetized-positive",
            )
            self.assertTrue(
                validation_monetization["reconciliation"][
                    "relativeValueIntentTargetParityApplicable"
                ]
            )
            self.assertAlmostEqual(
                validation_monetization["reconciliation"][
                    "maximumRelativeValueIntentTargetError"
                ],
                0.0,
                places=12,
            )
            context_assets = {
                item["asset"]: item
                for item in validation_monetization["byAsset"]
                if item["asset"] == "SPY"
            }
            self.assertEqual(context_assets["SPY"]["equalIntent"], 0.0)
            jsonschema.validate(
                projection,
                PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA,
            )
            artifact_path = (
                run.root_dir
                / "artifacts"
                / "portfolio-translation-robustness.json"
            )
            artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
            first_scored = next(
                row for row in artifact["assetRows"] if row["score"] is not None
            )
            first_scored["score"] = float(first_scored["score"]) + 0.01
            artifact_path.write_text(
                json.dumps(artifact, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            manifest_path = run.root_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["files"] = {
                path.relative_to(run.root_dir).as_posix(): hash_file(path)
                for path in sorted(run.root_dir.rglob("*"))
                if path.is_file() and path != manifest_path
            }
            manifest["resultHash"] = manifest["files"]["result.json"]
            manifest_path.write_text(
                json.dumps(manifest, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Translation score does not reconcile",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_single_asset_decision_signal_uses_temporal_evaluation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_multi_interval_inputs(root)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["assets"] = [
                {
                    "symbol": "BTC",
                    "assetClass": "crypto",
                    "venue": "CRYPTO-COMPOSITE",
                }
            ]
            request["factorPolicy"] = {
                "claim": "decision-signal",
                "knownStyle": None,
                "predictionAssets": ["BTC"],
            }
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "single-asset-temporal-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            metrics = run.result["metrics"]
            population = metrics["prediction_universe"]
            self.assertEqual(
                population["evaluation_mode"],
                "single-asset-temporal",
            )
            self.assertEqual(population["prediction_assets"], ["BTC"])
            self.assertEqual(
                population["context_assets"],
                ["ETH", "SOL", "XRP", "ADA"],
            )
            self.assertEqual(
                metrics["input_availability"][
                    "minimum_assets_per_factor_timestamp"
                ],
                1,
            )
            self.assertEqual(
                set(metrics["stability"]["per_asset"]["validation"]),
                {"BTC"},
            )
            components = metrics["factor_components"]
            self.assertEqual(
                components["method"],
                "candidate-declared-components-v3",
            )
            self.assertEqual(
                components["semantics"]["evaluation_mode"],
                "single-asset-temporal",
            )
            self.assertEqual(
                components["validation_diagnosis"][
                    "strongest_raw_component"
                ],
                "base_momentum_10",
            )
            self.assertEqual(
                components["trial_disclosure"],
                {
                    "materialized_components": 4,
                    "cross_sectional_score_components": 4,
                    "timestamp_context_components": 0,
                    "pairwise_comparisons": 6,
                    "component_diagnostics_enter_promotion_score": False,
                },
            )
            self.assertIsNotNone(
                components["validation_diagnosis"][
                    "strongest_residual_component"
                ]
            )
            self.assertIsNotNone(
                components["validation_diagnosis"][
                    "removal_most_improves_fixed_blend"
                ]
            )

            projection = load_factor_diagnostics(project, run.result["id"])
            self.assertEqual(
                projection["predictionUniverse"]["evaluationMode"],
                "single-asset-temporal",
            )
            self.assertEqual(
                projection["quantileEvidence"]["status"],
                "protocol-unavailable",
            )
            self.assertIn(
                "protocol-not-applicable",
                projection["quantileEvidence"]["reason"],
            )
            self.assertEqual(
                projection["inputAvailability"][
                    "minimumAssetsPerFactorTimestamp"
                ],
                1,
            )
            self.assertEqual(
                projection["factorQualification"]["method"],
                "request-claim-aware-one-style-temporal-neutralization-v1",
            )
            self.assertTrue(projection["factorComponents"]["available"])
            self.assertEqual(
                projection["factorComponents"]["evaluationMode"],
                "single-asset-temporal",
            )
            human = run_cli(
                "run",
                "factor",
                str(project.root_dir),
                "--run",
                run.result["id"],
            )
            self.assertEqual(human.returncode, 0, human.stderr)
            self.assertIn(
                "Quantile evidence: protocol-unavailable · "
                "temporal-tertiles-not-defined · 0 artifact rows",
                human.stdout,
            )
            self.assertEqual(
                len(projection["factorComponents"]["pairwise"]),
                6,
            )
            jsonschema.validate(
                projection,
                FACTOR_DIAGNOSTICS_JSON_SCHEMA,
            )

    def test_single_asset_temporal_context_uses_contribution_semantics(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_multi_interval_inputs(root)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["assets"] = [
                {
                    "symbol": "BTC",
                    "assetClass": "crypto",
                    "venue": "CRYPTO-COMPOSITE",
                }
            ]
            request["factorPolicy"] = {
                "claim": "decision-signal",
                "knownStyle": None,
                "predictionAssets": ["BTC"],
            }
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "single-asset-temporal-context",
                template=prepared.template,
                template_intake=prepared,
            )
            (project.root_dir / "factors" / "candidate.py").write_text(
                """from __future__ import annotations

import pandas as pd

FACTOR_COMPONENTS = {
    "asset_momentum": {
        "label": "Asset momentum",
        "role": "cross-sectional-score",
        "intervals": ["base"],
        "hypothesis": "Recent returns persist for the target asset.",
    },
    "market_state": {
        "label": "Market state",
        "role": "timestamp-context",
        "intervals": ["base"],
        "hypothesis": "Target timing differs with the causal market state.",
    },
}

def compute_factor_components(panel: pd.DataFrame) -> pd.DataFrame:
    momentum = panel.groupby("asset", sort=False)["close"].pct_change(
        10, fill_method=None
    )
    context = momentum.groupby(panel["timestamp"], sort=False).transform(
        "mean"
    )
    return pd.DataFrame(
        {"asset_momentum": momentum, "market_state": context},
        index=panel.index,
    )

def compute_factor(panel: pd.DataFrame) -> pd.Series:
    return compute_factor_components(panel)["asset_momentum"]
""",
                encoding="utf-8",
            )

            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            metrics = run.result["metrics"]["factor_components"]
            context = next(
                item
                for item in metrics["components"]
                if item["id"] == "market_state"
            )["timestamp_context"]
            self.assertEqual(
                context["method"],
                "train-tertile-temporal-context-v2",
            )
            self.assertEqual(
                context["conditional_measure"],
                "within-split-temporal-rank-correlation-contribution",
            )
            diagnostics = load_factor_diagnostics(project, run.result["id"])
            projected = next(
                item
                for item in diagnostics["factorComponents"]["components"]
                if item["id"] == "market_state"
            )["timestampContext"]
            self.assertEqual(
                projected["conditionalMeasure"],
                "within-split-temporal-rank-correlation-contribution",
            )
            jsonschema.validate(
                diagnostics,
                FACTOR_DIAGNOSTICS_JSON_SCHEMA,
            )

    def test_single_asset_temporal_intake_does_not_require_context_padding(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_multi_interval_inputs(root)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["assets"] = [
                {
                    "symbol": "BTC",
                    "assetClass": "crypto",
                    "venue": "CRYPTO-COMPOSITE",
                    "positionRole": "long-only",
                }
            ]
            request["factorPolicy"] = {
                "claim": "decision-signal",
                "knownStyle": None,
                "predictionAssets": ["BTC"],
            }
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["assets"] = [
                item for item in package["assets"] if item["symbol"] == "BTC"
            ]
            package_path.write_text(
                json.dumps(package, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "single-asset-without-context-padding",
                template=prepared.template,
                template_intake=prepared,
            )
            (project.root_dir / "factors" / "candidate.py").write_text(
                (
                    "from __future__ import annotations\n\n"
                    "import pandas as pd\n\n"
                    "def compute_factor(panel: pd.DataFrame) -> pd.Series:\n"
                    "    return panel.groupby('asset', sort=False)['close']"
                    ".pct_change(10, fill_method=None)\n"
                ),
                encoding="utf-8",
            )
            run = execute_study(project, OHLCV_STUDY_ID)

            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            population = run.result["metrics"]["prediction_universe"]
            self.assertEqual(
                population["evaluation_mode"],
                "single-asset-temporal",
            )
            self.assertEqual(population["prediction_assets"], ["BTC"])
            self.assertEqual(population["context_assets"], [])
            self.assertEqual(
                run.result["metrics"]["input_availability"][
                    "minimum_assets_per_factor_timestamp"
                ],
                1,
            )

    def test_caller_portfolio_policy_governs_portfolio_and_rl(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy = {
                "grossLimit": 0.8,
                "maxAbsWeight": 0.2,
                "assetMaxAbsWeights": {
                    "AAPL": 0.12,
                    "MSFT": 0.08,
                },
                "annualizedVolatilityCeiling": 0.12,
                "baseCostBps": 17.5,
                "noTradeOneWay": 0.04,
                "referenceNav": 250_000.0,
                "decisionSchedule": {
                    "kind": "every-bars",
                    "bars": 4,
                    "anchor": "dataset-start",
                },
            }
            request_path, package_path = write_intake_inputs(
                root,
                portfolio_policy=policy,
                benchmark_policy={
                    "kind": "asset",
                    "symbol": "SPY",
                },
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "caller-policy-desk",
                template=prepared.template,
                template_intake=prepared,
            )
            mandate = load_portfolio_mandate(
                project.root_dir / PORTFOLIO_MANDATE
            )
            self.assertEqual(
                mandate["source"]["portfolioPolicy"],
                "caller-supplied",
            )
            self.assertEqual(
                mandate["implementationPolicy"]["baseCostBps"],
                17.5,
            )
            self.assertEqual(
                mandate["implementationPolicy"]["decisionPolicy"],
                {
                    "source": "caller-supplied",
                    "kind": "every-bars",
                    "bars": 4,
                    "anchor": "dataset-start",
                },
            )
            self.assertEqual(
                mandate["construction"]["assetMaxAbsWeights"],
                {
                    "AAPL": 0.12,
                    "MSFT": 0.08,
                    "NVDA": 0.0,
                    "QQQ": 0.0,
                    "SPY": 0.0,
                },
            )
            self.assertEqual(
                mandate["construction"]["benchmark"],
                {
                    "source": "caller-supplied",
                    "kind": "single-asset-long",
                    "asset": "SPY",
                    "weights": {
                        "AAPL": 0.0,
                        "MSFT": 0.0,
                        "NVDA": 0.0,
                        "QQQ": 0.0,
                        "SPY": 1.0,
                    },
                },
            )

            portfolio_run = execute_study(project, PORTFOLIO_STUDY_ID)
            rl_run = execute_study(project, RL_STUDY_ID)
            for run in (portfolio_run, rl_run):
                self.assertEqual(
                    run.result["status"],
                    "succeeded",
                    run.result["errors"],
                )
                self.assertEqual(
                    run.result["metrics"]["portfolio_mandate"],
                    mandate,
                )
                jsonschema.validate(run.result, RUN_RESULT_JSON_SCHEMA)
            portfolio_metrics = portfolio_run.result["metrics"]
            daily = pd.read_csv(
                portfolio_run.root_dir
                / "artifacts"
                / "daily-portfolio.csv"
            )
            spy = pd.read_csv(root / "external-data" / "SPY.csv")
            expected_spy_returns = (
                spy["close"].shift(-1) / spy["close"] - 1.0
            ).fillna(0.0)
            expected_by_date = dict(
                zip(
                    spy["date"],
                    expected_spy_returns,
                    strict=True,
                )
            )
            source_positions = {
                str(date): position
                for position, date in enumerate(spy["date"])
            }
            for _, row in daily.iterrows():
                decision_date = str(row["timestamp"])[:10]
                expected_eligible = (
                    source_positions[decision_date] % 4 == 0
                )
                self.assertEqual(
                    bool(row["decision_eligible"]),
                    expected_eligible,
                )
                self.assertEqual(int(row["decision_every_bars"]), 4)
                self.assertEqual(row["decision_anchor"], "dataset-start")
                self.assertEqual(
                    row["decision_schedule_kind"],
                    "every-bars",
                )
                self.assertEqual(row["decision_session"], "dataset")
                if not expected_eligible:
                    self.assertFalse(bool(row["ordinary_rebalance"]))
                    self.assertTrue(
                        abs(float(row["traded_notional"])) <= 1e-12
                        or bool(row["risk_rebalance_override"])
                        or bool(row["constraint_rebalance_override"])
                    )
                    self.assertIn(
                        row["execution_reason"],
                        {
                            "decision_schedule_hold",
                            "risk_ceiling_override",
                            "mandate_constraint_override",
                            "mandate_and_risk_override",
                        },
                    )
            self.assertEqual(len(daily), len(spy) - 1)
            for row_number in (0, 50, len(daily) - 2):
                decision_date = str(
                    daily.loc[row_number, "timestamp"]
                )[:10]
                self.assertAlmostEqual(
                    daily.loc[row_number, "benchmark_return"],
                    expected_by_date[decision_date],
                    places=10,
                )
            self.assertEqual(
                portfolio_metrics["signal_policy"]["parameters"],
                {
                    "long_entry_percentile": 0.75,
                    "long_exit_percentile": 0.55,
                    "short_exit_percentile": 0.45,
                    "short_entry_percentile": 0.25,
                    "volatility_window": 20,
                    "gross_target": 0.8,
                    "max_abs_weight": 0.2,
                    "no_trade_one_way": 0.04,
                    "decision_schedule": {
                        "source": "caller-supplied",
                        "kind": "every-bars",
                        "bars": 4,
                        "anchor": "dataset-start",
                    },
                },
            )
            self.assertEqual(
                set(
                    portfolio_metrics["robustness"]["cost_stress"]
                ),
                {"0bps", "17.5bps", "35bps"},
            )
            self.assertEqual(
                portfolio_metrics["liquidity_capacity"]["policy"][
                    "reference_nav"
                ],
                250_000.0,
            )
            portfolio_projection = load_portfolio_diagnostics(
                project,
                portfolio_run.result["id"],
            )
            self.assertEqual(
                portfolio_projection["mandate"]["implementationPolicy"],
                mandate["implementationPolicy"],
            )
            self.assertEqual(
                portfolio_projection["mandate"]["assetMaxAbsWeights"],
                mandate["construction"]["assetMaxAbsWeights"],
            )
            self.assertEqual(
                portfolio_projection["mandate"]["benchmark"],
                mandate["construction"]["benchmark"],
            )
            for position in portfolio_projection["sizingAnatomy"][
                "positions"
            ]:
                self.assertEqual(
                    position["maxAbsWeight"],
                    mandate["construction"]["assetMaxAbsWeights"][
                        position["asset"]
                    ],
                )
            self.assertAlmostEqual(
                portfolio_projection["strategyViability"]["validation"][
                    "friction"
                ]["baseCostBps"],
                17.5,
            )
            self.assertEqual(
                {
                    key: portfolio_projection["decisionCadence"][key]
                    for key in ("source", "kind", "bars", "anchor")
                },
                mandate["implementationPolicy"]["decisionPolicy"],
            )
            jsonschema.validate(
                portfolio_projection,
                PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA,
            )

            self.assertEqual(
                rl_run.result["metrics"]["configuration"]["costBps"],
                17.5,
            )
            self.assertEqual(
                rl_run.result["metrics"]["configuration"][
                    "noTradeOneWay"
                ],
                0.04,
            )
            self.assertEqual(
                rl_run.result["metrics"]["configuration"][
                    "decisionSchedule"
                ],
                mandate["implementationPolicy"]["decisionPolicy"],
            )
            action_rows = pd.read_csv(
                rl_run.root_dir / "artifacts" / "policy-actions.csv"
            )
            for _, group in action_rows.groupby(
                ["fold", "seed", "split"],
                sort=False,
            ):
                previous_action = "balanced"
                for _, row in group.iterrows():
                    decision_date = str(row["timestamp"])[:10]
                    expected_eligible = (
                        source_positions[decision_date] % 4 == 0
                    )
                    self.assertEqual(
                        bool(row["decision_eligible"]),
                        expected_eligible,
                    )
                    self.assertEqual(
                        int(row["decision_every_bars"]),
                        4,
                    )
                    self.assertEqual(
                        row["decision_anchor"],
                        "dataset-start",
                    )
                    self.assertEqual(
                        row["decision_schedule_kind"],
                        "every-bars",
                    )
                    self.assertEqual(row["decision_session"], "dataset")
                    if not expected_eligible:
                        self.assertEqual(
                            row["action"],
                            previous_action,
                        )
                        risk_override = bool(
                            row["risk_rebalance_override"]
                        )
                        constraint_override = bool(
                            row["constraint_rebalance_override"]
                        )
                        expected_reason = (
                            "mandate_and_risk_override"
                            if risk_override and constraint_override
                            else "risk_ceiling_override"
                            if risk_override
                            else "mandate_constraint_override"
                            if constraint_override
                            else "decision_schedule_hold"
                        )
                        self.assertEqual(
                            row["execution_reason"],
                            expected_reason,
                        )
                        if not risk_override and not constraint_override:
                            self.assertAlmostEqual(
                                float(row["one_way_turnover"]),
                                0.0,
                            )
                    previous_action = row["action"]
            rl_projection = load_rl_diagnostics(
                project,
                rl_run.result["id"],
            )
            self.assertEqual(
                rl_projection["portfolioMandate"][
                    "implementationPolicy"
                ],
                mandate["implementationPolicy"],
            )
            self.assertEqual(
                rl_projection["portfolioMandate"][
                    "assetMaxAbsWeights"
                ],
                mandate["construction"]["assetMaxAbsWeights"],
            )
            self.assertEqual(
                rl_projection["portfolioMandate"]["benchmark"],
                mandate["construction"]["benchmark"],
            )
            self.assertEqual(
                {
                    key: rl_projection["decisionCadence"][key]
                    for key in ("source", "kind", "bars", "anchor")
                },
                mandate["implementationPolicy"]["decisionPolicy"],
            )
            for audit in rl_run.result["metrics"][
                "constraint_audit"
            ].values():
                self.assertTrue(audit["passed"])
                self.assertEqual(
                    audit["asset_max_abs_weights"],
                    mandate["construction"]["assetMaxAbsWeights"],
                )
            jsonschema.validate(
                rl_projection,
                RL_DIAGNOSTICS_JSON_SCHEMA,
            )
            studio_snapshot = build_studio_snapshot(project.root_dir)
            portfolio_summary = next(
                item
                for item in studio_snapshot["projects"][0]["runs"]
                if item["id"] == portfolio_run.result["id"]
            )
            self.assertEqual(
                portfolio_summary["metricLayers"]["mandate"]["benchmark"],
                mandate["construction"]["benchmark"],
            )
            self.assertEqual(
                portfolio_summary["metricLayers"]["decisionCadence"],
                mandate["implementationPolicy"]["decisionPolicy"],
            )

            delegated_request = load_research_request(
                project.root_dir / "request.json"
            )
            session = start_session(
                project,
                PORTFOLIO_STUDY_ID,
                request=delegated_request,
            )
            baseline_id = session.manifest["baseline"]["runId"]
            evidence_ref = {
                "kind": "run",
                "id": baseline_id,
                "artifactPath": "artifacts/portfolio-report.json",
            }
            report = publish_report(
                project,
                session.manifest["id"],
                {
                    "schemaVersion": 1,
                    "kind": "autoquant-research-report-analysis",
                    "title": "AAPL and MSFT versus SPY",
                    "executiveSummary": (
                        "The fixed research book is evaluated against SPY "
                        "without granting SPY position authority."
                    ),
                    "findings": [
                        {
                            "id": "caller-benchmark",
                            "claim": "SPY is the fixed opportunity-cost reference.",
                            "confidence": "high",
                            "evidenceRefs": [evidence_ref],
                        }
                    ],
                    "recommendations": [
                        {
                            "action": "Review relative and absolute evidence.",
                            "rationale": "The benchmark changes evaluation only.",
                            "conditions": ["No trading authority is implied."],
                            "evidenceRefs": [evidence_ref],
                        }
                    ],
                    "limitations": ["Synthetic deterministic fixture."],
                    "unresolvedQuestions": ["Does the edge survive new data?"],
                },
            )
            report_markdown = (
                report.root_dir / "report.md"
            ).read_text(encoding="utf-8")
            self.assertIn("`SPY long`", report_markdown)
            self.assertIn(
                "`caller-supplied` / evaluation-only",
                report_markdown,
            )
            self.assertIn(
                "Authorized positions: `AAPL`, `MSFT`",
                report_markdown,
            )
            self.assertIn(
                "Context-only research assets: `NVDA`, `QQQ`, `SPY`",
                report_markdown,
            )
            self.assertIn(
                "Decision schedule / source: "
                "`every 4 base bars / dataset-start` / `caller-supplied`",
                report_markdown,
            )
            self.assertIn(
                "only mandatory risk scale-down may trade",
                report_markdown,
            )

    def test_caller_asset_roles_are_shared_by_portfolio_and_rl(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            roles = {
                "AAPL": "long-only",
                "MSFT": "long-only",
                "SPY": "short-only",
                "QQQ": "context-only",
            }
            policy = {
                "grossLimit": 0.8,
                "maxAbsWeight": 0.2,
                "assetMaxAbsWeights": {"SPY": 0.15},
                "annualizedVolatilityCeiling": 0.2,
                "baseCostBps": 12.0,
                "noTradeOneWay": 0.0,
                "referenceNav": 500_000.0,
                "decisionSchedule": {
                    "kind": "every-bars",
                    "bars": 1,
                    "anchor": "dataset-start",
                },
            }
            request_path, package_path = write_intake_inputs(
                root,
                request_assets=tuple(roles),
                asset_position_roles=roles,
                portfolio_policy=policy,
            )
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["direction"] = "relative-value"
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "asset-role-desk",
                template=prepared.template,
                template_intake=prepared,
            )
            mandate = load_portfolio_mandate(
                project.root_dir / PORTFOLIO_MANDATE
            )
            self.assertEqual(
                mandate["source"]["assetPositionRoles"],
                "caller-supplied",
            )
            self.assertEqual(mandate["construction"]["family"], "asset-role")
            self.assertEqual(
                mandate["construction"]["assetPositionRoles"],
                {
                    **roles,
                    "NVDA": "context-only",
                },
            )
            self.assertEqual(mandate["construction"]["longGrossLimit"], 0.4)
            self.assertEqual(mandate["construction"]["shortGrossLimit"], 0.4)

            portfolio_run = execute_study(project, PORTFOLIO_STUDY_ID)
            rl_run = execute_study(project, RL_STUDY_ID)
            for run in (portfolio_run, rl_run):
                self.assertEqual(
                    run.result["status"],
                    "succeeded",
                    run.result["errors"],
                )
                self.assertEqual(
                    run.result["metrics"]["portfolio_mandate"],
                    mandate,
                )
            decisions = pd.read_csv(
                portfolio_run.root_dir
                / "artifacts"
                / "portfolio-decisions.csv"
            )
            self.assertTrue(
                (
                    decisions.loc[
                        decisions["asset"].isin(["AAPL", "MSFT"]),
                        "proposed_target_weight",
                    ]
                    >= -1e-12
                ).all()
            )
            self.assertTrue(
                (
                    decisions.loc[
                        decisions["asset"] == "SPY",
                        "proposed_target_weight",
                    ]
                    <= 1e-12
                ).all()
            )
            self.assertTrue(
                (
                    decisions.loc[
                        decisions["asset"].isin(["QQQ", "NVDA"]),
                        "proposed_target_weight",
                    ].abs()
                    <= 1e-12
                ).all()
            )
            projection = load_portfolio_diagnostics(
                project,
                portfolio_run.result["id"],
            )
            self.assertEqual(
                projection["mandate"]["assetPositionRoles"],
                mandate["construction"]["assetPositionRoles"],
            )
            self.assertEqual(
                projection["mandate"]["positionRolesSource"],
                "caller-supplied",
            )
            self.assertEqual(
                {
                    item["asset"]: item["positionRole"]
                    for item in projection["mechanicalDecision"]["positions"]
                },
                mandate["construction"]["assetPositionRoles"],
            )
            jsonschema.validate(
                projection,
                PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA,
            )
            rl_projection = load_rl_diagnostics(
                project,
                rl_run.result["id"],
            )
            self.assertEqual(
                rl_projection["portfolioMandate"][
                    "assetPositionRoles"
                ],
                mandate["construction"]["assetPositionRoles"],
            )
            self.assertEqual(
                rl_projection["portfolioMandate"][
                    "positionRolesSource"
                ],
                "caller-supplied",
            )
            for audit in rl_run.result["metrics"][
                "constraint_audit"
            ].values():
                self.assertTrue(audit["passed"])
                self.assertEqual(
                    audit["asset_position_roles"],
                    mandate["construction"]["assetPositionRoles"],
                )
            studio = build_studio_snapshot(project.root_dir)
            observed = {
                item["id"]: item
                for item in studio["projects"][0]["runs"]
            }
            for run in (portfolio_run, rl_run):
                layer = observed[run.result["id"]]["metricLayers"][
                    "mandate"
                ]
                self.assertEqual(
                    layer["assetPositionRoles"],
                    mandate["construction"]["assetPositionRoles"],
                )
                self.assertEqual(
                    layer["positionRolesSource"],
                    "caller-supplied",
                )

    def test_v3_continuous_base_interval_is_configurable_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_configurable_continuous_inputs(
                root,
                horizon_policy={
                    "primaryForwardBars": 5,
                    "diagnosticForwardBars": [1, 5, 10],
                },
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            self.assertEqual(prepared.package["baseInterval"], "15m")
            self.assertEqual(prepared.annualization_periods, 365 * 24 * 4)
            self.assertEqual(
                prepared.interval_surface,
                {
                    "baseInterval": "15m",
                    "featureIntervals": ["30m", "1h", "4h"],
                    "timestampSemantics": "bar-close",
                    "marketClock": "continuous",
                    "calendar": "24/7",
                    "timezone": "UTC",
                    "anchor": "00:00",
                    "aggregationMethod": (
                        "complete-continuous-utc-midnight-bar-close-v2"
                    ),
                    "terminalBucketPolicy": "omit-incomplete",
                },
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "fifteen-minute-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            self.assertEqual(
                run.result["dataset"]["intervalSurface"],
                prepared.interval_surface,
            )
            self.assertEqual(
                run.result["metrics"]["research_horizon"][
                    "primaryForwardBars"
                ],
                5,
            )
            jsonschema.validate(run.result, RUN_RESULT_JSON_SCHEMA)

    def test_calendar_month_end_requires_daily_xnys_input(self) -> None:
        policy = {
            "grossLimit": 0.8,
            "maxAbsWeight": 0.3,
            "assetMaxAbsWeights": {},
            "annualizedVolatilityCeiling": 0.20,
            "baseCostBps": 12.0,
            "noTradeOneWay": 0.0,
            "referenceNav": 500_000.0,
            "decisionSchedule": {"kind": "calendar-month-end"},
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                portfolio_policy=policy,
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "calendar-month-end",
                template=prepared.template,
                template_intake=prepared,
            )
            mandate = load_portfolio_mandate(
                project.root_dir / PORTFOLIO_MANDATE
            )
            self.assertEqual(
                mandate["implementationPolicy"]["decisionPolicy"],
                {
                    "source": "caller-supplied",
                    "kind": "calendar-month-end",
                },
            )

        with tempfile.TemporaryDirectory() as directory:
            request_path, package_path = write_configurable_continuous_inputs(
                Path(directory)
            )
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["portfolioPolicy"] = policy
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "calendar-month-end requires a V1 daily XNYS",
            ):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-research-desk",
                )

    def test_session_start_anchor_requires_xnys_intraday_input(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            request_path, package_path = write_configurable_continuous_inputs(
                Path(directory)
            )
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["portfolioPolicy"] = {
                "grossLimit": 0.8,
                "maxAbsWeight": 0.3,
                "assetMaxAbsWeights": {},
                "annualizedVolatilityCeiling": 0.20,
                "baseCostBps": 12.0,
                "noTradeOneWay": 0.0,
                "referenceNav": 500_000.0,
                "decisionSchedule": {
                    "kind": "every-bars",
                    "bars": 4,
                    "anchor": "session-start",
                },
            }
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "session-start requires a V3 intraday XNYS",
            ):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-research-desk",
                )

    def test_v3_xnys_session_surface_runs_across_research_desk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_session_interval_inputs(root)
            package = json.loads(package_path.read_text(encoding="utf-8"))
            jsonschema.Draft202012Validator(
                OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
                format_checker=jsonschema.FormatChecker(),
            ).validate(package)
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            self.assertEqual(prepared.package["schemaVersion"], 3)
            self.assertEqual(prepared.annualization_periods, 252 * 7)
            self.assertEqual(
                prepared.interval_surface,
                {
                    "baseInterval": "1h",
                    "featureIntervals": ["3h", "1d"],
                    "timestampSemantics": "bar-close",
                    "marketClock": "session",
                    "calendar": "XNYS",
                    "timezone": "America/New_York",
                    "anchor": "market-open",
                    "aggregationMethod": (
                        "complete-xnys-regular-session-bar-close-v1"
                    ),
                    "terminalBucketPolicy": "complete-at-session-close",
                },
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "xnys-research-desk",
                template=prepared.template,
                template_intake=prepared,
            )
            self.assertIn(
                'AVAILABLE_FEATURE_INTERVALS = ["3h", "1d"]',
                (
                    project.root_dir / "factors" / "candidate.py"
                ).read_text(encoding="utf-8"),
            )
            intake = load_project_intake(project)
            self.assertIsNotNone(intake)
            mandate = load_portfolio_mandate(
                project.root_dir / PORTFOLIO_MANDATE
            )
            self.assertEqual(
                mandate["construction"]["riskPolicy"][
                    "annualizationPeriods"
                ],
                252 * 7,
            )
            runs = [
                execute_study(project, study_id)
                for study_id in (
                    OHLCV_STUDY_ID,
                    PORTFOLIO_STUDY_ID,
                    RL_STUDY_ID,
                )
            ]
            for run in runs:
                self.assertEqual(
                    run.result["status"],
                    "succeeded",
                    run.result["errors"],
                )
                self.assertEqual(
                    run.result["dataset"]["intervalSurface"],
                    prepared.interval_surface,
                )
                jsonschema.validate(run.result, RUN_RESULT_JSON_SCHEMA)
            self.assertEqual(
                [
                    item["id"]
                    for item in runs[0].result["metrics"][
                        "factor_components"
                    ]["declaration"]["components"]
                ],
                [
                    "base_momentum_10",
                    "momentum_3h_4",
                    "momentum_1d_3",
                ],
            )
            self.assertEqual(
                runs[1].result["metrics"]["portfolio"]["validation"]["net"][
                    "annualization_periods"
                ],
                252 * 7,
            )
            observed = build_studio_snapshot(root / "workspace")[
                "projects"
            ][0]
            self.assertTrue(observed["valid"], observed["diagnostics"])
            self.assertEqual(
                observed["intake"]["dataset"]["intervalSurface"],
                prepared.interval_surface,
            )

    def test_v3_xnys_fifteen_minute_caller_cadence_governs_portfolio_and_rl(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy = {
                "grossLimit": 0.8,
                "maxAbsWeight": 0.3,
                "assetMaxAbsWeights": {},
                "annualizedVolatilityCeiling": 0.20,
                "baseCostBps": 12.0,
                "noTradeOneWay": 0.0,
                "referenceNav": 500_000.0,
                "decisionSchedule": {
                    "kind": "every-bars",
                    "bars": 4,
                    "anchor": "session-start",
                },
            }
            request_path, package_path = write_session_interval_inputs(
                root,
                sessions=20,
                base_interval="15m",
                calendar_start="2026-11-09",
                portfolio_policy=policy,
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            self.assertEqual(
                prepared.interval_surface,
                {
                    "baseInterval": "15m",
                    "featureIntervals": ["1h", "3h", "1d"],
                    "timestampSemantics": "bar-close",
                    "marketClock": "session",
                    "calendar": "XNYS",
                    "timezone": "America/New_York",
                    "anchor": "market-open",
                    "aggregationMethod": (
                        "complete-xnys-regular-session-bar-close-v1"
                    ),
                    "terminalBucketPolicy": "complete-at-session-close",
                },
            )
            self.assertEqual(prepared.annualization_periods, 252 * 26)
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "xnys-fifteen-minute-cadence",
                template=prepared.template,
                template_intake=prepared,
            )
            mandate = load_portfolio_mandate(
                project.root_dir / PORTFOLIO_MANDATE
            )
            self.assertEqual(
                mandate["implementationPolicy"]["decisionPolicy"]["bars"],
                4,
            )
            portfolio_run = execute_study(project, PORTFOLIO_STUDY_ID)
            rl_run = execute_study(project, RL_STUDY_ID)
            for run in (portfolio_run, rl_run):
                self.assertEqual(
                    run.result["status"],
                    "succeeded",
                    run.result["errors"],
                )
                self.assertEqual(
                    run.result["dataset"]["intervalSurface"],
                    prepared.interval_surface,
                )
                self.assertEqual(
                    run.result["metrics"]["portfolio_mandate"],
                    mandate,
                )
                jsonschema.validate(run.result, RUN_RESULT_JSON_SCHEMA)

            source = pd.read_csv(
                package_path.parent / "AAPL.csv"
            )
            source["session"] = pd.to_datetime(
                source["timestamp"],
                utc=True,
            ).dt.strftime("%Y-%m-%d")
            source["session_ordinal"] = source.groupby(
                "session",
                sort=False,
            ).cumcount()
            source_positions = dict(
                zip(
                    source["timestamp"],
                    source["session_ordinal"],
                    strict=True,
                )
            )
            daily = pd.read_csv(
                portfolio_run.root_dir
                / "artifacts"
                / "daily-portfolio.csv"
            )
            for _, row in daily.iterrows():
                timestamp = str(row["timestamp"]).replace("+00:00", "Z")
                expected_eligible = (
                    source_positions[timestamp] % 4 == 0
                )
                self.assertEqual(
                    bool(row["decision_eligible"]),
                    expected_eligible,
                )
                self.assertEqual(row["decision_anchor"], "session-start")
                self.assertEqual(
                    row["decision_session"],
                    timestamp[:10],
                )
                if not expected_eligible:
                    self.assertFalse(bool(row["ordinary_rebalance"]))
                    self.assertTrue(
                        abs(float(row["traded_notional"])) <= 1e-12
                        or bool(row["risk_rebalance_override"])
                        or bool(row["constraint_rebalance_override"])
                    )
            portfolio_projection = load_portfolio_diagnostics(
                project,
                portfolio_run.result["id"],
            )
            rl_projection = load_rl_diagnostics(
                project,
                rl_run.result["id"],
            )
            self.assertEqual(
                portfolio_projection["mandate"][
                    "implementationPolicy"
                ]["decisionPolicy"]["bars"],
                4,
            )
            self.assertEqual(
                portfolio_projection["decisionCadence"]["eligibleBars"],
                int(daily["decision_eligible"].sum()),
            )
            self.assertEqual(
                rl_projection["portfolioMandate"][
                    "implementationPolicy"
                ]["decisionPolicy"]["bars"],
                4,
            )
            self.assertEqual(rl_projection["decisionCadence"]["bars"], 4)
            action_rows = pd.read_csv(
                rl_run.root_dir / "artifacts" / "policy-actions.csv"
            )
            for _, row in action_rows.iterrows():
                timestamp = str(row["timestamp"]).replace("+00:00", "Z")
                self.assertEqual(
                    bool(row["decision_eligible"]),
                    source_positions[timestamp] % 4 == 0,
                )
                self.assertEqual(row["decision_anchor"], "session-start")
                self.assertEqual(row["decision_session"], timestamp[:10])
            first_source_rows = source.groupby(
                "session",
                sort=False,
            ).head(1)
            first_timestamps = set(first_source_rows["timestamp"])
            observed_portfolio = {
                str(row["timestamp"]).replace("+00:00", "Z")
                for _, row in daily[
                    daily["decision_eligible"]
                ].iterrows()
            }
            self.assertTrue(
                first_timestamps - {source.iloc[-1]["timestamp"]}
                <= observed_portfolio
            )
            jsonschema.validate(
                portfolio_projection,
                PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA,
            )
            jsonschema.validate(
                rl_projection,
                RL_DIAGNOSTICS_JSON_SCHEMA,
            )

    def test_v2_multi_interval_package_prepares_complete_locked_surface(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            request_path, package_path = write_multi_interval_inputs(
                Path(directory)
            )
            jsonschema.Draft202012Validator(
                OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
                format_checker=jsonschema.FormatChecker(),
            ).validate(json.loads(package_path.read_text(encoding="utf-8")))
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            self.assertTrue(prepared.multi_interval)
            self.assertEqual(
                prepared.interval_surface,
                {
                    "baseInterval": "1h",
                    "featureIntervals": ["3h", "4h", "6h", "12h", "1d"],
                    "timestampSemantics": "bar-close",
                    "marketClock": "continuous",
                    "timezone": "UTC",
                    "anchor": "00:00",
                    "aggregationMethod": "complete-utc-midnight-bar-close-v1",
                },
            )
            self.assertEqual(prepared.start, "2026-01-01T01:00:00Z")
            self.assertEqual(prepared.end, "2026-01-13T00:00:00Z")
            first = prepared.assets[0]
            self.assertIsNotNone(first.interval_frames)
            assert first.interval_frames is not None
            self.assertEqual(
                list(first.interval_frames),
                ["1h", "3h", "4h", "6h", "12h", "1d"],
            )
            self.assertEqual(len(first.interval_frames["1h"]), 288)
            self.assertEqual(len(first.interval_frames["1d"]), 12)
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(workspace.root_dir, "hourly-lock")
            snapshot, snapshot_hash = materialize_intake_dataset(
                project,
                prepared,
                OHLCV_STUDY_ID,
            )
            self.assertEqual(snapshot["schemaVersion"], 2)
            self.assertEqual(
                snapshot["intervalSurface"],
                prepared.interval_surface,
            )
            self.assertEqual(len(snapshot_hash), 64)
            self.assertEqual(
                [item["interval"] for item in snapshot["assets"][0]["intervals"]],
                ["1h", "3h", "4h", "6h", "12h", "1d"],
            )
            self.assertTrue(
                (project.root_dir / "data" / "ohlcv" / "1d" / "BTC.csv").is_file()
            )
            aligned = load_multi_interval_asset(
                project.root_dir / "data",
                "BTC",
                start=prepared.start,
                end=prepared.end,
            )
            self.assertIsNotNone(aligned)
            assert aligned is not None
            self.assertIn("close__1d", aligned.columns)
            self.assertLessEqual(
                aligned["bar_close__1d"].dropna().max(),
                aligned["timestamp"].max(),
            )

    def test_v2_rehashed_derived_bar_cannot_bypass_reconciliation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_multi_interval_inputs(root)
            workspace = initialize_workspace(root / "workspace")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                workspace.root_dir,
                "tampered-multi-interval",
                template=prepared.template,
                template_intake=prepared,
            )
            data_path = project.root_dir / "data" / "ohlcv" / "12h" / "BTC.csv"
            frame = pd.read_csv(data_path)
            frame.loc[0, "close"] *= 1.01
            frame.to_csv(
                data_path,
                index=False,
                lineterminator="\n",
                float_format="%.12g",
            )

            snapshot_path = project.root_dir / "data" / "ohlcv" / "snapshot.json"
            snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
            btc = next(
                item for item in snapshot["assets"] if item["symbol"] == "BTC"
            )
            row = next(
                item for item in btc["intervals"] if item["interval"] == "12h"
            )
            row["normalizedHash"] = hash_file(data_path)
            snapshot_path.write_text(
                json.dumps(snapshot, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            study = load_study(project, OHLCV_STUDY_ID)
            intake_path = project.root_dir / "intake.json"
            intake = json.loads(intake_path.read_text(encoding="utf-8"))
            intake.update(
                {
                    "datasetSnapshotHash": hash_file(snapshot_path),
                    "datasetHash": study.dataset_hash,
                    "studyHash": study.study_hash,
                    "studyInputHash": study.input_hash,
                }
            )
            intake_path.write_text(
                json.dumps(intake, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "does not reconcile to 1h bars",
            ):
                load_project_intake(project)

    def test_v2_research_desk_runs_one_shared_surface_across_all_lanes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_multi_interval_inputs(
                root,
                observations=420,
            )
            request_payload = json.loads(
                request_path.read_text(encoding="utf-8")
            )
            benchmark_assets = [
                asset["symbol"] for asset in request_payload["assets"]
            ]
            request_payload["benchmarkPolicy"] = {
                "kind": "fixed-weights",
                "weights": {
                    asset: 1.0 / len(benchmark_assets)
                    for asset in benchmark_assets
                },
            }
            request_path.write_text(
                json.dumps(request_payload, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            workspace = initialize_workspace(root / "workspace")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                workspace.root_dir,
                "multi-interval-desk",
                template=prepared.template,
                template_intake=prepared,
            )

            intake = load_project_intake(project)
            self.assertIsNotNone(intake)
            mandate = load_portfolio_mandate(
                project.root_dir / PORTFOLIO_MANDATE
            )
            self.assertEqual(
                mandate["construction"]["riskPolicy"][
                    "annualizationPeriods"
                ],
                24 * 365,
            )
            self.assertEqual(
                mandate["construction"]["benchmark"]["kind"],
                "fixed-weights",
            )
            self.assertEqual(
                mandate["construction"]["benchmark"]["source"],
                "caller-supplied",
            )
            session = start_session(
                project,
                OHLCV_STUDY_ID,
                request=load_research_request(
                    project.root_dir / "request.json"
                ),
            )
            candidate_path = (
                session.worktree_project.root_dir
                / "factors"
                / "candidate.py"
            )
            candidate_path.write_text(
                candidate_path.read_text(encoding="utf-8")
                + "\n# bounded V2 preflight candidate\n",
                encoding="utf-8",
            )
            preflight = execute_candidate_check(
                project,
                session.manifest["id"],
            )
            self.assertEqual(preflight.result["status"], "passed")

            runs = [
                execute_study(project, study_id)
                for study_id in (
                    OHLCV_STUDY_ID,
                    PORTFOLIO_STUDY_ID,
                    RL_STUDY_ID,
                )
            ]
            expected_surface = prepared.interval_surface
            self.assertIsNotNone(expected_surface)
            for run in runs:
                self.assertEqual(
                    run.result["status"],
                    "succeeded",
                    run.result["errors"],
                )
                self.assertEqual(
                    run.result["dataset"]["intervalSurface"],
                    expected_surface,
                )
                jsonschema.validate(run.result, RUN_RESULT_JSON_SCHEMA)
            factor_run = runs[0]
            factor_components = factor_run.result["metrics"][
                "factor_components"
            ]
            self.assertEqual(
                factor_components["trial_disclosure"],
                {
                    "materialized_components": 4,
                    "cross_sectional_score_components": 4,
                    "timestamp_context_components": 0,
                    "pairwise_comparisons": 6,
                    "component_diagnostics_enter_promotion_score": False,
                },
            )
            self.assertEqual(
                [
                    item["id"]
                    for item in factor_components["declaration"][
                        "components"
                    ]
                ],
                [
                    "base_momentum_10",
                    "momentum_3h_4",
                    "momentum_12h_2",
                    "momentum_1d_3",
                ],
            )
            factor_projection = load_factor_diagnostics(
                project,
                factor_run.result["id"],
                point_limit=40,
            )["factorComponents"]
            self.assertTrue(factor_projection["available"])
            self.assertEqual(
                factor_projection["semantics"]["ablationTarget"],
                "fixed-diagnostic-blend-not-candidate-factor",
            )
            self.assertFalse(
                factor_projection["trialDisclosure"][
                    "entersPromotionScore"
                ]
            )
            self.assertEqual(
                {run.result["dataset"]["hash"] for run in runs},
                {runs[0].result["dataset"]["hash"]},
            )
            self.assertEqual(
                runs[1].result["metrics"]["portfolio"]["validation"]["net"][
                    "annualization_periods"
                ],
                24 * 365,
            )
            self.assertEqual(
                runs[2].result["metrics"]["portfolio_mandate"]["construction"][
                    "riskPolicy"
                ]["annualizationPeriods"],
                24 * 365,
            )
            factor_diagnostics = load_factor_diagnostics(
                project,
                runs[0].result["id"],
            )
            portfolio_diagnostics = load_portfolio_diagnostics(
                project,
                runs[1].result["id"],
            )
            rl_diagnostics = load_rl_diagnostics(
                project,
                runs[2].result["id"],
            )
            self.assertTrue(
                factor_diagnostics["protocol"]["splits"]["splits"][
                    "validation"
                ]["end"].endswith("Z")
            )
            self.assertTrue(
                portfolio_diagnostics["currentBook"]["timestamp"].endswith(
                    "Z"
                )
            )
            self.assertEqual(
                rl_diagnostics["portfolioMandate"]["riskPolicy"][
                    "annualizationPeriods"
                ],
                24 * 365,
            )
            studio = build_studio_snapshot(workspace.root_dir)
            observed = studio["projects"][0]
            self.assertTrue(observed["valid"], observed["diagnostics"])
            self.assertEqual(observed["diagnostics"], [])
            self.assertEqual(
                observed["intake"]["dataset"]["intervalSurface"],
                expected_surface,
            )

    def test_v2_rejects_forming_semantics_clock_and_hourly_gaps(self) -> None:
        for mutate, expected in (
            (
                lambda package: package.update(
                    {"timestampSemantics": "bar-open"}
                ),
                "must mean bar-close",
            ),
            (
                lambda package: package["market"].update(
                    {"clock": "session"}
                ),
                "continuous 24/7 UTC",
            ),
        ):
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as directory:
                request_path, package_path = write_multi_interval_inputs(
                    Path(directory)
                )
                package = json.loads(package_path.read_text(encoding="utf-8"))
                mutate(package)
                package_path.write_text(json.dumps(package), encoding="utf-8")
                with self.assertRaisesRegex(AutoQuantValidationError, expected):
                    prepare_project_intake(
                        request_path,
                        package_path,
                        "ohlcv-factor-lab",
                    )

        with tempfile.TemporaryDirectory() as directory:
            request_path, package_path = write_multi_interval_inputs(Path(directory))
            package = json.loads(package_path.read_text(encoding="utf-8"))
            source = package_path.parent / package["assets"][0]["path"]
            frame = pd.read_csv(source).drop(index=10)
            frame.to_csv(source, index=False)
            with self.assertRaisesRegex(AutoQuantValidationError, "without gaps"):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-factor-lab",
                )

    def test_portfolio_intake_locks_request_data_study_and_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(root / "workspace", name="Quant Desk")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-portfolio-lab",
            )
            project = create_project(
                workspace.root_dir,
                "us-leadership",
                name=prepared.request["title"],
                description=prepared.request["question"],
                template=prepared.template,
                template_intake=prepared,
            )

            intake = load_project_intake(project)
            self.assertIsNotNone(intake)
            assert intake is not None
            self.assertEqual(intake["manifest"]["status"], "ready-for-session")
            self.assertEqual(intake["study"]["id"], PORTFOLIO_STUDY_ID)
            self.assertEqual(
                intake["dataset"]["requestedAssets"],
                ["AAPL", "MSFT"],
            )
            self.assertEqual(len(intake["dataset"]["universe"]), 5)
            self.assertEqual(
                intake["dataset"]["provider"]["name"],
                "deterministic-test-provider",
            )
            self.assertEqual(
                intake["dataset"]["priceAdjustment"],
                "provider-adjusted",
            )
            for asset in intake["dataset"]["assets"]:
                source = package_path.parent / asset["sourcePath"]
                normalized = (
                    project.root_dir
                    / project.manifest.directories["data"]
                    / asset["normalizedPath"]
                )
                self.assertEqual(asset["sourceHash"], hash_file(source))
                self.assertEqual(asset["normalizedHash"], hash_file(normalized))
            study = load_study(project, PORTFOLIO_STUDY_ID)
            mandate = load_portfolio_mandate(
                project.root_dir / PORTFOLIO_MANDATE
            )
            self.assertEqual(mandate["source"]["direction"], "long")
            self.assertEqual(mandate["tradableAssets"], ["AAPL", "MSFT"])
            self.assertEqual(
                mandate["contextAssets"],
                ["NVDA", "QQQ", "SPY"],
            )
            self.assertEqual(
                study.definition.dependencies,
                {
                    "paths": [
                        FACTOR_CLAIM,
                        FACTOR_POPULATION,
                        PORTFOLIO_MANDATE,
                        RESEARCH_HORIZON,
                    ]
                },
            )
            self.assertEqual(study.definition.dataset.universe, intake["dataset"]["universe"])
            self.assertEqual(
                study.definition.dataset.time_range.start,
                intake["dataset"]["timeRange"]["start"],
            )
            self.assertEqual(len(study.dataset_hashes), 7)

            snapshot = build_studio_snapshot(workspace.root_dir)
            observed = snapshot["projects"][0]
            self.assertEqual(
                observed["intake"]["request"]["title"],
                "US leadership durability",
            )
            self.assertEqual(
                observed["intake"]["commands"][0]["id"],
                "session.start",
            )
            self.assertEqual(observed["counts"]["sessions"], 0)

            run = execute_study(project, PORTFOLIO_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            self.assertEqual(
                run.result["dataset"]["universe"],
                list(prepared.universe),
            )
            self.assertEqual(
                run.result["metrics"]["portfolio_mandate"],
                mandate,
            )
            diagnostics = load_portfolio_diagnostics(
                project,
                run.result["id"],
            )
            self.assertEqual(diagnostics["mandate"]["direction"], "long")
            self.assertEqual(
                diagnostics["mandate"]["tradableAssets"],
                ["AAPL", "MSFT"],
            )
            decision = diagnostics["mechanicalDecision"]
            self.assertEqual(decision["signalGate"]["family"], "long-cash")
            sizing = diagnostics["sizingAnatomy"]
            self.assertEqual(
                sizing["construction"]["family"],
                "long-cash",
            )
            self.assertEqual(sizing["sides"][1]["configuredBudget"], 0.0)
            self.assertTrue(sizing["sides"][1]["allocationFeasible"])
            self.assertTrue(
                all(
                    position["side"] == "context"
                    for position in sizing["positions"]
                    if not position["tradable"]
                )
            )
            monetization = diagnostics["signalMonetization"]
            self.assertTrue(
                monetization["validation"]["reconciliation"]["passed"]
            )
            monetization_assets = {
                item["asset"]: item
                for item in monetization["validation"]["byAsset"]
            }
            for asset in ("NVDA", "QQQ", "SPY"):
                self.assertEqual(
                    monetization_assets[asset]["equalIntent"],
                    0.0,
                )
                self.assertEqual(
                    monetization_assets[asset]["preGovernorSizing"],
                    0.0,
                )
                self.assertEqual(
                    monetization_assets[asset]["governedTarget"],
                    0.0,
                )
            self.assertEqual(
                monetization["validation"]["reconciliation"][
                    "maximumEqualIntentGrossLimitExcess"
                ],
                0.0,
            )
            self.assertEqual(
                monetization["validation"]["reconciliation"][
                    "maximumEqualIntentCapExcess"
                ],
                0.0,
            )
            self.assertEqual(decision["tradingAuthority"], "none")
            decision_by_asset = {
                item["asset"]: item for item in decision["positions"]
            }
            for asset in ("AAPL", "MSFT"):
                position = decision_by_asset[asset]
                self.assertIn(position["signalState"], {0, 1})
                self.assertEqual(len(position["nextTriggers"]), 1)
                self.assertIn(
                    position["nextTriggers"][0]["event"],
                    {"enter_long", "exit_long"},
                )
            for position in diagnostics["currentBook"]["positions"]:
                if position["asset"] in {"NVDA", "QQQ", "SPY"}:
                    self.assertFalse(position["tradable"])
                    self.assertEqual(position["targetWeight"], 0.0)
                    self.assertEqual(position["allocationStatus"], "context_only")
                    decision_position = decision_by_asset[
                        position["asset"]
                    ]
                    self.assertEqual(
                        decision_position["nextTriggers"],
                        [],
                    )
                    self.assertIsNone(
                        decision_position["nearestTrigger"]
                    )
            session = start_session(
                project,
                PORTFOLIO_STUDY_ID,
                request=load_research_request(project.root_dir / "request.json"),
            )
            self.assertIsNotNone(session.delegation)
            self.assertEqual(
                session.delegation["request"]["assets"][0]["symbol"],
                "AAPL",
            )

    def test_factor_and_rl_templates_run_on_the_same_intake_contract(self) -> None:
        for template, study_id in (
            ("ohlcv-factor-lab", OHLCV_STUDY_ID),
            ("ohlcv-rl-factor-lab", RL_STUDY_ID),
        ):
            with self.subTest(template=template), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                request_path, package_path = write_intake_inputs(root)
                workspace = initialize_workspace(root / "workspace")
                prepared = prepare_project_intake(
                    request_path,
                    package_path,
                    template,
                )
                project = create_project(
                    workspace.root_dir,
                    "market-lab",
                    template=template,
                    template_intake=prepared,
                )

                run = execute_study(project, study_id)

                self.assertEqual(run.result["status"], "succeeded")
                self.assertEqual(
                    run.result["dataset"]["id"],
                    "bounded-us-equities",
                )

    def test_request_bound_mandate_tampering_invalidates_intake(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(root / "workspace")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                workspace.root_dir,
                "tamper-desk",
                template=prepared.template,
                template_intake=prepared,
            )
            mandate_path = project.root_dir / PORTFOLIO_MANDATE
            mandate = json.loads(mandate_path.read_text(encoding="utf-8"))
            mandate["tradableAssets"].append("NVDA")
            mandate_path.write_text(
                json.dumps(mandate, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Mandate id is not derived|differs from the normalized request",
            ):
                load_project_intake(project)

    def test_invalid_intakes_leave_workspace_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(root / "workspace")
            package = json.loads(package_path.read_text())
            package["assets"][-1]["path"] = "../outside.csv"
            package_path.write_text(json.dumps(package), encoding="utf-8")

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "confined POSIX relative path",
            ):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-portfolio-lab",
                )

            reloaded = load_workspace(workspace.root_dir)
            self.assertIsNone(reloaded.manifest.default_project)
            self.assertEqual(list(reloaded.projects_dir.iterdir()), [])

    def test_misalignment_and_request_mismatch_are_structured_failures(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            package = json.loads(package_path.read_text())
            package["assetClass"] = "fund"
            package_path.write_text(json.dumps(package), encoding="utf-8")

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "requested asset class",
            ):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-portfolio-lab",
                )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            package = json.loads(package_path.read_text())
            source = package_path.parent / package["assets"][-1]["path"]
            rows = source.read_text(encoding="utf-8").splitlines()
            source.write_text("\n".join(rows[:-1]) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "exact daily timestamp panel",
            ):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-portfolio-lab",
                )

    def test_v4_factor_intake_preserves_ragged_daily_availability(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                observations=260,
            )
            package = json.loads(
                package_path.read_text(encoding="utf-8")
            )
            package["schemaVersion"] = 4
            package["panelPolicy"] = {
                "alignment": "observed-only",
                "missingObservation": "absent-no-fill",
            }
            package_path.write_text(
                json.dumps(package, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            jsonschema.validate(
                package,
                OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
            )
            source = package_path.parent / package["assets"][-1]["path"]
            frame = pd.read_csv(source).drop(index=[0, 25, 100])
            frame.to_csv(source, index=False)

            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            self.assertEqual(prepared.start, "2024-01-02")
            self.assertEqual(prepared.end, "2024-12-30")
            self.assertEqual(len(prepared.assets[-1].frame), 257)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "supported only by the ohlcv-factor-lab",
            ):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-portfolio-lab",
                )

            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "ragged-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            self.assertIn(
                "AVAILABLE_FEATURE_INTERVALS = []",
                (
                    project.root_dir / "factors" / "candidate.py"
                ).read_text(encoding="utf-8"),
            )
            intake = load_project_intake(project)
            assert intake is not None
            availability = intake["dataset"]["availability"]
            self.assertEqual(availability["unionObservations"], 260)
            self.assertEqual(
                availability["intersectionObservations"],
                257,
            )
            self.assertEqual(
                availability["eligibleFactorObservations"],
                260,
            )
            self.assertEqual(
                availability["assetsPerTimestamp"],
                {"minimum": 4, "median": 5.0, "maximum": 5},
            )
            self.assertAlmostEqual(
                availability["observationCoverage"],
                1297 / 1300,
            )
            self.assertEqual(
                intake["dataset"]["assets"][-1]["start"],
                "2024-01-03",
            )
            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            self.assertEqual(
                run.result["metrics"]["factor_api"]["shape"],
                "ragged-observed-only",
            )
            self.assertAlmostEqual(
                run.result["metrics"]["input_availability"][
                    "observation_coverage"
                ],
                1297 / 1300,
            )
            diagnostics = load_factor_diagnostics(
                project,
                run.result["id"],
            )
            self.assertTrue(
                diagnostics["inputAvailability"]["available"]
            )
            self.assertEqual(
                diagnostics["inputAvailability"][
                    "assetsPerTimestamp"
                ]["input"],
                {"minimum": 4, "median": 5.0, "maximum": 5},
            )

    def test_v5_factor_intake_uses_target_observed_bar_clock(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_observed_intraday_inputs(root)
            package = json.loads(package_path.read_text(encoding="utf-8"))
            jsonschema.validate(
                package,
                OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
            )

            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            self.assertEqual(prepared.package["assetClass"], "mixed")
            self.assertEqual(len(prepared.assets), 2)
            self.assertEqual(len(prepared.assets[0].frame), 395)
            self.assertEqual(len(prepared.assets[1].frame), 420)
            self.assertGreater(prepared.annualization_periods, 252)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "supported only by the ohlcv-factor-lab",
            ):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-portfolio-lab",
                )

            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "observed-hourly-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            self.assertIn(
                "AVAILABLE_FEATURE_INTERVALS = []",
                (
                    project.root_dir / "factors" / "candidate.py"
                ).read_text(encoding="utf-8"),
            )
            intake = load_project_intake(project)
            assert intake is not None
            self.assertEqual(
                intake["dataset"]["schemaVersion"],
                5,
            )
            self.assertEqual(
                intake["dataset"]["availability"][
                    "eligibleFactorObservations"
                ],
                395,
            )
            self.assertEqual(
                intake["dataset"]["availability"][
                    "intersectionObservations"
                ],
                395,
            )
            self.assertEqual(
                intake["dataset"]["availability"]["unionObservations"],
                419,
            )

            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(
                run.result["status"],
                "succeeded",
                run.result["errors"],
            )
            metrics = run.result["metrics"]
            self.assertEqual(
                metrics["prediction_universe"]["evaluation_mode"],
                "single-asset-temporal",
            )
            self.assertEqual(
                metrics["input_availability"]["timestamps"],
                419,
            )
            self.assertEqual(
                metrics["input_availability"]["prediction_universe"][
                    "timeline_timestamps"
                ],
                395,
            )
            primary = metrics["split_protocol"]["horizons"]["24"]
            self.assertEqual(
                sum(
                    item["eligibleSignalRows"]
                    for item in primary.values()
                ),
                395 - (3 * 24),
            )
            session = start_session(
                project,
                OHLCV_STUDY_ID,
                request=json.loads(
                    request_path.read_text(encoding="utf-8")
                ),
            )
            self.assertEqual(
                session.manifest["studyId"],
                OHLCV_STUDY_ID,
            )

    def test_v5_daily_factor_preserves_cross_market_close_time_causality(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_cross_market_daily_inputs(root)
            package = json.loads(package_path.read_text(encoding="utf-8"))
            jsonschema.validate(package, OHLCV_DATASET_PACKAGE_JSON_SCHEMA)

            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            self.assertEqual(prepared.package["baseInterval"], "1d")
            self.assertEqual(prepared.interval_surface["baseInterval"], "1d")
            self.assertEqual(prepared.interval_surface["featureIntervals"], [])

            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "cross-market-daily-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            (project.root_dir / "factors" / "candidate.py").write_text(
                CROSS_MARKET_ASOF_FACTOR,
                encoding="utf-8",
            )
            contract = build_agent_work_brief(project)["candidateContract"]
            self.assertEqual(
                contract["data"]["observationSemantics"],
                {
                    "timestampMeaning": "completed-bar-close",
                    "panelShape": "ragged-observed-only",
                    "missingObservation": "absent-no-fill",
                    "contextVisibility": (
                        "Candidate code may use only observations whose "
                        "timestamp is at or before the evaluated row "
                        "timestamp; absent context remains absent unless the "
                        "candidate performs an explicit backward as-of "
                        "operation."
                    ),
                    "targetClock": "per-target-observed-bars",
                },
            )

            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded", run.result["errors"])
            metrics = run.result["metrics"]
            self.assertEqual(
                metrics["prediction_universe"]["evaluation_mode"],
                "single-asset-temporal",
            )
            self.assertEqual(metrics["input_availability"]["timestamps"], 439)
            self.assertEqual(
                metrics["input_availability"]["prediction_universe"][
                    "timeline_timestamps"
                ],
                220,
            )
            self.assertEqual(
                metrics["input_availability"]["by_asset"]["SPY"][
                    "observations"
                ],
                219,
            )
            diagnostics = load_factor_diagnostics(
                project,
                run.result["id"],
                point_limit=40,
            )
            self.assertEqual(
                diagnostics["inputAvailability"]["timestamps"],
                439,
            )
            self.assertEqual(
                diagnostics["inputAvailability"]["observedRows"],
                439,
            )
            self.assertEqual(
                diagnostics["availabilityPath"]["totalRows"],
                439,
            )
            report = publish_run_report(
                project,
                OHLCV_STUDY_ID,
                run.result["id"],
                {
                    "schemaVersion": 1,
                    "kind": "autoquant-research-report-analysis",
                    "title": "Cross-market close-time Factor evidence",
                    "executiveSummary": (
                        "The fixed fixture verifies causal prior-close context."
                    ),
                    "findings": [
                        {
                            "id": "prior-completed-context",
                            "claim": (
                                "Toyota targets use only an already completed "
                                "SPY close."
                            ),
                            "confidence": "high",
                            "evidenceRefs": [
                                {
                                    "kind": "run",
                                    "id": run.result["id"],
                                    "artifactPath": (
                                        "artifacts/factor-report.json"
                                    ),
                                }
                            ],
                        }
                    ],
                    "recommendations": [],
                    "limitations": [
                        "The deterministic fixture is not market evidence."
                    ],
                    "unresolvedQuestions": [],
                },
            )
            self.assertEqual(
                report.report["evidence"]["leaderDecisionSupport"][
                    "factorInputAvailability"
                ]["timestamps"],
                439,
            )
            self.assertGreater(
                metrics["validation_mean_ic"],
                0.95,
            )
            primary = metrics["split_protocol"]["horizons"]["1"]
            self.assertEqual(
                sum(item["eligibleSignalRows"] for item in primary.values()),
                220 - 3,
            )

    def test_v5_daily_rejects_invalid_completed_bar_rows(self) -> None:
        def naive(frame: pd.DataFrame) -> pd.DataFrame:
            frame.loc[0, "timestamp"] = frame.loc[0, "timestamp"].removesuffix(
                "Z"
            )
            return frame

        def duplicate(frame: pd.DataFrame) -> pd.DataFrame:
            return pd.concat([frame, frame.iloc[[0]]], ignore_index=True)

        def unordered(frame: pd.DataFrame) -> pd.DataFrame:
            frame.iloc[[0, 1]] = frame.iloc[[1, 0]].to_numpy()
            return frame

        def non_finite(frame: pd.DataFrame) -> pd.DataFrame:
            frame.loc[0, "close"] = float("nan")
            return frame

        def invalid_geometry(frame: pd.DataFrame) -> pd.DataFrame:
            frame.loc[0, "high"] = frame.loc[0, "low"] - 1.0
            return frame

        cases = (
            ("naive", naive, "timezone-aware"),
            ("duplicate", duplicate, "unique and chronological"),
            ("unordered", unordered, "unique and chronological"),
            ("non-finite", non_finite, "finite"),
            ("invalid-geometry", invalid_geometry, "OHLC"),
        )
        for label, mutate, expected in cases:
            with self.subTest(case=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                request_path, package_path = write_cross_market_daily_inputs(root)
                package = json.loads(package_path.read_text(encoding="utf-8"))
                source = package_path.parent / package["assets"][0]["path"]
                mutate(pd.read_csv(source)).to_csv(source, index=False)

                with self.assertRaisesRegex(
                    AutoQuantValidationError,
                    expected,
                ):
                    prepare_project_intake(
                        request_path,
                        package_path,
                        "ohlcv-factor-lab",
                    )

    def test_duplicate_non_positive_and_weekend_rows_are_rejected(self) -> None:
        def duplicate(frame: pd.DataFrame) -> pd.DataFrame:
            return pd.concat([frame, frame.iloc[[-1]]], ignore_index=True)

        def negative_volume(frame: pd.DataFrame) -> pd.DataFrame:
            frame.loc[0, "volume"] = -1.0
            return frame

        def weekend(frame: pd.DataFrame) -> pd.DataFrame:
            frame.loc[0, "date"] = "2024-01-06"
            return frame

        for label, mutate, expected in (
            ("duplicate", duplicate, "duplicate candle timestamps"),
            ("negative-volume", negative_volume, "non-negative"),
            ("weekend", weekend, "cannot contain weekend"),
        ):
            with self.subTest(case=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                request_path, package_path = write_intake_inputs(root)
                workspace = initialize_workspace(root / "workspace")
                package = json.loads(package_path.read_text(encoding="utf-8"))
                source = package_path.parent / package["assets"][0]["path"]
                frame = pd.read_csv(source)
                mutate(frame).to_csv(source, index=False)

                with self.assertRaisesRegex(AutoQuantValidationError, expected):
                    prepare_project_intake(
                        request_path,
                        package_path,
                        "ohlcv-portfolio-lab",
                    )

                reloaded = load_workspace(workspace.root_dir)
                self.assertIsNone(reloaded.manifest.default_project)
                self.assertEqual(list(reloaded.projects_dir.iterdir()), [])

    def test_source_symlinks_and_malformed_asset_types_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            package = json.loads(package_path.read_text(encoding="utf-8"))
            source = package_path.parent / package["assets"][0]["path"]
            outside = root / "outside.csv"
            shutil.copyfile(source, outside)
            source.unlink()
            source.symlink_to(outside)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "cannot be symlinks",
            ):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-portfolio-lab",
                )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["assets"][0]["symbol"] = {"not": "a string"}
            package_path.write_text(
                json.dumps(package),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "non-empty string",
            ):
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-portfolio-lab",
                )

    def test_tampering_with_snapshot_or_normalized_bytes_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(root / "workspace")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                workspace.root_dir,
                "tamper-lab",
                template=prepared.template,
                template_intake=prepared,
            )
            normalized = project.root_dir / "data" / "ohlcv" / "AAPL.csv"
            normalized.write_text(
                normalized.read_text(encoding="utf-8") + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Normalized asset hash mismatch",
            ):
                load_project_intake(project)

    def test_rehashed_snapshot_cannot_diverge_from_the_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(root / "workspace")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            project = create_project(
                workspace.root_dir,
                "snapshot-chain",
                template=prepared.template,
                template_intake=prepared,
            )
            snapshot_path = project.root_dir / "data" / "ohlcv" / "snapshot.json"
            snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
            snapshot["requestedAssets"] = ["NVDA"]
            snapshot_path.write_text(
                json.dumps(snapshot, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            intake_path = project.root_dir / "intake.json"
            manifest = json.loads(intake_path.read_text(encoding="utf-8"))
            manifest["datasetSnapshotHash"] = hash_file(snapshot_path)
            intake_path.write_text(
                json.dumps(manifest, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "requested assets differ",
            ):
                load_project_intake(project)


if __name__ == "__main__":
    unittest.main()
