from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import jsonschema

from autoquant.decision_matrix import (
    SESSION_DECISION_MATRIX_JSON_SCHEMA,
    load_session_decision_matrix,
)
from autoquant.sessions import evaluate_experiment, load_session, start_session
from autoquant.studio import build_studio_snapshot
from autoquant.templates import PORTFOLIO_STUDY_ID, RL_STUDY_ID
from autoquant.workspace import (
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
)


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


class SessionDecisionMatrixTests(unittest.TestCase):
    def test_portfolio_matrix_anchors_leader_and_keeps_crash_explicit(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "portfolio",
                template="ohlcv-portfolio-lab",
            )
            session = start_session(project, PORTFOLIO_STUDY_ID)
            candidate = (
                session.worktree_project.root_dir / "factors" / "candidate.py"
            )
            candidate.write_text(IMPROVED_FACTOR, encoding="utf-8")
            kept = evaluate_experiment(
                project,
                session.manifest["id"],
                "Use causal relative activity",
            )
            self.assertEqual(kept.result["verdict"], "KEEP")
            session = load_session(project, kept.result["sessionId"])
            candidate = (
                session.worktree_project.root_dir / "factors" / "candidate.py"
            )
            candidate.write_text(LOOKAHEAD_FACTOR, encoding="utf-8")
            crashed = evaluate_experiment(
                project,
                session.manifest["id"],
                "Attempt forbidden future return",
            )
            self.assertEqual(crashed.result["verdict"], "CRASH")

            anchored = load_session_decision_matrix(
                project,
                session.manifest["id"],
                trial_limit=1,
            )
            self.assertEqual(anchored["metricFamily"], "portfolio")
            self.assertEqual(anchored["scope"]["totalCandidateTrials"], 2)
            self.assertEqual(anchored["scope"]["displayedCandidateTrials"], 1)
            self.assertEqual(anchored["scope"]["omittedCandidateTrials"], 1)
            self.assertEqual(len(anchored["trials"]), 2)
            self.assertEqual(anchored["trials"][1]["verdict"], "KEEP")
            self.assertTrue(anchored["trials"][1]["isCurrentLeader"])

            complete = load_session_decision_matrix(
                project,
                session.manifest["id"],
                trial_limit=2,
            )
            self.assertEqual(
                [trial["verdict"] for trial in complete["trials"]],
                ["BASELINE", "KEEP", "CRASH"],
            )
            crash = complete["trials"][-1]
            self.assertEqual(crash["status"], "failed")
            self.assertTrue(crash["errors"])
            self.assertTrue(
                all(value is None for value in crash["metrics"].values())
            )
            self.assertEqual(
                crash["vsBaseline"]["validationStateChangeRate"],
                "unavailable",
            )
            descriptors = {
                item["key"]: item for item in complete["metrics"]
            }
            self.assertTrue(descriptors["validationNetSharpe"]["primary"])
            self.assertFalse(descriptors["testNetSharpe"]["selectionEligible"])
            self.assertFalse(
                descriptors["validationStateChangeRate"][
                    "selectionEligible"
                ]
            )
            self.assertFalse(
                descriptors["validationRiskLimitedRate"][
                    "selectionEligible"
                ]
            )
            self.assertEqual(
                descriptors["validationStateChangeRate"]["preference"],
                "context",
            )
            self.assertEqual(
                descriptors["validationRiskLimitedRate"]["preference"],
                "context",
            )
            for key in (
                "validationCapacity1PctTenthPercentile",
                "validationCapacityTradeDateCoverage",
                "validationCapacityReferenceNavBreachRate",
                "validationExecutedRiskForecastCoverage",
                "validationRiskRebalanceOverrides",
                "validationExecutedRiskBreaches",
                "validationNeighborhoodMinimumNetSharpe",
                "validationNeighborhoodPositiveSharpeRate",
                "validationNeighborhoodWorstSharpeDelta",
            ):
                self.assertEqual(
                    descriptors[key]["preference"],
                    "context",
                )
                self.assertFalse(
                    descriptors[key]["selectionEligible"]
                )
            baseline_metrics = complete["trials"][0]["metrics"]
            self.assertIsNotNone(
                baseline_metrics["validationRiskLimitedRate"]
            )
            self.assertIsNotNone(
                baseline_metrics["validationAverageActiveRiskScale"]
            )
            self.assertIsNotNone(
                baseline_metrics["validationPreGovernorForecastMaximum"]
            )
            self.assertIsNotNone(
                baseline_metrics["validationPostGovernorForecastMaximum"]
            )
            self.assertIsNotNone(
                baseline_metrics[
                    "validationCapacity1PctTenthPercentile"
                ]
            )
            self.assertIsNotNone(
                baseline_metrics["validationCapacityTradeDateCoverage"]
            )
            self.assertIsNotNone(
                baseline_metrics[
                    "validationExecutedRiskForecastCoverage"
                ]
            )
            self.assertIsNotNone(
                baseline_metrics["validationRiskRebalanceOverrides"]
            )
            self.assertEqual(
                baseline_metrics["validationExecutedRiskBreaches"],
                0.0,
            )
            self.assertIsNotNone(
                baseline_metrics[
                    "validationNeighborhoodMinimumNetSharpe"
                ]
            )
            self.assertIsNotNone(
                baseline_metrics[
                    "validationNeighborhoodPositiveSharpeRate"
                ]
            )
            self.assertTrue(complete["tradeoffs"]["testExcluded"])
            self.assertNotIn(
                "testNetSharpe",
                complete["tradeoffs"]["selectionEligibleMetricKeys"],
            )
            self.assertTrue(
                complete["trials"][1]["vsBaseline"]["testNetSharpe"].startswith(
                    "audit-"
                )
            )
            self.assertEqual(
                complete["selectionIntegrity"]["candidateTrials"],
                2,
            )
            jsonschema.validate(
                complete,
                SESSION_DECISION_MATRIX_JSON_SCHEMA,
            )

            snapshot = build_studio_snapshot(workspace.root_dir)
            observed = snapshot["projects"][0]["sessions"][0]
            self.assertEqual(
                observed["decisionMatrix"]["kind"],
                "autoquant-session-decision-matrix",
            )
            self.assertTrue(
                any(
                    command["id"] == "session.compare"
                    for command in observed["commands"]
                )
            )

    def test_rl_matrix_uses_seed_fold_and_portfolio_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "rl",
                template="ohlcv-rl-factor-lab",
            )
            session = start_session(project, RL_STUDY_ID)
            matrix = load_session_decision_matrix(
                project,
                session.manifest["id"],
                trial_limit=3,
            )

            self.assertEqual(matrix["metricFamily"], "rl-policy")
            values = matrix["trials"][0]["metrics"]
            self.assertIsNotNone(values["validationMeanNetSharpe"])
            self.assertIsNotNone(values["validationMinimumNetSharpe"])
            self.assertIsNotNone(values["validationSeedFoldStd"])
            self.assertIsNotNone(values["validationBaselineAdvantage"])
            self.assertIsNotNone(values["validationAnnualizedTurnover"])
            self.assertIsNotNone(values["validationCostDrag"])
            self.assertIsNotNone(values["validationActionTransitionRate"])
            self.assertIsNotNone(values["validationMeanActionRunLength"])
            self.assertIsNotNone(values["validationMedianActionMargin"])
            self.assertIsNotNone(values["validationQDecisionTieRate"])
            self.assertIsNotNone(values["validationOneStepOracleHitRate"])
            self.assertIsNotNone(values["validationMeanSelectedActionRank"])
            self.assertIsNotNone(values["validationMeanOneStepRegret"])
            self.assertIsNotNone(
                values["validationCandidateOracleFrequency"]
            )
            self.assertIsNotNone(
                values["validationCandidateMissedOpportunityRate"]
            )
            self.assertEqual(values["failureRate"], 0.0)
            self.assertFalse(
                next(
                    item
                    for item in matrix["metrics"]
                    if item["key"] == "validationMedianActionMargin"
                )["selectionEligible"]
            )
            self.assertFalse(
                next(
                    item
                    for item in matrix["metrics"]
                    if item["key"] == "validationMeanOneStepRegret"
                )["selectionEligible"]
            )
            self.assertFalse(
                next(
                    item
                    for item in matrix["metrics"]
                    if item["key"] == "testMeanNetSharpe"
                )["selectionEligible"]
            )

    def test_trial_limit_is_strict_and_structured(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "factor",
                template="ohlcv-factor-lab",
            )
            session = start_session(project, "ohlcv-factor-quality")
            with self.assertRaises(AutoQuantValidationError) as caught:
                load_session_decision_matrix(
                    project,
                    session.manifest["id"],
                    trial_limit=0,
                )
            self.assertEqual(
                caught.exception.issues[0].code,
                "comparison.trial-limit",
            )


if __name__ == "__main__":
    unittest.main()
