from __future__ import annotations

import csv
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import jsonschema

from autoquant.portfolio_explorer import (
    PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA,
    ParsedDaily,
    _diversification_stress_projection,
    _liquidity_capacity_projection,
    _next_signal_triggers,
    load_portfolio_diagnostics,
)
from autoquant.runs import execute_study
from autoquant.studio import build_studio_snapshot
from autoquant.studies import hash_file
from autoquant.templates import OHLCV_STUDY_ID, PORTFOLIO_STUDY_ID
from autoquant.workspace import AutoQuantValidationError, create_project, initialize_workspace


def make_lab(root: Path, *, template: str = "ohlcv-portfolio-lab"):
    workspace = initialize_workspace(root / "workspace")
    project = create_project(
        workspace.root_dir,
        "decision-lab",
        template=template,
    )
    study_id = (
        PORTFOLIO_STUDY_ID
        if template == "ohlcv-portfolio-lab"
        else OHLCV_STUDY_ID
    )
    return workspace, project, execute_study(project, study_id)


def rehash_run(run_root: Path) -> None:
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


class PortfolioDecisionExplorerTests(unittest.TestCase):
    def test_diversification_stress_has_explicit_unavailable_single_and_flat_states(
        self,
    ) -> None:
        dates = [
            "2026-01-01",
            "2026-01-02",
            "2026-01-03",
            "2026-01-04",
        ]
        universe = ["AAA", "BBB"]
        forward = {
            "2026-01-01": {"AAA": 0.01, "BBB": 0.02},
            "2026-01-02": {"AAA": -0.01, "BBB": 0.01},
            "2026-01-03": {"AAA": 0.02, "BBB": -0.01},
            "2026-01-04": {"AAA": 0.0, "BBB": 0.0},
        }
        weights = {
            "2026-01-01": {"AAA": 0.0, "BBB": 0.0},
            "2026-01-02": {"AAA": 0.5, "BBB": 0.0},
            "2026-01-03": {"AAA": 0.5, "BBB": 0.0},
            "2026-01-04": {"AAA": 0.0, "BBB": 0.0},
        }
        decisions = {}
        for timestamp in dates:
            variance = (
                0.000025 if timestamp == "2026-01-03" else 0.0
            )
            for asset in universe:
                component = (
                    variance
                    if timestamp == "2026-01-03" and asset == "AAA"
                    else 0.0
                )
                decisions[(timestamp, asset)] = {
                    "asset": asset,
                    "executed_weight": weights[timestamp][asset],
                    "asset_forward_return": forward[timestamp][asset],
                    "portfolio_variance": variance,
                    "component_variance": component,
                    "variance_contribution_share": (
                        component / variance if variance else 0.0
                    ),
                }
        projection = _diversification_stress_projection(
            ParsedDaily(dates=dates, rows=[]),
            universe,
            decisions,
            {
                "validation": {
                    "start": "2026-01-02",
                    "signalEnd": "2026-01-03",
                    "end": "2026-01-03",
                    "role": "selection",
                },
                "test": {
                    "start": "2026-01-04",
                    "signalEnd": "2026-01-04",
                    "end": "2026-01-04",
                    "role": "visible-audit",
                },
            },
            {
                "riskPolicy": {
                    "annualizedVolatilityCeiling": 0.15,
                    "covarianceWindow": 3,
                    "minimumObservations": 2,
                    "annualizationPeriods": 252,
                }
            },
        )

        self.assertEqual(projection["current"]["state"], "flat")
        self.assertEqual(
            projection["current"]["sampleForecastAnnualized"],
            0.0,
        )
        self.assertIsNone(projection["current"]["stressMultiplier"])
        self.assertIsNone(projection["current"]["effectiveRiskBets"])
        self.assertEqual(
            projection["validation"]["unavailableDates"],
            1,
        )
        self.assertEqual(
            projection["validation"]["availableDates"],
            1,
        )
        maximum = projection["validation"]["maximumStressBook"]
        assert maximum is not None
        self.assertAlmostEqual(maximum["stressMultiplier"], 1.0)
        self.assertAlmostEqual(maximum["effectiveRiskBets"], 1.0)
        self.assertEqual(projection["test"]["flatDates"], 1)
        self.assertIsNone(
            projection["test"]["maximumStressMultiplier"]
        )

    def test_state_dependent_next_signal_triggers_are_explicit(self) -> None:
        parameters = {
            "long_entry_percentile": 0.75,
            "long_exit_percentile": 0.55,
            "short_exit_percentile": 0.45,
            "short_entry_percentile": 0.25,
        }
        cases = [
            (
                "long-cash",
                0,
                0.70,
                [("enter_long", ">=", 0.75, 0.05)],
            ),
            (
                "long-cash",
                1,
                0.80,
                [("exit_long", "<", 0.55, 0.25)],
            ),
            (
                "short-cash",
                0,
                0.30,
                [("enter_short", "<=", 0.25, 0.05)],
            ),
            (
                "short-cash",
                -1,
                0.20,
                [("exit_short", ">", 0.45, 0.25)],
            ),
            (
                "dollar-neutral",
                0,
                0.60,
                [
                    ("enter_long", ">=", 0.75, 0.15),
                    ("enter_short", "<=", 0.25, 0.35),
                ],
            ),
            (
                "dollar-neutral",
                1,
                0.80,
                [
                    ("exit_long", "<", 0.55, 0.25),
                    ("reverse_long_to_short", "<=", 0.25, 0.55),
                ],
            ),
        ]
        for family, state, score, expected in cases:
            with self.subTest(family=family, state=state):
                observed = _next_signal_triggers(
                    family=family,
                    signal_state=state,
                    score=score,
                    parameters=parameters,
                )
                self.assertEqual(
                    [
                        (
                            item["event"],
                            item["comparator"],
                            item["threshold"],
                            round(item["distance"], 10),
                        )
                        for item in observed
                    ],
                    expected,
                )
        unavailable = _next_signal_triggers(
            family="dollar-neutral",
            signal_state=-1,
            score=None,
            parameters=parameters,
        )
        self.assertEqual(
            [item["distance"] for item in unavailable],
            [None, None],
        )

    def test_liquidity_projection_excludes_the_purged_boundary_row(
        self,
    ) -> None:
        policy = {
            "method": "trailing-average-dollar-volume-capacity-v1",
            "adv_window": 20,
            "participation_limits": [0.01, 0.05],
            "reference_nav": 1_000_000.0,
            "selection_authority": "context-only",
            "trading_authority": "none",
        }

        def split_metrics(capacity: float) -> dict[str, object]:
            return {
                "status": "available",
                "trade_dates": 1,
                "available_trade_dates": 1,
                "unavailable_trade_dates": 0,
                "trade_date_coverage": 1.0,
                "binding_asset_counts_1pct": {"A": 1},
                "capacity_1pct": {
                    "status": "available",
                    "observations": 1,
                    "minimum_nav": capacity,
                    "tenth_percentile_nav": capacity,
                    "median_nav": capacity,
                    "reference_nav_breach_rate": 0.0,
                },
                "capacity_5pct": {
                    "status": "available",
                    "observations": 1,
                    "minimum_nav": capacity * 5,
                    "tenth_percentile_nav": capacity * 5,
                    "median_nav": capacity * 5,
                    "reference_nav_breach_rate": 0.0,
                },
            }

        decisions = [
            {
                "timestamp": "2026-01-01",
                "asset": "A",
                "liquidity_capacity_status": "available",
                "portfolio_capacity_nav_1pct": 2_000_000.0,
                "portfolio_capacity_nav_5pct": 10_000_000.0,
                "capacity_binding_asset": True,
                "reference_nav_adv_participation": 0.005,
            },
            {
                "timestamp": "2026-01-02",
                "asset": "A",
                "liquidity_capacity_status": "available",
                "portfolio_capacity_nav_1pct": 1_500_000.0,
                "portfolio_capacity_nav_5pct": 7_500_000.0,
                "capacity_binding_asset": True,
                "reference_nav_adv_participation": 0.006,
            },
            {
                "timestamp": "2026-01-03",
                "asset": "A",
                "liquidity_capacity_status": "available",
                "portfolio_capacity_nav_1pct": 3_000_000.0,
                "portfolio_capacity_nav_5pct": 15_000_000.0,
                "capacity_binding_asset": True,
                "reference_nav_adv_participation": 0.004,
            },
        ]
        projection = _liquidity_capacity_projection(
            {
                "metrics": {
                    "liquidity_capacity": {
                        "policy": policy,
                        "validation": split_metrics(2_000_000.0),
                        "test": split_metrics(3_000_000.0),
                    }
                }
            },
            decisions,
            {
                "validation": {
                    "start": "2026-01-01",
                    "signalEnd": "2026-01-01",
                    "end": "2026-01-02",
                },
                "test": {
                    "start": "2026-01-03",
                    "signalEnd": "2026-01-03",
                    "end": "2026-01-03",
                },
            },
        )

        self.assertEqual(projection["validation"]["tradeDates"], 1)
        self.assertEqual(
            projection["validation"]["capacity1Pct"]["minimumNav"],
            2_000_000.0,
        )

    def test_projection_preserves_full_path_anchors_book_and_attribution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))

            diagnostics = load_portfolio_diagnostics(
                project,
                run.result["id"],
                point_limit=64,
            )

            self.assertEqual(
                diagnostics["kind"],
                "autoquant-portfolio-diagnostics",
            )
            self.assertEqual(diagnostics["run"]["inputHash"], run.result["inputHash"])
            self.assertTrue(diagnostics["mandate"]["available"])
            self.assertFalse(
                diagnostics["mandate"]["riskPolicy"]["scaleUp"]
            )
            self.assertTrue(diagnostics["riskGovernor"]["available"])
            self.assertEqual(
                diagnostics["riskGovernor"]["selectionAuthority"],
                "diagnostic-only",
            )
            self.assertTrue(diagnostics["executedBookRisk"]["available"])
            self.assertEqual(
                diagnostics["executedBookRisk"]["selectionAuthority"],
                "context-only",
            )
            self.assertEqual(
                diagnostics["executedBookRisk"]["validation"][
                    "executedBreachDates"
                ],
                0,
            )
            self.assertLessEqual(
                diagnostics["executedBookRisk"]["validation"][
                    "maximumExecutedForecastAnnualized"
                ],
                diagnostics["mandate"]["riskPolicy"][
                    "annualizedVolatilityCeiling"
                ]
                + 1e-12,
            )
            self.assertTrue(diagnostics["liquidityCapacity"]["available"])
            self.assertEqual(
                diagnostics["liquidityCapacity"]["selectionAuthority"],
                "context-only",
            )
            self.assertEqual(
                diagnostics["liquidityCapacity"]["policy"]["advWindow"],
                20,
            )
            self.assertAlmostEqual(
                diagnostics["liquidityCapacity"]["validation"][
                    "capacity1Pct"
                ]["tenthPercentileNav"],
                run.result["metrics"]["liquidity_capacity"]["validation"][
                    "capacity_1pct"
                ]["tenth_percentile_nav"],
                places=5,
            )
            self.assertIsNotNone(
                diagnostics["liquidityCapacity"]["latestTrade"]
            )
            self.assertTrue(
                diagnostics["positionLifecycle"]["available"]
            )
            self.assertEqual(
                diagnostics["positionLifecycle"]["selectionAuthority"],
                "context-only",
            )
            self.assertTrue(
                diagnostics["positionLifecycle"]["validation"][
                    "reconciliation"
                ]["passed"]
            )
            self.assertGreater(
                diagnostics["positionLifecycle"]["validation"][
                    "activeSegments"
                ],
                0,
            )
            self.assertTrue(
                diagnostics["parameterNeighborhood"]["available"]
            )
            self.assertEqual(
                diagnostics["parameterNeighborhood"]["policy"][
                    "selectionAuthority"
                ],
                "context-only",
            )
            self.assertEqual(
                diagnostics["parameterNeighborhood"]["policy"][
                    "configurationCount"
                ],
                15,
            )
            self.assertEqual(
                len(
                    diagnostics["parameterNeighborhood"]["validation"][
                        "configurations"
                    ]
                ),
                15,
            )
            base_cell = next(
                item
                for item in diagnostics["parameterNeighborhood"][
                    "validation"
                ]["configurations"]
                if item["isBase"]
            )
            self.assertEqual(base_cell["id"], "base__band-005")
            self.assertAlmostEqual(
                base_cell["netSharpe"],
                run.result["metrics"]["portfolio"]["validation"]["net"][
                    "sharpe"
                ],
            )
            self.assertEqual(diagnostics["path"]["sampledRows"], 64)
            self.assertGreater(diagnostics["path"]["totalRows"], 64)
            sampled_dates = {
                point["timestamp"] for point in diagnostics["path"]["points"]
            }
            self.assertIn(
                diagnostics["path"]["summary"]["maximumDrawdownAt"],
                sampled_dates,
            )
            self.assertIn(
                diagnostics["path"]["summary"]["maximumOneWayTurnoverAt"],
                sampled_dates,
            )
            self.assertEqual(
                diagnostics["path"]["points"][0]["timestamp"],
                run.result["metrics"]["split_protocol"]["splits"]["train"]["start"],
            )
            for split in ("train", "validation", "test"):
                contract = run.result["metrics"]["split_protocol"]["splits"][split]
                self.assertIn(contract["start"], sampled_dates)
                self.assertIn(contract["signalEnd"], sampled_dates)

            daily_path = run.root_dir / "artifacts" / "daily-portfolio.csv"
            with daily_path.open(encoding="utf-8", newline="") as handle:
                daily = list(csv.DictReader(handle))
            expected_net = math.prod(1.0 + float(row["net_return"]) for row in daily) - 1.0
            self.assertAlmostEqual(
                diagnostics["path"]["summary"]["netTotalReturn"],
                expected_net,
                places=12,
            )
            latest = diagnostics["currentBook"]
            self.assertEqual(latest["timestamp"], daily[-1]["timestamp"])
            self.assertLessEqual(latest["riskGovernorScale"], 1.0)
            self.assertLessEqual(
                latest["riskForecastPostAnnualized"],
                latest["riskVolatilityCeilingAnnualized"] + 1e-12,
            )
            self.assertLessEqual(
                latest["executedRiskForecastAnnualized"],
                latest["executionRiskCeilingAnnualized"] + 1e-12,
            )
            self.assertEqual(len(latest["positions"]), 6)
            self.assertAlmostEqual(
                sum(abs(item["executedWeight"]) for item in latest["positions"]),
                latest["grossExposure"],
                places=9,
            )
            decision = diagnostics["mechanicalDecision"]
            self.assertEqual(decision["timestamp"], latest["timestamp"])
            self.assertEqual(decision["tradingAuthority"], "none")
            self.assertEqual(
                decision["distanceSemantics"],
                (
                    "current-cross-sectional-percentile-points-"
                    "with-peer-ranks-held-fixed"
                ),
            )
            self.assertAlmostEqual(
                decision["executionGate"]["proposedOneWayTurnover"],
                0.5
                * sum(
                    abs(item["proposedTradeWeight"])
                    for item in decision["positions"]
                ),
                places=9,
            )
            self.assertAlmostEqual(
                decision["executionGate"]["executedGross"],
                latest["grossExposure"],
                places=9,
            )
            self.assertTrue(
                all(
                    item["nearestTrigger"] is not None
                    for item in decision["positions"]
                    if item["tradable"] and item["scoreAvailable"]
                )
            )
            sizing = diagnostics["sizingAnatomy"]
            self.assertEqual(
                sizing["timestamp"],
                decision["timestamp"],
            )
            self.assertEqual(sizing["tradingAuthority"], "none")
            self.assertAlmostEqual(
                sizing["construction"]["rawGross"],
                decision["targetGate"]["preGovernorGross"],
                places=9,
            )
            self.assertAlmostEqual(
                sizing["construction"]["governedGross"],
                decision["targetGate"]["governedTargetGross"],
                places=9,
            )
            self.assertAlmostEqual(
                sum(
                    item["componentRiskShare"]
                    for item in sizing["positions"]
                ),
                1.0,
                places=9,
            )
            for position in sizing["positions"]:
                expected_strength = (
                    position["conviction"]
                    / position["trailingVolatility"]
                    if (
                        position["conviction"] > 0.0
                        and position["trailingVolatility"] is not None
                    )
                    else 0.0
                )
                self.assertAlmostEqual(
                    position["riskStrength"],
                    expected_strength,
                    places=8,
                )
                self.assertAlmostEqual(
                    position["governedWeight"],
                    position["rawWeight"]
                    * position["riskGovernorScale"],
                    places=9,
                )
            diversification = diagnostics["diversificationStress"]
            self.assertEqual(
                diversification["method"],
                "causal-executed-book-diversification-stress-v1",
            )
            self.assertEqual(
                diversification["authority"],
                "context-only",
            )
            self.assertEqual(
                diversification["selectionAuthority"],
                "none",
            )
            self.assertFalse(diversification["testEntersSelection"])
            self.assertEqual(
                diversification["shock"]["method"],
                (
                    "observed-to-perfect-position-aligned-"
                    "covariance-blend-ladder"
                ),
            )
            self.assertEqual(
                [
                    item["blendToPerfectCorrelation"]
                    for item in diversification["shock"]["scenarios"]
                ],
                [0.25, 0.5, 1.0],
            )
            current_stress = diversification["current"]
            self.assertEqual(current_stress["state"], "available")
            self.assertGreaterEqual(
                current_stress["stressMultiplier"],
                1.0,
            )
            self.assertGreaterEqual(
                current_stress["effectiveRiskBets"],
                1.0,
            )
            self.assertLessEqual(
                current_stress["effectiveRiskBets"],
                current_stress["activeAssets"],
            )
            self.assertAlmostEqual(
                current_stress["sampleForecastAnnualized"],
                latest["executedRiskForecastAnnualized"],
                places=9,
            )
            self.assertAlmostEqual(
                sum(
                    item["stressRiskShare"]
                    for item in current_stress["positions"]
                ),
                1.0,
                places=9,
            )
            scenario_forecasts = [
                item["forecastAnnualized"]
                for item in current_stress["scenarios"]
            ]
            self.assertEqual(
                scenario_forecasts,
                sorted(scenario_forecasts),
            )
            self.assertEqual(
                [
                    item["id"]
                    for item in current_stress["scenarios"]
                ],
                [
                    "quarter-breakdown",
                    "half-breakdown",
                    "perfect-aligned",
                ],
            )
            self.assertAlmostEqual(
                scenario_forecasts[-1],
                current_stress[
                    "perfectCorrelationForecastAnnualized"
                ],
                places=9,
            )
            for split_name, role in (
                ("validation", "selection"),
                ("test", "visible-audit"),
            ):
                split_stress = diversification[split_name]
                self.assertEqual(split_stress["role"], role)
                self.assertGreater(split_stress["availableDates"], 0)
                self.assertGreaterEqual(
                    split_stress["medianStressMultiplier"],
                    1.0,
                )
                self.assertGreaterEqual(
                    split_stress["medianEffectiveRiskBets"],
                    1.0,
                )
                self.assertIsNotNone(
                    split_stress["maximumStressBook"],
                )
                self.assertEqual(
                    [
                        item["id"]
                        for item in split_stress["scenarios"]
                    ],
                    [
                        "quarter-breakdown",
                        "half-breakdown",
                        "perfect-aligned",
                    ],
                )
            viability = diagnostics["strategyViability"]
            self.assertEqual(
                viability["authority"],
                "research-prioritization-only",
            )
            self.assertEqual(viability["tradingAuthority"], "none")
            self.assertFalse(
                viability["diagnosis"]["testEntersDiagnosis"]
            )
            self.assertEqual(viability["validation"]["role"], "selection")
            self.assertEqual(viability["test"]["role"], "visible-audit")
            self.assertEqual(
                [item["costBps"] for item in viability["validation"]["costStress"]],
                [0.0, 10.0, 25.0],
            )
            self.assertAlmostEqual(
                viability["validation"]["costStress"][0]["netSharpe"],
                viability["validation"]["gross"]["sharpe"],
                places=9,
            )
            self.assertAlmostEqual(
                viability["validation"]["costStress"][1]["netSharpe"],
                viability["validation"]["net"]["sharpe"],
                places=9,
            )
            self.assertGreater(
                viability["validation"]["temporal"]["months"],
                0,
            )
            expected_stage = (
                "factor-edge-absent"
                if viability["validation"]["factorRankIc"] <= 0.0
                else "factor-not-monetized"
                if viability["validation"]["gross"]["sharpe"] <= 0.0
                else "cost-fragile"
                if viability["validation"]["net"]["sharpe"] <= 0.0
                else "post-cost-edge-positive"
            )
            self.assertEqual(
                viability["diagnosis"]["stage"],
                expected_stage,
            )
            monetization = diagnostics["signalMonetization"]
            self.assertEqual(
                monetization["authority"],
                "research-prioritization-only",
            )
            self.assertEqual(
                monetization["tradingAuthority"],
                "none",
            )
            self.assertFalse(
                monetization["semantics"]["counterfactualCompounding"]
            )
            self.assertEqual(
                monetization["semantics"]["evaluationMode"],
                "cross-sectional",
            )
            self.assertEqual(
                monetization["semantics"]["intentConstruction"],
                "mandate-equal-active-side-budget",
            )
            self.assertFalse(
                monetization["diagnosis"]["testEntersDiagnosis"]
            )
            self.assertEqual(
                monetization["validation"]["role"],
                "selection",
            )
            self.assertEqual(
                monetization["test"]["role"],
                "visible-audit",
            )
            self.assertFalse(
                monetization["validation"]["reconciliation"][
                    "relativeValueIntentTargetParityApplicable"
                ]
            )
            self.assertEqual(
                monetization["validation"]["reconciliation"][
                    "maximumRelativeValueIntentTargetError"
                ],
                0.0,
            )
            self.assertEqual(
                [
                    item["id"]
                    for item in monetization["validation"]["stages"]
                ],
                [
                    "equalIntent",
                    "preGovernorSizing",
                    "governedTarget",
                    "executedGross",
                    "executedNet",
                ],
            )
            self.assertEqual(
                [
                    item["id"]
                    for item in monetization["validation"]["deltas"]
                ],
                [
                    "sizingAndCaps",
                    "riskGovernor",
                    "executionRetention",
                    "tradingCost",
                ],
            )
            self.assertTrue(
                monetization["validation"]["reconciliation"]["passed"]
            )
            self.assertEqual(
                len(monetization["validation"]["byAsset"]),
                len(diagnostics["universe"]),
            )

            first_asset = diagnostics["universe"][0]
            expected = run.result["metrics"]["attribution"]["validation"]["by_asset"][
                first_asset
            ]
            observed = diagnostics["attribution"]["validation"][0]
            self.assertEqual(observed["asset"], first_asset)
            self.assertEqual(
                observed["annualizedNetContribution"],
                expected["annualized_net_contribution"],
            )
            self.assertLessEqual(len(diagnostics["recentTransitions"]), 40)
            transition_order = [
                (item["timestamp"], diagnostics["universe"].index(item["asset"]))
                for item in diagnostics["recentTransitions"]
            ]
            self.assertEqual(transition_order, sorted(transition_order))
            jsonschema.validate(
                diagnostics,
                PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA,
            )

    def test_rehashed_component_risk_tamper_is_rejected_by_covariance(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "artifacts" / "portfolio-decisions.csv"
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            validation = run.result["metrics"]["split_protocol"]["splits"][
                "validation"
            ]
            timestamp = next(
                row["timestamp"]
                for row in rows
                if (
                    validation["start"]
                    <= row["timestamp"]
                    <= validation["signalEnd"]
                    and float(row["portfolio_variance"]) > 1e-12
                )
            )
            selected = [
                row for row in rows if row["timestamp"] == timestamp
            ][:2]
            portfolio_variance = float(
                selected[0]["portfolio_variance"]
            )
            offset = portfolio_variance * 0.01
            for sign, row in zip((1.0, -1.0), selected):
                row["component_variance"] = str(
                    float(row["component_variance"]) + sign * offset
                )
                row["variance_contribution_share"] = str(
                    float(row["variance_contribution_share"])
                    + sign * offset / portfolio_variance
                )
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Reconstructed covariance component differs from ledger",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_offsetting_contribution_tamper_is_rejected(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "artifacts" / "portfolio-decisions.csv"
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            validation = run.result["metrics"]["split_protocol"]["splits"][
                "validation"
            ]
            timestamp = next(
                row["timestamp"]
                for row in rows
                if (
                    validation["start"]
                    <= row["timestamp"]
                    <= validation["signalEnd"]
                    and abs(float(row["gross_return_contribution"])) > 1e-12
                )
            )
            selected = [
                row for row in rows if row["timestamp"] == timestamp
            ][:2]
            offset = 0.001
            for sign, row in zip((1.0, -1.0), selected):
                row["gross_return_contribution"] = str(
                    float(row["gross_return_contribution"]) + sign * offset
                )
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Signal monetization evidence does not reconcile",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_translation_score_tamper_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "artifacts" / "portfolio-decisions.csv"
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            selected = next(
                row for row in rows if row["translation_score"]
            )
            selected["translation_score"] = str(
                float(selected["translation_score"]) + 0.01
            )
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Decision score does not reconcile",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_cost_stress_metric_tamper_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "result.json"
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["metrics"]["robustness"]["cost_stress"]["25bps"][
                "validation"
            ]["sharpe"] += 1.0
            path.write_text(
                json.dumps(payload, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Performance metric differs from the reconstructed ledger",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_current_risk_strength_tamper_is_rejected(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "artifacts" / "portfolio-decisions.csv"
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            latest_timestamp = rows[-1]["timestamp"]
            active = next(
                row
                for row in rows
                if (
                    row["timestamp"] == latest_timestamp
                    and int(row["signal_state"]) != 0
                )
            )
            active["risk_strength"] = str(
                float(active["risk_strength"]) + 1.0
            )
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Risk strength differs from conviction",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_parameter_neighborhood_mismatch_is_rejected(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = (
                run.root_dir
                / "artifacts"
                / "portfolio-parameter-neighborhood.json"
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["rows"][0]["netReturn"] += 0.01
            path.write_text(
                json.dumps(payload, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Parameter-neighborhood numeric value does not reconcile",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_signal_threshold_change_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "result.json"
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["metrics"]["signal_policy"]["parameters"][
                "long_entry_percentile"
            ] = 0.70
            path.write_text(
                json.dumps(payload, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Signal-policy parameters differ from the fixed contract",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_risk_governor_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "artifacts" / "portfolio-decisions.csv"
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            active = next(
                row
                for row in rows
                if abs(float(row["pre_governor_target_weight"])) > 1e-12
            )
            active["risk_governor_scale"] = "0.5"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Risk-governor weights or volatility forecasts do not reconcile",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_executed_book_risk_breach_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "artifacts" / "daily-portfolio.csv"
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            active = next(
                row
                for row in rows
                if row["execution_risk_forecast_available"] == "True"
            )
            active["executed_risk_forecast_annualized"] = str(
                float(active["execution_risk_ceiling_annualized"]) + 0.01
            )
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Executed-book risk evidence is invalid",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_liquidity_capacity_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "artifacts" / "portfolio-decisions.csv"
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            active = next(
                row
                for row in rows
                if (
                    row["liquidity_capacity_status"] == "available"
                    and abs(float(row["trade_weight"])) > 1e-12
                )
            )
            active["asset_capacity_nav_1pct"] = str(
                float(active["asset_capacity_nav_1pct"]) + 10_000.0
            )
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Asset liquidity-capacity evidence does not reconcile",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_position_episode_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            path = run.root_dir / "artifacts" / "position-episodes.csv"
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            active = next(
                row for row in rows if int(row["decision_bars"]) > 0
            )
            active["net_contribution"] = str(
                float(active["net_contribution"]) + 0.01
            )
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Position-episode evidence is invalid",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_legacy_run_without_position_lifecycle_remains_readable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            result_path = run.root_dir / "result.json"
            result = json.loads(result_path.read_text(encoding="utf-8"))
            result["metrics"].pop("position_lifecycle")
            result["artifacts"] = [
                item
                for item in result["artifacts"]
                if item["kind"] != "portfolio-position-episodes"
            ]
            result_path.write_text(
                json.dumps(result, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            report_path = (
                run.root_dir / "artifacts" / "portfolio-report.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["metrics"].pop("position_lifecycle")
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            (
                run.root_dir / "artifacts" / "position-episodes.csv"
            ).unlink()
            rehash_run(run.root_dir)

            diagnostics = load_portfolio_diagnostics(
                project,
                run.result["id"],
            )

            self.assertFalse(
                diagnostics["positionLifecycle"]["available"]
            )
            self.assertIsNone(
                diagnostics["positionLifecycle"]["validation"]
            )

    def test_run_without_capacity_evidence_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            decisions_path = (
                run.root_dir / "artifacts" / "portfolio-decisions.csv"
            )
            with decisions_path.open(
                encoding="utf-8",
                newline="",
            ) as handle:
                rows = list(csv.DictReader(handle))
                fields = [
                    field
                    for field in rows[0]
                    if field
                    not in {
                        "liquidity_capacity_status",
                        "liquidity_adv_observations",
                        "causal_adv_dollar_volume",
                        "reference_nav_adv_participation",
                        "asset_capacity_nav_1pct",
                        "asset_capacity_nav_5pct",
                        "portfolio_capacity_nav_1pct",
                        "portfolio_capacity_nav_5pct",
                        "capacity_binding_asset",
                    }
                ]
            with decisions_path.open(
                "w",
                encoding="utf-8",
                newline="",
            ) as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=fields,
                    extrasaction="ignore",
                )
                writer.writeheader()
                writer.writerows(rows)
            result_path = run.root_dir / "result.json"
            result = json.loads(result_path.read_text(encoding="utf-8"))
            result["metrics"].pop("liquidity_capacity")
            result_path.write_text(
                json.dumps(result, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            report_path = run.root_dir / "artifacts" / "portfolio-report.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["metrics"].pop("liquidity_capacity")
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "CSV is missing columns",
            ):
                load_portfolio_diagnostics(
                    project,
                    run.result["id"],
                )

    def test_run_without_execution_risk_evidence_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            new_fields = {
                "execution_risk_status",
                "execution_risk_forecast_available",
                "execution_risk_observations",
                "pretrade_risk_forecast_annualized",
                "proposed_risk_forecast_pre_annualized",
                "proposed_risk_forecast_post_annualized",
                "executed_risk_forecast_annualized",
                "execution_risk_ceiling_annualized",
                "proposed_runtime_risk_scale",
                "execution_risk_repair_scale",
                "proposed_one_way_turnover",
                "ordinary_rebalance",
                "risk_rebalance_override",
            }
            for name in ("daily-portfolio.csv", "portfolio-decisions.csv"):
                path = run.root_dir / "artifacts" / name
                with path.open(encoding="utf-8", newline="") as handle:
                    rows = list(csv.DictReader(handle))
                    fields = [
                        field for field in rows[0] if field not in new_fields
                    ]
                if name == "daily-portfolio.csv":
                    fields.remove("execution_reason")
                with path.open("w", encoding="utf-8", newline="") as handle:
                    writer = csv.DictWriter(
                        handle,
                        fieldnames=fields,
                        extrasaction="ignore",
                    )
                    writer.writeheader()
                    writer.writerows(rows)
            result_path = run.root_dir / "result.json"
            result = json.loads(result_path.read_text(encoding="utf-8"))
            result["metrics"].pop("execution_risk")
            result_path.write_text(
                json.dumps(result, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            report_path = run.root_dir / "artifacts" / "portfolio-report.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["metrics"].pop("execution_risk")
            report_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "CSV is missing columns",
            ):
                load_portfolio_diagnostics(
                    project,
                    run.result["id"],
                )

    def test_point_and_artifact_size_limits_are_structured(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "point_limit must be 40..400",
            ):
                load_portfolio_diagnostics(
                    project,
                    run.result["id"],
                    point_limit=39,
                )
            with patch(
                "autoquant.portfolio_explorer.MAX_ARTIFACT_BYTES",
                1,
            ), self.assertRaisesRegex(
                AutoQuantValidationError,
                "exceeds 1 bytes",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_non_portfolio_run_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(
                Path(directory),
                template="ohlcv-factor-lab",
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "not a fixed Portfolio Lab",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_rehashed_misaligned_artifacts_remain_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, run = make_lab(Path(directory))
            daily_path = run.root_dir / "artifacts" / "daily-portfolio.csv"
            lines = daily_path.read_text(encoding="utf-8").splitlines()
            daily_path.write_text("\n".join(lines[:-1]) + "\n", encoding="utf-8")
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Executed weights must exactly match",
            ):
                load_portfolio_diagnostics(project, run.result["id"])

    def test_studio_drops_only_invalid_explorer_claims(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project, run = make_lab(Path(directory))
            daily_path = run.root_dir / "artifacts" / "daily-portfolio.csv"
            lines = daily_path.read_text(encoding="utf-8").splitlines()
            daily_path.write_text("\n".join(lines[:-1]) + "\n", encoding="utf-8")
            rehash_run(run.root_dir)

            snapshot = build_studio_snapshot(workspace.root_dir)
            observed = snapshot["projects"][0]

            self.assertEqual(len(observed["runs"]), 1)
            self.assertIsNone(observed["portfolioExplorer"])
            self.assertFalse(observed["valid"])
            self.assertTrue(
                any(
                    item["category"].startswith("portfolio-explorer:")
                    for item in observed["diagnostics"]
                )
            )


if __name__ == "__main__":
    unittest.main()
