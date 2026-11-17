"""Long-form OHLCV panel validation, wide pivots, causal resampling, and as-of fill."""

from __future__ import annotations

from collections.abc import Mapping
import numpy as np
import pandas as pd

from .calendars import validate_panel_calendars
from .workspace import AutoQuantValidationError


PANEL_COLUMNS = ("timestamp", "asset", "open", "high", "low", "close", "volume")
PRICE_COLUMNS = ("open", "high", "low", "close")

_FREQ_ALIASES = {
    "1d": "1D",
    "d": "1D",
    "1w": "W-FRI",
    "w": "W-FRI",
    "1m": "ME",
    "m": "ME",
    "1q": "QE",
    "q": "QE",
}


def coerce_utc_timestamps(values: pd.Series | pd.Index | list[object]) -> pd.Series:
    """Parse timestamps strictly into `datetime64[ns, UTC]`."""

    try:
        parsed = pd.to_datetime(values, utc=True, format="mixed")
    except (ValueError, TypeError) as exc:
        raise AutoQuantValidationError(f"Unparseable timestamp values: {exc}") from exc
    series = pd.Series(parsed)
    if series.isna().any():
        raise AutoQuantValidationError("Panel contains null/NaT timestamps")
    return series


def format_timestamps(timestamps: pd.Series | pd.DatetimeIndex) -> list[str]:
    """Format UTC timestamps as `YYYY-MM-DD` when midnight-aligned, else ISO-8601 `Z`."""

    idx = pd.DatetimeIndex(timestamps)
    if idx.empty:
        return []
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    else:
        idx = idx.tz_convert("UTC")
    is_midnight = bool(
        (idx.hour == 0).all()
        and (idx.minute == 0).all()
        and (idx.second == 0).all()
        and (idx.nanosecond == 0).all()
    )
    if is_midnight:
        return idx.strftime("%Y-%m-%d").tolist()
    if bool((idx.microsecond == 0).all() and (idx.nanosecond == 0).all()):
        return idx.strftime("%Y-%m-%dT%H:%M:%SZ").tolist()
    return [ts.isoformat().replace("+00:00", "Z") for ts in idx]


def normalize_ohlcv(
    df: pd.DataFrame,
    *,
    symbol: str | None = None,
    sort: bool = True,
    calendar: str | Mapping[str, str] | None = None,
) -> pd.DataFrame:
    """Normalize raw OHLCV DataFrame columns/types and run strict causal validation."""

    if not isinstance(df, pd.DataFrame) or df.empty:
        raise AutoQuantValidationError("OHLCV DataFrame must be non-empty")

    rename_map: dict[object, str] = {}
    lower_seen: dict[str, object] = {}
    for col in df.columns:
        low = str(col).strip().lower()
        lower_seen[low] = col

    for alias in ("timestamp", "date", "datetime", "time"):
        if alias in lower_seen:
            rename_map[lower_seen[alias]] = "timestamp"
            break
    for alias in ("asset", "symbol", "ticker", "instrument"):
        if alias in lower_seen:
            rename_map[lower_seen[alias]] = "asset"
            break
    for field in ("open", "high", "low", "close", "volume"):
        if field in lower_seen:
            rename_map[lower_seen[field]] = field

    work = df.rename(columns=rename_map).copy()
    if "timestamp" not in work.columns and isinstance(work.index, pd.DatetimeIndex):
        work = work.reset_index().rename(columns={work.index.name or "index": "timestamp"})

    if "asset" not in work.columns:
        if symbol is None or not str(symbol).strip():
            raise AutoQuantValidationError(
                "OHLCV input lacks an 'asset'/'symbol' column and no symbol= was provided"
            )
        work["asset"] = str(symbol).strip()

    if "volume" not in work.columns:
        work["volume"] = 0.0
    else:
        # Vendor feeds (e.g. index/FX bars) may emit null volume; normalize null -> 0.0
        work["volume"] = pd.to_numeric(work["volume"], errors="coerce").fillna(0.0)

    missing = [c for c in PANEL_COLUMNS if c not in work.columns]
    if missing:
        raise AutoQuantValidationError(f"OHLCV input missing required columns: {missing}")

    work["timestamp"] = coerce_utc_timestamps(work["timestamp"]).array
    work["asset"] = work["asset"].astype(str).str.strip()

    if work.duplicated(subset=["timestamp", "asset"]).any():
        dup = work.loc[work.duplicated(subset=["timestamp", "asset"]), ["timestamp", "asset"]].iloc[0]
        raise AutoQuantValidationError(
            f"Duplicate (timestamp, asset) observation: ({dup['timestamp']}, {dup['asset']!r})"
        )

    if sort:
        work = work.sort_values(["timestamp", "asset"], kind="mergesort").reset_index(drop=True)

    extra_cols = [c for c in work.columns if c not in PANEL_COLUMNS]
    ordered = work.loc[:, [*PANEL_COLUMNS, *extra_cols]]
    return validate_panel(ordered, calendar=calendar, require_sorted=True)


def validate_panel(
    panel: pd.DataFrame,
    *,
    calendar: str | Mapping[str, str] | None = None,
    require_sorted: bool = True,
) -> pd.DataFrame:
    """Validate canonical long-form OHLCV panel invariants."""

    if not isinstance(panel, pd.DataFrame) or panel.empty:
        raise AutoQuantValidationError("Panel must be a non-empty DataFrame")

    missing = [col for col in PANEL_COLUMNS if col not in panel.columns]
    if missing:
        raise AutoQuantValidationError(f"Panel is missing required columns: {missing}")

    attrs = dict(panel.attrs)
    out = panel.copy()
    out["timestamp"] = coerce_utc_timestamps(out["timestamp"]).array

    if out["asset"].isna().any():
        raise AutoQuantValidationError("Panel contains null asset identifiers")
    out["asset"] = out["asset"].astype(str).str.strip()
    if (out["asset"] == "").any():
        raise AutoQuantValidationError("Panel contains empty asset identifiers")

    if out.duplicated(subset=["timestamp", "asset"]).any():
        dup = out.loc[out.duplicated(subset=["timestamp", "asset"]), ["timestamp", "asset"]].iloc[0]
        raise AutoQuantValidationError(
            f"Duplicate (timestamp, asset) observation: ({dup['timestamp']}, {dup['asset']!r})"
        )

    # Check per-asset strict monotonicity
    for asset, grp_ts in out.groupby("asset", sort=False)["timestamp"]:
        if not grp_ts.is_monotonic_increasing:
            raise AutoQuantValidationError(
                f"Non-monotonic timestamps detected for asset {asset!r}"
            )

    if require_sorted:
        sorted_check = out.sort_values(["timestamp", "asset"], kind="mergesort")
        if not out.index.equals(sorted_check.index):
            if not out["timestamp"].is_monotonic_increasing:
                raise AutoQuantValidationError(
                    "Panel timestamps must be sorted in non-decreasing chronological order"
                )
            out = sorted_check
    out = out.reset_index(drop=True)

    for col in (*PRICE_COLUMNS, "volume"):
        try:
            numeric = pd.to_numeric(out[col], errors="raise").astype("float64")
        except (ValueError, TypeError) as exc:
            raise AutoQuantValidationError(f"Column {col!r} must be numeric: {exc}") from exc
        if not np.isfinite(numeric.to_numpy()).all():
            raise AutoQuantValidationError(f"Column {col!r} contains NaN or infinite values")
        out[col] = numeric

    for col in PRICE_COLUMNS:
        if (out[col] <= 0.0).any():
            bad_row = out.loc[out[col] <= 0.0, ["timestamp", "asset", col]].iloc[0]
            raise AutoQuantValidationError(
                f"Non-positive {col} ({bad_row[col]}) at ({bad_row['timestamp']}, {bad_row['asset']!r})"
            )

    if (out["volume"] < 0.0).any():
        bad_row = out.loc[out["volume"] < 0.0, ["timestamp", "asset", "volume"]].iloc[0]
        raise AutoQuantValidationError(
            f"Negative volume ({bad_row['volume']}) at ({bad_row['timestamp']}, {bad_row['asset']!r})"
        )

    eps = 1e-9
    if (out["high"] + eps < out["low"]).any():
        bad_row = out.loc[out["high"] + eps < out["low"], ["timestamp", "asset", "high", "low"]].iloc[0]
        raise AutoQuantValidationError(
            f"Invalid bar high < low ({bad_row['high']} < {bad_row['low']}) at "
            f"({bad_row['timestamp']}, {bad_row['asset']!r})"
        )
    max_oc = np.maximum(out["open"].to_numpy(), out["close"].to_numpy())
    min_oc = np.minimum(out["open"].to_numpy(), out["close"].to_numpy())
    if (out["high"].to_numpy() + eps < max_oc).any() or (out["low"].to_numpy() - eps > min_oc).any():
        raise AutoQuantValidationError(
            "Invalid OHLC bar geometry: open/close must lie within [low, high]"
        )

    if calendar is not None:
        validate_panel_calendars(out, calendar)

    out.attrs = attrs
    return out


def panel_to_wide(
    panel: pd.DataFrame,
    field: str = "close",
    *,
    validate: bool = False,
) -> pd.DataFrame:
    """Pivot `panel` into a `timestamp x asset` matrix WITHOUT forward-filling."""

    df = validate_panel(panel) if validate else panel
    if field not in df.columns:
        raise AutoQuantValidationError(f"Field {field!r} not found in panel columns")
    wide = df.pivot(index="timestamp", columns="asset", values=field)
    wide = wide.sort_index(axis=0).sort_index(axis=1)
    wide.index.name = "timestamp"
    wide.columns.name = "asset"
    return wide


def wide_close(panel: pd.DataFrame) -> pd.DataFrame:
    """Return wide `timestamp x asset` close price matrix without forward-filling."""

    return panel_to_wide(panel, "close")


def wide_returns(
    panel_or_wide: pd.DataFrame,
    *,
    periods: int = 1,
    log_returns: bool = False,
) -> pd.DataFrame:
    """Compute causal `periods`-bar returns without silent forward-filling across gaps."""

    if periods < 1:
        raise AutoQuantValidationError("periods must be >= 1")
    if {"timestamp", "asset", "close"}.issubset(panel_or_wide.columns):
        prices = panel_to_wide(panel_or_wide, "close")
    else:
        prices = panel_or_wide.sort_index()
    ratio = prices / prices.shift(periods)
    if log_returns:
        return np.log(ratio)
    return ratio - 1.0


def causal_asof_fill(
    panel: pd.DataFrame,
    *,
    max_staleness: int | str | pd.Timedelta,
) -> pd.DataFrame:
    """Explicitly carry forward missing cross-market bars up to `max_staleness`.

    Never backfills before an asset's first real observation, sets carried bar
    `open = high = low = close = last_close` and `volume = 0.0`, and leaves gaps
    exceeding `max_staleness` unfilled.
    """

    validated = validate_panel(panel)
    union_ts = pd.DatetimeIndex(np.sort(validated["timestamp"].unique()))
    if len(union_ts) <= 1:
        return validated.copy()

    use_bar_limit = isinstance(max_staleness, int) and not isinstance(max_staleness, bool)
    if use_bar_limit:
        bar_limit = int(max_staleness)
        if bar_limit < 0:
            raise AutoQuantValidationError("max_staleness bar count must be >= 0")
        if bar_limit == 0:
            return validated.copy()
        td_limit: pd.Timedelta | None = None
    else:
        bar_limit = 0
        try:
            td_limit = pd.Timedelta(max_staleness)
        except ValueError as exc:
            raise AutoQuantValidationError(
                f"Invalid max_staleness {max_staleness!r}; pass int bars or Timedelta"
            ) from exc
        if td_limit < pd.Timedelta(0):
            raise AutoQuantValidationError("max_staleness Timedelta must be >= 0")
        if td_limit == pd.Timedelta(0):
            return validated.copy()

    pieces: list[pd.DataFrame] = []
    for asset, grp in validated.groupby("asset", sort=True):
        grp_indexed = grp.set_index("timestamp").reindex(union_ts)
        observed_mask = grp_indexed["close"].notna()
        first_valid = grp_indexed["close"].first_valid_index()
        if first_valid is None:
            continue

        if use_bar_limit:
            filled_close = grp_indexed["close"].ffill(limit=bar_limit)
        else:
            last_obs_ts = pd.Series(union_ts, index=union_ts).where(observed_mask).ffill()
            age = pd.Series(union_ts, index=union_ts) - last_obs_ts
            filled_close = grp_indexed["close"].ffill()
            assert td_limit is not None
            filled_close = filled_close.where(age <= td_limit)

        keep_mask = filled_close.notna() & (union_ts >= first_valid)
        synthetic_mask = keep_mask & (~observed_mask)

        sub = grp_indexed.loc[keep_mask, ["open", "high", "low", "close", "volume"]].copy()
        synth_idx = union_ts[synthetic_mask]
        if len(synth_idx) > 0:
            carried = filled_close.loc[synth_idx]
            for col in PRICE_COLUMNS:
                sub.loc[synth_idx, col] = carried
            sub.loc[synth_idx, "volume"] = 0.0

        sub = sub.reset_index().rename(columns={"index": "timestamp"})
        sub.insert(1, "asset", str(asset))
        pieces.append(sub.loc[:, list(PANEL_COLUMNS)])

    result = pd.concat(pieces, ignore_index=True)
    result = result.sort_values(["timestamp", "asset"], kind="mergesort").reset_index(drop=True)
    result.attrs = dict(validated.attrs)
    return validate_panel(result)


def aggregate_completed_bars(
    panel: pd.DataFrame,
    freq: str,
    *,
    drop_incomplete: bool = True,
) -> pd.DataFrame:
    """Resample OHLCV bars causally, labeling each aggregated bar at period completion."""

    if not isinstance(freq, str) or not freq.strip():
        raise AutoQuantValidationError("Target frequency must be a non-empty string")
    raw_freq = freq.strip()
    norm_freq = _FREQ_ALIASES.get(raw_freq.lower(), raw_freq)

    validated = validate_panel(panel)
    max_global_ts: pd.Timestamp = validated["timestamp"].max()

    is_fixed_td = False
    target_td: pd.Timedelta | None = None
    try:
        target_td = pd.to_timedelta(norm_freq)
        is_fixed_td = True
    except ValueError:
        is_fixed_td = False

    agg_spec = {
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }

    pieces: list[pd.DataFrame] = []
    for asset, grp in validated.groupby("asset", sort=True):
        ts_index = pd.DatetimeIndex(grp["timestamp"])
        indexed = grp.set_index("timestamp")[list(PRICE_COLUMNS) + ["volume"]]

        if is_fixed_td and target_td is not None:
            if len(ts_index) >= 2:
                diffs = pd.Series(ts_index).diff().dropna()
                base_delta = diffs.median()
            else:
                base_delta = target_td
            # Determine whether input timestamps sit on left boundaries (e.g. 00:00)
            # or right completion boundaries.
            aligned_left = bool(
                (ts_index[0].value % target_td.value == 0)
                and (base_delta < target_td)
            )
            closed_side = "left" if aligned_left else "right"
            resampled = indexed.resample(norm_freq, closed=closed_side, label="right").agg(agg_spec)
            resampled = resampled.dropna(subset=["close"])
            if drop_incomplete and not resampled.empty:
                effective_horizon = (
                    max_global_ts + base_delta if closed_side == "left" else max_global_ts
                )
                resampled = resampled.loc[resampled.index <= effective_horizon]
        else:
            resampled = indexed.resample(norm_freq, closed="right", label="right").agg(agg_spec)
            resampled = resampled.dropna(subset=["close"])
            if drop_incomplete and not resampled.empty:
                keep_labels = []
                for lbl in resampled.index:
                    if lbl <= max_global_ts:
                        keep_labels.append(True)
                    elif lbl.weekday() >= 5 and (lbl - max_global_ts) <= pd.Timedelta(days=2):
                        # Weekend month/quarter end after Friday close
                        keep_labels.append(True)
                    else:
                        keep_labels.append(False)
                resampled = resampled.loc[keep_labels]

        if resampled.empty:
            continue
        sub = resampled.reset_index().rename(columns={"index": "timestamp"})
        sub.insert(1, "asset", str(asset))
        pieces.append(sub.loc[:, list(PANEL_COLUMNS)])

    if not pieces:
        raise AutoQuantValidationError(
            f"No completed {freq!r} bars available in panel spanning "
            f"{validated['timestamp'].min()} .. {validated['timestamp'].max()}"
        )
    out = pd.concat(pieces, ignore_index=True)
    out = out.sort_values(["timestamp", "asset"], kind="mergesort").reset_index(drop=True)
    out.attrs = dict(validated.attrs)
    return validate_panel(out)
