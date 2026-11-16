from __future__ import annotations

import math
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
import pandas as pd

from autoquant.project_templates.ohlcv_portfolio_lab.portfolio_core import (
    performance_metrics,
)
from autoquant.runs import RunContext
from autoquant.selection import (
    ResearchFamily,
    build_research_family,
    build_selection_adjustment,
    expected_maximum_sharpe,
    probabilistic_sharpe_probability,
)
from autoquant.sessions import (
    evaluate_experiment,
    load_session,
    session_snapshot,
    start_session,
)
from autoquant.studies import create_study
from tests.study_helpers import make_project, study_definition


def fake_run(
    run_id: str,
    source_hash: str,
    value: float | None,
    *,
    metric: str = "score",
    metrics: dict | None = None,
    status: str = "succeeded",
    completed_at: str = "2026-07-24T00:00:00+00:00",
    judge_hash: str = "2" * 64,
) -> RunContext:
    result = {
        "id": run_id,
        "completedAt": completed_at,
        "status": status,
        "study": {
            "id": "fixed-study",
            "programHash": "1" * 64,
        },
        "judge": {"hash": judge_hash},
        "dataset": {"hash": "3" * 64},
        "dependencies": None,
        "objective": {
            "metric": metric,
            "direction": "maximize",
            "minimumImprovement": 0.01,
        },
        "subject": {"sourceHash": source_hash},
        "metrics": (
            metrics
            if metrics is not None
            else ({metric: value} if value is not None else {})
        ),
    }
    return RunContext(
        Path(f"/runs/{run_id}"),
        {"resultHash": source_hash},
        result,
    )


def family(
    *,
    unique_trials: int,
    successful_values: tuple[float, ...],
    reproducible: bool = True,
) -> ResearchFamily:
    return ResearchFamily(
        {
            "trialCountAssumption": "unique-source-upper-bound",
            "uniqueSourceTrials": unique_trials,
            "reproducible": reproducible,
        },
        successful_values,
    )


class SelectionStatisticsTests(unittest.TestCase):
    def test_portfolio_metrics_publish_period_units_and_return_moments(
        self,
    ) -> None:
        returns = pd.Series(np.linspace(-0.02, 0.03, 21))
        observed = performance_metrics(
            returns,
            pd.Series(0.0, index=returns.index),
        )

        self.assertEqual(observed["observations"], 21)
        self.assertEqual(observed["annualization_periods"], 252)
        self.assertAlmostEqual(
            observed["period_sharpe"],
            observed["sharpe"] / math.sqrt(252),
        )
        self.assertAlmostEqual(observed["return_skewness"], 0.0)
        self.assertGreater(observed["return_kurtosis"], 1.0)

    def test_probabilistic_sharpe_and_expected_maximum_have_fixed_fixtures(
        self,
    ) -> None:
        self.assertAlmostEqual(
            probabilistic_sharpe_probability(
                0.1,
                0.0,
                101,
                0.0,
                3.0,
            ),
            0.8407413278013518,
        )
        expected, dispersion = expected_maximum_sharpe(
            [0.1, 0.3],
            2,
        )
        self.assertAlmostEqual(expected, 0.05197553442805938)
        self.assertAlmostEqual(dispersion, 0.1)
        self.assertEqual(expected_maximum_sharpe([0.2], 1), (0.0, 0.0))

        with self.assertRaisesRegex(ValueError, "Invalid Probabilistic"):
            probabilistic_sharpe_probability(0.1, 0.0, 1, 0.0, 3.0)
        with self.assertRaisesRegex(ValueError, "observed trials"):
            expected_maximum_sharpe([], 0)

    def test_factor_adjustment_is_family_wise_and_diagnostic_only(self) -> None:
        leader = fake_run(
            "run-factor",
            "a" * 64,
            0.12,
            metric="validation_mean_ic",
            metrics={
                "validation_mean_ic": 0.12,
                "validation": {
                    "mean_ic": 0.12,
                    "hac": {
                        "normal_approximation_p_value": 0.02,
                    },
                },
            },
        )

        adjustment = build_selection_adjustment(
            leader,
            family(unique_trials=3, successful_values=(0.12, 0.10, 0.08)),
        )

        self.assertEqual(adjustment["method"], "bonferroni-hac-v1")
        self.assertAlmostEqual(
            adjustment["statistics"]["familywiseAdjustedPValue"],
            0.06,
        )
        self.assertFalse(adjustment["passes"])
        self.assertEqual(adjustment["verdictAuthority"], "diagnostic-only")

    def test_portfolio_adjustment_deflates_sharpe_and_checks_track_record(
        self,
    ) -> None:
        leader = fake_run(
            "run-portfolio",
            "b" * 64,
            1.60,
            metric="validation_net_sharpe",
            metrics={
                "validation_net_sharpe": 1.60,
                "portfolio": {
                    "validation": {
                        "net": {
                            "observations": 252,
                            "annualization_periods": 252,
                            "period_sharpe": 0.10,
                            "return_skewness": 0.0,
                            "return_kurtosis": 3.0,
                        }
                    }
                },
            },
        )

        adjustment = build_selection_adjustment(
            leader,
            family(
                unique_trials=4,
                successful_values=(0.8, 1.0, 1.2, 1.6),
            ),
        )
        statistics = adjustment["statistics"]

        self.assertEqual(adjustment["method"], "deflated-sharpe-ratio-v1")
        self.assertGreater(
            statistics["probabilisticSharpeProbability"],
            statistics["deflatedSharpeProbability"],
        )
        self.assertGreater(statistics["expectedMaximumAnnualizedSharpe"], 0.0)
        self.assertEqual(statistics["uniqueTrials"], 4)
        self.assertIsInstance(
            statistics["minimumTrackRecordObservations"],
            int,
        )

        unavailable = build_selection_adjustment(
            leader,
            family(
                unique_trials=4,
                successful_values=(0.8, 1.0, 1.2, 1.6),
                reproducible=False,
            ),
        )
        self.assertEqual(unavailable["status"], "unsupported")
        self.assertEqual(
            unavailable["reason"],
            "non-reproducible-research-family",
        )
        insufficient = build_selection_adjustment(
            leader,
            family(unique_trials=4, successful_values=(1.6,)),
        )
        self.assertEqual(insufficient["status"], "unsupported")
        self.assertEqual(
            insufficient["reason"],
            "insufficient-successful-sharpe-trials",
        )

    def test_rl_aggregate_does_not_receive_a_fabricated_single_path_dsr(
        self,
    ) -> None:
        leader = fake_run(
            "run-rl",
            "c" * 64,
            0.5,
            metric="validation_mean_net_sharpe",
        )

        adjustment = build_selection_adjustment(
            leader,
            family(unique_trials=2, successful_values=(0.4, 0.5)),
        )

        self.assertEqual(adjustment["status"], "unsupported")
        self.assertEqual(
            adjustment["reason"],
            "aggregate-dependent-fold-seed-objective",
        )
        self.assertIsNone(adjustment["passes"])


class ResearchFamilyTests(unittest.TestCase):
    def test_family_deduplicates_sources_and_detects_non_reproducibility(
        self,
    ) -> None:
        anchor = fake_run(
            "run-a1",
            "a" * 64,
            1.0,
            completed_at="2026-07-24T00:00:01+00:00",
        )
        repeated = fake_run(
            "run-a2",
            "a" * 64,
            2.0,
            completed_at="2026-07-24T00:00:02+00:00",
        )
        failed = fake_run(
            "run-b1",
            "b" * 64,
            None,
            status="failed",
            completed_at="2026-07-24T00:00:03+00:00",
        )
        outside = fake_run(
            "run-c1",
            "c" * 64,
            3.0,
            judge_hash="9" * 64,
            completed_at="2026-07-24T00:00:04+00:00",
        )
        runs = {
            item.result["id"]: item
            for item in (anchor, repeated, failed, outside)
        }
        summaries = [SimpleNamespace(id=run_id) for run_id in runs]

        with (
            mock.patch(
                "autoquant.selection.list_runs",
                return_value=summaries,
            ),
            mock.patch(
                "autoquant.selection.load_run",
                side_effect=lambda _project, run_id: runs[run_id],
            ),
        ):
            observed = build_research_family(object(), anchor)

        self.assertEqual(observed.projection["totalExecutions"], 3)
        self.assertEqual(observed.projection["uniqueSourceTrials"], 2)
        self.assertEqual(observed.projection["duplicateExecutions"], 1)
        self.assertEqual(observed.projection["successfulSourceTrials"], 1)
        self.assertEqual(observed.projection["failedSourceTrials"], 1)
        self.assertFalse(observed.projection["reproducible"])
        self.assertEqual(observed.projection["inconsistentSourceTrials"], 1)

    def test_session_restart_reuses_baseline_without_inflating_family_trials(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition())
            first = start_session(project, "factor-quality")
            candidate = (
                first.worktree_project.root_dir
                / "factors"
                / "candidate.py"
            )
            candidate.write_text("SCORE = 2.0\n", encoding="utf-8")
            evaluate_experiment(
                project,
                first.manifest["id"],
                "Try a second immutable source.",
            )

            second = start_session(project, "factor-quality")
            first_live = session_snapshot(
                project,
                load_session(project, first.manifest["id"]),
            )
            second_live = session_snapshot(project, second)
            first_family = first_live["selectionIntegrity"]["researchFamily"]
            second_family = second_live["selectionIntegrity"]["researchFamily"]

            self.assertEqual(first_family["id"], second_family["id"])
            self.assertEqual(first_family["uniqueSourceTrials"], 2)
            self.assertEqual(first_family["totalExecutions"], 2)
            self.assertEqual(first_family["duplicateExecutions"], 0)
            self.assertEqual(first_family, second_family)
