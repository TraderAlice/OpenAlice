"""Fixed, causal diagnostics for the OHLCV Factor Lab."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from autoquant.intervals import timestamp_label

HORIZONS = (1, 5, 10)
SPLIT_NAMES = ("train", "validation", "test")
REGIME_NAMES = ("up-calm", "up-stressed", "down-calm", "down-stressed")
STYLE_NAMES = (
    "momentum_20",
    "reversal_5",
    "realized_volatility_20",
    "relative_volume_20",
)


def _ranges(length: int) -> dict[str, tuple[int, int]]:
    train_end = int(length * 0.60)
    validation_end = int(length * 0.80)
    return {
        "train": (0, train_end),
        "validation": (train_end, validation_end),
        "test": (validation_end, length),
    }


def purged_split_masks(
    index: pd.DatetimeIndex,
    horizons: tuple[int, ...] = HORIZONS,
) -> tuple[
    dict[int, dict[str, pd.Series]],
    dict[str, Any],
    pd.Series,
]:
    """Build dataset-fixed masks whose targets cannot cross split boundaries."""

    if not index.is_monotonic_increasing or index.has_duplicates:
        raise ValueError("Diagnostic index must be unique and chronological")
    ranges = _ranges(len(index))
    positions = np.arange(len(index))
    base_labels = pd.Series("unassigned", index=index, dtype="object")
    protocol: dict[str, Any] = {
        "method": "dataset-fixed-chronological-60-20-20",
        "candidateDependent": False,
        "targetCrossesBoundary": False,
        "horizons": {},
        "splits": {},
    }
    for name, (start, stop) in ranges.items():
        if stop <= start:
            raise ValueError(f"Chronological split {name} is empty")
        base_labels.iloc[start:stop] = name
        protocol["splits"][name] = {
            "start": timestamp_label(index[start]),
            "end": timestamp_label(index[stop - 1]),
            "rows": stop - start,
        }

    masks: dict[int, dict[str, pd.Series]] = {}
    for horizon in horizons:
        if not isinstance(horizon, int) or horizon <= 0:
            raise ValueError("Forward horizons must be positive integers")
        masks[horizon] = {}
        horizon_protocol: dict[str, Any] = {}
        for name, (start, stop) in ranges.items():
            if stop - start <= horizon:
                raise ValueError(
                    f"Chronological split {name} is too short for horizon {horizon}"
                )
            eligible = (positions >= start) & (positions + horizon < stop)
            mask = pd.Series(eligible, index=index, dtype=bool)
            masks[horizon][name] = mask
            signal_positions = positions[eligible]
            horizon_protocol[name] = {
                "signalStart": timestamp_label(index[signal_positions[0]]),
                "signalEnd": timestamp_label(index[signal_positions[-1]]),
                "targetEnd": timestamp_label(
                    index[signal_positions[-1] + horizon]
                ),
                "eligibleSignalRows": int(eligible.sum()),
                "purgedBoundaryRows": horizon,
            }
        protocol["horizons"][str(horizon)] = horizon_protocol
    return masks, protocol, base_labels


def chronological_fold_masks(
    index: pd.DatetimeIndex,
    horizon: int = 1,
) -> tuple[dict[str, pd.Series], dict[str, dict[str, Any]]]:
    """Split each fixed chronological partition in half and purge each fold."""

    positions = np.arange(len(index))
    masks: dict[str, pd.Series] = {}
    protocol: dict[str, dict[str, Any]] = {}
    for split, (start, stop) in _ranges(len(index)).items():
        middle = start + (stop - start) // 2
        for number, (fold_start, fold_stop) in enumerate(
            ((start, middle), (middle, stop)),
            start=1,
        ):
            name = f"{split}_{number}"
            eligible = (
                (positions >= fold_start)
                & (positions + horizon < fold_stop)
            )
            if not eligible.any():
                raise ValueError(f"Chronological fold {name} is empty")
            masks[name] = pd.Series(eligible, index=index, dtype=bool)
            selected = positions[eligible]
            protocol[name] = {
                "split": split,
                "start": timestamp_label(index[fold_start]),
                "end": timestamp_label(index[fold_stop - 1]),
                "signalEnd": timestamp_label(index[selected[-1]]),
                "targetEnd": timestamp_label(index[selected[-1] + horizon]),
                "eligibleSignalRows": int(eligible.sum()),
                "purgedBoundaryRows": horizon,
            }
    return masks, protocol


def forward_return_panels(
    closes: pd.DataFrame,
    horizons: tuple[int, ...] = HORIZONS,
) -> dict[int, pd.DataFrame]:
    return {
        horizon: closes.shift(-horizon) / closes - 1.0
        for horizon in horizons
    }


def forward_realized_volatility_panels(
    closes: pd.DataFrame,
    horizons: tuple[int, ...] = HORIZONS,
) -> dict[int, pd.DataFrame]:
    """Return complete-window, unannualized forward realized volatility.

    At signal close t and horizon h, the target is the square root of the sum
    of squared close-to-close log returns from t -> t+1 through t+h-1 -> t+h.
    A missing constituent return invalidates the whole target window.
    """

    log_returns = np.log(closes / closes.shift(1))
    output: dict[int, pd.DataFrame] = {}
    for horizon in horizons:
        future_squared = [
            log_returns.shift(-offset).pow(2)
            for offset in range(1, horizon + 1)
        ]
        squared_sum = sum(future_squared)
        complete = sum(item.notna().astype(int) for item in future_squared)
        output[horizon] = squared_sum.pow(0.5).where(complete == horizon)
    return output


def factor_outcome_panels(
    closes: pd.DataFrame,
    outcome: str,
    horizons: tuple[int, ...] = HORIZONS,
) -> dict[int, pd.DataFrame]:
    """Materialize one fixed Factor outcome over the requested horizons."""

    if outcome == "forward-return":
        return forward_return_panels(closes, horizons)
    if outcome == "forward-realized-volatility":
        return forward_realized_volatility_panels(closes, horizons)
    raise ValueError(f"Unsupported Factor outcome: {outcome}")


def daily_rank_correlation(
    left: pd.DataFrame,
    right: pd.DataFrame,
    *,
    minimum_assets: int = 4,
    constant_left_value: float | None = None,
) -> pd.Series:
    values: dict[pd.Timestamp, float] = {}
    for timestamp in left.index.intersection(right.index):
        pair = pd.DataFrame(
            {
                "left": left.loc[timestamp],
                "right": right.loc[timestamp],
            }
        ).dropna()
        if len(pair) < minimum_assets:
            continue
        if pair["right"].nunique() < 2:
            continue
        if pair["left"].nunique() < 2:
            if constant_left_value is not None:
                values[timestamp] = float(constant_left_value)
            continue
        value = pair["left"].rank(method="average").corr(
            pair["right"].rank(method="average")
        )
        if value is not None and math.isfinite(float(value)):
            values[timestamp] = float(value)
    return pd.Series(values, dtype=float).sort_index()


def daily_pearson_correlation(
    left: pd.DataFrame,
    right: pd.DataFrame,
    *,
    minimum_assets: int = 4,
) -> pd.Series:
    values: dict[pd.Timestamp, float] = {}
    for timestamp in left.index.intersection(right.index):
        pair = pd.DataFrame(
            {
                "left": left.loc[timestamp],
                "right": right.loc[timestamp],
            }
        ).dropna()
        if len(pair) < minimum_assets:
            continue
        if pair["left"].nunique() < 2 or pair["right"].nunique() < 2:
            continue
        value = pair["left"].corr(pair["right"])
        if value is not None and math.isfinite(float(value)):
            values[timestamp] = float(value)
    return pd.Series(values, dtype=float).sort_index()


def hac_inference(
    values: pd.Series,
    *,
    maximum_lag: int = 5,
) -> dict[str, float | int | None | str]:
    """Return deterministic Newey-West mean inference with Bartlett weights."""

    clean = values.dropna().astype(float)
    count = len(clean)
    lag = min(maximum_lag, max(0, count - 1))
    if count < 2:
        return {
            "method": "newey-west-bartlett",
            "maximum_lag": lag,
            "standard_error": None,
            "t_statistic": None,
            "normal_approximation_p_value": None,
        }
    array = clean.to_numpy(dtype=float)
    centered = array - float(array.mean())
    long_run_variance = float(np.dot(centered, centered) / count)
    for offset in range(1, lag + 1):
        covariance = float(
            np.dot(centered[offset:], centered[:-offset]) / count
        )
        weight = 1.0 - offset / (lag + 1.0)
        long_run_variance += 2.0 * weight * covariance
    long_run_variance = max(0.0, long_run_variance)
    standard_error = math.sqrt(long_run_variance / count)
    if standard_error <= 1e-12:
        t_statistic: float | None = None
        p_value: float | None = None
    else:
        t_statistic = float(array.mean()) / standard_error
        p_value = math.erfc(abs(t_statistic) / math.sqrt(2.0))
    return {
        "method": "newey-west-bartlett",
        "maximum_lag": lag,
        "standard_error": standard_error,
        "t_statistic": t_statistic,
        "normal_approximation_p_value": p_value,
    }


def descriptive_ic(
    values: pd.Series,
    *,
    minimum_observations: int = 3,
) -> dict[str, float | int | None | dict[str, Any]]:
    clean = values.dropna().astype(float)
    if len(clean) < minimum_observations:
        hac = hac_inference(clean)
        hac.update(
            {
                "standard_error": None,
                "t_statistic": None,
                "normal_approximation_p_value": None,
            }
        )
        return {
            "mean_ic": None,
            "standard_deviation": None,
            "icir": None,
            "hit_rate": None,
            "observations": int(len(clean)),
            "minimum_observations": minimum_observations,
            "sufficient": False,
            "hac": hac,
        }
    mean = float(clean.mean())
    standard_deviation = float(clean.std(ddof=0))
    return {
        "mean_ic": mean,
        "standard_deviation": standard_deviation,
        "icir": (
            mean / standard_deviation
            if standard_deviation > 1e-12
            else None
        ),
        "hit_rate": float((clean > 0).mean()),
        "observations": int(len(clean)),
        "minimum_observations": minimum_observations,
        "sufficient": True,
        "hac": hac_inference(clean),
    }


def daily_quantile_outcomes(
    factors: pd.DataFrame,
    returns: pd.DataFrame,
    *,
    minimum_assets: int = 4,
) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for timestamp in factors.index.intersection(returns.index):
        pair = pd.DataFrame(
            {
                "factor": factors.loc[timestamp],
                "outcome": returns.loc[timestamp],
            }
        ).dropna()
        if len(pair) < minimum_assets or pair["factor"].nunique() < 3:
            continue
        ordered = pair.sort_values(
            ["factor"],
            kind="mergesort",
        )
        groups = np.array_split(np.arange(len(ordered)), 3)
        low, middle, high = (
            float(ordered.iloc[group]["outcome"].mean())
            for group in groups
        )
        rows.append(
            {
                "timestamp": timestamp,
                "low": low,
                "middle": middle,
                "high": high,
                "high_minus_low": high - low,
            }
        )
    if not rows:
        return pd.DataFrame(
            columns=("low", "middle", "high", "high_minus_low"),
            index=pd.DatetimeIndex([], name="timestamp"),
        )
    return pd.DataFrame(rows).set_index("timestamp").sort_index()


def quantile_summary(
    daily: pd.DataFrame,
    *,
    minimum_observations: int = 3,
) -> dict[str, Any]:
    clean = daily.dropna()
    observations = int(len(clean))
    if observations < minimum_observations:
        return {
            "mean_outcome_by_quantile": {
                "low": None,
                "middle": None,
                "high": None,
            },
            "high_minus_low": None,
            "monotonicity": None,
            "observations": observations,
        }
    means = {
        label: float(clean[label].mean())
        for label in ("low", "middle", "high")
    }
    ordered = pd.Series([0.0, 1.0, 2.0])
    ranked_means = pd.Series(list(means.values())).rank(method="average")
    monotonicity = ordered.corr(ranked_means)
    return {
        "mean_outcome_by_quantile": means,
        "high_minus_low": float(clean["high_minus_low"].mean()),
        "monotonicity": (
            float(monotonicity)
            if monotonicity is not None and math.isfinite(float(monotonicity))
            else None
        ),
        "observations": observations,
    }


def causal_regime_labels(closes: pd.DataFrame) -> pd.Series:
    """Label the signal close using only trailing market information."""

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
    labels = pd.Series(pd.NA, index=closes.index, dtype="object")
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


def style_proxy_panels(
    closes: pd.DataFrame,
    volumes: pd.DataFrame,
) -> dict[str, pd.DataFrame]:
    daily_returns = closes.pct_change(fill_method=None)
    return {
        "momentum_20": closes / closes.shift(20) - 1.0,
        "reversal_5": -(closes / closes.shift(5) - 1.0),
        "realized_volatility_20": daily_returns.rolling(
            20,
            min_periods=20,
        ).std(ddof=0),
        "relative_volume_20": (
            volumes / volumes.rolling(20, min_periods=20).mean() - 1.0
        ),
    }


def cross_sectional_rank_residual(
    candidate: pd.DataFrame,
    style: pd.DataFrame,
    *,
    minimum_assets: int = 4,
) -> pd.DataFrame:
    """Remove one contemporaneous style exposure from candidate ranks."""

    index = candidate.index.intersection(style.index)
    columns = candidate.columns.intersection(style.columns)
    output = pd.DataFrame(np.nan, index=index, columns=columns, dtype=float)
    for timestamp in index:
        pair = pd.DataFrame(
            {
                "candidate": candidate.loc[timestamp, columns],
                "style": style.loc[timestamp, columns],
            }
        ).dropna()
        if (
            len(pair) < minimum_assets
            or pair["candidate"].nunique() < 2
            or pair["style"].nunique() < 2
        ):
            continue
        candidate_rank = pair["candidate"].rank(method="average", pct=True)
        style_rank = pair["style"].rank(method="average", pct=True)
        candidate_centered = candidate_rank - float(candidate_rank.mean())
        style_centered = style_rank - float(style_rank.mean())
        denominator = float(np.dot(style_centered, style_centered))
        if denominator <= 1e-15:
            continue
        beta = float(
            np.dot(style_centered, candidate_centered) / denominator
        )
        output.loc[timestamp, pair.index] = (
            candidate_centered - beta * style_centered
        )
    return output


def equal_rank_blend(
    candidate: pd.DataFrame,
    style: pd.DataFrame,
) -> pd.DataFrame:
    """Return a same-timestamp equal blend of cross-sectional percentile ranks."""

    candidate_rank = candidate.rank(axis=1, method="average", pct=True)
    style_rank = style.rank(axis=1, method="average", pct=True)
    available = candidate.notna() & style.notna()
    return ((candidate_rank + style_rank) / 2.0).where(available)


def per_asset_rank_correlation(
    factors: pd.DataFrame,
    returns: pd.DataFrame,
    mask: pd.Series,
    *,
    minimum_observations: int = 10,
) -> dict[str, dict[str, float | int | None]]:
    result: dict[str, dict[str, float | int | None]] = {}
    for asset in factors.columns.intersection(returns.columns):
        pair = pd.DataFrame(
            {
                "factor": factors.loc[mask, asset],
                "forward_return": returns.loc[mask, asset],
            }
        ).dropna()
        value: float | None = None
        if (
            len(pair) >= minimum_observations
            and pair["factor"].nunique() >= 2
            and pair["forward_return"].nunique() >= 2
        ):
            correlation = pair["factor"].rank(method="average").corr(
                pair["forward_return"].rank(method="average")
            )
            if correlation is not None and math.isfinite(float(correlation)):
                value = float(correlation)
        result[str(asset)] = {
            "rank_correlation": value,
            "observations": int(len(pair)),
        }
    return result
