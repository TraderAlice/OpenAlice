"""Fixed governed RL factor-policy Judge for the reference laboratory."""

from __future__ import annotations

import copy
import importlib
import json
import math
import os
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from autoquant.factor_claims import (
    FACTOR_CLAIM,
    FORWARD_RETURN_OUTCOME,
    factor_outcome,
    load_factor_claim,
)
from autoquant.factor_runtime import (
    FactorRuntimeError,
    build_factor_panel,
    evaluate_factor,
    factor_contract,
    values_to_wide,
)
from autoquant.intervals import (
    IntervalContractError,
    annualization_periods,
    load_multi_interval_asset,
    timestamp_label,
)
from autoquant.horizons import (
    RESEARCH_HORIZON,
    load_research_horizon,
)
from autoquant.mandates import (
    PORTFOLIO_MANDATE,
    load_portfolio_mandate,
)
from autoquant.prediction_modes import (
    FACTOR_POPULATION,
    PredictionModeError,
    load_factor_population,
    resolve_prediction_population,
    validate_population_mandate_compatibility,
)
from judges.portfolio_core import (
    build_risk_covariance_cache,
    constraint_audit,
    resolve_implementation_policy,
    translate_factor_scores,
)
from judges.rl_core import (
    ACTIONS,
    CONTEXTUAL_RIDGE_ITERATIONS,
    DISCOUNT,
    EPISODES,
    EPSILON_END,
    EPSILON_START,
    EXPERTS,
    FEATURE_ABS_LIMIT,
    LEARNING_RATE,
    POLICY_STATE_COLUMNS,
    RISK_AVERSION,
    SEEDS,
    PolicyFailure,
    build_action_targets,
    build_policy_state,
    build_raw_states,
    chronological_folds,
    compact_opportunity_rows,
    fixed_selector,
    one_step_action_opportunities,
    q_selector,
    ridge_selector,
    rollout_metrics,
    rollout_policy,
    training_policy_net_sharpe,
    train_contextual_ridge,
    train_q_policy,
)


REQUIRED_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")
MIN_OBSERVATIONS = 240
MAX_FEATURES = 32
FACTOR_OPPORTUNITY_POLICY = {
    "method": "actual-pretrade-one-step-governed-action-audit-v1",
    "path_propagation": "selected-policy-only",
    "oracle_role": "ex-post-audit-upper-bound",
    "selection_authority": "context-only",
    "trading_authority": "none",
}
INCREMENTAL_ATTRIBUTION_POLICY = {
    "method": "selected-baseline-full-path-active-attribution-v1",
    "comparison_path": "independent-full-rollouts",
    "baseline_selection": "validation-only-per-fold",
    "test_role": "visible-diagnostic",
    "selection_authority": "context-only",
    "trading_authority": "none",
}
LEARNING_CONTRACT = {
    "method": "fixed-after-train-only-blocked-stability-audit-v1",
    "development_selection_scope": (
        "reference-fixture-outer-train-only-70/30-blocked"
    ),
    "candidate_configurations": 5,
    "selection_order": [
        "maximize-minimum-seed-advantage-vs-contextual-ridge",
        "maximize-mean-seed-advantage-vs-contextual-ridge",
        "minimize-within-fold-seed-dispersion",
        "minimize-pairwise-action-mismatch",
    ],
    "runtime_policy": "harness-fixed-before-study-validation",
    "validation_role": "post-freeze-selection-evidence",
    "test_role": "visible-diagnostic",
    "trading_authority": "none",
}


class JudgeFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


class TrialFailures(JudgeFailure):
    def __init__(self, failures: list[dict[str, Any]]):
        self.failures = failures
        super().__init__(
            "policy.seed-failures",
            f"{len(failures)} declared fold/seed trials failed",
        )


def _write_output(value: dict[str, Any]) -> None:
    Path(os.environ["AUTOQUANT_RUN_OUTPUT"]).write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _load_contract() -> tuple[dict[str, Any], Path]:
    study = json.loads(
        Path(os.environ["AUTOQUANT_STUDY_PATH"]).read_text(encoding="utf-8")
    )
    data_root = Path(os.environ["AUTOQUANT_DATA_ROOT"]).resolve()
    if not data_root.is_dir():
        raise JudgeFailure("dataset.root", "AUTOQUANT_DATA_ROOT is not a directory")
    return study, data_root


def _load_mandate() -> dict[str, Any]:
    path = Path(os.environ["AUTOQUANT_PROJECT_ROOT"]) / PORTFOLIO_MANDATE
    try:
        return load_portfolio_mandate(path)
    except Exception as error:
        raise JudgeFailure(
            "mandate.invalid",
            f"Invalid fixed Portfolio Mandate: {error}",
        ) from error


def _load_factor_claim() -> dict[str, Any]:
    path = Path(os.environ["AUTOQUANT_PROJECT_ROOT"]) / FACTOR_CLAIM
    try:
        return load_factor_claim(path)
    except Exception as error:
        raise JudgeFailure(
            "factor-claim.invalid",
            f"Invalid fixed Factor claim: {error}",
        ) from error


def _load_factor_population() -> dict[str, Any]:
    path = Path(os.environ["AUTOQUANT_PROJECT_ROOT"]) / FACTOR_POPULATION
    try:
        return load_factor_population(path)
    except Exception as error:
        raise JudgeFailure(
            "factor-population.invalid",
            f"Invalid fixed Factor population: {error}",
        ) from error


def _load_horizon() -> dict[str, Any]:
    path = Path(os.environ["AUTOQUANT_PROJECT_ROOT"]) / RESEARCH_HORIZON
    try:
        return load_research_horizon(path)
    except Exception as error:
        raise JudgeFailure(
            "horizon.invalid",
            f"Invalid fixed Horizon Mandate: {error}",
        ) from error


def _load_asset(data_root: Path, asset: str, start: str, end: str) -> pd.DataFrame:
    try:
        multi_interval = load_multi_interval_asset(
            data_root,
            asset,
            start=start,
            end=end,
        )
    except IntervalContractError as error:
        raise JudgeFailure(error.code, str(error)) from error
    if multi_interval is not None:
        if len(multi_interval) < MIN_OBSERVATIONS:
            raise JudgeFailure(
                "dataset.observations",
                f"{asset} has fewer than {MIN_OBSERVATIONS} base observations",
            )
        return multi_interval
    source = (data_root / "ohlcv" / f"{asset}.csv").resolve()
    if data_root not in source.parents or not source.is_file():
        raise JudgeFailure("dataset.asset", f"Missing confined OHLCV file for {asset}")
    frame = pd.read_csv(source)
    if tuple(frame.columns) != REQUIRED_COLUMNS:
        raise JudgeFailure(
            "dataset.columns",
            f"{asset} columns must be exactly {', '.join(REQUIRED_COLUMNS)}",
        )
    frame["timestamp"] = pd.to_datetime(
        frame["timestamp"],
        format="%Y-%m-%d",
        errors="raise",
    )
    if (
        frame["timestamp"].duplicated().any()
        or not frame["timestamp"].is_monotonic_increasing
    ):
        raise JudgeFailure(
            "dataset.time-order",
            f"{asset} timestamps must be unique and chronological",
        )
    for column in REQUIRED_COLUMNS[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    numeric = frame[list(REQUIRED_COLUMNS[1:])].to_numpy(dtype=float)
    if not np.isfinite(numeric).all():
        raise JudgeFailure("dataset.non-finite", f"{asset} contains non-finite OHLCV")
    if (frame[["open", "high", "low", "close", "volume"]] <= 0).any().any():
        raise JudgeFailure("dataset.non-positive", f"{asset} contains non-positive OHLCV")
    if (
        (frame["high"] < frame[["open", "close"]].max(axis=1)).any()
        or (frame["low"] > frame[["open", "close"]].min(axis=1)).any()
    ):
        raise JudgeFailure("dataset.bar-shape", f"{asset} contains invalid bars")
    selected = frame[
        (frame["timestamp"] >= pd.Timestamp(start))
        & (frame["timestamp"] <= pd.Timestamp(end))
    ].copy()
    if len(selected) < MIN_OBSERVATIONS:
        raise JudgeFailure(
            "dataset.observations",
            f"{asset} has fewer than {MIN_OBSERVATIONS} observations",
        )
    return selected.reset_index(drop=True)


def _candidate_encoder(
    module: Any,
) -> tuple[list[str], Callable[[dict[str, float]], np.ndarray]]:
    raw_names = getattr(module, "FEATURE_NAMES", None)
    if (
        not isinstance(raw_names, (tuple, list))
        or not raw_names
        or len(raw_names) > MAX_FEATURES
        or any(not isinstance(name, str) or not name for name in raw_names)
        or len(set(raw_names)) != len(raw_names)
    ):
        raise JudgeFailure(
            "policy.features",
            f"FEATURE_NAMES must contain 1 to {MAX_FEATURES} unique strings",
        )
    names = list(raw_names)
    candidate = getattr(module, "encode_state", None)
    if not callable(candidate):
        raise JudgeFailure(
            "policy.api",
            "models.candidate must export callable encode_state(state)",
        )

    def encode(state: dict[str, float]) -> np.ndarray:
        before = copy.deepcopy(state)
        try:
            first = candidate(state)
            second = candidate(state)
        except Exception as error:
            raise PolicyFailure(
                "policy.encoder",
                f"encode_state raised {type(error).__name__}: {error}",
            ) from error
        if state != before:
            raise PolicyFailure(
                "policy.mutation",
                "encode_state mutated the fixed causal state",
            )
        if not isinstance(first, (tuple, list, np.ndarray)) or not isinstance(
            second,
            (tuple, list, np.ndarray),
        ):
            raise PolicyFailure(
                "policy.type",
                "encode_state must return a list, tuple, or numpy array",
            )
        try:
            first_array = np.asarray(first, dtype=float)
            second_array = np.asarray(second, dtype=float)
        except (TypeError, ValueError) as error:
            raise PolicyFailure(
                "policy.numeric",
                f"Encoded features must be numeric: {error}",
            ) from error
        if first_array.shape != (len(names),) or second_array.shape != (
            len(names),
        ):
            raise PolicyFailure(
                "policy.alignment",
                "Encoded vector length must exactly match FEATURE_NAMES",
            )
        if (
            not np.isfinite(first_array).all()
            or not np.isfinite(second_array).all()
        ):
            raise PolicyFailure(
                "policy.non-finite",
                "Encoded state contains a non-finite feature",
            )
        if (
            np.abs(first_array).max() > FEATURE_ABS_LIMIT
            or np.abs(second_array).max() > FEATURE_ABS_LIMIT
        ):
            raise PolicyFailure(
                "policy.bounds",
                f"Encoded features must be within ±{FEATURE_ABS_LIMIT:g}",
            )
        if not np.array_equal(first_array, second_array):
            raise PolicyFailure(
                "policy.nondeterministic",
                "encode_state returned different values for one fixed state",
            )
        return first_array

    return names, encode


def _panels(
    study: dict[str, Any],
    data_root: Path,
) -> tuple[dict[str, pd.DataFrame], pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    dataset = study["dataset"]
    time_range = dataset["time_range"]
    frames: dict[str, pd.DataFrame] = {}
    opens: dict[str, pd.Series] = {}
    closes: dict[str, pd.Series] = {}
    volumes: dict[str, pd.Series] = {}
    for asset in dataset["universe"]:
        frame = _load_asset(
            data_root,
            asset,
            time_range["start"],
            time_range["end"],
        )
        frames[asset] = frame
        index = pd.DatetimeIndex(frame["timestamp"])
        for target, column in (
            (opens, "open"),
            (closes, "close"),
            (volumes, "volume"),
        ):
            values = frame[column].astype(float)
            values.index = index
            target[asset] = values
    return frames, pd.DataFrame(opens), pd.DataFrame(closes), pd.DataFrame(volumes)


def _factor_panels(
    opens: pd.DataFrame,
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    candidate: pd.DataFrame,
) -> dict[str, pd.DataFrame]:
    return {
        "candidate": candidate,
        "activity": np.log(
            volumes
            / volumes.rolling(20, min_periods=20).mean()
        ),
        "intraday": closes / opens - 1.0,
        "reversal": -closes.pct_change(fill_method=None),
    }


def _fixed_baselines(
    raw_states: pd.DataFrame,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    split: dict[str, pd.Index],
    mandate: dict[str, Any],
    risk_covariance_cache,
) -> tuple[dict[str, Any], dict[str, Any], str, dict[str, Any]]:
    fixed: dict[str, Any] = {}
    fixed_rollouts: dict[str, dict[str, Any]] = {}
    training_scores: dict[str, float] = {}
    for action in ACTIONS:
        training_scores[action] = training_policy_net_sharpe(
            fixed_selector(action),
            raw_states,
            action_targets,
            closes,
            split["train"],
            mandate=mandate,
            risk_covariance_cache=risk_covariance_cache,
        )
        fixed_rollouts[action] = {
            name: rollout_policy(
                    fixed_selector(action),
                    raw_states,
                    action_targets,
                    closes,
                    volumes,
                    index,
                    mandate=mandate,
                    risk_covariance_cache=risk_covariance_cache,
                )
            for name, index in (
                ("validation", split["validation"]),
                ("test", split["test"]),
            )
        }
        fixed[action] = {
            name: rollout_metrics(rollout)
            for name, rollout in fixed_rollouts[action].items()
        }
    selected_action = max(training_scores, key=training_scores.__getitem__)
    ridge_model = train_contextual_ridge(
        raw_states,
        action_targets,
        closes,
        volumes,
        split["train"],
        mandate=mandate,
        risk_covariance_cache=risk_covariance_cache,
    )
    ridge_rollouts = {
        name: rollout_policy(
                ridge_selector(ridge_model),
                raw_states,
                action_targets,
                closes,
                volumes,
                index,
                mandate=mandate,
                risk_covariance_cache=risk_covariance_cache,
            )
        for name, index in (
            ("validation", split["validation"]),
            ("test", split["test"]),
        )
    }
    ridge = {
        name: rollout_metrics(rollout)
        for name, rollout in ridge_rollouts.items()
    }
    result = {
        "fixed_factor_or_blend": fixed,
        "best_training_expert": {
            "selected": selected_action,
            "training_net_sharpe": training_scores,
            "validation": fixed[selected_action]["validation"],
            "test": fixed[selected_action]["test"],
        },
        "contextual_ridge": ridge,
    }
    validation_candidates = {
        **{
            f"fixed:{action}": float(metrics["validation"]["net"]["sharpe"])
            for action, metrics in fixed.items()
        },
        "best-training-expert": float(
            result["best_training_expert"]["validation"]["net"]["sharpe"]
        ),
        "contextual-ridge": float(ridge["validation"]["net"]["sharpe"]),
    }
    best_name = max(validation_candidates, key=validation_candidates.__getitem__)
    if best_name.startswith("fixed:"):
        selected_rollouts = fixed_rollouts[best_name.split(":", 1)[1]]
    elif best_name == "best-training-expert":
        selected_rollouts = fixed_rollouts[selected_action]
    else:
        selected_rollouts = ridge_rollouts
    return result, ridge_model, best_name, selected_rollouts


def _baseline_split(
    baselines: dict[str, Any],
    name: str,
    split: str,
) -> dict[str, Any]:
    if name.startswith("fixed:"):
        return baselines["fixed_factor_or_blend"][name.split(":", 1)[1]][split]
    if name == "best-training-expert":
        return baselines["best_training_expert"][split]
    return baselines["contextual_ridge"][split]


def _rollout_action_rows(
    fold: str,
    seed: int,
    split: str,
    rollout,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for timestamp in rollout.actions.index:
        daily = rollout.simulation.daily.loc[timestamp]
        rows.append(
            {
                "fold": fold,
                "seed": seed,
                "split": split,
                "timestamp": timestamp_label(timestamp),
                "action": rollout.actions.loc[timestamp],
                "decision_eligible": bool(
                    daily["decision_eligible"]
                ),
                "decision_schedule_kind": str(
                    daily["decision_schedule_kind"]
                ),
                "decision_every_bars": daily["decision_every_bars"],
                "decision_anchor": daily["decision_anchor"],
                "decision_session": str(daily["decision_session"]),
                "reward": float(daily["reward"]),
                "gross_return": float(daily["gross_return"]),
                "net_return": float(daily["net_return"]),
                "one_way_turnover": float(daily["one_way_turnover"]),
                "cost": float(daily["cost"]),
                "execution_risk_status": str(
                    daily["execution_risk_status"]
                ),
                "execution_risk_forecast_available": bool(
                    daily["execution_risk_forecast_available"]
                ),
                "execution_risk_observations": int(
                    daily["execution_risk_observations"]
                ),
                "pretrade_risk_forecast_annualized": float(
                    daily["pretrade_risk_forecast_annualized"]
                ),
                "executed_risk_forecast_annualized": float(
                    daily["executed_risk_forecast_annualized"]
                ),
                "execution_risk_ceiling_annualized": float(
                    daily["execution_risk_ceiling_annualized"]
                ),
                "risk_rebalance_override": bool(
                    daily["risk_rebalance_override"]
                ),
                "execution_reason": str(daily["execution_reason"]),
                "gross_exposure": float(daily["gross_exposure"]),
                "proposed_one_way_turnover": float(
                    daily["proposed_one_way_turnover"]
                ),
                "constraint_rebalance_override": bool(
                    daily["constraint_rebalance_override"]
                ),
                "constraint_repair_one_way": float(
                    daily["constraint_repair_one_way"]
                ),
                "executed_constraint_maximum_error": float(
                    daily["executed_constraint_maximum_error"]
                ),
            }
        )
    return rows


def _rollout_rationale_rows(
    fold: str,
    seed: int,
    split: str,
    rollout,
    encoder: Callable[[dict[str, float]], np.ndarray],
    feature_names: list[str],
    weights: np.ndarray,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    previous_action = "balanced"
    for timestamp in rollout.actions.index:
        daily = rollout.simulation.daily.loc[timestamp]
        decision_eligible = bool(daily["decision_eligible"])
        state = {
            field: float(rollout.states.loc[timestamp, field])
            for field in POLICY_STATE_COLUMNS
        }
        if not math.isclose(
            state[f"previous_{previous_action}"],
            1.0,
            rel_tol=0.0,
            abs_tol=1e-12,
        ):
            raise JudgeFailure(
                "policy.rationale-state",
                "Rollout state previous action does not reconcile",
            )
        encoded = encoder(state)
        q_values = weights @ encoded
        ranked = sorted(
            range(len(ACTIONS)),
            key=lambda index: (-float(q_values[index]), index),
        )
        actual_action = str(rollout.actions.loc[timestamp])
        if decision_eligible:
            selected_index, runner_up_index = ranked[:2]
            selection_reason = "q-argmax"
        else:
            selected_index = ACTIONS.index(actual_action)
            runner_up_index = next(
                index
                for index in ranked
                if index != selected_index
            )
            selection_reason = "decision-schedule-hold"
        selected_action = ACTIONS[selected_index]
        runner_up_action = ACTIONS[runner_up_index]
        if selected_action != actual_action:
            raise JudgeFailure(
                "policy.rationale-action",
                "Rationale availability differs from the policy rollout",
            )
        contributions = (
            weights[selected_index] - weights[runner_up_index]
        ) * encoded
        margin = float(
            q_values[selected_index] - q_values[runner_up_index]
        )
        if not math.isclose(
            float(contributions.sum()),
            margin,
            rel_tol=0.0,
            abs_tol=1e-10,
        ):
            raise JudgeFailure(
                "policy.rationale-contribution",
                "Feature contributions do not reproduce the Q margin",
            )
        dominant_index = max(
            range(len(feature_names)),
            key=lambda index: (abs(float(contributions[index])), -index),
        )
        row = {
            "fold": fold,
            "seed": seed,
            "split": split,
            "timestamp": timestamp_label(timestamp),
            "decisionEligible": decision_eligible,
            "decisionSchedule": (
                {"kind": "calendar-month-end"}
                if daily["decision_schedule_kind"]
                == "calendar-month-end"
                else {
                    "kind": "every-bars",
                    "bars": int(daily["decision_every_bars"]),
                    "anchor": str(daily["decision_anchor"]),
                }
            ),
            "decisionSession": str(daily["decision_session"]),
            "selectionReason": selection_reason,
            "previousAction": previous_action,
            "selectedAction": selected_action,
            "runnerUpAction": runner_up_action,
            "rawState": {
                field: float(state[field])
                for field in POLICY_STATE_COLUMNS
            },
            "encodedFeatures": {
                name: float(encoded[index])
                for index, name in enumerate(feature_names)
            },
            "qValues": {
                action: float(q_values[index])
                for index, action in enumerate(ACTIONS)
            },
            "actionMargin": margin,
            "tieForBest": abs(margin) <= 1e-12,
            "marginContributions": {
                name: float(contributions[index])
                for index, name in enumerate(feature_names)
            },
            "dominantMarginFeature": feature_names[dominant_index],
            "dominantMarginContribution": float(
                contributions[dominant_index]
            ),
        }
        numeric = [
            *row["rawState"].values(),
            *row["encodedFeatures"].values(),
            *row["qValues"].values(),
            row["actionMargin"],
            *row["marginContributions"].values(),
            row["dominantMarginContribution"],
        ]
        if not all(math.isfinite(float(value)) for value in numeric):
            raise JudgeFailure(
                "policy.rationale-non-finite",
                "Policy rationale contains non-finite evidence",
            )
        rows.append(row)
        previous_action = selected_action
    return rows


def _rollout_opportunity_rows(
    fold: str,
    seed: int,
    split: str,
    rollout,
    action_targets: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
    mandate: dict[str, Any],
    risk_covariance_cache,
) -> list[dict[str, Any]]:
    rows = one_step_action_opportunities(
        rollout,
        action_targets,
        closes,
        volumes,
        rollout.actions.index,
        mandate=mandate,
        risk_covariance_cache=risk_covariance_cache,
    )
    return [
        {
            **row,
            "fold": fold,
            "seed": seed,
            "split": split,
            "timestamp": timestamp_label(row["timestamp"]),
        }
        for row in rows
    ]


def _rollout_incremental_rows(
    fold: str,
    seed: int,
    split: str,
    baseline_name: str,
    policy_rollout,
    baseline_rollout,
    raw_states: pd.DataFrame,
    closes: pd.DataFrame,
    volatility_threshold: float,
) -> list[dict[str, Any]]:
    index = policy_rollout.actions.index
    if (
        not baseline_rollout.actions.index.equals(index)
        or not policy_rollout.simulation.daily.index.equals(index)
        or not baseline_rollout.simulation.daily.index.equals(index)
        or not policy_rollout.simulation.weights.index.equals(index)
        or not baseline_rollout.simulation.weights.index.equals(index)
    ):
        raise JudgeFailure(
            "policy.incremental-identity",
            "Policy and selected baseline paths do not share one chronology",
        )
    forward_returns = closes.shift(-1) / closes - 1.0
    rows: list[dict[str, Any]] = []
    previous_policy_action: str | None = None
    previous_baseline_action: str | None = None
    for timestamp in index:
        policy_daily = policy_rollout.simulation.daily.loc[timestamp]
        baseline_daily = baseline_rollout.simulation.daily.loc[timestamp]
        policy_action = str(policy_rollout.actions.loc[timestamp])
        baseline_action = str(baseline_rollout.actions.loc[timestamp])
        forward = forward_returns.loc[timestamp].fillna(0.0)
        contribution = (
            policy_rollout.simulation.weights.loc[timestamp]
            - baseline_rollout.simulation.weights.loc[timestamp]
        ) * forward
        gross_delta = float(
            policy_daily["gross_return"] - baseline_daily["gross_return"]
        )
        incremental_cost = float(
            policy_daily["cost"] - baseline_daily["cost"]
        )
        net_delta = float(
            policy_daily["net_return"] - baseline_daily["net_return"]
        )
        contribution_error = abs(float(contribution.sum()) - gross_delta)
        identity_error = abs(gross_delta - incremental_cost - net_delta)
        if max(contribution_error, identity_error) > 1e-12:
            raise JudgeFailure(
                "policy.incremental-reconciliation",
                "Incremental portfolio attribution does not reconcile",
            )
        raw = raw_states.loc[timestamp]
        volume_value = float(raw["volume_regime"])
        trend_value = float(raw["market_return_5"])
        volatility_value = float(raw["market_volatility_20"])
        row = {
            "fold": fold,
            "seed": seed,
            "split": split,
            "timestamp": timestamp_label(timestamp),
            "baselineName": baseline_name,
            "policyAction": policy_action,
            "baselineAction": baseline_action,
            "policySwitched": (
                previous_policy_action is not None
                and policy_action != previous_policy_action
            ),
            "baselineSwitched": (
                previous_baseline_action is not None
                and baseline_action != previous_baseline_action
            ),
            "actionsDiffer": policy_action != baseline_action,
            "volumeRegimeValue": volume_value,
            "marketReturn5": trend_value,
            "marketVolatility20": volatility_value,
            "volumeRegime": (
                "below-trend" if volume_value < 0.0 else "above-trend"
            ),
            "marketTrend": (
                "negative" if trend_value < 0.0 else "nonnegative"
            ),
            "volatilityRegime": (
                "low"
                if volatility_value < volatility_threshold
                else "high"
            ),
            "policyGrossReturn": float(policy_daily["gross_return"]),
            "baselineGrossReturn": float(baseline_daily["gross_return"]),
            "grossActiveReturn": gross_delta,
            "policyNetReturn": float(policy_daily["net_return"]),
            "baselineNetReturn": float(baseline_daily["net_return"]),
            "incrementalCost": incremental_cost,
            "netActiveReturn": net_delta,
            "policyReward": float(policy_daily["reward"]),
            "baselineReward": float(baseline_daily["reward"]),
            "rewardDelta": float(
                policy_daily["reward"] - baseline_daily["reward"]
            ),
            "policyOneWayTurnover": float(
                policy_daily["one_way_turnover"]
            ),
            "baselineOneWayTurnover": float(
                baseline_daily["one_way_turnover"]
            ),
            "oneWayTurnoverDelta": float(
                policy_daily["one_way_turnover"]
                - baseline_daily["one_way_turnover"]
            ),
            "assetGrossContribution": {
                asset: float(contribution[asset])
                for asset in closes.columns
            },
        }
        numeric = [
            value
            for key, value in row.items()
            if isinstance(value, (int, float))
            and not isinstance(value, bool)
            and key != "seed"
        ]
        if not all(math.isfinite(float(value)) for value in numeric):
            raise JudgeFailure(
                "policy.incremental-non-finite",
                "Incremental attribution contains non-finite values",
            )
        rows.append(row)
        previous_policy_action = policy_action
        previous_baseline_action = baseline_action
    return rows


def _relative_path_statistics(
    rows: list[dict[str, Any]],
) -> dict[str, float]:
    active = np.asarray(
        [float(row["netActiveReturn"]) for row in rows],
        dtype=float,
    )
    policy = np.asarray(
        [float(row["policyNetReturn"]) for row in rows],
        dtype=float,
    )
    baseline = np.asarray(
        [float(row["baselineNetReturn"]) for row in rows],
        dtype=float,
    )
    periods = annualization_periods(
        pd.to_datetime([row["timestamp"] for row in rows])
    )
    annualized_active_return = float(active.mean() * periods)
    tracking_error = float(active.std(ddof=0) * math.sqrt(periods))
    relative_path = np.cumprod((1.0 + policy) / (1.0 + baseline))
    running_peak = np.maximum.accumulate(
        np.maximum(relative_path, 1.0)
    )
    relative_drawdown = relative_path / running_peak - 1.0
    return {
        "annualized_active_return": annualized_active_return,
        "annualized_tracking_error": tracking_error,
        "information_ratio": (
            annualized_active_return / tracking_error
            if tracking_error > 1e-15
            else 0.0
        ),
        "relative_total_return": float(relative_path[-1] - 1.0),
        "relative_maximum_drawdown": float(relative_drawdown.min()),
    }


def _incremental_bucket(
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    net = [float(row["netActiveReturn"]) for row in rows]
    active = [value for value in net if abs(value) > 1e-12]
    return {
        "decisions": len(rows),
        "active_decisions": len(active),
        "active_decision_rate": len(active) / len(rows),
        "mean_gross_active_return": float(
            np.mean([row["grossActiveReturn"] for row in rows])
        ),
        "total_gross_active_return": float(
            sum(row["grossActiveReturn"] for row in rows)
        ),
        "total_incremental_cost": float(
            sum(row["incrementalCost"] for row in rows)
        ),
        "mean_net_active_return": float(np.mean(net)),
        "total_net_active_return": float(sum(net)),
        "active_win_rate": float(np.mean([value > 0.0 for value in net])),
        "conditional_active_win_rate": (
            float(np.mean([value > 0.0 for value in active]))
            if active
            else 0.0
        ),
    }


def _incremental_attribution_metrics(
    rows: list[dict[str, Any]],
    split: str,
    assets: list[str],
) -> dict[str, Any]:
    selected = [row for row in rows if row["split"] == split]
    if not selected:
        raise JudgeFailure(
            "policy.incremental-coverage",
            "Incremental attribution split has no decisions",
        )
    groups: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for row in selected:
        groups.setdefault((row["fold"], int(row["seed"])), []).append(row)
    base = _incremental_bucket(selected)
    net = [float(row["netActiveReturn"]) for row in selected]
    path_stats = [_relative_path_statistics(group) for group in groups.values()]
    by_asset = {
        asset: {
            "total_gross_active_contribution": float(
                sum(row["assetGrossContribution"][asset] for row in selected)
            ),
            "mean_trial_total_gross_active_contribution": float(
                sum(row["assetGrossContribution"][asset] for row in selected)
                / len(groups)
            ),
            "mean_gross_active_contribution": float(
                np.mean(
                    [
                        row["assetGrossContribution"][asset]
                        for row in selected
                    ]
                )
            ),
        }
        for asset in assets
    }
    regime_fields = {
        "volume": "volumeRegime",
        "trend": "marketTrend",
        "volatility": "volatilityRegime",
    }
    by_regime: dict[str, dict[str, Any]] = {}
    regime_counts: dict[str, int] = {}
    for dimension, field in regime_fields.items():
        buckets = sorted({str(row[field]) for row in selected})
        regime_counts[dimension] = 0
        for bucket in buckets:
            group = [row for row in selected if row[field] == bucket]
            by_regime[f"{dimension}:{bucket}"] = {
                "dimension": dimension,
                "bucket": bucket,
                **_incremental_bucket(group),
            }
            regime_counts[dimension] += len(group)
    by_action_pair: dict[str, dict[str, Any]] = {}
    for policy_action, baseline_action in sorted(
        {
            (str(row["policyAction"]), str(row["baselineAction"]))
            for row in selected
        }
    ):
        group = [
            row
            for row in selected
            if row["policyAction"] == policy_action
            and row["baselineAction"] == baseline_action
        ]
        by_action_pair[f"{policy_action}->{baseline_action}"] = {
            "policy_action": policy_action,
            "baseline_action": baseline_action,
            **_incremental_bucket(group),
        }
    by_switch_state: dict[str, dict[str, Any]] = {}
    for policy_switched in (False, True):
        for baseline_switched in (False, True):
            group = [
                row
                for row in selected
                if bool(row["policySwitched"]) == policy_switched
                and bool(row["baselineSwitched"]) == baseline_switched
            ]
            if not group:
                continue
            key = (
                ("policy-switch" if policy_switched else "policy-hold")
                + "/"
                + (
                    "baseline-switch"
                    if baseline_switched
                    else "baseline-hold"
                )
            )
            by_switch_state[key] = {
                "policy_switched": policy_switched,
                "baseline_switched": baseline_switched,
                **_incremental_bucket(group),
            }
    trial_metrics = []
    for (fold, seed), group in groups.items():
        trial_metrics.append(
            {
                "fold": fold,
                "seed": seed,
                "baseline_name": str(group[0]["baselineName"]),
                "observations": len(group),
                **_incremental_bucket(group),
                **_relative_path_statistics(group),
            }
        )
    reconciliation = {
        "row_count": len(selected),
        "trial_path_count": len(groups),
        "gross_cost_net_error": max(
            abs(
                float(row["grossActiveReturn"])
                - float(row["incrementalCost"])
                - float(row["netActiveReturn"])
            )
            for row in selected
        ),
        "asset_gross_error": max(
            abs(
                sum(row["assetGrossContribution"].values())
                - float(row["grossActiveReturn"])
            )
            for row in selected
        ),
        "asset_total_error": abs(
            sum(
                value["total_gross_active_contribution"]
                for value in by_asset.values()
            )
            - base["total_gross_active_return"]
        ),
        "action_pair_count_error": abs(
            sum(value["decisions"] for value in by_action_pair.values())
            - len(selected)
        ),
        "switch_state_count_error": abs(
            sum(value["decisions"] for value in by_switch_state.values())
            - len(selected)
        ),
        "regime_count_error": max(
            abs(count - len(selected)) for count in regime_counts.values()
        ),
    }
    reconciliation["passed"] = (
        max(
            float(value)
            for key, value in reconciliation.items()
            if key not in {"row_count", "trial_path_count"}
        )
        <= 1e-10
    )
    return {
        "status": "available",
        "decisions": len(selected),
        "trial_paths": len(groups),
        **base,
        "mean_trial_total_gross_active_return": float(
            np.mean(
                [
                    item["total_gross_active_return"]
                    for item in trial_metrics
                ]
            )
        ),
        "mean_trial_total_incremental_cost": float(
            np.mean(
                [item["total_incremental_cost"] for item in trial_metrics]
            )
        ),
        "mean_trial_total_net_active_return": float(
            np.mean(
                [item["total_net_active_return"] for item in trial_metrics]
            )
        ),
        "annualized_active_return": float(
            np.mean(
                [item["annualized_active_return"] for item in path_stats]
            )
        ),
        "annualized_tracking_error": float(
            np.mean(
                [item["annualized_tracking_error"] for item in path_stats]
            )
        ),
        "information_ratio": float(
            np.mean([item["information_ratio"] for item in path_stats])
        ),
        "relative_total_return": float(
            np.mean([item["relative_total_return"] for item in path_stats])
        ),
        "relative_maximum_drawdown": float(
            np.mean(
                [item["relative_maximum_drawdown"] for item in path_stats]
            )
        ),
        "p05_net_active_return": _linear_percentile(net, 0.05),
        "median_net_active_return": float(np.median(net)),
        "p95_net_active_return": _linear_percentile(net, 0.95),
        "worst_net_active_return": float(min(net)),
        "best_net_active_return": float(max(net)),
        "actions_differ_rate": float(
            np.mean([row["actionsDiffer"] for row in selected])
        ),
        "policy_switch_rate": float(
            np.mean([row["policySwitched"] for row in selected])
        ),
        "baseline_switch_rate": float(
            np.mean([row["baselineSwitched"] for row in selected])
        ),
        "by_asset": by_asset,
        "by_regime": by_regime,
        "by_action_pair": by_action_pair,
        "by_switch_state": by_switch_state,
        "trials": trial_metrics,
        "reconciliation": reconciliation,
    }


def _linear_percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(float(value) for value in values)
    position = (len(ordered) - 1) * percentile
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def _factor_opportunity_metrics(
    rows: list[dict[str, Any]],
    split: str,
) -> dict[str, Any]:
    selected = [row for row in rows if row["split"] == split]
    if not selected:
        raise JudgeFailure(
            "policy.opportunity-coverage",
            "Factor opportunity split has no decisions",
        )
    groups: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for row in selected:
        groups.setdefault((row["fold"], int(row["seed"])), []).append(row)
    decisions = len(selected)
    regrets = [float(row["realizedRegret"]) for row in selected]
    selected_rewards = [float(row["selectedReward"]) for row in selected]
    oracle_rewards = [float(row["oracleReward"]) for row in selected]
    selected_ranks = [int(row["selectedRank"]) for row in selected]
    oracle_hits = sum(bool(row["oracleHit"]) for row in selected)
    by_action: dict[str, dict[str, Any]] = {}
    for action in ACTIONS:
        selected_count = sum(
            row["selectedAction"] == action for row in selected
        )
        oracle_count = sum(row["oracleAction"] == action for row in selected)
        evidence = [row["actions"][action] for row in selected]
        by_action[action] = {
            "selected_decisions": selected_count,
            "selected_frequency": selected_count / decisions,
            "oracle_decisions": oracle_count,
            "oracle_frequency": oracle_count / decisions,
            "mean_local_reward": float(
                np.mean([item["reward"] for item in evidence])
            ),
            "mean_one_way_turnover": float(
                np.mean([item["oneWayTurnover"] for item in evidence])
            ),
            "total_cost": float(sum(item["cost"] for item in evidence)),
            "risk_repair_rate": float(
                np.mean([item["riskRebalanceOverride"] for item in evidence])
            ),
        }
    candidate_oracle = [
        row for row in selected if row["oracleAction"] == "candidate"
    ]
    candidate_missed = [
        row
        for row in candidate_oracle
        if row["selectedAction"] != "candidate"
    ]
    candidate_captured = len(candidate_oracle) - len(candidate_missed)
    candidate_vs_selected = [
        float(row["candidateMinusSelectedReward"]) for row in selected
    ]
    candidate_vs_balanced = [
        float(row["candidateMinusBalancedReward"]) for row in selected
    ]
    trials = []
    for (fold, seed), group in groups.items():
        group_candidate_oracle = sum(
            row["oracleAction"] == "candidate" for row in group
        )
        group_candidate_missed = sum(
            row["oracleAction"] == "candidate"
            and row["selectedAction"] != "candidate"
            for row in group
        )
        trials.append(
            {
                "fold": fold,
                "seed": seed,
                "decisions": len(group),
                "oracle_hits": sum(row["oracleHit"] for row in group),
                "oracle_hit_rate": float(
                    np.mean([row["oracleHit"] for row in group])
                ),
                "mean_selected_rank": float(
                    np.mean([row["selectedRank"] for row in group])
                ),
                "mean_realized_regret": float(
                    np.mean([row["realizedRegret"] for row in group])
                ),
                "candidate_oracle_rate": (
                    group_candidate_oracle / len(group)
                ),
                "candidate_missed_opportunity_rate": (
                    group_candidate_missed / len(group)
                ),
            }
        )
    reconciliation = {
        "decision_rows": decisions,
        "action_evaluations": sum(
            len(row["actions"]) for row in selected
        ),
        "action_evaluation_count_error": abs(
            sum(len(row["actions"]) for row in selected)
            - decisions * len(ACTIONS)
        ),
        "selected_frequency_error": abs(
            sum(item["selected_frequency"] for item in by_action.values())
            - 1.0
        ),
        "oracle_frequency_error": abs(
            sum(item["oracle_frequency"] for item in by_action.values())
            - 1.0
        ),
        "regret_identity_error": max(
            abs(
                float(row["oracleReward"])
                - float(row["selectedReward"])
                - float(row["realizedRegret"])
            )
            for row in selected
        ),
        "candidate_selected_delta_error": max(
            abs(
                float(row["actions"]["candidate"]["reward"])
                - float(row["selectedReward"])
                - float(row["candidateMinusSelectedReward"])
            )
            for row in selected
        ),
        "candidate_balanced_delta_error": max(
            abs(
                float(row["actions"]["candidate"]["reward"])
                - float(row["actions"]["balanced"]["reward"])
                - float(row["candidateMinusBalancedReward"])
            )
            for row in selected
        ),
        "negative_regret_error": max(
            max(0.0, -float(row["realizedRegret"]))
            for row in selected
        ),
        "selected_action_reconciliation_error": 0.0,
    }
    reconciliation["passed"] = (
        reconciliation["action_evaluations"]
        == decisions * len(ACTIONS)
        and max(
            float(value)
            for key, value in reconciliation.items()
            if key
            not in {
                "decision_rows",
                "action_evaluations",
            }
        )
        <= 1e-10
    )
    return {
        "status": "available",
        "decisions": decisions,
        "trial_paths": len(groups),
        "oracle_hit_decisions": oracle_hits,
        "oracle_hit_rate": oracle_hits / decisions,
        "mean_selected_rank": float(np.mean(selected_ranks)),
        "mean_selected_reward": float(np.mean(selected_rewards)),
        "mean_oracle_reward": float(np.mean(oracle_rewards)),
        "total_realized_regret": float(sum(regrets)),
        "mean_realized_regret": float(np.mean(regrets)),
        "median_realized_regret": float(np.median(regrets)),
        "p90_realized_regret": _linear_percentile(regrets, 0.90),
        "maximum_realized_regret": float(max(regrets)),
        "positive_regret_rate": float(
            np.mean([regret > 1e-12 for regret in regrets])
        ),
        "by_action": by_action,
        "candidate": {
            "selected_decisions": by_action["candidate"][
                "selected_decisions"
            ],
            "selected_frequency": by_action["candidate"][
                "selected_frequency"
            ],
            "oracle_decisions": len(candidate_oracle),
            "oracle_frequency": len(candidate_oracle) / decisions,
            "captured_oracle_decisions": candidate_captured,
            "oracle_capture_rate": (
                candidate_captured / len(candidate_oracle)
                if candidate_oracle
                else 0.0
            ),
            "missed_opportunity_decisions": len(candidate_missed),
            "missed_opportunity_rate": len(candidate_missed) / decisions,
            "mean_reward": by_action["candidate"]["mean_local_reward"],
            "mean_vs_selected_reward": float(
                np.mean(candidate_vs_selected)
            ),
            "mean_vs_balanced_reward": float(
                np.mean(candidate_vs_balanced)
            ),
            "win_rate_vs_balanced": float(
                np.mean([value > 1e-12 for value in candidate_vs_balanced])
            ),
        },
        "trials": trials,
        "reconciliation": reconciliation,
    }


def _policy_behavior_metrics(
    rationale_rows: list[dict[str, Any]],
    action_rows: list[dict[str, Any]],
    split: str,
    feature_names: list[str],
) -> dict[str, Any]:
    selected_rationales = [
        row for row in rationale_rows if row["split"] == split
    ]
    selected_actions = [
        row for row in action_rows if row["split"] == split
    ]
    action_by_key = {
        (
            row["fold"],
            int(row["seed"]),
            row["split"],
            row["timestamp"],
        ): row
        for row in selected_actions
    }
    if (
        not selected_rationales
        or len(action_by_key) != len(selected_actions)
        or len(selected_rationales) != len(selected_actions)
    ):
        raise JudgeFailure(
            "policy.rationale-coverage",
            "Policy rationale and action coverage differ",
        )
    groups: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for row in selected_rationales:
        key = (row["fold"], int(row["seed"]))
        groups.setdefault(key, []).append(row)
        action = action_by_key.get(
            (
                row["fold"],
                int(row["seed"]),
                row["split"],
                row["timestamp"],
            )
        )
        if action is None or action["action"] != row["selectedAction"]:
            raise JudgeFailure(
                "policy.rationale-action",
                "Policy rationale differs from the action ledger",
            )

    run_lengths: list[int] = []
    runs_by_action = {action: [] for action in ACTIONS}
    transitions = 0
    comparable_decisions = 0
    trial_metrics: list[dict[str, Any]] = []
    for (fold, seed), rows in groups.items():
        lengths: list[int] = []
        current_action = rows[0]["selectedAction"]
        current_length = 0
        trial_transitions = 0
        for row in rows:
            if row["selectedAction"] != current_action:
                lengths.append(current_length)
                runs_by_action[current_action].append(current_length)
                current_action = row["selectedAction"]
                current_length = 0
                trial_transitions += 1
            current_length += 1
        lengths.append(current_length)
        runs_by_action[current_action].append(current_length)
        run_lengths.extend(lengths)
        transitions += trial_transitions
        comparable_decisions += max(0, len(rows) - 1)
        margins = [float(row["actionMargin"]) for row in rows]
        trial_metrics.append(
            {
                "fold": fold,
                "seed": seed,
                "decisions": len(rows),
                "action_runs": len(lengths),
                "transitions": trial_transitions,
                "transition_rate": (
                    trial_transitions / (len(rows) - 1)
                    if len(rows) > 1
                    else 0.0
                ),
                "mean_action_run_length": float(np.mean(lengths)),
                "mean_action_margin": float(np.mean(margins)),
                "tie_rate": float(
                    np.mean([row["tieForBest"] for row in rows])
                ),
            }
        )

    decisions = len(selected_rationales)
    margins = [
        float(row["actionMargin"]) for row in selected_rationales
    ]
    by_action: dict[str, dict[str, Any]] = {}
    for action_name in ACTIONS:
        rationale_group = [
            row
            for row in selected_rationales
            if row["selectedAction"] == action_name
        ]
        action_group = [
            action_by_key[
                (
                    row["fold"],
                    int(row["seed"]),
                    row["split"],
                    row["timestamp"],
                )
            ]
            for row in rationale_group
        ]
        action_runs = runs_by_action[action_name]
        by_action[action_name] = {
            "decisions": len(rationale_group),
            "frequency": len(rationale_group) / decisions,
            "action_runs": len(action_runs),
            "mean_action_run_length": (
                float(np.mean(action_runs)) if action_runs else 0.0
            ),
            "mean_action_margin": (
                float(
                    np.mean(
                        [row["actionMargin"] for row in rationale_group]
                    )
                )
                if rationale_group
                else 0.0
            ),
            "mean_reward": (
                float(np.mean([row["reward"] for row in action_group]))
                if action_group
                else 0.0
            ),
            "mean_net_return": (
                float(
                    np.mean([row["net_return"] for row in action_group])
                )
                if action_group
                else 0.0
            ),
            "mean_one_way_turnover": (
                float(
                    np.mean(
                        [row["one_way_turnover"] for row in action_group]
                    )
                )
                if action_group
                else 0.0
            ),
            "total_cost": float(
                sum(row["cost"] for row in action_group)
            ),
        }
    by_feature: dict[str, dict[str, Any]] = {}
    for feature_name in feature_names:
        contributions = [
            float(row["marginContributions"][feature_name])
            for row in selected_rationales
        ]
        dominant = sum(
            row["dominantMarginFeature"] == feature_name
            for row in selected_rationales
        )
        by_feature[feature_name] = {
            "dominant_decisions": dominant,
            "dominant_rate": dominant / decisions,
            "mean_signed_margin_contribution": float(
                np.mean(contributions)
            ),
            "mean_absolute_margin_contribution": float(
                np.mean(np.abs(contributions))
            ),
        }
    total_reward = float(sum(row["reward"] for row in selected_actions))
    total_net_return = float(
        sum(row["net_return"] for row in selected_actions)
    )
    total_cost = float(sum(row["cost"] for row in selected_actions))
    mean_turnover = float(
        np.mean([row["one_way_turnover"] for row in selected_actions])
    )
    reconciliation = {
        "rationale_rows": len(selected_rationales),
        "action_rows": len(selected_actions),
        "decision_count_error": abs(
            sum(item["decisions"] for item in by_action.values())
            - decisions
        ),
        "frequency_error": abs(
            sum(item["frequency"] for item in by_action.values()) - 1.0
        ),
        "reward_error": abs(
            sum(
                item["mean_reward"] * item["decisions"]
                for item in by_action.values()
            )
            - total_reward
        ),
        "net_return_error": abs(
            sum(
                item["mean_net_return"] * item["decisions"]
                for item in by_action.values()
            )
            - total_net_return
        ),
        "turnover_error": abs(
            sum(
                item["mean_one_way_turnover"] * item["frequency"]
                for item in by_action.values()
            )
            - mean_turnover
        ),
        "cost_error": abs(
            sum(item["total_cost"] for item in by_action.values())
            - total_cost
        ),
        "transition_run_error": abs(
            len(run_lengths) - transitions - len(groups)
        ),
        "dominant_feature_rate_error": abs(
            sum(item["dominant_rate"] for item in by_feature.values())
            - 1.0
        ),
    }
    reconciliation["passed"] = (
        reconciliation["rationale_rows"]
        == reconciliation["action_rows"]
        == decisions
        and max(
            float(value)
            for key, value in reconciliation.items()
            if key not in {"rationale_rows", "action_rows"}
        )
        <= 1e-10
    )
    return {
        "status": "available",
        "decisions": decisions,
        "trial_paths": len(groups),
        "transitions": transitions,
        "transition_rate": (
            transitions / comparable_decisions
            if comparable_decisions
            else 0.0
        ),
        "retention_rate": (
            1.0 - transitions / comparable_decisions
            if comparable_decisions
            else 1.0
        ),
        "action_runs": len(run_lengths),
        "mean_action_run_length": float(np.mean(run_lengths)),
        "median_action_run_length": float(np.median(run_lengths)),
        "maximum_action_run_length": int(max(run_lengths)),
        "single_bar_run_rate": float(
            np.mean([length == 1 for length in run_lengths])
        ),
        "mean_action_margin": float(np.mean(margins)),
        "median_action_margin": float(np.median(margins)),
        "minimum_action_margin": float(min(margins)),
        "maximum_action_margin": float(max(margins)),
        "tie_decisions": int(
            sum(row["tieForBest"] for row in selected_rationales)
        ),
        "tie_rate": float(
            np.mean(
                [row["tieForBest"] for row in selected_rationales]
            )
        ),
        "total_reward": total_reward,
        "total_net_return": total_net_return,
        "mean_one_way_turnover": mean_turnover,
        "total_cost": total_cost,
        "by_action": by_action,
        "by_feature": by_feature,
        "trials": trial_metrics,
        "reconciliation": reconciliation,
    }


def _aggregate(values: list[float]) -> dict[str, float | int]:
    array = np.asarray(values, dtype=float)
    if not len(array) or not np.isfinite(array).all():
        raise JudgeFailure(
            "policy.aggregate",
            "Cannot aggregate missing or non-finite policy evidence",
        )
    return {
        "observations": int(len(array)),
        "mean": float(array.mean()),
        "standard_deviation": float(array.std(ddof=0)),
        "minimum": float(array.min()),
        "maximum": float(array.max()),
    }


def _aggregate_execution_risk_trials(
    folds: dict[str, Any],
    split: str,
) -> dict[str, float | int | str]:
    items = [
        seed[split]["execution_risk"]
        for fold in folds.values()
        for seed in fold["seeds"].values()
        if seed.get("status") == "succeeded"
    ]
    active = sum(int(item["active_dates"]) for item in items)
    available = sum(
        int(item["forecast_available_dates"]) for item in items
    )
    executed_breaches = sum(
        int(item["executed_breach_dates"]) for item in items
    )
    if executed_breaches:
        raise JudgeFailure(
            "policy.risk-breach",
            "A governed RL rollout contains an executed-book risk breach",
        )
    return {
        "status": "available" if available else "forecast_unavailable",
        "trial_paths": len(items),
        "active_dates": active,
        "forecast_available_dates": available,
        "forecast_coverage": available / active if active else 0.0,
        "pretrade_breach_dates": sum(
            int(item["pretrade_breach_dates"]) for item in items
        ),
        "risk_rebalance_override_dates": sum(
            int(item["risk_rebalance_override_dates"])
            for item in items
        ),
        "executed_breach_dates": executed_breaches,
        "maximum_executed_forecast_annualized": max(
            (
                float(item["maximum_executed_forecast_annualized"])
                for item in items
            ),
            default=0.0,
        ),
        "maximum_ceiling_error": max(
            (float(item["maximum_ceiling_error"]) for item in items),
            default=0.0,
        ),
    }


def _evaluate() -> tuple[
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
    list[dict[str, Any]],
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
]:
    study, data_root = _load_contract()
    mandate = _load_mandate()
    factor_claim = _load_factor_claim()
    factor_population = _load_factor_population()
    if factor_outcome(factor_claim) != FORWARD_RETURN_OUTCOME:
        raise JudgeFailure(
            "rl.factor-outcome",
            "Governed RL requires a forward-return Factor and Portfolio "
            "baseline; a risk forecast has no action-score meaning",
        )
    research_horizon = _load_horizon()
    implementation_policy = resolve_implementation_policy(mandate)
    model_module = importlib.import_module("models.candidate")
    factor_module = importlib.import_module("factors.candidate")
    feature_names, encoder = _candidate_encoder(model_module)
    frames, opens, closes, volumes = _panels(study, data_root)
    universe = study["dataset"]["universe"]
    try:
        prediction_population = resolve_prediction_population(
            universe,
            factor_claim,
            factor_population,
        ).as_metrics()
        validate_population_mandate_compatibility(
            prediction_population,
            mandate,
        )
    except PredictionModeError as error:
        raise JudgeFailure(error.code, str(error)) from error
    try:
        factor_panel = build_factor_panel(frames, universe=universe)
        factor_evaluation = evaluate_factor(
            factor_module,
            factor_panel,
        )
        candidate_panel = values_to_wide(
            factor_panel,
            factor_evaluation.values,
            universe=universe,
        )
    except FactorRuntimeError as error:
        raise JudgeFailure(error.code, str(error)) from error
    action_targets = build_action_targets(
        _factor_panels(opens, closes, volumes, candidate_panel),
        closes,
        mandate=mandate,
        prediction_population=prediction_population,
    )
    _, _, _, signal_translation = translate_factor_scores(
        candidate_panel,
        prediction_population,
    )
    risk_covariance_cache = build_risk_covariance_cache(
        closes,
        mandate=mandate,
    )
    audits = {
        action: constraint_audit(targets, mandate=mandate)
        for action, targets in action_targets.items()
    }
    if not all(audit["passed"] for audit in audits.values()):
        raise JudgeFailure(
            "policy.constraints",
            "A fixed action violated portfolio target constraints",
        )
    raw_states = build_raw_states(
        closes,
        volumes,
        action_targets,
    )
    forward_valid = (closes.shift(-1) / closes - 1.0).notna().all(axis=1)
    active = pd.Series(True, index=closes.index)
    if mandate["construction"]["family"] == "dollar-neutral":
        for targets in action_targets.values():
            active &= targets.abs().sum(axis=1) > 1e-12
    valid = raw_states.notna().all(axis=1) & forward_valid & active
    active_index = closes.index[valid]
    folds = chronological_folds(active_index)

    sample_positions = sorted(
        {0, len(active_index) // 2, len(active_index) - 1}
    )
    zero_pretrade = pd.Series(
        0.0,
        index=closes.columns,
        dtype=float,
    )
    for position in sample_positions:
        for previous_action in ACTIONS:
            encoder(
                build_policy_state(
                    raw_states.loc[active_index[position]],
                    previous_action,
                    zero_pretrade,
                    {
                        action: action_targets[action].loc[
                            active_index[position]
                        ]
                        for action in ACTIONS
                    },
                )
            )

    fold_metrics: dict[str, Any] = {}
    baseline_metrics: dict[str, Any] = {}
    policy_models: dict[str, Any] = {}
    training_history: dict[str, Any] = {}
    action_rows: list[dict[str, Any]] = []
    rationale_rows: list[dict[str, Any]] = []
    opportunity_rows: list[dict[str, Any]] = []
    incremental_rows: list[dict[str, Any]] = []
    incremental_thresholds: dict[str, dict[str, float]] = {}
    failures: list[dict[str, Any]] = []
    validation_sharpes: list[float] = []
    test_sharpes: list[float] = []
    validation_advantages: list[float] = []
    test_advantages: list[float] = []
    candidate_validation_sharpes: list[float] = []
    candidate_test_sharpes: list[float] = []
    validation_advantages_vs_candidate: list[float] = []
    test_advantages_vs_candidate: list[float] = []
    validation_candidate_action_frequencies: list[float] = []

    for fold_name, split in folds.items():
        (
            baselines,
            ridge_model,
            best_baseline,
            selected_baseline_rollouts,
        ) = _fixed_baselines(
            raw_states,
            action_targets,
            closes,
            volumes,
            split,
            mandate,
            risk_covariance_cache,
        )
        volatility_threshold = float(
            raw_states.loc[split["train"], "market_volatility_20"].median()
        )
        if not math.isfinite(volatility_threshold):
            raise JudgeFailure(
                "policy.incremental-threshold",
                "Train-frozen volatility threshold is non-finite",
            )
        incremental_thresholds[fold_name] = {
            "marketVolatility20Median": volatility_threshold,
        }
        baseline_metrics[fold_name] = {
            **baselines,
            "best_validation_policy": best_baseline,
        }
        best_validation = float(
            _baseline_split(
                baselines,
                best_baseline,
                "validation",
            )["net"]["sharpe"]
        )
        matching_test = float(
            _baseline_split(
                baselines,
                best_baseline,
                "test",
            )["net"]["sharpe"]
        )
        candidate_validation = float(
            baselines["fixed_factor_or_blend"]["candidate"]["validation"][
                "net"
            ]["sharpe"]
        )
        candidate_test = float(
            baselines["fixed_factor_or_blend"]["candidate"]["test"]["net"][
                "sharpe"
            ]
        )
        candidate_validation_sharpes.append(candidate_validation)
        candidate_test_sharpes.append(candidate_test)
        seed_metrics: dict[str, Any] = {}
        policy_models[fold_name] = {
            "contextualRidgeBaseline": ridge_model,
            "seeds": {},
        }
        training_history[fold_name] = {}
        fold_validation: list[float] = []
        fold_test: list[float] = []
        for seed in SEEDS:
            try:
                trained = train_q_policy(
                    encoder,
                    len(feature_names),
                    raw_states,
                    action_targets,
                    closes,
                    volumes,
                    split["train"],
                    seed=seed,
                    mandate=mandate,
                    risk_covariance_cache=risk_covariance_cache,
                )
                selector = q_selector(trained.weights, encoder)
                validation_rollout = rollout_policy(
                    selector,
                    raw_states,
                    action_targets,
                    closes,
                    volumes,
                    split["validation"],
                    mandate=mandate,
                    risk_covariance_cache=risk_covariance_cache,
                )
                test_rollout = rollout_policy(
                    selector,
                    raw_states,
                    action_targets,
                    closes,
                    volumes,
                    split["test"],
                    mandate=mandate,
                    risk_covariance_cache=risk_covariance_cache,
                )
                validation = rollout_metrics(validation_rollout)
                test = rollout_metrics(test_rollout)
                validation_sharpe = float(validation["net"]["sharpe"])
                test_sharpe = float(test["net"]["sharpe"])
                fold_validation.append(validation_sharpe)
                fold_test.append(test_sharpe)
                validation_sharpes.append(validation_sharpe)
                test_sharpes.append(test_sharpe)
                validation_candidate_action_frequencies.append(
                    float(validation["action_frequency"]["candidate"])
                )
                seed_metrics[str(seed)] = {
                    "status": "succeeded",
                    "validation": validation,
                    "test": test,
                }
                policy_models[fold_name]["seeds"][str(seed)] = {
                    "weights": trained.weights.tolist(),
                }
                training_history[fold_name][str(seed)] = trained.history
                action_rows.extend(
                    _rollout_action_rows(
                        fold_name,
                        seed,
                        "validation",
                        validation_rollout,
                    )
                )
                rationale_rows.extend(
                    _rollout_rationale_rows(
                        fold_name,
                        seed,
                        "validation",
                        validation_rollout,
                        encoder,
                        feature_names,
                        trained.weights,
                    )
                )
                opportunity_rows.extend(
                    _rollout_opportunity_rows(
                        fold_name,
                        seed,
                        "validation",
                        validation_rollout,
                        action_targets,
                        closes,
                        volumes,
                        mandate,
                        risk_covariance_cache,
                    )
                )
                incremental_rows.extend(
                    _rollout_incremental_rows(
                        fold_name,
                        seed,
                        "validation",
                        best_baseline,
                        validation_rollout,
                        selected_baseline_rollouts["validation"],
                        raw_states,
                        closes,
                        volatility_threshold,
                    )
                )
                action_rows.extend(
                    _rollout_action_rows(
                        fold_name,
                        seed,
                        "test",
                        test_rollout,
                    )
                )
                rationale_rows.extend(
                    _rollout_rationale_rows(
                        fold_name,
                        seed,
                        "test",
                        test_rollout,
                        encoder,
                        feature_names,
                        trained.weights,
                    )
                )
                opportunity_rows.extend(
                    _rollout_opportunity_rows(
                        fold_name,
                        seed,
                        "test",
                        test_rollout,
                        action_targets,
                        closes,
                        volumes,
                        mandate,
                        risk_covariance_cache,
                    )
                )
                incremental_rows.extend(
                    _rollout_incremental_rows(
                        fold_name,
                        seed,
                        "test",
                        best_baseline,
                        test_rollout,
                        selected_baseline_rollouts["test"],
                        raw_states,
                        closes,
                        volatility_threshold,
                    )
                )
            except Exception as error:
                code = getattr(error, "code", "policy.seed-failed")
                failure = {
                    "fold": fold_name,
                    "seed": seed,
                    "code": code,
                    "message": f"{type(error).__name__}: {error}",
                }
                failures.append(failure)
                seed_metrics[str(seed)] = {
                    "status": "failed",
                    "error": failure,
                }
        if not fold_validation:
            fold_metrics[fold_name] = {
                "ranges": {
                    name: {
                        "start": timestamp_label(index[0]),
                        "end": timestamp_label(index[-1]),
                        "observations": len(index),
                    }
                    for name, index in split.items()
                },
                "seeds": seed_metrics,
                "aggregate": {
                    "status": "all-seeds-failed",
                    "best_validation_baseline": best_baseline,
                },
            }
            continue
        validation_advantage = float(np.mean(fold_validation)) - best_validation
        test_advantage = float(np.mean(fold_test)) - matching_test
        validation_advantage_vs_candidate = (
            float(np.mean(fold_validation)) - candidate_validation
        )
        test_advantage_vs_candidate = float(np.mean(fold_test)) - candidate_test
        validation_advantages.append(validation_advantage)
        test_advantages.append(test_advantage)
        validation_advantages_vs_candidate.append(
            validation_advantage_vs_candidate
        )
        test_advantages_vs_candidate.append(test_advantage_vs_candidate)
        fold_metrics[fold_name] = {
            "ranges": {
                name: {
                    "start": timestamp_label(index[0]),
                    "end": timestamp_label(index[-1]),
                    "observations": len(index),
                }
                for name, index in split.items()
            },
            "seeds": seed_metrics,
            "aggregate": {
                "validation_net_sharpe": _aggregate(fold_validation),
                "test_net_sharpe": _aggregate(fold_test),
                "validation_advantage_vs_best_baseline": validation_advantage,
                "test_advantage_vs_validation_selected_baseline": test_advantage,
                "validation_advantage_vs_candidate_factor": (
                    validation_advantage_vs_candidate
                ),
                "test_advantage_vs_candidate_factor": test_advantage_vs_candidate,
                "best_validation_baseline": best_baseline,
            },
        }

    total_trials = len(folds) * len(SEEDS)
    if failures:
        raise TrialFailures(failures)
    policy_rationale = {
        "policy": {
            "method": (
                "linear-q-chosen-vs-runner-up-decomposition-v1"
            ),
            "action_runs": (
                "contiguous-actions-clipped-to-fold-seed-split"
            ),
            "q_scale": "uncalibrated-linear-model-score",
            "feature_contribution": (
                "exact-linear-chosen-minus-runner-decomposition"
            ),
            "realized_outcomes": (
                "descriptive-endogenous-action-conditioning"
            ),
            "selection_authority": "context-only",
            "trading_authority": "none",
        },
        "validation": _policy_behavior_metrics(
            rationale_rows,
            action_rows,
            "validation",
            feature_names,
        ),
        "test": _policy_behavior_metrics(
            rationale_rows,
            action_rows,
            "test",
            feature_names,
        ),
    }
    execution_risk = {
        "policy": {
            "method": (
                "post-drift-executed-book-volatility-compliance-v1"
            ),
            "risk_policy": mandate["construction"]["riskPolicy"],
            "no_trade_priority": "risk-compliance-first",
            "repair": "minimum-proportional-scale-down",
            "selection_authority": "context-only",
            "trading_authority": "none",
        },
        "validation": _aggregate_execution_risk_trials(
            fold_metrics,
            "validation",
        ),
        "test": _aggregate_execution_risk_trials(
            fold_metrics,
            "test",
        ),
    }
    factor_opportunity = {
        "policy": FACTOR_OPPORTUNITY_POLICY,
        "validation": _factor_opportunity_metrics(
            opportunity_rows,
            "validation",
        ),
        "test": _factor_opportunity_metrics(
            opportunity_rows,
            "test",
        ),
    }
    incremental_attribution = {
        "policy": INCREMENTAL_ATTRIBUTION_POLICY,
        "validation": _incremental_attribution_metrics(
            incremental_rows,
            "validation",
            list(closes.columns),
        ),
        "test": _incremental_attribution_metrics(
            incremental_rows,
            "test",
            list(closes.columns),
        ),
    }
    metrics = {
        "validation_mean_net_sharpe": float(np.mean(validation_sharpes)),
        "factor_api": factor_contract(factor_evaluation),
        "factor_claim": factor_claim,
        "prediction_universe": prediction_population,
        "signal_translation": signal_translation,
        "portfolio_mandate": mandate,
        "research_horizon": research_horizon,
        "rl": {
            "aggregate": {
                "validation_net_sharpe": _aggregate(validation_sharpes),
                "test_net_sharpe": _aggregate(test_sharpes),
                "failure_rate": len(failures) / total_trials,
                "failures": failures,
            },
            "folds": fold_metrics,
        },
        "baselines": baseline_metrics,
        "comparison": {
            "mean_validation_advantage_vs_best_baseline": float(
                np.mean(validation_advantages)
            ),
            "mean_test_advantage_vs_validation_selected_baseline": float(
                np.mean(test_advantages)
            ),
            "candidate_factor_validation_net_sharpe": _aggregate(
                candidate_validation_sharpes
            ),
            "candidate_factor_test_net_sharpe": _aggregate(
                candidate_test_sharpes
            ),
            "mean_validation_advantage_vs_candidate_factor": float(
                np.mean(validation_advantages_vs_candidate)
            ),
            "mean_test_advantage_vs_candidate_factor": float(
                np.mean(test_advantages_vs_candidate)
            ),
            "mean_validation_candidate_action_frequency": float(
                np.mean(validation_candidate_action_frequencies)
            ),
        },
        "policy_rationale": policy_rationale,
        "factor_opportunity": factor_opportunity,
        "incremental_attribution": incremental_attribution,
        "execution_risk": execution_risk,
        "constraint_audit": audits,
        "configuration": {
            "portfolioMandateId": mandate["id"],
            "researchHorizonId": research_horizon["id"],
            "actions": list(ACTIONS),
            "factorExperts": list(EXPERTS),
            "rawStateFields": list(POLICY_STATE_COLUMNS),
            "featureNames": feature_names,
            "seeds": list(SEEDS),
            "folds": list(folds),
            "episodes": EPISODES,
            "learningRate": LEARNING_RATE,
            "discount": DISCOUNT,
            "epsilonStart": EPSILON_START,
            "epsilonEnd": EPSILON_END,
            "contextualRidgeIterations": (
                CONTEXTUAL_RIDGE_ITERATIONS
            ),
            "contextualRidgeMethod": (
                "iterative-same-pretrade-contextual-ridge-v1"
            ),
            "contextualRidgeLabelScope": "train-only",
            "contextualRidgeAnchorAction": "balanced",
            "riskAversion": RISK_AVERSION,
            "costBps": implementation_policy["base_cost_bps"],
            "noTradeOneWay": implementation_policy["no_trade_one_way"],
            "referenceNav": implementation_policy["reference_nav"],
            "decisionSchedule": implementation_policy["decision_policy"],
            "executionRiskMethod": (
                "post-drift-executed-book-volatility-compliance-v1"
            ),
            "executionRiskPriority": "risk-compliance-first",
            "factorOpportunityMethod": FACTOR_OPPORTUNITY_POLICY["method"],
            "incrementalAttributionMethod": (
                INCREMENTAL_ATTRIBUTION_POLICY["method"]
            ),
            "learningContract": LEARNING_CONTRACT,
        },
        "research_integrity": {
            "selection_split": "validation",
            "test_role": "visible-diagnostic",
            "test_enters_selection": False,
            "external_holdout_rule": (
                "required-after-visible-test-and-candidate-iteration"
            ),
            "learning_configuration": LEARNING_CONTRACT,
            "factor_dependency": {
                "module": "factors.candidate",
                "mode": "content-locked-study-dependency",
                "causalityAuditCuts": list(
                    factor_evaluation.causality_cuts
                ),
            },
        },
    }
    if not math.isfinite(metrics["validation_mean_net_sharpe"]):
        raise JudgeFailure("policy.non-finite", "Primary score is non-finite")
    dataset = study["dataset"]
    report = {
        "schemaVersion": 1,
        "inputHash": os.environ["AUTOQUANT_INPUT_HASH"],
        "dataset": {
            "id": dataset["id"],
            "version": dataset["version"],
            "universe": dataset["universe"],
            "timeRange": dataset["time_range"],
        },
        "portfolioMandate": mandate,
        "factorClaim": factor_claim,
        "predictionUniverse": prediction_population,
        "signalTranslation": signal_translation,
        "researchHorizon": research_horizon,
        "semantics": {
            "simulation": "governed-factor-mixture-q-policy",
            "state": "fixed causal scalars known through close t",
            "action": (
                "candidate factor, one of three reference factors, or their "
                "equal-weight blend at close t"
            ),
            "return": "close t to close t+1",
            "researchHorizonRole": (
                "fixed question identity and disclosure; one-step RL rewards "
                "are not direct multi-bar forecasts"
            ),
            "reward": (
                "net return after "
                f"{implementation_policy['base_cost_bps']:g}bps cost minus "
                "0.10 * gross_return^2"
            ),
            "policyRationale": (
                "exact linear chosen-versus-runner-up Q-margin "
                "decomposition; Q scores are uncalibrated and contextual"
            ),
            "factorOpportunity": (
                "all fixed sleeves evaluated for one next bar from the "
                "selected policy path's exact shared pretrade book; the "
                "ex-post oracle is an audit upper bound only"
            ),
            "incrementalAttribution": (
                "independent full-path RL minus validation-selected "
                "mechanical baseline; gross edge minus incremental cost "
                "reconciles net active return"
            ),
            "learningConfiguration": (
                "episodes, learning rate, discount, and exploration were "
                "frozen by a reference-fixture outer-train-only blocked "
                "stability audit before Study validation; validation and "
                "test do not tune them"
            ),
            "executionRisk": (
                "every selected sleeve is rechecked after drift; risk "
                "compliance bypasses the no-trade band with minimum "
                "proportional scale-down"
            ),
            "objective": "mean validation net Sharpe across every successful seed/fold",
            "testRole": "reported audit evidence; never enters promotion",
            "testVisibilityWarning": (
                "Repeated candidate changes after inspecting test metrics consume "
                "their holdout value; use a new external holdout for production claims."
            ),
            "tradingAuthority": "none",
        },
        "dependencies": {
            "numpy": np.__version__,
            "pandas": pd.__version__,
        },
        "metrics": metrics,
    }
    models = {
        "schemaVersion": 1,
        "inputHash": os.environ["AUTOQUANT_INPUT_HASH"],
        "featureNames": feature_names,
        "configuration": metrics["configuration"],
        "models": policy_models,
    }
    histories = {
        "schemaVersion": 1,
        "inputHash": os.environ["AUTOQUANT_INPUT_HASH"],
        "histories": training_history,
    }
    rationales = {
        "schemaVersion": 1,
        "inputHash": os.environ["AUTOQUANT_INPUT_HASH"],
        "method": (
            "linear-q-chosen-vs-runner-up-decomposition-v1"
        ),
        "actions": list(ACTIONS),
        "rawStateFields": list(POLICY_STATE_COLUMNS),
        "featureNames": feature_names,
        "rows": rationale_rows,
    }
    opportunities = {
        "schemaVersion": 1,
        "inputHash": os.environ["AUTOQUANT_INPUT_HASH"],
        "method": FACTOR_OPPORTUNITY_POLICY["method"],
        "actions": list(ACTIONS),
        "assets": list(closes.columns),
        "reward": (
            "net-return-after-"
            f"{implementation_policy['base_cost_bps']:g}bps-cost-minus-"
            "0.10-times-gross-return-squared"
        ),
        "policy": FACTOR_OPPORTUNITY_POLICY,
        "rows": compact_opportunity_rows(opportunity_rows),
    }
    incremental = {
        "schemaVersion": 1,
        "inputHash": os.environ["AUTOQUANT_INPUT_HASH"],
        "method": INCREMENTAL_ATTRIBUTION_POLICY["method"],
        "assets": list(closes.columns),
        "policy": INCREMENTAL_ATTRIBUTION_POLICY,
        "thresholds": incremental_thresholds,
        "rows": incremental_rows,
    }
    return (
        metrics,
        report,
        models,
        histories,
        action_rows,
        rationales,
        opportunities,
        incremental,
    )


def main() -> None:
    try:
        (
            metrics,
            report,
            models,
            histories,
            action_rows,
            rationales,
            opportunities,
            incremental,
        ) = _evaluate()
        artifacts = Path(os.environ["AUTOQUANT_ARTIFACTS_DIR"])
        (artifacts / "rl-report.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        (artifacts / "policy-models.json").write_text(
            json.dumps(models, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        (artifacts / "training-history.json").write_text(
            json.dumps(histories, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        pd.DataFrame(action_rows).to_csv(
            artifacts / "policy-actions.csv",
            index=False,
            float_format="%.17g",
        )
        (artifacts / "policy-rationales.json").write_text(
            json.dumps(rationales, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        (artifacts / "policy-opportunities.json").write_text(
            json.dumps(
                opportunities,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        (artifacts / "policy-incremental-attribution.json").write_text(
            json.dumps(incremental, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        _write_output(
            {
                "schema_version": 1,
                "status": "succeeded",
                "summary": (
                    "Governed factor-mixture policy evaluated across all fixed "
                    "folds/seeds; validation mean net Sharpe="
                    f"{metrics['validation_mean_net_sharpe']:.6f}"
                ),
                "metrics": metrics,
                "artifacts": [
                    {
                        "kind": "rl-report",
                        "path": "rl-report.json",
                        "description": (
                            "State/action/reward semantics, folds, seeds, baselines, "
                            "comparisons, warnings, and complete metrics"
                        ),
                    },
                    {
                        "kind": "policy-models",
                        "path": "policy-models.json",
                        "description": (
                            "Exact candidate feature names, configuration, Q weights, "
                            "and contextual-ridge baseline parameters"
                        ),
                    },
                    {
                        "kind": "training-history",
                        "path": "training-history.json",
                        "description": "Every episode for every declared fold and seed",
                    },
                    {
                        "kind": "policy-actions",
                        "path": "policy-actions.csv",
                        "description": (
                            "Timestamped validation/test actions, rewards, returns, "
                            "turnover, costs, and executed-book risk compliance"
                        ),
                    },
                    {
                        "kind": "policy-rationales",
                        "path": "policy-rationales.json",
                        "description": (
                            "Exact raw state, encoded features, action Q values, "
                            "runner-up margins, and linear feature contributions"
                        ),
                    },
                    {
                        "kind": "policy-opportunities",
                        "path": "policy-opportunities.json",
                        "description": (
                            "Same-pretrade one-step governed action books, "
                            "rewards, local oracle rank/regret, and candidate "
                            "factor opportunity evidence"
                        ),
                    },
                    {
                        "kind": "policy-incremental-attribution",
                        "path": "policy-incremental-attribution.json",
                        "description": (
                            "Full-path active return, cost, regime, action, "
                            "and asset attribution versus each fold's "
                            "validation-selected mechanical baseline"
                        ),
                    },
                ],
                "errors": [],
            }
        )
    except TrialFailures as error:
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "summary": str(error),
                "metrics": {
                    "declared_trials": len(SEEDS) * 2,
                    "failed_trials": len(error.failures),
                },
                "artifacts": [],
                "errors": [
                    {
                        "code": item["code"],
                        "message": (
                            f"{item['fold']} seed {item['seed']}: "
                            f"{item['message']}"
                        ),
                    }
                    for item in error.failures
                ],
            }
        )
    except (JudgeFailure, PolicyFailure) as error:
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "summary": str(error),
                "metrics": {},
                "artifacts": [],
                "errors": [
                    {
                        "code": getattr(error, "code", "policy.failure"),
                        "message": str(error),
                    }
                ],
            }
        )
    except Exception as error:
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "summary": f"RL evaluation raised {type(error).__name__}",
                "metrics": {},
                "artifacts": [],
                "errors": [
                    {
                        "code": "policy.exception",
                        "message": f"{type(error).__name__}: {error}",
                    }
                ],
            }
        )


if __name__ == "__main__":
    main()
