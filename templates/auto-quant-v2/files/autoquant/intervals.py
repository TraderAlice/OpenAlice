"""Causal completed-bar aggregation and multi-interval pandas alignment."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import exchange_calendars as exchange_calendars
import numpy as np
import pandas as pd


OHLCV_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")

# V2 compatibility constants. Their values and serialization must not change.
BASE_INTERVAL = "1h"
FEATURE_INTERVAL_HOURS = {
    "3h": 3,
    "4h": 4,
    "6h": 6,
    "12h": 12,
    "1d": 24,
}
SUPPORTED_FEATURE_INTERVALS = tuple(FEATURE_INTERVAL_HOURS)
AGGREGATION_METHOD = "complete-utc-midnight-bar-close-v1"

INTERVAL_MINUTES = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "3h": 180,
    "4h": 240,
    "6h": 360,
    "12h": 720,
    "1d": 1440,
}
SUPPORTED_INTERVALS = tuple(INTERVAL_MINUTES)
SUPPORTED_BASE_INTERVALS = tuple(
    interval for interval in SUPPORTED_INTERVALS if interval != "1d"
)
SESSION_BASE_INTERVALS = ("1m", "5m", "15m", "30m", "1h")
SESSION_FEATURE_INTERVALS = ("5m", "15m", "30m", "1h", "3h", "4h", "6h", "1d")
CONTINUOUS_AGGREGATION_METHOD = (
    "complete-continuous-utc-midnight-bar-close-v2"
)
XNYS_AGGREGATION_METHOD = "complete-xnys-regular-session-bar-close-v1"
CONTINUOUS_TERMINAL_POLICY = "omit-incomplete"
SESSION_TERMINAL_POLICY = "complete-at-session-close"
OBSERVED_AGGREGATION_METHOD = "none-observed-base-bars-v1"
OBSERVED_PANEL_POLICY = {
    "alignment": "observed-only",
    "missingObservation": "absent-no-fill",
    "horizonClock": "per-target-observed-bars",
}
INTERVAL_ID = re.compile(r"^(?:1m|5m|15m|30m|1h|3h|4h|6h|12h|1d)$")


class IntervalContractError(ValueError):
    """Raised when a multi-interval input violates fixed time authority."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class IntervalSurface:
    """Immutable V2 continuous-1h authority."""

    base_interval: str
    feature_intervals: tuple[str, ...]
    timestamp_semantics: str = "bar-close"
    market_clock: str = "continuous"
    timezone: str = "UTC"
    anchor: str = "00:00"
    aggregation_method: str = AGGREGATION_METHOD

    def to_dict(self) -> dict[str, Any]:
        return {
            "baseInterval": self.base_interval,
            "featureIntervals": list(self.feature_intervals),
            "timestampSemantics": self.timestamp_semantics,
            "marketClock": self.market_clock,
            "timezone": self.timezone,
            "anchor": self.anchor,
            "aggregationMethod": self.aggregation_method,
        }


@dataclass(frozen=True)
class ConfigurableIntervalSurface:
    """Immutable V3 cadence and market-clock authority."""

    base_interval: str
    feature_intervals: tuple[str, ...]
    market_clock: str
    calendar: str
    timezone: str
    anchor: str
    aggregation_method: str
    terminal_bucket_policy: str
    timestamp_semantics: str = "bar-close"

    def to_dict(self) -> dict[str, Any]:
        return {
            "baseInterval": self.base_interval,
            "featureIntervals": list(self.feature_intervals),
            "timestampSemantics": self.timestamp_semantics,
            "marketClock": self.market_clock,
            "calendar": self.calendar,
            "timezone": self.timezone,
            "anchor": self.anchor,
            "aggregationMethod": self.aggregation_method,
            "terminalBucketPolicy": self.terminal_bucket_policy,
        }


@dataclass(frozen=True)
class ObservedIntervalSurface:
    """Factor-only observed-bar authority without an invented market calendar."""

    base_interval: str
    feature_intervals: tuple[str, ...] = ()
    timestamp_semantics: str = "bar-close"
    market_clock: str = "observed"
    calendar: str = "provider-observed"
    timezone: str = "UTC"
    aggregation_method: str = OBSERVED_AGGREGATION_METHOD

    def to_dict(self) -> dict[str, Any]:
        return {
            "baseInterval": self.base_interval,
            "featureIntervals": list(self.feature_intervals),
            "timestampSemantics": self.timestamp_semantics,
            "marketClock": self.market_clock,
            "calendar": self.calendar,
            "timezone": self.timezone,
            "aggregationMethod": self.aggregation_method,
            **OBSERVED_PANEL_POLICY,
        }


def _normalize_interval_ids(values: Iterable[str]) -> tuple[str, ...]:
    raw = list(values)
    if not all(
        isinstance(value, str) and INTERVAL_ID.fullmatch(value)
        for value in raw
    ):
        raise IntervalContractError(
            "interval.unsupported",
            "Intervals must be selected from: "
            + ", ".join(SUPPORTED_INTERVALS),
        )
    if len(raw) != len(set(raw)):
        raise IntervalContractError(
            "interval.duplicate",
            "Feature intervals must be unique",
        )
    return tuple(sorted(raw, key=INTERVAL_MINUTES.__getitem__))


def normalize_feature_intervals(values: Iterable[str]) -> tuple[str, ...]:
    """Return the exact legacy V2 feature sequence."""

    intervals = _normalize_interval_ids(values)
    if any(value not in FEATURE_INTERVAL_HOURS for value in intervals):
        raise IntervalContractError(
            "interval.unsupported",
            "Feature intervals must be selected from: "
            + ", ".join(SUPPORTED_FEATURE_INTERVALS),
        )
    return intervals


def normalize_configurable_intervals(
    base_interval: str,
    feature_intervals: Iterable[str],
    *,
    market_clock: str,
) -> tuple[str, ...]:
    """Validate V3 interval algebra for one market clock."""

    if base_interval not in SUPPORTED_BASE_INTERVALS:
        raise IntervalContractError(
            "interval.base-unsupported",
            "Base interval must be selected from: "
            + ", ".join(SUPPORTED_BASE_INTERVALS),
        )
    if market_clock == "session" and base_interval not in SESSION_BASE_INTERVALS:
        raise IntervalContractError(
            "interval.session-base",
            "XNYS base interval must be selected from: "
            + ", ".join(SESSION_BASE_INTERVALS),
        )
    if market_clock not in {"continuous", "session"}:
        raise IntervalContractError(
            "interval.market-clock",
            "Market clock must be continuous or session",
        )
    intervals = _normalize_interval_ids(feature_intervals)
    if not intervals:
        raise IntervalContractError(
            "interval.empty",
            "featureIntervals must contain at least one higher interval",
        )
    base_minutes = INTERVAL_MINUTES[base_interval]
    for interval in intervals:
        minutes = INTERVAL_MINUTES[interval]
        if minutes <= base_minutes:
            raise IntervalContractError(
                "interval.order",
                f"Feature interval {interval} must be larger than "
                f"base interval {base_interval}",
            )
        if interval != "1d" and minutes % base_minutes:
            raise IntervalContractError(
                "interval.non-divisible",
                f"Feature interval {interval} must be an exact multiple of "
                f"base interval {base_interval}",
            )
        if market_clock == "session" and interval not in SESSION_FEATURE_INTERVALS:
            raise IntervalContractError(
                "interval.session-feature",
                "XNYS feature intervals must be selected from: "
                + ", ".join(SESSION_FEATURE_INTERVALS),
            )
    return intervals


def interval_surface(feature_intervals: Iterable[str]) -> IntervalSurface:
    """Build the exact legacy V2 interval surface."""

    return IntervalSurface(
        base_interval=BASE_INTERVAL,
        feature_intervals=normalize_feature_intervals(feature_intervals),
    )


def configurable_interval_surface(
    base_interval: str,
    feature_intervals: Iterable[str],
    market: Mapping[str, Any],
) -> ConfigurableIntervalSurface:
    """Build one canonical V3 interval surface."""

    clock = market.get("clock")
    intervals = normalize_configurable_intervals(
        base_interval,
        feature_intervals,
        market_clock=clock,
    )
    if clock == "continuous":
        if dict(market) != {
            "clock": "continuous",
            "calendar": "24/7",
            "timezone": "UTC",
        }:
            raise IntervalContractError(
                "interval.market",
                "Continuous V3 requires 24/7 UTC market authority",
            )
        return ConfigurableIntervalSurface(
            base_interval=base_interval,
            feature_intervals=intervals,
            market_clock=clock,
            calendar="24/7",
            timezone="UTC",
            anchor="00:00",
            aggregation_method=CONTINUOUS_AGGREGATION_METHOD,
            terminal_bucket_policy=CONTINUOUS_TERMINAL_POLICY,
        )
    if dict(market) != {
        "clock": "session",
        "calendar": "XNYS",
        "timezone": "America/New_York",
    }:
        raise IntervalContractError(
            "interval.market",
            "Session V3 currently requires XNYS regular-session authority",
        )
    return ConfigurableIntervalSurface(
        base_interval=base_interval,
        feature_intervals=intervals,
        market_clock=clock,
        calendar="XNYS",
        timezone="America/New_York",
        anchor="market-open",
        aggregation_method=XNYS_AGGREGATION_METHOD,
        terminal_bucket_policy=SESSION_TERMINAL_POLICY,
    )


def observed_interval_surface(base_interval: str) -> ObservedIntervalSurface:
    """Build one base-only observed-bar Factor surface."""

    if base_interval not in SUPPORTED_INTERVALS:
        raise IntervalContractError(
            "interval.base-unsupported",
            "Observed base interval must be selected from: "
            + ", ".join(SUPPORTED_INTERVALS),
        )
    return ObservedIntervalSurface(base_interval=base_interval)


def canonical_interval_surface(
    surface: Mapping[str, Any],
    *,
    schema_version: int,
) -> dict[str, Any]:
    """Rebuild one public surface and reject invented authority."""

    if schema_version == 2:
        expected = interval_surface(surface.get("featureIntervals", [])).to_dict()
    elif schema_version == 3:
        expected = configurable_interval_surface(
            surface.get("baseInterval"),
            surface.get("featureIntervals", []),
            {
                "clock": surface.get("marketClock"),
                "calendar": surface.get("calendar"),
                "timezone": surface.get("timezone"),
            },
        ).to_dict()
    elif schema_version in {5, 6}:
        expected = observed_interval_surface(
            surface.get("baseInterval"),
        ).to_dict()
    else:
        raise IntervalContractError(
            "interval.schema",
            "Interval surface requires snapshot schema V2, V3, V5, or V6",
        )
    if dict(surface) != expected:
        raise IntervalContractError(
            "interval.surface",
            "Interval surface differs from canonical authority",
        )
    return expected


def timestamp_label(value: Any) -> str:
    """Preserve V1 session dates and identify intraday UTC closes exactly."""

    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        return timestamp.date().isoformat()
    return timestamp.tz_convert("UTC").isoformat().replace("+00:00", "Z")


def annualization_periods(index: Iterable[Any]) -> int:
    """Infer bounded V1, continuous, or session decision periods per year."""

    timestamps = pd.DatetimeIndex(index)
    if len(timestamps) <= 1 or timestamps.tz is None:
        return 252
    ordered = timestamps.sort_values()
    deltas = ordered.to_series().diff().dropna()
    positive = deltas[deltas > pd.Timedelta(0)]
    if positive.empty:
        return 252
    counts = pd.Series(1, index=ordered).groupby(ordered.normalize()).sum()
    nominal = positive.mode().iloc[0]
    if positive.max() <= nominal:
        return max(1, round(pd.Timedelta(days=365) / nominal))
    return max(1, round(252 * float(counts.median())))


def _normalize_ohlcv_values(
    frame: pd.DataFrame,
    *,
    label: str,
) -> pd.DataFrame:
    if tuple(frame.columns) != OHLCV_COLUMNS:
        raise IntervalContractError(
            "interval.columns",
            f"{label} columns must be exactly {', '.join(OHLCV_COLUMNS)}",
        )
    result = frame.copy(deep=True)
    try:
        raw = pd.to_datetime(result["timestamp"], errors="raise")
        timestamps = pd.to_datetime(
            result["timestamp"],
            utc=True,
            errors="raise",
        )
    except (TypeError, ValueError) as error:
        raise IntervalContractError(
            "interval.timestamp",
            f"{label} timestamps must be timezone-aware bar closes: {error}",
        ) from error
    if getattr(raw.dt, "tz", None) is None:
        raise IntervalContractError(
            "interval.timezone",
            f"{label} timestamps must include an explicit UTC offset",
        )
    if not timestamps.is_monotonic_increasing or timestamps.duplicated().any():
        raise IntervalContractError(
            "interval.order",
            f"{label} timestamps must be unique and chronological",
        )
    numeric_columns = list(OHLCV_COLUMNS[1:])
    try:
        result[numeric_columns] = result[numeric_columns].apply(
            pd.to_numeric,
            errors="raise",
        )
    except (TypeError, ValueError) as error:
        raise IntervalContractError(
            "interval.numeric",
            f"{label} OHLCV values must be numeric: {error}",
        ) from error
    numeric = result[numeric_columns].to_numpy(dtype=float)
    if not np.isfinite(numeric).all():
        raise IntervalContractError(
            "interval.non-finite",
            f"{label} contains non-finite OHLCV",
        )
    if (numeric <= 0).any():
        raise IntervalContractError(
            "interval.non-positive",
            f"{label} OHLCV must be strictly positive",
        )
    if (
        (result["high"] < result[["open", "close"]].max(axis=1)).any()
        or (result["low"] > result[["open", "close"]].min(axis=1)).any()
        or (result["high"] < result["low"]).any()
    ):
        raise IntervalContractError(
            "interval.bar-shape",
            f"{label} contains invalid OHLCV bar geometry",
        )
    result["timestamp"] = timestamps
    return result.reset_index(drop=True)


def validate_observed_ohlcv(
    frame: pd.DataFrame,
    *,
    label: str = "observed OHLCV",
) -> pd.DataFrame:
    """Normalize timestamp-aware observed bars without inventing missing rows."""

    if tuple(frame.columns) != OHLCV_COLUMNS:
        raise IntervalContractError(
            "interval.columns",
            f"{label} columns must be exactly {', '.join(OHLCV_COLUMNS)}",
        )
    result = frame.copy(deep=True)
    try:
        raw = pd.to_datetime(result["timestamp"], errors="raise")
        timestamps = pd.to_datetime(
            result["timestamp"],
            utc=True,
            errors="raise",
        )
    except (TypeError, ValueError) as error:
        raise IntervalContractError(
            "interval.timestamp",
            f"{label} timestamps must be timezone-aware bar closes: {error}",
        ) from error
    if getattr(raw.dt, "tz", None) is None:
        raise IntervalContractError(
            "interval.timezone",
            f"{label} timestamps must include an explicit UTC offset",
        )
    if not timestamps.is_monotonic_increasing or timestamps.duplicated().any():
        raise IntervalContractError(
            "interval.order",
            f"{label} timestamps must be unique and chronological",
        )
    numeric_columns = list(OHLCV_COLUMNS[1:])
    try:
        result[numeric_columns] = result[numeric_columns].apply(
            pd.to_numeric,
            errors="raise",
        )
    except (TypeError, ValueError) as error:
        raise IntervalContractError(
            "interval.numeric",
            f"{label} OHLCV values must be numeric: {error}",
        ) from error
    numeric = result[numeric_columns].to_numpy(dtype=float)
    if not np.isfinite(numeric).all():
        raise IntervalContractError(
            "interval.non-finite",
            f"{label} contains non-finite OHLCV",
        )
    if (result[["open", "high", "low", "close"]] <= 0).any().any():
        raise IntervalContractError(
            "interval.non-positive-price",
            f"{label} OHLC prices must be strictly positive",
        )
    if (result["volume"] < 0).any():
        raise IntervalContractError(
            "interval.negative-volume",
            f"{label} volume must be non-negative",
        )
    if (
        (result["high"] < result[["open", "close"]].max(axis=1)).any()
        or (result["low"] > result[["open", "close"]].min(axis=1)).any()
        or (result["high"] < result["low"]).any()
    ):
        raise IntervalContractError(
            "interval.bar-shape",
            f"{label} contains invalid OHLCV bar geometry",
        )
    result["timestamp"] = timestamps
    return result.reset_index(drop=True)


def validate_continuous_ohlcv(
    frame: pd.DataFrame,
    base_interval: str,
    *,
    label: str = "base OHLCV",
) -> pd.DataFrame:
    """Normalize one strict UTC continuous base-bar frame."""

    if base_interval not in SUPPORTED_BASE_INTERVALS:
        raise IntervalContractError(
            "interval.base-unsupported",
            f"Unsupported base interval {base_interval}",
        )
    result = _normalize_ohlcv_values(frame, label=label)
    duration = pd.Timedelta(minutes=INTERVAL_MINUTES[base_interval])
    timestamps = result["timestamp"]
    if len(timestamps) > 1:
        deltas = timestamps.diff().iloc[1:]
        if not deltas.eq(duration).all():
            raise IntervalContractError(
                "interval.gap",
                f"{label} must contain consecutive {base_interval} bar closes "
                "without gaps",
            )
    epoch = pd.Timestamp("1970-01-01", tz="UTC")
    if not ((timestamps - epoch) % duration).eq(pd.Timedelta(0)).all():
        raise IntervalContractError(
            "interval.boundary",
            f"{label} closes must land on exact UTC {base_interval} boundaries",
        )
    return result


def validate_continuous_hourly_ohlcv(
    frame: pd.DataFrame,
    *,
    label: str = "base OHLCV",
) -> pd.DataFrame:
    """Legacy V2 strict UTC 1h validator."""

    return validate_continuous_ohlcv(frame, BASE_INTERVAL, label=label)


def _xnys_schedule(start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    start_date = (start.tz_convert("UTC") - pd.Timedelta(days=7)).date()
    end_date = (end.tz_convert("UTC") + pd.Timedelta(days=7)).date()
    calendar = exchange_calendars.get_calendar(
        "XNYS",
        start=str(start_date),
        end=str(end_date),
    )
    return calendar.schedule[["open", "close"]].copy()


def _session_bucket_closes(
    market_open: pd.Timestamp,
    market_close: pd.Timestamp,
    interval: str,
) -> list[pd.Timestamp]:
    if interval == "1d":
        return [market_close]
    duration = pd.Timedelta(minutes=INTERVAL_MINUTES[interval])
    closes: list[pd.Timestamp] = []
    value = market_open + duration
    while value < market_close:
        closes.append(value)
        value += duration
    closes.append(market_close)
    return closes


def _datetime_indexes_equal(
    left: pd.DatetimeIndex,
    right: pd.DatetimeIndex,
) -> bool:
    """Compare timestamp identity without treating storage resolution as data.

    Pandas 3 preserves ISO-8601 CSV timestamps at microsecond resolution while
    exchange-calendars currently exposes nanosecond-resolution schedules.
    ``DatetimeIndex.equals`` considers those dtypes different even when every
    instant, timezone, and position is identical.  AutoQuant's contract is
    about bar-close instants, not an in-memory datetime unit, so normalize both
    sides before exact ordered comparison.
    """

    return left.as_unit("ns").equals(right.as_unit("ns"))


def _covered_session_schedule(
    timestamps: pd.DatetimeIndex,
    *,
    base_interval: str,
) -> tuple[pd.DataFrame, pd.DatetimeIndex]:
    if timestamps.empty:
        raise IntervalContractError(
            "interval.empty-data",
            "Session OHLCV must contain at least one complete session",
        )
    schedule = _xnys_schedule(timestamps[0], timestamps[-1])
    containing: list[int] = []
    for timestamp in timestamps:
        matches = np.flatnonzero(
            (
                (schedule["open"] < timestamp)
                & (timestamp <= schedule["close"])
            ).to_numpy()
        )
        if len(matches) != 1:
            raise IntervalContractError(
                "interval.off-session",
                f"XNYS base close {timestamp.isoformat()} is outside the "
                "regular session",
            )
        containing.append(int(matches[0]))
    first = min(containing)
    last = max(containing)
    covered = schedule.iloc[first : last + 1]
    expected = pd.DatetimeIndex(
        [
            close
            for row in covered.itertuples()
            for close in _session_bucket_closes(
                row.open,
                row.close,
                base_interval,
            )
        ]
    )
    return covered, expected


def validate_xnys_session_ohlcv(
    frame: pd.DataFrame,
    base_interval: str,
    *,
    label: str = "base OHLCV",
) -> pd.DataFrame:
    """Validate exact complete XNYS regular sessions."""

    if base_interval not in SESSION_BASE_INTERVALS:
        raise IntervalContractError(
            "interval.session-base",
            "XNYS base interval must be selected from: "
            + ", ".join(SESSION_BASE_INTERVALS),
        )
    result = _normalize_ohlcv_values(frame, label=label)
    timestamps = pd.DatetimeIndex(result["timestamp"])
    _, expected = _covered_session_schedule(
        timestamps,
        base_interval=base_interval,
    )
    if not _datetime_indexes_equal(timestamps, expected):
        missing = expected.difference(timestamps)
        extra = timestamps.difference(expected)
        detail = []
        if len(missing):
            detail.append(f"missing {len(missing)} expected closes")
        if len(extra):
            detail.append(f"extra {len(extra)} closes")
        raise IntervalContractError(
            "interval.session-panel",
            f"{label} must contain exact complete XNYS regular sessions"
            + (f": {', '.join(detail)}" if detail else ""),
        )
    return result


def validate_base_ohlcv(
    frame: pd.DataFrame,
    surface: Mapping[str, Any],
    *,
    label: str = "base OHLCV",
) -> pd.DataFrame:
    if surface["marketClock"] == "continuous":
        return validate_continuous_ohlcv(
            frame,
            surface["baseInterval"],
            label=label,
        )
    return validate_xnys_session_ohlcv(
        frame,
        surface["baseInterval"],
        label=label,
    )


def _aggregate_rows(
    group: pd.DataFrame,
    close: pd.Timestamp,
) -> dict[str, Any]:
    return {
        "timestamp": close,
        "open": float(group["open"].iloc[0]),
        "high": float(group["high"].max()),
        "low": float(group["low"].min()),
        "close": float(group["close"].iloc[-1]),
        "volume": float(group["volume"].sum()),
    }


def aggregate_continuous_ohlcv(
    base_frame: pd.DataFrame,
    base_interval: str,
    interval: str,
) -> pd.DataFrame:
    """Aggregate exact UTC-midnight buckets from one continuous base clock."""

    normalize_configurable_intervals(
        base_interval,
        [interval],
        market_clock="continuous",
    )
    base = validate_continuous_ohlcv(base_frame, base_interval)
    base_minutes = INTERVAL_MINUTES[base_interval]
    feature_minutes = INTERVAL_MINUTES[interval]
    expected_rows = feature_minutes // base_minutes
    indexed = base.set_index("timestamp", drop=False)
    frequency = pd.Timedelta(minutes=feature_minutes)
    base_frequency = f"{base_minutes}min"
    rows: list[dict[str, Any]] = []
    for bucket_close, group in indexed.groupby(
        pd.Grouper(
            freq=frequency,
            origin="start_day",
            closed="right",
            label="right",
        ),
        sort=True,
    ):
        if len(group) != expected_rows:
            continue
        expected = pd.date_range(
            end=bucket_close,
            periods=expected_rows,
            freq=base_frequency,
            tz="UTC",
        )
        if not _datetime_indexes_equal(pd.DatetimeIndex(group.index), expected):
            continue
        rows.append(_aggregate_rows(group, bucket_close))
    return pd.DataFrame(rows, columns=OHLCV_COLUMNS)


def aggregate_completed_ohlcv(
    base_frame: pd.DataFrame,
    interval: str,
) -> pd.DataFrame:
    """Legacy V2 UTC-midnight aggregation."""

    normalized_interval = normalize_feature_intervals([interval])[0]
    return aggregate_continuous_ohlcv(
        base_frame,
        BASE_INTERVAL,
        normalized_interval,
    )


def aggregate_xnys_session_ohlcv(
    base_frame: pd.DataFrame,
    base_interval: str,
    interval: str,
) -> pd.DataFrame:
    """Aggregate complete XNYS open-anchored or whole-session bars."""

    normalize_configurable_intervals(
        base_interval,
        [interval],
        market_clock="session",
    )
    base = validate_xnys_session_ohlcv(base_frame, base_interval)
    timestamps = pd.DatetimeIndex(base["timestamp"])
    schedule, _ = _covered_session_schedule(
        timestamps,
        base_interval=base_interval,
    )
    rows: list[dict[str, Any]] = []
    for session in schedule.itertuples():
        session_frame = base[
            (base["timestamp"] > session.open)
            & (base["timestamp"] <= session.close)
        ]
        previous = session.open
        for bucket_close in _session_bucket_closes(
            session.open,
            session.close,
            interval,
        ):
            group = session_frame[
                (session_frame["timestamp"] > previous)
                & (session_frame["timestamp"] <= bucket_close)
            ]
            if group.empty:
                raise IntervalContractError(
                    "interval.session-aggregation",
                    f"{interval} bucket ending {bucket_close.isoformat()} "
                    "has no verified base bars",
                )
            rows.append(_aggregate_rows(group, bucket_close))
            previous = bucket_close
    return pd.DataFrame(rows, columns=OHLCV_COLUMNS)


def aggregate_interval_ohlcv(
    base_frame: pd.DataFrame,
    surface: Mapping[str, Any],
    interval: str,
) -> pd.DataFrame:
    if surface["marketClock"] == "continuous":
        return aggregate_continuous_ohlcv(
            base_frame,
            surface["baseInterval"],
            interval,
        )
    return aggregate_xnys_session_ohlcv(
        base_frame,
        surface["baseInterval"],
        interval,
    )


def _align_validated_intervals(
    base: pd.DataFrame,
    derived: Mapping[str, pd.DataFrame],
    intervals: tuple[str, ...],
) -> pd.DataFrame:
    if set(intervals) != set(derived):
        raise IntervalContractError(
            "interval.inventory",
            "Derived interval inventory is inconsistent",
        )
    result = base.copy(deep=True)
    ordinal = pd.Series(
        np.arange(len(result), dtype=int),
        index=pd.DatetimeIndex(result["timestamp"]),
    )
    for interval in intervals:
        high = _normalize_ohlcv_values(
            derived[interval],
            label=f"{interval} OHLCV",
        )
        suffix = f"__{interval}"
        renamed = high.rename(
            columns={
                "timestamp": f"bar_close{suffix}",
                **{
                    column: f"{column}{suffix}"
                    for column in OHLCV_COLUMNS[1:]
                },
            }
        )
        result = pd.merge_asof(
            result.sort_values("timestamp"),
            renamed.sort_values(f"bar_close{suffix}"),
            left_on="timestamp",
            right_on=f"bar_close{suffix}",
            direction="backward",
            allow_exact_matches=True,
        )
        visible = result[f"bar_close{suffix}"].dropna()
        decisions = result.loc[visible.index, "timestamp"]
        if (visible > decisions).any():
            raise IntervalContractError(
                "interval.lookahead",
                f"{interval} alignment exposed a bar before its close",
            )
        source_ordinals = visible.map(ordinal)
        decision_ordinals = decisions.map(ordinal)
        if source_ordinals.isna().any() or decision_ordinals.isna().any():
            raise IntervalContractError(
                "interval.alignment",
                f"{interval} source closes must reconcile to base closes",
            )
        result[f"age_bars{suffix}"] = pd.Series(
            decision_ordinals.to_numpy() - source_ordinals.to_numpy(),
            index=visible.index,
            dtype="Int64",
        ).reindex(result.index)
    return result.reset_index(drop=True)


def align_completed_intervals(
    base_frame: pd.DataFrame,
    derived: Mapping[str, pd.DataFrame],
) -> pd.DataFrame:
    """Legacy V2 causal alignment."""

    intervals = normalize_feature_intervals(derived.keys())
    base = validate_continuous_hourly_ohlcv(base_frame)
    return _align_validated_intervals(base, derived, intervals)


def align_configurable_intervals(
    base_frame: pd.DataFrame,
    derived: Mapping[str, pd.DataFrame],
    surface: Mapping[str, Any],
) -> pd.DataFrame:
    """Causally align one canonical V3 interval surface."""

    expected = canonical_interval_surface(surface, schema_version=3)
    intervals = tuple(expected["featureIntervals"])
    base = validate_base_ohlcv(base_frame, expected)
    return _align_validated_intervals(base, derived, intervals)


def build_multi_interval_frame(
    base_frame: pd.DataFrame,
    feature_intervals: Iterable[str],
) -> pd.DataFrame:
    """Build the legacy V2 shared pandas surface."""

    intervals = normalize_feature_intervals(feature_intervals)
    base = validate_continuous_hourly_ohlcv(base_frame)
    derived = {
        interval: aggregate_completed_ohlcv(base, interval)
        for interval in intervals
    }
    return _align_validated_intervals(base, derived, intervals)


def build_configurable_multi_interval_frame(
    base_frame: pd.DataFrame,
    surface: Mapping[str, Any],
) -> pd.DataFrame:
    """Build one shared V3 pandas surface."""

    expected = canonical_interval_surface(surface, schema_version=3)
    base = validate_base_ohlcv(base_frame, expected)
    derived = {
        interval: aggregate_interval_ohlcv(base, expected, interval)
        for interval in expected["featureIntervals"]
    }
    return _align_validated_intervals(
        base,
        derived,
        tuple(expected["featureIntervals"]),
    )


def _load_materialized_frame(path: Path, label: str) -> pd.DataFrame:
    if not path.is_file() or path.is_symlink():
        raise IntervalContractError(
            "interval.asset",
            f"Missing confined {label} OHLCV",
        )
    return _normalize_ohlcv_values(pd.read_csv(path), label=label)


def load_multi_interval_asset(
    data_root: str | Path,
    asset: str,
    *,
    start: str,
    end: str,
) -> pd.DataFrame | None:
    """Load and reconcile one materialized V2/V3 or observed V5/V6 asset."""

    root = Path(data_root).resolve()
    ohlcv = (root / "ohlcv").resolve()
    snapshot_path = ohlcv / "snapshot.json"
    if not snapshot_path.is_file():
        return None
    try:
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise IntervalContractError(
            "interval.snapshot",
            f"Invalid interval snapshot JSON: {error}",
        ) from error
    schema_version = snapshot.get("schemaVersion")
    if schema_version not in {2, 3, 5, 6}:
        return None
    surface = snapshot.get("intervalSurface")
    if not isinstance(surface, dict):
        raise IntervalContractError(
            "interval.snapshot",
            f"V{schema_version} snapshot is missing intervalSurface",
        )
    expected_surface = canonical_interval_surface(
        surface,
        schema_version=schema_version,
    )
    if not isinstance(asset, str) or not asset or "/" in asset or "\\" in asset:
        raise IntervalContractError("interval.asset", "Invalid confined asset id")
    intervals = [
        expected_surface["baseInterval"],
        *expected_surface["featureIntervals"],
    ]
    if schema_version in {5, 6}:
        base_interval = expected_surface["baseInterval"]
        source = (ohlcv / base_interval / f"{asset}.csv").resolve()
        if ohlcv not in source.parents or not source.is_file() or source.is_symlink():
            raise IntervalContractError(
                "interval.asset",
                f"Missing confined observed {base_interval} OHLCV for {asset}",
            )
        base = validate_observed_ohlcv(
            pd.read_csv(source),
            label=f"{asset} observed {base_interval}",
        )
        asset_record = next(
            (
                item
                for item in snapshot.get("assets", [])
                if isinstance(item, dict) and item.get("symbol") == asset
            ),
            None,
        )
        if not isinstance(asset_record, dict):
            raise IntervalContractError(
                "interval.asset",
                f"Observed snapshot has no asset record for {asset}",
            )
        if (
            asset_record.get("volumeSemantics") == "unavailable-zero"
            and not base["volume"].eq(0).all()
        ):
            raise IntervalContractError(
                "interval.volume-semantics",
                f"{asset} declares unavailable-zero volume but contains "
                "nonzero observations",
            )
        start_at = pd.Timestamp(start)
        end_at = pd.Timestamp(end)
        start_at = (
            start_at.tz_localize("UTC")
            if start_at.tzinfo is None
            else start_at.tz_convert("UTC")
        )
        end_at = (
            end_at.tz_localize("UTC")
            if end_at.tzinfo is None
            else end_at.tz_convert("UTC")
        )
        return base[
            (base["timestamp"] >= start_at)
            & (base["timestamp"] <= end_at)
        ].reset_index(drop=True)
    frames: dict[str, pd.DataFrame] = {}
    base_interval = expected_surface["baseInterval"]
    for interval in intervals:
        source = (ohlcv / interval / f"{asset}.csv").resolve()
        if ohlcv not in source.parents:
            raise IntervalContractError(
                "interval.asset",
                f"Invalid confined {interval} OHLCV for {asset}",
            )
        try:
            frames[interval] = _load_materialized_frame(
                source,
                f"{asset} {interval}",
            )
        except IntervalContractError as error:
            if interval == base_interval:
                raise
            raise IntervalContractError(
                "interval.reconciliation",
                f"{asset} {interval} OHLCV does not reconcile to "
                f"{base_interval} bars",
            ) from error
    base = (
        validate_continuous_hourly_ohlcv(
            frames[base_interval],
            label=f"{asset} {base_interval}",
        )
        if schema_version == 2
        else validate_base_ohlcv(
            frames[base_interval],
            expected_surface,
            label=f"{asset} {base_interval}",
        )
    )
    for interval in expected_surface["featureIntervals"]:
        expected = (
            aggregate_completed_ohlcv(base, interval)
            if schema_version == 2
            else aggregate_interval_ohlcv(
                base,
                expected_surface,
                interval,
            )
        )
        actual = frames[interval]
        if not _datetime_indexes_equal(
            pd.DatetimeIndex(actual["timestamp"]),
            pd.DatetimeIndex(expected["timestamp"]),
        ):
            raise IntervalContractError(
                "interval.reconciliation",
                f"{asset} {interval} timestamps do not reconcile to "
                f"{base_interval} bars",
            )
        if actual.shape != expected.shape or not np.isclose(
            actual[list(OHLCV_COLUMNS[1:])].to_numpy(dtype=float),
            expected[list(OHLCV_COLUMNS[1:])].to_numpy(dtype=float),
            rtol=1e-9,
            atol=1e-9,
        ).all():
            raise IntervalContractError(
                "interval.reconciliation",
                f"{asset} {interval} OHLCV does not reconcile to "
                f"{base_interval} bars",
            )
    derived = {
        interval: frames[interval]
        for interval in expected_surface["featureIntervals"]
    }
    aligned = (
        align_completed_intervals(base, derived)
        if schema_version == 2
        else align_configurable_intervals(
            base,
            derived,
            expected_surface,
        )
    )
    start_at = pd.Timestamp(start)
    end_at = pd.Timestamp(end)
    start_at = (
        start_at.tz_localize("UTC")
        if start_at.tzinfo is None
        else start_at.tz_convert("UTC")
    )
    end_at = (
        end_at.tz_localize("UTC")
        if end_at.tzinfo is None
        else end_at.tz_convert("UTC")
    )
    return aligned[
        (aligned["timestamp"] >= start_at)
        & (aligned["timestamp"] <= end_at)
    ].reset_index(drop=True)
