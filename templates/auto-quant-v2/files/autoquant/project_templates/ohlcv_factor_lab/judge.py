"""Fixed no-lookahead Judge for the OHLCV Factor Lab reference Project."""

from __future__ import annotations

import importlib
import json
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from autoquant.factor_runtime import (
    FactorRuntimeError,
    build_factor_panel,
    evaluate_factor,
    factor_contract,
    values_to_wide,
)
from autoquant.factor_claims import (
    FACTOR_CLAIM,
    FORWARD_RETURN_OUTCOME,
    factor_outcome,
    factor_outcome_contract,
    load_factor_claim,
)
from autoquant.intervals import (
    IntervalContractError,
    load_multi_interval_asset,
    timestamp_label,
)
from autoquant.prediction_modes import (
    CROSS_SECTIONAL_MODE,
    FACTOR_POPULATION,
    SINGLE_ASSET_TEMPORAL_MODE,
    TEMPORAL_EVALUATION_MODES,
    TWO_ASSET_RELATIVE_VALUE_MODE,
    PredictionModeError,
    load_factor_population,
    resolve_prediction_population,
)
from autoquant.horizons import (
    RESEARCH_HORIZON,
    load_research_horizon,
)
from judges.factor_diagnostics import (
    HORIZONS,
    REGIME_NAMES,
    STYLE_NAMES,
    causal_regime_labels,
    chronological_fold_masks,
    cross_sectional_rank_residual,
    daily_pearson_correlation,
    daily_quantile_outcomes,
    daily_rank_correlation,
    descriptive_ic,
    equal_rank_blend,
    factor_outcome_panels,
    hac_inference,
    per_asset_rank_correlation,
    purged_split_masks,
    quantile_summary,
    style_proxy_panels,
)


REQUIRED_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")
MIN_ASSETS_PER_DATE = 4
MIN_IC_DATES_PER_SPLIT = 20
PRIMARY_HORIZON = 1
TEMPORAL_QUALIFICATION_METHOD = (
    "request-claim-aware-one-style-temporal-neutralization-v1"
)


class JudgeFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


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


def _load_horizon() -> dict[str, Any]:
    path = Path(os.environ["AUTOQUANT_PROJECT_ROOT"]) / RESEARCH_HORIZON
    try:
        return load_research_horizon(path)
    except Exception as error:
        raise JudgeFailure(
            "horizon.contract",
            f"Invalid fixed Horizon Mandate: {error}",
        ) from error


def _load_factor_claim() -> dict[str, Any]:
    path = Path(os.environ["AUTOQUANT_PROJECT_ROOT"]) / FACTOR_CLAIM
    try:
        return load_factor_claim(path)
    except Exception as error:
        raise JudgeFailure(
            "factor-claim.contract",
            f"Invalid fixed Factor claim: {error}",
        ) from error


def _load_prediction_universe(
    research_universe: list[str],
    factor_claim: dict[str, Any],
) -> tuple[dict[str, Any], list[str], list[str], str, str]:
    path = Path(os.environ["AUTOQUANT_PROJECT_ROOT"]) / FACTOR_POPULATION
    try:
        factor_population = load_factor_population(path)
    except Exception as error:
        raise JudgeFailure(
            "prediction-universe.contract",
            f"Invalid fixed prediction-universe authority: {error}",
        ) from error
    try:
        population = resolve_prediction_population(
            research_universe,
            factor_claim,
            factor_population,
        )
    except PredictionModeError as error:
        raise JudgeFailure(error.code, str(error)) from error
    return (
        population.as_metrics(),
        list(population.prediction_assets),
        list(population.context_assets),
        population.authority,
        population.evaluation_mode,
    )


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
        if len(multi_interval) < 120:
            raise JudgeFailure(
                "dataset.observations",
                f"{asset} has fewer than 120 base observations in the Study range",
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
    if frame["timestamp"].duplicated().any() or not frame["timestamp"].is_monotonic_increasing:
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
    if len(selected) < 120:
        raise JudgeFailure(
            "dataset.observations",
            f"{asset} has fewer than 120 observations in the Study range",
        )
    return selected.reset_index(drop=True)


def _split_metrics(values: pd.Series) -> dict[str, Any]:
    if len(values) < MIN_IC_DATES_PER_SPLIT:
        raise JudgeFailure(
            "judge.population",
            f"Chronological split has only {len(values)} valid IC dates",
        )
    return descriptive_ic(
        values,
        minimum_observations=MIN_IC_DATES_PER_SPLIT,
    )


def _component_split_metrics(values: pd.Series) -> dict[str, Any]:
    """Disclose sparse component evidence without failing a valid final factor."""

    return descriptive_ic(
        values,
        minimum_observations=MIN_IC_DATES_PER_SPLIT,
    )


def _masked(values: pd.Series, mask: pd.Series) -> pd.Series:
    return values.reindex(mask.index[mask]).dropna()


def _temporal_correlation_contributions(
    left: pd.Series,
    right: pd.Series,
    mask: pd.Series,
    *,
    rank: bool,
    constant_left_value: float | None = None,
) -> pd.Series:
    """Return timestamp contributions whose mean is one split correlation."""

    selected = pd.DataFrame(
        {
            "left": left.reindex(mask.index[mask]),
            "right": right.reindex(mask.index[mask]),
        }
    ).dropna()
    result = pd.Series(index=mask.index, dtype=float)
    if len(selected) < 3:
        return result
    if rank:
        selected = selected.rank(method="average", pct=True)
    left_centered = selected["left"] - float(selected["left"].mean())
    right_centered = selected["right"] - float(selected["right"].mean())
    denominator = math.sqrt(
        float((left_centered**2).mean())
        * float((right_centered**2).mean())
    )
    if denominator <= 1e-12:
        if constant_left_value is not None:
            result.loc[selected.index] = float(constant_left_value)
        return result
    result.loc[selected.index] = (
        left_centered * right_centered / denominator
    )
    return result


def _temporal_daily(
    left_panel: pd.DataFrame,
    right_panel: pd.DataFrame,
    masks: dict[str, pd.Series],
    *,
    rank: bool,
    constant_left_value: float | None = None,
) -> pd.Series:
    """Evaluate one prediction asset across time without context targets."""

    left = left_panel.iloc[:, 0]
    right = right_panel.iloc[:, 0]
    result = pd.Series(index=left_panel.index, dtype=float)
    for split in ("train", "validation", "test"):
        contribution = _temporal_correlation_contributions(
            left,
            right,
            masks[split],
            rank=rank,
            constant_left_value=constant_left_value,
        )
        result.loc[contribution.dropna().index] = contribution.dropna()
    return result


def _preflight_temporal_primary_validation(
    factor_panel: pd.DataFrame,
    outcome_panel: pd.DataFrame,
    validation_mask: pd.Series,
    *,
    evaluation_mode: str,
    horizon: int,
) -> None:
    """Reject an unavailable fixed objective with an exact research reason."""

    selected = pd.DataFrame(
        {
            "factor": factor_panel.iloc[:, 0].reindex(
                validation_mask.index[validation_mask]
            ),
            "outcome": outcome_panel.iloc[:, 0].reindex(
                validation_mask.index[validation_mask]
            ),
        }
    ).dropna()
    observations = int(len(selected))
    factor_values = int(selected["factor"].nunique())
    target_values = int(selected["outcome"].nunique())
    context = (
        f"evaluationMode={evaluation_mode}, split=validation, "
        f"primaryHorizon={horizon}, pairedObservations={observations}, "
        f"distinctFactorValues={factor_values}, "
        f"distinctTargetValues={target_values}, "
        f"minimumObservations={MIN_IC_DATES_PER_SPLIT}"
    )
    if observations < MIN_IC_DATES_PER_SPLIT:
        raise JudgeFailure(
            "factor.temporal-primary-observations",
            "Primary temporal validation has too few finite factor/target "
            f"pairs ({context})",
        )
    if factor_values < 2:
        raise JudgeFailure(
            "factor.temporal-primary-candidate-variation",
            "Primary temporal validation candidate has no usable variation "
            f"({context})",
        )
    if target_values < 2:
        raise JudgeFailure(
            "factor.temporal-primary-target-variation",
            "Primary temporal validation outcome has no usable variation "
            f"({context})",
        )


def _relative_value_spread_panel(
    panel: pd.DataFrame,
    prediction_assets: list[str],
) -> pd.DataFrame:
    """Reduce one authorized pair to the causal first-minus-second contrast."""

    if len(prediction_assets) != 2:
        raise JudgeFailure(
            "prediction-universe.relative-value-pair",
            "Relative-value spread construction requires exactly two assets",
        )
    left, right = prediction_assets
    return pd.DataFrame(
        {
            f"{left}-minus-{right}": panel[left] - panel[right],
        },
        index=panel.index,
    )


def _temporal_transform_panels(
    candidate: pd.DataFrame,
    style: pd.DataFrame,
    masks: dict[str, pd.Series],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Build target-free temporal residual and equal-rank blend panels."""

    residual = pd.DataFrame(index=candidate.index, columns=candidate.columns)
    blend = pd.DataFrame(index=candidate.index, columns=candidate.columns)
    column = candidate.columns[0]
    for split in ("train", "validation", "test"):
        index = masks[split].index[masks[split]]
        pair = pd.DataFrame(
            {
                "candidate": candidate[column].reindex(index),
                "style": style[column].reindex(index),
            }
        ).dropna()
        if pair.empty:
            continue
        ranks = pair.rank(method="average", pct=True)
        candidate_centered = ranks["candidate"] - float(
            ranks["candidate"].mean()
        )
        style_centered = ranks["style"] - float(ranks["style"].mean())
        denominator = float((style_centered**2).sum())
        beta = (
            float((candidate_centered * style_centered).sum()) / denominator
            if denominator > 1e-12
            else 0.0
        )
        residual.loc[pair.index, column] = (
            candidate_centered - beta * style_centered
        )
        blend.loc[pair.index, column] = (
            ranks["candidate"] + ranks["style"]
        ) / 2.0
    return residual.astype(float), blend.astype(float)


def _temporal_split_metrics(
    values: pd.Series,
    *,
    horizon: int,
    minimum_observations: int = MIN_IC_DATES_PER_SPLIT,
) -> dict[str, Any]:
    clean = values.dropna().astype(float)
    result = descriptive_ic(
        clean,
        minimum_observations=minimum_observations,
    )
    result["hac"] = hac_inference(clean, maximum_lag=max(1, int(horizon)))
    if len(clean) < minimum_observations:
        result["hac"].update(
            {
                "standard_error": None,
                "t_statistic": None,
                "normal_approximation_p_value": None,
            }
        )
    return result


def _style_summary(values: pd.Series) -> dict[str, float | int | None]:
    clean = values.dropna().astype(float)
    if len(clean) < 3:
        return {
            "mean_rank_correlation": None,
            "mean_absolute_rank_correlation": None,
            "observations": int(len(clean)),
        }
    return {
        "mean_rank_correlation": float(clean.mean()),
        "mean_absolute_rank_correlation": float(clean.abs().mean()),
        "observations": int(len(clean)),
    }


def _count_summary(values: pd.Series) -> dict[str, float | int]:
    clean = values.astype(int)
    return {
        "minimum": int(clean.min()),
        "median": float(clean.median()),
        "maximum": int(clean.max()),
    }


def _equal_rank_component_blend(
    panels: dict[str, pd.DataFrame],
    *,
    common_available: pd.DataFrame | None = None,
) -> pd.DataFrame:
    names = list(panels)
    first = panels[names[0]]
    if common_available is None:
        common_available = pd.DataFrame(
            True,
            index=first.index,
            columns=first.columns,
        )
        for panel in panels.values():
            common_available &= panel.notna()
    ranks = [
        panel.rank(axis=1, method="average", pct=True)
        for panel in panels.values()
    ]
    return (sum(ranks) / float(len(ranks))).where(common_available)


def _temporal_equal_rank_component_blend(
    panels: dict[str, pd.DataFrame],
    masks: dict[str, pd.Series],
    *,
    common_available: pd.Series | None = None,
) -> pd.DataFrame:
    """Build one target-free equal-rank blend within each fixed split."""

    names = list(panels)
    first = panels[names[0]]
    column = first.columns[0]
    if common_available is None:
        common_available = pd.Series(True, index=first.index)
        for panel in panels.values():
            common_available &= panel.iloc[:, 0].notna()
    blend = pd.DataFrame(index=first.index, columns=[column], dtype=float)
    for split in ("train", "validation", "test"):
        index = masks[split].index[masks[split]]
        values = pd.DataFrame(
            {
                name: panels[name].iloc[:, 0].reindex(index)
                for name in names
            }
        )
        ranks = values.rank(method="average", pct=True)
        selected = ranks.mean(axis=1).where(
            common_available.reindex(index).fillna(False)
        )
        blend.loc[selected.index, column] = selected
    return blend.astype(float)


def _context_distribution(values: pd.Series) -> dict[str, Any]:
    clean = values.dropna().astype(float)
    if clean.empty:
        return {
            "observations": 0,
            "mean": None,
            "standard_deviation": None,
            "minimum": None,
            "quartile_25": None,
            "median": None,
            "quartile_75": None,
            "maximum": None,
        }
    return {
        "observations": int(len(clean)),
        "mean": float(clean.mean()),
        "standard_deviation": (
            float(clean.std(ddof=1)) if len(clean) > 1 else 0.0
        ),
        "minimum": float(clean.min()),
        "quartile_25": float(clean.quantile(0.25)),
        "median": float(clean.median()),
        "quartile_75": float(clean.quantile(0.75)),
        "maximum": float(clean.max()),
    }


def _timestamp_context_evidence(
    panel: pd.DataFrame,
    factor_panel: pd.DataFrame,
    outcome_panels: dict[int, pd.DataFrame],
    split_masks: dict[int, dict[str, pd.Series]],
) -> dict[str, Any]:
    """Diagnose one cross-section-constant causal market-state component."""

    values = panel.bfill(axis=1).iloc[:, 0].astype(float)
    train = _masked(values, split_masks[PRIMARY_HORIZON]["train"])
    if train.empty:
        raise JudgeFailure(
            "factor.component-context-train",
            "Timestamp-context component has no finite training observation",
        )
    lower = float(train.quantile(1.0 / 3.0))
    upper = float(train.quantile(2.0 / 3.0))
    states = pd.Series("middle", index=values.index, dtype="object")
    states.loc[values <= lower] = "low"
    states.loc[values > upper] = "high"
    states.loc[values.isna()] = "unavailable"
    factor_daily = {
        horizon: daily_rank_correlation(
            factor_panel,
            outcome_panels[horizon],
            minimum_assets=MIN_ASSETS_PER_DATE,
        )
        for horizon in HORIZONS
    }
    split_evidence: dict[str, Any] = {}
    for split in ("train", "validation", "test"):
        primary_mask = split_masks[PRIMARY_HORIZON][split]
        selected_values = values.reindex(
            primary_mask.index[primary_mask]
        )
        selected_states = states.reindex(
            primary_mask.index[primary_mask]
        )
        available_states = selected_states[
            selected_states.ne("unavailable")
        ]
        observations = int(len(available_states))
        occupancy = {
            state: {
                "observations": int(available_states.eq(state).sum()),
                "rate": (
                    float(available_states.eq(state).mean())
                    if observations
                    else None
                ),
            }
            for state in ("low", "middle", "high")
        }
        transition_observations = max(observations - 1, 0)
        transitions = (
            int(
                available_states.ne(
                    available_states.shift(1)
                ).iloc[1:].sum()
            )
            if transition_observations
            else 0
        )
        split_evidence[split] = {
            "distribution": _context_distribution(selected_values),
            "state_occupancy": occupancy,
            "transitions": {
                "observations": transition_observations,
                "changes": transitions,
                "rate": (
                    float(transitions / transition_observations)
                    if transition_observations
                    else None
                ),
            },
            "conditional_factor_horizon_quality": {
                str(horizon): {
                    state: _component_split_metrics(
                        _masked(
                            factor_daily[horizon],
                            split_masks[horizon][split]
                            & states.eq(state),
                        )
                    )
                    for state in ("low", "middle", "high")
                }
                for horizon in HORIZONS
            },
        }
    return {
        "method": "train-tertile-timestamp-context-v1",
        "state_selection": {
            "split": "train",
            "target_enters_thresholds": False,
            "lower": lower,
            "upper": upper,
            "labels": ["low", "middle", "high"],
        },
        "splits": split_evidence,
        "authority": "research-prioritization-only",
        "test_enters_diagnosis": False,
        "trading_authority": "none",
    }


def _temporal_timestamp_context_evidence(
    panel: pd.DataFrame,
    factor_panel: pd.DataFrame,
    outcome_panels: dict[int, pd.DataFrame],
    split_masks: dict[int, dict[str, pd.Series]],
) -> dict[str, Any]:
    """Condition temporal Factor correlation contributions on fixed states."""

    values = panel.bfill(axis=1).iloc[:, 0].astype(float)
    train = _masked(values, split_masks[PRIMARY_HORIZON]["train"])
    if train.empty:
        raise JudgeFailure(
            "factor.component-context-train",
            "Timestamp-context component has no finite training observation",
        )
    lower = float(train.quantile(1.0 / 3.0))
    upper = float(train.quantile(2.0 / 3.0))
    states = pd.Series("middle", index=values.index, dtype="object")
    states.loc[values <= lower] = "low"
    states.loc[values > upper] = "high"
    states.loc[values.isna()] = "unavailable"
    factor_contributions = {
        horizon: _temporal_daily(
            factor_panel,
            outcome_panels[horizon],
            split_masks[horizon],
            rank=True,
        )
        for horizon in HORIZONS
    }
    split_evidence: dict[str, Any] = {}
    for split in ("train", "validation", "test"):
        primary_mask = split_masks[PRIMARY_HORIZON][split]
        selected_values = values.reindex(
            primary_mask.index[primary_mask]
        )
        selected_states = states.reindex(
            primary_mask.index[primary_mask]
        )
        available_states = selected_states[
            selected_states.ne("unavailable")
        ]
        observations = int(len(available_states))
        occupancy = {
            state: {
                "observations": int(available_states.eq(state).sum()),
                "rate": (
                    float(available_states.eq(state).mean())
                    if observations
                    else None
                ),
            }
            for state in ("low", "middle", "high")
        }
        transition_observations = max(observations - 1, 0)
        transitions = (
            int(
                available_states.ne(
                    available_states.shift(1)
                ).iloc[1:].sum()
            )
            if transition_observations
            else 0
        )
        split_evidence[split] = {
            "distribution": _context_distribution(selected_values),
            "state_occupancy": occupancy,
            "transitions": {
                "observations": transition_observations,
                "changes": transitions,
                "rate": (
                    float(transitions / transition_observations)
                    if transition_observations
                    else None
                ),
            },
            "conditional_factor_horizon_quality": {
                str(horizon): {
                    state: _temporal_split_metrics(
                        _masked(
                            factor_contributions[horizon],
                            split_masks[horizon][split]
                            & states.eq(state),
                        ),
                        horizon=horizon,
                        minimum_observations=3,
                    )
                    for state in ("low", "middle", "high")
                }
                for horizon in HORIZONS
            },
        }
    return {
        "method": "train-tertile-temporal-context-v2",
        "state_selection": {
            "split": "train",
            "target_enters_thresholds": False,
            "lower": lower,
            "upper": upper,
            "labels": ["low", "middle", "high"],
        },
        "splits": split_evidence,
        "conditional_measure": (
            "within-split-temporal-rank-correlation-contribution"
        ),
        "authority": "research-prioritization-only",
        "test_enters_diagnosis": False,
        "trading_authority": "none",
    }


def _component_evidence(
    declarations: list[dict[str, Any]],
    component_panels: dict[str, pd.DataFrame],
    factor_panel: pd.DataFrame,
    outcome_panels: dict[int, pd.DataFrame],
    split_masks: dict[int, dict[str, pd.Series]],
    coverage: dict[str, dict[str, float]],
    evaluation_mode: str,
    outcome_contract: dict[str, Any],
) -> dict[str, Any]:
    """Build target-fixed diagnostics for candidate-declared components."""

    temporal = evaluation_mode in TEMPORAL_EVALUATION_MODES
    metadata_by_name = {item["id"]: item for item in declarations}
    all_names = list(component_panels)
    names = [
        name
        for name in all_names
        if metadata_by_name[name]["role"] == "cross-sectional-score"
    ]
    context_names = [
        name
        for name in all_names
        if metadata_by_name[name]["role"] == "timestamp-context"
    ]
    score_panels = {
        name: (
            _relative_value_spread_panel(
                component_panels[name],
                list(component_panels[name].columns),
            )
            if evaluation_mode == TWO_ASSET_RELATIVE_VALUE_MODE
            else component_panels[name].iloc[:, :1]
            if temporal
            else component_panels[name]
        )
        for name in names
    }

    def target_daily(
        panel: pd.DataFrame,
        horizon: int,
        *,
        constant_left_value: float | None = None,
    ) -> pd.Series:
        if temporal:
            return _temporal_daily(
                panel,
                outcome_panels[horizon],
                split_masks[horizon],
                rank=True,
                constant_left_value=constant_left_value,
            )
        return daily_rank_correlation(
            panel,
            outcome_panels[horizon],
            minimum_assets=MIN_ASSETS_PER_DATE,
            constant_left_value=constant_left_value,
        )

    def split_quality(
        daily: pd.Series,
        horizon: int,
        split: str,
    ) -> dict[str, Any]:
        selected = _masked(daily, split_masks[horizon][split])
        return (
            _temporal_split_metrics(selected, horizon=horizon)
            if temporal
            else _component_split_metrics(selected)
        )

    def association_daily(
        left: pd.DataFrame,
        right: pd.DataFrame,
    ) -> pd.Series:
        if temporal:
            return _temporal_daily(
                left,
                right,
                split_masks[PRIMARY_HORIZON],
                rank=True,
            )
        return daily_rank_correlation(
            left,
            right,
            minimum_assets=MIN_ASSETS_PER_DATE,
        )

    raw_daily = {
        name: {
            horizon: target_daily(score_panels[name], horizon)
            for horizon in HORIZONS
        }
        for name in names
    }
    raw_quality = {
        name: {
            str(horizon): {
                split: split_quality(
                    raw_daily[name][horizon],
                    horizon,
                    split,
                )
                for split in ("train", "validation", "test")
            }
            for horizon in HORIZONS
        }
        for name in names
    }
    composite_association_daily = {
        name: association_daily(score_panels[name], factor_panel)
        for name in names
    }
    composite_association = {
        name: {
            split: _style_summary(
                _masked(
                    composite_association_daily[name],
                    split_masks[PRIMARY_HORIZON][split],
                )
            )
            for split in ("train", "validation", "test")
        }
        for name in names
    }

    pair_daily: dict[frozenset[str], pd.Series] = {}
    pairwise: list[dict[str, Any]] = []
    for left_index, left in enumerate(names):
        for right in names[left_index + 1 :]:
            daily = association_daily(
                score_panels[left],
                score_panels[right],
            )
            pair_daily[frozenset((left, right))] = daily
            pairwise.append(
                {
                    "left": left,
                    "right": right,
                    "splits": {
                        split: _style_summary(
                            _masked(
                                daily,
                                split_masks[PRIMARY_HORIZON][split],
                            )
                        )
                        for split in ("train", "validation", "test")
                    },
                }
            )

    nearest_peers: dict[str, str | None] = {}
    for name in names:
        candidates: list[tuple[str, float]] = []
        for pair, daily in pair_daily.items():
            if name not in pair:
                continue
            peer = next(item for item in pair if item != name)
            summary = _style_summary(
                _masked(
                    daily,
                    split_masks[PRIMARY_HORIZON]["train"],
                )
            )
            absolute = summary["mean_absolute_rank_correlation"]
            if absolute is not None:
                candidates.append((peer, float(absolute)))
        nearest_peers[name] = (
            min(candidates, key=lambda item: (-item[1], item[0]))[0]
            if candidates
            else None
        )

    residual_quality: dict[str, Any] = {}
    for name in names:
        peer = nearest_peers[name]
        if peer is None:
            residual_quality[name] = {
                "peer": None,
                "selection": (
                    "unavailable-single-component"
                    if len(names) == 1
                    else "unavailable-no-finite-train-peer"
                ),
                "horizon_quality": None,
            }
            continue
        residual = (
            _temporal_transform_panels(
                score_panels[name],
                score_panels[peer],
                split_masks[PRIMARY_HORIZON],
            )[0]
            if temporal
            else cross_sectional_rank_residual(
                score_panels[name],
                score_panels[peer],
                minimum_assets=MIN_ASSETS_PER_DATE,
            )
        )
        residual_daily = {
            horizon: target_daily(
                residual,
                horizon,
                constant_left_value=0.0,
            )
            for horizon in HORIZONS
        }
        residual_quality[name] = {
            "peer": peer,
            "selection": (
                "maximum-absolute-train-temporal-rank-association"
                if temporal
                else "maximum-absolute-mean-train-daily-rank-association"
            ),
            "horizon_quality": {
                str(horizon): {
                    split: split_quality(
                        residual_daily[horizon],
                        horizon,
                        split,
                    )
                    for split in ("train", "validation", "test")
                }
                for horizon in HORIZONS
            },
        }

    common_available: pd.DataFrame | pd.Series | None = None
    full_blend_quality: dict[str, Any] | None = None
    if names:
        first = score_panels[names[0]]
        if temporal:
            common_available = pd.Series(True, index=first.index)
            for name in names:
                common_available &= score_panels[name].iloc[:, 0].notna()
            full_blend = _temporal_equal_rank_component_blend(
                {name: score_panels[name] for name in names},
                split_masks[PRIMARY_HORIZON],
                common_available=common_available,
            )
        else:
            common_available = pd.DataFrame(
                True,
                index=first.index,
                columns=first.columns,
            )
            for name in names:
                common_available &= score_panels[name].notna()
            full_blend = _equal_rank_component_blend(
                {name: score_panels[name] for name in names},
                common_available=common_available,
            )
        full_blend_daily = {
            horizon: target_daily(full_blend, horizon)
            for horizon in HORIZONS
        }
        full_blend_quality = {
            str(horizon): {
                split: split_quality(
                    full_blend_daily[horizon],
                    horizon,
                    split,
                )
                for split in ("train", "validation", "test")
            }
            for horizon in HORIZONS
        }
    ablations: dict[str, Any] = {}
    for name in names:
        remaining = {
            candidate: score_panels[candidate]
            for candidate in names
            if candidate != name
        }
        if not remaining:
            ablations[name] = {
                "available": False,
                "reason": "single-component",
                "horizon_quality": None,
                "removal_delta_mean_ic": None,
            }
            continue
        leave_one_out = (
            _temporal_equal_rank_component_blend(
                remaining,
                split_masks[PRIMARY_HORIZON],
                # Score-only common availability is intentionally fixed
                # before leave-one-out so every ablation uses one population.
                common_available=common_available,
            )
            if temporal
            else _equal_rank_component_blend(
                remaining,
                common_available=common_available,
            )
        )
        leave_daily = {
            horizon: target_daily(leave_one_out, horizon)
            for horizon in HORIZONS
        }
        quality = {
            str(horizon): {
                split: split_quality(
                    leave_daily[horizon],
                    horizon,
                    split,
                )
                for split in ("train", "validation", "test")
            }
            for horizon in HORIZONS
        }
        removal_delta: dict[str, float | None] = {}
        for split in ("train", "validation", "test"):
            primary = str(PRIMARY_HORIZON)
            leave_mean = quality[primary][split]["mean_ic"]
            full_mean = full_blend_quality[primary][split]["mean_ic"]
            removal_delta[split] = (
                float(leave_mean) - float(full_mean)
                if leave_mean is not None and full_mean is not None
                else None
            )
        ablations[name] = {
            "available": True,
            "reason": None,
            "horizon_quality": quality,
            "removal_delta_mean_ic": removal_delta,
        }

    component_rows: list[dict[str, Any]] = []
    for name in names:
        primary = str(PRIMARY_HORIZON)
        raw_validation = raw_quality[name][primary]["validation"]["mean_ic"]
        residual = residual_quality[name]
        residual_validation = (
            residual["horizon_quality"][primary]["validation"]["mean_ic"]
            if residual["horizon_quality"] is not None
            else None
        )
        removal_delta = (
            ablations[name]["removal_delta_mean_ic"]["validation"]
            if ablations[name]["available"]
            else None
        )
        peer = nearest_peers[name]
        train_redundancy = None
        if peer is not None:
            train_redundancy = _style_summary(
                _masked(
                    pair_daily[frozenset((name, peer))],
                    split_masks[PRIMARY_HORIZON]["train"],
                )
            )["mean_absolute_rank_correlation"]
        component_rows.append(
            {
                **metadata_by_name[name],
                "coverage_by_asset": coverage[name],
                "mean_coverage": float(
                    sum(coverage[name].values()) / len(coverage[name])
                ),
                "raw_horizon_quality": raw_quality[name],
                "composite_association": composite_association[name],
                "nearest_peer": {
                    "id": peer,
                    "train_mean_absolute_rank_association": train_redundancy,
                },
                "nearest_peer_residual": residual,
                "fixed_blend_ablation": ablations[name],
                "timestamp_context": None,
                "validation_priority_inputs": {
                    "raw_mean_ic": raw_validation,
                    "nearest_peer_residual_mean_ic": residual_validation,
                    "removal_delta_mean_ic": removal_delta,
                },
            }
        )
    for name in context_names:
        component_rows.append(
            {
                **metadata_by_name[name],
                "coverage_by_asset": coverage[name],
                "mean_coverage": float(
                    sum(coverage[name].values()) / len(coverage[name])
                ),
                "raw_horizon_quality": None,
                "composite_association": None,
                "nearest_peer": {
                    "id": None,
                    "train_mean_absolute_rank_association": None,
                },
                "nearest_peer_residual": {
                    "peer": None,
                    "selection": "not-applicable-timestamp-context",
                    "horizon_quality": None,
                },
                "fixed_blend_ablation": {
                    "available": False,
                    "reason": "not-applicable-timestamp-context",
                    "horizon_quality": None,
                    "removal_delta_mean_ic": None,
                },
                "timestamp_context": (
                    _temporal_timestamp_context_evidence(
                        component_panels[name],
                        factor_panel,
                        outcome_panels,
                        split_masks,
                    )
                    if temporal
                    else _timestamp_context_evidence(
                        component_panels[name],
                        factor_panel,
                        outcome_panels,
                        split_masks,
                    )
                ),
                "validation_priority_inputs": {
                    "raw_mean_ic": None,
                    "nearest_peer_residual_mean_ic": None,
                    "removal_delta_mean_ic": None,
                },
            }
        )

    raw_candidates = [
        row
        for row in component_rows
        if row["validation_priority_inputs"]["raw_mean_ic"] is not None
    ]
    strongest_raw = (
        max(
            raw_candidates,
            key=lambda row: (
                float(row["validation_priority_inputs"]["raw_mean_ic"]),
                row["id"],
            ),
        )
        if raw_candidates
        else None
    )
    residual_candidates = [
        row
        for row in component_rows
        if row["validation_priority_inputs"][
            "nearest_peer_residual_mean_ic"
        ] is not None
    ]
    strongest_residual = (
        max(
            residual_candidates,
            key=lambda row: (
                float(
                    row["validation_priority_inputs"][
                        "nearest_peer_residual_mean_ic"
                    ]
                ),
                row["id"],
            ),
        )
        if residual_candidates
        else None
    )
    removable = [
        row
        for row in component_rows
        if row["validation_priority_inputs"]["removal_delta_mean_ic"]
        is not None
    ]
    best_removal = (
        max(
            removable,
            key=lambda row: (
                float(
                    row["validation_priority_inputs"][
                        "removal_delta_mean_ic"
                    ]
                ),
                row["id"],
            ),
        )
        if removable
        else None
    )
    finite_pairs = [
        row
        for row in pairwise
        if row["splits"]["train"]["mean_absolute_rank_correlation"]
        is not None
    ]
    most_redundant = (
        max(
            finite_pairs,
            key=lambda row: (
                float(
                    row["splits"]["train"][
                        "mean_absolute_rank_correlation"
                    ]
                    or -1.0
                ),
                row["left"],
                row["right"],
            ),
        )
        if finite_pairs
        else None
    )
    return {
        "method": "candidate-declared-components-v3",
        "declaration": {
            "exhaustive_composition_claim": False,
            "source_inference": False,
            "components": declarations,
        },
        "semantics": {
            "evaluation_mode": evaluation_mode,
            "prediction_target": outcome_contract["targetSemantics"],
            "score_measure": (
                "within-split-temporal-rank-correlation-contribution"
                if temporal
                else "per-date-cross-sectional-rank-ic"
            ),
            "component_roles": [
                "cross-sectional-score",
                "timestamp-context",
            ],
            "nearest_peer_selection": "train-only-target-free",
            "residualization": (
                "within-split-temporal-centered-rank-ols"
                if temporal
                else "same-timestamp-cross-sectional-centered-rank-ols"
            ),
            "diagnostic_blend": (
                "equal-weight-within-split-temporal-percentile-ranks-with-"
                "common-component-availability"
                if temporal
                else "equal-weight-cross-sectional-percentile-ranks-with-"
                "common-component-availability"
            ),
            "ablation_target": "fixed-diagnostic-blend-not-candidate-factor",
            "timestamp_context": (
                "train-tertile-occupancy-transition-and-conditional-temporal-"
                "rank-correlation-contribution"
                if temporal
                else "train-tertile-occupancy-transition-and-conditional-"
                "factor-ic"
            ),
            "selection_authority": "research-prioritization-only",
            "test_role": "visible-audit",
            "promotion_authority": "none",
            "portfolio_authority": "none",
            "rl_action_authority": "none",
            "trading_authority": "none",
        },
        "trial_disclosure": {
            "materialized_components": len(all_names),
            "cross_sectional_score_components": len(names),
            "timestamp_context_components": len(context_names),
            "pairwise_comparisons": len(pairwise),
            "component_diagnostics_enter_promotion_score": False,
        },
        "components": component_rows,
        "pairwise": pairwise,
        "fixed_blend": {
            "available": full_blend_quality is not None,
            "reason": (
                None
                if full_blend_quality is not None
                else "no-cross-sectional-score-components"
            ),
            "horizon_quality": full_blend_quality,
        },
        "validation_diagnosis": {
            "strongest_raw_component": (
                strongest_raw["id"] if strongest_raw is not None else None
            ),
            "strongest_raw_mean_ic": (
                strongest_raw["validation_priority_inputs"]["raw_mean_ic"]
                if strongest_raw is not None
                else None
            ),
            "strongest_residual_component": (
                strongest_residual["id"]
                if strongest_residual is not None
                else None
            ),
            "strongest_residual_mean_ic": (
                strongest_residual["validation_priority_inputs"][
                    "nearest_peer_residual_mean_ic"
                ]
                if strongest_residual is not None
                else None
            ),
            "removal_most_improves_fixed_blend": (
                best_removal["id"] if best_removal is not None else None
            ),
            "best_removal_delta_mean_ic": (
                best_removal["validation_priority_inputs"][
                    "removal_delta_mean_ic"
                ]
                if best_removal is not None
                else None
            ),
            "most_redundant_pair": (
                {
                    "left": most_redundant["left"],
                    "right": most_redundant["right"],
                    "train_mean_absolute_rank_association": (
                        most_redundant["splits"]["train"][
                            "mean_absolute_rank_correlation"
                        ]
                    ),
                }
                if most_redundant is not None
                else None
            ),
            "authority": "research-prioritization-only",
            "test_enters_diagnosis": False,
        },
    }


def _decay_summary(
    horizon_metrics: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for split in ("train", "validation", "test"):
        means = {
            horizon: horizon_metrics[horizon][split]["mean_ic"]
            for horizon in (str(item) for item in HORIZONS)
        }
        primary = means[str(PRIMARY_HORIZON)]
        ratios: dict[str, float | None] = {}
        for horizon in (str(item) for item in HORIZONS):
            if horizon == str(PRIMARY_HORIZON):
                continue
            value = means[horizon]
            ratios[
                f"horizon_{horizon}_to_{PRIMARY_HORIZON}"
            ] = (
                float(value) / float(primary)
                if value is not None
                and primary is not None
                and abs(float(primary)) > 1e-12
                else None
            )
        result[split] = {
            "mean_ic_by_horizon": means,
            **ratios,
        }
    return result


def _factor_qualification(
    factor_panel: pd.DataFrame,
    styles: dict[str, pd.DataFrame],
    outcome_panels: dict[int, pd.DataFrame],
    split_masks: dict[int, dict[str, pd.Series]],
    fold_masks: dict[str, pd.Series],
    split_labels: pd.Series,
    style_correlations: dict[str, dict[str, Any]],
    factor_claim: dict[str, Any],
) -> tuple[dict[str, Any], pd.DataFrame]:
    """Build request-claim-aware style comparison and qualification evidence."""

    candidates = {
        name: {
            "mean_rank_correlation": style_correlations["train"][name][
                "mean_rank_correlation"
            ],
            "mean_absolute_rank_correlation": style_correlations["train"][
                name
            ]["mean_absolute_rank_correlation"],
            "observations": style_correlations["train"][name][
                "observations"
            ],
        }
        for name in STYLE_NAMES
    }
    finite = [
        (name, value["mean_rank_correlation"])
        for name, value in candidates.items()
        if value["mean_rank_correlation"] is not None
    ]
    if not finite:
        raise JudgeFailure(
            "factor.qualification-style",
            "No finite train-only style overlap is available",
        )
    dominant_style = (
        factor_claim["knownStyle"]
        if factor_claim["claim"] == "known-style-validation"
        else min(
            finite,
            key=lambda item: (-abs(float(item[1])), item[0]),
        )[0]
    )
    style_panel = styles[dominant_style].reindex_like(factor_panel)
    residual_panel = cross_sectional_rank_residual(
        factor_panel,
        style_panel,
        minimum_assets=MIN_ASSETS_PER_DATE,
    )
    blend_panel = equal_rank_blend(factor_panel, style_panel)
    panels = {
        "candidate": factor_panel,
        "dominant_style": style_panel,
        "style_neutral_candidate": residual_panel,
        "equal_rank_blend": blend_panel,
    }
    daily = {
        signal: {
            horizon: daily_rank_correlation(
                panel,
                outcome_panels[horizon],
                minimum_assets=MIN_ASSETS_PER_DATE,
                constant_left_value=(
                    0.0
                    if signal == "style_neutral_candidate"
                    else None
                ),
            )
            for horizon in HORIZONS
        }
        for signal, panel in panels.items()
    }
    horizon_quality = {
        str(horizon): {
            split: {
                signal: _split_metrics(
                    _masked(
                        daily[signal][horizon],
                        split_masks[horizon][split],
                    )
                )
                for signal in panels
            }
            for split in ("train", "validation", "test")
        }
        for horizon in HORIZONS
    }
    residual_folds = {
        name: descriptive_ic(
            _masked(
                daily["style_neutral_candidate"][PRIMARY_HORIZON],
                mask,
            )
        )
        for name, mask in fold_masks.items()
    }
    candidate_folds = {
        name: descriptive_ic(
            _masked(
                daily["candidate"][PRIMARY_HORIZON],
                mask,
            )
        )
        for name, mask in fold_masks.items()
    }
    evidence = pd.DataFrame(
        {
            "split": split_labels,
            "dominant_style": dominant_style,
        },
        index=factor_panel.index,
    )
    for horizon in HORIZONS:
        eligible = (
            split_masks[horizon]["train"]
            | split_masks[horizon]["validation"]
            | split_masks[horizon]["test"]
        )
        for signal in panels:
            evidence[f"{signal}_rank_ic_h{horizon}"] = (
                daily[signal][horizon]
                .reindex(factor_panel.index)
                .where(eligible)
            )
    evidence.index.name = "timestamp"
    return {
        "method": "request-claim-aware-one-style-rank-neutralization-v2",
        "claim": factor_claim,
        "selection": {
            "split": "train",
            "criterion": (
                "request-predeclared-known-style"
                if factor_claim["claim"] == "known-style-validation"
                else "maximum-absolute-mean-daily-rank-overlap"
            ),
            "dominant_style": dominant_style,
            "candidates": candidates,
            "validation_enters_selection": False,
            "test_enters_selection": False,
        },
        "semantics": {
            "neutralization": (
                "same-timestamp-cross-sectional-centered-rank-ols"
            ),
            "blend": "equal-weight-cross-sectional-percentile-ranks",
            "target_enters_neutralization": False,
            "selection_authority": "research-context-only",
            "trading_authority": "none",
        },
        "horizon_quality": horizon_quality,
        "stability": {
            "candidate_chronological_folds": candidate_folds,
            "style_neutral_chronological_folds": residual_folds,
        },
    }, evidence


def _temporal_factor_qualification(
    factor_panel: pd.DataFrame,
    styles: dict[str, pd.DataFrame],
    outcome_panels: dict[int, pd.DataFrame],
    split_masks: dict[int, dict[str, pd.Series]],
    fold_masks: dict[str, pd.Series],
    split_labels: pd.Series,
    style_correlations: dict[str, dict[str, Any]],
    factor_claim: dict[str, Any],
) -> tuple[dict[str, Any], pd.DataFrame]:
    """Qualify one request-authorized asset by association across time."""

    candidates = {
        name: {
            "mean_rank_correlation": style_correlations["train"][name][
                "mean_rank_correlation"
            ],
            "mean_absolute_rank_correlation": style_correlations["train"][
                name
            ]["mean_absolute_rank_correlation"],
            "observations": style_correlations["train"][name]["observations"],
        }
        for name in STYLE_NAMES
    }
    finite = [
        (name, value["mean_rank_correlation"])
        for name, value in candidates.items()
        if value["mean_rank_correlation"] is not None
    ]
    if not finite:
        raise JudgeFailure(
            "factor.qualification-style",
            "No finite train-only temporal style overlap is available",
        )
    dominant_style = min(
        finite,
        key=lambda item: (-abs(float(item[1])), item[0]),
    )[0]
    style_panel = styles[dominant_style].reindex_like(factor_panel)
    residual_panel, blend_panel = _temporal_transform_panels(
        factor_panel,
        style_panel,
        split_masks[PRIMARY_HORIZON],
    )
    panels = {
        "candidate": factor_panel,
        "dominant_style": style_panel,
        "style_neutral_candidate": residual_panel,
        "equal_rank_blend": blend_panel,
    }
    daily = {
        signal: {
            horizon: _temporal_daily(
                panel,
                outcome_panels[horizon],
                split_masks[horizon],
                rank=True,
                constant_left_value=(
                    0.0
                    if signal == "style_neutral_candidate"
                    else None
                ),
            )
            for horizon in HORIZONS
        }
        for signal, panel in panels.items()
    }
    horizon_quality = {
        str(horizon): {
            split: {
                signal: _temporal_split_metrics(
                    _masked(
                        daily[signal][horizon],
                        split_masks[horizon][split],
                    ),
                    horizon=horizon,
                )
                for signal in panels
            }
            for split in ("train", "validation", "test")
        }
        for horizon in HORIZONS
    }

    def fold_quality(panel: pd.DataFrame) -> dict[str, dict[str, Any]]:
        return {
            name: _temporal_split_metrics(
                _temporal_correlation_contributions(
                    panel.iloc[:, 0],
                    outcome_panels[PRIMARY_HORIZON].iloc[:, 0],
                    mask,
                    rank=True,
                    constant_left_value=(
                        0.0 if panel is residual_panel else None
                    ),
                ),
                horizon=PRIMARY_HORIZON,
            )
            for name, mask in fold_masks.items()
        }

    candidate_folds = fold_quality(factor_panel)
    residual_folds = fold_quality(residual_panel)
    evidence = pd.DataFrame(
        {
            "split": split_labels,
            "dominant_style": dominant_style,
        },
        index=factor_panel.index,
    )
    for horizon in HORIZONS:
        eligible = (
            split_masks[horizon]["train"]
            | split_masks[horizon]["validation"]
            | split_masks[horizon]["test"]
        )
        for signal in panels:
            evidence[f"{signal}_rank_ic_h{horizon}"] = (
                daily[signal][horizon]
                .reindex(factor_panel.index)
                .where(eligible)
            )
    evidence.index.name = "timestamp"
    return {
        "method": TEMPORAL_QUALIFICATION_METHOD,
        "claim": factor_claim,
        "selection": {
            "split": "train",
            "criterion": "maximum-absolute-mean-temporal-rank-overlap",
            "dominant_style": dominant_style,
            "candidates": candidates,
            "validation_enters_selection": False,
            "test_enters_selection": False,
        },
        "semantics": {
            "neutralization": "within-split-temporal-centered-rank-ols",
            "blend": "equal-weight-within-split-temporal-percentile-ranks",
            "target_enters_neutralization": False,
            "selection_authority": "research-context-only",
            "trading_authority": "none",
        },
        "horizon_quality": horizon_quality,
        "stability": {
            "candidate_chronological_folds": candidate_folds,
            "style_neutral_chronological_folds": residual_folds,
        },
    }, evidence


def _evaluate() -> tuple[
    dict[str, Any],
    dict[str, Any],
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    dict[str, Any] | None,
]:
    global HORIZONS, PRIMARY_HORIZON
    study, data_root = _load_contract()
    research_horizon = _load_horizon()
    factor_claim = _load_factor_claim()
    outcome_kind = factor_outcome(factor_claim)
    outcome_contract = factor_outcome_contract(factor_claim)
    HORIZONS = tuple(research_horizon["diagnosticForwardBars"])
    PRIMARY_HORIZON = int(research_horizon["primaryForwardBars"])
    dataset = study["dataset"]
    universe = dataset["universe"]
    (
        prediction_population,
        prediction_assets,
        context_assets,
        prediction_authority,
        evaluation_mode,
    ) = _load_prediction_universe(universe, factor_claim)
    if (
        outcome_kind != FORWARD_RETURN_OUTCOME
        and evaluation_mode == TWO_ASSET_RELATIVE_VALUE_MODE
    ):
        raise JudgeFailure(
            "factor.outcome-relative-value",
            "Forward realized volatility does not define a two-asset "
            "relative-value target contrast",
        )
    minimum_evaluation_assets = (
        1
        if evaluation_mode == SINGLE_ASSET_TEMPORAL_MODE
        else (
            2
            if evaluation_mode == TWO_ASSET_RELATIVE_VALUE_MODE
            else MIN_ASSETS_PER_DATE
        )
    )
    time_range = dataset["time_range"]
    module = importlib.import_module("factors.candidate")
    frames: dict[str, pd.DataFrame] = {}
    close_by_asset: dict[str, pd.Series] = {}
    volume_by_asset: dict[str, pd.Series] = {}
    for asset in universe:
        frame = _load_asset(
            data_root,
            asset,
            time_range["start"],
            time_range["end"],
        )
        frames[asset] = frame
        timestamp = pd.DatetimeIndex(frame["timestamp"])
        close = frame["close"].copy()
        close.index = timestamp
        volume = frame["volume"].copy()
        volume.index = timestamp
        close_by_asset[asset] = close
        volume_by_asset[asset] = volume

    try:
        panel = build_factor_panel(frames, universe=universe)
        factor_evaluation = evaluate_factor(module, panel)
        factor_panel = values_to_wide(
            panel,
            factor_evaluation.values,
            universe=universe,
        )
    except FactorRuntimeError as error:
        raise JudgeFailure(error.code, str(error)) from error
    coverage = {
        asset: float(
            factor_evaluation.values.loc[panel["asset"] == asset].notna().mean()
        )
        for asset in universe
    }
    source_factor_panel = factor_panel
    source_close_panel = pd.DataFrame(close_by_asset).reindex(
        source_factor_panel.index
    )
    source_volume_panel = pd.DataFrame(volume_by_asset).reindex(
        source_factor_panel.index
    )
    research_factor_panel = source_factor_panel
    research_close_panel = source_close_panel
    research_volume_panel = source_volume_panel
    if evaluation_mode == SINGLE_ASSET_TEMPORAL_MODE:
        prediction_timeline = pd.DatetimeIndex(
            close_by_asset[prediction_assets[0]].index
        )
        research_factor_panel = research_factor_panel.reindex(
            prediction_timeline
        )
        research_close_panel = research_close_panel.reindex(
            prediction_timeline
        )
        research_volume_panel = research_volume_panel.reindex(
            prediction_timeline
        )
    factor_panel = research_factor_panel[prediction_assets]
    close_panel = research_close_panel[prediction_assets]
    timeline = pd.DatetimeIndex(research_factor_panel.index)
    split_masks, split_protocol, base_split_labels = purged_split_masks(
        timeline,
        HORIZONS,
    )
    fold_masks, fold_protocol = chronological_fold_masks(
        timeline,
        PRIMARY_HORIZON,
    )
    outcome_panels = factor_outcome_panels(
        close_panel,
        outcome_kind,
        HORIZONS,
    )
    if evaluation_mode == TWO_ASSET_RELATIVE_VALUE_MODE:
        association_factor_panel = _relative_value_spread_panel(
            factor_panel,
            prediction_assets,
        )
        association_outcome_panels = {
            horizon: _relative_value_spread_panel(
                outcome_panels[horizon],
                prediction_assets,
            )
            for horizon in HORIZONS
        }
    else:
        association_factor_panel = factor_panel
        association_outcome_panels = outcome_panels
    if evaluation_mode in TEMPORAL_EVALUATION_MODES:
        _preflight_temporal_primary_validation(
            association_factor_panel,
            association_outcome_panels[PRIMARY_HORIZON],
            split_masks[PRIMARY_HORIZON]["validation"],
            evaluation_mode=evaluation_mode,
            horizon=PRIMARY_HORIZON,
        )
    source_input_counts = source_close_panel.notna().sum(axis=1).astype(int)
    source_factor_counts = source_factor_panel.notna().sum(axis=1).astype(int)
    input_counts = close_panel.notna().sum(axis=1).astype(int)
    factor_counts = factor_panel.notna().sum(axis=1).astype(int)
    paired_counts = {
        horizon: (
            factor_panel.notna() & outcome_panels[horizon].notna()
        ).sum(axis=1).astype(int)
        for horizon in HORIZONS
    }
    source_timeline = pd.DatetimeIndex(source_factor_panel.index)
    source_paired_counts = {
        horizon: paired_counts[horizon]
        .reindex(source_timeline)
        .fillna(0)
        .astype(int)
        for horizon in HORIZONS
    }
    possible_rows = int(len(source_timeline) * len(universe))
    observed_rows = int(source_input_counts.sum())
    prediction_possible_rows = int(len(timeline) * len(prediction_assets))
    prediction_observed_rows = int(input_counts.sum())
    input_availability = {
        "method": "observed-only-no-fill-v1",
        "missing_observation": "absent-no-fill",
        "timestamps": int(len(source_timeline)),
        "observed_rows": observed_rows,
        "possible_rows": possible_rows,
        "observation_coverage": float(
            observed_rows / possible_rows
        ),
        "complete_timestamps": int(
            source_input_counts.eq(len(universe)).sum()
        ),
        "prediction_universe": {
            "authority": prediction_authority,
            "assets": prediction_assets,
            "context_assets": context_assets,
            "observed_rows": prediction_observed_rows,
            "possible_rows": prediction_possible_rows,
            "observation_coverage": float(
                prediction_observed_rows / prediction_possible_rows
            ),
            "complete_timestamps": int(
                input_counts.eq(len(prediction_assets)).sum()
            ),
            "timeline_timestamps": int(len(timeline)),
        },
        "eligible_factor_timestamps": {
            str(horizon): int(
                paired_counts[horizon]
                .ge(minimum_evaluation_assets)
                .sum()
            )
            for horizon in HORIZONS
        },
        "minimum_assets_per_factor_timestamp": minimum_evaluation_assets,
        "assets_per_timestamp": {
            "input": _count_summary(source_input_counts),
            "factor": _count_summary(source_factor_counts),
            "primary_pair": _count_summary(
                source_paired_counts[PRIMARY_HORIZON]
            ),
        },
        "by_asset": {
            asset: {
                "observations": int(
                    source_close_panel[asset].notna().sum()
                ),
                "start": timestamp_label(
                    source_close_panel[asset].dropna().index[0]
                ),
                "end": timestamp_label(
                    source_close_panel[asset].dropna().index[-1]
                ),
                "input_coverage": float(
                    source_close_panel[asset].notna().mean()
                ),
                "factor_coverage": coverage[asset],
            }
            for asset in universe
        },
    }
    components = factor_evaluation.components
    component_declarations = (
        components.declaration() if components is not None else None
    )
    component_panels = (
        {
            name: values_to_wide(
                panel,
                components.values[name],
                universe=universe,
            )[prediction_assets]
            for name in components.values.columns
        }
        if components is not None
        else {}
    )
    component_coverage = (
        {
            name: {
                asset: float(
                    components.values.loc[
                        panel["asset"] == asset,
                        name,
                    ].notna().mean()
                )
                for asset in universe
            }
            for name in components.values.columns
        }
        if components is not None
        else {}
    )
    component_evidence = (
        _component_evidence(
            component_declarations,
            component_panels,
            (
                association_factor_panel
                if evaluation_mode in TEMPORAL_EVALUATION_MODES
                else factor_panel
            ),
            (
                association_outcome_panels
                if evaluation_mode in TEMPORAL_EVALUATION_MODES
                else outcome_panels
            ),
            split_masks,
            component_coverage,
            evaluation_mode,
            outcome_contract,
        )
        if component_declarations is not None
        else None
    )
    if evaluation_mode in TEMPORAL_EVALUATION_MODES:
        daily_ic_by_horizon = {
            horizon: _temporal_daily(
                association_factor_panel,
                association_outcome_panels[horizon],
                split_masks[horizon],
                rank=True,
            )
            for horizon in HORIZONS
        }
        daily_pearson_by_horizon = {
            horizon: _temporal_daily(
                association_factor_panel,
                association_outcome_panels[horizon],
                split_masks[horizon],
                rank=False,
            )
            for horizon in HORIZONS
        }
    else:
        daily_ic_by_horizon = {
            horizon: daily_rank_correlation(
                factor_panel,
                outcome_panels[horizon],
                minimum_assets=MIN_ASSETS_PER_DATE,
            )
            for horizon in HORIZONS
        }
        daily_pearson_by_horizon = {
            horizon: daily_pearson_correlation(
                factor_panel,
                outcome_panels[horizon],
                minimum_assets=MIN_ASSETS_PER_DATE,
            )
            for horizon in HORIZONS
        }
    horizon_metrics = {
        str(horizon): {
            split: {
                **(
                    _temporal_split_metrics(
                        _masked(
                            daily_ic_by_horizon[horizon],
                            split_masks[horizon][split],
                        ),
                        horizon=horizon,
                    )
                    if evaluation_mode in TEMPORAL_EVALUATION_MODES
                    else _split_metrics(
                        _masked(
                            daily_ic_by_horizon[horizon],
                            split_masks[horizon][split],
                        )
                    )
                ),
                "pearson_ic": (
                    _temporal_split_metrics(
                        _masked(
                            daily_pearson_by_horizon[horizon],
                            split_masks[horizon][split],
                        ),
                        horizon=horizon,
                    )
                    if evaluation_mode in TEMPORAL_EVALUATION_MODES
                    else _split_metrics(
                        _masked(
                            daily_pearson_by_horizon[horizon],
                            split_masks[horizon][split],
                        )
                    )
                ),
            }
            for split in ("train", "validation", "test")
        }
        for horizon in HORIZONS
    }
    splits = horizon_metrics[str(PRIMARY_HORIZON)]
    validation_mean_ic = float(splits["validation"]["mean_ic"])

    quantile_daily = (
        {
            horizon: pd.DataFrame(
                columns=["low", "middle", "high", "high_minus_low"],
                index=pd.DatetimeIndex([], name="timestamp"),
                dtype=float,
            )
            for horizon in HORIZONS
        }
        if evaluation_mode in TEMPORAL_EVALUATION_MODES
        else {
            horizon: daily_quantile_outcomes(
                factor_panel,
                outcome_panels[horizon],
                minimum_assets=MIN_ASSETS_PER_DATE,
            )
            for horizon in HORIZONS
        }
    )
    quantile_analysis = {
        str(horizon): {
            split: quantile_summary(
                quantile_daily[horizon].reindex(
                    split_masks[horizon][split].index[
                        split_masks[horizon][split]
                    ]
                )
            )
            for split in ("train", "validation", "test")
        }
        for horizon in HORIZONS
    }

    primary_ic = daily_ic_by_horizon[PRIMARY_HORIZON]
    chronological_folds = (
        {
            name: _temporal_split_metrics(
                _temporal_correlation_contributions(
                    association_factor_panel.iloc[:, 0],
                    association_outcome_panels[PRIMARY_HORIZON].iloc[:, 0],
                    mask,
                    rank=True,
                ),
                horizon=PRIMARY_HORIZON,
            )
            for name, mask in fold_masks.items()
        }
        if evaluation_mode in TEMPORAL_EVALUATION_MODES
        else {
            name: descriptive_ic(_masked(primary_ic, mask))
            for name, mask in fold_masks.items()
        }
    )
    regimes = causal_regime_labels(research_close_panel)
    regime_stability = {
        split: {
            regime: descriptive_ic(
                _masked(
                    primary_ic,
                    split_masks[PRIMARY_HORIZON][split]
                    & regimes.eq(regime).fillna(False),
                )
            )
            for regime in REGIME_NAMES
        }
        for split in ("train", "validation", "test")
    }
    prediction_style_panels = {
        name: values[prediction_assets]
        for name, values in style_proxy_panels(
            research_close_panel,
            research_volume_panel,
        ).items()
    }
    styles = (
        {
            name: _relative_value_spread_panel(
                values,
                prediction_assets,
            )
            for name, values in prediction_style_panels.items()
        }
        if evaluation_mode == TWO_ASSET_RELATIVE_VALUE_MODE
        else prediction_style_panels
    )
    style_correlations: dict[str, dict[str, Any]] = {
        split: {}
        for split in ("train", "validation", "test")
    }
    for style in STYLE_NAMES:
        daily_style = (
            _temporal_daily(
                association_factor_panel,
                styles[style],
                split_masks[PRIMARY_HORIZON],
                rank=True,
            )
            if evaluation_mode in TEMPORAL_EVALUATION_MODES
            else daily_rank_correlation(
                factor_panel,
                styles[style],
                minimum_assets=MIN_ASSETS_PER_DATE,
            )
        )
        for split in style_correlations:
            style_correlations[split][style] = _style_summary(
                _masked(
                    daily_style,
                    split_masks[PRIMARY_HORIZON][split],
                )
            )
    qualification_builder = (
        _temporal_factor_qualification
        if evaluation_mode in TEMPORAL_EVALUATION_MODES
        else _factor_qualification
    )
    factor_qualification, qualification_evidence = qualification_builder(
        association_factor_panel,
        styles,
        association_outcome_panels,
        split_masks,
        fold_masks,
        base_split_labels,
        style_correlations,
        factor_claim,
    )
    per_asset_stability = {
        split: per_asset_rank_correlation(
            factor_panel,
            outcome_panels[PRIMARY_HORIZON],
            split_masks[PRIMARY_HORIZON][split],
        )
        for split in ("train", "validation", "test")
    }

    ranked = (
        association_factor_panel.rank(method="average", pct=True)
        if evaluation_mode in TEMPORAL_EVALUATION_MODES
        else association_factor_panel.rank(axis=1, pct=True)
    )
    turnover = float(ranked.diff().abs().mean(axis=1).dropna().mean())
    metrics = {
        "validation_mean_ic": validation_mean_ic,
        "factor_api": factor_contract(factor_evaluation),
        "research_horizon": research_horizon,
        "factor_claim": factor_claim,
        "factor_outcome": outcome_contract,
        "prediction_universe": prediction_population,
        "train": splits["train"],
        "validation": splits["validation"],
        "test": splits["test"],
        "horizon_quality": horizon_metrics,
        "factor_decay": _decay_summary(horizon_metrics),
        "quantile_analysis": quantile_analysis,
        "stability": {
            "chronological_folds": chronological_folds,
            "causal_regimes": regime_stability,
            "per_asset": per_asset_stability,
        },
        "style_correlations": style_correlations,
        "factor_qualification": factor_qualification,
        "split_protocol": {
            **split_protocol,
            "folds": fold_protocol,
        },
        "mean_coverage": float(sum(coverage.values()) / len(coverage)),
        "input_availability": input_availability,
        "mean_rank_turnover": turnover,
        "assets": int(len(universe)),
        "prediction_assets": int(len(prediction_assets)),
        "ic_dates": int(len(primary_ic)),
        "research_integrity": {
            "selection_split": "validation",
            "test_role": "visible-diagnostic",
            "test_enters_selection": False,
            "external_holdout_rule": (
                "required-after-visible-test-and-candidate-iteration"
            ),
        },
    }
    if component_evidence is not None:
        metrics["factor_components"] = component_evidence
    if not all(
        math.isfinite(float(value))
        for value in (
            validation_mean_ic,
            metrics["mean_coverage"],
            metrics["mean_rank_turnover"],
        )
    ):
        raise JudgeFailure("judge.non-finite", "Judge produced non-finite metrics")
    report = {
        "schemaVersion": 1,
        "inputHash": os.environ["AUTOQUANT_INPUT_HASH"],
        "dataset": {
            "id": dataset["id"],
            "version": dataset["version"],
            "universe": universe,
            "predictionAssets": prediction_assets,
            "contextAssets": context_assets,
            "timeRange": time_range,
        },
        "researchHorizon": research_horizon,
        "semantics": {
            "target": outcome_contract["targetSemantics"],
            "outcome": outcome_contract,
            "measure": (
                (
                    "within-split temporal Spearman and Pearson correlation "
                    "contributions for the single request-authorized asset"
                )
                if evaluation_mode == SINGLE_ASSET_TEMPORAL_MODE
                else (
                    "within-split temporal Spearman and Pearson correlation "
                    "contributions between the first-minus-second factor "
                    "contrast and first-minus-second forward-return contrast"
                    if evaluation_mode == TWO_ASSET_RELATIVE_VALUE_MODE
                    else (
                        "per-date cross-sectional Spearman rank IC and Pearson IC "
                        f"over the fixed {prediction_authority} evaluation universe"
                    )
                )
            ),
            "researchUniverse": (
                "complete Study universe available to candidate features"
            ),
            "predictionUniverse": (
                "caller-owned factorPolicy.predictionAssets for request-"
                "bound decision-signal claims; complete research universe "
                "for novel-factor and known-style-validation claims"
            ),
            "horizons": list(HORIZONS),
            "primaryHorizon": PRIMARY_HORIZON,
            "split": (
                "dataset-fixed chronological 60/20/20 with horizon-specific "
                "boundary purge"
            ),
            "score": (
                "validation mean rank IC at the fixed primary "
                f"{PRIMARY_HORIZON}-bar horizon only"
            ),
            "inference": (
                (
                    "Newey-West/Bartlett HAC mean t-statistic with maximum "
                    "lag equal to each forward horizon and two-sided normal-"
                    "approximation p-value"
                )
                if evaluation_mode in TEMPORAL_EVALUATION_MODES
                else (
                    "Newey-West/Bartlett HAC mean t-statistic with maximum "
                    "lag 5 and two-sided normal-approximation p-value"
                )
            ),
            "quantiles": (
                "unavailable-for-temporal-evaluation-v1"
                if evaluation_mode in TEMPORAL_EVALUATION_MODES
                else "fixed low/middle/high cross-sectional groups"
            ),
            "regimes": (
                "causal trailing market direction and volatility versus "
                "lagged rolling threshold"
            ),
            "styles": list(STYLE_NAMES),
            "qualification": {
                "method": factor_qualification["method"],
                "claim": factor_claim,
                "styleSelection": (
                    "request-predeclared"
                    if factor_claim["claim"] == "known-style-validation"
                    else "train-only"
                ),
                "neutralization": factor_qualification["semantics"][
                    "neutralization"
                ],
                "blend": factor_qualification["semantics"]["blend"],
                "testRole": "visible audit only",
                "tradingAuthority": "none",
            },
            "components": (
                {
                    "method": component_evidence["method"],
                    "evaluationMode": component_evidence["semantics"][
                        "evaluation_mode"
                    ],
                    "scoreMeasure": component_evidence["semantics"][
                        "score_measure"
                    ],
                    "predictionTarget": component_evidence["semantics"][
                        "prediction_target"
                    ],
                    "declaration": "candidate-explicit-not-source-inferred",
                    "roles": [
                        "cross-sectional-score",
                        "timestamp-context",
                    ],
                    "exhaustiveCompositionClaim": False,
                    "nearestPeerSelection": "train-only-target-free",
                    "ablationTarget": (
                        "fixed-diagnostic-blend-not-candidate-factor"
                    ),
                    "residualization": component_evidence["semantics"][
                        "residualization"
                    ],
                    "diagnosticBlend": component_evidence["semantics"][
                        "diagnostic_blend"
                    ],
                    "timestampContext": component_evidence["semantics"][
                        "timestamp_context"
                    ],
                    "testRole": "visible audit only",
                    "portfolioAuthority": "none",
                    "rlActionAuthority": "none",
                    "tradingAuthority": "none",
                }
                if component_evidence is not None
                else None
            ),
            "testRole": (
                "visible diagnostic evidence; never enters candidate selection"
            ),
        },
        "causalityAuditCuts": list(factor_evaluation.causality_cuts),
        "componentCausalityAuditCuts": (
            list(factor_evaluation.causality_cuts)
            if component_evidence is not None
            else []
        ),
        "coverageByAsset": coverage,
        "inputAvailability": input_availability,
        "splitProtocol": split_protocol,
        "foldProtocol": fold_protocol,
        "metrics": metrics,
    }
    daily_evidence = pd.DataFrame(
        {
            "split": base_split_labels,
            "regime": regimes.fillna("unavailable"),
        },
        index=timeline,
    )
    for horizon in HORIZONS:
        eligible = (
            split_masks[horizon]["train"]
            | split_masks[horizon]["validation"]
            | split_masks[horizon]["test"]
        )
        daily_evidence[f"rank_ic_h{horizon}"] = (
            daily_ic_by_horizon[horizon].reindex(timeline).where(eligible)
        )
        daily_evidence[f"pearson_ic_h{horizon}"] = (
            daily_pearson_by_horizon[horizon].reindex(timeline).where(eligible)
        )
    daily_evidence.index.name = "timestamp"
    availability_evidence = pd.DataFrame(
        {
            "input_assets": source_input_counts,
            "factor_assets": source_factor_counts,
            **{
                f"paired_assets_h{horizon}": source_paired_counts[horizon]
                for horizon in HORIZONS
            },
        },
        index=source_timeline,
    )
    availability_evidence.index.name = "timestamp"

    quantile_rows: list[dict[str, Any]] = []
    for horizon in HORIZONS:
        for split in ("train", "validation", "test"):
            selected = quantile_daily[horizon].reindex(
                split_masks[horizon][split].index[
                    split_masks[horizon][split]
                ]
            ).dropna()
            for timestamp, row in selected.iterrows():
                quantile_rows.append(
                    {
                        "timestamp": timestamp,
                        "split": split,
                        "horizon": horizon,
                        "low": float(row["low"]),
                        "middle": float(row["middle"]),
                        "high": float(row["high"]),
                        "high_minus_low": float(row["high_minus_low"]),
                    }
                )
    quantile_evidence = pd.DataFrame(
        quantile_rows,
        columns=[
            "timestamp",
            "split",
            "horizon",
            "low",
            "middle",
            "high",
            "high_minus_low",
        ],
    )
    return (
        metrics,
        report,
        daily_evidence,
        quantile_evidence,
        qualification_evidence,
        availability_evidence,
        (
            {
                "schemaVersion": 1,
                "inputHash": os.environ["AUTOQUANT_INPUT_HASH"],
                "evidence": component_evidence,
            }
            if component_evidence is not None
            else None
        ),
    )


def main() -> None:
    try:
        (
            metrics,
            report,
            daily_evidence,
            quantile_evidence,
            qualification_evidence,
            availability_evidence,
            component_evidence,
        ) = _evaluate()
        artifacts = Path(os.environ["AUTOQUANT_ARTIFACTS_DIR"])
        report_path = artifacts / "factor-report.json"
        report_path.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        daily_artifact = daily_evidence.copy()
        daily_artifact.index = [
            timestamp_label(value) for value in daily_artifact.index
        ]
        daily_artifact.index.name = "timestamp"
        quantile_artifact = quantile_evidence.copy()
        quantile_artifact["timestamp"] = quantile_artifact["timestamp"].map(
            timestamp_label
        )
        qualification_artifact = qualification_evidence.copy()
        qualification_artifact.index = [
            timestamp_label(value) for value in qualification_artifact.index
        ]
        qualification_artifact.index.name = "timestamp"
        availability_artifact = availability_evidence.copy()
        availability_artifact.index = [
            timestamp_label(value)
            for value in availability_artifact.index
        ]
        availability_artifact.index.name = "timestamp"
        daily_artifact.to_csv(
            artifacts / "daily-factor-evidence.csv",
            float_format="%.17g",
        )
        quantile_artifact.to_csv(
            artifacts / "factor-quantiles.csv",
            index=False,
            float_format="%.17g",
        )
        qualification_artifact.to_csv(
            artifacts / "factor-qualification.csv",
            float_format="%.17g",
        )
        availability_artifact.to_csv(
            artifacts / "factor-availability.csv",
        )
        if component_evidence is not None:
            (artifacts / "factor-components.json").write_text(
                json.dumps(component_evidence, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
        output_artifacts = [
            {
                "kind": "factor-report",
                "path": "factor-report.json",
                "description": (
                    "Factor semantics, purged split protocol, complete "
                    "tear sheet, coverage, and causality audit"
                ),
            },
            {
                "kind": "factor-daily",
                "path": "daily-factor-evidence.csv",
                "description": (
                    "Timestamped split, causal regime, and purge-aware "
                    "request-bound outcome rank and Pearson IC"
                ),
            },
            {
                "kind": "factor-quantiles",
                "path": "factor-quantiles.csv",
                "description": (
                    "Timestamped fixed-tertile outcome levels and "
                    "high-minus-low outcome spread by split and horizon"
                ),
            },
            {
                "kind": "factor-availability",
                "path": "factor-availability.csv",
                "description": (
                    "Per-timestamp observed input, finite factor, and "
                    "horizon-paired cross-sectional asset counts"
                ),
            },
            {
                "kind": "factor-qualification",
                "path": "factor-qualification.csv",
                "description": (
                    "Train-selected style, candidate/style/residual/"
                    "blend daily rank IC, and visible-test audit"
                ),
            },
        ]
        if component_evidence is not None:
            output_artifacts.append(
                {
                    "kind": "factor-components",
                    "path": "factor-components.json",
                    "description": (
                        "Candidate-declared component quality, redundancy, "
                        "nearest-peer residual, and fixed-blend ablation evidence"
                    ),
                }
            )
        _write_output(
            {
                "schema_version": 1,
                "status": "succeeded",
                "summary": (
                    "Causal purge-aware factor tear sheet completed; "
                    f"{metrics['factor_outcome']['kind']} validation "
                    f"{PRIMARY_HORIZON}-bar mean "
                    "rank IC="
                    f"{metrics['validation_mean_ic']:.6f}"
                ),
                "metrics": metrics,
                "artifacts": output_artifacts,
                "errors": [],
            }
        )
    except JudgeFailure as error:
        scientific_limit_codes = {
            "factor.temporal-primary-observations",
            "factor.temporal-primary-candidate-variation",
            "factor.temporal-primary-target-variation",
        }
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "failure_disposition": (
                    "scientific-limit"
                    if error.code in scientific_limit_codes
                    else "repair-required"
                ),
                "summary": str(error),
                "metrics": {},
                "artifacts": [],
                "errors": [{"code": error.code, "message": str(error)}],
            }
        )
    except Exception as error:  # Preserve candidate/Judge diagnostics as evidence.
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "failure_disposition": "repair-required",
                "summary": f"Factor evaluation raised {type(error).__name__}",
                "metrics": {},
                "artifacts": [],
                "errors": [
                    {
                        "code": "factor.exception",
                        "message": f"{type(error).__name__}: {error}",
                    }
                ],
            }
        )


if __name__ == "__main__":
    main()
