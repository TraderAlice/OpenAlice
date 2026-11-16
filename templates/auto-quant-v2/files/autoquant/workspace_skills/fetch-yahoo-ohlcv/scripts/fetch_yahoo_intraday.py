"""Fetch one strict auditable Yahoo Chart XNYS 1h OHLCV package."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, NamedTuple

import exchange_calendars
import pandas as pd


CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
ASSET_CLASSES = {
    "crypto",
    "equity",
    "forex",
    "fund",
    "future",
    "index",
}
EXPECTED_CALENDAR = "XNYS"
EXPECTED_TIMEZONE = "America/New_York"
BASE_INTERVAL = "1h"
SUPPORTED_FEATURE_INTERVALS = ("3h", "4h", "6h", "1d")
MAX_LOOKBACK_DAYS = 730
QUERY_WARMUP = pd.Timedelta(hours=1)
SELECTED_RESPONSE_HEADERS = {
    "age",
    "cache-control",
    "content-length",
    "content-type",
    "date",
    "expires",
    "last-modified",
}
OHLCV_COLUMNS = ("open", "high", "low", "close", "volume")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def parse_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise argparse.ArgumentTypeError("expected YYYY-MM-DD") from exc


def utc_iso(value: pd.Timestamp | datetime) -> str:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return timestamp.isoformat()


def load_assets(path: Path) -> list[dict[str, str]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise ValueError("assets file must contain a non-empty JSON array")
    required = {"symbol", "providerSymbol", "venue", "currency", "assetClass"}
    assets: list[dict[str, str]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict) or set(item) != required:
            raise ValueError(
                f"assets[{index}] must contain exactly {sorted(required)}"
            )
        normalized = {
            key: value.strip() if isinstance(value, str) else value
            for key, value in item.items()
        }
        if not all(isinstance(value, str) and value for value in normalized.values()):
            raise ValueError(f"assets[{index}] values must be non-empty strings")
        if not SAFE_SYMBOL.fullmatch(normalized["symbol"]):
            raise ValueError(f"assets[{index}].symbol is not path-safe")
        if normalized["assetClass"] not in ASSET_CLASSES:
            raise ValueError(f"assets[{index}].assetClass is unsupported")
        assets.append(normalized)
    for key in ("symbol", "providerSymbol"):
        values = [item[key] for item in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def requested_schedule(start: date, end_exclusive: date) -> pd.DataFrame:
    if end_exclusive <= start:
        raise ValueError("end-exclusive must be after start")
    calendar = exchange_calendars.get_calendar(
        EXPECTED_CALENDAR,
        start=start.isoformat(),
        end=end_exclusive.isoformat(),
    )
    schedule = calendar.schedule[["open", "close"]].copy()
    schedule = schedule.loc[
        (schedule.index.date >= start) & (schedule.index.date < end_exclusive)
    ]
    if schedule.empty:
        raise ValueError("requested date range contains no XNYS regular session")
    return schedule


class ExpectedSlot(NamedTuple):
    session_date: str
    provider_start: pd.Timestamp
    canonical_close: pd.Timestamp

    def to_dict(self) -> dict[str, str]:
        return {
            "sessionDate": self.session_date,
            "providerStart": utc_iso(self.provider_start),
            "canonicalClose": utc_iso(self.canonical_close),
        }


def expected_slots(schedule: pd.DataFrame) -> tuple[ExpectedSlot, ...]:
    slots: list[ExpectedSlot] = []
    duration = pd.Timedelta(hours=1)
    for session_label, row in schedule.iterrows():
        provider_start = row.open
        while provider_start < row.close:
            slots.append(
                ExpectedSlot(
                    session_date=str(session_label.date()),
                    provider_start=provider_start,
                    canonical_close=min(provider_start + duration, row.close),
                )
            )
            provider_start += duration
    return tuple(slots)


def range_eligibility(
    first_open: pd.Timestamp,
    retrieved_at: datetime,
) -> dict[str, Any]:
    as_of = pd.Timestamp(retrieved_at)
    if as_of.tzinfo is None:
        as_of = as_of.tz_localize("UTC")
    else:
        as_of = as_of.tz_convert("UTC")
    oldest = as_of - pd.Timedelta(days=MAX_LOOKBACK_DAYS)
    provider_period1 = first_open - QUERY_WARMUP
    eligible = provider_period1 >= oldest
    return {
        "providerLimitDays": MAX_LOOKBACK_DAYS,
        "checkedAt": utc_iso(as_of),
        "earliestEligibleStart": utc_iso(oldest),
        "providerPeriod1": utc_iso(provider_period1),
        "requestedFirstSessionOpen": utc_iso(first_open),
        "locallyEligible": bool(eligible),
        "authority": (
            "local preflight estimate only; Yahoo response remains final"
        ),
    }


def request_uri(
    provider_symbol: str,
    schedule: pd.DataFrame,
) -> str:
    first_open = schedule.iloc[0].open
    provider_period1 = first_open - QUERY_WARMUP
    last_close = schedule.iloc[-1].close
    query = urllib.parse.urlencode(
        {
            "period1": int(provider_period1.timestamp()),
            "period2": int(last_close.timestamp()) + 1,
            "interval": BASE_INTERVAL,
            "events": "div,splits",
            "includePrePost": "false",
            "includeAdjustedClose": "false",
        }
    )
    encoded = urllib.parse.quote(provider_symbol, safe="")
    return f"{CHART_URL.format(symbol=encoded)}?{query}"


def selected_headers(headers: Any) -> dict[str, str]:
    return {
        str(key): str(value)
        for key, value in headers.items()
        if str(key).lower() in SELECTED_RESPONSE_HEADERS
    }


class ProviderRequestError(RuntimeError):
    def __init__(self, message: str, attempts: list[dict[str, Any]], body: bytes):
        super().__init__(message)
        self.attempts = attempts
        self.body = body


def fetch_bytes(uri: str) -> tuple[bytes, list[dict[str, Any]]]:
    request = urllib.request.Request(
        uri,
        headers={"User-Agent": "Mozilla/5.0 AutoQuantMarketDataSkill/1.0"},
    )
    attempts: list[dict[str, Any]] = []
    last_body = b""
    for attempt in range(1, 5):
        attempted_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
                attempts.append(
                    {
                        "attempt": attempt,
                        "attemptedAt": attempted_at,
                        "status": int(getattr(response, "status", 200)),
                        "headers": selected_headers(response.headers),
                        "bodyBytes": len(body),
                        "bodySha256": sha256_bytes(body),
                    }
                )
                return body, attempts
        except urllib.error.HTTPError as error:
            last_body = error.read()
            attempts.append(
                {
                    "attempt": attempt,
                    "attemptedAt": attempted_at,
                    "status": error.code,
                    "headers": selected_headers(error.headers),
                    "bodyBytes": len(last_body),
                    "bodySha256": sha256_bytes(last_body),
                    "error": str(error),
                }
            )
            retryable = error.code in {408, 425, 429, 500, 502, 503, 504}
            if not retryable or attempt == 4:
                raise ProviderRequestError(str(error), attempts, last_body) from error
        except Exception as error:
            attempts.append(
                {
                    "attempt": attempt,
                    "attemptedAt": attempted_at,
                    "status": None,
                    "headers": {},
                    "bodyBytes": 0,
                    "bodySha256": sha256_bytes(b""),
                    "error": f"{type(error).__name__}: {error}",
                }
            )
            if attempt == 4:
                raise ProviderRequestError(str(error), attempts, b"") from error
        time.sleep(float(attempt))
    raise AssertionError("unreachable")


def result_for(provider_symbol: str, payload: dict[str, Any]) -> dict[str, Any]:
    chart = payload.get("chart")
    if not isinstance(chart, dict):
        raise ValueError(f"{provider_symbol}: Yahoo response lacks chart")
    if chart.get("error") is not None or not chart.get("result"):
        raise ValueError(
            f"{provider_symbol}: Yahoo returned {chart.get('error')!r}"
        )
    result = chart["result"][0]
    if not isinstance(result, dict):
        raise ValueError(f"{provider_symbol}: Yahoo result is not an object")
    return result


def row_observation(timestamp: pd.Timestamp, row: dict[str, Any]) -> dict[str, Any]:
    return {
        "providerTimestamp": utc_iso(timestamp),
        **{column: row.get(column) for column in OHLCV_COLUMNS},
    }


def _finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def evaluate_result(
    provider_symbol: str,
    result: dict[str, Any],
    schedule: pd.DataFrame,
) -> tuple[pd.DataFrame | None, dict[str, Any]]:
    """Evaluate one response without repairing or dropping requested bars."""

    slots = expected_slots(schedule)
    slot_by_start = {slot.provider_start: slot for slot in slots}
    first_open = schedule.iloc[0].open
    last_close = schedule.iloc[-1].close
    metadata = result.get("meta") if isinstance(result.get("meta"), dict) else {}
    issues: list[dict[str, Any]] = []
    if metadata.get("exchangeTimezoneName") != EXPECTED_TIMEZONE:
        issues.append(
            {
                "code": "provider.timezone",
                "message": (
                    "Yahoo exchangeTimezoneName must be "
                    f"{EXPECTED_TIMEZONE!r}"
                ),
                "observed": metadata.get("exchangeTimezoneName"),
            }
        )
    if metadata.get("dataGranularity") not in {"1h", "60m"}:
        issues.append(
            {
                "code": "provider.interval",
                "message": "Yahoo dataGranularity must be 1h or 60m",
                "observed": metadata.get("dataGranularity"),
            }
        )

    timestamps = result.get("timestamp")
    indicators = result.get("indicators")
    quotes = indicators.get("quote") if isinstance(indicators, dict) else None
    quote = quotes[0] if isinstance(quotes, list) and quotes else None
    if not isinstance(timestamps, list) or not isinstance(quote, dict):
        issues.append(
            {
                "code": "provider.shape",
                "message": "Yahoo response lacks timestamp or quote arrays",
            }
        )
        timestamps = []
        quote = {}

    lengths = {"timestamp": len(timestamps)}
    for column in OHLCV_COLUMNS:
        values = quote.get(column)
        lengths[column] = len(values) if isinstance(values, list) else -1
    if len(set(lengths.values())) != 1 or -1 in lengths.values():
        issues.append(
            {
                "code": "provider.array-length",
                "message": "Yahoo timestamp and OHLCV arrays must have equal lengths",
                "lengths": lengths,
            }
        )

    usable_length = min((value for value in lengths.values() if value >= 0), default=0)
    rows: list[tuple[pd.Timestamp, dict[str, Any]]] = []
    invalid_timestamp_rows: list[dict[str, Any]] = []
    for index in range(usable_length):
        raw_timestamp = timestamps[index]
        try:
            timestamp = pd.Timestamp(int(raw_timestamp), unit="s", tz="UTC")
        except (TypeError, ValueError, OverflowError):
            invalid_timestamp_rows.append(
                {"index": index, "providerTimestamp": raw_timestamp}
            )
            continue
        rows.append(
            (
                timestamp,
                {
                    column: quote[column][index]
                    for column in OHLCV_COLUMNS
                },
            )
        )
    if invalid_timestamp_rows:
        issues.append(
            {
                "code": "provider.timestamp",
                "message": "Yahoo returned invalid epoch timestamps",
                "observations": invalid_timestamp_rows,
            }
        )

    in_request_rows = [
        item for item in rows if first_open <= item[0] <= last_close
    ]
    out_of_range_rows = [
        row_observation(timestamp, row)
        for timestamp, row in rows
        if timestamp < first_open or timestamp > last_close
    ]
    counts = Counter(timestamp for timestamp, _ in in_request_rows)
    duplicates = [
        {"providerTimestamp": utc_iso(timestamp), "count": count}
        for timestamp, count in sorted(counts.items())
        if count > 1
    ]
    if duplicates:
        issues.append(
            {
                "code": "provider.duplicate-start",
                "message": "Yahoo returned duplicate provider bucket starts",
                "observations": duplicates,
            }
        )

    unexpected = [
        row_observation(timestamp, row)
        for timestamp, row in in_request_rows
        if timestamp not in slot_by_start
    ]
    if unexpected:
        issues.append(
            {
                "code": "provider.noncanonical-start",
                "message": (
                    "Yahoo returned in-range rows that are not canonical "
                    "XNYS provider bucket starts"
                ),
                "observations": unexpected,
            }
        )

    row_by_start = {
        timestamp: row
        for timestamp, row in in_request_rows
        if counts[timestamp] == 1 and timestamp in slot_by_start
    }
    missing_slots: list[dict[str, Any]] = []
    invalid_rows: list[dict[str, Any]] = []
    normalized_rows: list[dict[str, Any]] = []
    zero_volume_observations: list[dict[str, Any]] = []
    for slot in slots:
        row = row_by_start.get(slot.provider_start)
        if row is None:
            missing_slots.append(slot.to_dict())
            continue
        observation = {**slot.to_dict(), **row}
        if not all(_finite_number(row[column]) for column in OHLCV_COLUMNS):
            invalid_rows.append(
                {
                    "code": "provider.null-or-nonfinite",
                    **observation,
                }
            )
            continue
        values = {column: float(row[column]) for column in OHLCV_COLUMNS}
        if (
            any(values[column] <= 0 for column in ("open", "high", "low", "close"))
            or values["volume"] < 0
        ):
            invalid_rows.append(
                {"code": "provider.invalid-value", **slot.to_dict(), **values}
            )
            continue
        if (
            values["high"] < max(values["open"], values["low"], values["close"])
            or values["low"] > min(values["open"], values["high"], values["close"])
        ):
            invalid_rows.append(
                {"code": "provider.invalid-ohlc", **slot.to_dict(), **values}
            )
            continue
        if values["volume"] == 0:
            zero_volume_observations.append(
                {**slot.to_dict(), **values}
            )
        normalized_rows.append(
            {
                "timestamp": utc_iso(slot.canonical_close),
                **values,
            }
        )
    if missing_slots:
        issues.append(
            {
                "code": "provider.missing-bars",
                "message": "Yahoo omitted expected XNYS 1h provider bucket starts",
                "observations": missing_slots,
            }
        )
    if invalid_rows:
        issues.append(
            {
                "code": "provider.invalid-bars",
                "message": "Yahoo expected bucket rows contain unusable OHLCV",
                "observations": invalid_rows,
            }
        )

    status = "accepted" if not issues else "rejected"
    frame = None
    if status == "accepted":
        frame = pd.DataFrame(normalized_rows, columns=("timestamp", *OHLCV_COLUMNS))
    events = result.get("events") if isinstance(result.get("events"), dict) else {}
    audit = {
        "status": status,
        "providerSymbol": provider_symbol,
        "providerMetadata": {
            key: metadata.get(key)
            for key in (
                "symbol",
                "instrumentType",
                "exchangeName",
                "fullExchangeName",
                "currency",
                "exchangeTimezoneName",
                "dataGranularity",
                "longName",
                "shortName",
            )
        },
        "expectedRows": len(slots),
        "sourceRows": len(timestamps),
        "parsedRows": len(rows),
        "inRequestRows": len(in_request_rows),
        "outOfRangeRows": len(out_of_range_rows),
        "outOfRangeObservations": out_of_range_rows,
        "missingRows": len(missing_slots),
        "invalidRows": len(invalid_rows),
        "unexpectedRows": len(unexpected),
        "duplicateStarts": len(duplicates),
        "zeroVolumeRows": len(zero_volume_observations),
        "zeroVolumeObservations": zero_volume_observations,
        "normalizedRows": len(normalized_rows),
        "firstCanonicalClose": (
            normalized_rows[0]["timestamp"] if normalized_rows else None
        ),
        "lastCanonicalClose": (
            normalized_rows[-1]["timestamp"] if normalized_rows else None
        ),
        "events": {
            key: len(value) if isinstance(value, dict) else 0
            for key, value in events.items()
        },
        "issues": issues,
        "timestampTransformation": (
            "Yahoo provider bucket start mapped to min(start + 1h, "
            "scheduled XNYS regular-session close); OHLCV values unchanged"
        ),
    }
    return frame, audit


def ensure_output(path: Path) -> None:
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError(f"output must be absent or empty: {path}")
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--start", type=parse_date, required=True)
    parser.add_argument("--end-exclusive", type=parse_date, required=True)
    parser.add_argument("--calendar", choices=(EXPECTED_CALENDAR,), required=True)
    parser.add_argument("--timezone", choices=(EXPECTED_TIMEZONE,), required=True)
    parser.add_argument("--interval", choices=(BASE_INTERVAL,), required=True)
    parser.add_argument(
        "--feature-interval",
        action="append",
        required=True,
        dest="feature_intervals",
        help="repeat for each completed higher interval, for example 1d",
    )
    parser.add_argument(
        "--adjustment",
        choices=("split-adjusted",),
        required=True,
    )
    parser.add_argument("--panel", choices=("aligned",), required=True)
    parser.add_argument("--terms", required=True)
    args = parser.parse_args()

    if not SAFE_SYMBOL.fullmatch(args.dataset_id):
        parser.error("--dataset-id must be a path-safe AutoQuant identifier")
    if (
        len(args.feature_intervals) != len(set(args.feature_intervals))
        or any(
            interval not in SUPPORTED_FEATURE_INTERVALS
            for interval in args.feature_intervals
        )
    ):
        parser.error(
            "--feature-interval values must be unique selections from: "
            + ", ".join(SUPPORTED_FEATURE_INTERVALS)
        )
    assets = load_assets(args.assets.expanduser().absolute())
    schedule = requested_schedule(args.start, args.end_exclusive)
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0)
    if schedule.iloc[-1].close > pd.Timestamp(retrieved_at):
        parser.error("requested range includes an incomplete XNYS session")
    eligibility = range_eligibility(schedule.iloc[0].open, retrieved_at)

    output = args.output.expanduser().absolute()
    ensure_output(output)
    raw_dir = output / "raw"
    raw_dir.mkdir()
    request_contract = {
        "start": args.start.isoformat(),
        "endExclusive": args.end_exclusive.isoformat(),
        "interval": BASE_INTERVAL,
        "featureIntervals": args.feature_intervals,
        "calendar": EXPECTED_CALENDAR,
        "timezone": EXPECTED_TIMEZONE,
        "adjustment": "split-adjusted",
        "panel": "aligned",
        "expectedSessions": len(schedule),
        "expectedRowsPerAsset": len(expected_slots(schedule)),
        "rangeEligibility": eligibility,
    }
    audits: dict[str, Any] = {}
    frames: dict[str, pd.DataFrame] = {}
    failures: list[dict[str, Any]] = []

    if not eligibility["locallyEligible"]:
        failures.append(
            {
                "code": "provider.range-preflight",
                "message": (
                    "the one-hour-warmup provider period1 is outside Yahoo's observed "
                    f"trailing {MAX_LOOKBACK_DAYS}-day 1h limit"
                ),
                "rangeEligibility": eligibility,
            }
        )
    else:
        for asset in assets:
            symbol = asset["symbol"]
            provider_symbol = asset["providerSymbol"]
            uri = request_uri(provider_symbol, schedule)
            raw_path = raw_dir / f"{symbol}.json"
            attempts: list[dict[str, Any]] = []
            try:
                body, attempts = fetch_bytes(uri)
                raw_path.write_bytes(body)
                payload = json.loads(body)
                result = result_for(provider_symbol, payload)
                frame, audit = evaluate_result(provider_symbol, result, schedule)
                audit.update(
                    {
                        "declaredVenue": asset["venue"],
                        "declaredCurrency": asset["currency"],
                        "declaredAssetClass": asset["assetClass"],
                        "requestUri": uri,
                        "requestAttempts": attempts,
                        "rawPath": raw_path.relative_to(output).as_posix(),
                        "rawSha256": sha256(raw_path),
                    }
                )
                audits[symbol] = audit
                if frame is None:
                    failures.append(
                        {
                            "code": "provider.asset-rejected",
                            "symbol": symbol,
                            "message": (
                                "provider response cannot form exact XNYS 1h authority"
                            ),
                            "issues": audit["issues"],
                        }
                    )
                else:
                    frames[symbol] = frame
            except ProviderRequestError as error:
                if error.body:
                    raw_path.write_bytes(error.body)
                audit = {
                    "status": "request-failed",
                    "providerSymbol": provider_symbol,
                    "declaredVenue": asset["venue"],
                    "declaredCurrency": asset["currency"],
                    "declaredAssetClass": asset["assetClass"],
                    "requestUri": uri,
                    "requestAttempts": error.attempts,
                    "rawPath": (
                        raw_path.relative_to(output).as_posix()
                        if raw_path.exists()
                        else None
                    ),
                    "rawSha256": sha256(raw_path) if raw_path.exists() else None,
                    "issues": [
                        {"code": "provider.request", "message": str(error)}
                    ],
                }
                audits[symbol] = audit
                failures.append(
                    {
                        "code": "provider.request",
                        "symbol": symbol,
                        "message": str(error),
                    }
                )
            except Exception as error:
                audits[symbol] = {
                    "status": "response-failed",
                    "providerSymbol": provider_symbol,
                    "declaredVenue": asset["venue"],
                    "declaredCurrency": asset["currency"],
                    "declaredAssetClass": asset["assetClass"],
                    "requestUri": uri,
                    "requestAttempts": attempts,
                    "rawPath": (
                        raw_path.relative_to(output).as_posix()
                        if raw_path.exists()
                        else None
                    ),
                    "rawSha256": sha256(raw_path) if raw_path.exists() else None,
                    "issues": [
                        {
                            "code": "provider.response",
                            "message": f"{type(error).__name__}: {error}",
                        }
                    ],
                }
                failures.append(
                    {
                        "code": "provider.response",
                        "symbol": symbol,
                        "message": f"{type(error).__name__}: {error}",
                    }
                )

    provider_claim = {
        "name": "yahoo-finance-chart",
        "retrievedAt": retrieved_at.isoformat(),
        "sourceUri": "https://query1.finance.yahoo.com/v8/finance/chart/",
        "terms": args.terms,
    }
    if failures:
        failure = {
            "schemaVersion": 1,
            "kind": "autoquant-provider-acquisition-failure",
            "provider": provider_claim,
            "request": request_contract,
            "status": "no-dataset-authority",
            "failures": failures,
            "assets": audits,
            "packageCreated": False,
            "limitations": [
                "Yahoo Chart is provider evidence, not venue authority.",
                "Missing or unusable bars are not reconstructed or dropped.",
                "No interval, range, universe, or panel fallback was applied.",
            ],
        }
        write_json(output / "provider-failure.json", failure)
        raise RuntimeError(
            "Yahoo intraday request cannot form exact XNYS V3 authority; "
            f"see {output / 'provider-failure.json'}"
        )

    canonical_panels = {
        tuple(frame["timestamp"].tolist()) for frame in frames.values()
    }
    if len(canonical_panels) != 1 or len(frames) != len(assets):
        failure = {
            "schemaVersion": 1,
            "kind": "autoquant-provider-acquisition-failure",
            "provider": provider_claim,
            "request": request_contract,
            "status": "no-dataset-authority",
            "failures": [
                {
                    "code": "provider.panel-alignment",
                    "message": "accepted asset frames do not share one exact panel",
                }
            ],
            "assets": audits,
            "packageCreated": False,
        }
        write_json(output / "provider-failure.json", failure)
        raise RuntimeError("Yahoo intraday asset panels are not aligned")

    for asset in assets:
        symbol = asset["symbol"]
        csv_path = output / f"{symbol}.csv"
        frames[symbol].to_csv(csv_path, index=False)
        audits[symbol]["csvPath"] = csv_path.name
        audits[symbol]["csvSha256"] = sha256(csv_path)

    classes = {asset["assetClass"] for asset in assets}
    package = {
        "schemaVersion": 3,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": args.dataset_id,
        "version": (
            f"{args.start.isoformat()}_"
            f"{(args.end_exclusive - timedelta(days=1)).isoformat()}_1h"
        ),
        "assetClass": next(iter(classes)) if len(classes) == 1 else "mixed",
        "baseInterval": BASE_INTERVAL,
        "featureIntervals": args.feature_intervals,
        "timestampSemantics": "bar-close",
        "aggregation": {
            "method": "complete-xnys-regular-session-bar-close-v1",
            "anchor": "market-open",
            "terminalBucketPolicy": "complete-at-session-close",
        },
        "market": {
            "clock": "session",
            "calendar": EXPECTED_CALENDAR,
            "timezone": EXPECTED_TIMEZONE,
        },
        "priceAdjustment": "split-adjusted",
        "provider": provider_claim,
        "assets": [
            {
                "symbol": asset["symbol"],
                "assetClass": asset["assetClass"],
                "venue": asset["venue"],
                "currency": asset["currency"],
                "path": f"{asset['symbol']}.csv",
            }
            for asset in assets
        ],
    }
    package_path = output / "dataset-package.json"
    write_json(package_path, package)
    audit = {
        "schemaVersion": 1,
        "kind": "autoquant-provider-acquisition-audit",
        "provider": provider_claim,
        "request": request_contract,
        "status": "package-created",
        "priceSemantics": (
            "Yahoo quote OHLC is treated as split-adjusted; intraday adjusted "
            "close is unavailable and provider volume is unchanged"
        ),
        "timestampTransformation": (
            "provider bucket starts mapped to canonical completed XNYS closes"
        ),
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "Yahoo Chart is broad provider evidence, not venue authority.",
            "Provider metadata and split-adjustment claims are not authenticated.",
            "Historical 1h availability is limited to the provider's trailing window.",
            "Nasdaq daily history is not an independent hourly peer.",
            "No survivorship, delisting, redistribution, or official-feed claim follows.",
        ],
    }
    write_json(output / "provider-audit.json", audit)
    print(
        json.dumps(
            {
                "datasetPackage": str(package_path),
                "providerAudit": str(output / "provider-audit.json"),
                "retrievedAt": retrieved_at.isoformat(),
                "assets": len(assets),
                "sessions": len(schedule),
                "rowsPerAsset": len(expected_slots(schedule)),
                "baseInterval": BASE_INTERVAL,
                "featureIntervals": args.feature_intervals,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
