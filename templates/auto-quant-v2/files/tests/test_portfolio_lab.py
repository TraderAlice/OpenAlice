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

from autoquant.project_templates.ohlcv_portfolio_lab.portfolio_core import (
    LONG_ENTRY_PERCENTILE,
    SHORT_ENTRY_PERCENTILE,
    SignalConstruction,
    attribution_metrics,
    build_decision_ledger,
    build_position_episodes,
    build_risk_covariance_cache,
    constraint_audit,
    construct_signal_policy,
    drift_weights,
    execute_risk_compliant_book,
    execution_risk_metrics,
    liquidity_capacity_metrics,
    position_episode_metrics,
    signal_policy_metrics,
    simulate_targets,
    translate_factor_scores,
)
from autoquant.factor_claims import build_factor_claim
from autoquant.mandates import build_portfolio_mandate
from autoquant.prediction_modes import (
    build_factor_population,
    resolve_prediction_population,
)
from autoquant.briefs import validate_research_request
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
from autoquant.templates import PORTFOLIO_STUDY_ID
from autoquant.workspace import create_project, initialize_workspace


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


def make_portfolio_lab(directory: str | Path):
    workspace = initialize_workspace(
        Path(directory) / "workspace",
        name="Portfolio Desk",
    )
    project = create_project(
        workspace.root_dir,
        "portfolio-lab",
        name="Portfolio Lab",
        template="ohlcv-portfolio-lab",
    )
    return workspace, project


class PredictionModeTranslationTests(unittest.TestCase):
    def test_single_asset_temporal_scores_are_causal_and_context_invariant(
        self,
    ) -> None:
        index = pd.bdate_range("2026-01-02", periods=100)
        target = pd.Series(
            np.sin(np.arange(len(index)) / 5.0)
            + np.arange(len(index)) / 100.0,
            index=index,
        )
        first = pd.DataFrame(
            {
                "TARGET": target,
                "CONTEXT_A": np.arange(len(index), dtype=float) ** 2,
                "CONTEXT_B": -np.arange(len(index), dtype=float),
            },
            index=index,
        )
        second = first.copy()
        second["CONTEXT_A"] = np.cos(np.arange(len(index))) * 1e9
        second["CONTEXT_B"] = np.nan
        population = {
            "evaluation_mode": "single-asset-temporal",
            "prediction_assets": ["TARGET"],
            "context_assets": ["CONTEXT_A", "CONTEXT_B"],
            "authority": "caller-factor-policy-prediction-assets",
            "relative_value_pair": None,
        }

        scores, values, observations, semantics = translate_factor_scores(
            first,
            population,
        )
        changed, _, _, _ = translate_factor_scores(second, population)
        prefix, _, _, _ = translate_factor_scores(
            first.iloc[:70],
            population,
        )

        pd.testing.assert_series_equal(scores["TARGET"], changed["TARGET"])
        pd.testing.assert_series_equal(
            scores.loc[prefix.index, "TARGET"],
            prefix["TARGET"],
        )
        self.assertTrue(scores[["CONTEXT_A", "CONTEXT_B"]].isna().all().all())
        self.assertTrue(values[["CONTEXT_A", "CONTEXT_B"]].isna().all().all())
        self.assertEqual(int(observations.loc[index[18], "TARGET"]), 19)
        self.assertTrue(math.isnan(scores.loc[index[18], "TARGET"]))
        self.assertTrue(math.isfinite(scores.loc[index[19], "TARGET"]))
        self.assertEqual(
            semantics["score_basis"],
            "causal-own-factor-history",
        )

    def test_cross_section_ranks_only_prediction_assets(self) -> None:
        index = pd.bdate_range("2026-01-02", periods=2)
        factors = pd.DataFrame(
            {
                "A": [1.0, 4.0],
                "B": [2.0, 3.0],
                "C": [3.0, 2.0],
                "D": [4.0, 1.0],
                "CONTEXT": [-1e12, 1e12],
            },
            index=index,
        )
        population = {
            "evaluation_mode": "cross-sectional",
            "prediction_assets": ["A", "B", "C", "D"],
            "context_assets": ["CONTEXT"],
            "authority": "caller-factor-policy-prediction-assets",
            "relative_value_pair": None,
        }
        scores, _, _, _ = translate_factor_scores(factors, population)

        self.assertTrue(scores["CONTEXT"].isna().all())
        self.assertEqual(scores.loc[index[0], ["A", "B", "C", "D"]].tolist(), [0.0, 1 / 3, 2 / 3, 1.0])
        self.assertEqual(scores.loc[index[1], ["A", "B", "C", "D"]].tolist(), [1.0, 2 / 3, 1 / 3, 0.0])

    def test_relative_value_scores_and_targets_are_exact_pairs(self) -> None:
        index = pd.bdate_range("2026-01-02", periods=100)
        universe = ["LEFT", "RIGHT", "CONTEXT"]
        raw = {
            "schemaVersion": 1,
            "kind": "autoquant-research-request",
            "title": "Pair translation",
            "question": "How should one relative-value signal map to weights?",
            "decisionContext": "Bounded target-weight research.",
            "assets": [
                {
                    "symbol": "LEFT",
                    "assetClass": "equity",
                    "venue": "TEST",
                    "positionRole": "two-sided",
                },
                {
                    "symbol": "RIGHT",
                    "assetClass": "equity",
                    "venue": "TEST",
                    "positionRole": "two-sided",
                },
                {
                    "symbol": "CONTEXT",
                    "assetClass": "equity",
                    "venue": "TEST",
                    "positionRole": "context-only",
                },
            ],
            "direction": "relative-value",
            "horizon": "one month",
            "hypotheses": [],
            "constraints": [],
            "deliverables": ["target-weight evidence"],
            "factorPolicy": {
                "claim": "decision-signal",
                "knownStyle": None,
                "predictionAssets": ["LEFT", "RIGHT"],
            },
            "source": {
                "system": "openalice",
                "workspaceId": "desk",
                "sessionId": "pair",
                "artifactPath": None,
                "artifactRevision": None,
            },
        }
        request = validate_research_request(raw)
        mandate = build_portfolio_mandate(request, universe)
        population = resolve_prediction_population(
            universe,
            build_factor_claim(request),
            build_factor_population(request, universe),
        ).as_metrics()
        factors = pd.DataFrame(
            {
                "LEFT": np.arange(len(index), dtype=float),
                "RIGHT": np.zeros(len(index)),
                "CONTEXT": np.sin(np.arange(len(index))) * 1e12,
            },
            index=index,
        )
        time = np.arange(len(index), dtype=float)
        closes = pd.DataFrame(
            {
                asset: 100.0
                * np.exp(np.cumsum(0.001 + 0.003 * np.sin(time / (4 + n))))
                for n, asset in enumerate(universe)
            },
            index=index,
        )

        construction = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
            prediction_population=population,
            apply_risk_governor=False,
        )
        available = construction.scores["LEFT"].notna()
        paired_scores = construction.scores.loc[available, ["LEFT", "RIGHT"]]
        self.assertTrue(
            np.allclose(paired_scores.sum(axis=1).to_numpy(), 1.0)
        )
        self.assertTrue(construction.scores["CONTEXT"].isna().all())
        active = construction.targets.loc[
            construction.targets[["LEFT", "RIGHT"]].abs().sum(axis=1) > 0
        ]
        self.assertFalse(active.empty)
        self.assertTrue(np.allclose(active.sum(axis=1).to_numpy(), 0.0))
        self.assertTrue(
            np.allclose(
                active["LEFT"].abs().to_numpy(),
                active["RIGHT"].abs().to_numpy(),
            )
        )
        self.assertTrue((active["LEFT"] * active["RIGHT"] < 0).all())
        self.assertTrue((construction.targets["CONTEXT"] == 0).all())
        self.assertAlmostEqual(float(active.iloc[0]["LEFT"]), 0.30)


class PortfolioAccountingTests(unittest.TestCase):
    def test_position_episodes_allocate_transition_costs_and_boundaries(
        self,
    ) -> None:
        index = pd.bdate_range("2026-01-01", periods=5)
        ledger = pd.DataFrame(
            {
                "timestamp": index,
                "asset": ["A"] * 5,
                "signal_state": [1, 1, -1, 0, 1],
                "pretrade_weight": [0.0, 0.2, 0.3, -0.1, 0.0],
                "executed_weight": [0.2, 0.3, -0.1, 0.0, 0.15],
                "executed_state": [1, 1, -1, 0, 1],
                "trade_weight": [0.2, 0.1, -0.4, 0.1, 0.15],
                "execution_action": [
                    "open",
                    "resize",
                    "reverse",
                    "close",
                    "open",
                ],
                "execution_reason": ["target_rebalance"] * 5,
                "risk_rebalance_override": [False] * 5,
                "gross_return_contribution": [
                    0.01,
                    -0.005,
                    0.002,
                    0.0,
                    0.003,
                ],
                "cost_contribution": [
                    0.002,
                    0.001,
                    0.004,
                    0.001,
                    0.0015,
                ],
            }
        )
        ledger["net_return_contribution"] = (
            ledger["gross_return_contribution"]
            - ledger["cost_contribution"]
        )

        episodes = build_position_episodes(
            ledger,
            index,
            split="validation",
            role="selection",
        )
        metrics = position_episode_metrics(episodes, ledger, index)

        self.assertEqual(
            episodes[["side", "complete", "right_censored"]].values.tolist(),
            [
                ["long", True, False],
                ["short", True, False],
                ["long", False, True],
            ],
        )
        first = episodes.iloc[0]
        self.assertAlmostEqual(first["entry_cost"], 0.002)
        self.assertAlmostEqual(first["holding_cost"], 0.001)
        self.assertAlmostEqual(first["exit_cost"], 0.003)
        self.assertAlmostEqual(first["net_contribution"], -0.001)
        self.assertAlmostEqual(first["maximum_favorable_excursion"], 0.008)
        self.assertAlmostEqual(first["maximum_adverse_excursion"], -0.001)
        self.assertEqual(metrics["complete_episodes"], 2)
        self.assertEqual(metrics["right_censored_segments"], 1)
        self.assertTrue(metrics["reconciliation"]["passed"])
        self.assertAlmostEqual(metrics["total_gross_contribution"], 0.01)
        self.assertAlmostEqual(metrics["total_cost"], 0.0095)
        self.assertAlmostEqual(metrics["total_net_contribution"], 0.0005)

        boundary_index = pd.bdate_range("2026-02-02", periods=2)
        boundary = pd.DataFrame(
            {
                "timestamp": boundary_index,
                "asset": ["A", "A"],
                "signal_state": [1, 0],
                "pretrade_weight": [0.2, 0.2],
                "executed_weight": [0.2, 0.0],
                "executed_state": [1, 0],
                "trade_weight": [0.0, -0.2],
                "execution_action": ["hold", "close"],
                "execution_reason": ["portfolio_no_trade_band", "target_rebalance"],
                "risk_rebalance_override": [False, False],
                "gross_return_contribution": [0.01, 0.0],
                "cost_contribution": [0.0, 0.002],
                "net_return_contribution": [0.01, -0.002],
            }
        )
        carried = build_position_episodes(
            boundary,
            boundary_index,
            split="test",
            role="visible-audit",
        )
        self.assertEqual(len(carried), 1)
        self.assertTrue(bool(carried.iloc[0]["left_censored"]))
        self.assertFalse(bool(carried.iloc[0]["complete"]))
        self.assertEqual(carried.iloc[0]["decision_bars"], 1)
        self.assertAlmostEqual(carried.iloc[0]["exit_cost"], 0.002)

    def test_executed_book_risk_overrides_no_trade_with_minimum_scale(
        self,
    ) -> None:
        index = pd.bdate_range("2026-01-01", periods=30)
        signs = np.where(np.arange(len(index)) % 2 == 0, 1.0, -1.0)
        close_returns = pd.DataFrame(
            {
                "A": signs * 0.016,
                "B": -signs * 0.016,
            },
            index=index,
        )
        mandate = build_portfolio_mandate(None, ["A", "B"])
        pretrade = pd.Series({"A": 0.3, "B": -0.3})
        proposed = pretrade * 0.95

        current, evidence = execute_risk_compliant_book(
            pretrade,
            proposed,
            close_returns,
            index[-1],
            mandate=mandate,
        )

        self.assertTrue(evidence["risk_rebalance_override"])
        self.assertFalse(evidence["ordinary_rebalance"])
        self.assertTrue(evidence["rebalanced"])
        self.assertEqual(evidence["execution_reason"], "risk_ceiling_override")
        self.assertEqual(evidence["status"], "risk_repaired")
        self.assertGreater(
            evidence["pretrade_forecast_annualized"],
            evidence["annualized_volatility_ceiling"],
        )
        self.assertLessEqual(
            evidence["executed_forecast_annualized"],
            evidence["annualized_volatility_ceiling"] + 1e-12,
        )
        expected_scale = (
            evidence["annualized_volatility_ceiling"]
            / evidence["pretrade_forecast_annualized"]
        )
        self.assertAlmostEqual(
            evidence["risk_repair_scale"],
            expected_scale,
        )
        pd.testing.assert_series_equal(
            current,
            pretrade * expected_scale,
        )

        future = pd.DataFrame(
            {"A": [0.9, -0.8], "B": [-0.9, 0.8]},
            index=pd.bdate_range(index[-1] + pd.Timedelta(days=1), periods=2),
        )
        extended = pd.concat([close_returns, future])
        repeated, repeated_evidence = execute_risk_compliant_book(
            pretrade,
            proposed,
            extended,
            index[-1],
            mandate=mandate,
        )
        pd.testing.assert_series_equal(current, repeated)
        self.assertEqual(evidence, repeated_evidence)

    def test_executed_book_hard_cap_overrides_no_trade_after_drift(
        self,
    ) -> None:
        index = pd.bdate_range("2026-01-01", periods=30)
        close_returns = pd.DataFrame(
            {
                "A": 0.002
                * np.sin(np.arange(len(index), dtype=float) / 3.0),
            },
            index=index,
        )
        raw_request = {
            "schemaVersion": 1,
            "kind": "autoquant-research-request",
            "title": "Hard cap repair",
            "question": "Can a drifted long book remain within its hard cap?",
            "decisionContext": "Bounded accounting regression.",
            "assets": [
                {
                    "symbol": "A",
                    "assetClass": "equity",
                    "venue": "TEST",
                }
            ],
            "direction": "long",
            "horizon": "one month",
            "portfolioPolicy": {
                "grossLimit": 0.3,
                "maxAbsWeight": 0.3,
                "assetMaxAbsWeights": {"A": 0.3},
                "annualizedVolatilityCeiling": 1.0,
                "baseCostBps": 10.0,
                "noTradeOneWay": 0.05,
                "referenceNav": 100000.0,
                "decisionSchedule": {
                    "kind": "every-bars",
                    "bars": 1,
                    "anchor": "dataset-start",
                },
            },
            "hypotheses": [],
            "constraints": [],
            "deliverables": ["bounded model weights"],
            "source": {
                "system": "local",
                "workspaceId": None,
                "sessionId": None,
                "artifactPath": None,
                "artifactRevision": None,
            },
        }
        mandate = build_portfolio_mandate(
            validate_research_request(raw_request),
            ["A"],
        )
        pretrade = pd.Series({"A": 0.3168601148})
        proposed = pd.Series({"A": 0.3})

        current, evidence = execute_risk_compliant_book(
            pretrade,
            proposed,
            close_returns,
            index[-1],
            mandate=mandate,
            no_trade_one_way=0.05,
        )

        self.assertAlmostEqual(float(current["A"]), 0.3)
        self.assertFalse(evidence["ordinary_rebalance"])
        self.assertFalse(evidence["risk_rebalance_override"])
        self.assertTrue(evidence["constraint_rebalance_override"])
        self.assertTrue(evidence["rebalanced"])
        self.assertEqual(
            evidence["execution_reason"],
            "mandate_constraint_override",
        )
        self.assertAlmostEqual(
            evidence["constraint_repair_one_way"],
            0.5 * (0.3168601148 - 0.3),
        )
        self.assertLessEqual(
            evidence["executed_constraint_maximum_error"],
            1e-12,
        )

    def test_target_earns_only_the_return_after_its_decision_bar(self) -> None:
        index = pd.bdate_range("2026-01-01", periods=4)
        targets = pd.DataFrame(
            [[0.0, 0.0], [0.5, -0.5], [0.5, -0.5], [0.5, -0.5]],
            index=index,
            columns=["A", "B"],
        )
        closes = pd.DataFrame(
            {
                "A": [100.0, 200.0, 200.0, 220.0],
                "B": [100.0, 100.0, 100.0, 100.0],
            },
            index=index,
        )
        volumes = pd.DataFrame(
            1_000_000.0,
            index=index,
            columns=targets.columns,
        )

        simulation = simulate_targets(
            targets,
            closes,
            volumes,
            cost_bps=0.0,
            no_trade_one_way=0.0,
        )

        self.assertEqual(simulation.daily.loc[index[1], "gross_return"], 0.0)
        self.assertAlmostEqual(
            simulation.daily.loc[index[2], "gross_return"],
            0.03,
        )

    def test_extra_delay_moves_target_to_the_following_decision_bar(self) -> None:
        index = pd.bdate_range("2026-01-01", periods=4)
        targets = pd.DataFrame(
            [[0.0, 0.0], [0.5, -0.5], [0.0, 0.0], [0.0, 0.0]],
            index=index,
            columns=["A", "B"],
        )
        closes = pd.DataFrame(
            {
                "A": [100.0, 100.0, 110.0, 132.0],
                "B": [100.0, 100.0, 100.0, 100.0],
            },
            index=index,
        )
        volumes = pd.DataFrame(
            1_000_000.0,
            index=index,
            columns=targets.columns,
        )

        base = simulate_targets(
            targets,
            closes,
            volumes,
            cost_bps=0.0,
            no_trade_one_way=0.0,
        )
        delayed = simulate_targets(
            targets,
            closes,
            volumes,
            cost_bps=0.0,
            no_trade_one_way=0.0,
            extra_delay=1,
        )

        self.assertAlmostEqual(base.daily.loc[index[1], "gross_return"], 0.03)
        self.assertEqual(delayed.daily.loc[index[1], "gross_return"], 0.0)
        self.assertAlmostEqual(delayed.daily.loc[index[2], "gross_return"], 0.06)

    def test_drift_turnover_and_cost_conventions_are_explicit(self) -> None:
        previous = pd.Series({"A": 0.5, "B": -0.5})
        realized = pd.Series({"A": 0.10, "B": 0.0})
        drifted = drift_weights(previous, realized)
        expected = pd.Series({"A": 0.55 / 1.05, "B": -0.5 / 1.05})
        pd.testing.assert_series_equal(drifted, expected)

        index = pd.bdate_range("2026-01-01", periods=3)
        targets = pd.DataFrame(
            [[0.5, -0.5]] * 3,
            index=index,
            columns=["A", "B"],
        )
        closes = pd.DataFrame(
            {"A": [100.0, 110.0, 110.0], "B": [100.0, 100.0, 100.0]},
            index=index,
        )
        volumes = pd.DataFrame(
            1_000_000.0,
            index=index,
            columns=targets.columns,
        )
        simulation = simulate_targets(targets, closes, volumes)

        first = simulation.daily.loc[index[0]]
        self.assertAlmostEqual(first["traded_notional"], 0.6)
        self.assertAlmostEqual(first["one_way_turnover"], 0.3)
        self.assertAlmostEqual(first["cost"], 0.0006)
        repaired = simulation.daily.loc[index[1]]
        self.assertTrue(bool(repaired["rebalanced"]))
        self.assertTrue(bool(repaired["constraint_rebalance_override"]))
        self.assertEqual(
            repaired["execution_reason"],
            "mandate_constraint_override",
        )
        self.assertAlmostEqual(
            float(simulation.weights.loc[index[1], "A"]),
            abs(float(simulation.weights.loc[index[1], "B"])),
        )
        self.assertLessEqual(
            float(simulation.weights.loc[index[1]].abs().max()),
            0.3,
        )

    def test_signal_state_machine_separates_hysteresis_from_targets(self) -> None:
        index = pd.bdate_range("2026-01-01", periods=30)
        assets = list("ABCDEF")
        factors = pd.DataFrame(
            np.tile(np.arange(6, dtype=float), (len(index), 1)),
            index=index,
            columns=assets,
        )
        factors.loc[index[20:28], "A"] = [
            6.0,
            3.5,
            2.5,
            -1.0,
            2.5,
            3.5,
            6.0,
            -1.0,
        ]
        time = np.arange(len(index), dtype=float)
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
                for number, asset in enumerate(assets)
            },
            index=index,
        )

        governed = construct_signal_policy(factors, closes)
        no_hysteresis = construct_signal_policy(
            factors,
            closes,
            long_exit=LONG_ENTRY_PERCENTILE,
            short_exit=SHORT_ENTRY_PERCENTILE,
        )
        events = (
            governed.ledger.loc[governed.ledger["asset"].eq("A")]
            .set_index("timestamp")["signal_event"]
        )

        self.assertEqual(
            events.loc[index[20:28]].tolist(),
            [
                "enter_long",
                "hold_long",
                "exit_long",
                "enter_short",
                "hold_short",
                "exit_short",
                "enter_long",
                "reverse_long_to_short",
            ],
        )
        governed_metrics = signal_policy_metrics(
            governed,
            index[20:28],
        )
        no_hysteresis_metrics = signal_policy_metrics(
            no_hysteresis,
            index[20:28],
        )
        self.assertLess(
            governed_metrics["signal_transitions"],
            no_hysteresis_metrics["signal_transitions"],
        )
        active = governed.targets.abs().sum(axis=1) > 0
        self.assertTrue(
            np.allclose(
                governed.targets.loc[active].abs().sum(axis=1),
                1.0,
            )
        )
        self.assertEqual(
            set(governed.ledger["risk_governor_status"]),
            {"flat", "legacy_none"},
        )

    def test_request_bound_risk_governor_only_scales_down_high_risk_targets(
        self,
    ) -> None:
        index = pd.bdate_range("2026-01-01", periods=100)
        assets = list("ABCDE")
        factors = pd.DataFrame(
            np.tile(np.arange(len(assets), dtype=float), (len(index), 1)),
            index=index,
            columns=assets,
        )
        time = np.arange(len(index), dtype=float)
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
                for number, asset in enumerate(assets)
            },
            index=index,
        )
        mandate = build_portfolio_mandate(None, assets)

        governed = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
        )
        risk_cache = build_risk_covariance_cache(
            closes,
            mandate=mandate,
        )
        cached_governed = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
            risk_covariance_cache=risk_cache,
        )
        pd.testing.assert_frame_equal(
            cached_governed.targets,
            governed.targets,
        )
        pd.testing.assert_frame_equal(
            cached_governed.ledger,
            governed.ledger,
        )
        ungoverned = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
            apply_risk_governor=False,
        )
        daily = (
            governed.ledger.groupby("timestamp", sort=True)
            .agg(
                status=("risk_governor_status", "first"),
                scale=("risk_governor_scale", "first"),
                before=("risk_forecast_pre_annualized", "first"),
                after=("risk_forecast_post_annualized", "first"),
                ceiling=(
                    "risk_volatility_ceiling_annualized",
                    "first",
                ),
            )
        )
        limited = daily[daily["status"].eq("volatility_limited")]

        self.assertFalse(limited.empty)
        self.assertTrue((limited["scale"] > 0.0).all())
        self.assertTrue((limited["scale"] < 1.0).all())
        self.assertTrue((limited["after"] <= limited["ceiling"] + 1e-12).all())
        self.assertTrue(
            (
                governed.targets.abs().sum(axis=1)
                <= ungoverned.targets.abs().sum(axis=1) + 1e-12
            ).all()
        )
        self.assertTrue(
            constraint_audit(governed.targets, mandate=mandate)["passed"]
        )
        governed_metrics = signal_policy_metrics(governed, index)
        self.assertGreater(governed_metrics["risk_limited_dates"], 0)
        self.assertLess(
            governed_metrics[
                "maximum_post_governor_annualized_volatility"
            ],
            governed_metrics[
                "maximum_pre_governor_annualized_volatility"
            ],
        )

        volumes = pd.DataFrame(
            1_000_000.0,
            index=index,
            columns=assets,
        )
        simulation = simulate_targets(
            governed.targets,
            closes,
            volumes,
            mandate=mandate,
        )
        cached_simulation = simulate_targets(
            governed.targets,
            closes,
            volumes,
            mandate=mandate,
            risk_covariance_cache=risk_cache,
        )
        pd.testing.assert_frame_equal(
            cached_simulation.daily,
            simulation.daily,
        )
        pd.testing.assert_frame_equal(
            cached_simulation.weights,
            simulation.weights,
        )
        compliance = execution_risk_metrics(simulation, index[:-1])
        self.assertEqual(compliance["executed_breach_dates"], 0)
        self.assertLessEqual(
            compliance["maximum_executed_forecast_annualized"],
            mandate["construction"]["riskPolicy"][
                "annualizedVolatilityCeiling"
            ]
            + 1e-12,
        )

    def test_decision_ledger_reconciles_execution_and_attribution(self) -> None:
        index = pd.bdate_range("2026-01-01", periods=80)
        assets = list("ABCDEF")
        base = np.arange(6, dtype=float)
        factors = pd.DataFrame(
            [np.roll(base, row // 5 % len(assets)) for row in range(len(index))],
            index=index,
            columns=assets,
        )
        time = np.arange(len(index), dtype=float)
        closes = pd.DataFrame(
            {
                asset: 100.0
                * np.exp(
                    np.cumsum(
                        0.0005
                        + 0.006
                        * np.sin(time / (4.0 + number))
                    )
                )
                for number, asset in enumerate(assets)
            },
            index=index,
        )
        volumes = pd.DataFrame(
            1_000_000.0,
            index=index,
            columns=assets,
        )
        construction = construct_signal_policy(factors, closes)
        simulation = simulate_targets(construction.targets, closes, volumes)
        ledger = build_decision_ledger(
            construction,
            simulation,
            closes,
            volumes,
        )
        attribution = attribution_metrics(
            ledger,
            simulation,
            simulation.daily.index,
        )

        self.assertTrue(attribution["reconciliation"]["passed"])
        self.assertGreater(
            attribution["reconciliation"]["variance_attributed_dates"],
            20,
        )
        self.assertGreater(
            attribution["concentration"][
                "maximum_absolute_variance_contribution_share"
            ],
            0.0,
        )
        self.assertLessEqual(
            attribution["concentration"][
                "maximum_absolute_variance_contribution_share"
            ],
            1.0,
        )
        self.assertEqual(
            len(ledger),
            len(simulation.daily) * len(assets),
        )
        timestamp = simulation.daily.index[-5]
        rows = ledger[ledger["timestamp"].eq(timestamp)]
        self.assertAlmostEqual(
            float(rows["gross_return_contribution"].sum()),
            float(simulation.daily.loc[timestamp, "gross_return"]),
        )
        self.assertAlmostEqual(
            float(rows["cost_contribution"].sum()),
            float(simulation.daily.loc[timestamp, "cost"]),
        )
        self.assertAlmostEqual(
            float(rows["net_return_contribution"].sum()),
            float(simulation.daily.loc[timestamp, "net_return"]),
        )

    def test_liquidity_capacity_uses_causal_adv_and_exact_trade_weights(self) -> None:
        index = pd.bdate_range("2026-01-01", periods=32)
        targets = pd.DataFrame(
            0.0,
            index=index,
            columns=["A", "B"],
        )
        targets.loc[index[10:19], ["A", "B"]] = [0.25, -0.25]
        targets.loc[index[21:26], ["A", "B"]] = [0.5, -0.5]
        closes = pd.DataFrame(
            100.0,
            index=index,
            columns=targets.columns,
        )
        volumes = pd.DataFrame(
            {"A": 1_000_000.0, "B": 2_000_000.0},
            index=index,
        )
        construction = SignalConstruction(
            targets=targets,
            states=pd.DataFrame(
                0,
                index=index,
                columns=targets.columns,
            ),
            ledger=pd.DataFrame(
                [
                    {
                        "timestamp": timestamp,
                        "asset": asset,
                        "factor": 0.0,
                        "percentile_score": 0.5,
                        "prior_signal_state": 0,
                        "signal_state": 0,
                        "signal_event": "stay_flat",
                        "tradable": True,
                        "permitted_direction": "dollar-neutral",
                        "mandate_id": "legacy-dollar-neutral",
                        "conviction": 0.0,
                        "trailing_volatility": 0.0,
                        "risk_strength": 0.0,
                        "allocation_status": "allocated",
                        "pre_governor_target_weight": float(
                            targets.loc[timestamp, asset]
                        ),
                        "risk_governor_status": "legacy_none",
                        "risk_estimation_observations": 0,
                        "risk_forecast_pre_annualized": 0.0,
                        "risk_forecast_post_annualized": 0.0,
                        "risk_volatility_ceiling_annualized": 0.0,
                        "risk_governor_scale": 1.0,
                        "prior_target_weight": 0.0,
                        "proposed_target_weight": float(
                            targets.loc[timestamp, asset]
                        ),
                        "target_delta": float(
                            targets.loc[timestamp, asset]
                        ),
                        "target_action": "hold_flat",
                        "diagonal_risk_budget_share": 0.0,
                    }
                    for timestamp in index
                    for asset in targets.columns
                ]
            ),
            scores=pd.DataFrame(
                0.5,
                index=index,
                columns=targets.columns,
            ),
            translation_values=pd.DataFrame(
                0.0,
                index=index,
                columns=targets.columns,
            ),
            translation_observations=pd.DataFrame(
                4,
                index=index,
                columns=targets.columns,
            ),
            translation={
                "method": "test-fixture",
                "evaluation_mode": "cross-sectional",
            },
        )
        simulation = simulate_targets(
            targets,
            closes,
            volumes,
            cost_bps=0.0,
            no_trade_one_way=0.0,
        )
        ledger = build_decision_ledger(
            construction,
            simulation,
            closes,
            volumes,
            cost_bps=0.0,
        )

        early = ledger[ledger["timestamp"].eq(index[10])]
        self.assertEqual(
            set(early["liquidity_capacity_status"]),
            {"insufficient_adv_history"},
        )
        self.assertEqual(
            float(early["portfolio_capacity_nav_1pct"].max()),
            0.0,
        )

        available = ledger[ledger["timestamp"].eq(index[21])]
        self.assertEqual(
            set(available["liquidity_capacity_status"]),
            {"available"},
        )
        self.assertAlmostEqual(
            float(available["portfolio_capacity_nav_1pct"].iloc[0]),
            10_000_000.0 / 3.0,
        )
        self.assertAlmostEqual(
            float(available["portfolio_capacity_nav_5pct"].iloc[0]),
            50_000_000.0 / 3.0,
        )
        binding = available[available["capacity_binding_asset"]]
        self.assertEqual(binding["asset"].tolist(), ["A"])
        self.assertAlmostEqual(
            float(
                available.loc[
                    available["asset"].eq("A"),
                    "reference_nav_adv_participation",
                ].iloc[0]
            ),
            0.003,
        )

        metrics = liquidity_capacity_metrics(
            ledger,
            simulation.daily.index,
        )
        self.assertEqual(metrics["status"], "available")
        self.assertGreater(metrics["trade_dates"], 2)
        self.assertGreater(metrics["available_trade_dates"], 0)
        self.assertGreater(metrics["unavailable_trade_dates"], 0)
        self.assertEqual(
            metrics["capacity_1pct"]["reference_nav_breach_rate"],
            0.0,
        )
        self.assertEqual(
            metrics["capacity_5pct"]["tenth_percentile_nav"],
            metrics["capacity_1pct"]["tenth_percentile_nav"] * 5.0,
        )

    def test_signal_and_risk_ledger_do_not_change_with_future_bars(self) -> None:
        index = pd.bdate_range("2026-01-01", periods=120)
        assets = list("ABCDEF")
        base = np.arange(6, dtype=float)
        factors = pd.DataFrame(
            [np.roll(base, row // 7 % len(assets)) for row in range(len(index))],
            index=index,
            columns=assets,
        )
        time = np.arange(len(index), dtype=float)
        closes = pd.DataFrame(
            {
                asset: 100.0
                * np.exp(
                    np.cumsum(
                        0.0005
                        + 0.007
                        * np.sin(time / (4.0 + number))
                    )
                )
                for number, asset in enumerate(assets)
            },
            index=index,
        )
        volumes = pd.DataFrame(
            1_000_000.0,
            index=index,
            columns=assets,
        )
        mandate = build_portfolio_mandate(None, assets)
        full_construction = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
        )
        full_simulation = simulate_targets(
            full_construction.targets,
            closes,
            volumes,
        )
        full_ledger = build_decision_ledger(
            full_construction,
            full_simulation,
            closes,
            volumes,
        )

        cut = 100
        prefix_construction = construct_signal_policy(
            factors.iloc[:cut],
            closes.iloc[:cut],
            mandate=mandate,
        )
        prefix_simulation = simulate_targets(
            prefix_construction.targets,
            closes.iloc[:cut],
            volumes.iloc[:cut],
        )
        prefix_ledger = build_decision_ledger(
            prefix_construction,
            prefix_simulation,
            closes.iloc[:cut],
            volumes.iloc[:cut],
        )
        shared_end = prefix_simulation.daily.index[-1]
        columns = [
            "timestamp",
            "asset",
            "signal_state",
            "signal_event",
            "pre_governor_target_weight",
            "risk_governor_status",
            "risk_estimation_observations",
            "risk_forecast_pre_annualized",
            "risk_forecast_post_annualized",
            "risk_governor_scale",
            "proposed_target_weight",
            "pretrade_weight",
            "executed_weight",
            "trade_weight",
            "liquidity_capacity_status",
            "liquidity_adv_observations",
            "causal_adv_dollar_volume",
            "reference_nav_adv_participation",
            "asset_capacity_nav_1pct",
            "asset_capacity_nav_5pct",
            "portfolio_capacity_nav_1pct",
            "portfolio_capacity_nav_5pct",
            "capacity_binding_asset",
            "regime",
            "component_variance",
            "variance_contribution_share",
        ]
        expected = full_ledger[
            full_ledger["timestamp"].le(shared_end)
        ][columns].reset_index(drop=True)
        actual = prefix_ledger[columns].reset_index(drop=True)
        pd.testing.assert_frame_equal(actual, expected)


class OhlcvPortfolioLabTests(unittest.TestCase):
    def test_template_runs_fast_and_emits_layered_portfolio_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project = make_portfolio_lab(directory)
            study = load_study(project, PORTFOLIO_STUDY_ID)
            self.assertEqual(study.definition.editable["paths"], ["factors/**"])
            self.assertEqual(
                study.definition.dependencies,
                {
                    "paths": [
                        "strategies/factor-claim.json",
                        "strategies/factor-population.json",
                        "strategies/portfolio-mandate.json",
                        "strategies/research-horizon.json",
                    ]
                },
            )
            self.assertEqual(
                study.definition.judge.paths,
                [
                    "judges/ohlcv_portfolio.py",
                    "judges/portfolio_core.py",
                ],
            )
            self.assertEqual(study.definition.judge.timeout_seconds, 180)
            self.assertEqual(len(study.dataset_hashes), 7)

            run = execute_study(project, PORTFOLIO_STUDY_ID)

            self.assertEqual(run.result["status"], "succeeded")
            metrics = run.result["metrics"]
            self.assertEqual(
                run.result["objective"]["metric"],
                "validation_net_sharpe",
            )
            self.assertTrue(math.isfinite(metrics["validation_net_sharpe"]))
            self.assertIn("factor", metrics)
            self.assertIn("portfolio", metrics)
            self.assertIn("implementation", metrics)
            self.assertIn("signal_policy", metrics)
            self.assertIn("attribution", metrics)
            self.assertIn("robustness", metrics)
            self.assertIn("liquidity_capacity", metrics)
            self.assertIn("position_lifecycle", metrics)
            self.assertIn("parameter_neighborhood", metrics)
            self.assertIn("translation_robustness", metrics)
            self.assertFalse(metrics["translation_robustness"]["applicable"])
            self.assertEqual(
                metrics["translation_robustness"]["reason"],
                "cross-sectional-mode-has-no-temporal-window",
            )
            neighborhood = metrics["parameter_neighborhood"]
            self.assertEqual(
                neighborhood["policy"]["base_configuration_id"],
                "base__band-005",
            )
            self.assertEqual(
                neighborhood["policy"]["selection_authority"],
                "context-only",
            )
            self.assertEqual(
                neighborhood["validation"]["aggregate"][
                    "configuration_count"
                ],
                15,
            )
            self.assertAlmostEqual(
                neighborhood["validation"]["configurations"][
                    "base__band-005"
                ]["performance"]["sharpe"],
                metrics["portfolio"]["validation"]["net"]["sharpe"],
            )
            self.assertTrue(
                metrics["position_lifecycle"]["validation"][
                    "reconciliation"
                ]["passed"]
            )
            self.assertEqual(
                metrics["liquidity_capacity"]["policy"][
                    "selection_authority"
                ],
                "context-only",
            )
            self.assertEqual(
                metrics["liquidity_capacity"]["policy"]["adv_window"],
                20,
            )
            self.assertGreater(
                metrics["liquidity_capacity"]["validation"][
                    "available_trade_dates"
                ],
                0,
            )
            self.assertIn("risk_governor", metrics["robustness"])
            self.assertEqual(
                metrics["robustness"]["risk_governor"][
                    "selectionAuthority"
                ],
                "diagnostic-only",
            )
            self.assertFalse(
                metrics["portfolio_mandate"]["construction"]["riskPolicy"][
                    "scaleUp"
                ]
            )
            self.assertEqual(
                metrics["portfolio_mandate"]["construction"]["family"],
                "dollar-neutral",
            )
            self.assertTrue(metrics["constraint_audit"]["passed"])
            self.assertFalse(metrics["split_protocol"]["candidateDependent"])
            self.assertFalse(
                metrics["split_protocol"]["targetCrossesBoundary"]
            )
            self.assertTrue(
                metrics["attribution"]["validation"]["reconciliation"][
                    "passed"
                ]
            )
            self.assertGreater(
                metrics["signal_policy"]["hysteresis_comparison"][
                    "validation"
                ]["transition_reduction"],
                0,
            )
            self.assertFalse(
                metrics["research_integrity"]["test_enters_selection"]
            )
            self.assertEqual(
                {item["kind"] for item in run.result["artifacts"]},
                {
                    "portfolio-report",
                    "portfolio-daily",
                    "portfolio-targets",
                    "portfolio-weights",
                    "portfolio-decisions",
                    "portfolio-position-episodes",
                    "portfolio-parameter-neighborhood",
                },
            )
            decision_path = run.root_dir / "artifacts" / "portfolio-decisions.csv"
            decision_columns = pd.read_csv(
                decision_path,
                nrows=1,
            ).columns
            self.assertIn("pre_governor_target_weight", decision_columns)
            self.assertIn("risk_governor_scale", decision_columns)
            self.assertIn("causal_adv_dollar_volume", decision_columns)
            self.assertIn("portfolio_capacity_nav_1pct", decision_columns)
            self.assertIn("capacity_binding_asset", decision_columns)
            episode_path = (
                run.root_dir / "artifacts" / "position-episodes.csv"
            )
            episode_columns = pd.read_csv(episode_path, nrows=1).columns
            self.assertIn("episode_id", episode_columns)
            self.assertIn("maximum_favorable_excursion", episode_columns)
            neighborhood_path = (
                run.root_dir
                / "artifacts"
                / "portfolio-parameter-neighborhood.json"
            )
            neighborhood_artifact = json.loads(
                neighborhood_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                neighborhood_artifact["baseConfigurationId"],
                "base__band-005",
            )
            self.assertEqual(
                len(neighborhood_artifact["rows"]),
                15
                * (
                    metrics["split_protocol"]["splits"]["validation"][
                        "eligibleSignalRows"
                    ]
                    + metrics["split_protocol"]["splits"]["test"][
                        "eligibleSignalRows"
                    ]
                ),
            )
            snapshot = build_studio_snapshot(workspace.root_dir)
            self.assertEqual(snapshot["projects"][0]["counts"]["runs"], 1)
            layers = snapshot["projects"][0]["runs"][0]["metricLayers"]
            self.assertEqual(layers["kind"], "portfolio")
            self.assertTrue(layers["constraintsPassed"])
            self.assertTrue(
                math.isfinite(layers["portfolio"]["testNetSharpe"])
            )
            self.assertTrue(
                layers["attribution"]["validationReconciliationPassed"]
            )
            self.assertIsNotNone(layers["positionLifecycle"])
            self.assertIsNotNone(layers["parameterNeighborhood"])
            self.assertIsNotNone(layers["translationRobustness"])
            self.assertFalse(layers["translationRobustness"]["applicable"])
            self.assertEqual(
                layers["parameterNeighborhood"][
                    "validationConfigurationCount"
                ],
                15,
            )
            self.assertGreater(
                layers["attribution"][
                    "validationMaximumAbsoluteRiskContributionShare"
                ],
                0.0,
            )
            self.assertGreater(
                layers["signalPolicy"][
                    "validationTransitionReductionRate"
                ],
                0.0,
            )
            self.assertEqual(
                layers["liquidityCapacity"]["selectionAuthority"],
                "context-only",
            )
            self.assertGreater(
                layers["liquidityCapacity"][
                    "validationTenthPercentileNav1Pct"
                ],
                0.0,
            )
            artifacts = {
                item["kind"]: run.root_dir / item["path"]
                for item in run.result["artifacts"]
            }
            decisions = pd.read_csv(
                artifacts["portfolio-decisions"],
                parse_dates=["timestamp"],
            )
            daily = pd.read_csv(
                artifacts["portfolio-daily"],
                parse_dates=["timestamp"],
            ).set_index("timestamp")
            grouped = decisions.groupby("timestamp")
            pd.testing.assert_series_equal(
                grouped["gross_return_contribution"].sum(),
                daily["gross_return"],
                check_names=False,
                atol=1e-10,
                rtol=1e-10,
            )
            pd.testing.assert_series_equal(
                grouped["cost_contribution"].sum(),
                daily["cost"],
                check_names=False,
                atol=1e-10,
                rtol=1e-10,
            )

    def test_test_only_bar_changes_do_not_change_selection_metric(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_portfolio_lab(directory)
            before = execute_study(project, PORTFOLIO_STUDY_ID)
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

            after = execute_study(project, PORTFOLIO_STUDY_ID)

            self.assertEqual(
                before.result["metrics"]["validation_net_sharpe"],
                after.result["metrics"]["validation_net_sharpe"],
            )
            self.assertEqual(
                before.result["metrics"]["signal_policy"]["validation"],
                after.result["metrics"]["signal_policy"]["validation"],
            )
            self.assertEqual(
                before.result["metrics"]["attribution"]["validation"],
                after.result["metrics"]["attribution"]["validation"],
            )
            self.assertNotEqual(
                before.result["metrics"]["portfolio"]["test"]["net"]["sharpe"],
                after.result["metrics"]["portfolio"]["test"]["net"]["sharpe"],
            )

    def test_known_factor_is_keep_and_future_leak_is_crash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_portfolio_lab(directory)
            session = start_session(project, PORTFOLIO_STUDY_ID)
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
            self.assertGreater(kept.result["improvement"], 10.0)

            candidate.write_text(LOOKAHEAD_FACTOR, encoding="utf-8")
            crashed = evaluate_experiment(
                project,
                session.manifest["id"],
                "Negative shift should be rejected as future leakage.",
            )
            self.assertEqual(crashed.result["verdict"], "CRASH")
            self.assertEqual(crashed.result["errors"][0]["code"], "factor.lookahead")
            integrity = session_snapshot(
                project,
                load_session(project, session.manifest["id"]),
            )["selectionIntegrity"]
            self.assertEqual(
                integrity["researchFamily"]["uniqueSourceTrials"],
                3,
            )
            self.assertEqual(
                integrity["researchFamily"]["failedSourceTrials"],
                1,
            )
            adjustment = integrity["selectionAdjustment"]
            self.assertEqual(adjustment["method"], "deflated-sharpe-ratio-v1")
            self.assertGreater(
                adjustment["statistics"]["probabilisticSharpeProbability"],
                adjustment["statistics"]["deflatedSharpeProbability"],
            )
            self.assertGreater(
                adjustment["statistics"]["expectedMaximumAnnualizedSharpe"],
                0.0,
            )

    def test_external_campaign_and_studio_share_portfolio_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project = make_portfolio_lab(directory)
            session = start_session(project, PORTFOLIO_STUDY_ID)
            researcher = Path(directory) / "portfolio_researcher.py"
            researcher.write_text(
                """\
import json
import os
from pathlib import Path

Path(os.environ["AUTOQUANT_WORKTREE"], "factors/candidate.py").write_text(
    '''from __future__ import annotations
import pandas as pd

def compute_factor(panel: pd.DataFrame) -> pd.Series:
    average = panel.groupby("asset", sort=False)["volume"].transform(
        lambda values: values.rolling(20, min_periods=20).mean()
    )
    return panel["volume"] / average - 1.0
'''
)
print(json.dumps({
    "schema_version": 1,
    "action": "propose",
    "strategy": "relative-volume-portfolio",
    "hypothesis": "Relative volume survives fixed portfolio costs.",
    "expected_effect": "Improve robust held-out net Sharpe.",
}))
""",
                encoding="utf-8",
            )
            campaign = run_campaign(
                project,
                session.manifest["id"],
                f"{shlex.quote(sys.executable)} {shlex.quote(str(researcher))}",
                max_turns=1,
                max_wall_seconds=240,
                turn_timeout_seconds=5,
            )

            self.assertEqual(campaign.result["verdicts"]["KEEP"], 1)
            observed = build_studio_snapshot(workspace.root_dir)["projects"][0]
            self.assertEqual(observed["counts"]["campaigns"], 1)
            self.assertTrue(
                all("metricLayers" in run for run in observed["runs"])
            )


if __name__ == "__main__":
    unittest.main()
