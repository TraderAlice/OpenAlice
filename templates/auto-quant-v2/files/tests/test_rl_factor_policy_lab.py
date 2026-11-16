from __future__ import annotations

import json
import shlex
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd

from autoquant.briefs import validate_research_request
from autoquant.mandates import build_portfolio_mandate
from autoquant.project_templates.ohlcv_rl_factor_lab import rl_core
from autoquant.project_templates.ohlcv_portfolio_lab.portfolio_core import (
    construct_signal_policy,
    decision_schedule_mask,
    execution_risk_metrics,
)
from autoquant.project_templates.ohlcv_rl_factor_lab.rl_core import (
    ACTIONS,
    BASE_STATE_COLUMNS,
    EXPERTS,
    POLICY_STATE_COLUMNS,
    build_action_targets,
    build_policy_state,
    compact_opportunity_rows,
    fixed_selector,
    one_step_action_opportunities,
    ridge_selector,
    rollout_policy,
    train_contextual_ridge,
)
from autoquant.research import run_campaign
from autoquant.runs import execute_study
from autoquant.sessions import (
    evaluate_experiment,
    load_session,
    session_snapshot,
    start_session,
)
from autoquant.studio import build_studio_snapshot
from autoquant.studies import load_study
from autoquant.templates import RL_STUDY_ID
from autoquant.workspace import create_project, initialize_workspace


IMPROVED_ENCODER = """\
from __future__ import annotations

FEATURE_NAMES = (
    "bias",
    "volume_regime",
    "previous_activity",
    "previous_intraday",
    "previous_reversal",
    "previous_balanced",
)


def encode_state(state: dict[str, float]) -> list[float]:
    return [
        1.0,
        state["volume_regime"] * 2.0,
        state["previous_activity"],
        state["previous_intraday"],
        state["previous_reversal"],
        state["previous_balanced"],
    ]
"""


NONDETERMINISTIC_ENCODER = """\
from __future__ import annotations

FEATURE_NAMES = ("counter",)
counter = 0


def encode_state(state: dict[str, float]) -> list[float]:
    global counter
    counter += 1
    return [float(counter)]
"""


DELAYED_NONFINITE_ENCODER = """\
from __future__ import annotations

FEATURE_NAMES = ("bias",)
calls = 0


def encode_state(state: dict[str, float]) -> list[float]:
    global calls
    calls += 1
    return [float("nan") if calls > 40 else 1.0]
"""


def make_rl_lab(directory: str | Path):
    workspace = initialize_workspace(
        Path(directory) / "workspace",
        name="RL Research Desk",
    )
    project = create_project(
        workspace.root_dir,
        "rl-factor-lab",
        name="RL Factor Lab",
        template="ohlcv-rl-factor-lab",
    )
    return workspace, project


class RlEnvironmentTests(unittest.TestCase):
    def test_policy_state_exposes_the_actual_pretrade_book_and_target_distance(
        self,
    ) -> None:
        assets = pd.Index(["A", "B"])
        raw = pd.Series(0.0, index=list(BASE_STATE_COLUMNS))
        targets = {
            "candidate": pd.Series([0.5, -0.5], index=assets),
            "activity": pd.Series([-0.5, 0.5], index=assets),
            "intraday": pd.Series([0.25, -0.25], index=assets),
            "reversal": pd.Series([-0.25, 0.25], index=assets),
            "balanced": pd.Series([0.0, 0.0], index=assets),
        }
        flat = build_policy_state(
            raw,
            "balanced",
            pd.Series(0.0, index=assets),
            targets,
        )
        carried = build_policy_state(
            raw,
            "candidate",
            targets["candidate"],
            targets,
        )

        self.assertEqual(set(flat), set(POLICY_STATE_COLUMNS))
        self.assertEqual(flat["pretrade_gross_exposure"], 0.0)
        self.assertEqual(flat["candidate_target_distance"], 0.5)
        self.assertEqual(carried["pretrade_gross_exposure"], 1.0)
        self.assertEqual(carried["pretrade_net_exposure"], 0.0)
        self.assertEqual(carried["candidate_target_distance"], 0.0)
        self.assertEqual(carried["activity_target_distance"], 1.0)
        self.assertEqual(carried["previous_candidate"], 1.0)

    def test_contextual_ridge_uses_fixed_train_only_same_pretrade_iterations(
        self,
    ) -> None:
        dates = pd.bdate_range("2026-01-01", periods=32)
        assets = ["A", "B"]
        time = np.arange(len(dates), dtype=float)
        closes = pd.DataFrame(
            {
                "A": 100.0 * np.exp(np.cumsum(0.002 + 0.01 * np.sin(time))),
                "B": 100.0 * np.exp(np.cumsum(0.001 - 0.01 * np.sin(time))),
            },
            index=dates,
        )
        volumes = pd.DataFrame(
            1_000_000.0,
            index=dates,
            columns=assets,
        )
        patterns = {
            "candidate": [0.5, -0.5],
            "activity": [-0.5, 0.5],
            "intraday": [0.25, -0.25],
            "reversal": [-0.25, 0.25],
            "balanced": [0.0, 0.0],
        }
        action_targets = {
            action: pd.DataFrame(
                [weights] * len(dates),
                index=dates,
                columns=assets,
            )
            for action, weights in patterns.items()
        }
        raw_states = pd.DataFrame(
            0.0,
            index=dates,
            columns=list(BASE_STATE_COLUMNS),
        )
        train_index = dates[:28]
        reference_rollout = rollout_policy(
            fixed_selector("balanced"),
            raw_states,
            action_targets,
            closes,
            volumes,
            train_index,
        )
        array_rollout = rl_core._training_rollout(
            fixed_selector("balanced"),
            raw_states,
            action_targets,
            closes,
            train_index,
            mandate=None,
            risk_covariance_cache=None,
        )
        pd.testing.assert_series_equal(
            array_rollout.actions,
            reference_rollout.actions,
        )
        pd.testing.assert_frame_equal(
            array_rollout.states,
            reference_rollout.states,
        )
        pd.testing.assert_series_equal(
            array_rollout.net_returns,
            reference_rollout.simulation.daily["net_return"],
        )
        pd.testing.assert_series_equal(
            array_rollout.benchmark_returns,
            reference_rollout.simulation.daily["benchmark_return"],
        )
        self.assertEqual(
            rl_core.training_policy_net_sharpe(
                fixed_selector("balanced"),
                raw_states,
                action_targets,
                closes,
                train_index,
                mandate=None,
                risk_covariance_cache=None,
            ),
            rl_core.rollout_metrics(reference_rollout)["net"]["sharpe"],
        )
        reference_opportunities = one_step_action_opportunities(
            reference_rollout,
            action_targets,
            closes,
            volumes,
            train_index,
        )
        (
            array_rewards,
            array_oracle_hit_rate,
            array_mean_regret,
        ) = rl_core._training_opportunity_summary(
            array_rollout,
            action_targets,
            closes,
            train_index,
            mandate=None,
            risk_covariance_cache=None,
        )
        np.testing.assert_array_equal(
            array_rewards,
            np.asarray(
                [
                    [
                        row["actions"][action]["reward"]
                        for action in ACTIONS
                    ]
                    for row in reference_opportunities
                ],
                dtype=float,
            ),
        )
        self.assertEqual(
            array_oracle_hit_rate,
            float(
                np.mean(
                    [
                        row["selectedAction"] == row["oracleAction"]
                        for row in reference_opportunities
                    ]
                )
            ),
        )
        self.assertEqual(
            array_mean_regret,
            float(
                np.mean(
                    [
                        row["realizedRegret"]
                        for row in reference_opportunities
                    ]
                )
            ),
        )

        first = train_contextual_ridge(
            raw_states,
            action_targets,
            closes,
            volumes,
            train_index,
        )
        second = train_contextual_ridge(
            raw_states,
            action_targets,
            closes,
            volumes,
            train_index,
        )

        self.assertEqual(first, second)
        self.assertEqual(
            first["method"],
            "iterative-same-pretrade-contextual-ridge-v1",
        )
        self.assertEqual(first["labelScope"], "train-only")
        self.assertEqual(first["anchorAction"], "balanced")
        self.assertEqual(first["iterations"], 4)
        self.assertEqual(first["columns"], list(POLICY_STATE_COLUMNS))
        self.assertEqual(len(first["history"]), 4)
        self.assertTrue(
            all(
                item["trainingRows"] == len(train_index)
                and item["sharedPretradeActionEvaluations"]
                == len(train_index) * len(ACTIONS)
                for item in first["history"]
            )
        )
        rollout = rollout_policy(
            ridge_selector(first),
            raw_states,
            action_targets,
            closes,
            volumes,
            dates[-24:],
        )
        self.assertEqual(
            list(rollout.states.columns),
            list(POLICY_STATE_COLUMNS),
        )

    def test_every_rl_action_inherits_the_fixed_portfolio_risk_governor(
        self,
    ) -> None:
        dates = pd.bdate_range("2026-01-01", periods=100)
        columns = list("ABCDE")
        time = np.arange(len(dates), dtype=float)
        closes = pd.DataFrame(
            {
                asset: 100.0
                * np.exp(
                    np.cumsum(
                        0.001
                        + 0.06
                        * np.sin(
                            time / (2.0 + number * 0.35) + number
                        )
                    )
                )
                for number, asset in enumerate(columns)
            },
            index=dates,
        )
        base = np.tile(
            np.arange(len(columns), dtype=float),
            (len(dates), 1),
        )
        factor_panels = {
            expert: pd.DataFrame(
                np.roll(base, shift=number, axis=1),
                index=dates,
                columns=columns,
            )
            for number, expert in enumerate(EXPERTS)
        }
        mandate = build_portfolio_mandate(None, columns)

        action_targets = build_action_targets(
            factor_panels,
            closes,
            mandate=mandate,
        )
        expected_candidate = construct_signal_policy(
            factor_panels["candidate"],
            closes,
            mandate=mandate,
        ).targets
        target_only_candidate = construct_signal_policy(
            factor_panels["candidate"],
            closes,
            mandate=mandate,
            include_ledger=False,
        )
        ungoverned_candidate = construct_signal_policy(
            factor_panels["candidate"],
            closes,
            mandate=mandate,
            apply_risk_governor=False,
        ).targets

        self.assertEqual(set(action_targets), set(ACTIONS))
        pd.testing.assert_frame_equal(
            action_targets["candidate"],
            expected_candidate,
        )
        pd.testing.assert_frame_equal(
            target_only_candidate.targets,
            expected_candidate,
        )
        self.assertTrue(target_only_candidate.ledger.empty)
        self.assertTrue(
            (
                action_targets["candidate"].abs().sum(axis=1)
                <= ungoverned_candidate.abs().sum(axis=1) + 1e-12
            ).all()
        )
        self.assertTrue(
            (
                action_targets["candidate"].abs().sum(axis=1)
                < ungoverned_candidate.abs().sum(axis=1) - 1e-12
            ).any()
        )

        volumes = pd.DataFrame(
            1_000_000.0,
            index=dates,
            columns=columns,
        )
        raw_states = pd.DataFrame(
            0.0,
            index=dates,
            columns=list(BASE_STATE_COLUMNS),
        )
        rollout = rollout_policy(
            fixed_selector("candidate"),
            raw_states,
            action_targets,
            closes,
            volumes,
            dates[-30:-1],
            mandate=mandate,
        )
        compliance = execution_risk_metrics(
            rollout.simulation,
            rollout.simulation.daily.index,
        )
        self.assertEqual(compliance["executed_breach_dates"], 0)
        self.assertTrue(
            (
                rollout.simulation.daily[
                    "executed_risk_forecast_annualized"
                ]
                <= rollout.simulation.daily[
                    "execution_risk_ceiling_annualized"
                ]
                + 1e-12
            ).all()
        )
        opportunities = one_step_action_opportunities(
            rollout,
            action_targets,
            closes,
            volumes,
            rollout.actions.index,
            mandate=mandate,
        )
        self.assertEqual(len(opportunities), len(rollout.actions))
        for timestamp, opportunity in zip(
            rollout.actions.index,
            opportunities,
        ):
            self.assertEqual(opportunity["selectedAction"], "candidate")
            self.assertEqual(set(opportunity["actions"]), set(ACTIONS))
            np.testing.assert_allclose(
                list(
                    opportunity["actions"]["candidate"][
                        "executedWeights"
                    ].values()
                ),
                rollout.simulation.weights.loc[timestamp].to_numpy(),
                rtol=0.0,
                atol=1e-12,
            )
            np.testing.assert_allclose(
                list(
                    opportunity["actions"]["candidate"]["trades"].values()
                ),
                rollout.simulation.trades.loc[timestamp].to_numpy(),
                rtol=0.0,
                atol=1e-12,
            )

    def test_action_reward_begins_after_the_decision_close(self) -> None:
        dates = pd.bdate_range("2026-01-01", periods=26)
        columns = ["A", "B"]
        targets = pd.DataFrame(
            [[0.5, -0.5]] * len(dates),
            index=dates,
            columns=columns,
        )
        action_targets = {action: targets.copy() for action in ACTIONS}
        closes = pd.DataFrame(
            {"A": [100.0, 200.0, 200.0, 220.0] + [220.0] * 22, "B": 100.0},
            index=dates,
        )
        volumes = pd.DataFrame(1_000_000.0, index=dates, columns=columns)
        raw_states = pd.DataFrame(
            0.0,
            index=dates,
            columns=list(BASE_STATE_COLUMNS),
        )

        rollout = rollout_policy(
            fixed_selector("activity"),
            raw_states,
            action_targets,
            closes,
            volumes,
            dates[1:25],
        )

        first = rollout.simulation.daily.loc[dates[1]]
        second = rollout.simulation.daily.loc[dates[2]]
        self.assertEqual(first["gross_return"], 0.0)
        self.assertAlmostEqual(first["net_return"], -0.0006)
        self.assertAlmostEqual(first["reward"], -0.0006)
        self.assertAlmostEqual(second["gross_return"], 0.03)
        self.assertAlmostEqual(second["reward"], 0.02991)

    def test_opportunity_audit_shares_held_book_accounting_off_schedule(
        self,
    ) -> None:
        dates = pd.bdate_range("2026-01-02", periods=32)
        columns = list("ABCDE")
        time = np.arange(len(dates), dtype=float)
        closes = pd.DataFrame(
            {
                asset: 100.0
                * np.exp(
                    np.cumsum(
                        0.001
                        + 0.004
                        * np.sin(time / (3.0 + number))
                    )
                )
                for number, asset in enumerate(columns)
            },
            index=dates,
        )
        volumes = pd.DataFrame(
            1_000_000.0,
            index=dates,
            columns=columns,
        )
        patterns = {
            action: np.roll([0.3, 0.3, 0.2, 0.0, 0.0], number)
            for number, action in enumerate(ACTIONS)
        }
        action_targets = {
            action: pd.DataFrame(
                [weights] * len(dates),
                index=dates,
                columns=columns,
            )
            for action, weights in patterns.items()
        }
        raw_states = pd.DataFrame(
            0.0,
            index=dates,
            columns=list(BASE_STATE_COLUMNS),
        )
        request = validate_research_request(
            {
                "schemaVersion": 1,
                "kind": "autoquant-research-request",
                "title": "Held-book opportunity test",
                "question": "Do fixed action sleeves share held accounting?",
                "decisionContext": "Deterministic runtime regression.",
                "assets": [
                    {
                        "symbol": asset,
                        "assetClass": "equity",
                        "venue": "TEST",
                    }
                    for asset in columns
                ],
                "direction": "long",
                "horizon": "five bars",
                "hypotheses": [],
                "constraints": [],
                "deliverables": ["runtime evidence"],
                "benchmarkPolicy": {
                    "kind": "fixed-weights",
                    "weights": {
                        "A": 0.4,
                        "B": 0.3,
                        "C": 0.2,
                        "D": 0.05,
                        "E": 0.05,
                    },
                },
                "portfolioPolicy": {
                    "grossLimit": 1.0,
                    "maxAbsWeight": 0.3,
                    "assetMaxAbsWeights": {},
                    "annualizedVolatilityCeiling": 1.0,
                    "baseCostBps": 10.0,
                    "noTradeOneWay": 0.0,
                    "referenceNav": 1_000_000.0,
                    "decisionSchedule": {
                        "kind": "every-bars",
                        "bars": 4,
                        "anchor": "dataset-start",
                    },
                },
                "source": {
                    "system": "local",
                    "workspaceId": "test",
                    "sessionId": "held-book",
                    "artifactPath": None,
                    "artifactRevision": None,
                },
            }
        )
        mandate = build_portfolio_mandate(request, columns)
        index = dates[:28]
        rollout = rollout_policy(
            fixed_selector("candidate"),
            raw_states,
            action_targets,
            closes,
            volumes,
            index,
            mandate=mandate,
        )
        expected_benchmark = (
            (closes.shift(-1) / closes - 1.0)
            * pd.Series(
                {"A": 0.4, "B": 0.3, "C": 0.2, "D": 0.05, "E": 0.05}
            )
        ).sum(axis=1, min_count=1).reindex(index)
        pd.testing.assert_series_equal(
            rollout.simulation.daily["benchmark_return"],
            expected_benchmark.rename("benchmark_return"),
            check_freq=False,
        )
        eligible = decision_schedule_mask(
            dates,
            mandate["implementationPolicy"]["decisionPolicy"],
        ).reindex(index)

        with mock.patch.object(
            rl_core,
            "_account_step",
            wraps=rl_core._account_step,
        ) as account:
            opportunities = one_step_action_opportunities(
                rollout,
                action_targets,
                closes,
                volumes,
                index,
                mandate=mandate,
            )

        self.assertEqual(
            account.call_count,
            int(eligible.sum()) * len(ACTIONS)
            + int((~eligible).sum()),
        )
        for is_eligible, row in zip(eligible, opportunities, strict=True):
            if is_eligible:
                continue
            actions = list(row["actions"].values())
            self.assertEqual(
                len({item["reward"] for item in actions}),
                1,
            )
            self.assertEqual(
                len(
                    {
                        tuple(item["executedWeights"].values())
                        for item in actions
                    }
                ),
                1,
            )
            self.assertGreater(
                len(
                    {
                        tuple(item["proposedWeights"].values())
                        for item in actions
                    }
                ),
                1,
            )
        compacted = compact_opportunity_rows(opportunities)
        for is_eligible, row in zip(eligible, compacted, strict=True):
            if is_eligible:
                self.assertIsNone(row["sharedExecution"])
                self.assertTrue(
                    all(
                        "executedWeights" in evidence
                        for evidence in row["actions"].values()
                    )
                )
            else:
                self.assertIsNotNone(row["sharedExecution"])
                self.assertTrue(
                    all(
                        set(evidence) == {"proposedWeights"}
                        for evidence in row["actions"].values()
                    )
                )

    def test_learning_step_matches_full_governed_accounting(self) -> None:
        dates = pd.bdate_range("2026-01-02", periods=80)
        columns = list("ABCDE")
        time = np.arange(len(dates), dtype=float)
        closes = pd.DataFrame(
            {
                asset: 100.0
                * np.exp(
                    np.cumsum(
                        0.0005
                        + 0.012
                        * np.sin(time / (2.0 + number * 0.4))
                    )
                )
                for number, asset in enumerate(columns)
            },
            index=dates,
        )
        volumes = pd.DataFrame(
            1_000_000.0,
            index=dates,
            columns=columns,
        )
        mandate = build_portfolio_mandate(None, columns)
        returns = closes.pct_change(fill_method=None)
        forward_returns = closes.shift(-1) / closes - 1.0
        risk_cache = rl_core.build_risk_covariance_cache(
            closes,
            mandate=mandate,
        )
        resolved = rl_core.resolve_portfolio_mandate(columns, mandate)
        implementation = rl_core.resolve_implementation_policy(mandate)
        timestamp = dates[-2]
        previous = pd.Series(
            [0.2, -0.2, 0.1, -0.1, 0.0],
            index=columns,
            dtype=float,
        )
        proposed = pd.Series(
            [0.3, -0.3, 0.2, -0.2, 0.0],
            index=columns,
            dtype=float,
        )
        pretrade = rl_core._pretrade_weights(
            previous,
            returns,
            timestamp,
            first=False,
        )
        forward = forward_returns.loc[timestamp].fillna(0.0)

        for decision_eligible in (False, True):
            with self.subTest(decision_eligible=decision_eligible):
                full_current, _, _, full_row = rl_core._account_step(
                    previous,
                    proposed,
                    returns,
                    timestamp,
                    forward,
                    closes.loc[timestamp],
                    volumes.loc[timestamp],
                    first=False,
                    ordinary_rebalance_allowed=decision_eligible,
                    mandate=mandate,
                    risk_covariance_cache=risk_cache,
                    resolved_mandate=resolved,
                    implementation=implementation,
                    pretrade=pretrade,
                )
                fast_current, fast_reward = rl_core._learning_step(
                    previous,
                    proposed,
                    returns,
                    timestamp,
                    forward,
                    ordinary_rebalance_allowed=decision_eligible,
                    mandate=mandate,
                    risk_covariance_cache=risk_cache,
                    resolved_mandate=resolved,
                    implementation=implementation,
                    pretrade=pretrade,
                )
                array_current, array_reward = (
                    rl_core._learning_step_values(
                        pretrade.to_numpy(dtype=float),
                        proposed.to_numpy(dtype=float),
                        timestamp,
                        forward.to_numpy(dtype=float),
                        ordinary_rebalance_allowed=decision_eligible,
                        no_trade_one_way=float(
                            implementation["no_trade_one_way"]
                        ),
                        base_cost_bps=float(
                            implementation["base_cost_bps"]
                        ),
                        resolved_mandate=resolved,
                        risk_covariance_cache=risk_cache,
                    )
                )

                pd.testing.assert_series_equal(
                    fast_current,
                    full_current,
                )
                self.assertEqual(fast_reward, full_row["reward"])
                np.testing.assert_array_equal(
                    array_current,
                    full_current.to_numpy(dtype=float),
                )
                self.assertEqual(array_reward, full_row["reward"])


class GovernedRlFactorPolicyLabTests(unittest.TestCase):
    def test_template_is_reproducible_and_preserves_every_seed_fold_artifact(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project = make_rl_lab(directory)
            study = load_study(project, RL_STUDY_ID)
            self.assertEqual(study.definition.editable["paths"], ["models/**"])
            self.assertEqual(
                study.definition.dependencies,
                {
                    "paths": [
                        "factors/**",
                        "strategies/factor-claim.json",
                        "strategies/factor-population.json",
                        "strategies/portfolio-mandate.json",
                        "strategies/research-horizon.json",
                    ]
                },
            )
            self.assertEqual(
                set(study.dependency_hashes),
                {
                    "factors/candidate.py",
                    "strategies/factor-claim.json",
                    "strategies/factor-population.json",
                    "strategies/portfolio-mandate.json",
                    "strategies/research-horizon.json",
                },
            )
            self.assertEqual(
                study.definition.judge.paths,
                [
                    "judges/ohlcv_rl_factor.py",
                    "judges/rl_core.py",
                    "judges/portfolio_core.py",
                ],
            )
            self.assertEqual(study.definition.judge.timeout_seconds, 120)
            self.assertEqual(len(study.dataset_hashes), 7)

            first = execute_study(project, RL_STUDY_ID)
            second = execute_study(project, RL_STUDY_ID)

            self.assertEqual(first.result["status"], "succeeded")
            self.assertEqual(second.result["status"], "succeeded")
            self.assertEqual(first.result["metrics"], second.result["metrics"])
            metrics = first.result["metrics"]
            self.assertEqual(metrics["configuration"]["seeds"], [11, 29, 47])
            self.assertEqual(metrics["configuration"]["folds"], ["fold-1", "fold-2"])
            self.assertEqual(metrics["configuration"]["episodes"], 12)
            self.assertEqual(metrics["configuration"]["learningRate"], 0.02)
            self.assertEqual(metrics["configuration"]["discount"], 0.30)
            self.assertEqual(metrics["configuration"]["epsilonStart"], 0.15)
            self.assertEqual(metrics["configuration"]["epsilonEnd"], 0.01)
            learning_contract = metrics["configuration"]["learningContract"]
            self.assertEqual(
                learning_contract["method"],
                "fixed-after-train-only-blocked-stability-audit-v1",
            )
            self.assertEqual(
                learning_contract["runtime_policy"],
                "harness-fixed-before-study-validation",
            )
            self.assertEqual(
                metrics["research_integrity"]["learning_configuration"],
                learning_contract,
            )
            self.assertEqual(
                metrics["rl"]["aggregate"]["validation_net_sharpe"][
                    "observations"
                ],
                6,
            )
            self.assertEqual(metrics["rl"]["aggregate"]["failure_rate"], 0.0)
            self.assertFalse(
                metrics["research_integrity"]["test_enters_selection"]
            )
            self.assertIn("candidate", metrics["configuration"]["actions"])
            self.assertEqual(
                metrics["configuration"]["factorExperts"][0],
                "candidate",
            )
            self.assertLess(
                metrics["comparison"][
                    "mean_validation_advantage_vs_best_baseline"
                ],
                0.0,
            )
            self.assertEqual(
                {item["kind"] for item in first.result["artifacts"]},
                {
                    "rl-report",
                    "policy-models",
                    "training-history",
                    "policy-actions",
                    "policy-rationales",
                    "policy-opportunities",
                    "policy-incremental-attribution",
                },
            )
            opportunity_artifact = next(
                item
                for item in first.result["artifacts"]
                if item["kind"] == "policy-opportunities"
            )
            opportunity_rows = json.loads(
                (
                    first.root_dir / opportunity_artifact["path"]
                ).read_text(encoding="utf-8")
            )["rows"]
            self.assertTrue(
                all(
                    row["decisionEligible"]
                    and row["sharedExecution"] is None
                    and all(
                        "executedWeights" in evidence
                        for evidence in row["actions"].values()
                    )
                    for row in opportunity_rows
                )
            )
            rationale = metrics["policy_rationale"]
            self.assertEqual(
                rationale["policy"]["selection_authority"],
                "context-only",
            )
            self.assertEqual(
                rationale["validation"]["decisions"],
                360,
            )
            self.assertEqual(
                rationale["validation"]["reconciliation"]["action_rows"],
                360,
            )
            self.assertEqual(
                set(rationale["validation"]["by_action"]),
                set(metrics["configuration"]["actions"]),
            )
            self.assertEqual(
                set(rationale["validation"]["by_feature"]),
                set(metrics["configuration"]["featureNames"]),
            )
            opportunity = metrics["factor_opportunity"]
            self.assertEqual(
                opportunity["policy"]["method"],
                "actual-pretrade-one-step-governed-action-audit-v1",
            )
            self.assertEqual(
                opportunity["policy"]["selection_authority"],
                "context-only",
            )
            self.assertEqual(
                opportunity["validation"]["decisions"],
                360,
            )
            self.assertEqual(
                opportunity["validation"]["reconciliation"][
                    "action_evaluations"
                ],
                1800,
            )
            self.assertTrue(
                opportunity["validation"]["reconciliation"]["passed"]
            )
            self.assertGreaterEqual(
                opportunity["validation"]["mean_selected_rank"],
                1.0,
            )
            self.assertLessEqual(
                opportunity["validation"]["mean_selected_rank"],
                5.0,
            )
            incremental = metrics["incremental_attribution"]
            self.assertEqual(
                incremental["policy"]["comparison_path"],
                "independent-full-rollouts",
            )
            self.assertEqual(incremental["validation"]["decisions"], 360)
            self.assertEqual(incremental["validation"]["trial_paths"], 6)
            self.assertTrue(
                incremental["validation"]["reconciliation"]["passed"]
            )
            self.assertAlmostEqual(
                incremental["validation"]["total_gross_active_return"]
                - incremental["validation"]["total_incremental_cost"],
                incremental["validation"]["total_net_active_return"],
            )
            self.assertEqual(
                set(incremental["validation"]["by_asset"]),
                set(study.definition.dataset.universe),
            )
            first_models = next(
                item
                for item in first.result["artifacts"]
                if item["kind"] == "policy-models"
            )
            second_models = next(
                item
                for item in second.result["artifacts"]
                if item["kind"] == "policy-models"
            )
            self.assertEqual(
                json.loads(
                    (first.root_dir / first_models["path"]).read_text()
                ),
                json.loads(
                    (second.root_dir / second_models["path"]).read_text()
                ),
            )
            snapshot = build_studio_snapshot(workspace.root_dir)
            layers = snapshot["projects"][0]["runs"][0]["metricLayers"]
            self.assertEqual(layers["kind"], "rl-policy")
            self.assertEqual(layers["folds"], 2)
            self.assertEqual(layers["seeds"], 3)
            self.assertEqual(
                layers["policyBehavior"]["selectionAuthority"],
                "context-only",
            )
            self.assertEqual(
                layers["factorOpportunity"]["selectionAuthority"],
                "context-only",
            )
            self.assertEqual(
                snapshot["projects"][0]["rlExplorer"][
                    "incrementalAttribution"
                ]["selectionAuthority"],
                "context-only",
            )
            self.assertEqual(
                snapshot["projects"][0]["rlExplorer"]["protocol"][
                    "configuration"
                ]["learningContract"],
                learning_contract,
            )

    def test_campaign_keeps_regime_encoder_and_rejects_nondeterminism(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project = make_rl_lab(directory)
            session = start_session(project, RL_STUDY_ID)
            researcher = Path(directory) / "rl_researcher.py"
            researcher.write_text(
                f"""\
import json
import os
from pathlib import Path

Path(os.environ["AUTOQUANT_WORKTREE"], "models/candidate.py").write_text(
    {IMPROVED_ENCODER!r}
)
print(json.dumps({{
    "schema_version": 1,
    "action": "propose",
    "strategy": "causal-volume-regime-state",
    "hypothesis": "A causal market-volume regime helps choose factor mixtures.",
    "expected_effect": "Improve aggregate validation net Sharpe across all seeds.",
}}))
""",
                encoding="utf-8",
            )
            campaign = run_campaign(
                project,
                session.manifest["id"],
                f"{shlex.quote(sys.executable)} {shlex.quote(str(researcher))}",
                max_turns=1,
                max_wall_seconds=180,
                turn_timeout_seconds=30,
            )

            self.assertEqual(campaign.result["verdicts"]["KEEP"], 1)
            self.assertGreater(
                campaign.result["finalLeader"]["value"]
                - campaign.result["initialLeader"]["value"],
                20.0,
            )
            observed = build_studio_snapshot(workspace.root_dir)["projects"][0]
            self.assertEqual(observed["counts"]["campaigns"], 1)
            self.assertTrue(
                all(
                    run["metricLayers"]["kind"] == "rl-policy"
                    for run in observed["runs"]
                )
            )
            integrity = session_snapshot(
                project,
                load_session(project, session.manifest["id"]),
            )["selectionIntegrity"]
            self.assertEqual(
                integrity["researchFamily"]["uniqueSourceTrials"],
                2,
            )
            self.assertEqual(
                integrity["selectionAdjustment"]["status"],
                "unsupported",
            )
            self.assertEqual(
                integrity["selectionAdjustment"]["reason"],
                "aggregate-dependent-fold-seed-objective",
            )

            candidate = (
                session.worktree_project.root_dir / "models" / "candidate.py"
            )
            candidate.write_text(NONDETERMINISTIC_ENCODER, encoding="utf-8")
            crashed = evaluate_experiment(
                project,
                session.manifest["id"],
                "Mutable global state must fail deterministic policy evidence.",
            )
            self.assertEqual(crashed.result["verdict"], "CRASH")
            self.assertEqual(
                crashed.result["errors"][0]["code"],
                "policy.nondeterministic",
            )

            candidate.write_text(DELAYED_NONFINITE_ENCODER, encoding="utf-8")
            seed_failure = evaluate_experiment(
                project,
                session.manifest["id"],
                "A failed seed must fail the Run instead of disappearing.",
            )
            self.assertEqual(seed_failure.result["verdict"], "CRASH")
            self.assertEqual(len(seed_failure.result["errors"]), 6)
            self.assertEqual(
                {item["code"] for item in seed_failure.result["errors"]},
                {"policy.non-finite"},
            )
            self.assertTrue(
                all(
                    "fold-" in item["message"] and "seed" in item["message"]
                    for item in seed_failure.result["errors"]
                )
            )


if __name__ == "__main__":
    unittest.main()
