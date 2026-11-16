"""Fixed causal target construction and portfolio accounting primitives."""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right, insort
from collections import deque
from dataclasses import dataclass

import exchange_calendars
import numpy as np
import pandas as pd

from autoquant.intervals import annualization_periods
from autoquant.prediction_modes import (
    CROSS_SECTIONAL_MODE,
    SIGNAL_TRANSLATION_METHOD,
    SINGLE_ASSET_TEMPORAL_MODE,
    TEMPORAL_SCORE_MINIMUM,
    TEMPORAL_SCORE_WINDOW,
    TWO_ASSET_RELATIVE_VALUE_MODE,
    signal_translation_contract,
)
VOLATILITY_WINDOW = 20
GROSS_TARGET = 1.0
SIDE_BUDGET = GROSS_TARGET / 2.0
MAX_ABS_WEIGHT = 0.30
NO_TRADE_ONE_WAY = 0.05
BASE_COST_BPS = 10.0
REFERENCE_NAV = 1_000_000.0
DECISION_EVERY_BARS = 1
DECISION_ANCHOR = "dataset-start"
DEFAULT_DECISION_POLICY = {
    "source": "reference-default",
    "kind": "every-bars",
    "bars": DECISION_EVERY_BARS,
    "anchor": DECISION_ANCHOR,
}
LONG_ENTRY_PERCENTILE = 0.75
LONG_EXIT_PERCENTILE = 0.55
SHORT_EXIT_PERCENTILE = 0.45
SHORT_ENTRY_PERCENTILE = 0.25
RISK_COVARIANCE_WINDOW = 60
RISK_COVARIANCE_MINIMUM = 20
LIQUIDITY_ADV_WINDOW = 20
LIQUIDITY_PARTICIPATION_LIMITS = (0.01, 0.05)
RISK_COMPLIANCE_TOLERANCE = 1e-10
POSITION_EPISODE_TOLERANCE = 1e-10
POSITION_EPISODE_COLUMNS = (
    "episode_id",
    "split",
    "role",
    "episode_number",
    "asset",
    "side",
    "entry_timestamp",
    "last_earning_timestamp",
    "exit_timestamp",
    "entry_action",
    "exit_action",
    "left_censored",
    "right_censored",
    "complete",
    "decision_bars",
    "entry_weight",
    "last_executed_weight",
    "peak_abs_weight",
    "average_abs_weight",
    "gross_contribution",
    "entry_cost",
    "holding_cost",
    "exit_cost",
    "total_cost",
    "net_contribution",
    "maximum_favorable_excursion",
    "maximum_adverse_excursion",
    "intent_mismatch_bars",
    "no_trade_bars",
    "risk_override_bars",
)


class PortfolioFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class Simulation:
    daily: pd.DataFrame
    weights: pd.DataFrame
    trades: pd.DataFrame
    participation: pd.DataFrame


@dataclass(frozen=True)
class SignalConstruction:
    targets: pd.DataFrame
    states: pd.DataFrame
    ledger: pd.DataFrame
    scores: pd.DataFrame
    translation_values: pd.DataFrame
    translation_observations: pd.DataFrame
    translation: dict[str, object]


RiskCovarianceCache = dict[object, tuple[int, np.ndarray | None]]


def _causal_empirical_percentile(
    values: pd.Series,
    *,
    window: int = TEMPORAL_SCORE_WINDOW,
    minimum: int = TEMPORAL_SCORE_MINIMUM,
) -> tuple[pd.Series, pd.Series]:
    """Rank each finite value inside the latest observed causal window."""

    if minimum < 2 or window < minimum:
        raise PortfolioFailure(
            "portfolio.translation-window",
            "Temporal score window must contain its fixed minimum",
        )
    scores = pd.Series(np.nan, index=values.index, dtype=float)
    observations = pd.Series(0, index=values.index, dtype=int)
    ordered: list[float] = []
    history: deque[float] = deque()
    for timestamp, raw in values.items():
        value = float(raw) if pd.notna(raw) else math.nan
        if not math.isfinite(value):
            continue
        history.append(value)
        insort(ordered, value)
        if len(history) > window:
            expired = history.popleft()
            position = bisect_left(ordered, expired)
            if position >= len(ordered) or ordered[position] != expired:
                raise PortfolioFailure(
                    "portfolio.translation-window",
                    "Temporal score window could not remove prior value",
                )
            ordered.pop(position)
        count = len(ordered)
        observations.loc[timestamp] = count
        if count < minimum:
            continue
        lower = bisect_left(ordered, value)
        upper = bisect_right(ordered, value)
        average_one_based_rank = (lower + 1 + upper) / 2.0
        scores.loc[timestamp] = average_one_based_rank / count
    return scores, observations


def translate_factor_scores(
    factors: pd.DataFrame,
    prediction_population: dict[str, object] | None = None,
    *,
    temporal_window: int = TEMPORAL_SCORE_WINDOW,
    temporal_minimum: int = TEMPORAL_SCORE_MINIMUM,
) -> tuple[
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    dict[str, object],
]:
    """Translate causal Factor values into one fixed decision-score surface."""

    if factors.empty or factors.columns.has_duplicates:
        raise PortfolioFailure(
            "portfolio.translation-input",
            "Factor panel must have rows and unique asset columns",
        )
    population = prediction_population or {
        "evaluation_mode": CROSS_SECTIONAL_MODE,
        "prediction_assets": list(factors.columns),
        "context_assets": [],
        "authority": "reference-default-research-universe",
        "relative_value_pair": None,
    }
    mode = population.get("evaluation_mode")
    prediction_assets = population.get("prediction_assets")
    context_assets = population.get("context_assets")
    if (
        mode not in {
            CROSS_SECTIONAL_MODE,
            SINGLE_ASSET_TEMPORAL_MODE,
            TWO_ASSET_RELATIVE_VALUE_MODE,
        }
        or not isinstance(prediction_assets, list)
        or not prediction_assets
        or len(prediction_assets) != len(set(prediction_assets))
        or any(asset not in factors.columns for asset in prediction_assets)
        or not isinstance(context_assets, list)
        or set(prediction_assets).intersection(context_assets)
        or set(prediction_assets).union(context_assets) != set(factors.columns)
    ):
        raise PortfolioFailure(
            "portfolio.translation-population",
            "Prediction population does not partition the Factor panel",
        )
    scores = pd.DataFrame(np.nan, index=factors.index, columns=factors.columns)
    translation_values = pd.DataFrame(
        np.nan,
        index=factors.index,
        columns=factors.columns,
    )
    observations = pd.DataFrame(
        0,
        index=factors.index,
        columns=factors.columns,
        dtype=int,
    )
    relative_value_pair = population.get("relative_value_pair")

    if mode == CROSS_SECTIONAL_MODE:
        if len(prediction_assets) < 4:
            raise PortfolioFailure(
                "portfolio.translation-population",
                "Cross-sectional translation requires at least four prediction assets",
            )
        selected = factors[prediction_assets].where(
            np.isfinite(factors[prediction_assets].to_numpy(dtype=float))
        )
        counts = selected.notna().sum(axis=1)
        distinct = selected.nunique(axis=1)
        available = counts.ge(4) & distinct.ge(2)
        ranks = selected.rank(axis=1, method="average")
        translated = ranks.sub(1.0).div(counts.sub(1.0), axis=0)
        scores.loc[:, prediction_assets] = translated.where(available)
        translation_values.loc[:, prediction_assets] = selected
        for asset in prediction_assets:
            observations.loc[:, asset] = counts.astype(int)
    elif mode == SINGLE_ASSET_TEMPORAL_MODE:
        if len(prediction_assets) != 1 or relative_value_pair is not None:
            raise PortfolioFailure(
                "portfolio.translation-population",
                "Single-asset temporal translation requires exactly one prediction asset",
            )
        asset = prediction_assets[0]
        values = factors[asset].where(np.isfinite(factors[asset]))
        temporal_scores, temporal_observations = _causal_empirical_percentile(
            values,
            window=temporal_window,
            minimum=temporal_minimum,
        )
        scores.loc[:, asset] = temporal_scores
        translation_values.loc[:, asset] = values
        observations.loc[:, asset] = temporal_observations
    else:
        if len(prediction_assets) != 2 or not isinstance(relative_value_pair, dict):
            raise PortfolioFailure(
                "portfolio.translation-population",
                "Relative-value translation requires one ordered two-asset pair",
            )
        left = relative_value_pair.get("left_asset")
        right = relative_value_pair.get("right_asset")
        if prediction_assets != [left, right]:
            raise PortfolioFailure(
                "portfolio.translation-pair",
                "Relative-value pair order differs from the prediction population",
            )
        spread = (factors[left] - factors[right]).where(
            np.isfinite(factors[left]) & np.isfinite(factors[right])
        )
        spread_scores, spread_observations = _causal_empirical_percentile(
            spread,
            window=temporal_window,
            minimum=temporal_minimum,
        )
        scores.loc[:, left] = spread_scores
        scores.loc[:, right] = 1.0 - spread_scores
        translation_values.loc[:, left] = spread
        translation_values.loc[:, right] = -spread
        observations.loc[:, left] = spread_observations
        observations.loc[:, right] = spread_observations
    semantics = signal_translation_contract(
        population,
        temporal_window=temporal_window,
        temporal_minimum=temporal_minimum,
    )
    return scores, translation_values, observations, semantics


def _valid_decision_policy(
    value: object,
    *,
    expected_source: object | None = None,
) -> bool:
    if not isinstance(value, dict):
        return False
    source = value.get("source")
    if expected_source is not None and source != expected_source:
        return False
    if source is not None and source not in {
        "caller-supplied",
        "reference-default",
    }:
        return False
    source_keys = {"source"} if source is not None else set()
    if value.get("kind") == "every-bars":
        bars = value.get("bars")
        return (
            set(value) == source_keys | {"kind", "bars", "anchor"}
            and isinstance(bars, int)
            and not isinstance(bars, bool)
            and 1 <= bars <= 252
            and value.get("anchor") in {"dataset-start", "session-start"}
        )
    return (
        value.get("kind") == "calendar-month-end"
        and set(value) == source_keys | {"kind"}
    )


def _allocate_capped_side(
    strengths: pd.Series,
    *,
    budget: float = SIDE_BUDGET,
    cap: float | pd.Series = MAX_ABS_WEIGHT,
) -> pd.Series:
    """Proportionally water-fill one non-negative side under named caps."""

    clean = strengths.astype(float)
    clean = clean[np.isfinite(clean.to_numpy()) & (clean > 0)]
    output = pd.Series(0.0, index=strengths.index, dtype=float)
    caps = (
        pd.Series(float(cap), index=strengths.index, dtype=float)
        if isinstance(cap, (int, float)) and not isinstance(cap, bool)
        else cap.reindex(strengths.index).astype(float)
        if isinstance(cap, pd.Series)
        else pd.Series(dtype=float)
    )
    if (
        not caps.index.equals(strengths.index)
        or not np.isfinite(caps.to_numpy()).all()
        or (caps < 0).any()
    ):
        raise PortfolioFailure(
            "portfolio.asset-caps",
            "Per-asset caps must be aligned, finite, and non-negative",
        )
    if clean.empty or float(caps.loc[clean.index].sum()) + 1e-12 < budget:
        return output
    remaining = list(clean.index)
    remaining_budget = float(budget)
    while remaining:
        values = clean.loc[remaining]
        total = float(values.sum())
        if total <= 0:
            return pd.Series(0.0, index=strengths.index, dtype=float)
        proposed = values / total * remaining_budget
        capped = proposed[
            proposed > caps.loc[proposed.index] + 1e-12
        ]
        if capped.empty:
            output.loc[remaining] = proposed
            remaining_budget = 0.0
            break
        for asset in capped.index:
            output.loc[asset] = caps.loc[asset]
            remaining.remove(asset)
            remaining_budget -= float(caps.loc[asset])
        if remaining_budget < -1e-10:
            raise PortfolioFailure(
                "portfolio.allocation",
                "Capped side allocation exceeded its budget",
            )
    if abs(float(output.sum()) - budget) > 1e-9:
        return pd.Series(0.0, index=strengths.index, dtype=float)
    return output


def _allocate_capped_up_to(
    strengths: pd.Series,
    *,
    limit: float,
    cap: float | pd.Series,
) -> pd.Series:
    """Allocate available directional conviction and leave unused budget in cash."""

    clean = strengths.astype(float)
    clean = clean[np.isfinite(clean.to_numpy()) & (clean > 0)]
    if clean.empty:
        return pd.Series(0.0, index=strengths.index, dtype=float)
    caps = (
        pd.Series(float(cap), index=strengths.index, dtype=float)
        if isinstance(cap, (int, float)) and not isinstance(cap, bool)
        else cap.reindex(strengths.index).astype(float)
        if isinstance(cap, pd.Series)
        else pd.Series(dtype=float)
    )
    budget = min(float(limit), float(caps.loc[clean.index].sum()))
    return _allocate_capped_side(strengths, budget=budget, cap=cap)


def _valid_benchmark_contract(
    benchmark: object,
    universe: list[str],
    tradable: list[str],
    asset_position_roles: dict[str, str],
) -> bool:
    if (
        not isinstance(benchmark, dict)
        or set(benchmark) != {"source", "kind", "asset", "weights"}
        or benchmark.get("source")
        not in {"caller-supplied", "direction-default"}
        or benchmark.get("kind")
        not in {
            "cash",
            "fixed-weights",
            "equal-weight-long-research-universe",
            "equal-weight-long-tradable",
            "equal-weight-short-tradable",
            "equal-weight-long-capable",
            "equal-weight-short-capable",
            "single-asset-long",
        }
        or not isinstance(benchmark.get("weights"), dict)
        or set(benchmark["weights"]) != set(universe)
        or any(
            not isinstance(benchmark["weights"][asset], (int, float))
            or isinstance(benchmark["weights"][asset], bool)
            or not math.isfinite(float(benchmark["weights"][asset]))
            for asset in universe
        )
    ):
        return False
    kind = benchmark["kind"]
    benchmark_asset = benchmark["asset"]
    if kind == "cash":
        expected = {asset: 0.0 for asset in universe}
        valid_asset = benchmark_asset is None
    elif kind == "fixed-weights":
        expected = {
            asset: float(benchmark["weights"][asset])
            for asset in universe
        }
        valid_asset = (
            benchmark_asset is None
            and all(0.0 <= weight <= 1.0 for weight in expected.values())
            and any(weight > 0.0 for weight in expected.values())
            and math.isclose(
                sum(expected.values()),
                1.0,
                rel_tol=0.0,
                abs_tol=1e-9,
            )
        )
    elif kind == "equal-weight-long-research-universe":
        expected = {
            asset: 1.0 / len(universe) for asset in universe
        }
        valid_asset = benchmark_asset is None
    elif kind in {
        "equal-weight-long-tradable",
        "equal-weight-short-tradable",
    }:
        sign = 1.0 if kind == "equal-weight-long-tradable" else -1.0
        tradable_set = set(tradable)
        expected = {
            asset: (
                sign / len(tradable) if asset in tradable_set else 0.0
            )
            for asset in universe
        }
        valid_asset = benchmark_asset is None
    elif kind in {
        "equal-weight-long-capable",
        "equal-weight-short-capable",
    }:
        long_side = kind == "equal-weight-long-capable"
        capable = [
            asset
            for asset in tradable
            if asset_position_roles[asset]
            in (
                {"long-only", "two-sided"}
                if long_side
                else {"short-only", "two-sided"}
            )
        ]
        if not capable:
            return False
        sign = 1.0 if long_side else -1.0
        capable_set = set(capable)
        expected = {
            asset: (
                sign / len(capable) if asset in capable_set else 0.0
            )
            for asset in universe
        }
        valid_asset = benchmark_asset is None
    else:
        valid_asset = (
            isinstance(benchmark_asset, str)
            and benchmark_asset in universe
        )
        expected = {
            asset: 1.0 if asset == benchmark_asset else 0.0
            for asset in universe
        }
    if kind == "cash":
        source_matches = True
    elif kind in {"fixed-weights", "single-asset-long"}:
        source_matches = benchmark["source"] == "caller-supplied"
    else:
        source_matches = benchmark["source"] == "direction-default"
    return (
        valid_asset
        and source_matches
        and all(
            math.isclose(
                float(benchmark["weights"][asset]),
                expected[asset],
                rel_tol=0.0,
                abs_tol=1e-12,
            )
            for asset in universe
        )
    )


def _resolve_mandate(
    columns: pd.Index,
    mandate: dict[str, object] | None,
) -> dict[str, object]:
    """Resolve the copied Judge's fixed position contract."""

    universe = [str(column) for column in columns]
    if mandate is None:
        return {
            "id": "legacy-dollar-neutral",
            "direction": "research-only",
            "family": "dollar-neutral",
            "gross_limit": GROSS_TARGET,
            "max_abs_weight": MAX_ABS_WEIGHT,
            "asset_max_abs_weights": {
                asset: MAX_ABS_WEIGHT for asset in universe
            },
            "asset_position_roles": {
                asset: "two-sided" for asset in universe
            },
            "long_gross_limit": GROSS_TARGET / 2.0,
            "short_gross_limit": GROSS_TARGET / 2.0,
            "tradable_assets": universe,
            "context_assets": [],
            "benchmark": {
                "source": "direction-default",
                "kind": "equal-weight-long-research-universe",
                "asset": None,
                "weights": {
                    asset: 1.0 / len(universe)
                    for asset in universe
                },
            },
            "implementation_policy": {
                "base_cost_bps": BASE_COST_BPS,
                "no_trade_one_way": NO_TRADE_ONE_WAY,
                "reference_nav": REFERENCE_NAV,
                "decision_policy": dict(DEFAULT_DECISION_POLICY),
            },
            "risk_policy": None,
        }
    source = mandate.get("source")
    construction = mandate.get("construction")
    if not isinstance(source, dict) or not isinstance(construction, dict):
        raise PortfolioFailure(
            "mandate.contract",
            "Portfolio Mandate source and construction must be objects",
        )
    research = mandate.get("researchUniverse")
    tradable = mandate.get("tradableAssets")
    context = mandate.get("contextAssets")
    if research != universe:
        raise PortfolioFailure(
            "mandate.universe",
            "Portfolio Mandate research universe differs from the Study panel",
        )
    if (
        not isinstance(tradable, list)
        or not tradable
        or not all(isinstance(asset, str) for asset in tradable)
        or not isinstance(context, list)
        or not all(isinstance(asset, str) for asset in context)
        or set(tradable) | set(context) != set(universe)
        or set(tradable) & set(context)
    ):
        raise PortfolioFailure(
            "mandate.assets",
            "Portfolio Mandate must partition research and tradable assets",
        )
    direction = source.get("direction")
    family = construction.get("family")
    gross_limit = construction.get("grossLimit")
    max_abs_weight = construction.get("maxAbsWeight")
    asset_max_abs_weights = construction.get(
        "assetMaxAbsWeights"
    )
    asset_position_roles = construction.get("assetPositionRoles")
    long_gross_limit = construction.get("longGrossLimit")
    short_gross_limit = construction.get("shortGrossLimit")
    benchmark = construction.get("benchmark")
    risk_policy = construction.get("riskPolicy")
    implementation = mandate.get("implementationPolicy")
    if (
        direction
        not in {"long", "short", "long-short", "relative-value", "research-only"}
        or family not in {
            "long-cash",
            "short-cash",
            "dollar-neutral",
            "asset-role",
        }
        or not isinstance(gross_limit, (int, float))
        or isinstance(gross_limit, bool)
        or not 0 < float(gross_limit) <= 2
        or not isinstance(max_abs_weight, (int, float))
        or isinstance(max_abs_weight, bool)
        or not 0 < float(max_abs_weight) <= float(gross_limit)
        or not isinstance(asset_max_abs_weights, dict)
        or set(asset_max_abs_weights) != set(universe)
        or any(
            not isinstance(asset_max_abs_weights[asset], (int, float))
            or isinstance(asset_max_abs_weights[asset], bool)
            or not math.isfinite(
                float(asset_max_abs_weights[asset])
            )
            or (
                not 0
                < float(asset_max_abs_weights[asset])
                <= float(max_abs_weight)
                if asset in tradable
                else abs(float(asset_max_abs_weights[asset])) > 1e-12
            )
            for asset in universe
        )
        or not isinstance(asset_position_roles, dict)
        or set(asset_position_roles) != set(universe)
        or any(
            asset_position_roles[asset]
            not in {
                "long-only",
                "short-only",
                "two-sided",
                "context-only",
            }
            or (
                asset_position_roles[asset] == "context-only"
                if asset in tradable
                else asset_position_roles[asset] != "context-only"
            )
            for asset in universe
        )
        or not isinstance(long_gross_limit, (int, float))
        or isinstance(long_gross_limit, bool)
        or not math.isfinite(float(long_gross_limit))
        or not 0 <= float(long_gross_limit) <= float(gross_limit)
        or not isinstance(short_gross_limit, (int, float))
        or isinstance(short_gross_limit, bool)
        or not math.isfinite(float(short_gross_limit))
        or not 0 <= float(short_gross_limit) <= float(gross_limit)
        or float(long_gross_limit) + float(short_gross_limit)
        > float(gross_limit) + 1e-12
        or not _valid_benchmark_contract(
            benchmark,
            universe,
            tradable,
            asset_position_roles,
        )
        or benchmark["source"] != source.get("benchmarkPolicy")
        or not isinstance(risk_policy, dict)
        or not isinstance(implementation, dict)
        or set(implementation)
        != {
            "baseCostBps",
            "noTradeOneWay",
            "referenceNav",
            "decisionPolicy",
            "costModel",
            "capacityModel",
        }
        or implementation.get("costModel")
        != "linear-traded-notional-v1"
        or implementation.get("capacityModel")
        != "trailing-dollar-volume-participation-v1"
        or not isinstance(implementation.get("baseCostBps"), (int, float))
        or isinstance(implementation.get("baseCostBps"), bool)
        or not 0 <= float(implementation["baseCostBps"]) <= 1000
        or not isinstance(implementation.get("noTradeOneWay"), (int, float))
        or isinstance(implementation.get("noTradeOneWay"), bool)
        or not 0 <= float(implementation["noTradeOneWay"]) <= 1
        or not isinstance(implementation.get("referenceNav"), (int, float))
        or isinstance(implementation.get("referenceNav"), bool)
        or not 0 < float(implementation["referenceNav"]) <= 1e12
        or not _valid_decision_policy(
            implementation.get("decisionPolicy"),
            expected_source=source.get("portfolioPolicy"),
        )
        or set(risk_policy)
        != {
            "method",
            "annualizedVolatilityCeiling",
            "covarianceWindow",
            "minimumObservations",
            "annualizationPeriods",
            "scaleUp",
        }
        or risk_policy.get("method")
        != "trailing-covariance-volatility-ceiling-v1"
        or not isinstance(
            risk_policy.get("annualizedVolatilityCeiling"),
            (int, float),
        )
        or isinstance(
            risk_policy.get("annualizedVolatilityCeiling"),
            bool,
        )
        or not 0
        < float(risk_policy["annualizedVolatilityCeiling"])
        <= 1
        or not isinstance(risk_policy.get("covarianceWindow"), int)
        or isinstance(risk_policy.get("covarianceWindow"), bool)
        or risk_policy["covarianceWindow"] < 2
        or not isinstance(risk_policy.get("minimumObservations"), int)
        or isinstance(risk_policy.get("minimumObservations"), bool)
        or not 2
        <= risk_policy["minimumObservations"]
        <= risk_policy["covarianceWindow"]
        or not isinstance(risk_policy.get("annualizationPeriods"), int)
        or isinstance(risk_policy.get("annualizationPeriods"), bool)
        or risk_policy["annualizationPeriods"] < 1
        or risk_policy.get("scaleUp") is not False
    ):
        raise PortfolioFailure(
            "mandate.construction",
            "Portfolio Mandate contains unsupported construction semantics",
        )
    return {
        "id": str(mandate.get("id")),
        "direction": str(direction),
        "family": str(family),
        "gross_limit": float(gross_limit),
        "max_abs_weight": float(max_abs_weight),
        "asset_max_abs_weights": {
            asset: float(asset_max_abs_weights[asset])
            for asset in universe
        },
        "asset_position_roles": {
            asset: str(asset_position_roles[asset])
            for asset in universe
        },
        "long_gross_limit": float(long_gross_limit),
        "short_gross_limit": float(short_gross_limit),
        "tradable_assets": list(tradable),
        "context_assets": list(context),
        "benchmark": {
            "source": str(benchmark["source"]),
            "kind": str(benchmark["kind"]),
            "asset": benchmark["asset"],
            "weights": {
                asset: float(benchmark["weights"][asset])
                for asset in universe
            },
        },
        "implementation_policy": {
            "base_cost_bps": float(implementation["baseCostBps"]),
            "no_trade_one_way": float(implementation["noTradeOneWay"]),
            "reference_nav": float(implementation["referenceNav"]),
            "decision_policy": dict(implementation["decisionPolicy"]),
        },
        "risk_policy": {
            "method": str(risk_policy["method"]),
            "annualized_volatility_ceiling": float(
                risk_policy["annualizedVolatilityCeiling"]
            ),
            "covariance_window": int(risk_policy["covarianceWindow"]),
            "minimum_observations": int(
                risk_policy["minimumObservations"]
            ),
            "annualization_periods": int(
                risk_policy["annualizationPeriods"]
            ),
            "scale_up": False,
        },
    }


def resolve_implementation_policy(
    mandate: dict[str, object] | None,
) -> dict[str, object]:
    """Resolve fixed accounting assumptions without requiring an asset panel."""

    if mandate is None:
        return {
            "base_cost_bps": BASE_COST_BPS,
            "no_trade_one_way": NO_TRADE_ONE_WAY,
            "reference_nav": REFERENCE_NAV,
            "decision_policy": dict(DEFAULT_DECISION_POLICY),
        }
    implementation = mandate.get("implementationPolicy")
    if not isinstance(implementation, dict):
        raise PortfolioFailure(
            "mandate.implementation",
            "Portfolio Mandate implementation policy must be an object",
        )
    result = {
        "base_cost_bps": implementation.get("baseCostBps"),
        "no_trade_one_way": implementation.get("noTradeOneWay"),
        "reference_nav": implementation.get("referenceNav"),
        "decision_policy": implementation.get("decisionPolicy"),
    }
    if (
        not isinstance(result["base_cost_bps"], (int, float))
        or isinstance(result["base_cost_bps"], bool)
        or not 0 <= float(result["base_cost_bps"]) <= 1000
        or not isinstance(result["no_trade_one_way"], (int, float))
        or isinstance(result["no_trade_one_way"], bool)
        or not 0 <= float(result["no_trade_one_way"]) <= 1
        or not isinstance(result["reference_nav"], (int, float))
        or isinstance(result["reference_nav"], bool)
        or not 0 < float(result["reference_nav"]) <= 1e12
        or not _valid_decision_policy(result["decision_policy"])
    ):
        raise PortfolioFailure(
            "mandate.implementation",
            "Portfolio Mandate implementation policy is invalid",
        )
    return {
        "base_cost_bps": float(result["base_cost_bps"]),
        "no_trade_one_way": float(result["no_trade_one_way"]),
        "reference_nav": float(result["reference_nav"]),
        "decision_policy": dict(result["decision_policy"]),
    }


def resolve_portfolio_mandate(
    columns: pd.Index,
    mandate: dict[str, object] | None,
) -> dict[str, object]:
    """Validate and resolve one fixed Mandate once for repeated accounting."""

    return _resolve_mandate(columns, mandate)


def decision_schedule_sessions(
    index: pd.Index,
    decision_policy: dict[str, object],
) -> pd.Series:
    """Return the immutable schedule group for every complete-panel row."""

    if not index.is_unique or not _valid_decision_policy(decision_policy):
        raise PortfolioFailure(
            "portfolio.decision-schedule",
            "Decision schedule requires a unique index and valid policy",
        )
    if decision_policy["kind"] == "calendar-month-end":
        timestamps = pd.DatetimeIndex(index)
        if timestamps.tz is not None:
            timestamps = timestamps.tz_convert("America/New_York").tz_localize(None)
        return pd.Series(
            timestamps.to_period("M").astype(str),
            index=index,
            dtype="string",
            name="decision_session",
        )
    decision_anchor = str(decision_policy["anchor"])
    if decision_anchor == "dataset-start":
        return pd.Series(
            "dataset",
            index=index,
            dtype="string",
            name="decision_session",
        )
    timestamps = pd.DatetimeIndex(index)
    if timestamps.tz is None:
        raise PortfolioFailure(
            "portfolio.decision-anchor",
            "session-start requires timezone-aware XNYS base closes",
        )
    return pd.Series(
        timestamps.tz_convert("UTC").strftime("%Y-%m-%d"),
        index=index,
        dtype="string",
        name="decision_session",
    )


def decision_schedule_mask(
    index: pd.Index,
    decision_policy: dict[str, object],
) -> pd.Series:
    """Return one immutable complete-panel anchor-aware decision mask."""

    if not index.is_unique or not _valid_decision_policy(decision_policy):
        raise PortfolioFailure(
            "portfolio.decision-cadence",
            "Decision cadence requires a unique index and valid policy",
        )
    if decision_policy["kind"] == "calendar-month-end":
        timestamps = pd.DatetimeIndex(index)
        if timestamps.empty:
            return pd.Series(
                [],
                index=index,
                dtype=bool,
                name="decision_eligible",
            )
        if timestamps.tz is not None:
            local_dates = timestamps.tz_convert(
                "America/New_York"
            ).tz_localize(None).normalize()
        else:
            local_dates = timestamps.normalize()
        month_end = local_dates.max() + pd.offsets.MonthEnd(0)
        calendar = exchange_calendars.get_calendar(
            "XNYS",
            start=str(local_dates.min().date()),
            end=str(month_end.date()),
        )
        official_sessions = pd.DatetimeIndex(calendar.sessions)
        if official_sessions.tz is not None:
            official_sessions = official_sessions.tz_localize(None)
        official_sessions = official_sessions.normalize()
        official_month_ends = (
            pd.Series(official_sessions, index=official_sessions.to_period("M"))
            .groupby(level=0, sort=True)
            .max()
        )
        eligible_dates = set(official_month_ends.tolist())
        return pd.Series(
            local_dates.isin(eligible_dates),
            index=index,
            dtype=bool,
            name="decision_eligible",
        )
    decision_every_bars = int(decision_policy["bars"])
    sessions = decision_schedule_sessions(index, decision_policy)
    ordinal = sessions.groupby(sessions, sort=False).cumcount()
    return pd.Series(
        ordinal.mod(decision_every_bars).eq(0).to_numpy(),
        index=index,
        dtype=bool,
        name="decision_eligible",
    )


def _govern_portfolio_risk(
    raw_targets: pd.Series,
    close_returns: pd.DataFrame,
    timestamp: object,
    resolved: dict[str, object],
    *,
    enabled: bool,
    risk_covariance_cache: RiskCovarianceCache | None = None,
) -> tuple[pd.Series, dict[str, float | int | str]]:
    """Apply one causal, one-sided portfolio-volatility ceiling."""

    gross = float(raw_targets.abs().sum())
    policy = resolved["risk_policy"]
    if gross <= 1e-12:
        return raw_targets.copy(), {
            "status": "flat",
            "observations": 0,
            "pre_annualized_volatility": 0.0,
            "post_annualized_volatility": 0.0,
            "annualized_volatility_ceiling": (
                float(policy["annualized_volatility_ceiling"])
                if isinstance(policy, dict)
                else 0.0
            ),
            "scale": 1.0,
        }
    if policy is None:
        return raw_targets.copy(), {
            "status": "legacy_none",
            "observations": 0,
            "pre_annualized_volatility": 0.0,
            "post_annualized_volatility": 0.0,
            "annualized_volatility_ceiling": 0.0,
            "scale": 1.0,
        }
    assert isinstance(policy, dict)
    covariance_values: np.ndarray | None
    if risk_covariance_cache is not None:
        cached = risk_covariance_cache.get(timestamp)
        if cached is None:
            raise PortfolioFailure(
                "portfolio.risk-cache",
                "Risk covariance cache is missing a decision timestamp",
            )
        observations, covariance_values = cached
        if (
            covariance_values is not None
            and covariance_values.shape
            != (len(raw_targets), len(raw_targets))
        ):
            raise PortfolioFailure(
                "portfolio.risk-cache",
                "Risk covariance cache shape is invalid",
            )
    else:
        history = (
            close_returns.loc[:timestamp]
            .tail(int(policy["covariance_window"]))
            .dropna(how="any")
        )
        observations = int(len(history))
        covariance = history.cov(ddof=0).reindex(
            index=raw_targets.index,
            columns=raw_targets.index,
        )
        covariance_values = (
            None
            if covariance.isna().any().any()
            else covariance.to_numpy(dtype=float)
        )
    minimum = int(policy["minimum_observations"])
    ceiling = float(policy["annualized_volatility_ceiling"])
    if observations < minimum:
        return raw_targets * 0.0, {
            "status": "insufficient_history",
            "observations": observations,
            "pre_annualized_volatility": 0.0,
            "post_annualized_volatility": 0.0,
            "annualized_volatility_ceiling": ceiling,
            "scale": 0.0,
        }
    if covariance_values is None:
        return raw_targets * 0.0, {
            "status": "invalid_covariance",
            "observations": observations,
            "pre_annualized_volatility": 0.0,
            "post_annualized_volatility": 0.0,
            "annualized_volatility_ceiling": ceiling,
            "scale": 0.0,
        }
    vector = raw_targets.to_numpy(dtype=float)
    variance = float(vector @ covariance_values @ vector)
    if not math.isfinite(variance) or variance < -1e-12:
        return raw_targets * 0.0, {
            "status": "invalid_covariance",
            "observations": observations,
            "pre_annualized_volatility": 0.0,
            "post_annualized_volatility": 0.0,
            "annualized_volatility_ceiling": ceiling,
            "scale": 0.0,
        }
    forecast = math.sqrt(
        max(variance, 0.0) * int(policy["annualization_periods"])
    )
    scale = (
        min(1.0, ceiling / forecast)
        if enabled and forecast > 1e-12
        else 1.0
    )
    governed = raw_targets * scale
    return governed, {
        "status": (
            "diagnostic_disabled"
            if not enabled
            else "volatility_limited"
            if scale < 1.0 - 1e-12
            else "within_ceiling"
        ),
        "observations": observations,
        "pre_annualized_volatility": forecast,
        "post_annualized_volatility": forecast * scale,
        "annualized_volatility_ceiling": ceiling,
        "scale": scale,
    }


def build_risk_covariance_cache(
    closes: pd.DataFrame,
    *,
    mandate: dict[str, object] | None,
) -> RiskCovarianceCache:
    """Precompute one causal covariance panel for repeated fixed simulations."""

    resolved = _resolve_mandate(closes.columns, mandate)
    policy = resolved["risk_policy"]
    if policy is None:
        return {}
    assert isinstance(policy, dict)
    close_returns = closes.pct_change(fill_method=None)
    cache: RiskCovarianceCache = {}
    window = int(policy["covariance_window"])
    minimum = int(policy["minimum_observations"])
    return_values = close_returns.to_numpy(dtype=float)
    for row_number, timestamp in enumerate(closes.index):
        history = return_values[
            max(0, row_number - window + 1) : row_number + 1
        ]
        history = history[np.isfinite(history).all(axis=1)]
        observations = int(history.shape[0])
        covariance_values: np.ndarray | None = None
        if observations >= minimum:
            covariance_values = np.atleast_2d(
                np.cov(
                    history,
                    rowvar=False,
                    ddof=0,
                )
            )
            if (
                covariance_values.shape
                != (len(closes.columns), len(closes.columns))
                or not np.isfinite(covariance_values).all()
            ):
                covariance_values = None
        cache[timestamp] = (observations, covariance_values)
    return cache


def _repair_executed_mandate_constraints(
    weights: pd.Series,
    resolved: dict[str, object],
) -> tuple[pd.Series, dict[str, float | bool | str]]:
    """Scale down a chosen book until every hard Mandate constraint holds."""

    original = weights.to_numpy(dtype=float, copy=False)
    roles = resolved["asset_position_roles"]
    caps = resolved["asset_max_abs_weights"]
    assert isinstance(roles, dict)
    assert isinstance(caps, dict)
    role_values = resolved.get("_constraint_role_values")
    cap_values = resolved.get("_constraint_cap_values")
    if (
        not isinstance(role_values, tuple)
        or len(role_values) != len(weights)
        or not isinstance(cap_values, np.ndarray)
        or cap_values.shape != (len(weights),)
    ):
        role_values = tuple(
            str(roles[str(asset)]) for asset in weights.index
        )
        cap_values = np.asarray(
            [float(caps[str(asset)]) for asset in weights.index],
            dtype=float,
        )
        resolved["_constraint_role_values"] = role_values
        resolved["_constraint_cap_values"] = cap_values
    family = str(resolved["family"])
    gross_limit = float(resolved["gross_limit"])
    long_limit = float(resolved["long_gross_limit"])
    short_limit = float(resolved["short_gross_limit"])
    repaired_values = original.copy()
    for position, role in enumerate(role_values):
        cap = float(cap_values[position])
        value = float(repaired_values[position])
        if role == "context-only":
            value = 0.0
        elif role == "long-only":
            value = max(value, 0.0)
        elif role == "short-only":
            value = min(value, 0.0)
        repaired_values[position] = min(max(value, -cap), cap)

    def scale_side(positive: bool, limit: float) -> None:
        mask = repaired_values > 0.0 if positive else repaired_values < 0.0
        exposure = float(
            repaired_values[mask].sum()
            if positive
            else -repaired_values[mask].sum()
        )
        if exposure > limit + 1e-15:
            repaired_values[mask] *= limit / exposure

    if family == "dollar-neutral":
        positive = repaired_values > 0.0
        negative = repaired_values < 0.0
        long_exposure = float(repaired_values[positive].sum())
        short_exposure = float(-repaired_values[negative].sum())
        funded_side = min(
            long_exposure,
            short_exposure,
            long_limit,
            short_limit,
            gross_limit / 2.0,
        )
        if funded_side <= 1e-15:
            repaired_values.fill(0.0)
        else:
            repaired_values[positive] *= funded_side / long_exposure
            repaired_values[negative] *= funded_side / short_exposure
    else:
        scale_side(True, long_limit)
        scale_side(False, short_limit)
        gross = float(np.abs(repaired_values).sum())
        if gross > gross_limit + 1e-15:
            repaired_values *= gross_limit / gross

    gross = float(np.abs(repaired_values).sum())
    long_exposure = float(repaired_values[repaired_values > 0.0].sum())
    short_exposure = float(-repaired_values[repaired_values < 0.0].sum())
    net = float(repaired_values.sum())
    cap_excess = float(
        np.maximum(np.abs(repaired_values) - cap_values, 0.0).max(
            initial=0.0
        )
    )
    context_exposure = max(
        (
            abs(float(repaired_values[position]))
            for position, role in enumerate(role_values)
            if role == "context-only"
        ),
        default=0.0,
    )
    role_error = max(
        (
            max(0.0, -float(repaired_values[position]))
            if role == "long-only"
            else max(0.0, float(repaired_values[position]))
            if role == "short-only"
            else 0.0
            for position, role in enumerate(role_values)
        ),
        default=0.0,
    )
    net_error = (
        abs(net)
        if family == "dollar-neutral"
        else abs(net - gross)
        if family == "long-cash"
        else abs(net + gross)
        if family == "short-cash"
        else 0.0
    )
    maximum_error = max(
        0.0,
        gross - gross_limit,
        long_exposure - long_limit,
        short_exposure - short_limit,
        cap_excess,
        context_exposure,
        role_error,
        net_error,
    )
    if maximum_error > 1e-10:
        raise PortfolioFailure(
            "portfolio.executed-constraint-breach",
            "Final executed book cannot be repaired to the Portfolio Mandate",
        )
    repair_one_way = 0.5 * float(np.abs(repaired_values - original).sum())
    repaired = (
        pd.Series(repaired_values, index=weights.index, dtype=float)
        if repair_one_way > 1e-12
        else weights.astype(float, copy=False)
    )
    return repaired, {
        "status": (
            "constraint_repaired"
            if repair_one_way > 1e-12
            else "within_constraints"
        ),
        "repaired": repair_one_way > 1e-12,
        "repair_one_way": repair_one_way,
        "maximum_error": maximum_error,
    }


def execute_risk_compliant_book(
    pretrade: pd.Series,
    proposed: pd.Series,
    close_returns: pd.DataFrame,
    timestamp: object,
    *,
    mandate: dict[str, object] | None,
    no_trade_one_way: float = NO_TRADE_ONE_WAY,
    ordinary_rebalance_allowed: bool = True,
    risk_covariance_cache: RiskCovarianceCache | None = None,
    _resolved_mandate: dict[str, object] | None = None,
    _state_only: bool = False,
) -> tuple[pd.Series, dict[str, object]]:
    """Choose the final book, with risk compliance outranking no-trade."""

    if (
        not pretrade.index.equals(proposed.index)
        or list(close_returns.columns) != list(pretrade.index)
        or timestamp not in close_returns.index
        or not 0 <= no_trade_one_way <= 1
        or not isinstance(ordinary_rebalance_allowed, bool)
        or not isinstance(_state_only, bool)
    ):
        raise PortfolioFailure(
            "portfolio.execution-risk",
            "Invalid executed-book risk inputs",
        )
    if not np.isfinite(pretrade.to_numpy(dtype=float)).all() or not np.isfinite(
        proposed.to_numpy(dtype=float)
    ).all():
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Executed-book risk inputs contain non-finite weights",
        )
    resolved = (
        _resolved_mandate
        if _resolved_mandate is not None
        else _resolve_mandate(pretrade.index, mandate)
    )
    if _state_only and not ordinary_rebalance_allowed:
        constraint_book, _ = _repair_executed_mandate_constraints(
            pretrade,
            resolved,
        )
        current, _ = _govern_portfolio_risk(
            constraint_book,
            close_returns,
            timestamp,
            resolved,
            enabled=True,
            risk_covariance_cache=risk_covariance_cache,
        )
        return current, {}
    pretrade_risk: dict[str, object] | None = None
    if not _state_only:
        _, pretrade_risk = _govern_portfolio_risk(
            pretrade,
            close_returns,
            timestamp,
            resolved,
            enabled=False,
            risk_covariance_cache=risk_covariance_cache,
        )
    constrained_proposed, _ = _repair_executed_mandate_constraints(
        proposed,
        resolved,
    )
    runtime_proposed, proposed_risk = _govern_portfolio_risk(
        constrained_proposed,
        close_returns,
        timestamp,
        resolved,
        enabled=True,
        risk_covariance_cache=risk_covariance_cache,
    )
    proposed_delta = runtime_proposed - pretrade
    proposed_one_way = 0.5 * float(proposed_delta.abs().sum())
    ordinary_rebalance = (
        ordinary_rebalance_allowed
        and proposed_one_way + 1e-12 >= no_trade_one_way
    )
    ordinary_book = runtime_proposed if ordinary_rebalance else pretrade
    constraint_book, constraint_evidence = (
        _repair_executed_mandate_constraints(
            ordinary_book,
            resolved,
        )
    )
    if ordinary_rebalance:
        current = constraint_book
        execution_risk = proposed_risk
    else:
        current, execution_risk = _govern_portfolio_risk(
            constraint_book,
            close_returns,
            timestamp,
            resolved,
            enabled=True,
            risk_covariance_cache=risk_covariance_cache,
        )
    risk_repair_trade = current - constraint_book
    risk_repaired = bool(risk_repair_trade.abs().sum() > 1e-12)
    constraint_repaired = bool(constraint_evidence["repaired"])
    risk_override = risk_repaired and not ordinary_rebalance
    constraint_override = constraint_repaired and not ordinary_rebalance
    actual_trade = current - pretrade
    rebalanced = bool(actual_trade.abs().sum() > 1e-12)
    if _state_only:
        return current, {}
    assert pretrade_risk is not None
    raw_status = str(execution_risk["status"])
    if risk_repaired:
        status = (
            f"{raw_status}_fail_flat"
            if raw_status in {"insufficient_history", "invalid_covariance"}
            else "risk_repaired"
        )
    elif constraint_repaired:
        status = "constraint_repaired"
    else:
        status = raw_status
    if risk_override and constraint_override:
        reason = "mandate_and_risk_override"
    elif constraint_override:
        reason = "mandate_constraint_override"
    elif risk_override:
        reason = "risk_ceiling_override"
    elif risk_repaired:
        reason = "target_risk_repair"
    elif constraint_repaired:
        reason = "target_constraint_repair"
    elif ordinary_rebalance:
        reason = "rebalance_threshold_met"
    elif not ordinary_rebalance_allowed:
        reason = "decision_schedule_hold"
    else:
        reason = "portfolio_no_trade_band"

    final_forecast = float(execution_risk["post_annualized_volatility"])
    ceiling = float(execution_risk["annualized_volatility_ceiling"])
    policy = resolved["risk_policy"]
    forecast_available = (
        isinstance(policy, dict)
        and raw_status
        not in {"insufficient_history", "invalid_covariance"}
    )
    if (
        forecast_available
        and final_forecast
        > ceiling + RISK_COMPLIANCE_TOLERANCE
    ):
        raise PortfolioFailure(
            "portfolio.risk-breach",
            "Final executed book exceeds the volatility ceiling",
        )
    result: dict[str, object] = {
        "status": status,
        "forecast_available": forecast_available,
        "observations": int(execution_risk["observations"]),
        "pretrade_forecast_annualized": float(
            pretrade_risk["pre_annualized_volatility"]
        ),
        "proposed_forecast_pre_annualized": float(
            proposed_risk["pre_annualized_volatility"]
        ),
        "proposed_forecast_post_annualized": float(
            proposed_risk["post_annualized_volatility"]
        ),
        "executed_forecast_annualized": final_forecast,
        "annualized_volatility_ceiling": ceiling,
        "proposed_runtime_scale": float(proposed_risk["scale"]),
        "risk_repair_scale": float(execution_risk["scale"]),
        "proposed_one_way": proposed_one_way,
        "ordinary_rebalance": ordinary_rebalance,
        "decision_eligible": ordinary_rebalance_allowed,
        "risk_rebalance_override": risk_override,
        "constraint_rebalance_override": constraint_override,
        "constraint_repair_one_way": float(
            constraint_evidence["repair_one_way"]
        ),
        "executed_constraint_maximum_error": float(
            constraint_evidence["maximum_error"]
        ),
        "rebalanced": rebalanced,
        "execution_reason": reason,
    }
    numeric = [
        float(value)
        for value in result.values()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    ]
    if not all(math.isfinite(value) and value >= 0 for value in numeric):
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Executed-book risk evidence contains invalid values",
        )
    return current, result


def _signal_transition(
    previous: int,
    score: float | None,
    *,
    long_entry: float,
    long_exit: float,
    short_exit: float,
    short_entry: float,
) -> tuple[int, str]:
    if score is None or not math.isfinite(score):
        return (
            0,
            "unavailable_flat" if previous == 0 else "unavailable_reset",
        )
    if previous == 0:
        if score >= long_entry:
            return 1, "enter_long"
        if score <= short_entry:
            return -1, "enter_short"
        return 0, "stay_flat"
    if previous == 1:
        if score <= short_entry:
            return -1, "reverse_long_to_short"
        if score < long_exit:
            return 0, "exit_long"
        return 1, "hold_long"
    if previous == -1:
        if score >= long_entry:
            return 1, "reverse_short_to_long"
        if score > short_exit:
            return 0, "exit_short"
        return -1, "hold_short"
    raise PortfolioFailure("portfolio.state", "Unknown prior signal state")


def _directional_signal_transition(
    previous: int,
    score: float | None,
    *,
    family: str,
    long_entry: float,
    long_exit: float,
    short_exit: float,
    short_entry: float,
) -> tuple[int, str]:
    if family == "dollar-neutral":
        return _signal_transition(
            previous,
            score,
            long_entry=long_entry,
            long_exit=long_exit,
            short_exit=short_exit,
            short_entry=short_entry,
        )
    if score is None or not math.isfinite(score):
        return (
            0,
            "unavailable_flat" if previous == 0 else "unavailable_reset",
        )
    if family == "long-cash":
        if previous == 1:
            return (1, "hold_long") if score >= long_exit else (0, "exit_long")
        return (1, "enter_long") if score >= long_entry else (0, "stay_flat")
    if family == "short-cash":
        if previous == -1:
            return (
                (-1, "hold_short")
                if score <= short_exit
                else (0, "exit_short")
            )
        return (
            (-1, "enter_short")
            if score <= short_entry
            else (0, "stay_flat")
        )
    raise PortfolioFailure("mandate.family", "Unknown Portfolio Mandate family")


def _position_role_signal_transition(
    previous: int,
    score: float | None,
    *,
    role: str,
    long_entry: float,
    long_exit: float,
    short_exit: float,
    short_entry: float,
) -> tuple[int, str]:
    family = {
        "long-only": "long-cash",
        "short-only": "short-cash",
        "two-sided": "dollar-neutral",
    }.get(role)
    if family is None:
        if role == "context-only":
            return 0, "context_only"
        raise PortfolioFailure(
            "mandate.asset-position-role",
            "Unknown asset position role",
        )
    return _directional_signal_transition(
        previous,
        score,
        family=family,
        long_entry=long_entry,
        long_exit=long_exit,
        short_exit=short_exit,
        short_entry=short_entry,
    )


def _weight_action(previous: float, current: float) -> str:
    tolerance = 1e-12
    previous_zero = abs(previous) <= tolerance
    current_zero = abs(current) <= tolerance
    if previous_zero and current_zero:
        return "stay_flat"
    if previous_zero:
        return "open_long" if current > 0 else "open_short"
    if current_zero:
        return "close_long" if previous > 0 else "close_short"
    if previous * current < 0:
        return (
            "reverse_long_to_short"
            if previous > 0
            else "reverse_short_to_long"
        )
    if abs(previous - current) <= tolerance:
        return "hold_long" if current > 0 else "hold_short"
    return "resize_long" if current > 0 else "resize_short"


def construct_signal_policy(
    factors: pd.DataFrame,
    closes: pd.DataFrame,
    *,
    volatility_window: int = VOLATILITY_WINDOW,
    gross_target: float = GROSS_TARGET,
    max_abs_weight: float = MAX_ABS_WEIGHT,
    long_entry: float = LONG_ENTRY_PERCENTILE,
    long_exit: float = LONG_EXIT_PERCENTILE,
    short_exit: float = SHORT_EXIT_PERCENTILE,
    short_entry: float = SHORT_ENTRY_PERCENTILE,
    mandate: dict[str, object] | None = None,
    prediction_population: dict[str, object] | None = None,
    temporal_translation_window: int = TEMPORAL_SCORE_WINDOW,
    temporal_translation_minimum: int = TEMPORAL_SCORE_MINIMUM,
    apply_risk_governor: bool = True,
    risk_covariance_cache: RiskCovarianceCache | None = None,
    include_ledger: bool = True,
) -> SignalConstruction:
    """Turn causal factor ranks into persistent intent and target weights."""

    if not factors.index.equals(closes.index) or list(factors.columns) != list(
        closes.columns
    ):
        raise PortfolioFailure(
            "portfolio.alignment",
            "Factor and close panels must have identical index and columns",
        )
    resolved = _resolve_mandate(factors.columns, mandate)
    gross_target = float(resolved["gross_limit"])
    max_abs_weight = float(resolved["max_abs_weight"])
    asset_caps = pd.Series(
        resolved["asset_max_abs_weights"],
        index=factors.columns,
        dtype=float,
    )
    asset_position_roles = {
        str(asset): str(role)
        for asset, role in resolved["asset_position_roles"].items()
    }
    long_gross_limit = float(resolved["long_gross_limit"])
    short_gross_limit = float(resolved["short_gross_limit"])
    family = str(resolved["family"])
    tradable_assets = set(resolved["tradable_assets"])
    if (
        volatility_window < 2
        or not 0 < gross_target <= 2
        or not 0 < max_abs_weight <= gross_target
        or (
            family == "dollar-neutral"
            and max_abs_weight > gross_target / 2
        )
        or not (
            0.0
            <= short_entry
            <= short_exit
            < long_exit
            <= long_entry
            <= 1.0
        )
        or not isinstance(include_ledger, bool)
    ):
        raise PortfolioFailure(
            "portfolio.parameters",
            "Invalid fixed signal-policy parameters",
        )
    returns = closes.pct_change(fill_method=None)
    volatility = (
        returns.rolling(
            volatility_window,
            min_periods=volatility_window,
        )
        .std(ddof=0)
        .clip(lower=1e-6)
    )
    side_budget = gross_target / 2.0
    targets = pd.DataFrame(0.0, index=factors.index, columns=factors.columns)
    states = pd.DataFrame(0, index=factors.index, columns=factors.columns)
    prior_states = pd.Series(0, index=factors.columns, dtype=int)
    prior_targets = pd.Series(0.0, index=factors.columns, dtype=float)
    ledger_rows: list[dict[str, object]] = []
    decision_policy = dict(
        resolved["implementation_policy"]["decision_policy"]
    )
    decision_schedule_kind = str(decision_policy["kind"])
    decision_every_bars = decision_policy.get("bars")
    decision_anchor = decision_policy.get("anchor")
    decision_sessions = decision_schedule_sessions(
        factors.index,
        decision_policy,
    )
    decision_mask = decision_schedule_mask(
        factors.index,
        decision_policy,
    )
    finite_volatility = pd.DataFrame(
        np.isfinite(volatility.to_numpy(dtype=float)),
        index=volatility.index,
        columns=volatility.columns,
    )
    (
        score_panel,
        translation_values,
        translation_observations,
        translation_semantics,
    ) = translate_factor_scores(
        factors,
        prediction_population,
        temporal_window=temporal_translation_window,
        temporal_minimum=temporal_translation_minimum,
    )
    insufficient_score_status = (
        "insufficient_temporal_history"
        if translation_semantics["evaluation_mode"]
        == SINGLE_ASSET_TEMPORAL_MODE
        else "insufficient_cross_section"
    )
    valid_panel = score_panel.notna() & volatility.notna() & finite_volatility
    sufficient_rows = valid_panel.any(axis=1)

    for timestamp in factors.index:
        decision_eligible = bool(decision_mask.loc[timestamp])
        row_factor = (
            factors.loc[timestamp].astype(float)
            if include_ledger
            else None
        )
        row_volatility = volatility.loc[timestamp].astype(float)
        scores = score_panel.loc[timestamp].where(valid_panel.loc[timestamp])
        translated_scores = score_panel.loc[timestamp]
        sufficient = bool(sufficient_rows.loc[timestamp])

        current_states = pd.Series(0, index=factors.columns, dtype=int)
        events: dict[str, str] = {}
        convictions = pd.Series(0.0, index=factors.columns, dtype=float)
        strengths = pd.Series(0.0, index=factors.columns, dtype=float)
        if decision_eligible:
            for asset in factors.columns:
                if str(asset) not in tradable_assets:
                    current_states.loc[asset] = 0
                    events[str(asset)] = "context_only"
                    continue
                raw_score = scores.loc[asset]
                score = (
                    float(raw_score)
                    if math.isfinite(raw_score)
                    else None
                )
                state, event = _position_role_signal_transition(
                    int(prior_states.loc[asset]),
                    score,
                    role=asset_position_roles[str(asset)],
                    long_entry=long_entry,
                    long_exit=long_exit,
                    short_exit=short_exit,
                    short_entry=short_entry,
                )
                current_states.loc[asset] = state
                events[str(asset)] = event
                if state != 0 and score is not None:
                    conviction = 2.0 * abs(score - 0.5)
                    convictions.loc[asset] = conviction
                    strengths.loc[asset] = (
                        conviction / float(row_volatility.loc[asset])
                    )
        else:
            current_states = prior_states.copy()
            events = {
                str(asset): (
                    "decision_schedule_hold"
                    if str(asset) in tradable_assets
                    else "context_only"
                )
                for asset in factors.columns
            }
            for asset in factors.columns:
                score = scores.loc[asset]
                state = int(current_states.loc[asset])
                volatility_value = row_volatility.loc[asset]
                if (
                    str(asset) in tradable_assets
                    and state != 0
                    and math.isfinite(score)
                    and math.isfinite(volatility_value)
                ):
                    conviction = 2.0 * abs(float(score) - 0.5)
                    convictions.loc[asset] = conviction
                    strengths.loc[asset] = (
                        conviction / float(volatility_value)
                    )

        if not decision_eligible:
            current_targets = prior_targets.copy()
            allocation_status = "decision_schedule_hold"
        elif family == "dollar-neutral":
            if (
                translation_semantics["evaluation_mode"]
                == TWO_ASSET_RELATIVE_VALUE_MODE
            ):
                pair = translation_semantics["relative_value_pair"]
                assert isinstance(pair, dict)
                left = str(pair["left_asset"])
                right = str(pair["right_asset"])
                left_state = int(current_states.loc[left])
                right_state = int(current_states.loc[right])
                paired = (
                    abs(left_state) == 1
                    and right_state == -left_state
                )
                pair_budget = min(
                    side_budget,
                    float(asset_caps.loc[left]),
                    float(asset_caps.loc[right]),
                )
                current_targets = pd.Series(
                    0.0,
                    index=factors.columns,
                    dtype=float,
                )
                if paired:
                    current_targets.loc[left] = left_state * pair_budget
                    current_targets.loc[right] = right_state * pair_budget
                allocation_status = (
                    "insufficient_temporal_history"
                    if not sufficient
                    else (
                        "no_permitted_signal"
                        if not paired
                        else (
                            "allocated"
                            if math.isclose(
                                pair_budget,
                                side_budget,
                                rel_tol=0.0,
                                abs_tol=1e-9,
                            )
                            else "allocated_with_cash"
                        )
                    )
                )
            else:
                long_weights = _allocate_capped_side(
                    strengths.where(current_states.eq(1), 0.0),
                    budget=side_budget,
                    cap=asset_caps,
                )
                short_weights = _allocate_capped_side(
                    strengths.where(current_states.eq(-1), 0.0),
                    budget=side_budget,
                    cap=asset_caps,
                )
                allocated = (
                    abs(float(long_weights.sum()) - side_budget) <= 1e-9
                    and abs(float(short_weights.sum()) - side_budget) <= 1e-9
                )
                current_targets = (
                    long_weights - short_weights
                    if allocated
                    else pd.Series(0.0, index=factors.columns, dtype=float)
                )
                allocation_status = (
                    "allocated"
                    if allocated
                    else (
                        "insufficient_cross_section"
                        if not sufficient
                        else "insufficient_side_breadth"
                    )
                )
        elif family == "asset-role":
            long_weights = _allocate_capped_up_to(
                strengths.where(current_states.eq(1), 0.0),
                limit=long_gross_limit,
                cap=asset_caps,
            )
            short_weights = _allocate_capped_up_to(
                strengths.where(current_states.eq(-1), 0.0),
                limit=short_gross_limit,
                cap=asset_caps,
            )
            current_targets = long_weights - short_weights
            used_long = float(long_weights.sum())
            used_short = float(short_weights.sum())
            allocation_status = (
                insufficient_score_status
                if not sufficient
                else (
                    "no_permitted_signal"
                    if used_long + used_short <= 1e-12
                    else (
                        "allocated"
                        if math.isclose(
                            used_long,
                            long_gross_limit,
                            rel_tol=0.0,
                            abs_tol=1e-9,
                        )
                        and math.isclose(
                            used_short,
                            short_gross_limit,
                            rel_tol=0.0,
                            abs_tol=1e-9,
                        )
                        else "allocated_with_cash"
                    )
                )
            )
        elif family == "long-cash":
            current_targets = _allocate_capped_up_to(
                strengths.where(current_states.eq(1), 0.0),
                limit=gross_target,
                cap=asset_caps,
            )
            allocation_status = (
                insufficient_score_status
                if not sufficient
                else (
                    "no_permitted_signal"
                    if float(current_targets.abs().sum()) <= 1e-12
                    else (
                        "allocated"
                        if abs(float(current_targets.sum()) - gross_target)
                        <= 1e-9
                        else "allocated_with_cash"
                    )
                )
            )
        elif family == "short-cash":
            current_targets = -_allocate_capped_up_to(
                strengths.where(current_states.eq(-1), 0.0),
                limit=gross_target,
                cap=asset_caps,
            )
            allocation_status = (
                insufficient_score_status
                if not sufficient
                else (
                    "no_permitted_signal"
                    if float(current_targets.abs().sum()) <= 1e-12
                    else (
                        "allocated"
                        if abs(float(current_targets.sum()) + gross_target)
                        <= 1e-9
                        else "allocated_with_cash"
                    )
                )
            )
        else:
            current_targets = pd.Series(
                0.0,
                index=factors.columns,
                dtype=float,
            )
            allocation_status = "invalid_mandate"
        pre_governor_targets = current_targets.copy()
        if decision_eligible:
            current_targets, risk_governor = _govern_portfolio_risk(
                pre_governor_targets,
                returns,
                timestamp,
                resolved,
                enabled=apply_risk_governor,
                risk_covariance_cache=risk_covariance_cache,
            )
        else:
            pre_governor_targets = prior_targets.copy()
            _, risk_governor = _govern_portfolio_risk(
                pre_governor_targets,
                returns,
                timestamp,
                resolved,
                enabled=False,
                risk_covariance_cache=risk_covariance_cache,
            )
            current_targets = prior_targets.copy()
        diagonal_risk = current_targets.abs() * row_volatility.fillna(0.0)
        diagonal_total = float(diagonal_risk.sum())
        diagonal_share = (
            diagonal_risk / diagonal_total
            if diagonal_total > 1e-12
            else pd.Series(0.0, index=factors.columns, dtype=float)
        )
        targets.loc[timestamp] = current_targets
        states.loc[timestamp] = current_states
        if include_ledger:
            assert row_factor is not None
            for asset in factors.columns:
                score = scores.loc[asset]
                translation_score = translated_scores.loc[asset]
                volatility_value = row_volatility.loc[asset]
                factor_value = row_factor.loc[asset]
                translation_value = translation_values.loc[timestamp, asset]
                translation_count = translation_observations.loc[
                    timestamp,
                    asset,
                ]
                target = float(current_targets.loc[asset])
                previous_target = float(prior_targets.loc[asset])
                ledger_rows.append(
                    {
                        "timestamp": timestamp,
                        "asset": str(asset),
                        "factor": (
                            float(factor_value)
                            if math.isfinite(factor_value)
                            else np.nan
                        ),
                        "percentile_score": (
                            float(score) if math.isfinite(score) else np.nan
                        ),
                        "translation_score": (
                            float(translation_score)
                            if math.isfinite(translation_score)
                            else np.nan
                        ),
                        "translation_value": (
                            float(translation_value)
                            if math.isfinite(translation_value)
                            else np.nan
                        ),
                        "translation_observations": int(translation_count),
                        "translation_method": translation_semantics["method"],
                        "evaluation_mode": translation_semantics[
                            "evaluation_mode"
                        ],
                        "prior_signal_state": int(
                            prior_states.loc[asset]
                        ),
                        "signal_state": int(current_states.loc[asset]),
                        "signal_event": events[str(asset)],
                        "decision_eligible": decision_eligible,
                        "decision_schedule_kind": decision_schedule_kind,
                        "decision_every_bars": decision_every_bars,
                        "decision_anchor": decision_anchor,
                        "decision_session": str(
                            decision_sessions.loc[timestamp]
                        ),
                        "tradable": str(asset) in tradable_assets,
                        "permitted_direction": family,
                        "position_role": asset_position_roles[str(asset)],
                        "long_gross_limit": long_gross_limit,
                        "short_gross_limit": short_gross_limit,
                        "mandate_id": str(resolved["id"]),
                        "conviction": float(convictions.loc[asset]),
                        "trailing_volatility": (
                            float(volatility_value)
                            if math.isfinite(volatility_value)
                            else np.nan
                        ),
                        "risk_strength": float(strengths.loc[asset]),
                        "allocation_status": (
                            allocation_status
                            if str(asset) in tradable_assets
                            else "context_only"
                        ),
                        "pre_governor_target_weight": float(
                            pre_governor_targets.loc[asset]
                        ),
                        "risk_governor_status": str(
                            risk_governor["status"]
                        ),
                        "risk_estimation_observations": int(
                            risk_governor["observations"]
                        ),
                        "risk_forecast_pre_annualized": float(
                            risk_governor["pre_annualized_volatility"]
                        ),
                        "risk_forecast_post_annualized": float(
                            risk_governor["post_annualized_volatility"]
                        ),
                        "risk_volatility_ceiling_annualized": float(
                            risk_governor[
                                "annualized_volatility_ceiling"
                            ]
                        ),
                        "risk_governor_scale": float(
                            risk_governor["scale"]
                        ),
                        "prior_target_weight": previous_target,
                        "proposed_target_weight": target,
                        "target_delta": target - previous_target,
                        "target_action": _weight_action(
                            previous_target,
                            target,
                        ),
                        "diagonal_risk_budget_share": float(
                            diagonal_share.loc[asset]
                        ),
                    }
                )
        prior_states = current_states
        prior_targets = current_targets

    return SignalConstruction(
        targets=targets,
        states=states,
        ledger=pd.DataFrame(ledger_rows),
        scores=score_panel,
        translation_values=translation_values,
        translation_observations=translation_observations,
        translation=translation_semantics,
    )


def drift_weights(
    previous: pd.Series,
    realized_returns: pd.Series,
) -> pd.Series:
    """Drift prior close targets through the just-realized asset return."""

    aligned_returns = realized_returns.reindex(previous.index).fillna(0.0).astype(float)
    gross_return = float((previous * aligned_returns).sum())
    denominator = 1.0 + gross_return
    if not math.isfinite(denominator) or denominator <= 1e-9:
        raise PortfolioFailure(
            "portfolio.bankrupt",
            "Portfolio drift denominator is non-positive",
        )
    drifted = previous * (1.0 + aligned_returns) / denominator
    if not np.isfinite(drifted.to_numpy()).all():
        raise PortfolioFailure("portfolio.non-finite", "Drift produced non-finite weights")
    return drifted


def simulate_targets(
    targets: pd.DataFrame,
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    *,
    cost_bps: float | None = None,
    no_trade_one_way: float | None = None,
    reference_nav: float | None = None,
    extra_delay: int = 0,
    mandate: dict[str, object] | None = None,
    risk_covariance_cache: RiskCovarianceCache | None = None,
) -> Simulation:
    """Execute close targets, then credit only the following close return."""

    if (
        not targets.index.equals(closes.index)
        or not targets.index.equals(volumes.index)
        or list(targets.columns) != list(closes.columns)
        or list(targets.columns) != list(volumes.columns)
    ):
        raise PortfolioFailure(
            "portfolio.alignment",
            "Targets, closes, and volumes must share one panel shape",
        )
    implementation = resolve_implementation_policy(mandate)
    cost_bps = (
        implementation["base_cost_bps"]
        if cost_bps is None
        else float(cost_bps)
    )
    no_trade_one_way = (
        implementation["no_trade_one_way"]
        if no_trade_one_way is None
        else float(no_trade_one_way)
    )
    reference_nav = (
        implementation["reference_nav"]
        if reference_nav is None
        else float(reference_nav)
    )
    decision_policy = dict(implementation["decision_policy"])
    decision_schedule_kind = str(decision_policy["kind"])
    decision_every_bars = decision_policy.get("bars")
    decision_anchor = decision_policy.get("anchor")
    decision_sessions = decision_schedule_sessions(
        targets.index,
        decision_policy,
    )
    if cost_bps < 0 or not 0 <= no_trade_one_way <= 1 or reference_nav <= 0:
        raise PortfolioFailure(
            "portfolio.parameters",
            "Invalid accounting parameters",
        )
    if not isinstance(extra_delay, int) or extra_delay < 0:
        raise PortfolioFailure("portfolio.delay", "extra_delay must be non-negative")
    resolved = _resolve_mandate(targets.columns, mandate)
    benchmark = resolved["benchmark"]
    benchmark_weights = pd.Series(
        benchmark["weights"],
        index=targets.columns,
        dtype=float,
    )
    proposed_targets = targets.shift(extra_delay).fillna(0.0)
    decision_mask = decision_schedule_mask(
        targets.index,
        decision_policy,
    ).shift(extra_delay, fill_value=False)
    close_returns = closes.pct_change(fill_method=None)
    forward_returns = closes.shift(-1) / closes - 1.0
    target_values = proposed_targets.to_numpy(dtype=float)
    close_return_values = close_returns.to_numpy(dtype=float)
    forward_return_values = forward_returns.to_numpy(dtype=float)
    close_values = closes.to_numpy(dtype=float)
    volume_values = volumes.to_numpy(dtype=float)
    executed_values = np.zeros(targets.shape, dtype=float)
    trade_values = np.zeros(targets.shape, dtype=float)
    participation_values = np.zeros(targets.shape, dtype=float)
    daily_rows: list[dict[str, object]] = []
    prior_values = np.zeros(len(targets.columns), dtype=float)

    for row_number, timestamp in enumerate(targets.index):
        decision_eligible = bool(decision_mask.loc[timestamp])
        if row_number == 0:
            pretrade_values = np.zeros_like(prior_values)
        else:
            realized = np.nan_to_num(
                close_return_values[row_number],
                nan=0.0,
            )
            gross_realized = float(prior_values @ realized)
            denominator = 1.0 + gross_realized
            if not math.isfinite(denominator) or denominator <= 1e-9:
                raise PortfolioFailure(
                    "portfolio.bankrupt",
                    "Portfolio drift denominator is non-positive",
                )
            pretrade_values = (
                prior_values * (1.0 + realized) / denominator
            )
        pretrade = pd.Series(
            pretrade_values,
            index=targets.columns,
            dtype=float,
        )
        proposed = pd.Series(
            np.nan_to_num(target_values[row_number], nan=0.0),
            index=targets.columns,
            dtype=float,
        )
        current, execution_risk = execute_risk_compliant_book(
            pretrade,
            proposed,
            close_returns,
            timestamp,
            mandate=mandate,
            no_trade_one_way=no_trade_one_way,
            ordinary_rebalance_allowed=decision_eligible,
            risk_covariance_cache=risk_covariance_cache,
            _resolved_mandate=resolved,
        )
        rebalance = bool(execution_risk["rebalanced"])
        current_values = current.to_numpy(dtype=float)
        row_trade_values = current_values - pretrade_values
        traded_notional = float(np.abs(row_trade_values).sum())
        one_way_turnover = 0.5 * traded_notional
        cost = traded_notional * cost_bps / 10_000.0
        next_returns = np.nan_to_num(
            forward_return_values[row_number],
            nan=0.0,
        )
        gross_return = float(current_values @ next_returns)
        net_return = gross_return - cost
        benchmark_return = float(
            benchmark_weights.to_numpy(dtype=float) @ next_returns
        )
        dollar_volume = (
            close_values[row_number] * volume_values[row_number]
        )
        row_participation = np.divide(
            np.abs(row_trade_values) * reference_nav,
            dollar_volume,
            out=np.zeros_like(row_trade_values),
            where=dollar_volume != 0.0,
        )
        if not all(
            math.isfinite(value)
            for value in (
                gross_return,
                net_return,
                benchmark_return,
                cost,
                one_way_turnover,
                traded_notional,
            )
        ):
            raise PortfolioFailure(
                "portfolio.non-finite",
                "Accounting produced non-finite values",
            )
        executed_values[row_number] = current_values
        trade_values[row_number] = row_trade_values
        participation_values[row_number] = row_participation
        daily_rows.append(
            {
                "gross_return": gross_return,
                "net_return": net_return,
                "benchmark_return": benchmark_return,
                "one_way_turnover": one_way_turnover,
                "traded_notional": traded_notional,
                "cost": cost,
                "gross_exposure": float(np.abs(current_values).sum()),
                "net_exposure": float(current_values.sum()),
                "cash_weight": 1.0 - float(np.abs(current_values).sum()),
                "max_abs_weight": float(np.abs(current_values).max()),
                "concentration_hhi": float((current_values**2).sum()),
                "rebalanced": rebalance,
                "decision_eligible": decision_eligible,
                "decision_schedule_kind": decision_schedule_kind,
                "decision_every_bars": decision_every_bars,
                "decision_anchor": decision_anchor,
                "decision_session": str(
                    decision_sessions.loc[timestamp]
                ),
                "execution_reason": str(
                    execution_risk["execution_reason"]
                ),
                "execution_risk_status": str(execution_risk["status"]),
                "execution_risk_forecast_available": bool(
                    execution_risk["forecast_available"]
                ),
                "execution_risk_observations": int(
                    execution_risk["observations"]
                ),
                "pretrade_risk_forecast_annualized": float(
                    execution_risk["pretrade_forecast_annualized"]
                ),
                "proposed_risk_forecast_pre_annualized": float(
                    execution_risk[
                        "proposed_forecast_pre_annualized"
                    ]
                ),
                "proposed_risk_forecast_post_annualized": float(
                    execution_risk[
                        "proposed_forecast_post_annualized"
                    ]
                ),
                "executed_risk_forecast_annualized": float(
                    execution_risk["executed_forecast_annualized"]
                ),
                "execution_risk_ceiling_annualized": float(
                    execution_risk[
                        "annualized_volatility_ceiling"
                    ]
                ),
                "proposed_runtime_risk_scale": float(
                    execution_risk["proposed_runtime_scale"]
                ),
                "execution_risk_repair_scale": float(
                    execution_risk["risk_repair_scale"]
                ),
                "proposed_one_way_turnover": float(
                    execution_risk["proposed_one_way"]
                ),
                "ordinary_rebalance": bool(
                    execution_risk["ordinary_rebalance"]
                ),
                "risk_rebalance_override": bool(
                    execution_risk["risk_rebalance_override"]
                ),
                "constraint_rebalance_override": bool(
                    execution_risk["constraint_rebalance_override"]
                ),
                "constraint_repair_one_way": float(
                    execution_risk["constraint_repair_one_way"]
                ),
                "executed_constraint_maximum_error": float(
                    execution_risk["executed_constraint_maximum_error"]
                ),
                "max_participation": float(row_participation.max()),
                "mean_participation": float(row_participation.mean()),
            }
        )
        prior_values = current_values
    daily = pd.DataFrame(daily_rows, index=targets.index)
    executed = pd.DataFrame(
        executed_values,
        index=targets.index,
        columns=targets.columns,
    )
    trades = pd.DataFrame(
        trade_values,
        index=targets.index,
        columns=targets.columns,
    )
    participation = pd.DataFrame(
        participation_values,
        index=targets.index,
        columns=targets.columns,
    )
    valid = forward_returns.notna().any(axis=1)
    return Simulation(
        daily=daily.loc[valid].copy(),
        weights=executed.loc[valid].copy(),
        trades=trades.loc[valid].copy(),
        participation=participation.loc[valid].copy(),
    )


def causal_market_regimes(closes: pd.DataFrame) -> pd.Series:
    market_return = closes.pct_change(fill_method=None).mean(axis=1)
    trailing_direction = (
        (1.0 + market_return)
        .rolling(20, min_periods=20)
        .apply(np.prod, raw=True)
        - 1.0
    )
    trailing_volatility = market_return.rolling(
        20,
        min_periods=20,
    ).std(ddof=0)
    lagged_threshold = trailing_volatility.shift(1).rolling(
        60,
        min_periods=20,
    ).median()
    labels = pd.Series("unavailable", index=closes.index, dtype="object")
    valid = (
        trailing_direction.notna()
        & trailing_volatility.notna()
        & lagged_threshold.notna()
    )
    for timestamp in closes.index[valid]:
        direction = "up" if trailing_direction.loc[timestamp] >= 0 else "down"
        volatility = (
            "stressed"
            if trailing_volatility.loc[timestamp]
            > lagged_threshold.loc[timestamp]
            else "calm"
        )
        labels.loc[timestamp] = f"{direction}-{volatility}"
    return labels


def build_decision_ledger(
    construction: SignalConstruction,
    simulation: Simulation,
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    *,
    cost_bps: float | None = None,
    reference_nav: float | None = None,
    liquidity_adv_window: int = LIQUIDITY_ADV_WINDOW,
    mandate: dict[str, object] | None = None,
) -> pd.DataFrame:
    """Join signal intent, target sizing, execution, and attribution evidence."""

    if (
        not construction.targets.index.equals(closes.index)
        or not closes.index.equals(volumes.index)
        or list(construction.targets.columns) != list(closes.columns)
        or list(closes.columns) != list(volumes.columns)
        or not simulation.weights.index.equals(simulation.daily.index)
        or list(simulation.weights.columns) != list(closes.columns)
    ):
        raise PortfolioFailure(
            "portfolio.alignment",
            "Construction, simulation, and closes are not aligned",
        )
    implementation = resolve_implementation_policy(mandate)
    cost_bps = (
        implementation["base_cost_bps"]
        if cost_bps is None
        else float(cost_bps)
    )
    reference_nav = (
        implementation["reference_nav"]
        if reference_nav is None
        else float(reference_nav)
    )
    if reference_nav <= 0 or cost_bps < 0 or liquidity_adv_window < 2:
        raise PortfolioFailure(
            "portfolio.parameters",
            "Invalid liquidity-capacity parameters",
        )
    policy = construction.ledger.set_index(["timestamp", "asset"])
    if not policy.index.is_unique:
        raise PortfolioFailure(
            "portfolio.ledger",
            "Signal construction ledger keys must be unique",
        )
    close_returns = closes.pct_change(fill_method=None)
    forward_returns = closes.shift(-1) / closes - 1.0
    dollar_volume = closes.astype(float) * volumes.astype(float)
    causal_adv = dollar_volume.rolling(
        liquidity_adv_window,
        min_periods=liquidity_adv_window,
    ).mean()
    regimes = causal_market_regimes(closes)
    prior = pd.Series(0.0, index=closes.columns, dtype=float)
    rows: list[dict[str, object]] = []
    for row_number, timestamp in enumerate(simulation.daily.index):
        pretrade = (
            pd.Series(0.0, index=closes.columns, dtype=float)
            if row_number == 0
            else drift_weights(prior, close_returns.loc[timestamp])
        )
        executed = simulation.weights.loc[timestamp].astype(float)
        trade = simulation.trades.loc[timestamp].astype(float)
        active_trade = trade.abs() > 1e-12
        adv_row = causal_adv.loc[timestamp].astype(float)
        if not bool(active_trade.any()):
            capacity_status = "no_trade"
            portfolio_capacity = {
                limit: 0.0
                for limit in LIQUIDITY_PARTICIPATION_LIMITS
            }
            binding_asset: str | None = None
        elif (
            adv_row.loc[active_trade].isna().any()
            or (adv_row.loc[active_trade] <= 0).any()
        ):
            capacity_status = "insufficient_adv_history"
            portfolio_capacity = {
                limit: 0.0
                for limit in LIQUIDITY_PARTICIPATION_LIMITS
            }
            binding_asset = None
        else:
            capacity_status = "available"
            conservative_asset_capacity = (
                LIQUIDITY_PARTICIPATION_LIMITS[0]
                * adv_row.loc[active_trade]
                / trade.loc[active_trade].abs()
            )
            binding_asset = str(conservative_asset_capacity.idxmin())
            portfolio_capacity = {
                limit: float(
                    (
                        limit
                        * adv_row.loc[active_trade]
                        / trade.loc[active_trade].abs()
                    ).min()
                )
                for limit in LIQUIDITY_PARTICIPATION_LIMITS
            }
        next_return = forward_returns.loc[timestamp].fillna(0.0).astype(float)
        history = close_returns.loc[:timestamp].tail(RISK_COVARIANCE_WINDOW)
        history = history.dropna(how="all")
        component_variance = pd.Series(
            0.0,
            index=closes.columns,
            dtype=float,
        )
        portfolio_variance = 0.0
        if len(history) >= RISK_COVARIANCE_MINIMUM:
            covariance = history.cov(
                min_periods=RISK_COVARIANCE_MINIMUM,
                ddof=0,
            ).reindex(index=closes.columns, columns=closes.columns).fillna(0.0)
            marginal = covariance.dot(executed)
            component_variance = executed * marginal
            portfolio_variance = float(component_variance.sum())
        variance_share = (
            component_variance / portfolio_variance
            if portfolio_variance > 1e-18
            else pd.Series(0.0, index=closes.columns, dtype=float)
        )
        portfolio_row = simulation.daily.loc[timestamp]
        for asset in closes.columns:
            policy_row = policy.loc[(timestamp, str(asset))]
            asset_trade = float(trade.loc[asset])
            asset_adv = (
                float(adv_row.loc[asset])
                if math.isfinite(float(adv_row.loc[asset]))
                else 0.0
            )
            reference_participation = (
                abs(asset_trade) * reference_nav / asset_adv
                if (
                    capacity_status == "available"
                    and abs(asset_trade) > 1e-12
                    and asset_adv > 0
                )
                else 0.0
            )
            asset_capacity = {
                limit: (
                    limit * asset_adv / abs(asset_trade)
                    if (
                        capacity_status == "available"
                        and abs(asset_trade) > 1e-12
                        and asset_adv > 0
                    )
                    else 0.0
                )
                for limit in LIQUIDITY_PARTICIPATION_LIMITS
            }
            gross_contribution = float(
                executed.loc[asset] * next_return.loc[asset]
            )
            cost_contribution = (
                abs(asset_trade) * cost_bps / 10_000.0
            )
            executed_weight = float(executed.loc[asset])
            rows.append(
                {
                    **policy_row.to_dict(),
                    "timestamp": timestamp,
                    "asset": str(asset),
                    "regime": str(regimes.loc[timestamp]),
                    "pretrade_weight": float(pretrade.loc[asset]),
                    "executed_weight": executed_weight,
                    "executed_state": (
                        1
                        if executed_weight > 1e-12
                        else -1
                        if executed_weight < -1e-12
                        else 0
                    ),
                    "trade_weight": asset_trade,
                    "execution_action": _weight_action(
                        float(pretrade.loc[asset]),
                        executed_weight,
                    ),
                    "execution_reason": str(
                        portfolio_row["execution_reason"]
                    ),
                    "execution_risk_status": str(
                        portfolio_row["execution_risk_status"]
                    ),
                    "execution_risk_forecast_available": bool(
                        portfolio_row[
                            "execution_risk_forecast_available"
                        ]
                    ),
                    "execution_risk_observations": int(
                        portfolio_row["execution_risk_observations"]
                    ),
                    "pretrade_risk_forecast_annualized": float(
                        portfolio_row[
                            "pretrade_risk_forecast_annualized"
                        ]
                    ),
                    "proposed_risk_forecast_pre_annualized": float(
                        portfolio_row[
                            "proposed_risk_forecast_pre_annualized"
                        ]
                    ),
                    "proposed_risk_forecast_post_annualized": float(
                        portfolio_row[
                            "proposed_risk_forecast_post_annualized"
                        ]
                    ),
                    "executed_risk_forecast_annualized": float(
                        portfolio_row[
                            "executed_risk_forecast_annualized"
                        ]
                    ),
                    "execution_risk_ceiling_annualized": float(
                        portfolio_row[
                            "execution_risk_ceiling_annualized"
                        ]
                    ),
                    "proposed_runtime_risk_scale": float(
                        portfolio_row["proposed_runtime_risk_scale"]
                    ),
                    "execution_risk_repair_scale": float(
                        portfolio_row["execution_risk_repair_scale"]
                    ),
                    "proposed_one_way_turnover": float(
                        portfolio_row["proposed_one_way_turnover"]
                    ),
                    "ordinary_rebalance": bool(
                        portfolio_row["ordinary_rebalance"]
                    ),
                    "risk_rebalance_override": bool(
                        portfolio_row["risk_rebalance_override"]
                    ),
                    "constraint_rebalance_override": bool(
                        portfolio_row["constraint_rebalance_override"]
                    ),
                    "constraint_repair_one_way": float(
                        portfolio_row["constraint_repair_one_way"]
                    ),
                    "executed_constraint_maximum_error": float(
                        portfolio_row[
                            "executed_constraint_maximum_error"
                        ]
                    ),
                    "liquidity_capacity_status": capacity_status,
                    "liquidity_adv_observations": (
                        liquidity_adv_window
                        if math.isfinite(float(adv_row.loc[asset]))
                        else 0
                    ),
                    "causal_adv_dollar_volume": asset_adv,
                    "reference_nav_adv_participation": (
                        reference_participation
                    ),
                    "asset_capacity_nav_1pct": asset_capacity[0.01],
                    "asset_capacity_nav_5pct": asset_capacity[0.05],
                    "portfolio_capacity_nav_1pct": portfolio_capacity[0.01],
                    "portfolio_capacity_nav_5pct": portfolio_capacity[0.05],
                    "capacity_binding_asset": (
                        binding_asset is not None
                        and str(asset) == binding_asset
                    ),
                    "asset_forward_return": float(next_return.loc[asset]),
                    "gross_return_contribution": gross_contribution,
                    "cost_contribution": cost_contribution,
                    "net_return_contribution": (
                        gross_contribution - cost_contribution
                    ),
                    "one_way_turnover_contribution": 0.5
                    * abs(asset_trade),
                    "component_variance": float(
                        component_variance.loc[asset]
                    ),
                    "variance_contribution_share": float(
                        variance_share.loc[asset]
                    ),
                    "portfolio_variance": portfolio_variance,
                    "portfolio_gross_return": float(
                        portfolio_row["gross_return"]
                    ),
                    "portfolio_cost": float(portfolio_row["cost"]),
                    "portfolio_net_return": float(
                        portfolio_row["net_return"]
                    ),
                    "portfolio_traded_notional": float(
                        portfolio_row["traded_notional"]
                    ),
                }
            )
        prior = executed
    result = pd.DataFrame(rows)
    required_numeric = result[
        [
            "conviction",
            "risk_strength",
            "pre_governor_target_weight",
            "risk_estimation_observations",
            "risk_forecast_pre_annualized",
            "risk_forecast_post_annualized",
            "risk_volatility_ceiling_annualized",
            "risk_governor_scale",
            "prior_target_weight",
            "proposed_target_weight",
            "target_delta",
            "diagonal_risk_budget_share",
            "pretrade_weight",
            "executed_weight",
            "trade_weight",
            "execution_risk_observations",
            "pretrade_risk_forecast_annualized",
            "proposed_risk_forecast_pre_annualized",
            "proposed_risk_forecast_post_annualized",
            "executed_risk_forecast_annualized",
            "execution_risk_ceiling_annualized",
            "proposed_runtime_risk_scale",
            "execution_risk_repair_scale",
            "proposed_one_way_turnover",
            "constraint_repair_one_way",
            "executed_constraint_maximum_error",
            "liquidity_adv_observations",
            "causal_adv_dollar_volume",
            "reference_nav_adv_participation",
            "asset_capacity_nav_1pct",
            "asset_capacity_nav_5pct",
            "portfolio_capacity_nav_1pct",
            "portfolio_capacity_nav_5pct",
            "asset_forward_return",
            "gross_return_contribution",
            "cost_contribution",
            "net_return_contribution",
            "one_way_turnover_contribution",
            "component_variance",
            "variance_contribution_share",
            "portfolio_variance",
            "portfolio_gross_return",
            "portfolio_cost",
            "portfolio_net_return",
            "portfolio_traded_notional",
        ]
    ].to_numpy(dtype=float)
    if not np.isfinite(required_numeric).all():
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Decision ledger contains non-finite numeric evidence",
        )
    return result


def _position_state(weight: float) -> int:
    return 1 if weight > 1e-12 else -1 if weight < -1e-12 else 0


def build_position_episodes(
    ledger: pd.DataFrame,
    index: pd.Index,
    *,
    split: str,
    role: str,
) -> pd.DataFrame:
    """Reconstruct exact split-bounded executed-position episodes."""

    required = {
        "timestamp",
        "asset",
        "signal_state",
        "pretrade_weight",
        "executed_weight",
        "executed_state",
        "trade_weight",
        "execution_action",
        "execution_reason",
        "risk_rebalance_override",
        "gross_return_contribution",
        "cost_contribution",
    }
    if (
        not isinstance(split, str)
        or not split
        or role not in {"training", "selection", "visible-audit"}
        or len(index) == 0
        or not required.issubset(ledger.columns)
    ):
        raise PortfolioFailure(
            "portfolio.position-episodes",
            "Position-episode inputs are incomplete",
        )
    timestamps = pd.DatetimeIndex(index)
    if not timestamps.is_monotonic_increasing or not timestamps.is_unique:
        raise PortfolioFailure(
            "portfolio.position-episodes",
            "Position-episode index must be unique and chronological",
        )
    selected = ledger[ledger["timestamp"].isin(timestamps)].copy()
    if selected.empty:
        raise PortfolioFailure(
            "portfolio.position-episodes",
            "Position-episode split has no decision rows",
        )
    selected = selected.sort_values(["asset", "timestamp"]).reset_index(
        drop=True
    )
    expected_dates = set(timestamps)
    if any(
        len(group) != len(timestamps)
        or set(pd.DatetimeIndex(group["timestamp"])) != expected_dates
        for _, group in selected.groupby("asset", sort=True)
    ):
        raise PortfolioFailure(
            "portfolio.position-episodes",
            "Every asset must cover the complete split",
        )

    output: list[dict[str, object]] = []
    for asset, asset_rows in selected.groupby("asset", sort=True):
        sequence = 0
        current: dict[str, object] | None = None

        def open_episode(
            state: int,
            timestamp: pd.Timestamp,
            *,
            left_censored: bool,
            action: str,
            entry_weight: float,
            entry_cost: float,
        ) -> dict[str, object]:
            nonlocal sequence
            sequence += 1
            return {
                "episode_id": f"{split}:{asset}:{sequence:04d}",
                "split": split,
                "role": role,
                "episode_number": sequence,
                "asset": str(asset),
                "side": "long" if state == 1 else "short",
                "entry_timestamp": timestamp,
                "last_earning_timestamp": pd.NaT,
                "exit_timestamp": pd.NaT,
                "entry_action": action,
                "exit_action": "split_boundary_carry",
                "left_censored": left_censored,
                "right_censored": False,
                "decision_bars": 0,
                "entry_weight": entry_weight,
                "last_executed_weight": 0.0,
                "_weight_sum": 0.0,
                "peak_abs_weight": 0.0,
                "gross_contribution": 0.0,
                "entry_cost": entry_cost,
                "holding_cost": 0.0,
                "exit_cost": 0.0,
                "_path": [],
                "intent_mismatch_bars": 0,
                "no_trade_bars": 0,
                "risk_override_bars": 0,
            }

        def close_episode(
            episode: dict[str, object],
            *,
            right_censored: bool,
            timestamp: pd.Timestamp | None,
            action: str,
        ) -> None:
            episode["right_censored"] = right_censored
            episode["exit_timestamp"] = (
                pd.NaT if right_censored else timestamp
            )
            episode["exit_action"] = action
            costs = (
                float(episode["entry_cost"])
                + float(episode["holding_cost"])
                + float(episode["exit_cost"])
            )
            gross = float(episode["gross_contribution"])
            path = np.cumsum(
                np.asarray(episode.pop("_path"), dtype=float)
            )
            net = gross - costs
            if path.size and not math.isclose(
                float(path[-1]),
                net,
                rel_tol=0.0,
                abs_tol=POSITION_EPISODE_TOLERANCE,
            ):
                raise PortfolioFailure(
                    "portfolio.position-episode-reconciliation",
                    "Episode contribution path does not reconcile",
                )
            bars = int(episode["decision_bars"])
            weight_sum = float(episode.pop("_weight_sum"))
            episode["average_abs_weight"] = (
                weight_sum / bars if bars else 0.0
            )
            episode["total_cost"] = costs
            episode["net_contribution"] = net
            episode["maximum_favorable_excursion"] = (
                max(0.0, float(path.max())) if path.size else 0.0
            )
            episode["maximum_adverse_excursion"] = (
                min(0.0, float(path.min())) if path.size else 0.0
            )
            episode["complete"] = not bool(
                episode["left_censored"]
                or episode["right_censored"]
            )
            output.append(episode)

        first = True
        for raw in asset_rows.to_dict("records"):
            timestamp = pd.Timestamp(raw["timestamp"])
            pretrade_weight = float(raw["pretrade_weight"])
            executed_weight = float(raw["executed_weight"])
            trade_weight = float(raw["trade_weight"])
            pretrade_state = _position_state(pretrade_weight)
            executed_state = int(raw["executed_state"])
            if (
                executed_state != _position_state(executed_weight)
                or not math.isclose(
                    trade_weight,
                    executed_weight - pretrade_weight,
                    rel_tol=0.0,
                    abs_tol=POSITION_EPISODE_TOLERANCE,
                )
            ):
                raise PortfolioFailure(
                    "portfolio.position-episode-state",
                    "Executed state or trade differs from the weight transition",
                )
            if first and pretrade_state != 0:
                current = open_episode(
                    pretrade_state,
                    timestamp,
                    left_censored=True,
                    action="split_boundary_carry",
                    entry_weight=pretrade_weight,
                    entry_cost=0.0,
                )
            first = False
            current_state = (
                1
                if current is not None and current["side"] == "long"
                else -1
                if current is not None
                else 0
            )
            if current_state != pretrade_state:
                raise PortfolioFailure(
                    "portfolio.position-episode-state",
                    "Pretrade weight does not match the open episode",
                )

            cost = float(raw["cost_contribution"])
            if cost < -POSITION_EPISODE_TOLERANCE:
                raise PortfolioFailure(
                    "portfolio.position-episode-cost",
                    "Episode source cost cannot be negative",
                )
            cost_for_current = 0.0
            if current_state == executed_state:
                if current is None:
                    if (
                        abs(trade_weight) > POSITION_EPISODE_TOLERANCE
                        or cost > POSITION_EPISODE_TOLERANCE
                    ):
                        raise PortfolioFailure(
                            "portfolio.position-episode-cost",
                            "Flat-to-flat row cannot contain trade cost",
                        )
                else:
                    current["holding_cost"] = (
                        float(current["holding_cost"]) + cost
                    )
                    cost_for_current = cost
            else:
                close_notional = (
                    abs(pretrade_weight) if current_state else 0.0
                )
                open_notional = (
                    abs(executed_weight) if executed_state else 0.0
                )
                transition_notional = close_notional + open_notional
                if (
                    not math.isclose(
                        abs(trade_weight),
                        transition_notional,
                        rel_tol=0.0,
                        abs_tol=POSITION_EPISODE_TOLERANCE,
                    )
                    or transition_notional <= POSITION_EPISODE_TOLERANCE
                ):
                    raise PortfolioFailure(
                        "portfolio.position-episode-trade",
                        "Episode transition notional does not reconcile",
                    )
                close_cost = cost * close_notional / transition_notional
                open_cost = cost - close_cost
                if current is not None:
                    current["exit_cost"] = (
                        float(current["exit_cost"]) + close_cost
                    )
                    if int(current["decision_bars"]) == 0:
                        current["last_executed_weight"] = pretrade_weight
                    current["_path"].append(-close_cost)
                    close_episode(
                        current,
                        right_censored=False,
                        timestamp=timestamp,
                        action=str(raw["execution_action"]),
                    )
                    current = None
                if executed_state:
                    current = open_episode(
                        executed_state,
                        timestamp,
                        left_censored=False,
                        action=str(raw["execution_action"]),
                        entry_weight=executed_weight,
                        entry_cost=open_cost,
                    )
                    cost_for_current = open_cost

            gross = float(raw["gross_return_contribution"])
            if current is None:
                if abs(gross) > POSITION_EPISODE_TOLERANCE:
                    raise PortfolioFailure(
                        "portfolio.position-episode-contribution",
                        "Flat executed state cannot earn gross contribution",
                    )
                continue
            current["gross_contribution"] = (
                float(current["gross_contribution"]) + gross
            )
            current["_path"].append(gross - cost_for_current)
            current["decision_bars"] = int(current["decision_bars"]) + 1
            current["last_earning_timestamp"] = timestamp
            current["last_executed_weight"] = executed_weight
            current["_weight_sum"] = (
                float(current["_weight_sum"]) + abs(executed_weight)
            )
            current["peak_abs_weight"] = max(
                float(current["peak_abs_weight"]),
                abs(executed_weight),
            )
            if int(raw["signal_state"]) != executed_state:
                current["intent_mismatch_bars"] = (
                    int(current["intent_mismatch_bars"]) + 1
                )
            if str(raw["execution_reason"]) == "portfolio_no_trade_band":
                current["no_trade_bars"] = (
                    int(current["no_trade_bars"]) + 1
                )
            if bool(raw["risk_rebalance_override"]):
                current["risk_override_bars"] = (
                    int(current["risk_override_bars"]) + 1
                )

        if current is not None:
            close_episode(
                current,
                right_censored=True,
                timestamp=None,
                action="split_boundary_carry",
            )

    if not output:
        return pd.DataFrame(columns=POSITION_EPISODE_COLUMNS)
    result = pd.DataFrame(output)
    result = result.loc[:, POSITION_EPISODE_COLUMNS]
    numeric = result[
        [
            "episode_number",
            "decision_bars",
            "entry_weight",
            "last_executed_weight",
            "peak_abs_weight",
            "average_abs_weight",
            "gross_contribution",
            "entry_cost",
            "holding_cost",
            "exit_cost",
            "total_cost",
            "net_contribution",
            "maximum_favorable_excursion",
            "maximum_adverse_excursion",
            "intent_mismatch_bars",
            "no_trade_bars",
            "risk_override_bars",
        ]
    ].to_numpy(dtype=float)
    if not np.isfinite(numeric).all():
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Position episodes contain non-finite evidence",
        )
    return result


def position_episode_metrics(
    episodes: pd.DataFrame,
    ledger: pd.DataFrame,
    index: pd.Index,
) -> dict[str, object]:
    """Aggregate split-bounded episode diagnostics and exact reconciliation."""

    selected = ledger[ledger["timestamp"].isin(index)].copy()
    if selected.empty:
        raise PortfolioFailure(
            "portfolio.population",
            "Position-lifecycle split has no decision rows",
        )
    active = episodes[episodes["decision_bars"].astype(int) > 0].copy()
    complete = active[active["complete"].astype(bool)].copy()
    winners = complete[
        complete["net_contribution"] > POSITION_EPISODE_TOLERANCE
    ]
    losers = complete[
        complete["net_contribution"] < -POSITION_EPISODE_TOLERANCE
    ]
    average_win = (
        float(winners["net_contribution"].mean())
        if len(winners)
        else 0.0
    )
    average_loss = (
        float(losers["net_contribution"].mean())
        if len(losers)
        else 0.0
    )
    gross_profit = float(winners["net_contribution"].sum())
    gross_loss = abs(float(losers["net_contribution"].sum()))

    def group_metrics(group: pd.DataFrame) -> dict[str, object]:
        active_group = group[group["decision_bars"].astype(int) > 0]
        complete_group = active_group[
            active_group["complete"].astype(bool)
        ]
        return {
            "segments": int(len(group)),
            "active_segments": int(len(active_group)),
            "complete_episodes": int(len(complete_group)),
            "decision_bars": int(active_group["decision_bars"].sum()),
            "total_gross_contribution": float(
                group["gross_contribution"].sum()
            ),
            "total_cost": float(group["total_cost"].sum()),
            "total_net_contribution": float(
                group["net_contribution"].sum()
            ),
            "complete_episode_win_rate": (
                float(
                    (
                        complete_group["net_contribution"]
                        > POSITION_EPISODE_TOLERANCE
                    ).mean()
                )
                if len(complete_group)
                else 0.0
            ),
        }

    episode_gross = float(episodes["gross_contribution"].sum())
    episode_cost = float(episodes["total_cost"].sum())
    episode_net = float(episodes["net_contribution"].sum())
    ledger_gross = float(selected["gross_return_contribution"].sum())
    ledger_cost = float(selected["cost_contribution"].sum())
    ledger_net = float(selected["net_return_contribution"].sum())
    reconciliation = {
        "passed": (
            abs(episode_gross - ledger_gross)
            <= POSITION_EPISODE_TOLERANCE
            and abs(episode_cost - ledger_cost)
            <= POSITION_EPISODE_TOLERANCE
            and abs(episode_net - ledger_net)
            <= POSITION_EPISODE_TOLERANCE
            and abs(episode_net - (episode_gross - episode_cost))
            <= POSITION_EPISODE_TOLERANCE
        ),
        "gross_contribution_error": abs(episode_gross - ledger_gross),
        "cost_error": abs(episode_cost - ledger_cost),
        "net_contribution_error": abs(episode_net - ledger_net),
        "episode_identity_error": abs(
            episode_net - (episode_gross - episode_cost)
        ),
    }
    if not reconciliation["passed"]:
        raise PortfolioFailure(
            "portfolio.position-episode-reconciliation",
            "Position episodes do not reconcile the decision ledger",
        )

    total_bars = int(active["decision_bars"].sum())
    result: dict[str, object] = {
        "status": "available" if len(active) else "no_positions",
        "segments": int(len(episodes)),
        "active_segments": int(len(active)),
        "complete_episodes": int(len(complete)),
        "left_censored_segments": int(
            episodes["left_censored"].astype(bool).sum()
        ),
        "right_censored_segments": int(
            episodes["right_censored"].astype(bool).sum()
        ),
        "long_segments": int((episodes["side"] == "long").sum()),
        "short_segments": int((episodes["side"] == "short").sum()),
        "decision_bars": total_bars,
        "segment_positive_rate": (
            float(
                (
                    active["net_contribution"]
                    > POSITION_EPISODE_TOLERANCE
                ).mean()
            )
            if len(active)
            else 0.0
        ),
        "complete_episode_win_rate": (
            float(
                (
                    complete["net_contribution"]
                    > POSITION_EPISODE_TOLERANCE
                ).mean()
            )
            if len(complete)
            else 0.0
        ),
        "average_complete_holding_bars": (
            float(complete["decision_bars"].mean())
            if len(complete)
            else 0.0
        ),
        "median_complete_holding_bars": (
            float(complete["decision_bars"].median())
            if len(complete)
            else 0.0
        ),
        "average_complete_win_contribution": average_win,
        "average_complete_loss_contribution": average_loss,
        "complete_payoff_ratio": (
            average_win / abs(average_loss)
            if average_win > 0 and average_loss < 0
            else 0.0
        ),
        "complete_profit_factor": (
            gross_profit / gross_loss
            if gross_profit > 0 and gross_loss > 0
            else 0.0
        ),
        "average_segment_mfe": (
            float(active["maximum_favorable_excursion"].mean())
            if len(active)
            else 0.0
        ),
        "average_segment_mae": (
            float(active["maximum_adverse_excursion"].mean())
            if len(active)
            else 0.0
        ),
        "intent_mismatch_bars": int(
            active["intent_mismatch_bars"].sum()
        ),
        "intent_mismatch_rate": (
            float(active["intent_mismatch_bars"].sum() / total_bars)
            if total_bars
            else 0.0
        ),
        "no_trade_bars": int(active["no_trade_bars"].sum()),
        "no_trade_bar_rate": (
            float(active["no_trade_bars"].sum() / total_bars)
            if total_bars
            else 0.0
        ),
        "risk_override_bars": int(
            active["risk_override_bars"].sum()
        ),
        "total_gross_contribution": episode_gross,
        "total_cost": episode_cost,
        "total_net_contribution": episode_net,
        "entry_action_counts": {
            str(key): int(value)
            for key, value in episodes["entry_action"].value_counts().items()
        },
        "exit_action_counts": {
            str(key): int(value)
            for key, value in episodes["exit_action"].value_counts().items()
        },
        "by_asset": {
            str(name): group_metrics(group)
            for name, group in episodes.groupby("asset", sort=True)
        },
        "by_side": {
            str(name): group_metrics(group)
            for name, group in episodes.groupby("side", sort=True)
        },
        "reconciliation": reconciliation,
    }
    numeric: list[float] = [
        float(value)
        for value in result.values()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    ]
    numeric.extend(float(value) for value in reconciliation.values())
    if not all(math.isfinite(value) for value in numeric):
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Position-lifecycle metrics contain non-finite values",
        )
    return result


def execution_risk_metrics(
    simulation: Simulation,
    index: pd.Index,
) -> dict[str, object]:
    """Summarize final-book compliance with the causal volatility ceiling."""

    daily = simulation.daily.loc[index].copy()
    required = {
        "execution_reason",
        "execution_risk_status",
        "execution_risk_forecast_available",
        "pretrade_risk_forecast_annualized",
        "executed_risk_forecast_annualized",
        "execution_risk_ceiling_annualized",
        "proposed_one_way_turnover",
        "risk_rebalance_override",
        "gross_exposure",
    }
    if daily.empty or not required.issubset(daily.columns):
        raise PortfolioFailure(
            "portfolio.execution-risk",
            "Execution-risk split evidence is incomplete",
        )
    active = daily[
        (daily["gross_exposure"].abs() > 1e-12)
        | (daily["proposed_one_way_turnover"].abs() > 1e-12)
        | daily["risk_rebalance_override"].astype(bool)
    ]
    available = active[
        active["execution_risk_forecast_available"].astype(bool)
    ]
    unavailable = active[
        ~active["execution_risk_forecast_available"].astype(bool)
    ]
    pretrade_breach = available[
        available["pretrade_risk_forecast_annualized"]
        > available["execution_risk_ceiling_annualized"]
        + RISK_COMPLIANCE_TOLERANCE
    ]
    executed_breach = available[
        available["executed_risk_forecast_annualized"]
        > available["execution_risk_ceiling_annualized"]
        + RISK_COMPLIANCE_TOLERANCE
    ]
    overrides = active[active["risk_rebalance_override"].astype(bool)]
    ceiling_error = (
        available["executed_risk_forecast_annualized"]
        - available["execution_risk_ceiling_annualized"]
    ).clip(lower=0.0)
    result: dict[str, object] = {
        "status": (
            "available"
            if not available.empty
            else "no_active_dates"
            if active.empty
            else "forecast_unavailable"
        ),
        "dates": int(len(daily)),
        "active_dates": int(len(active)),
        "forecast_available_dates": int(len(available)),
        "forecast_unavailable_dates": int(len(unavailable)),
        "forecast_coverage": (
            float(len(available) / len(active))
            if len(active)
            else 0.0
        ),
        "pretrade_breach_dates": int(len(pretrade_breach)),
        "pretrade_breach_rate": (
            float(len(pretrade_breach) / len(available))
            if len(available)
            else 0.0
        ),
        "risk_rebalance_override_dates": int(len(overrides)),
        "risk_rebalance_override_rate": (
            float(len(overrides) / len(active))
            if len(active)
            else 0.0
        ),
        "executed_breach_dates": int(len(executed_breach)),
        "executed_breach_rate": (
            float(len(executed_breach) / len(available))
            if len(available)
            else 0.0
        ),
        "mean_executed_forecast_annualized": (
            float(available["executed_risk_forecast_annualized"].mean())
            if len(available)
            else 0.0
        ),
        "maximum_executed_forecast_annualized": (
            float(available["executed_risk_forecast_annualized"].max())
            if len(available)
            else 0.0
        ),
        "maximum_ceiling_error": (
            float(ceiling_error.max()) if len(ceiling_error) else 0.0
        ),
        "status_counts": {
            str(key): int(value)
            for key, value in daily[
                "execution_risk_status"
            ].value_counts().items()
        },
        "execution_reason_counts": {
            str(key): int(value)
            for key, value in daily[
                "execution_reason"
            ].value_counts().items()
        },
    }
    numeric = [
        float(value)
        for value in result.values()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    ]
    if not all(math.isfinite(value) and value >= 0 for value in numeric):
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Execution-risk metrics contain invalid values",
        )
    if int(result["executed_breach_dates"]):
        raise PortfolioFailure(
            "portfolio.risk-breach",
            "Final executed-book path contains a volatility-ceiling breach",
        )
    return result


def liquidity_capacity_metrics(
    ledger: pd.DataFrame,
    index: pd.Index,
    *,
    reference_nav: float = REFERENCE_NAV,
) -> dict[str, object]:
    """Aggregate the exact per-date OHLCV participation-capacity envelope."""

    selected = ledger[ledger["timestamp"].isin(index)].copy()
    if selected.empty:
        raise PortfolioFailure(
            "portfolio.population",
            "Liquidity-capacity split has no decision rows",
        )
    dates = (
        selected.groupby("timestamp", sort=True)
        .agg(
            status=("liquidity_capacity_status", "first"),
            capacity_1pct=("portfolio_capacity_nav_1pct", "first"),
            capacity_5pct=("portfolio_capacity_nav_5pct", "first"),
        )
    )
    trade_dates = dates[dates["status"].ne("no_trade")]
    available = trade_dates[trade_dates["status"].eq("available")]
    unavailable = trade_dates[
        trade_dates["status"].eq("insufficient_adv_history")
    ]
    if len(trade_dates):
        coverage = float(len(available) / len(trade_dates))
    else:
        coverage = 0.0

    def summarize(column: str) -> dict[str, float | int | str]:
        values = available[column].astype(float)
        if values.empty:
            return {
                "status": "unavailable",
                "observations": 0,
                "minimum_nav": 0.0,
                "tenth_percentile_nav": 0.0,
                "median_nav": 0.0,
                "reference_nav_breach_rate": 0.0,
            }
        return {
            "status": "available",
            "observations": int(len(values)),
            "minimum_nav": float(values.min()),
            "tenth_percentile_nav": float(values.quantile(0.10)),
            "median_nav": float(values.median()),
            "reference_nav_breach_rate": float(
                (values + 1e-12 < reference_nav).mean()
            ),
        }

    binding = selected[
        selected["capacity_binding_asset"].astype(bool)
        & selected["timestamp"].isin(available.index)
    ]
    result: dict[str, object] = {
        "status": (
            "available"
            if not available.empty
            else "no_trades"
            if trade_dates.empty
            else "insufficient_adv_history"
        ),
        "trade_dates": int(len(trade_dates)),
        "available_trade_dates": int(len(available)),
        "unavailable_trade_dates": int(len(unavailable)),
        "trade_date_coverage": coverage,
        "binding_asset_counts_1pct": {
            str(asset): int(count)
            for asset, count in binding["asset"].value_counts().items()
        },
        "capacity_1pct": summarize("capacity_1pct"),
        "capacity_5pct": summarize("capacity_5pct"),
    }
    numeric: list[float] = [
        float(value)
        for value in result.values()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    ]
    for key in ("capacity_1pct", "capacity_5pct"):
        numeric.extend(
            float(value)
            for value in result[key].values()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        )
    if not all(math.isfinite(value) and value >= 0 for value in numeric):
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Liquidity-capacity metrics contain invalid values",
        )
    return result


def signal_policy_metrics(
    construction: SignalConstruction,
    index: pd.Index,
) -> dict[str, object]:
    selected = construction.ledger[
        construction.ledger["timestamp"].isin(index)
    ].copy()
    if selected.empty:
        raise PortfolioFailure(
            "portfolio.population",
            "Signal policy split has no decision rows",
        )
    timestamps = int(selected["timestamp"].nunique())
    annual_periods = annualization_periods(index)
    events = {
        str(key): int(value)
        for key, value in selected["signal_event"].value_counts().items()
    }
    actions = {
        str(key): int(value)
        for key, value in selected["target_action"].value_counts().items()
    }
    allocation = {
        str(key): int(value)
        for key, value in selected["allocation_status"].value_counts().items()
    }
    risk_by_timestamp = (
        selected.groupby("timestamp", sort=True)
        .agg(
            status=("risk_governor_status", "first"),
            scale=("risk_governor_scale", "first"),
            observations=("risk_estimation_observations", "first"),
            pre=("risk_forecast_pre_annualized", "first"),
            post=("risk_forecast_post_annualized", "first"),
            ceiling=("risk_volatility_ceiling_annualized", "first"),
        )
    )
    cadence_by_timestamp = (
        selected.groupby("timestamp", sort=True)
        .agg(
            eligible=("decision_eligible", "first"),
            kind=("decision_schedule_kind", "first"),
            every_bars=("decision_every_bars", "first"),
            anchor=("decision_anchor", "first"),
        )
    )
    active_risk = risk_by_timestamp[
        ~risk_by_timestamp["status"].isin({"flat", "legacy_none"})
    ]
    state_counts = (
        selected.groupby("timestamp")["signal_state"]
        .value_counts()
        .unstack(fill_value=0)
    )
    target_turnover = (
        selected.assign(abs_delta=selected["target_delta"].abs())
        .groupby("timestamp")["abs_delta"]
        .sum()
        * 0.5
    )
    transitions = int(
        selected["prior_signal_state"].ne(selected["signal_state"]).sum()
    )
    result: dict[str, object] = {
        "decision_rows": int(len(selected)),
        "timestamps": timestamps,
        "decision_eligible_timestamps": int(
            cadence_by_timestamp["eligible"].sum()
        ),
        "decision_eligible_rate": float(
            cadence_by_timestamp["eligible"].mean()
        ),
        "decision_schedule": (
            {
                "kind": "calendar-month-end",
            }
            if str(cadence_by_timestamp["kind"].iloc[0])
            == "calendar-month-end"
            else {
                "kind": "every-bars",
                "bars": int(cadence_by_timestamp["every_bars"].iloc[0]),
                "anchor": str(cadence_by_timestamp["anchor"].iloc[0]),
            }
        ),
        "scheduled_hold_timestamps": int(
            (~cadence_by_timestamp["eligible"]).sum()
        ),
        "signal_transitions": transitions,
        "state_change_rate": float(transitions / len(selected)),
        "entries": int(
            selected["signal_event"].isin(
                {"enter_long", "enter_short"}
            ).sum()
        ),
        "exits": int(
            selected["signal_event"].isin({"exit_long", "exit_short"}).sum()
        ),
        "reversals": int(
            selected["signal_event"].isin(
                {"reverse_long_to_short", "reverse_short_to_long"}
            ).sum()
        ),
        "signal_event_counts": events,
        "target_action_counts": actions,
        "allocation_status_counts": allocation,
        "risk_governor_status_counts": {
            str(key): int(value)
            for key, value in risk_by_timestamp["status"].value_counts().items()
        },
        "risk_limited_dates": int(
            risk_by_timestamp["status"].eq("volatility_limited").sum()
        ),
        "risk_limited_rate": float(
            risk_by_timestamp["status"].eq("volatility_limited").mean()
        ),
        "risk_unavailable_dates": int(
            risk_by_timestamp["status"]
            .isin({"insufficient_history", "invalid_covariance"})
            .sum()
        ),
        "average_active_risk_scale": (
            float(active_risk["scale"].mean())
            if not active_risk.empty
            else 1.0
        ),
        "maximum_pre_governor_annualized_volatility": float(
            risk_by_timestamp["pre"].max()
        ),
        "maximum_post_governor_annualized_volatility": float(
            risk_by_timestamp["post"].max()
        ),
        "average_long_intents": (
            float(state_counts[1].mean()) if 1 in state_counts else 0.0
        ),
        "average_short_intents": (
            float(state_counts[-1].mean()) if -1 in state_counts else 0.0
        ),
        "average_flat_intents": (
            float(state_counts[0].mean()) if 0 in state_counts else 0.0
        ),
        "mean_target_one_way_turnover": float(target_turnover.mean()),
        "annualized_target_one_way_turnover": float(
            target_turnover.mean() * annual_periods
        ),
        "average_gross_proposed_target": float(
            selected.groupby("timestamp")["proposed_target_weight"]
            .apply(lambda values: values.abs().sum())
            .mean()
        ),
    }
    numeric = [
        float(value)
        for value in result.values()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    ]
    if not all(math.isfinite(value) for value in numeric):
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Signal policy metrics contain non-finite values",
        )
    return result


def attribution_metrics(
    ledger: pd.DataFrame,
    simulation: Simulation,
    index: pd.Index,
) -> dict[str, object]:
    selected = ledger[ledger["timestamp"].isin(index)].copy()
    if selected.empty:
        raise PortfolioFailure(
            "portfolio.population",
            "Attribution split has no decision rows",
        )
    timestamps = int(selected["timestamp"].nunique())
    annual_periods = annualization_periods(index)

    def aggregate(group: pd.DataFrame) -> dict[str, float | int]:
        return {
            "observations": int(len(group)),
            "total_gross_contribution": float(
                group["gross_return_contribution"].sum()
            ),
            "annualized_gross_contribution": float(
                group["gross_return_contribution"].sum()
                / timestamps
                * annual_periods
            ),
            "total_cost_contribution": float(
                group["cost_contribution"].sum()
            ),
            "total_net_contribution": float(
                group["net_return_contribution"].sum()
            ),
            "annualized_net_contribution": float(
                group["net_return_contribution"].sum()
                / timestamps
                * annual_periods
            ),
            "total_one_way_turnover_contribution": float(
                group["one_way_turnover_contribution"].sum()
            ),
            "average_absolute_executed_weight": float(
                group["executed_weight"].abs().mean()
            ),
            "mean_variance_contribution_share": float(
                group["variance_contribution_share"].mean()
            ),
        }

    by_asset = {
        str(name): aggregate(group)
        for name, group in selected.groupby("asset", sort=True)
    }
    state_names = {-1: "short", 0: "flat", 1: "long"}
    by_signal_state = {
        state_names[int(name)]: aggregate(group)
        for name, group in selected.groupby("signal_state", sort=True)
    }
    by_regime = {
        str(name): aggregate(group)
        for name, group in selected.groupby("regime", sort=True)
    }
    asset_net = pd.Series(
        {
            asset: values["total_net_contribution"]
            for asset, values in by_asset.items()
        },
        dtype=float,
    )
    absolute_total = float(asset_net.abs().sum())
    contribution_shares = (
        asset_net.abs() / absolute_total
        if absolute_total > 1e-12
        else pd.Series(0.0, index=asset_net.index, dtype=float)
    )
    asset_risk = pd.Series(
        {
            asset: values["mean_variance_contribution_share"]
            for asset, values in by_asset.items()
        },
        dtype=float,
    )
    absolute_risk_total = float(asset_risk.abs().sum())
    risk_shares = (
        asset_risk.abs() / absolute_risk_total
        if absolute_risk_total > 1e-12
        else pd.Series(0.0, index=asset_risk.index, dtype=float)
    )

    gross_error = 0.0
    cost_error = 0.0
    net_error = 0.0
    traded_error = 0.0
    risk_share_error = 0.0
    risk_dates = 0
    for timestamp, group in selected.groupby("timestamp", sort=True):
        portfolio = simulation.daily.loc[timestamp]
        gross_error = max(
            gross_error,
            abs(
                float(group["gross_return_contribution"].sum())
                - float(portfolio["gross_return"])
            ),
        )
        cost_error = max(
            cost_error,
            abs(
                float(group["cost_contribution"].sum())
                - float(portfolio["cost"])
            ),
        )
        net_error = max(
            net_error,
            abs(
                float(group["net_return_contribution"].sum())
                - float(portfolio["net_return"])
            ),
        )
        traded_error = max(
            traded_error,
            abs(
                float(group["trade_weight"].abs().sum())
                - float(portfolio["traded_notional"])
            ),
        )
        if float(group["portfolio_variance"].iloc[0]) > 1e-18:
            risk_dates += 1
            risk_share_error = max(
                risk_share_error,
                abs(float(group["variance_contribution_share"].sum()) - 1.0),
            )
    tolerance = 1e-10
    reconciliation = {
        "passed": (
            gross_error <= tolerance
            and cost_error <= tolerance
            and net_error <= tolerance
            and traded_error <= tolerance
            and risk_share_error <= tolerance
        ),
        "maximum_gross_return_error": gross_error,
        "maximum_cost_error": cost_error,
        "maximum_net_return_error": net_error,
        "maximum_traded_notional_error": traded_error,
        "maximum_variance_share_error": risk_share_error,
        "variance_attributed_dates": risk_dates,
    }
    return {
        "reconciliation": reconciliation,
        "concentration": {
            "maximum_absolute_net_contribution_share": (
                float(contribution_shares.max())
                if not contribution_shares.empty
                else 0.0
            ),
            "absolute_net_contribution_hhi": float(
                contribution_shares.pow(2).sum()
            ),
            "maximum_absolute_variance_contribution_share": (
                float(risk_shares.max()) if not risk_shares.empty else 0.0
            ),
            "absolute_variance_contribution_hhi": float(
                risk_shares.pow(2).sum()
            ),
        },
        "by_asset": by_asset,
        "by_signal_state": by_signal_state,
        "by_regime": by_regime,
    }


def performance_metrics(
    returns: pd.Series,
    benchmark: pd.Series,
    *,
    annual_periods: int | None = None,
) -> dict[str, float | int]:
    pair = pd.DataFrame(
        {"returns": returns, "benchmark": benchmark}
    ).dropna()
    if len(pair) < 20:
        raise PortfolioFailure(
            "portfolio.population",
            "Portfolio split has fewer than 20 valid observations",
        )
    values = pair["returns"].astype(float)
    benchmark_values = pair["benchmark"].astype(float)
    annual_periods = (
        annualization_periods(values.index)
        if annual_periods is None
        else annual_periods
    )
    mean = float(values.mean())
    std = float(values.std(ddof=0))
    standardized = (
        (values - mean) / std
        if std > 1e-12
        else pd.Series(0.0, index=values.index, dtype=float)
    )
    return_skewness = (
        float(standardized.pow(3).mean())
        if std > 1e-12
        else 0.0
    )
    return_kurtosis = (
        float(standardized.pow(4).mean())
        if std > 1e-12
        else 3.0
    )
    annual_volatility = std * math.sqrt(annual_periods)
    total_growth = float((1.0 + values).prod())
    annual_return = (
        total_growth ** (annual_periods / len(values)) - 1.0
        if total_growth > 0
        else -1.0
    )
    sharpe = mean / std * math.sqrt(annual_periods) if std > 1e-12 else 0.0
    downside = np.minimum(values.to_numpy(dtype=float), 0.0)
    downside_deviation = float(np.sqrt(np.mean(np.square(downside))))
    sortino = (
        mean / downside_deviation * math.sqrt(annual_periods)
        if downside_deviation > 1e-12
        else 0.0
    )
    equity = (1.0 + values).cumprod()
    drawdown = equity / equity.cummax() - 1.0
    maximum_drawdown = float(drawdown.min())
    calmar = (
        annual_return / abs(maximum_drawdown)
        if maximum_drawdown < -1e-12
        else 0.0
    )
    tail_count = max(1, math.ceil(len(values) * 0.05))
    expected_shortfall = -float(values.nsmallest(tail_count).mean())
    benchmark_variance = float(benchmark_values.var(ddof=0))
    beta = (
        float(values.cov(benchmark_values, ddof=0)) / benchmark_variance
        if benchmark_variance > 1e-12
        else 0.0
    )
    active = values - benchmark_values
    tracking_error_daily = float(active.std(ddof=0))
    tracking_error = tracking_error_daily * math.sqrt(annual_periods)
    active_annual_return = float(active.mean()) * annual_periods
    information_ratio = (
        float(active.mean()) / tracking_error_daily * math.sqrt(annual_periods)
        if tracking_error_daily > 1e-12
        else 0.0
    )
    result: dict[str, float | int] = {
        "observations": int(len(values)),
        "annualization_periods": int(annual_periods),
        "total_return": total_growth - 1.0,
        "annual_return": annual_return,
        "annual_volatility": annual_volatility,
        "sharpe": sharpe,
        "period_sharpe": mean / std if std > 1e-12 else 0.0,
        "return_skewness": return_skewness,
        "return_kurtosis": return_kurtosis,
        "sortino": sortino,
        "maximum_drawdown": maximum_drawdown,
        "calmar": calmar,
        "expected_shortfall_95": expected_shortfall,
        "positive_rate": float((values > 0).mean()),
        "benchmark_beta": beta,
        "active_annual_return": active_annual_return,
        "tracking_error": tracking_error,
        "information_ratio": information_ratio,
    }
    if not all(
        math.isfinite(float(value))
        for value in result.values()
    ):
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Performance metrics contain non-finite values",
        )
    return result


def implementation_metrics(
    simulation: Simulation,
    index: pd.Index,
    *,
    annual_periods: int | None = None,
) -> dict[str, float]:
    daily = simulation.daily.loc[index]
    weights = simulation.weights.loc[index]
    annual_periods = (
        annualization_periods(daily.index)
        if annual_periods is None
        else annual_periods
    )
    result = {
        "mean_one_way_turnover": float(daily["one_way_turnover"].mean()),
        "annualized_one_way_turnover": float(
            daily["one_way_turnover"].mean() * annual_periods
        ),
        "mean_traded_notional": float(daily["traded_notional"].mean()),
        "total_cost_drag": float(daily["cost"].sum()),
        "rebalance_rate": float(daily["rebalanced"].mean()),
        "no_trade_rate": float((~daily["rebalanced"]).mean()),
        "average_gross_exposure": float(daily["gross_exposure"].mean()),
        "maximum_gross_exposure": float(daily["gross_exposure"].max()),
        "average_abs_net_exposure": float(daily["net_exposure"].abs().mean()),
        "maximum_abs_net_exposure": float(daily["net_exposure"].abs().max()),
        "average_max_abs_weight": float(daily["max_abs_weight"].mean()),
        "maximum_abs_weight": float(weights.abs().max().max()),
        "average_concentration_hhi": float(daily["concentration_hhi"].mean()),
        "mean_volume_participation": float(daily["mean_participation"].mean()),
        "maximum_volume_participation": float(daily["max_participation"].max()),
    }
    if not all(math.isfinite(value) for value in result.values()):
        raise PortfolioFailure(
            "portfolio.non-finite",
            "Implementation metrics contain non-finite values",
        )
    return result


def constraint_audit(
    targets: pd.DataFrame,
    *,
    gross_target: float = GROSS_TARGET,
    max_abs_weight: float = MAX_ABS_WEIGHT,
    mandate: dict[str, object] | None = None,
) -> dict[str, object]:
    resolved = _resolve_mandate(targets.columns, mandate)
    gross_target = float(resolved["gross_limit"])
    max_abs_weight = float(resolved["max_abs_weight"])
    asset_caps = pd.Series(
        resolved["asset_max_abs_weights"],
        index=targets.columns,
        dtype=float,
    )
    family = str(resolved["family"])
    asset_position_roles = {
        str(asset): str(role)
        for asset, role in resolved["asset_position_roles"].items()
    }
    long_gross_limit = float(resolved["long_gross_limit"])
    short_gross_limit = float(resolved["short_gross_limit"])
    tradable = list(resolved["tradable_assets"])
    context = list(resolved["context_assets"])
    active = targets[targets.abs().sum(axis=1) > 1e-12]
    if active.empty:
        if family == "dollar-neutral":
            raise PortfolioFailure(
                "portfolio.no-targets",
                "No active targets were constructed",
            )
        return {
            "passed": True,
            "mandate_id": resolved["id"],
            "family": family,
            "tradable_assets": tradable,
            "context_assets": context,
            "active_dates": 0,
            "maximum_gross_error": 0.0,
            "maximum_gross_exposure": 0.0,
            "maximum_abs_net_target": 0.0,
            "maximum_net_rule_error": 0.0,
            "maximum_opposite_exposure": 0.0,
            "maximum_context_weight": 0.0,
            "maximum_tradable_gross": 0.0,
            "maximum_abs_target_weight": 0.0,
            "maximum_asset_cap_excess": 0.0,
            "asset_max_abs_weights": {
                asset: float(asset_caps.loc[asset])
                for asset in targets.columns
            },
            "asset_position_roles": asset_position_roles,
            "long_gross_limit": long_gross_limit,
            "short_gross_limit": short_gross_limit,
        }
    gross = active.abs().sum(axis=1)
    net = active.sum(axis=1)
    if family == "dollar-neutral":
        gross_error = (
            float((gross - gross_target).clip(lower=0.0).max())
            if resolved["risk_policy"] is not None
            else float((gross - gross_target).abs().max())
        )
        net_rule_error = float(net.abs().max())
        opposite_exposure = 0.0
    elif family == "long-cash":
        gross_error = float((gross - gross_target).clip(lower=0.0).max())
        net_rule_error = float((net - gross).abs().max())
        opposite_exposure = float((-active.clip(upper=0.0)).sum(axis=1).max())
    elif family == "short-cash":
        gross_error = float((gross - gross_target).clip(lower=0.0).max())
        net_rule_error = float((net + gross).abs().max())
        opposite_exposure = float(active.clip(lower=0.0).sum(axis=1).max())
    elif family == "asset-role":
        long_exposure = active.clip(lower=0.0).sum(axis=1)
        short_exposure = (-active.clip(upper=0.0)).sum(axis=1)
        gross_error = float(
            pd.concat(
                [
                    (long_exposure - long_gross_limit).clip(lower=0.0),
                    (short_exposure - short_gross_limit).clip(lower=0.0),
                    (gross - gross_target).clip(lower=0.0),
                ],
                axis=1,
            ).max().max()
        )
        forbidden: list[float] = []
        for asset in active.columns:
            role = asset_position_roles[str(asset)]
            if role == "long-only":
                forbidden.append(float((-active[asset].clip(upper=0.0)).max()))
            elif role == "short-only":
                forbidden.append(float(active[asset].clip(lower=0.0).max()))
            elif role == "context-only":
                forbidden.append(float(active[asset].abs().max()))
        opposite_exposure = max(forbidden, default=0.0)
        net_rule_error = 0.0
    else:
        raise PortfolioFailure("mandate.family", "Unknown mandate family")
    maximum_weight = float(active.abs().max().max())
    cap_excess = active.abs().subtract(asset_caps, axis="columns")
    maximum_asset_cap_excess = float(
        cap_excess.clip(lower=0.0).max().max()
    )
    context_weight = (
        float(active[context].abs().max().max())
        if context
        else 0.0
    )
    tradable_gross = float(active[tradable].abs().sum(axis=1).max())
    passed = (
        gross_error <= 1e-8
        and net_rule_error <= 1e-8
        and opposite_exposure <= 1e-8
        and context_weight <= 1e-8
        and maximum_weight <= max_abs_weight + 1e-8
        and maximum_asset_cap_excess <= 1e-8
    )
    return {
        "passed": passed,
        "mandate_id": resolved["id"],
        "family": family,
        "tradable_assets": tradable,
        "context_assets": context,
        "active_dates": int(len(active)),
        "maximum_gross_error": gross_error,
        "maximum_gross_exposure": float(gross.max()),
        "maximum_abs_net_target": float(net.abs().max()),
        "maximum_net_rule_error": net_rule_error,
        "maximum_opposite_exposure": opposite_exposure,
        "maximum_context_weight": context_weight,
        "maximum_tradable_gross": tradable_gross,
        "maximum_abs_target_weight": maximum_weight,
        "maximum_asset_cap_excess": maximum_asset_cap_excess,
        "asset_max_abs_weights": {
            asset: float(asset_caps.loc[asset])
            for asset in targets.columns
        },
        "asset_position_roles": asset_position_roles,
        "long_gross_limit": long_gross_limit,
        "short_gross_limit": short_gross_limit,
    }
