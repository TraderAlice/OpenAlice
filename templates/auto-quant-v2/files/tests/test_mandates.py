from __future__ import annotations

import copy
import unittest
from unittest import mock

import jsonschema
import numpy as np
import pandas as pd

from autoquant.briefs import (
    RESEARCH_REQUEST_JSON_SCHEMA,
    validate_research_request,
)
from autoquant.mandates import (
    PORTFOLIO_MANDATE_JSON_SCHEMA,
    build_portfolio_mandate,
    validate_portfolio_mandate,
)
from autoquant.project_templates.ohlcv_portfolio_lab.portfolio_core import (
    PortfolioFailure,
    constraint_audit,
    construct_signal_policy,
    decision_schedule_mask,
    decision_schedule_sessions,
    simulate_targets,
)
from autoquant.project_templates.ohlcv_portfolio_lab import portfolio_core
from autoquant.workspace import AutoQuantValidationError


UNIVERSE = ["A", "B", "C", "D", "E"]


def request(direction: str, assets: list[str]) -> dict:
    return {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "Mandate test",
        "question": "Which requested positions have governed evidence?",
        "decisionContext": "OpenAlice delegated a bounded research question.",
        "assets": [
            {"symbol": asset, "assetClass": "equity", "venue": "TEST"}
            for asset in assets
        ],
        "direction": direction,
        "horizon": "one month",
        "hypotheses": [],
        "constraints": [],
        "deliverables": ["portfolio evidence"],
        "source": {
            "system": "openalice",
            "workspaceId": "desk",
            "sessionId": "request",
            "artifactPath": None,
            "artifactRevision": None,
        },
    }


def panels() -> tuple[pd.DataFrame, pd.DataFrame]:
    index = pd.bdate_range("2025-01-02", periods=60)
    factors = pd.DataFrame(
        np.tile([5.0, 4.0, 3.0, 2.0, 1.0], (len(index), 1)),
        index=index,
        columns=UNIVERSE,
    )
    closes = pd.DataFrame(
        {
            asset: 100.0
            * np.exp(np.cumsum(np.full(len(index), 0.001 + number * 0.0001)))
            for number, asset in enumerate(UNIVERSE)
        },
        index=index,
    )
    return factors, closes


class PortfolioMandateTests(unittest.TestCase):
    def test_explicit_relative_value_pair_retains_named_context(self) -> None:
        raw = request("relative-value", ["A", "B", "C"])
        roles = {
            "A": "two-sided",
            "B": "two-sided",
            "C": "context-only",
        }
        for asset in raw["assets"]:
            asset["positionRole"] = roles[asset["symbol"]]

        mandate = build_portfolio_mandate(
            validate_research_request(raw),
            UNIVERSE,
        )

        self.assertEqual(
            mandate["source"]["assetPositionRoles"],
            "caller-supplied",
        )
        self.assertEqual(mandate["construction"]["family"], "dollar-neutral")
        self.assertEqual(mandate["construction"]["netRule"], "zero")
        self.assertEqual(mandate["tradableAssets"], ["A", "B"])
        self.assertEqual(mandate["contextAssets"], ["C", "D", "E"])
        self.assertEqual(
            mandate["construction"]["assetPositionRoles"],
            {
                "A": "two-sided",
                "B": "two-sided",
                "C": "context-only",
                "D": "context-only",
                "E": "context-only",
            },
        )
        self.assertEqual(validate_portfolio_mandate(mandate), mandate)

    def test_caller_asset_roles_govern_mixed_signs_and_context(self) -> None:
        factors, closes = panels()
        raw = request("relative-value", UNIVERSE)
        roles = {
            "A": "long-only",
            "B": "long-only",
            "C": "context-only",
            "D": "short-only",
            "E": "short-only",
        }
        for asset in raw["assets"]:
            asset["positionRole"] = roles[asset["symbol"]]
        raw["portfolioPolicy"] = {
            "grossLimit": 0.8,
            "maxAbsWeight": 0.3,
            "assetMaxAbsWeights": {"A": 0.25, "D": 0.2},
            "annualizedVolatilityCeiling": 1.0,
            "baseCostBps": 10.0,
            "noTradeOneWay": 0.0,
            "referenceNav": 1_000_000.0,
            "decisionSchedule": {
                "kind": "every-bars",
                "bars": 1,
                "anchor": "dataset-start",
            },
        }
        normalized = validate_research_request(raw)
        mandate = build_portfolio_mandate(normalized, UNIVERSE)

        self.assertEqual(
            mandate["source"]["assetPositionRoles"],
            "caller-supplied",
        )
        self.assertEqual(mandate["construction"]["family"], "asset-role")
        self.assertEqual(
            mandate["construction"]["netRule"],
            "bounded-by-side-limits",
        )
        self.assertEqual(mandate["construction"]["longGrossLimit"], 0.4)
        self.assertEqual(mandate["construction"]["shortGrossLimit"], 0.4)
        self.assertEqual(
            mandate["construction"]["assetPositionRoles"],
            roles,
        )
        self.assertNotIn("C", mandate["tradableAssets"])
        self.assertIn("C", mandate["contextAssets"])
        self.assertEqual(
            validate_portfolio_mandate(mandate),
            mandate,
        )
        jsonschema.validate(mandate, PORTFOLIO_MANDATE_JSON_SCHEMA)

        construction = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
            apply_risk_governor=False,
        )
        active = construction.targets[
            construction.targets.abs().sum(axis=1) > 1e-12
        ]
        self.assertFalse(active.empty)
        self.assertTrue((active[["A", "B"]] >= -1e-12).all().all())
        self.assertTrue((active[["D", "E"]] <= 1e-12).all().all())
        self.assertTrue((active["C"].abs() <= 1e-12).all())
        self.assertTrue(
            (
                active.clip(lower=0.0).sum(axis=1)
                <= mandate["construction"]["longGrossLimit"] + 1e-12
            ).all()
        )
        self.assertTrue(
            (
                (-active.clip(upper=0.0)).sum(axis=1)
                <= mandate["construction"]["shortGrossLimit"] + 1e-12
            ).all()
        )
        audit = constraint_audit(
            construction.targets,
            mandate=mandate,
        )
        self.assertTrue(audit["passed"])
        self.assertEqual(audit["asset_position_roles"], roles)
        latest = construction.ledger[
            construction.ledger["timestamp"]
            == construction.ledger["timestamp"].max()
        ].set_index("asset")
        self.assertEqual(latest.loc["A", "position_role"], "long-only")
        self.assertEqual(latest.loc["D", "position_role"], "short-only")
        self.assertEqual(latest.loc["C", "signal_event"], "context_only")

        partial = request("long", ["A", "B"])
        partial["assets"][0]["positionRole"] = "long-only"
        with self.assertRaises(AutoQuantValidationError):
            validate_research_request(partial)

        long_with_hedge = copy.deepcopy(raw)
        long_with_hedge["direction"] = "long"
        long_mandate = build_portfolio_mandate(
            validate_research_request(long_with_hedge),
            UNIVERSE,
        )
        self.assertEqual(
            long_mandate["construction"]["benchmark"],
            {
                "source": "direction-default",
                "kind": "equal-weight-long-capable",
                "asset": None,
                "weights": {
                    "A": 0.5,
                    "B": 0.5,
                    "C": 0.0,
                    "D": 0.0,
                    "E": 0.0,
                },
            },
        )

        tampered = copy.deepcopy(mandate)
        tampered["construction"]["assetPositionRoles"]["A"] = "short-only"
        with self.assertRaises(AutoQuantValidationError):
            validate_portfolio_mandate(tampered)

    def test_caller_decision_cadence_freezes_signals_and_ordinary_trades(self) -> None:
        factors, closes = panels()
        raw = request("long", ["A", "B"])
        raw["portfolioPolicy"] = {
            "grossLimit": 0.8,
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
        }
        mandate = build_portfolio_mandate(
            validate_research_request(raw),
            UNIVERSE,
        )
        construction = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
        )
        expected = pd.Series(
            [position % 4 == 0 for position in range(len(factors))],
            index=factors.index,
        )
        observed = (
            construction.ledger.groupby("timestamp")[
                "decision_eligible"
            ].first()
        )
        pd.testing.assert_series_equal(
            observed,
            expected,
            check_names=False,
            check_freq=False,
        )
        scheduled_holds = construction.ledger[
            (~construction.ledger["decision_eligible"])
            & construction.ledger["tradable"]
        ]
        self.assertTrue(
            (
                scheduled_holds["prior_signal_state"]
                == scheduled_holds["signal_state"]
            ).all()
        )
        self.assertTrue(
            np.allclose(scheduled_holds["target_delta"], 0.0)
        )
        self.assertTrue(
            (
                scheduled_holds["signal_event"]
                == "decision_schedule_hold"
            ).all()
        )

        volumes = pd.DataFrame(
            1_000_000.0,
            index=closes.index,
            columns=closes.columns,
        )
        simulation = simulate_targets(
            construction.targets,
            closes,
            volumes,
            mandate=mandate,
        )
        off_schedule = simulation.daily[
            ~simulation.daily["decision_eligible"]
        ]
        self.assertTrue((~off_schedule["ordinary_rebalance"]).all())
        self.assertTrue(
            (
                off_schedule["traded_notional"].le(1e-12)
                | off_schedule["risk_rebalance_override"]
                | off_schedule["constraint_rebalance_override"]
            ).all()
        )
        self.assertTrue(
            (
                off_schedule["execution_reason"].isin(
                    {
                        "decision_schedule_hold",
                        "risk_ceiling_override",
                        "mandate_constraint_override",
                        "mandate_and_risk_override",
                    }
                )
            ).all()
        )

        tampered = copy.deepcopy(mandate)
        tampered["implementationPolicy"]["decisionPolicy"]["bars"] = 3
        with self.assertRaises(AutoQuantValidationError):
            validate_portfolio_mandate(tampered)
        tampered = copy.deepcopy(mandate)
        tampered["implementationPolicy"]["decisionPolicy"][
            "anchor"
        ] = "session-start"
        with self.assertRaises(AutoQuantValidationError):
            validate_portfolio_mandate(tampered)

    def test_session_start_anchor_restarts_the_bar_ordinal(self) -> None:
        index = pd.DatetimeIndex(
            [
                "2026-11-24T14:45:00Z",
                "2026-11-24T15:00:00Z",
                "2026-11-24T15:15:00Z",
                "2026-11-24T15:30:00Z",
                "2026-11-27T14:45:00Z",
                "2026-11-27T15:00:00Z",
                "2026-11-27T15:15:00Z",
            ]
        )
        observed = decision_schedule_mask(
            index,
            {
                "kind": "every-bars",
                "bars": 4,
                "anchor": "session-start",
            },
        )
        expected = pd.Series(
            [True, False, False, False, True, False, False],
            index=index,
            name="decision_eligible",
        )
        pd.testing.assert_series_equal(observed, expected)

    def test_calendar_month_end_uses_official_xnys_sessions(self) -> None:
        index = pd.DatetimeIndex(
            [
                "2026-04-29",
                "2026-04-30",
                "2026-05-28",
                "2026-05-29",
                "2026-06-29",
                "2026-06-30",
                "2026-07-27",
                "2026-07-28",
            ]
        )
        policy = {"kind": "calendar-month-end"}
        observed = decision_schedule_mask(index, policy)
        expected = pd.Series(
            [False, True, False, True, False, True, False, False],
            index=index,
            name="decision_eligible",
        )
        pd.testing.assert_series_equal(observed, expected)
        self.assertEqual(
            decision_schedule_sessions(index, policy).tolist(),
            [
                "2026-04",
                "2026-04",
                "2026-05",
                "2026-05",
                "2026-06",
                "2026-06",
                "2026-07",
                "2026-07",
            ],
        )

    def test_calendar_month_policy_only_constructs_new_targets_on_decisions(
        self,
    ) -> None:
        factors, closes = panels()
        raw = request("long", ["A", "B"])
        raw["portfolioPolicy"] = {
            "grossLimit": 0.8,
            "maxAbsWeight": 0.3,
            "assetMaxAbsWeights": {},
            "annualizedVolatilityCeiling": 1.0,
            "baseCostBps": 10.0,
            "noTradeOneWay": 0.0,
            "referenceNav": 1_000_000.0,
            "decisionSchedule": {"kind": "calendar-month-end"},
        }
        mandate = build_portfolio_mandate(
            validate_research_request(raw),
            UNIVERSE,
        )
        eligible = decision_schedule_mask(
            factors.index,
            {"kind": "calendar-month-end"},
        )

        with mock.patch.object(
            portfolio_core,
            "_allocate_capped_up_to",
            wraps=portfolio_core._allocate_capped_up_to,
        ) as allocate:
            construction = construct_signal_policy(
                factors,
                closes,
                mandate=mandate,
                apply_risk_governor=False,
            )

        self.assertEqual(allocate.call_count, int(eligible.sum()))
        observed = construction.ledger.groupby("timestamp")[
            "decision_eligible"
        ].first()
        pd.testing.assert_series_equal(
            observed,
            eligible,
            check_names=False,
            check_freq=False,
        )
        held = construction.ledger[
            (~construction.ledger["decision_eligible"])
            & construction.ledger["tradable"]
        ]
        self.assertTrue(
            (held["signal_event"] == "decision_schedule_hold").all()
        )
        self.assertTrue(np.allclose(held["target_delta"], 0.0))

    def test_caller_policy_is_strict_and_content_locked_into_mandate(self) -> None:
        raw = request("long", ["A", "B"])
        raw["portfolioPolicy"] = {
            "grossLimit": 0.8,
            "maxAbsWeight": 0.2,
            "assetMaxAbsWeights": {"A": 0.1, "B": 0.15},
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
        normalized = validate_research_request(raw)
        jsonschema.validate(normalized, RESEARCH_REQUEST_JSON_SCHEMA)
        mandate = build_portfolio_mandate(normalized, UNIVERSE)

        self.assertEqual(
            mandate["source"]["portfolioPolicy"],
            "caller-supplied",
        )
        self.assertEqual(mandate["construction"]["grossLimit"], 0.8)
        self.assertEqual(mandate["construction"]["maxAbsWeight"], 0.2)
        self.assertEqual(
            mandate["construction"]["assetMaxAbsWeights"],
            {"A": 0.1, "B": 0.15, "C": 0.0, "D": 0.0, "E": 0.0},
        )
        self.assertEqual(
            mandate["construction"]["riskPolicy"][
                "annualizedVolatilityCeiling"
            ],
            0.12,
        )
        self.assertEqual(
            mandate["implementationPolicy"],
            {
                "baseCostBps": 17.5,
                "noTradeOneWay": 0.04,
                "referenceNav": 250_000.0,
                "decisionPolicy": {
                    "source": "caller-supplied",
                    "kind": "every-bars",
                    "bars": 4,
                    "anchor": "dataset-start",
                },
                "costModel": "linear-traded-notional-v1",
                "capacityModel": (
                    "trailing-dollar-volume-participation-v1"
                ),
            },
        )
        self.assertEqual(validate_portfolio_mandate(mandate), mandate)
        jsonschema.validate(mandate, PORTFOLIO_MANDATE_JSON_SCHEMA)

        for key, invalid in (
            ("grossLimit", float("nan")),
            ("baseCostBps", 1001.0),
            ("referenceNav", 0.0),
        ):
            with self.subTest(key=key):
                changed = copy.deepcopy(raw)
                changed["portfolioPolicy"][key] = invalid
                with self.assertRaises(AutoQuantValidationError):
                    validate_research_request(changed)
        for invalid_schedule in (
            {"kind": "every-bars", "bars": 0, "anchor": "dataset-start"},
            {"kind": "every-bars", "bars": 4, "anchor": "market-close"},
        ):
            changed = copy.deepcopy(raw)
            changed["portfolioPolicy"]["decisionSchedule"] = invalid_schedule
            with self.assertRaises(AutoQuantValidationError):
                validate_research_request(changed)

        neutral = request("long-short", UNIVERSE)
        neutral["portfolioPolicy"] = dict(raw["portfolioPolicy"])
        neutral["portfolioPolicy"]["grossLimit"] = 0.6
        neutral["portfolioPolicy"]["maxAbsWeight"] = 0.31
        with self.assertRaisesRegex(
            AutoQuantValidationError,
            "side budget",
        ):
            validate_research_request(neutral)

        for caps, message in (
            ({"Z": 0.1}, "requested assets"),
            ({"A": 0.0}, "positive"),
            ({"A": 0.21}, "maxAbsWeight"),
        ):
            with self.subTest(caps=caps):
                changed = copy.deepcopy(raw)
                changed["portfolioPolicy"]["assetMaxAbsWeights"] = caps
                with self.assertRaisesRegex(
                    AutoQuantValidationError,
                    message,
                ):
                    validate_research_request(changed)

    def test_request_mapping_is_strict_content_derived_and_schema_valid(self) -> None:
        mandate = build_portfolio_mandate(request("long", ["A", "B"]), UNIVERSE)

        self.assertEqual(mandate["source"]["direction"], "long")
        self.assertEqual(
            mandate["source"]["portfolioPolicy"],
            "reference-default",
        )
        self.assertEqual(mandate["construction"]["family"], "long-cash")
        self.assertEqual(
            mandate["construction"]["assetMaxAbsWeights"],
            {"A": 0.3, "B": 0.3, "C": 0.0, "D": 0.0, "E": 0.0},
        )
        self.assertEqual(mandate["tradableAssets"], ["A", "B"])
        self.assertEqual(mandate["contextAssets"], ["C", "D", "E"])
        self.assertEqual(
            mandate["construction"]["benchmark"],
            {
                "source": "direction-default",
                "kind": "equal-weight-long-tradable",
                "asset": None,
                "weights": {
                    "A": 0.5,
                    "B": 0.5,
                    "C": 0.0,
                    "D": 0.0,
                    "E": 0.0,
                },
            },
        )
        self.assertEqual(
            mandate["construction"]["riskPolicy"],
            {
                "method": "trailing-covariance-volatility-ceiling-v1",
                "annualizedVolatilityCeiling": 0.15,
                "covarianceWindow": 60,
                "minimumObservations": 20,
                "annualizationPeriods": 252,
                "scaleUp": False,
            },
        )
        self.assertEqual(validate_portfolio_mandate(mandate), mandate)
        jsonschema.Draft202012Validator(
            PORTFOLIO_MANDATE_JSON_SCHEMA,
            format_checker=jsonschema.FormatChecker(),
        ).validate(mandate)

        tampered = copy.deepcopy(mandate)
        tampered["tradableAssets"] = ["A", "C"]
        with self.assertRaisesRegex(
            AutoQuantValidationError,
            "Context assets|derived",
        ):
            validate_portfolio_mandate(tampered)

        risk_tampered = copy.deepcopy(mandate)
        risk_tampered["construction"]["riskPolicy"][
            "annualizedVolatilityCeiling"
        ] = 0.20
        with self.assertRaisesRegex(
            AutoQuantValidationError,
            "fixed direction contract|derived",
        ):
            validate_portfolio_mandate(risk_tampered)

    def test_directional_policy_trades_only_requested_sign_and_retains_cash(self) -> None:
        factors, closes = panels()
        for direction, assets, sign in (
            ("long", ["A", "B"], 1),
            ("short", ["D", "E"], -1),
        ):
            with self.subTest(direction=direction):
                mandate = build_portfolio_mandate(
                    request(direction, assets),
                    UNIVERSE,
                )
                construction = construct_signal_policy(
                    factors,
                    closes,
                    mandate=mandate,
                )
                active = construction.targets[
                    construction.targets.abs().sum(axis=1) > 1e-12
                ]
                self.assertFalse(active.empty)
                self.assertTrue(
                    (active[mandate["contextAssets"]].abs() <= 1e-12)
                    .all()
                    .all()
                )
                self.assertTrue((active[assets] * sign >= -1e-12).all().all())
                self.assertLessEqual(
                    float(active.abs().sum(axis=1).max()),
                    0.60 + 1e-9,
                )
                audit = constraint_audit(
                    construction.targets,
                    mandate=mandate,
                )
                self.assertTrue(audit["passed"])
                self.assertEqual(audit["maximum_context_weight"], 0.0)
                self.assertEqual(audit["maximum_opposite_exposure"], 0.0)
                context_rows = construction.ledger[
                    construction.ledger["asset"].isin(
                        mandate["contextAssets"]
                    )
                ]
                self.assertTrue((~context_rows["tradable"]).all())
                self.assertTrue(
                    (context_rows["signal_event"] == "context_only").all()
                )
                self.assertTrue(
                    (context_rows["allocation_status"] == "context_only").all()
                )

    def test_asset_caps_govern_each_target_and_survive_audit(self) -> None:
        factors, closes = panels()
        raw = request("long", ["A", "B"])
        raw["portfolioPolicy"] = {
            "grossLimit": 0.8,
            "maxAbsWeight": 0.3,
            "assetMaxAbsWeights": {"A": 0.1, "B": 0.2},
            "annualizedVolatilityCeiling": 1.0,
            "baseCostBps": 10.0,
            "noTradeOneWay": 0.05,
            "referenceNav": 1_000_000.0,
            "decisionSchedule": {
                "kind": "every-bars",
                "bars": 1,
                "anchor": "dataset-start",
            },
        }
        raw["benchmarkPolicy"] = {
            "kind": "asset",
            "symbol": "E",
        }
        mandate = build_portfolio_mandate(
            validate_research_request(raw),
            UNIVERSE,
        )

        construction = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
        )
        active = construction.targets[
            construction.targets.abs().sum(axis=1) > 1e-12
        ]

        self.assertFalse(active.empty)
        self.assertLessEqual(float(active["A"].abs().max()), 0.1 + 1e-9)
        self.assertLessEqual(float(active["B"].abs().max()), 0.2 + 1e-9)
        self.assertLessEqual(
            float(active.abs().sum(axis=1).max()),
            0.3 + 1e-9,
        )
        audit = constraint_audit(
            construction.targets,
            mandate=mandate,
        )
        self.assertTrue(audit["passed"])
        self.assertAlmostEqual(
            audit["maximum_asset_cap_excess"],
            0.0,
            places=12,
        )
        self.assertEqual(
            audit["asset_max_abs_weights"],
            {"A": 0.1, "B": 0.2, "C": 0.0, "D": 0.0, "E": 0.0},
        )
        self.assertEqual(
            mandate["construction"]["benchmark"],
            {
                "source": "caller-supplied",
                "kind": "single-asset-long",
                "asset": "E",
                "weights": {
                    "A": 0.0,
                    "B": 0.0,
                    "C": 0.0,
                    "D": 0.0,
                    "E": 1.0,
                },
            },
        )
        self.assertIn("E", mandate["contextAssets"])

        tampered = copy.deepcopy(mandate)
        tampered["construction"]["assetMaxAbsWeights"]["A"] = 0.11
        with self.assertRaisesRegex(
            AutoQuantValidationError,
            "derived",
        ):
            validate_portfolio_mandate(tampered)

        unknown = copy.deepcopy(raw)
        unknown["benchmarkPolicy"]["symbol"] = "Z"
        with self.assertRaisesRegex(ValueError, "benchmark"):
            build_portfolio_mandate(
                validate_research_request(unknown),
                UNIVERSE,
            )

        malformed = copy.deepcopy(raw)
        malformed["benchmarkPolicy"] = {
            "kind": "cash",
            "symbol": "SPY",
        }
        with self.assertRaisesRegex(
            AutoQuantValidationError,
            "Cash benchmark symbol",
        ):
            validate_research_request(malformed)

    def test_named_benchmark_changes_only_relative_evaluation(self) -> None:
        factors, closes = panels()
        volumes = pd.DataFrame(
            1_000_000.0,
            index=closes.index,
            columns=closes.columns,
        )
        default_request = request("long", ["A", "B"])
        named_request = copy.deepcopy(default_request)
        named_request["benchmarkPolicy"] = {
            "kind": "asset",
            "symbol": "E",
        }
        default_mandate = build_portfolio_mandate(
            validate_research_request(default_request),
            UNIVERSE,
        )
        named_mandate = build_portfolio_mandate(
            validate_research_request(named_request),
            UNIVERSE,
        )
        default_construction = construct_signal_policy(
            factors,
            closes,
            mandate=default_mandate,
        )
        named_construction = construct_signal_policy(
            factors,
            closes,
            mandate=named_mandate,
        )
        pd.testing.assert_frame_equal(
            default_construction.targets,
            named_construction.targets,
        )

        default_simulation = simulate_targets(
            default_construction.targets,
            closes,
            volumes,
            mandate=default_mandate,
        )
        named_simulation = simulate_targets(
            named_construction.targets,
            closes,
            volumes,
            mandate=named_mandate,
        )
        pd.testing.assert_series_equal(
            default_simulation.daily["gross_return"],
            named_simulation.daily["gross_return"],
        )
        pd.testing.assert_series_equal(
            default_simulation.daily["net_return"],
            named_simulation.daily["net_return"],
        )
        expected = (
            closes["E"].shift(-1) / closes["E"] - 1.0
        ).reindex(named_simulation.daily.index)
        pd.testing.assert_series_equal(
            named_simulation.daily["benchmark_return"],
            expected.rename("benchmark_return"),
            check_freq=False,
        )

        tampered = copy.deepcopy(named_mandate)
        tampered["construction"]["benchmark"]["weights"]["E"] = 0.9
        with self.assertRaisesRegex(
            AutoQuantValidationError,
            "benchmark|fixed request contract",
        ):
            validate_portfolio_mandate(tampered)

        cash_request = copy.deepcopy(default_request)
        cash_request["benchmarkPolicy"] = {
            "kind": "cash",
            "symbol": None,
        }
        cash_mandate = build_portfolio_mandate(
            validate_research_request(cash_request),
            UNIVERSE,
        )
        self.assertEqual(
            cash_mandate["construction"]["benchmark"],
            {
                "source": "caller-supplied",
                "kind": "cash",
                "asset": None,
                "weights": {
                    asset: 0.0 for asset in UNIVERSE
                },
            },
        )

    def test_fixed_weight_benchmark_round_trips_and_drives_returns(self) -> None:
        factors, closes = panels()
        volumes = pd.DataFrame(
            1_000_000.0,
            index=closes.index,
            columns=closes.columns,
        )
        raw = request("long", ["A", "B", "C"])
        raw["benchmarkPolicy"] = {
            "kind": "fixed-weights",
            "weights": {
                "A": 0.5,
                "B": 0.3,
                "C": 0.2,
            },
        }
        normalized = validate_research_request(raw)
        mandate = build_portfolio_mandate(normalized, UNIVERSE)

        self.assertEqual(
            mandate["construction"]["benchmark"],
            {
                "source": "caller-supplied",
                "kind": "fixed-weights",
                "asset": None,
                "weights": {
                    "A": 0.5,
                    "B": 0.3,
                    "C": 0.2,
                    "D": 0.0,
                    "E": 0.0,
                },
            },
        )
        self.assertEqual(validate_portfolio_mandate(mandate), mandate)
        jsonschema.validate(mandate, PORTFOLIO_MANDATE_JSON_SCHEMA)

        construction = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
        )
        simulation = simulate_targets(
            construction.targets,
            closes,
            volumes,
            mandate=mandate,
        )
        expected = (
            closes.pct_change().shift(-1)
            * pd.Series(
                {"A": 0.5, "B": 0.3, "C": 0.2, "D": 0.0, "E": 0.0}
            )
        ).sum(axis=1, min_count=1).reindex(simulation.daily.index)
        pd.testing.assert_series_equal(
            simulation.daily["benchmark_return"],
            expected.rename("benchmark_return"),
            check_freq=False,
        )

        tampered = copy.deepcopy(mandate)
        tampered["construction"]["benchmark"]["weights"]["A"] = 0.4
        with self.assertRaisesRegex(
            AutoQuantValidationError,
            "benchmark|fixed request contract",
        ):
            validate_portfolio_mandate(tampered)

        unknown = copy.deepcopy(raw)
        unknown["benchmarkPolicy"]["weights"] = {"A": 0.5, "Z": 0.5}
        with self.assertRaisesRegex(
            AutoQuantValidationError,
            "requested",
        ):
            validate_research_request(unknown)

    def test_underfunded_relative_value_stays_flat_instead_of_trading_peers(self) -> None:
        factors, closes = panels()
        mandate = build_portfolio_mandate(
            request("relative-value", ["A", "E"]),
            UNIVERSE,
        )
        construction = construct_signal_policy(
            factors,
            closes,
            mandate=mandate,
        )

        self.assertTrue(
            (construction.targets.abs().sum(axis=1) <= 1e-12).all()
        )
        with self.assertRaisesRegex(PortfolioFailure, "No active targets"):
            constraint_audit(construction.targets, mandate=mandate)
        tradable_rows = construction.ledger[
            construction.ledger["tradable"]
        ]
        self.assertIn(
            "insufficient_side_breadth",
            set(tradable_rows["allocation_status"]),
        )

    def test_directional_all_cash_book_is_a_valid_mandate_outcome(self) -> None:
        mandate = build_portfolio_mandate(
            request("long", ["A", "B"]),
            UNIVERSE,
        )
        targets = pd.DataFrame(
            0.0,
            index=pd.bdate_range("2025-01-02", periods=4),
            columns=UNIVERSE,
        )

        audit = constraint_audit(targets, mandate=mandate)

        self.assertTrue(audit["passed"])
        self.assertEqual(audit["active_dates"], 0)
        self.assertEqual(audit["maximum_gross_exposure"], 0.0)
        self.assertEqual(audit["maximum_context_weight"], 0.0)

    def test_template_default_explicitly_preserves_research_neutral_behavior(self) -> None:
        mandate = build_portfolio_mandate(None, UNIVERSE)

        self.assertEqual(mandate["source"]["kind"], "template-default")
        self.assertEqual(mandate["source"]["direction"], "research-only")
        self.assertEqual(mandate["tradableAssets"], UNIVERSE)
        self.assertEqual(mandate["contextAssets"], [])
        self.assertEqual(mandate["construction"]["family"], "dollar-neutral")
        self.assertEqual(
            mandate["construction"]["benchmark"],
            {
                "source": "direction-default",
                "kind": "equal-weight-long-research-universe",
                "asset": None,
                "weights": {
                    asset: 0.2 for asset in UNIVERSE
                },
            },
        )


if __name__ == "__main__":
    unittest.main()
