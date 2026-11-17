"""Exchange calendar session validation and schedule helpers."""

from __future__ import annotations

from collections.abc import Mapping
from functools import lru_cache

import exchange_calendars as xcals
import pandas as pd

from .workspace import AutoQuantValidationError


CONTINUOUS_CALENDARS = frozenset({"24/7", "24X7", "CRYPTO", "NONE", "CONTINUOUS"})


@lru_cache(maxsize=32)
def _cached_calendar(name: str, start: str, end: str) -> xcals.ExchangeCalendar:
    try:
        return xcals.get_calendar(name, start=start, end=end)
    except Exception as exc:
        raise AutoQuantValidationError(
            f"Unknown or unsupported exchange calendar {name!r}: {exc}"
        ) from exc


def get_exchange_calendar(
    calendar: str,
    *,
    start: str | pd.Timestamp | None = None,
    end: str | pd.Timestamp | None = None,
) -> xcals.ExchangeCalendar:
    """Return a cached `exchange_calendars` calendar covering `[start, end]`."""

    code = calendar.strip().upper()
    start_ts = pd.Timestamp(start) if start is not None else pd.Timestamp("2000-01-01")
    end_ts = pd.Timestamp(end) if end is not None else pd.Timestamp("2030-12-31")
    if start_ts.tzinfo is not None:
        start_ts = start_ts.tz_convert("UTC").tz_localize(None)
    if end_ts.tzinfo is not None:
        end_ts = end_ts.tz_convert("UTC").tz_localize(None)

    # Quantize bounds to year boundaries so LRU cache hits across repeated slices
    start_bound = f"{min(start_ts.year, 2010)}-01-01"
    end_bound = f"{max(end_ts.year, 2030)}-12-31"
    return _cached_calendar(code, start_bound, end_bound)


def session_schedule(
    calendar: str,
    start: str | pd.Timestamp,
    end: str | pd.Timestamp,
) -> pd.DataFrame:
    """Return the exchange session schedule (`open`, `close` in UTC) over `[start, end]`."""

    code = calendar.strip().upper()
    if code in CONTINUOUS_CALENDARS:
        days = pd.date_range(
            pd.Timestamp(start).tz_localize(None).normalize()
            if pd.Timestamp(start).tzinfo is None
            else pd.Timestamp(start).tz_convert("UTC").tz_localize(None).normalize(),
            pd.Timestamp(end).tz_localize(None).normalize()
            if pd.Timestamp(end).tzinfo is None
            else pd.Timestamp(end).tz_convert("UTC").tz_localize(None).normalize(),
            freq="D",
        )
        opens = days.tz_localize("UTC")
        closes = opens + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
        return pd.DataFrame({"open": opens, "close": closes}, index=days)

    cal = get_exchange_calendar(code, start=start, end=end)
    s_date = (
        pd.Timestamp(start).tz_convert("UTC").tz_localize(None).normalize()
        if pd.Timestamp(start).tzinfo is not None
        else pd.Timestamp(start).normalize()
    )
    e_date = (
        pd.Timestamp(end).tz_convert("UTC").tz_localize(None).normalize()
        if pd.Timestamp(end).tzinfo is not None
        else pd.Timestamp(end).normalize()
    )
    sched = cal.schedule.loc[s_date:e_date, ["open", "close"]].copy()
    return sched


def validate_calendar_sessions(
    timestamps: pd.Series | pd.DatetimeIndex,
    calendar: str,
    *,
    asset: str | None = None,
) -> None:
    """Validate that `timestamps` align with official trading sessions of `calendar`."""

    if not isinstance(calendar, str) or not calendar.strip():
        raise AutoQuantValidationError("Calendar identifier must be a non-empty string")
    code = calendar.strip().upper()
    if code in CONTINUOUS_CALENDARS:
        return

    idx = pd.DatetimeIndex(timestamps)
    if idx.empty:
        return
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    else:
        idx = idx.tz_convert("UTC")

    min_ts = idx.min() - pd.Timedelta(days=5)
    max_ts = idx.max() + pd.Timedelta(days=5)
    cal = get_exchange_calendar(code, start=min_ts, end=max_ts)
    asset_prefix = f" for asset {asset!r}" if asset else ""

    is_date_only = bool(
        (idx.hour == 0).all()
        and (idx.minute == 0).all()
        and (idx.second == 0).all()
        and (idx.nanosecond == 0).all()
    )
    if is_date_only:
        session_set = set(cal.sessions)
        naive_dates = idx.tz_localize(None)
        invalid = [ts for ts in naive_dates if ts not in session_set]
        if invalid:
            sample = invalid[0].strftime("%Y-%m-%d")
            raise AutoQuantValidationError(
                f"Timestamp {sample}{asset_prefix} is not a valid trading session "
                f"on calendar {code}"
            )
        return

    sched = cal.schedule.loc[
        min_ts.tz_localize(None).normalize() : max_ts.tz_localize(None).normalize()
    ]
    closes_set = set(pd.DatetimeIndex(sched["close"]).tz_convert("UTC"))
    opens = pd.DatetimeIndex(sched["open"]).tz_convert("UTC")
    closes = pd.DatetimeIndex(sched["close"]).tz_convert("UTC")

    for ts in idx:
        if ts in closes_set:
            continue
        pos = opens.searchsorted(ts, side="right") - 1
        if pos < 0 or ts > closes[pos]:
            raise AutoQuantValidationError(
                f"Timestamp {ts.isoformat()}{asset_prefix} falls outside trading "
                f"sessions of calendar {code}"
            )


def validate_panel_calendars(
    panel: pd.DataFrame,
    calendar: str | Mapping[str, str],
) -> None:
    """Validate single-market or per-asset cross-market exchange calendars on `panel`."""

    if isinstance(calendar, str):
        unique_ts = pd.DatetimeIndex(panel["timestamp"].unique())
        validate_calendar_sessions(unique_ts, calendar)
        return

    if isinstance(calendar, Mapping):
        for asset, group in panel.groupby("asset", sort=False):
            cal_code = calendar.get(str(asset))
            if cal_code is None:
                raise AutoQuantValidationError(
                    f"Missing calendar mapping for asset {asset!r}"
                )
            validate_calendar_sessions(
                pd.DatetimeIndex(group["timestamp"]),
                cal_code,
                asset=str(asset),
            )
        return

    raise AutoQuantValidationError(
        "calendar must be an exchange MIC string (e.g. 'XNYS') or a dict[asset, MIC]"
    )
