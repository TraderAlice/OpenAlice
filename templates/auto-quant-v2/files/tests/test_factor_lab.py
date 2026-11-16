from __future__ import annotations

import json
import math
import shlex
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
import jsonschema

from autoquant.factor_claims import FACTOR_CLAIM, build_factor_claim
from autoquant.prediction_modes import (
    FACTOR_POPULATION,
    build_factor_population,
)
from autoquant.decision_support import (
    build_leader_decision_support,
    factor_qualification_markdown_lines,
)
from autoquant.factor_explorer import (
    FACTOR_DIAGNOSTICS_JSON_SCHEMA,
    load_factor_diagnostics,
)
from autoquant.intake import prepare_project_intake
from autoquant.orientation import build_agent_work_brief
from autoquant.project_templates.ohlcv_factor_lab.factor_diagnostics import (
    HORIZONS,
    causal_regime_labels,
    descriptive_ic,
    factor_outcome_panels,
    hac_inference,
    purged_split_masks,
)
from autoquant.research_agenda import factor_research_agenda
from autoquant.research import run_campaign
from autoquant.runs import execute_study, load_run
from autoquant.sessions import (
    evaluate_experiment,
    load_session,
    session_snapshot,
    start_session,
)
from autoquant.studies import load_study
from autoquant.studio import build_studio_snapshot
from autoquant.templates import OHLCV_STUDY_ID
from autoquant.workspace import (
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
)
from tests.intake_helpers import write_intake_inputs


IMPROVED_FACTOR = """\
from __future__ import annotations

import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    average = panel.groupby("asset", sort=False)["volume"].transform(
        lambda values: values.rolling(20, min_periods=20).mean()
    )
    return panel["volume"] / average - 1.0
"""


LOOKAHEAD_FACTOR = """\
from __future__ import annotations

import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    future = panel.groupby("asset", sort=False)["close"].shift(-1)
    return future / panel["close"] - 1.0
"""

EMPTY_FACTOR = """\
from __future__ import annotations

import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    return pd.Series(float("nan"), index=panel.index)
"""

LOOKAHEAD_COMPONENT_FACTOR = """\
from __future__ import annotations

import pandas as pd


FACTOR_COMPONENTS = {
    "future_close": {
        "label": "Future close",
        "role": "cross-sectional-score",
        "intervals": ["base"],
        "hypothesis": "Invalid component causality fixture.",
    },
}


def compute_factor_components(panel: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "future_close": panel.groupby(
                "asset",
                sort=False,
            )["close"].shift(-1)
        },
        index=panel.index,
    )


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    return panel.groupby("asset", sort=False)["close"].pct_change(
        fill_method=None
    )
"""

SPARSE_COMPONENT_FACTOR = """\
from __future__ import annotations

import pandas as pd


FACTOR_COMPONENTS = {
    "constant_context": {
        "label": "Constant context",
        "role": "timestamp-context",
        "intervals": ["base"],
        "hypothesis": "Sparse diagnostic fixture with no cross-sectional rank.",
    },
}


def compute_factor_components(panel: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame(
        {"constant_context": 1.0},
        index=panel.index,
    )


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    average = panel.groupby("asset", sort=False)["volume"].transform(
        lambda values: values.rolling(20).mean()
    )
    return panel["volume"] / average - 1.0
"""


def make_factor_lab(directory: str | Path):
    workspace = initialize_workspace(Path(directory) / "workspace", name="Factor Desk")
    project = create_project(
        workspace.root_dir,
        "factor-lab",
        name="Factor Lab",
        template="ohlcv-factor-lab",
    )
    return workspace, project


class OhlcvFactorLabTests(unittest.TestCase):
    def test_forward_realized_volatility_uses_complete_future_log_returns(
        self,
    ) -> None:
        index = pd.date_range("2026-01-01", periods=5, freq="D")
        closes = pd.DataFrame(
            {
                "A": [100.0, 110.0, 99.0, 99.0, 108.9],
                "B": [50.0, 55.0, float("nan"), 60.0, 66.0],
            },
            index=index,
        )
        panels = factor_outcome_panels(
            closes,
            "forward-realized-volatility",
            (1, 2),
        )
        first = math.log(110.0 / 100.0)
        second = math.log(99.0 / 110.0)
        self.assertAlmostEqual(panels[1].loc[index[0], "A"], abs(first))
        self.assertAlmostEqual(
            panels[2].loc[index[0], "A"],
            math.sqrt(first**2 + second**2),
        )
        self.assertTrue(math.isnan(panels[2].loc[index[0], "B"]))
        self.assertTrue(math.isnan(panels[2].loc[index[-2], "A"]))

    def test_explicit_risk_outcome_is_positive_without_portfolio_authority(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            universe = ("AAPL", "MSFT", "NVDA", "QQQ", "SPY")
            request_path, package_path = write_intake_inputs(
                root,
                observations=320,
                request_assets=universe,
                factor_policy={
                    "claim": "known-style-validation",
                    "knownStyle": "realized_volatility_20",
                    "outcome": "forward-realized-volatility",
                },
            )
            intake = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            workspace = initialize_workspace(root / "workspace")
            project = create_project(
                workspace.root_dir,
                "risk-forecast",
                template=intake.template,
                template_intake=intake,
            )
            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            self.assertEqual(
                run.result["metrics"]["factor_outcome"]["kind"],
                "forward-realized-volatility",
            )
            self.assertIn(
                "mean_outcome_by_quantile",
                run.result["metrics"]["quantile_analysis"]["1"][
                    "validation"
                ],
            )
            diagnostics = load_factor_diagnostics(
                project,
                run.result["id"],
            )
            jsonschema.validate(
                diagnostics,
                FACTOR_DIAGNOSTICS_JSON_SCHEMA,
            )
            self.assertEqual(
                diagnostics["factorOutcome"]["downstreamMeaning"],
                "risk-forecast-only-no-return-signal",
            )
            diagnosis = diagnostics["factorQualification"]["diagnosis"]
            self.assertEqual(diagnosis["stage"], "risk-forecast-positive")
            self.assertFalse(diagnosis["qualifiesForPortfolio"])
            agenda = factor_research_agenda(diagnostics, ["factors/**"])
            self.assertEqual(agenda["status"], "no-further-in-sample-tuning")
            self.assertEqual(
                agenda["moves"][0]["id"],
                "factor-freeze-risk-forecast-and-external-holdout",
            )
            snapshot = build_studio_snapshot(workspace.root_dir)
            self.assertEqual(
                snapshot["projects"][0]["factorExplorer"]["factorOutcome"],
                diagnostics["factorOutcome"],
            )
            support = build_leader_decision_support(
                project,
                run.result["id"],
            )
            rendered = "\n".join(
                factor_qualification_markdown_lines(
                    support,
                    heading="## Factor qualification",
                )
            )
            self.assertIn(
                "Fixed prediction outcome: `forward-realized-volatility`",
                rendered,
            )
            self.assertIn("no expected-return, Portfolio, or RL authority", rendered)
            session = start_session(project, OHLCV_STUDY_ID)
            brief = build_agent_work_brief(project)
            self.assertEqual(
                brief["primaryAction"]["id"],
                "report.publish",
            )
            self.assertEqual(
                brief["reasons"][0]["code"],
                "risk-forecast-report-required",
            )
            self.assertEqual(
                brief["focus"]["operatingMode"],
                "publish-evidence",
            )
            self.assertEqual(brief["focus"]["coordinationPhase"], "freeze-ready")
            self.assertEqual(
                brief["researchAgenda"]["moveRole"],
                "optional-follow-up",
            )
            self.assertIn(
                session.manifest["id"],
                brief["primaryAction"]["argv"],
            )
            self.assertIn(
                "no Portfolio, RL, or trading authority",
                brief["review"]["boundary"],
            )

    def test_sparse_component_is_disclosed_without_failing_final_factor(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_factor_lab(directory)
            (project.root_dir / "factors" / "candidate.py").write_text(
                SPARSE_COMPONENT_FACTOR,
                encoding="utf-8",
            )

            run = execute_study(project, OHLCV_STUDY_ID)
            projected = load_factor_diagnostics(
                project,
                run.result["id"],
            )["factorComponents"]

            self.assertEqual(run.result["status"], "succeeded")
            component = projected["components"][0]
            self.assertEqual(component["role"], "timestamp-context")
            self.assertIsNone(component["validation"]["raw"])
            self.assertEqual(
                component["timestampContext"]["method"],
                "train-tertile-timestamp-context-v1",
            )
            self.assertEqual(
                component["validation"]["context"]["distribution"]["mean"],
                1.0,
            )
            self.assertEqual(
                component["validation"]["context"]["stateOccupancy"]["low"][
                    "rate"
                ],
                1.0,
            )
            self.assertFalse(projected["fixedBlend"]["available"])
            self.assertIsNone(
                projected["validationDiagnosis"][
                    "strongestRawComponent"
                ]
            )

    def test_complete_judge_rejects_component_lookahead(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_factor_lab(directory)
            (project.root_dir / "factors" / "candidate.py").write_text(
                LOOKAHEAD_COMPONENT_FACTOR,
                encoding="utf-8",
            )

            run = execute_study(project, OHLCV_STUDY_ID)

            self.assertEqual(run.result["status"], "failed")
            self.assertEqual(
                run.result["errors"][0]["code"],
                "factor.components-lookahead",
            )

    def test_template_constructs_content_locked_project_and_fast_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project = make_factor_lab(directory)
            study = load_study(project, OHLCV_STUDY_ID)

            self.assertEqual(study.definition.dataset.paths, ["ohlcv/**"])
            self.assertEqual(study.definition.judge.timeout_seconds, 60)
            self.assertEqual(len(study.dataset_hashes), 7)
            self.assertIn("ohlcv/ALPHA.csv", study.dataset_hashes)
            self.assertTrue((project.root_dir / "factors" / "candidate.py").is_file())
            self.assertTrue((project.root_dir / "judges" / "ohlcv_factor.py").is_file())
            self.assertTrue(
                (project.root_dir / "judges" / "factor_diagnostics.py").is_file()
            )
            program = (project.root_dir / "studies" / OHLCV_STUDY_ID / "program.md")
            program_text = program.read_text(encoding="utf-8")
            self.assertIn(
                "Missing input is not the same state as an observed false condition",
                program_text,
            )
            self.assertIn(
                "mask the unavailable predicate separately",
                program_text,
            )
            self.assertEqual(
                set(study.judge_hashes),
                {
                    "judges/factor_diagnostics.py",
                    "judges/ohlcv_factor.py",
                },
            )

            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            self.assertGreater(run.result["metrics"]["ic_dates"], 250)
            self.assertEqual(
                run.result["objective"]["metric"],
                "validation_mean_ic",
            )
            self.assertGreater(
                run.result["metrics"]["validation_mean_ic"],
                -1.0,
            )
            self.assertLess(
                run.result["metrics"]["validation_mean_ic"],
                1.0,
            )
            self.assertFalse(
                run.result["metrics"]["research_integrity"][
                    "test_enters_selection"
                ]
            )
            metrics = run.result["metrics"]
            self.assertEqual(set(metrics["horizon_quality"]), {"1", "5", "10"})
            self.assertEqual(
                metrics["factor_api"]["kind"],
                "panel-v2",
            )
            self.assertEqual(
                metrics["factor_api"]["input"],
                "long-form-observed-universe",
            )
            self.assertEqual(
                metrics["input_availability"]["observation_coverage"],
                1.0,
            )
            self.assertFalse(
                metrics["split_protocol"]["candidateDependent"]
            )
            self.assertFalse(
                metrics["split_protocol"]["targetCrossesBoundary"]
            )
            self.assertEqual(
                metrics["validation"]["hac"]["method"],
                "newey-west-bartlett",
            )
            self.assertTrue(
                math.isfinite(
                    metrics["validation"]["pearson_ic"]["mean_ic"]
                )
            )
            self.assertEqual(
                set(metrics["quantile_analysis"]["1"]["validation"][
                    "mean_outcome_by_quantile"
                ]),
                {"low", "middle", "high"},
            )
            self.assertEqual(
                set(metrics["style_correlations"]["validation"]),
                {
                    "momentum_20",
                    "reversal_5",
                    "realized_volatility_20",
                    "relative_volume_20",
                },
            )
            self.assertEqual(
                set(metrics["stability"]["per_asset"]["validation"]),
                set(study.definition.dataset.universe),
            )
            self.assertEqual(
                run.result["dataset"]["sourceHashes"],
                study.dataset_hashes,
            )
            self.assertTrue(
                (run.root_dir / "inputs" / "dataset-files.json").is_file()
            )
            self.assertEqual(
                load_run(project, run.result["id"]).result["inputHash"],
                run.result["inputHash"],
            )
            snapshot = build_studio_snapshot(workspace.root_dir)
            self.assertEqual(snapshot["projects"][0]["counts"]["runs"], 1)
            self.assertEqual(
                snapshot["projects"][0]["runs"][0]["metricLayers"]["kind"],
                "factor",
            )
            layers = snapshot["projects"][0]["runs"][0]["metricLayers"]
            self.assertTrue(
                math.isfinite(layers["validationHacTStatistic"])
            )
            self.assertTrue(
                math.isfinite(
                    layers["validationFarthestHorizonMeanIc"]
                )
            )
            self.assertTrue(
                math.isfinite(layers["validationPearsonIc"])
            )
            self.assertEqual(
                {item["kind"] for item in run.result["artifacts"]},
                {
                    "factor-report",
                    "factor-daily",
                    "factor-quantiles",
                    "factor-availability",
                    "factor-qualification",
                    "factor-components",
                },
            )
            artifacts = {
                item["kind"]: run.root_dir / item["path"]
                for item in run.result["artifacts"]
            }
            daily = pd.read_csv(artifacts["factor-daily"])
            validation_daily = daily.loc[
                daily["split"].eq("validation"),
                "rank_ic_h1",
            ].dropna()
            self.assertAlmostEqual(
                float(validation_daily.mean()),
                metrics["validation_mean_ic"],
                places=10,
            )
            self.assertAlmostEqual(
                float(
                    daily.loc[
                        daily["split"].eq("validation"),
                        "pearson_ic_h1",
                    ].dropna().mean()
                ),
                metrics["validation"]["pearson_ic"]["mean_ic"],
                places=10,
            )
            quantiles = pd.read_csv(artifacts["factor-quantiles"])
            validation_quantiles = quantiles[
                quantiles["split"].eq("validation")
                & quantiles["horizon"].eq(1)
            ]
            self.assertAlmostEqual(
                float(validation_quantiles["high_minus_low"].mean()),
                metrics["quantile_analysis"]["1"]["validation"][
                    "high_minus_low"
                ],
                places=10,
            )
            qualification = metrics["factor_qualification"]
            self.assertEqual(
                qualification["selection"]["split"],
                "train",
            )
            self.assertFalse(
                qualification["selection"]["validation_enters_selection"]
            )
            self.assertFalse(
                qualification["selection"]["test_enters_selection"]
            )
            qualification_daily = pd.read_csv(
                artifacts["factor-qualification"]
            )
            self.assertAlmostEqual(
                float(
                    qualification_daily.loc[
                        qualification_daily["split"].eq("validation"),
                        "candidate_rank_ic_h1",
                    ].dropna().mean()
                ),
                metrics["validation_mean_ic"],
                places=10,
            )
            components = metrics["factor_components"]
            self.assertEqual(
                components["method"],
                "candidate-declared-components-v3",
            )
            self.assertEqual(
                components["trial_disclosure"],
                {
                    "materialized_components": 1,
                    "cross_sectional_score_components": 1,
                    "timestamp_context_components": 0,
                    "pairwise_comparisons": 0,
                    "component_diagnostics_enter_promotion_score": False,
                },
            )
            self.assertEqual(
                components["validation_diagnosis"][
                    "strongest_raw_component"
                ],
                "base_momentum_10",
            )
            self.assertFalse(
                components["declaration"]["exhaustive_composition_claim"]
            )
            self.assertFalse(
                components["declaration"]["source_inference"]
            )
            component_artifact = json.loads(
                artifacts["factor-components"].read_text(encoding="utf-8")
            )
            self.assertEqual(
                component_artifact["evidence"],
                components,
            )
            self.assertAlmostEqual(
                float(
                    qualification_daily.loc[
                        qualification_daily["split"].eq("validation"),
                        "style_neutral_candidate_rank_ic_h1",
                    ].dropna().mean()
                ),
                qualification["horizon_quality"]["1"]["validation"][
                    "style_neutral_candidate"
                ]["mean_ic"],
                places=10,
            )

    def test_known_factor_is_keep_and_future_leak_is_crash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_factor_lab(directory)
            session = start_session(project, OHLCV_STUDY_ID)
            candidate = (
                session.worktree_project.root_dir / "factors" / "candidate.py"
            )
            candidate.write_text(IMPROVED_FACTOR, encoding="utf-8")
            kept = evaluate_experiment(
                project,
                session.manifest["id"],
                "Current relative volume predicts the next cross-sectional return.",
            )
            self.assertEqual(kept.result["verdict"], "KEEP")
            self.assertGreater(kept.result["improvement"], 0.5)
            kept_metrics = load_run(
                project,
                kept.result["candidate"]["runId"],
            ).result["metrics"]
            self.assertNotIn("factor_components", kept_metrics)
            self.assertGreater(
                kept_metrics["validation"]["hac"]["t_statistic"],
                10.0,
            )
            self.assertEqual(
                kept_metrics["quantile_analysis"]["1"]["validation"][
                    "monotonicity"
                ],
                1.0,
            )
            self.assertGreater(
                kept_metrics["quantile_analysis"]["1"]["validation"][
                    "high_minus_low"
                ],
                0.01,
            )
            self.assertGreater(
                kept_metrics["style_correlations"]["validation"][
                    "relative_volume_20"
                ]["mean_rank_correlation"],
                0.95,
            )
            qualification = kept_metrics["factor_qualification"]
            self.assertEqual(
                qualification["selection"]["dominant_style"],
                "relative_volume_20",
            )
            self.assertAlmostEqual(
                qualification["horizon_quality"]["1"]["validation"][
                    "style_neutral_candidate"
                ]["mean_ic"],
                0.0,
            )
            self.assertAlmostEqual(
                qualification["horizon_quality"]["1"]["validation"][
                    "candidate"
                ]["mean_ic"],
                qualification["horizon_quality"]["1"]["validation"][
                    "dominant_style"
                ]["mean_ic"],
            )
            qualification_diagnosis = load_factor_diagnostics(
                project,
                kept.result["candidate"]["runId"],
            )["factorQualification"]
            self.assertEqual(
                qualification_diagnosis["diagnosis"]["stage"],
                "style-neutral-edge-absent",
            )
            self.assertEqual(
                qualification_diagnosis["diagnosis"]["iterationFocus"],
                "distinct-factor-information",
            )
            self.assertGreater(
                min(
                    item["mean_ic"]
                    for name, item in kept_metrics["stability"][
                        "chronological_folds"
                    ].items()
                    if name.startswith("validation_")
                ),
                0.5,
            )
            self.assertGreater(
                min(
                    item["rank_correlation"]
                    for item in kept_metrics["stability"]["per_asset"][
                        "validation"
                    ].values()
                ),
                0.5,
            )
            integrity = session_snapshot(
                project,
                load_session(project, session.manifest["id"]),
            )["selectionIntegrity"]
            self.assertEqual(integrity["selectionSplit"], "validation")
            self.assertFalse(integrity["testEntersSelection"])
            self.assertEqual(integrity["candidateTrials"], 1)
            self.assertTrue(integrity["externalHoldoutRequired"])
            self.assertEqual(
                integrity["testExposureState"],
                "first-candidate-audit-visible",
            )
            self.assertEqual(
                integrity["postAuditCandidateIterations"],
                0,
            )
            self.assertEqual(
                integrity["testGuidanceObservability"],
                "not-observable",
            )
            self.assertEqual(
                integrity["externalHoldoutRule"],
                "required-after-visible-test-and-candidate-iteration",
            )
            self.assertEqual(
                integrity["researchFamily"]["uniqueSourceTrials"],
                2,
            )
            adjustment = integrity["selectionAdjustment"]
            self.assertEqual(adjustment["method"], "bonferroni-hac-v1")
            self.assertAlmostEqual(
                adjustment["statistics"]["familywiseAdjustedPValue"],
                min(
                    1.0,
                    adjustment["statistics"]["rawHacPValue"] * 2,
                ),
            )
            self.assertEqual(
                adjustment["verdictAuthority"],
                "diagnostic-only",
            )

            active = load_session(project, session.manifest["id"])
            candidate = active.worktree_project.root_dir / "factors" / "candidate.py"
            candidate.write_text(LOOKAHEAD_FACTOR, encoding="utf-8")
            crashed = evaluate_experiment(
                project,
                session.manifest["id"],
                "Negative shift should be rejected as future leakage.",
            )
            self.assertEqual(crashed.result["verdict"], "CRASH")
            self.assertEqual(crashed.result["errors"][0]["code"], "factor.lookahead")
            reused = session_snapshot(
                project,
                load_session(project, session.manifest["id"]),
            )["selectionIntegrity"]
            self.assertEqual(
                reused["testExposureState"],
                "post-audit-candidate-iteration",
            )
            self.assertEqual(reused["postAuditCandidateIterations"], 1)
            self.assertIn("timing, not whether", reused["warning"])

    def test_decision_signal_can_advance_without_novelty(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_factor_lab(directory)
            study = load_study(project, OHLCV_STUDY_ID)
            universe = study.definition.dataset.universe
            request = {
                "factorPolicy": {
                    "claim": "decision-signal",
                    "knownStyle": None,
                    "predictionAssets": universe,
                },
                "direction": "long",
            }
            claim = build_factor_claim(request)
            claim_path = project.root_dir / FACTOR_CLAIM
            claim_path.write_text(
                json.dumps(claim, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            population = build_factor_population(request, universe)
            (project.root_dir / FACTOR_POPULATION).write_text(
                json.dumps(population, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            session = start_session(project, OHLCV_STUDY_ID)
            candidate = (
                session.worktree_project.root_dir / "factors" / "candidate.py"
            )
            candidate.write_text(IMPROVED_FACTOR, encoding="utf-8")
            kept = evaluate_experiment(
                project,
                session.manifest["id"],
                "Relative volume is a useful decision signal without a novelty claim.",
            )
            self.assertEqual(kept.result["verdict"], "KEEP")

            diagnostics = load_factor_diagnostics(
                project,
                kept.result["candidate"]["runId"],
            )
            qualification = diagnostics["factorQualification"]
            self.assertEqual(
                qualification["claim"]["claim"],
                "decision-signal",
            )
            self.assertEqual(
                qualification["diagnosis"]["stage"],
                "decision-signal-positive",
            )
            self.assertTrue(
                qualification["diagnosis"]["qualifiesForPortfolio"]
            )
            self.assertAlmostEqual(
                qualification["validation"]["styleNeutralCandidate"][
                    "meanRankIc"
                ],
                0.0,
            )

    def test_test_only_bar_changes_do_not_change_selection_metric(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_factor_lab(directory)
            before = execute_study(project, OHLCV_STUDY_ID)
            for asset_number, source in enumerate(
                sorted((project.root_dir / "data" / "ohlcv").glob("*.csv"))
            ):
                frame = pd.read_csv(source)
                rows = frame.index[-40:]
                direction = 1.0 if asset_number % 2 else -1.0
                scale = 1.0 + direction * np.linspace(0.0, 0.30, len(rows))
                frame.loc[rows, ["open", "high", "low", "close"]] = (
                    frame.loc[rows, ["open", "high", "low", "close"]]
                    .mul(scale, axis=0)
                )
                frame.to_csv(source, index=False)

            after = execute_study(project, OHLCV_STUDY_ID)

            self.assertEqual(
                before.result["metrics"]["validation_mean_ic"],
                after.result["metrics"]["validation_mean_ic"],
            )
            for horizon in ("1", "5", "10"):
                self.assertEqual(
                    before.result["metrics"]["horizon_quality"][horizon][
                        "validation"
                    ],
                    after.result["metrics"]["horizon_quality"][horizon][
                        "validation"
                    ],
                )
                self.assertEqual(
                    before.result["metrics"]["quantile_analysis"][horizon][
                        "validation"
                    ],
                    after.result["metrics"]["quantile_analysis"][horizon][
                        "validation"
                    ],
                )
            self.assertEqual(
                before.result["metrics"]["style_correlations"]["validation"],
                after.result["metrics"]["style_correlations"]["validation"],
            )
            self.assertEqual(
                before.result["metrics"]["stability"]["causal_regimes"][
                    "validation"
                ],
                after.result["metrics"]["stability"]["causal_regimes"][
                    "validation"
                ],
            )
            self.assertEqual(
                before.result["metrics"]["stability"]["per_asset"][
                    "validation"
                ],
                after.result["metrics"]["stability"]["per_asset"][
                    "validation"
                ],
            )
            self.assertNotEqual(
                before.result["metrics"]["test"]["mean_ic"],
                after.result["metrics"]["test"]["mean_ic"],
            )

    def test_missing_factor_population_is_structured_failed_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_factor_lab(directory)
            (project.root_dir / "factors" / "candidate.py").write_text(
                EMPTY_FACTOR,
                encoding="utf-8",
            )

            run = execute_study(project, OHLCV_STUDY_ID)

            self.assertEqual(run.result["status"], "failed")
            self.assertEqual(run.result["metrics"], {})
            self.assertEqual(
                run.result["errors"][0]["code"],
                "factor.empty",
            )

    def test_purged_horizons_never_cross_fixed_split_boundaries(self) -> None:
        index = pd.bdate_range("2024-01-01", periods=150)
        masks, protocol, labels = purged_split_masks(index)

        self.assertEqual(set(masks), set(HORIZONS))
        self.assertFalse(protocol["candidateDependent"])
        self.assertFalse(protocol["targetCrossesBoundary"])
        for horizon, split_masks in masks.items():
            for split, mask in split_masks.items():
                positions = np.flatnonzero(mask.to_numpy())
                self.assertGreater(len(positions), 0)
                self.assertTrue((labels.iloc[positions] == split).all())
                self.assertTrue(
                    (labels.iloc[positions + horizon] == split).all()
                )
                self.assertEqual(
                    protocol["horizons"][str(horizon)][split][
                        "purgedBoundaryRows"
                    ],
                    horizon,
                )

    def test_causal_regime_labels_do_not_change_with_future_prices(self) -> None:
        index = pd.bdate_range("2024-01-01", periods=180)
        time = np.arange(len(index), dtype=float)
        closes = pd.DataFrame(
            {
                asset: 100.0
                * np.exp(
                    np.cumsum(
                        0.0005
                        + 0.01
                        * np.sin(time / (5.0 + number))
                    )
                )
                for number, asset in enumerate(("A", "B", "C", "D"))
            },
            index=index,
        )
        full = causal_regime_labels(closes)
        cut = 130
        prefix = causal_regime_labels(closes.iloc[:cut])
        pd.testing.assert_series_equal(full.iloc[:cut], prefix)

    def test_hac_inference_uses_fixed_bartlett_covariance(self) -> None:
        result = hac_inference(
            pd.Series([1.0, 2.0, 3.0, 4.0]),
            maximum_lag=1,
        )

        self.assertEqual(result["method"], "newey-west-bartlett")
        self.assertEqual(result["maximum_lag"], 1)
        self.assertAlmostEqual(result["standard_error"], 0.625)
        self.assertAlmostEqual(result["t_statistic"], 4.0)
        self.assertAlmostEqual(
            result["normal_approximation_p_value"],
            math.erfc(4.0 / math.sqrt(2.0)),
        )

    def test_sparse_diagnostic_cells_disclose_counts_without_statistics(self) -> None:
        result = descriptive_ic(
            pd.Series([0.2, -0.1]),
            minimum_observations=3,
        )

        self.assertEqual(result["observations"], 2)
        self.assertEqual(result["minimum_observations"], 3)
        self.assertFalse(result["sufficient"])
        self.assertIsNone(result["mean_ic"])
        self.assertIsNone(result["hac"]["t_statistic"])

    def test_dataset_change_stales_session_and_changes_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_factor_lab(directory)
            before = load_study(project, OHLCV_STUDY_ID)
            session = start_session(project, OHLCV_STUDY_ID)
            self.assertEqual(
                list(
                    (
                        session.worktree_project.root_dir
                        / session.worktree_project.manifest.directories["data"]
                    ).iterdir()
                ),
                [],
            )

            alpha = project.root_dir / "data" / "ohlcv" / "ALPHA.csv"
            alpha.write_text(
                alpha.read_text(encoding="utf-8") + "\n",
                encoding="utf-8",
            )
            after = load_study(project, OHLCV_STUDY_ID)
            self.assertNotEqual(before.dataset_hash, after.dataset_hash)
            self.assertNotEqual(before.input_hash, after.input_hash)
            snapshot = session_snapshot(
                project,
                load_session(project, session.manifest["id"]),
            )
            self.assertFalse(snapshot["authority"]["valid"])
            self.assertTrue(
                any(
                    issue["code"] == "session.lock-stale"
                    and "datasetHash" in issue["message"]
                    for issue in snapshot["authority"]["issues"]
                )
            )

    def test_dataset_closure_rejects_symlink(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            tempfile.TemporaryDirectory() as outside,
        ):
            _, project = make_factor_lab(directory)
            target = project.root_dir / "data" / "ohlcv" / "escape.csv"
            target.symlink_to(Path(outside) / "bars.csv")
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Dataset closure contains a symlink",
            ):
                load_study(project, OHLCV_STUDY_ID)

    def test_invalid_template_does_not_publish_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Unknown Project template",
            ):
                create_project(
                    workspace.root_dir,
                    "bad-template",
                    template="not-real",
                )
            self.assertFalse((workspace.projects_dir / "bad-template").exists())

    def test_bounded_researcher_keep_is_visible_in_studio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project = make_factor_lab(directory)
            session = start_session(project, OHLCV_STUDY_ID)
            researcher = Path(directory) / "factor_researcher.py"
            researcher.write_text(
                """\
import json
import os
from pathlib import Path

candidate = Path(os.environ["AUTOQUANT_WORKTREE"]) / "factors/candidate.py"
candidate.write_text('''from __future__ import annotations
import pandas as pd

def compute_factor(panel: pd.DataFrame) -> pd.Series:
    average = panel.groupby("asset", sort=False)["volume"].transform(
        lambda values: values.rolling(20, min_periods=20).mean()
    )
    return panel["volume"] / average - 1.0
''')
print(json.dumps({
    "schema_version": 1,
    "action": "propose",
    "strategy": "relative-volume",
    "hypothesis": "Current relative volume predicts the next cross-sectional return.",
    "expected_effect": "Improve held-out rank IC without future access.",
}))
""",
                encoding="utf-8",
            )
            campaign = run_campaign(
                project,
                session.manifest["id"],
                f"{shlex.quote(sys.executable)} {shlex.quote(str(researcher))}",
                max_turns=1,
                max_wall_seconds=90,
                turn_timeout_seconds=5,
            )
            self.assertEqual(campaign.result["verdicts"]["KEEP"], 1)
            snapshot = build_studio_snapshot(workspace.root_dir)
            observed = snapshot["projects"][0]
            self.assertEqual(observed["counts"]["campaigns"], 1)
            self.assertEqual(observed["counts"]["verdicts"]["KEEP"], 1)
            self.assertEqual(observed["counts"]["runs"], 2)
            self.assertEqual(
                observed["sessions"][0]["selectionIntegrity"][
                    "testExposureState"
                ],
                "first-candidate-audit-visible",
            )
            self.assertEqual(
                observed["sessions"][0]["selectionIntegrity"][
                    "postAuditCandidateIterations"
                ],
                0,
            )
            self.assertTrue(
                any(item["kind"] == "experiment" for item in observed["timeline"])
            )


if __name__ == "__main__":
    unittest.main()
