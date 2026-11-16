"""Bounded professional comparison over one verified research Session."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

from .runs import RunContext, load_run
from .sessions import (
    SELECTION_INTEGRITY_JSON_SCHEMA,
    SessionContext,
    build_selection_integrity,
    list_experiments,
    load_experiment,
    load_session,
)
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
)


SESSION_DECISION_MATRIX_KIND = "autoquant-session-decision-matrix"
DEFAULT_COMPARISON_TRIALS = 24
STUDIO_COMPARISON_TRIALS = 12
MIN_COMPARISON_TRIALS = 1
MAX_COMPARISON_TRIALS = 100
PREFERENCES = {"higher", "lower", "context"}
UNITS = {"number", "ratio", "percent", "count"}


Extractor = Callable[[dict[str, Any]], float | None]


@dataclass(frozen=True)
class MetricSpec:
    key: str
    label: str
    group: str
    split: str
    unit: str
    preference: str
    selection_eligible: bool
    extractor: Extractor

    def descriptor(self, primary_key: str | None) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "group": self.group,
            "split": self.split,
            "unit": self.unit,
            "preference": self.preference,
            "selectionEligible": self.selection_eligible,
            "primary": self.key == primary_key,
        }


def _issue(path: str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(path, code, message)


def _finite(value: Any) -> float | None:
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    ):
        return float(value)
    return None


def _nested(value: Any, *path: str) -> Any:
    current = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _path(*path: str) -> Extractor:
    return lambda metrics: _finite(_nested(metrics, *path))


def _factor_worst_fold(metrics: dict[str, Any]) -> float | None:
    folds = _nested(metrics, "stability", "chronological_folds")
    if not isinstance(folds, dict):
        return None
    values = [
        _finite(item.get("mean_ic"))
        for name, item in folds.items()
        if name.startswith("validation_") and isinstance(item, dict)
    ]
    finite = [value for value in values if value is not None]
    return min(finite) if finite else None


def _factor_max_style(metrics: dict[str, Any]) -> float | None:
    styles = _nested(metrics, "style_correlations", "validation")
    if not isinstance(styles, dict):
        return None
    values = [
        _finite(item.get("mean_rank_correlation"))
        for item in styles.values()
        if isinstance(item, dict)
    ]
    finite = [abs(value) for value in values if value is not None]
    return max(finite) if finite else None


def _factor_horizon_key(
    metrics: dict[str, Any],
    *,
    farthest: bool = False,
) -> str | None:
    horizon = metrics.get("research_horizon")
    if not isinstance(horizon, dict):
        return None
    primary = horizon.get("primaryForwardBars")
    diagnostics = horizon.get("diagnosticForwardBars")
    if (
        not isinstance(primary, int)
        or isinstance(primary, bool)
        or not isinstance(diagnostics, list)
        or not diagnostics
        or any(
            not isinstance(item, int) or isinstance(item, bool)
            for item in diagnostics
        )
    ):
        return None
    return str(max(diagnostics) if farthest else primary)


def _factor_horizon_metric(
    section: str,
    split: str,
    metric: str,
    *,
    farthest: bool = False,
) -> Extractor:
    def extract(metrics: dict[str, Any]) -> float | None:
        horizon = _factor_horizon_key(metrics, farthest=farthest)
        if horizon is None:
            return None
        return _finite(_nested(metrics, section, horizon, split, metric))

    return extract


def _rl_seed_values(
    metrics: dict[str, Any],
    split: str,
    *path: str,
) -> list[float]:
    folds = _nested(metrics, "rl", "folds")
    if not isinstance(folds, dict):
        return []
    values: list[float] = []
    for fold in folds.values():
        if not isinstance(fold, dict):
            continue
        seeds = fold.get("seeds")
        if not isinstance(seeds, dict):
            continue
        for seed in seeds.values():
            if not isinstance(seed, dict) or seed.get("status") != "succeeded":
                continue
            value = _finite(_nested(seed, split, *path))
            if value is not None:
                values.append(value)
    return values


def _rl_mean(split: str, *path: str) -> Extractor:
    def extract(metrics: dict[str, Any]) -> float | None:
        values = _rl_seed_values(metrics, split, *path)
        return sum(values) / len(values) if values else None

    return extract


def _portfolio_specs() -> tuple[list[MetricSpec], str]:
    return (
        [
            MetricSpec(
                "validationRankIc",
                "Rank IC",
                "factor",
                "validation",
                "number",
                "higher",
                True,
                _path("factor", "validation", "mean_rank_ic"),
            ),
            MetricSpec(
                "validationNetSharpe",
                "Net Sharpe",
                "portfolio",
                "validation",
                "ratio",
                "higher",
                True,
                _path("portfolio", "validation", "net", "sharpe"),
            ),
            MetricSpec(
                "validationAnnualReturn",
                "Annual return",
                "portfolio",
                "validation",
                "percent",
                "higher",
                True,
                _path("portfolio", "validation", "net", "annual_return"),
            ),
            MetricSpec(
                "validationMaximumDrawdown",
                "Maximum drawdown",
                "risk",
                "validation",
                "percent",
                "higher",
                True,
                _path(
                    "portfolio",
                    "validation",
                    "net",
                    "maximum_drawdown",
                ),
            ),
            MetricSpec(
                "validationExpectedShortfall95",
                "Expected shortfall 95",
                "risk",
                "validation",
                "percent",
                "lower",
                True,
                _path(
                    "portfolio",
                    "validation",
                    "net",
                    "expected_shortfall_95",
                ),
            ),
            MetricSpec(
                "validationRiskLimitedRate",
                "Risk-governor activation",
                "risk-governor",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "robustness",
                    "risk_governor",
                    "validation",
                    "governed",
                    "risk_limited_rate",
                ),
            ),
            MetricSpec(
                "validationAverageActiveRiskScale",
                "Average active risk scale",
                "risk-governor",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "robustness",
                    "risk_governor",
                    "validation",
                    "governed",
                    "average_active_risk_scale",
                ),
            ),
            MetricSpec(
                "validationPreGovernorForecastMaximum",
                "Maximum pre-governor forecast",
                "risk-governor",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "robustness",
                    "risk_governor",
                    "validation",
                    "governed",
                    "maximum_pre_governor_annualized_volatility",
                ),
            ),
            MetricSpec(
                "validationPostGovernorForecastMaximum",
                "Maximum governed forecast",
                "risk-governor",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "robustness",
                    "risk_governor",
                    "validation",
                    "governed",
                    "maximum_post_governor_annualized_volatility",
                ),
            ),
            MetricSpec(
                "validationAnnualizedTurnover",
                "Annual one-way turnover",
                "implementation",
                "validation",
                "ratio",
                "lower",
                True,
                _path(
                    "implementation",
                    "validation",
                    "annualized_one_way_turnover",
                ),
            ),
            MetricSpec(
                "validationCostDrag",
                "Total cost drag",
                "implementation",
                "validation",
                "percent",
                "lower",
                True,
                _path("implementation", "validation", "total_cost_drag"),
            ),
            MetricSpec(
                "validationCapacity1PctTenthPercentile",
                "1% capacity · 10th percentile",
                "liquidity-capacity",
                "validation",
                "number",
                "context",
                False,
                _path(
                    "liquidity_capacity",
                    "validation",
                    "capacity_1pct",
                    "tenth_percentile_nav",
                ),
            ),
            MetricSpec(
                "validationCapacityTradeDateCoverage",
                "Capacity trade-date coverage",
                "liquidity-capacity",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "liquidity_capacity",
                    "validation",
                    "trade_date_coverage",
                ),
            ),
            MetricSpec(
                "validationCapacityReferenceNavBreachRate",
                "$1m capacity breach rate",
                "liquidity-capacity",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "liquidity_capacity",
                    "validation",
                    "capacity_1pct",
                    "reference_nav_breach_rate",
                ),
            ),
            MetricSpec(
                "validationExecutedRiskForecastCoverage",
                "Executed-risk forecast coverage",
                "executed-risk",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "execution_risk",
                    "validation",
                    "forecast_coverage",
                ),
            ),
            MetricSpec(
                "validationRiskRebalanceOverrides",
                "Risk-only rebalance overrides",
                "executed-risk",
                "validation",
                "count",
                "context",
                False,
                _path(
                    "execution_risk",
                    "validation",
                    "risk_rebalance_override_dates",
                ),
            ),
            MetricSpec(
                "validationExecutedRiskBreaches",
                "Executed-book risk breaches",
                "executed-risk",
                "validation",
                "count",
                "context",
                False,
                _path(
                    "execution_risk",
                    "validation",
                    "executed_breach_dates",
                ),
            ),
            MetricSpec(
                "validationCompletePositionEpisodes",
                "Complete position episodes",
                "position-lifecycle",
                "validation",
                "count",
                "context",
                False,
                _path(
                    "position_lifecycle",
                    "validation",
                    "complete_episodes",
                ),
            ),
            MetricSpec(
                "validationCompleteEpisodeWinRate",
                "Complete episode win rate",
                "position-lifecycle",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "position_lifecycle",
                    "validation",
                    "complete_episode_win_rate",
                ),
            ),
            MetricSpec(
                "validationMedianCompleteHoldingBars",
                "Median complete holding",
                "position-lifecycle",
                "validation",
                "count",
                "context",
                False,
                _path(
                    "position_lifecycle",
                    "validation",
                    "median_complete_holding_bars",
                ),
            ),
            MetricSpec(
                "validationCompletePayoffRatio",
                "Complete episode payoff",
                "position-lifecycle",
                "validation",
                "ratio",
                "context",
                False,
                _path(
                    "position_lifecycle",
                    "validation",
                    "complete_payoff_ratio",
                ),
            ),
            MetricSpec(
                "validationIntentMismatchRate",
                "Intent mismatch rate",
                "position-lifecycle",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "position_lifecycle",
                    "validation",
                    "intent_mismatch_rate",
                ),
            ),
            MetricSpec(
                "validation25bpsSharpe",
                "25 bps Sharpe",
                "robustness",
                "validation",
                "ratio",
                "higher",
                True,
                _path(
                    "robustness",
                    "cost_stress",
                    "25bps",
                    "validation",
                    "sharpe",
                ),
            ),
            MetricSpec(
                "validationExtraDelaySharpe",
                "Extra-delay Sharpe",
                "robustness",
                "validation",
                "ratio",
                "higher",
                True,
                _path(
                    "robustness",
                    "extra_delay",
                    "validation",
                    "sharpe",
                ),
            ),
            MetricSpec(
                "validationNeighborhoodMinimumNetSharpe",
                "Neighborhood minimum Sharpe",
                "parameter-neighborhood",
                "validation",
                "ratio",
                "context",
                False,
                _path(
                    "parameter_neighborhood",
                    "validation",
                    "aggregate",
                    "minimum_net_sharpe",
                ),
            ),
            MetricSpec(
                "validationNeighborhoodPositiveSharpeRate",
                "Neighborhood positive Sharpe",
                "parameter-neighborhood",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "parameter_neighborhood",
                    "validation",
                    "aggregate",
                    "positive_net_sharpe_rate",
                ),
            ),
            MetricSpec(
                "validationNeighborhoodWorstSharpeDelta",
                "Neighborhood worst Sharpe delta",
                "parameter-neighborhood",
                "validation",
                "ratio",
                "context",
                False,
                _path(
                    "parameter_neighborhood",
                    "validation",
                    "aggregate",
                    "worst_net_sharpe_delta",
                ),
            ),
            MetricSpec(
                "validationMaxNetContributionShare",
                "Max asset contribution",
                "attribution",
                "validation",
                "percent",
                "lower",
                True,
                _path(
                    "attribution",
                    "validation",
                    "concentration",
                    "maximum_absolute_net_contribution_share",
                ),
            ),
            MetricSpec(
                "validationMaxRiskContributionShare",
                "Max component risk",
                "attribution",
                "validation",
                "percent",
                "lower",
                True,
                _path(
                    "attribution",
                    "validation",
                    "concentration",
                    "maximum_absolute_variance_contribution_share",
                ),
            ),
            MetricSpec(
                "validationStateChangeRate",
                "Signal state-change rate",
                "policy",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "signal_policy",
                    "validation",
                    "state_change_rate",
                ),
            ),
            MetricSpec(
                "validationTransitionReductionRate",
                "Hysteresis transition reduction",
                "policy",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "signal_policy",
                    "hysteresis_comparison",
                    "validation",
                    "transition_reduction_rate",
                ),
            ),
            MetricSpec(
                "testNetSharpe",
                "Net Sharpe",
                "audit",
                "test",
                "ratio",
                "higher",
                False,
                _path("portfolio", "test", "net", "sharpe"),
            ),
            MetricSpec(
                "testMaximumDrawdown",
                "Maximum drawdown",
                "audit",
                "test",
                "percent",
                "higher",
                False,
                _path("portfolio", "test", "net", "maximum_drawdown"),
            ),
        ],
        "validationNetSharpe",
    )


def _factor_specs() -> tuple[list[MetricSpec], str]:
    return (
        [
            MetricSpec(
                "validationMeanIc",
                "Mean rank IC",
                "factor",
                "validation",
                "number",
                "higher",
                True,
                _path("validation", "mean_ic"),
            ),
            MetricSpec(
                "validationPearsonIc",
                "Mean Pearson IC",
                "factor",
                "validation",
                "number",
                "higher",
                True,
                _path("validation", "pearson_ic", "mean_ic"),
            ),
            MetricSpec(
                "validationHacTStatistic",
                "HAC t-statistic",
                "inference",
                "validation",
                "ratio",
                "higher",
                True,
                _path("validation", "hac", "t_statistic"),
            ),
            MetricSpec(
                "validationFarthestHorizonMeanIc",
                "Farthest-horizon mean IC",
                "decay",
                "validation",
                "number",
                "higher",
                True,
                _factor_horizon_metric(
                    "horizon_quality",
                    "validation",
                    "mean_ic",
                    farthest=True,
                ),
            ),
            MetricSpec(
                "validationQuantileSpread",
                "High-minus-low return",
                "quantiles",
                "validation",
                "percent",
                "higher",
                True,
                _factor_horizon_metric(
                    "quantile_analysis",
                    "validation",
                    "high_minus_low",
                ),
            ),
            MetricSpec(
                "validationWorstFoldMeanIc",
                "Worst fold mean IC",
                "stability",
                "validation",
                "number",
                "higher",
                True,
                _factor_worst_fold,
            ),
            MetricSpec(
                "validationMaxStyleCorrelation",
                "Maximum style overlap",
                "stability",
                "validation",
                "number",
                "lower",
                True,
                _factor_max_style,
            ),
            MetricSpec(
                "meanRankTurnover",
                "Mean rank turnover",
                "implementation",
                "full",
                "number",
                "lower",
                False,
                _path("mean_rank_turnover"),
            ),
            MetricSpec(
                "testMeanIc",
                "Mean rank IC",
                "audit",
                "test",
                "number",
                "higher",
                False,
                _path("test", "mean_ic"),
            ),
        ],
        "validationMeanIc",
    )


def _rl_specs() -> tuple[list[MetricSpec], str]:
    return (
        [
            MetricSpec(
                "validationMeanNetSharpe",
                "Mean net Sharpe",
                "rl",
                "validation",
                "ratio",
                "higher",
                True,
                _path("validation_mean_net_sharpe"),
            ),
            MetricSpec(
                "validationMinimumNetSharpe",
                "Minimum seed/fold Sharpe",
                "rl",
                "validation",
                "ratio",
                "higher",
                True,
                _path(
                    "rl",
                    "aggregate",
                    "validation_net_sharpe",
                    "minimum",
                ),
            ),
            MetricSpec(
                "validationSeedFoldStd",
                "Seed/fold dispersion",
                "rl",
                "validation",
                "ratio",
                "lower",
                True,
                _path(
                    "rl",
                    "aggregate",
                    "validation_net_sharpe",
                    "standard_deviation",
                ),
            ),
            MetricSpec(
                "validationBaselineAdvantage",
                "Advantage vs best baseline",
                "baseline",
                "validation",
                "ratio",
                "higher",
                True,
                _path(
                    "comparison",
                    "mean_validation_advantage_vs_best_baseline",
                ),
            ),
            MetricSpec(
                "failureRate",
                "Seed/fold failure rate",
                "stability",
                "full",
                "percent",
                "lower",
                False,
                _path("rl", "aggregate", "failure_rate"),
            ),
            MetricSpec(
                "validationAnnualizedTurnover",
                "Mean annual one-way turnover",
                "implementation",
                "validation",
                "ratio",
                "lower",
                True,
                _rl_mean(
                    "validation",
                    "implementation",
                    "annualized_one_way_turnover",
                ),
            ),
            MetricSpec(
                "validationCostDrag",
                "Mean total cost drag",
                "implementation",
                "validation",
                "percent",
                "lower",
                True,
                _rl_mean(
                    "validation",
                    "implementation",
                    "total_cost_drag",
                ),
            ),
            MetricSpec(
                "validationActionTransitionRate",
                "Action transition rate",
                "policy-behavior",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "policy_rationale",
                    "validation",
                    "transition_rate",
                ),
            ),
            MetricSpec(
                "validationMeanActionRunLength",
                "Mean action-run length",
                "policy-behavior",
                "validation",
                "number",
                "context",
                False,
                _path(
                    "policy_rationale",
                    "validation",
                    "mean_action_run_length",
                ),
            ),
            MetricSpec(
                "validationMedianActionMargin",
                "Median uncalibrated Q margin",
                "policy-behavior",
                "validation",
                "number",
                "context",
                False,
                _path(
                    "policy_rationale",
                    "validation",
                    "median_action_margin",
                ),
            ),
            MetricSpec(
                "validationQDecisionTieRate",
                "Q decision tie rate",
                "policy-behavior",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "policy_rationale",
                    "validation",
                    "tie_rate",
                ),
            ),
            MetricSpec(
                "validationOneStepOracleHitRate",
                "One-step oracle-hit rate",
                "factor-opportunity",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "factor_opportunity",
                    "validation",
                    "oracle_hit_rate",
                ),
            ),
            MetricSpec(
                "validationMeanSelectedActionRank",
                "Mean selected action rank",
                "factor-opportunity",
                "validation",
                "number",
                "context",
                False,
                _path(
                    "factor_opportunity",
                    "validation",
                    "mean_selected_rank",
                ),
            ),
            MetricSpec(
                "validationMeanOneStepRegret",
                "Mean realized one-step regret",
                "factor-opportunity",
                "validation",
                "number",
                "context",
                False,
                _path(
                    "factor_opportunity",
                    "validation",
                    "mean_realized_regret",
                ),
            ),
            MetricSpec(
                "validationCandidateOracleFrequency",
                "Candidate locally-best frequency",
                "factor-opportunity",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "factor_opportunity",
                    "validation",
                    "candidate",
                    "oracle_frequency",
                ),
            ),
            MetricSpec(
                "validationCandidateMissedOpportunityRate",
                "Candidate missed-opportunity rate",
                "factor-opportunity",
                "validation",
                "percent",
                "context",
                False,
                _path(
                    "factor_opportunity",
                    "validation",
                    "candidate",
                    "missed_opportunity_rate",
                ),
            ),
            MetricSpec(
                "testMeanNetSharpe",
                "Mean net Sharpe",
                "audit",
                "test",
                "ratio",
                "higher",
                False,
                _path("rl", "aggregate", "test_net_sharpe", "mean"),
            ),
            MetricSpec(
                "testSeedFoldStd",
                "Seed/fold dispersion",
                "audit",
                "test",
                "ratio",
                "lower",
                False,
                _path(
                    "rl",
                    "aggregate",
                    "test_net_sharpe",
                    "standard_deviation",
                ),
            ),
        ],
        "validationMeanNetSharpe",
    )


def _metric_specs(run: RunContext) -> tuple[str, list[MetricSpec], str]:
    metrics = run.result["metrics"]
    if all(
        isinstance(metrics.get(key), dict)
        for key in ("factor", "portfolio", "implementation", "robustness")
    ):
        specs, primary = _portfolio_specs()
        return "portfolio", specs, primary
    if all(
        isinstance(metrics.get(key), dict)
        for key in ("rl", "baselines", "comparison", "configuration")
    ):
        specs, primary = _rl_specs()
        return "rl-policy", specs, primary
    if all(
        isinstance(metrics.get(key), dict)
        for key in ("validation", "test")
    ):
        specs, primary = _factor_specs()
        return "factor", specs, primary
    objective = run.result["objective"]
    metric = objective["metric"]
    preference = (
        "higher" if objective["direction"] == "maximize" else "lower"
    )
    return (
        "generic",
        [
            MetricSpec(
                "primaryObjective",
                metric,
                "objective",
                "declared",
                "number",
                preference,
                True,
                lambda values: _finite(values.get(metric)),
            )
        ],
        "primaryObjective",
    )


def _comparison(
    value: float | None,
    baseline: float | None,
    preference: str,
) -> str:
    if value is None or baseline is None:
        return "unavailable"
    if preference == "context":
        return "context"
    tolerance = 1e-12 * max(1.0, abs(value), abs(baseline))
    if abs(value - baseline) <= tolerance:
        return "same"
    favorable = value > baseline if preference == "higher" else value < baseline
    return "better" if favorable else "worse"


def _descriptor_comparison(
    value: float | None,
    baseline: float | None,
    spec: MetricSpec,
) -> str:
    relation = _comparison(value, baseline, spec.preference)
    if (
        spec.split == "test"
        and relation in {"better", "worse", "same"}
    ):
        return f"audit-{relation}"
    if (
        not spec.selection_eligible
        and relation in {"better", "worse", "same"}
    ):
        return f"display-{relation}"
    return relation


def _dominates(
    left: dict[str, Any],
    right: dict[str, Any],
    specs: list[MetricSpec],
) -> bool:
    better = False
    for spec in specs:
        if not spec.selection_eligible or spec.preference == "context":
            continue
        left_value = left["metrics"].get(spec.key)
        right_value = right["metrics"].get(spec.key)
        if left_value is None or right_value is None:
            return False
        relation = _comparison(left_value, right_value, spec.preference)
        if relation == "worse":
            return False
        if relation == "better":
            better = True
    return better


def _objective_improvement(
    run: RunContext,
    baseline: RunContext,
) -> float | None:
    if run.result["status"] != "succeeded":
        return None
    metric = baseline.result["objective"]["metric"]
    value = _finite(run.result["metrics"].get(metric))
    baseline_value = _finite(baseline.result["metrics"].get(metric))
    if value is None or baseline_value is None:
        return None
    if baseline.result["objective"]["direction"] == "maximize":
        return value - baseline_value
    return baseline_value - value


def _select_experiments(
    records: list[dict[str, Any]],
    leader_run_id: str,
    trial_limit: int,
) -> list[dict[str, Any]]:
    selected = records[-trial_limit:]
    if leader_run_id not in {record["run"].result["id"] for record in selected}:
        leader = next(
            (
                record
                for record in records
                if record["run"].result["id"] == leader_run_id
            ),
            None,
        )
        if leader is not None:
            tail_count = trial_limit - 1
            selected = (
                [leader]
                if tail_count == 0
                else [leader, *selected[-tail_count:]]
            )
    deduplicated = {
        int(record["experiment"].result["sequence"]): record
        for record in selected
    }
    return [deduplicated[key] for key in sorted(deduplicated)]


def _trial(
    run: RunContext,
    specs: list[MetricSpec],
    baseline: RunContext,
    leader_run_id: str,
    *,
    experiment: dict[str, Any] | None,
) -> dict[str, Any]:
    metrics = {
        spec.key: (
            spec.extractor(run.result["metrics"])
            if run.result["status"] == "succeeded"
            else None
        )
        for spec in specs
    }
    baseline_metrics = {
        spec.key: spec.extractor(baseline.result["metrics"])
        for spec in specs
    }
    primary_metric = baseline.result["objective"]["metric"]
    primary_value = (
        _finite(run.result["metrics"].get(primary_metric))
        if run.result["status"] == "succeeded"
        else None
    )
    if experiment is None:
        sequence = 0
        experiment_id = None
        verdict = "BASELINE"
        hypothesis = "Fixed Session baseline"
        prior_improvement = None
    else:
        sequence = int(experiment["sequence"])
        experiment_id = experiment["id"]
        verdict = experiment["verdict"]
        hypothesis = experiment["hypothesis"]
        prior_improvement = experiment["improvement"]
    return {
        "role": "baseline" if experiment is None else "candidate",
        "sequence": sequence,
        "experimentId": experiment_id,
        "runId": run.result["id"],
        "status": run.result["status"],
        "verdict": verdict,
        "hypothesis": hypothesis,
        "sourceHash": run.result["subject"]["sourceHash"],
        "primaryValue": primary_value,
        "objectiveImprovementVsPriorLeader": prior_improvement,
        "objectiveImprovementVsBaseline": _objective_improvement(
            run,
            baseline,
        ),
        "isCurrentLeader": run.result["id"] == leader_run_id,
        "metrics": metrics,
        "vsBaseline": {
            spec.key: _descriptor_comparison(
                metrics[spec.key],
                baseline_metrics[spec.key],
                spec,
            )
            for spec in specs
        },
        "errors": run.result["errors"],
    }


def load_session_decision_matrix(
    project: ProjectContext,
    session_id: str,
    *,
    trial_limit: int = DEFAULT_COMPARISON_TRIALS,
) -> dict[str, Any]:
    if (
        not isinstance(trial_limit, int)
        or isinstance(trial_limit, bool)
        or not MIN_COMPARISON_TRIALS
        <= trial_limit
        <= MAX_COMPARISON_TRIALS
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    "comparison/trialLimit",
                    "comparison.trial-limit",
                    f"Trial limit must be {MIN_COMPARISON_TRIALS}.."
                    f"{MAX_COMPARISON_TRIALS}",
                )
            ]
        )
    session: SessionContext = load_session(project, session_id)
    baseline = session.baseline_run
    kind, specs, primary_key = _metric_specs(baseline)
    summaries = list_experiments(project, session)
    records: list[dict[str, Any]] = []
    for summary in summaries:
        experiment = load_experiment(project, session, summary.id)
        run = load_run(project, experiment.result["candidate"]["runId"])
        candidate_kind, _, _ = _metric_specs(run)
        if run.result["status"] == "succeeded" and candidate_kind != kind:
            raise AutoQuantValidationError(
                [
                    _issue(
                        run.root_dir.as_posix(),
                        "comparison.metric-kind",
                        "Successful candidate metric family differs from baseline",
                    )
                ]
            )
        records.append({"experiment": experiment, "run": run})
    selected = _select_experiments(
        records,
        session.manifest["leader"]["runId"],
        trial_limit,
    )
    trials = [
        _trial(
            baseline,
            specs,
            baseline,
            session.manifest["leader"]["runId"],
            experiment=None,
        ),
        *[
            _trial(
                record["run"],
                specs,
                baseline,
                session.manifest["leader"]["runId"],
                experiment=record["experiment"].result,
            )
            for record in selected
        ],
    ]
    selection_specs = [
        spec
        for spec in specs
        if spec.selection_eligible and spec.preference != "context"
    ]
    eligible = [
        trial
        for trial in trials
        if trial["status"] == "succeeded"
        and all(trial["metrics"].get(spec.key) is not None for spec in selection_specs)
    ]
    frontier = [
        trial["runId"]
        for trial in eligible
        if not any(
            other["runId"] != trial["runId"]
            and _dominates(other, trial, selection_specs)
            for other in eligible
        )
    ]
    incomplete = [
        trial["runId"]
        for trial in trials
        if trial["status"] == "succeeded" and trial not in eligible
    ]
    leader = next(
        trial for trial in trials if trial["isCurrentLeader"]
    )
    leader_relations = leader["vsBaseline"]
    improved = [
        spec.key
        for spec in selection_specs
        if leader_relations[spec.key] == "better"
    ]
    regressed = [
        spec.key
        for spec in selection_specs
        if leader_relations[spec.key] == "worse"
    ]
    unchanged = [
        spec.key
        for spec in selection_specs
        if leader_relations[spec.key] == "same"
    ]
    unavailable = [
        spec.key
        for spec in selection_specs
        if leader_relations[spec.key] == "unavailable"
    ]
    selection_integrity = build_selection_integrity(
        project,
        session.leader_run,
        [summary.verdict for summary in summaries],
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": SESSION_DECISION_MATRIX_KIND,
        "session": {
            "id": session.manifest["id"],
            "status": session.manifest["status"],
            "studyId": session.manifest["studyId"],
            "baselineRunId": session.manifest["baseline"]["runId"],
            "leaderRunId": session.manifest["leader"]["runId"],
            "updatedAt": session.manifest["updatedAt"],
        },
        "fixedIdentity": {
            "studyHash": session.manifest["locks"]["studyHash"],
            "datasetHash": session.manifest["locks"]["datasetHash"],
            "judgeHash": session.manifest["locks"]["judgeHash"],
            "harness": session.manifest["locks"]["harness"],
        },
        "metricFamily": kind,
        "objective": baseline.result["objective"],
        "selectionIntegrity": selection_integrity,
        "scope": {
            "trialLimit": trial_limit,
            "totalCandidateTrials": len(records),
            "displayedCandidateTrials": len(selected),
            "omittedCandidateTrials": len(records) - len(selected),
            "baselineAnchored": True,
            "leaderAnchored": True,
        },
        "metrics": [
            spec.descriptor(primary_key)
            for spec in specs
        ],
        "trials": trials,
        "tradeoffs": {
            "scope": "displayed-successful-trials",
            "selectionEligibleMetricKeys": [
                spec.key for spec in selection_specs
            ],
            "testExcluded": True,
            "contextExcluded": True,
            "nonDominatedRunIds": frontier,
            "incompleteRunIds": incomplete,
            "leaderVsBaseline": {
                "improved": improved,
                "regressed": regressed,
                "unchanged": unchanged,
                "unavailable": unavailable,
            },
            "warning": (
                "Descriptive validation-only comparison; immutable Experiment "
                "verdicts and the fixed primary objective remain authoritative."
            ),
        },
    }


SESSION_DECISION_MATRIX_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant bounded Session decision matrix",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "session",
        "fixedIdentity",
        "metricFamily",
        "objective",
        "selectionIntegrity",
        "scope",
        "metrics",
        "trials",
        "tradeoffs",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": SESSION_DECISION_MATRIX_KIND},
        "session": {"type": "object"},
        "fixedIdentity": {"type": "object"},
        "metricFamily": {
            "enum": ["factor", "portfolio", "rl-policy", "generic"]
        },
        "objective": {"type": "object"},
        "selectionIntegrity": SELECTION_INTEGRITY_JSON_SCHEMA,
        "scope": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "trialLimit",
                "totalCandidateTrials",
                "displayedCandidateTrials",
                "omittedCandidateTrials",
                "baselineAnchored",
                "leaderAnchored",
            ],
            "properties": {
                "trialLimit": {
                    "type": "integer",
                    "minimum": MIN_COMPARISON_TRIALS,
                    "maximum": MAX_COMPARISON_TRIALS,
                },
                "totalCandidateTrials": {"type": "integer", "minimum": 0},
                "displayedCandidateTrials": {"type": "integer", "minimum": 0},
                "omittedCandidateTrials": {"type": "integer", "minimum": 0},
                "baselineAnchored": {"const": True},
                "leaderAnchored": {"const": True},
            },
        },
        "metrics": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "key",
                    "label",
                    "group",
                    "split",
                    "unit",
                    "preference",
                    "selectionEligible",
                    "primary",
                ],
                "properties": {
                    "key": {"type": "string", "minLength": 1},
                    "label": {"type": "string", "minLength": 1},
                    "group": {"type": "string", "minLength": 1},
                    "split": {"type": "string", "minLength": 1},
                    "unit": {"enum": sorted(UNITS)},
                    "preference": {"enum": sorted(PREFERENCES)},
                    "selectionEligible": {"type": "boolean"},
                    "primary": {"type": "boolean"},
                },
            },
        },
        "trials": {
            "type": "array",
            "minItems": 1,
            "maxItems": MAX_COMPARISON_TRIALS + 1,
            "items": {
                "type": "object",
                "required": [
                    "role",
                    "sequence",
                    "experimentId",
                    "runId",
                    "status",
                    "verdict",
                    "hypothesis",
                    "sourceHash",
                    "primaryValue",
                    "objectiveImprovementVsPriorLeader",
                    "objectiveImprovementVsBaseline",
                    "isCurrentLeader",
                    "metrics",
                    "vsBaseline",
                    "errors",
                ],
            },
        },
        "tradeoffs": {"type": "object"},
    },
}
