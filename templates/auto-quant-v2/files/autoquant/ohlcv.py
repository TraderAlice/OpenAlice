"""Conventional OHLCV normalization for caller-owned V2 dataset intake."""

from __future__ import annotations

import pandas as pd


OHLCV_COLUMNS = ("date", "open", "high", "low", "close", "volume")


class OhlcvValidationError(ValueError):
    """Raised when caller-supplied OHLCV cannot enter a V2 Project."""


def normalize_ohlcv(frame: pd.DataFrame, *, source: str = "<dataframe>") -> pd.DataFrame:
    """Normalize one conventional OHLCV table to the V2 intake surface."""

    frame = frame.copy()
    frame.columns = [str(column).strip().lower() for column in frame.columns]
    if "date" not in frame.columns:
        for alias in ("datetime", "timestamp", "time"):
            if alias in frame.columns:
                frame.rename(columns={alias: "date"}, inplace=True)
                break

    missing = [column for column in OHLCV_COLUMNS if column not in frame.columns]
    if missing:
        raise OhlcvValidationError(f"{source}: missing OHLCV columns {missing}")

    raw_date = frame["date"]
    if pd.api.types.is_numeric_dtype(raw_date):
        non_null = raw_date.dropna()
        sample = float(non_null.iloc[0]) if not non_null.empty else 0.0
        unit = "ms" if abs(sample) >= 100_000_000_000 else "s"
        frame["date"] = pd.to_datetime(raw_date, unit=unit, utc=True, errors="coerce")
    else:
        frame["date"] = pd.to_datetime(raw_date, utc=True, errors="coerce")

    for column in OHLCV_COLUMNS[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    frame = frame.loc[:, list(OHLCV_COLUMNS)].sort_values("date").reset_index(drop=True)
    if frame.empty:
        raise OhlcvValidationError(f"{source}: OHLCV table is empty")
    if frame.isna().any().any():
        bad = [column for column in OHLCV_COLUMNS if frame[column].isna().any()]
        raise OhlcvValidationError(f"{source}: null or unparsable values in {bad}")
    if frame["date"].duplicated().any():
        raise OhlcvValidationError(f"{source}: duplicate candle timestamps")
    if (frame["volume"] < 0).any():
        raise OhlcvValidationError(f"{source}: volume must be non-negative")

    invalid_high = frame["high"] < frame[["open", "low", "close"]].max(axis=1)
    invalid_low = frame["low"] > frame[["open", "high", "close"]].min(axis=1)
    if invalid_high.any() or invalid_low.any():
        raise OhlcvValidationError(f"{source}: OHLC price bounds are inconsistent")
    return frame
