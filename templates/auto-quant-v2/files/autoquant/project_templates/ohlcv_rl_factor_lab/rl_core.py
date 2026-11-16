"""Fixed bounded RL environment, learner, and baseline primitives."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd

try:
    from judges.portfolio_core import (
        RiskCovarianceCache,
        Simulation,
        build_risk_covariance_cache,
        construct_signal_policy,
        decision_schedule_mask,
        decision_schedule_sessions,
        drift_weights,
        execution_risk_metrics,
        execute_risk_compliant_book,
        implementation_metrics,
        performance_metrics,
        resolve_implementation_policy,
        resolve_portfolio_mandate,
    )
except ModuleNotFoundError:  # Package-level deterministic primitive tests.
    from autoquant.project_templates.ohlcv_portfolio_lab.portfolio_core import (
        RiskCovarianceCache,
        Simulation,
        build_risk_covariance_cache,
        construct_signal_policy,
        decision_schedule_mask,
        decision_schedule_sessions,
        drift_weights,
        execution_risk_metrics,
        execute_risk_compliant_book,
        implementation_metrics,
        performance_metrics,
        resolve_implementation_policy,
        resolve_portfolio_mandate,
    )


ACTIONS = ("candidate", "activity", "intraday", "reversal", "balanced")
EXPERTS = ACTIONS[:4]
ACTION_MIXTURES = {
    expert: {
        candidate: float(candidate == expert)
        for candidate in EXPERTS
    }
    for expert in EXPERTS
}
ACTION_MIXTURES["balanced"] = {
    expert: 1.0 / len(EXPERTS)
    for expert in EXPERTS
}
SEEDS = (11, 29, 47)
EPISODES = 12
LEARNING_RATE = 0.02
DISCOUNT = 0.30
EPSILON_START = 0.15
EPSILON_END = 0.01
RISK_AVERSION = 0.10
FEATURE_ABS_LIMIT = 20.0
RIDGE_PENALTY = 1e-3
CONTEXTUAL_RIDGE_ITERATIONS = 4
MIN_SPLIT_OBSERVATIONS = 24
BASE_STATE_COLUMNS = (
    "volume_regime",
    "market_return_5",
    "market_volatility_20",
    "candidate_trailing_reward_10",
    "activity_trailing_reward_10",
    "intraday_trailing_reward_10",
    "reversal_trailing_reward_10",
)
PRETRADE_STATE_COLUMNS = (
    "pretrade_gross_exposure",
    "pretrade_net_exposure",
    "pretrade_cash_weight",
    "pretrade_max_abs_weight",
    "pretrade_concentration_hhi",
)
ACTION_DISTANCE_COLUMNS = tuple(
    f"{action}_target_distance"
    for action in ACTIONS
)
PREVIOUS_ACTION_COLUMNS = tuple(
    f"previous_{action}"
    for action in ACTIONS
)
POLICY_STATE_COLUMNS = (
    BASE_STATE_COLUMNS
    + PRETRADE_STATE_COLUMNS
    + ACTION_DISTANCE_COLUMNS
    + PREVIOUS_ACTION_COLUMNS
)


class PolicyFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class Rollout:
    simulation: Simulation
    actions: pd.Series
    rewards: pd.Series
    states: pd.DataFrame


@dataclass(frozen=True)
class TrainedPolicy:
    weights: np.ndarray
    history: list[dict[str, object]]


@dataclass(frozen=True)
class TrainingRollout:
    actions: pd.Series
    states: pd.DataFrame
    pretrade: np.ndarray
    net_returns: pd.Series
    benchmark_returns: pd.Series
    rewards: np.ndarray


def build_action_targets(
    factor_panels: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    *,
    mandate: dict[str, object] | None = None,
    prediction_population: dict[str, object] | None = None,
) -> dict[str, pd.DataFrame]:
    if set(factor_panels) != set(EXPERTS):
        raise PolicyFailure(
            "policy.factors",
            "Factor panels must exactly match the fixed expert set",
        )
    targets: dict[str, pd.DataFrame] = {}
    for action, mixture in ACTION_MIXTURES.items():
        combined = sum(
            factor_panels[expert] * weight
            for expert, weight in mixture.items()
        )
        targets[action] = construct_signal_policy(
            combined,
            closes,
            mandate=mandate,
            prediction_population=prediction_population,
            include_ledger=False,
        ).targets
    return targets


def build_raw_states(
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    action_targets: dict[str, pd.DataFrame],
) -> pd.DataFrame:
    close_returns = closes.pct_change(fill_method=None)
    market_return = close_returns.mean(axis=1)
    log_volume = np.log(volumes)
    market_log_volume = log_volume.mean(axis=1)
    volume_regime = (
        market_log_volume
        - market_log_volume.expanding(min_periods=20).mean()
    )
    state = pd.DataFrame(
        {
            "volume_regime": volume_regime,
            "market_return_5": market_return.rolling(5, min_periods=5).mean(),
            "market_volatility_20": market_return.rolling(
                20,
                min_periods=20,
            ).std(ddof=0),
        }
    )
    for expert in EXPERTS:
        targets = action_targets[expert]
        gross = (
            targets
            * (closes.shift(-1) / closes - 1.0)
        ).sum(axis=1)
        state[f"{expert}_trailing_reward_10"] = (
            gross.shift(1).rolling(10, min_periods=10).mean()
        )
    state = state.replace([np.inf, -np.inf], np.nan)
    return state


def state_with_previous_action(
    raw_state: pd.Series,
    previous_action: str,
) -> dict[str, float]:
    if previous_action not in ACTIONS:
        raise PolicyFailure("policy.action", "Unknown previous action")
    result = {
        key: float(raw_state[key])
        for key in BASE_STATE_COLUMNS
    }
    result.update(
        {
            f"previous_{action}": float(action == previous_action)
            for action in ACTIONS
        }
    )
    if not all(math.isfinite(value) for value in result.values()):
        raise PolicyFailure("policy.state", "Causal state contains non-finite values")
    return result


def build_policy_state(
    raw_state: pd.Series,
    previous_action: str,
    pretrade_weights: pd.Series,
    action_targets: dict[str, pd.Series],
) -> dict[str, float]:
    """Build one causal market-and-execution state at the decision close."""

    if set(action_targets) != set(ACTIONS):
        raise PolicyFailure(
            "policy.state-actions",
            "Policy state action targets differ from the fixed action set",
        )
    if (
        pretrade_weights.index.has_duplicates
        or any(
            not target.index.equals(pretrade_weights.index)
            for target in action_targets.values()
        )
    ):
        raise PolicyFailure(
            "policy.state-assets",
            "Policy state books do not share one ordered asset universe",
        )
    result = state_with_previous_action(raw_state, previous_action)
    result.update(
        {
            "pretrade_gross_exposure": float(
                pretrade_weights.abs().sum()
            ),
            "pretrade_net_exposure": float(pretrade_weights.sum()),
            "pretrade_cash_weight": (
                1.0 - float(pretrade_weights.abs().sum())
            ),
            "pretrade_max_abs_weight": float(
                pretrade_weights.abs().max()
            ),
            "pretrade_concentration_hhi": float(
                pretrade_weights.pow(2).sum()
            ),
        }
    )
    result.update(
        {
            f"{action}_target_distance": float(
                0.5
                * (
                    action_targets[action] - pretrade_weights
                ).abs().sum()
            )
            for action in ACTIONS
        }
    )
    if set(result) != set(POLICY_STATE_COLUMNS):
        raise PolicyFailure(
            "policy.state-fields",
            "Policy state fields differ from the fixed causal contract",
        )
    if not all(math.isfinite(value) for value in result.values()):
        raise PolicyFailure(
            "policy.state",
            "Causal policy state contains non-finite values",
        )
    return result


def _pretrade_weights(
    previous_weights: pd.Series,
    close_returns: pd.DataFrame,
    timestamp: object,
    *,
    first: bool,
) -> pd.Series:
    return (
        pd.Series(
            0.0,
            index=previous_weights.index,
            dtype=float,
        )
        if first
        else drift_weights(previous_weights, close_returns.loc[timestamp])
    )


def _account_step(
    previous_weights: pd.Series,
    proposed: pd.Series,
    close_returns: pd.DataFrame,
    timestamp: object,
    forward_return: pd.Series,
    close: pd.Series,
    volume: pd.Series,
    *,
    first: bool,
    ordinary_rebalance_allowed: bool = True,
    mandate: dict[str, object] | None = None,
    risk_covariance_cache: RiskCovarianceCache | None = None,
    resolved_mandate: dict[str, object] | None = None,
    implementation: dict[str, object] | None = None,
    pretrade: pd.Series | None = None,
) -> tuple[pd.Series, pd.Series, pd.Series, dict[str, float | bool]]:
    implementation = (
        implementation
        if implementation is not None
        else resolve_implementation_policy(mandate)
    )
    decision_policy = dict(implementation["decision_policy"])
    decision_schedule_kind = str(decision_policy["kind"])
    decision_every_bars = decision_policy.get("bars")
    decision_anchor = decision_policy.get("anchor")
    pretrade = (
        pretrade
        if pretrade is not None
        else _pretrade_weights(
            previous_weights,
            close_returns,
            timestamp,
            first=first,
        )
    )
    current, execution_risk = execute_risk_compliant_book(
        pretrade,
        proposed,
        close_returns,
        timestamp,
        mandate=mandate,
        no_trade_one_way=implementation["no_trade_one_way"],
        ordinary_rebalance_allowed=ordinary_rebalance_allowed,
        risk_covariance_cache=risk_covariance_cache,
        _resolved_mandate=resolved_mandate,
    )
    rebalanced = bool(execution_risk["rebalanced"])
    trade = current - pretrade
    traded_notional = float(trade.abs().sum())
    one_way_turnover = 0.5 * traded_notional
    cost = (
        traded_notional
        * implementation["base_cost_bps"]
        / 10_000.0
    )
    gross_return = float((current * forward_return).sum())
    net_return = gross_return - cost
    reward = net_return - RISK_AVERSION * gross_return**2
    if mandate is None:
        benchmark_return = float(forward_return.mean())
    else:
        construction = mandate["construction"]
        benchmark = construction["benchmark"]
        weights = benchmark.get("weights")
        if (
            not isinstance(weights, dict)
            or set(weights) != set(forward_return.index)
        ):
            raise PolicyFailure(
                "mandate.benchmark",
                "Portfolio Mandate benchmark weights are invalid",
            )
        benchmark_return = float(
            (
                pd.Series(
                    weights,
                    index=forward_return.index,
                    dtype=float,
                )
                * forward_return
            ).sum()
        )
    dollar_volume = close * volume
    participation = (
        trade.abs()
        * implementation["reference_nav"]
        / dollar_volume.replace(0.0, np.nan)
    ).fillna(0.0)
    row: dict[str, object] = {
        "gross_return": gross_return,
        "net_return": net_return,
        "benchmark_return": benchmark_return,
        "reward": reward,
        "one_way_turnover": one_way_turnover,
        "traded_notional": traded_notional,
        "cost": cost,
        "gross_exposure": float(current.abs().sum()),
        "net_exposure": float(current.sum()),
        "cash_weight": 1.0 - float(current.abs().sum()),
        "max_abs_weight": float(current.abs().max()),
        "concentration_hhi": float(current.pow(2).sum()),
        "rebalanced": rebalanced,
        "decision_eligible": ordinary_rebalance_allowed,
        "decision_schedule_kind": decision_schedule_kind,
        "decision_every_bars": decision_every_bars,
        "decision_anchor": decision_anchor,
        "decision_session": str(
            decision_schedule_sessions(
                pd.Index([timestamp]),
                decision_policy,
            ).iloc[0]
        ),
        "execution_reason": str(execution_risk["execution_reason"]),
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
            execution_risk["proposed_forecast_pre_annualized"]
        ),
        "proposed_risk_forecast_post_annualized": float(
            execution_risk["proposed_forecast_post_annualized"]
        ),
        "executed_risk_forecast_annualized": float(
            execution_risk["executed_forecast_annualized"]
        ),
        "execution_risk_ceiling_annualized": float(
            execution_risk["annualized_volatility_ceiling"]
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
        "max_participation": float(participation.max()),
        "mean_participation": float(participation.mean()),
    }
    numeric = [
        float(value)
        for value in row.values()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    ]
    if not all(math.isfinite(value) for value in numeric):
        raise PolicyFailure(
            "policy.non-finite",
            "Environment accounting produced non-finite evidence",
        )
    return current, trade, participation, row


def _learning_step(
    previous_weights: pd.Series,
    proposed: pd.Series,
    close_returns: pd.DataFrame,
    timestamp: object,
    forward_return: pd.Series,
    *,
    ordinary_rebalance_allowed: bool,
    mandate: dict[str, object] | None,
    risk_covariance_cache: RiskCovarianceCache | None,
    resolved_mandate: dict[str, object],
    implementation: dict[str, object],
    pretrade: pd.Series,
) -> tuple[pd.Series, float]:
    """Advance the exact governed book without constructing unused evidence."""

    current, _ = execute_risk_compliant_book(
        pretrade,
        proposed,
        close_returns,
        timestamp,
        mandate=mandate,
        no_trade_one_way=implementation["no_trade_one_way"],
        ordinary_rebalance_allowed=ordinary_rebalance_allowed,
        risk_covariance_cache=risk_covariance_cache,
        _resolved_mandate=resolved_mandate,
        _state_only=True,
    )
    traded_notional = float((current - pretrade).abs().sum())
    cost = (
        traded_notional
        * implementation["base_cost_bps"]
        / 10_000.0
    )
    gross_return = float((current * forward_return).sum())
    net_return = gross_return - cost
    reward = net_return - RISK_AVERSION * gross_return**2
    if not math.isfinite(reward):
        raise PolicyFailure(
            "policy.non-finite",
            "Learning accounting produced a non-finite reward",
        )
    return current, reward


def _drift_weight_values(
    previous: np.ndarray,
    realized_returns: np.ndarray,
) -> np.ndarray:
    aligned = np.where(np.isnan(realized_returns), 0.0, realized_returns)
    gross_return = float((previous * aligned).sum())
    denominator = 1.0 + gross_return
    if not math.isfinite(denominator) or denominator <= 1e-9:
        raise PolicyFailure(
            "portfolio.bankrupt",
            "Portfolio drift denominator is non-positive",
        )
    drifted = previous * (1.0 + aligned) / denominator
    if not np.isfinite(drifted).all():
        raise PolicyFailure(
            "portfolio.non-finite",
            "Drift produced non-finite weights",
        )
    return drifted


def _policy_state_values(
    raw_state: np.ndarray,
    previous_action_number: int,
    pretrade: np.ndarray,
    action_targets: np.ndarray,
) -> dict[str, float]:
    if (
        raw_state.shape != (len(BASE_STATE_COLUMNS),)
        or action_targets.shape != (len(ACTIONS), len(pretrade))
        or not 0 <= previous_action_number < len(ACTIONS)
    ):
        raise PolicyFailure(
            "policy.state-values",
            "Array policy state inputs differ from the fixed contract",
        )
    result = {
        column: float(raw_state[position])
        for position, column in enumerate(BASE_STATE_COLUMNS)
    }
    result.update(
        {
            f"previous_{action}": float(
                position == previous_action_number
            )
            for position, action in enumerate(ACTIONS)
        }
    )
    absolute = np.abs(pretrade)
    result.update(
        {
            "pretrade_gross_exposure": float(absolute.sum()),
            "pretrade_net_exposure": float(pretrade.sum()),
            "pretrade_cash_weight": 1.0 - float(absolute.sum()),
            "pretrade_max_abs_weight": float(absolute.max()),
            "pretrade_concentration_hhi": float(
                np.square(pretrade).sum()
            ),
        }
    )
    result.update(
        {
            f"{action}_target_distance": float(
                0.5
                * np.abs(
                    action_targets[position] - pretrade
                ).sum()
            )
            for position, action in enumerate(ACTIONS)
        }
    )
    if set(result) != set(POLICY_STATE_COLUMNS) or not all(
        math.isfinite(value) for value in result.values()
    ):
        raise PolicyFailure(
            "policy.state",
            "Causal policy state contains invalid values",
        )
    return result


def _repair_weight_values(
    weights: np.ndarray,
    resolved: dict[str, object],
) -> np.ndarray:
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
        or cap_values.shape != weights.shape
    ):
        role_values = tuple(str(value) for value in roles.values())
        cap_values = np.asarray(
            [float(value) for value in caps.values()],
            dtype=float,
        )
        resolved["_constraint_role_values"] = role_values
        resolved["_constraint_cap_values"] = cap_values
    repaired = weights.copy()
    for position, role in enumerate(role_values):
        cap = float(cap_values[position])
        value = float(repaired[position])
        if role == "context-only":
            value = 0.0
        elif role == "long-only":
            value = max(value, 0.0)
        elif role == "short-only":
            value = min(value, 0.0)
        repaired[position] = min(max(value, -cap), cap)

    family = str(resolved["family"])
    gross_limit = float(resolved["gross_limit"])
    long_limit = float(resolved["long_gross_limit"])
    short_limit = float(resolved["short_gross_limit"])
    if family == "dollar-neutral":
        positive = repaired > 0.0
        negative = repaired < 0.0
        long_exposure = float(repaired[positive].sum())
        short_exposure = float(-repaired[negative].sum())
        funded_side = min(
            long_exposure,
            short_exposure,
            long_limit,
            short_limit,
            gross_limit / 2.0,
        )
        if funded_side <= 1e-15:
            repaired.fill(0.0)
        else:
            repaired[positive] *= funded_side / long_exposure
            repaired[negative] *= funded_side / short_exposure
    else:
        for positive, limit in (
            (True, long_limit),
            (False, short_limit),
        ):
            mask = repaired > 0.0 if positive else repaired < 0.0
            exposure = float(
                repaired[mask].sum()
                if positive
                else -repaired[mask].sum()
            )
            if exposure > limit + 1e-15:
                repaired[mask] *= limit / exposure
        gross = float(np.abs(repaired).sum())
        if gross > gross_limit + 1e-15:
            repaired *= gross_limit / gross
    if not np.isfinite(repaired).all():
        raise PolicyFailure(
            "portfolio.non-finite",
            "Mandate repair produced non-finite weights",
        )
    return repaired


def _govern_weight_values(
    weights: np.ndarray,
    timestamp: object,
    resolved: dict[str, object],
    risk_covariance_cache: RiskCovarianceCache,
) -> np.ndarray:
    if float(np.abs(weights).sum()) <= 1e-12:
        return weights.copy()
    policy = resolved["risk_policy"]
    if policy is None:
        return weights.copy()
    assert isinstance(policy, dict)
    cached = risk_covariance_cache.get(timestamp)
    if cached is None:
        raise PolicyFailure(
            "portfolio.risk-cache",
            "Risk covariance cache is missing a learning timestamp",
        )
    observations, covariance = cached
    if (
        observations < int(policy["minimum_observations"])
        or covariance is None
    ):
        return np.zeros_like(weights)
    if covariance.shape != (len(weights), len(weights)):
        raise PolicyFailure(
            "portfolio.risk-cache",
            "Risk covariance cache shape is invalid",
        )
    variance = float(weights @ covariance @ weights)
    if not math.isfinite(variance) or variance < -1e-12:
        return np.zeros_like(weights)
    forecast = math.sqrt(
        max(variance, 0.0) * int(policy["annualization_periods"])
    )
    ceiling = float(policy["annualized_volatility_ceiling"])
    scale = (
        min(1.0, ceiling / forecast)
        if forecast > 1e-12
        else 1.0
    )
    return weights * scale


def _learning_account_values(
    pretrade: np.ndarray,
    proposed: np.ndarray,
    timestamp: object,
    forward_return: np.ndarray,
    *,
    ordinary_rebalance_allowed: bool,
    no_trade_one_way: float,
    base_cost_bps: float,
    resolved_mandate: dict[str, object],
    risk_covariance_cache: RiskCovarianceCache,
) -> tuple[np.ndarray, float, float, float]:
    if ordinary_rebalance_allowed:
        runtime_proposed = _govern_weight_values(
            _repair_weight_values(proposed, resolved_mandate),
            timestamp,
            resolved_mandate,
            risk_covariance_cache,
        )
        proposed_one_way = 0.5 * float(
            np.abs(runtime_proposed - pretrade).sum()
        )
        ordinary_rebalance = (
            proposed_one_way + 1e-12 >= no_trade_one_way
        )
        ordinary_book = (
            runtime_proposed if ordinary_rebalance else pretrade
        )
    else:
        ordinary_rebalance = False
        ordinary_book = pretrade
    constraint_book = _repair_weight_values(
        ordinary_book,
        resolved_mandate,
    )
    current = (
        constraint_book
        if ordinary_rebalance
        else _govern_weight_values(
            constraint_book,
            timestamp,
            resolved_mandate,
            risk_covariance_cache,
        )
    )
    traded_notional = float(np.abs(current - pretrade).sum())
    cost = traded_notional * base_cost_bps / 10_000.0
    gross_return = float((current * forward_return).sum())
    net_return = gross_return - cost
    reward = net_return - RISK_AVERSION * gross_return**2
    if not np.isfinite(current).all() or not math.isfinite(reward):
        raise PolicyFailure(
            "policy.non-finite",
            "Array learning accounting produced non-finite evidence",
        )
    return current, gross_return, net_return, reward


def _learning_step_values(
    pretrade: np.ndarray,
    proposed: np.ndarray,
    timestamp: object,
    forward_return: np.ndarray,
    *,
    ordinary_rebalance_allowed: bool,
    no_trade_one_way: float,
    base_cost_bps: float,
    resolved_mandate: dict[str, object],
    risk_covariance_cache: RiskCovarianceCache,
) -> tuple[np.ndarray, float]:
    current, _, _, reward = _learning_account_values(
        pretrade,
        proposed,
        timestamp,
        forward_return,
        ordinary_rebalance_allowed=ordinary_rebalance_allowed,
        no_trade_one_way=no_trade_one_way,
        base_cost_bps=base_cost_bps,
        resolved_mandate=resolved_mandate,
        risk_covariance_cache=risk_covariance_cache,
    )
    return current, reward


def _prepare_array_runtime(
    raw_states: pd.DataFrame,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    index: pd.Index,
    mandate: dict[str, object] | None,
    risk_covariance_cache: RiskCovarianceCache | None,
) -> tuple[
    dict[str, object],
    dict[str, object],
    RiskCovarianceCache,
    list[object],
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
]:
    resolved = resolve_portfolio_mandate(closes.columns, mandate)
    resolved["_constraint_role_values"] = tuple(
        str(resolved["asset_position_roles"][str(asset)])
        for asset in closes.columns
    )
    resolved["_constraint_cap_values"] = np.asarray(
        [
            float(resolved["asset_max_abs_weights"][str(asset)])
            for asset in closes.columns
        ],
        dtype=float,
    )
    implementation = resolve_implementation_policy(mandate)
    cache = (
        risk_covariance_cache
        if risk_covariance_cache is not None
        else build_risk_covariance_cache(closes, mandate=mandate)
    )
    decision_mask = decision_schedule_mask(
        next(iter(action_targets.values())).index,
        dict(implementation["decision_policy"]),
    ).reindex(index)
    if decision_mask.isna().any():
        raise PolicyFailure(
            "policy.decision-cadence",
            "Array runtime split is outside the complete decision schedule",
        )
    close_returns = closes.pct_change(fill_method=None)
    forward_returns = closes.shift(-1) / closes - 1.0
    return (
        resolved,
        implementation,
        cache,
        list(index),
        raw_states.loc[
            index,
            list(BASE_STATE_COLUMNS),
        ].to_numpy(dtype=float),
        np.stack(
            [
                action_targets[action]
                .loc[index, closes.columns]
                .to_numpy(dtype=float)
                for action in ACTIONS
            ],
            axis=0,
        ),
        close_returns.loc[
            index,
            closes.columns,
        ].to_numpy(dtype=float),
        (
            forward_returns.loc[index, closes.columns]
            .fillna(0.0)
            .to_numpy(dtype=float)
        ),
        decision_mask.to_numpy(dtype=bool),
    )


def _training_rollout(
    selector: Callable[[dict[str, float]], str],
    raw_states: pd.DataFrame,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    index: pd.Index,
    *,
    mandate: dict[str, object] | None,
    risk_covariance_cache: RiskCovarianceCache | None,
) -> TrainingRollout:
    (
        resolved,
        implementation,
        cache,
        timestamps,
        raw_values,
        target_values,
        close_return_values,
        forward_return_values,
        decision_values,
    ) = _prepare_array_runtime(
        raw_states,
        action_targets,
        closes,
        index,
        mandate,
        risk_covariance_cache,
    )
    benchmark = (
        None
        if mandate is None
        else np.asarray(
            [
                float(
                    mandate["construction"]["benchmark"]["weights"][
                        str(asset)
                    ]
                )
                for asset in closes.columns
            ],
            dtype=float,
        )
    )
    previous_values = np.zeros(len(closes.columns), dtype=float)
    previous_action_number = ACTIONS.index("balanced")
    action_numbers: list[int] = []
    state_rows: list[dict[str, float]] = []
    pretrade_rows: list[np.ndarray] = []
    net_returns: list[float] = []
    benchmark_returns: list[float] = []
    rewards: list[float] = []
    for position, timestamp in enumerate(timestamps):
        pretrade = (
            np.zeros(len(closes.columns), dtype=float)
            if position == 0
            else _drift_weight_values(
                previous_values,
                close_return_values[position],
            )
        )
        state = _policy_state_values(
            raw_values[position],
            previous_action_number,
            pretrade,
            target_values[:, position, :],
        )
        action_number = (
            ACTIONS.index(selector(state))
            if decision_values[position]
            else previous_action_number
        )
        current, _, net_return, reward = _learning_account_values(
            pretrade,
            target_values[action_number, position],
            timestamp,
            forward_return_values[position],
            ordinary_rebalance_allowed=bool(
                decision_values[position]
            ),
            no_trade_one_way=float(
                implementation["no_trade_one_way"]
            ),
            base_cost_bps=float(
                implementation["base_cost_bps"]
            ),
            resolved_mandate=resolved,
            risk_covariance_cache=cache,
        )
        action_numbers.append(action_number)
        state_rows.append(state)
        pretrade_rows.append(pretrade)
        net_returns.append(net_return)
        benchmark_returns.append(
            float(forward_return_values[position].mean())
            if benchmark is None
            else float(
                (
                    benchmark * forward_return_values[position]
                ).sum()
            )
        )
        rewards.append(reward)
        previous_values = current
        previous_action_number = action_number
    return TrainingRollout(
        actions=pd.Series(
            [ACTIONS[number] for number in action_numbers],
            index=index,
            name="action",
        ),
        states=pd.DataFrame(
            state_rows,
            index=index,
            columns=list(POLICY_STATE_COLUMNS),
        ),
        pretrade=np.asarray(pretrade_rows, dtype=float),
        net_returns=pd.Series(
            net_returns,
            index=index,
            name="net_return",
        ),
        benchmark_returns=pd.Series(
            benchmark_returns,
            index=index,
            name="benchmark_return",
        ),
        rewards=np.asarray(rewards, dtype=float),
    )


def training_policy_net_sharpe(
    selector: Callable[[dict[str, float]], str],
    raw_states: pd.DataFrame,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    index: pd.Index,
    *,
    mandate: dict[str, object] | None,
    risk_covariance_cache: RiskCovarianceCache | None,
) -> float:
    """Return exact train-only net Sharpe without artifact-only accounting."""

    rollout = _training_rollout(
        selector,
        raw_states,
        action_targets,
        closes,
        index,
        mandate=mandate,
        risk_covariance_cache=risk_covariance_cache,
    )
    return float(
        performance_metrics(
            rollout.net_returns,
            rollout.benchmark_returns,
        )["sharpe"]
    )


def _training_opportunity_summary(
    rollout: TrainingRollout,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    index: pd.Index,
    *,
    mandate: dict[str, object] | None,
    risk_covariance_cache: RiskCovarianceCache | None,
) -> tuple[np.ndarray, float, float]:
    (
        resolved,
        implementation,
        cache,
        timestamps,
        _,
        target_values,
        _,
        forward_return_values,
        decision_values,
    ) = _prepare_array_runtime(
        rollout.states.loc[:, list(BASE_STATE_COLUMNS)],
        action_targets,
        closes,
        index,
        mandate,
        risk_covariance_cache,
    )
    oracle_hits: list[bool] = []
    regrets: list[float] = []
    reward_rows: list[list[float]] = []
    for position, timestamp in enumerate(timestamps):
        selected_number = ACTIONS.index(
            str(rollout.actions.iloc[position])
        )
        if decision_values[position]:
            action_rewards = [
                _learning_account_values(
                    rollout.pretrade[position],
                    target_values[action_number, position],
                    timestamp,
                    forward_return_values[position],
                    ordinary_rebalance_allowed=True,
                    no_trade_one_way=float(
                        implementation["no_trade_one_way"]
                    ),
                    base_cost_bps=float(
                        implementation["base_cost_bps"]
                    ),
                    resolved_mandate=resolved,
                    risk_covariance_cache=cache,
                )[3]
                for action_number in range(len(ACTIONS))
            ]
            ranked = sorted(
                range(len(ACTIONS)),
                key=lambda number: (-action_rewards[number], number),
            )
            oracle_number = ranked[0]
            selected_reward = action_rewards[selected_number]
            oracle_reward = action_rewards[oracle_number]
        else:
            oracle_number = selected_number
            selected_reward = float(rollout.rewards[position])
            oracle_reward = selected_reward
            action_rewards = [selected_reward] * len(ACTIONS)
        reward_rows.append(action_rewards)
        oracle_hits.append(selected_number == oracle_number)
        regrets.append(max(0.0, oracle_reward - selected_reward))
    return (
        np.asarray(reward_rows, dtype=float),
        float(np.mean(oracle_hits)),
        float(np.mean(regrets)),
    )


def rollout_policy(
    selector: Callable[[dict[str, float]], str],
    raw_states: pd.DataFrame,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    index: pd.Index,
    *,
    mandate: dict[str, object] | None = None,
    risk_covariance_cache: RiskCovarianceCache | None = None,
) -> Rollout:
    if len(index) < MIN_SPLIT_OBSERVATIONS:
        raise PolicyFailure(
            "policy.population",
            "Policy rollout split is too short",
        )
    close_returns = closes.pct_change(fill_method=None)
    forward_returns = closes.shift(-1) / closes - 1.0
    resolved_mandate = resolve_portfolio_mandate(
        closes.columns,
        mandate,
    )
    implementation = resolve_implementation_policy(mandate)
    previous_weights = pd.Series(0.0, index=closes.columns, dtype=float)
    previous_action = "balanced"
    decision_policy = dict(implementation["decision_policy"])
    complete_index = next(iter(action_targets.values())).index
    decision_mask = decision_schedule_mask(
        complete_index,
        decision_policy,
    ).reindex(index)
    if decision_mask.isna().any():
        raise PolicyFailure(
            "policy.decision-cadence",
            "Policy split is outside the complete decision schedule",
        )
    daily_rows: list[dict[str, object]] = []
    weight_rows: list[pd.Series] = []
    trade_rows: list[pd.Series] = []
    participation_rows: list[pd.Series] = []
    actions: list[str] = []
    state_rows: list[dict[str, float]] = []
    for position, timestamp in enumerate(index):
        first = position == 0
        decision_eligible = bool(decision_mask.loc[timestamp])
        pretrade = _pretrade_weights(
            previous_weights,
            close_returns,
            timestamp,
            first=first,
        )
        state = build_policy_state(
            raw_states.loc[timestamp],
            previous_action,
            pretrade,
            {
                action: action_targets[action].loc[timestamp]
                for action in ACTIONS
            },
        )
        action = (
            selector(state)
            if decision_eligible
            else previous_action
        )
        if action not in ACTIONS:
            raise PolicyFailure(
                "policy.action",
                f"Policy selected unknown action: {action}",
            )
        current, trade, participation, row = _account_step(
            previous_weights,
            action_targets[action].loc[timestamp],
            close_returns,
            timestamp,
            forward_returns.loc[timestamp].fillna(0.0),
            closes.loc[timestamp],
            volumes.loc[timestamp],
            first=first,
            ordinary_rebalance_allowed=decision_eligible,
            mandate=mandate,
            risk_covariance_cache=risk_covariance_cache,
            resolved_mandate=resolved_mandate,
            implementation=implementation,
            pretrade=pretrade,
        )
        daily_rows.append(row)
        weight_rows.append(current)
        trade_rows.append(trade)
        participation_rows.append(participation)
        actions.append(action)
        state_rows.append(state)
        previous_weights = current
        previous_action = action
    simulation = Simulation(
        daily=pd.DataFrame(daily_rows, index=index),
        weights=pd.DataFrame(weight_rows, index=index),
        trades=pd.DataFrame(trade_rows, index=index),
        participation=pd.DataFrame(participation_rows, index=index),
    )
    return Rollout(
        simulation=simulation,
        actions=pd.Series(actions, index=index, name="action"),
        rewards=simulation.daily["reward"].copy(),
        states=pd.DataFrame(
            state_rows,
            index=index,
            columns=list(POLICY_STATE_COLUMNS),
        ),
    )


def one_step_action_opportunities(
    rollout: Rollout,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    index: pd.Index,
    *,
    mandate: dict[str, object] | None = None,
    risk_covariance_cache: RiskCovarianceCache | None = None,
) -> list[dict[str, object]]:
    """Audit every governed action from the actual policy pretrade book."""

    if (
        not rollout.actions.index.equals(index)
        or not rollout.simulation.daily.index.equals(index)
        or not rollout.simulation.weights.index.equals(index)
        or not rollout.simulation.trades.index.equals(index)
        or set(action_targets) != set(ACTIONS)
    ):
        raise PolicyFailure(
            "policy.opportunity-identity",
            "Opportunity audit inputs differ from the selected rollout",
        )
    cache = (
        risk_covariance_cache
        if risk_covariance_cache is not None
        else build_risk_covariance_cache(closes, mandate=mandate)
    )
    close_returns = closes.pct_change(fill_method=None)
    forward_returns = closes.shift(-1) / closes - 1.0
    resolved_mandate = resolve_portfolio_mandate(
        closes.columns,
        mandate,
    )
    implementation = resolve_implementation_policy(mandate)
    zero = pd.Series(0.0, index=closes.columns, dtype=float)
    decision_policy = dict(implementation["decision_policy"])
    complete_index = next(iter(action_targets.values())).index
    decision_mask = decision_schedule_mask(
        complete_index,
        decision_policy,
    ).reindex(index)
    if decision_mask.isna().any():
        raise PolicyFailure(
            "policy.decision-cadence",
            "Opportunity split is outside the complete decision schedule",
        )
    rows: list[dict[str, object]] = []
    for position, timestamp in enumerate(index):
        decision_eligible = bool(decision_mask.loc[timestamp])
        selected = str(rollout.actions.loc[timestamp])
        previous_weights = (
            zero
            if position == 0
            else rollout.simulation.weights.loc[index[position - 1]]
        )
        pretrade = (
            zero.copy()
            if position == 0
            else drift_weights(previous_weights, close_returns.loc[timestamp])
        )
        forward_return = forward_returns.loc[timestamp].fillna(0.0)
        action_evidence: dict[str, dict[str, object]] = {}
        held_step = (
            None
            if decision_eligible
            else _account_step(
                previous_weights,
                action_targets[selected].loc[timestamp],
                close_returns,
                timestamp,
                forward_return,
                closes.loc[timestamp],
                volumes.loc[timestamp],
                first=position == 0,
                ordinary_rebalance_allowed=False,
                mandate=mandate,
                risk_covariance_cache=cache,
                resolved_mandate=resolved_mandate,
                implementation=implementation,
                pretrade=pretrade,
            )
        )
        for action in ACTIONS:
            proposed = action_targets[action].loc[timestamp]
            current, trade, _, daily = (
                held_step
                if held_step is not None
                else _account_step(
                    previous_weights,
                    proposed,
                    close_returns,
                    timestamp,
                    forward_return,
                    closes.loc[timestamp],
                    volumes.loc[timestamp],
                    first=position == 0,
                    ordinary_rebalance_allowed=True,
                    mandate=mandate,
                    risk_covariance_cache=cache,
                    resolved_mandate=resolved_mandate,
                    implementation=implementation,
                    pretrade=pretrade,
                )
            )
            action_evidence[action] = {
                "proposedWeights": {
                    asset: float(proposed[asset])
                    for asset in closes.columns
                },
                "executedWeights": {
                    asset: float(current[asset])
                    for asset in closes.columns
                },
                "trades": {
                    asset: float(trade[asset])
                    for asset in closes.columns
                },
                "grossReturn": float(daily["gross_return"]),
                "netReturn": float(daily["net_return"]),
                "reward": float(daily["reward"]),
                "oneWayTurnover": float(daily["one_way_turnover"]),
                "cost": float(daily["cost"]),
                "grossExposure": float(daily["gross_exposure"]),
                "netExposure": float(daily["net_exposure"]),
                "executionRiskStatus": str(
                    daily["execution_risk_status"]
                ),
                "executionRiskForecastAvailable": bool(
                    daily["execution_risk_forecast_available"]
                ),
                "executionRiskObservations": int(
                    daily["execution_risk_observations"]
                ),
                "pretradeRiskForecastAnnualized": float(
                    daily["pretrade_risk_forecast_annualized"]
                ),
                "executedRiskForecastAnnualized": float(
                    daily["executed_risk_forecast_annualized"]
                ),
                "executionRiskCeilingAnnualized": float(
                    daily["execution_risk_ceiling_annualized"]
                ),
                "riskRebalanceOverride": bool(
                    daily["risk_rebalance_override"]
                ),
                "constraintRebalanceOverride": bool(
                    daily["constraint_rebalance_override"]
                ),
                "constraintRepairOneWay": float(
                    daily["constraint_repair_one_way"]
                ),
                "executedConstraintMaximumError": float(
                    daily["executed_constraint_maximum_error"]
                ),
                "executionReason": str(daily["execution_reason"]),
            }
        selected_evidence = action_evidence[selected]
        actual_daily = rollout.simulation.daily.loc[timestamp]
        if (
            not np.allclose(
                np.asarray(
                    list(selected_evidence["executedWeights"].values()),
                    dtype=float,
                ),
                rollout.simulation.weights.loc[timestamp].to_numpy(dtype=float),
                rtol=0.0,
                atol=1e-12,
            )
            or not np.allclose(
                np.asarray(
                    list(selected_evidence["trades"].values()),
                    dtype=float,
                ),
                rollout.simulation.trades.loc[timestamp].to_numpy(dtype=float),
                rtol=0.0,
                atol=1e-12,
            )
            or any(
                not math.isclose(
                    float(selected_evidence[artifact_field]),
                    float(actual_daily[daily_field]),
                    rel_tol=0.0,
                    abs_tol=1e-12,
                )
                for artifact_field, daily_field in (
                    ("grossReturn", "gross_return"),
                    ("netReturn", "net_return"),
                    ("reward", "reward"),
                    ("oneWayTurnover", "one_way_turnover"),
                    ("cost", "cost"),
                )
            )
        ):
            raise PolicyFailure(
                "policy.opportunity-selected",
                "Selected opportunity does not reproduce the actual rollout",
            )
        ranked = sorted(
            ACTIONS,
            key=lambda action: (
                -float(action_evidence[action]["reward"]),
                ACTIONS.index(action),
            ),
        )
        if decision_eligible:
            oracle = ranked[0]
            selected_rank = ranked.index(selected) + 1
        else:
            oracle = selected
            selected_rank = 1
        selected_reward = float(selected_evidence["reward"])
        oracle_reward = float(action_evidence[oracle]["reward"])
        regret = oracle_reward - selected_reward
        if regret < -1e-12:
            raise PolicyFailure(
                "policy.opportunity-regret",
                "Selected opportunity regret is negative",
            )
        candidate_reward = float(action_evidence["candidate"]["reward"])
        balanced_reward = float(action_evidence["balanced"]["reward"])
        rows.append(
            {
                "timestamp": timestamp,
                "decisionEligible": decision_eligible,
                "decisionSchedule": {
                    key: value
                    for key, value in decision_policy.items()
                    if key != "source"
                },
                "decisionSession": str(
                    decision_schedule_sessions(
                        pd.Index([timestamp]),
                        decision_policy,
                    ).iloc[0]
                ),
                "selectedAction": selected,
                "oracleAction": oracle,
                "selectedRank": selected_rank,
                "oracleHit": selected == oracle,
                "selectedReward": selected_reward,
                "oracleReward": oracle_reward,
                "realizedRegret": max(0.0, regret),
                "candidateMinusSelectedReward": (
                    candidate_reward - selected_reward
                ),
                "candidateMinusBalancedReward": (
                    candidate_reward - balanced_reward
                ),
                "pretradeWeights": {
                    asset: float(pretrade[asset])
                    for asset in closes.columns
                },
                "forwardReturns": {
                    asset: float(forward_return[asset])
                    for asset in closes.columns
                },
                "actions": action_evidence,
            }
        )
    return rows


def compact_opportunity_rows(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Store one shared executed book when the schedule holds every sleeve."""

    execution_fields = {
        "executedWeights",
        "trades",
        "grossReturn",
        "netReturn",
        "reward",
        "oneWayTurnover",
        "cost",
        "grossExposure",
        "netExposure",
        "executionRiskStatus",
        "executionRiskForecastAvailable",
        "executionRiskObservations",
        "pretradeRiskForecastAnnualized",
        "executedRiskForecastAnnualized",
        "executionRiskCeilingAnnualized",
        "riskRebalanceOverride",
        "constraintRebalanceOverride",
        "constraintRepairOneWay",
        "executedConstraintMaximumError",
        "executionReason",
    }
    compacted: list[dict[str, Any]] = []
    for row in rows:
        if row["decisionEligible"]:
            compacted.append({**row, "sharedExecution": None})
            continue
        selected_evidence = row["actions"][row["selectedAction"]]
        compacted.append(
            {
                **row,
                "actions": {
                    action: {
                        "proposedWeights": evidence["proposedWeights"]
                    }
                    for action, evidence in row["actions"].items()
                },
                "sharedExecution": {
                    field: selected_evidence[field]
                    for field in execution_fields
                },
            }
        )
    return compacted


def train_q_policy(
    encoder: Callable[[dict[str, float]], np.ndarray],
    feature_count: int,
    raw_states: pd.DataFrame,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    train_index: pd.Index,
    *,
    seed: int,
    mandate: dict[str, object] | None = None,
    risk_covariance_cache: RiskCovarianceCache | None = None,
) -> TrainedPolicy:
    if seed not in SEEDS:
        raise PolicyFailure("policy.seed", "Seed is outside the fixed set")
    rng = np.random.default_rng(seed)
    weights = rng.normal(0.0, 1e-5, size=(len(ACTIONS), feature_count))
    close_returns = closes.pct_change(fill_method=None)
    forward_returns = closes.shift(-1) / closes - 1.0
    resolved_mandate = resolve_portfolio_mandate(
        closes.columns,
        mandate,
    )
    resolved_mandate["_constraint_role_values"] = tuple(
        str(
            resolved_mandate["asset_position_roles"][str(asset)]
        )
        for asset in closes.columns
    )
    resolved_mandate["_constraint_cap_values"] = np.asarray(
        [
            float(
                resolved_mandate["asset_max_abs_weights"][str(asset)]
            )
            for asset in closes.columns
        ],
        dtype=float,
    )
    implementation = resolve_implementation_policy(mandate)
    decision_policy = dict(implementation["decision_policy"])
    complete_index = next(iter(action_targets.values())).index
    decision_mask = decision_schedule_mask(
        complete_index,
        decision_policy,
    ).reindex(train_index)
    if decision_mask.isna().any():
        raise PolicyFailure(
            "policy.decision-cadence",
            "Training split is outside the complete decision schedule",
        )
    cache = (
        risk_covariance_cache
        if risk_covariance_cache is not None
        else build_risk_covariance_cache(closes, mandate=mandate)
    )
    timestamps = list(train_index)
    raw_values = raw_states.loc[
        train_index,
        list(BASE_STATE_COLUMNS),
    ].to_numpy(dtype=float)
    action_target_values = np.stack(
        [
            action_targets[action]
            .loc[train_index, closes.columns]
            .to_numpy(dtype=float)
            for action in ACTIONS
        ],
        axis=0,
    )
    close_return_values = close_returns.loc[
        train_index,
        closes.columns,
    ].to_numpy(dtype=float)
    forward_return_values = (
        forward_returns.loc[train_index, closes.columns]
        .fillna(0.0)
        .to_numpy(dtype=float)
    )
    decision_values = decision_mask.to_numpy(dtype=bool)
    history: list[dict[str, object]] = []
    for episode in range(EPISODES):
        fraction = episode / max(1, EPISODES - 1)
        epsilon = EPSILON_START + fraction * (EPSILON_END - EPSILON_START)
        previous_values = np.zeros(len(closes.columns), dtype=float)
        previous_action_number = ACTIONS.index("balanced")
        total_reward = 0.0
        action_counts = {action: 0 for action in ACTIONS}
        for position, timestamp in enumerate(timestamps):
            first = position == 0
            decision_eligible = bool(decision_values[position])
            pretrade_values = (
                np.zeros(len(closes.columns), dtype=float)
                if first
                else _drift_weight_values(
                    previous_values,
                    close_return_values[position],
                )
            )
            state = _policy_state_values(
                raw_values[position],
                previous_action_number,
                pretrade_values,
                action_target_values[:, position, :],
            )
            encoded = encoder(state)
            q_values = weights @ encoded
            if not decision_eligible:
                action_number = previous_action_number
            elif rng.random() < epsilon:
                action_number = int(rng.integers(0, len(ACTIONS)))
            else:
                action_number = int(np.argmax(q_values))
            action = ACTIONS[action_number]
            current_values, reward = _learning_step_values(
                pretrade_values,
                action_target_values[action_number, position],
                timestamp,
                forward_return_values[position],
                ordinary_rebalance_allowed=decision_eligible,
                no_trade_one_way=float(
                    implementation["no_trade_one_way"]
                ),
                base_cost_bps=float(
                    implementation["base_cost_bps"]
                ),
                resolved_mandate=resolved_mandate,
                risk_covariance_cache=cache,
            )
            done = position == len(train_index) - 1
            if done:
                target = reward
            else:
                next_pretrade_values = _drift_weight_values(
                    current_values,
                    close_return_values[position + 1],
                )
                next_state = _policy_state_values(
                    raw_values[position + 1],
                    action_number,
                    next_pretrade_values,
                    action_target_values[:, position + 1, :],
                )
                next_encoded = encoder(next_state)
                next_q_values = weights @ next_encoded
                bootstrap = (
                    float(np.max(next_q_values))
                    if bool(decision_values[position + 1])
                    else float(
                        next_q_values[action_number]
                    )
                )
                target = reward + DISCOUNT * bootstrap
            error = float(np.clip(target - q_values[action_number], -0.10, 0.10))
            weights[action_number] += LEARNING_RATE * error * encoded
            if not np.isfinite(weights).all():
                raise PolicyFailure(
                    "policy.non-finite",
                    f"Seed {seed} produced non-finite Q weights",
                )
            total_reward += reward
            action_counts[action] += 1
            previous_values = current_values
            previous_action_number = action_number
        history.append(
            {
                "episode": episode + 1,
                "epsilon": float(epsilon),
                "totalReward": total_reward,
                "meanReward": total_reward / len(train_index),
                "actionCounts": action_counts,
            }
        )
    return TrainedPolicy(weights=weights, history=history)


def q_selector(
    weights: np.ndarray,
    encoder: Callable[[dict[str, float]], np.ndarray],
) -> Callable[[dict[str, float]], str]:
    def select(state: dict[str, float]) -> str:
        return ACTIONS[int(np.argmax(weights @ encoder(state)))]

    return select


def fixed_selector(action: str) -> Callable[[dict[str, float]], str]:
    if action not in ACTIONS:
        raise PolicyFailure("policy.action", "Unknown fixed action")
    return lambda _: action


def train_contextual_ridge(
    raw_states: pd.DataFrame,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    train_index: pd.Index,
    *,
    mandate: dict[str, object] | None = None,
    risk_covariance_cache: RiskCovarianceCache | None = None,
) -> dict[str, object]:
    """Fit a deterministic train-only same-pretrade contextual comparator."""

    cache = (
        risk_covariance_cache
        if risk_covariance_cache is not None
        else build_risk_covariance_cache(closes, mandate=mandate)
    )
    selector = fixed_selector("balanced")
    history: list[dict[str, object]] = []
    model: dict[str, object] | None = None
    for iteration in range(CONTEXTUAL_RIDGE_ITERATIONS):
        behavior = _training_rollout(
            selector,
            raw_states,
            action_targets,
            closes,
            train_index,
            mandate=mandate,
            risk_covariance_cache=cache,
        )
        (
            opportunity_rewards,
            behavior_oracle_hit_rate,
            behavior_mean_regret,
        ) = _training_opportunity_summary(
            behavior,
            action_targets,
            closes,
            train_index,
            mandate=mandate,
            risk_covariance_cache=cache,
        )
        raw = behavior.states.loc[
            train_index,
            list(POLICY_STATE_COLUMNS),
        ]
        mean = raw.mean()
        scale = raw.std(ddof=0).replace(0.0, 1.0)
        normalized = (raw - mean) / scale
        design = np.column_stack(
            [
                np.ones(len(normalized)),
                normalized.to_numpy(dtype=float),
            ]
        )
        gram = (
            design.T @ design
            + RIDGE_PENALTY * np.eye(design.shape[1])
        )
        coefficients: list[list[float]] = []
        for action_number, _ in enumerate(ACTIONS):
            target = opportunity_rewards[:, action_number]
            coefficients.append(
                np.linalg.solve(gram, design.T @ target).tolist()
            )
        model = {
            "method": (
                "iterative-same-pretrade-contextual-ridge-v1"
            ),
            "labelScope": "train-only",
            "anchorAction": "balanced",
            "iterations": CONTEXTUAL_RIDGE_ITERATIONS,
            "columns": list(POLICY_STATE_COLUMNS),
            "mean": mean.to_dict(),
            "scale": scale.to_dict(),
            "coefficients": coefficients,
        }
        selector = ridge_selector(model)
        improved = _training_rollout(
            selector,
            raw_states,
            action_targets,
            closes,
            train_index,
            mandate=mandate,
            risk_covariance_cache=cache,
        )
        history.append(
            {
                "iteration": iteration + 1,
                "trainingRows": len(train_index),
                "sharedPretradeActionEvaluations": (
                    len(train_index) * len(ACTIONS)
                ),
                "behaviorActionFrequency": {
                    action: float(
                        (behavior.actions == action).mean()
                    )
                    for action in ACTIONS
                },
                "improvedActionFrequency": {
                    action: float(
                        (improved.actions == action).mean()
                    )
                    for action in ACTIONS
                },
                "improvedTrainingNetSharpe": float(
                    performance_metrics(
                        improved.net_returns,
                        improved.benchmark_returns,
                    )["sharpe"]
                ),
                "behaviorOracleHitRate": behavior_oracle_hit_rate,
                "behaviorMeanRealizedRegret": behavior_mean_regret,
            }
        )
    if model is None:
        raise PolicyFailure(
            "policy.ridge",
            "Contextual ridge did not execute its fixed iterations",
        )
    model["history"] = history
    return model


def ridge_selector(model: dict[str, object]) -> Callable[[dict[str, float]], str]:
    columns = list(model["columns"])
    mean = dict(model["mean"])
    scale = dict(model["scale"])
    coefficients = np.asarray(model["coefficients"], dtype=float)

    def select(state: dict[str, float]) -> str:
        values = np.asarray(
            [
                (state[column] - float(mean[column])) / float(scale[column])
                for column in columns
            ],
            dtype=float,
        )
        encoded = np.concatenate(([1.0], values))
        return ACTIONS[int(np.argmax(coefficients @ encoded))]

    return select


def chronological_folds(index: pd.Index) -> dict[str, dict[str, pd.Index]]:
    count = len(index)
    boundaries = {
        "fold-1": (int(count * 0.50), int(count * 0.65), int(count * 0.80)),
        "fold-2": (int(count * 0.65), int(count * 0.80), count),
    }
    folds: dict[str, dict[str, pd.Index]] = {}
    for name, (train_end, validation_end, test_end) in boundaries.items():
        split = {
            "train": index[:train_end],
            "validation": index[train_end:validation_end],
            "test": index[validation_end:test_end],
        }
        if any(len(values) < MIN_SPLIT_OBSERVATIONS for values in split.values()):
            raise PolicyFailure(
                "policy.population",
                f"{name} contains a split shorter than {MIN_SPLIT_OBSERVATIONS}",
            )
        folds[name] = split
    return folds


def rollout_metrics(rollout: Rollout) -> dict[str, object]:
    index = rollout.simulation.daily.index
    action_frequency = {
        action: float((rollout.actions == action).mean())
        for action in ACTIONS
    }
    result = {
        "net": performance_metrics(
            rollout.simulation.daily["net_return"],
            rollout.simulation.daily["benchmark_return"],
        ),
        "gross": performance_metrics(
            rollout.simulation.daily["gross_return"],
            rollout.simulation.daily["benchmark_return"],
        ),
        "implementation": implementation_metrics(
            rollout.simulation,
            index,
        ),
        "execution_risk": execution_risk_metrics(
            rollout.simulation,
            index,
        ),
        "cumulative_reward": float(rollout.rewards.sum()),
        "mean_reward": float(rollout.rewards.mean()),
        "action_frequency": action_frequency,
    }
    return result
