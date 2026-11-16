"""Fetch an auditable continuous Binance Spot hourly staging package."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd


BASE_URL = "https://data-api.binance.vision/api/v3/klines"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
HOUR = timedelta(hours=1)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "expected timezone-aware ISO-8601 timestamp"
        ) from exc
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("timestamp must include a UTC offset")
    return parsed.astimezone(timezone.utc)


def load_assets(path: Path) -> list[dict[str, str]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    required = {"symbol", "providerSymbol", "venue", "currency"}
    if not isinstance(raw, list) or not raw:
        raise ValueError("assets file must contain a non-empty JSON array")
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
        assets.append(normalized)
    for key in ("symbol", "providerSymbol"):
        values = [item[key] for item in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def milliseconds(value: datetime) -> int:
    return int(value.timestamp() * 1000)


def fetch_page(
    provider_symbol: str,
    start_open: datetime,
    final_open: datetime,
) -> list[list[Any]]:
    query = urllib.parse.urlencode(
        {
            "symbol": provider_symbol,
            "interval": "1h",
            "startTime": milliseconds(start_open),
            "endTime": milliseconds(final_open),
            "limit": 1000,
        }
    )
    request = urllib.request.Request(
        f"{BASE_URL}?{query}",
        headers={"User-Agent": "AutoQuantMarketDataSkill/1.0"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
            if not isinstance(payload, list):
                raise ValueError(
                    f"{provider_symbol}: unexpected payload {payload!r}"
                )
            return payload
        except Exception:
            if attempt == 4:
                raise
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def fetch_symbol(
    provider_symbol: str,
    start_close: datetime,
    end_close: datetime,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    rows: list[list[Any]] = []
    cursor = start_close - HOUR
    final_open = end_close - HOUR
    pages = 0
    while cursor <= final_open:
        page = fetch_page(provider_symbol, cursor, final_open)
        pages += 1
        if not page:
            raise ValueError(
                f"{provider_symbol}: no K-lines from {cursor.isoformat()}"
            )
        rows.extend(page)
        last_open = datetime.fromtimestamp(int(page[-1][0]) / 1000, tz=timezone.utc)
        if last_open < cursor:
            raise ValueError(f"{provider_symbol}: pagination did not advance")
        cursor = last_open + HOUR
        time.sleep(0.05)

    frame = pd.DataFrame(
        {
            "timestamp": [
                datetime.fromtimestamp(int(row[0]) / 1000, tz=timezone.utc)
                + HOUR
                for row in rows
            ],
            "open": [row[1] for row in rows],
            "high": [row[2] for row in rows],
            "low": [row[3] for row in rows],
            "close": [row[4] for row in rows],
            "volume": [row[5] for row in rows],
        }
    )
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    frame = frame.loc[
        (frame["timestamp"] >= start_close)
        & (frame["timestamp"] <= end_close)
    ].sort_values("timestamp")
    duplicates = int(frame["timestamp"].duplicated(keep="last").sum())
    frame = frame.drop_duplicates("timestamp", keep="last")
    expected = pd.date_range(start_close, end_close, freq="1h", tz="UTC")
    actual = pd.DatetimeIndex(frame["timestamp"])
    if not actual.as_unit("ns").equals(expected.as_unit("ns")):
        missing = expected.difference(actual)
        extra = actual.difference(expected)
        raise ValueError(
            f"{provider_symbol}: non-continuous closed bars "
            f"missing={list(missing[:3])} extra={list(extra[:3])}"
        )
    invalid = (
        ~(frame[["open", "high", "low", "close"]] > 0).all(axis=1)
        | frame["volume"].lt(0)
    )
    if invalid.any():
        raise ValueError(f"{provider_symbol}: invalid OHLCV rows")
    invalid_bounds = (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    )
    if invalid_bounds.any():
        raise ValueError(f"{provider_symbol}: inconsistent OHLC bounds")
    frame["timestamp"] = frame["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return frame.reset_index(drop=True), {
        "pages": pages,
        "providerRows": len(rows),
        "outputRows": len(frame),
        "duplicateRowsDropped": duplicates,
        "zeroVolumeRows": int(frame["volume"].eq(0).sum()),
        "firstClose": frame["timestamp"].iloc[0],
        "lastClose": frame["timestamp"].iloc[-1],
    }


def ensure_output(path: Path) -> None:
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError(f"output must be absent or empty: {path}")
    path.mkdir(parents=True, exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--start-close", type=parse_timestamp, required=True)
    parser.add_argument("--end-close", type=parse_timestamp, required=True)
    parser.add_argument(
        "--feature-intervals",
        default="3h,4h,6h,12h,1d",
    )
    parser.add_argument("--terms", required=True)
    args = parser.parse_args()
    if args.end_close < args.start_close:
        parser.error("--end-close must not precede --start-close")
    if (
        args.start_close.minute
        or args.start_close.second
        or args.start_close.microsecond
        or args.end_close.minute
        or args.end_close.second
        or args.end_close.microsecond
    ):
        parser.error("hourly close timestamps must be exact UTC hours")
    if not SAFE_SYMBOL.fullmatch(args.dataset_id):
        parser.error("--dataset-id must be a path-safe AutoQuant identifier")
    feature_intervals = [
        item.strip()
        for item in args.feature_intervals.split(",")
        if item.strip()
    ]
    if not feature_intervals:
        parser.error("--feature-intervals cannot be empty")

    assets = load_assets(args.assets.expanduser().absolute())
    output = args.output.expanduser().absolute()
    ensure_output(output)
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    audits: dict[str, Any] = {}
    for asset in assets:
        frame, summary = fetch_symbol(
            asset["providerSymbol"],
            args.start_close,
            args.end_close,
        )
        csv_path = output / f"{asset['symbol']}.csv"
        frame.to_csv(csv_path, index=False)
        audits[asset["symbol"]] = {
            **summary,
            "providerSymbol": asset["providerSymbol"],
            "declaredVenue": asset["venue"],
            "declaredCurrency": asset["currency"],
            "csvPath": csv_path.name,
            "csvSha256": sha256(csv_path),
        }

    package = {
        "schemaVersion": 2,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": args.dataset_id,
        "version": (
            f"{args.start_close.strftime('%Y-%m-%dT%H:%MZ')}_"
            f"{args.end_close.strftime('%Y-%m-%dT%H:%MZ')}"
        ),
        "assetClass": "crypto",
        "baseInterval": "1h",
        "featureIntervals": feature_intervals,
        "timestampSemantics": "bar-close",
        "aggregation": {
            "method": "complete-utc-midnight-bar-close-v1",
            "anchor": "00:00",
        },
        "market": {
            "clock": "continuous",
            "calendar": "24/7",
            "timezone": "UTC",
        },
        "priceAdjustment": "raw",
        "provider": {
            "name": "binance-spot-public-klines",
            "retrievedAt": retrieved_at,
            "sourceUri": BASE_URL,
            "terms": args.terms,
        },
        "assets": [
            {
                "symbol": asset["symbol"],
                "venue": asset["venue"],
                "currency": asset["currency"],
                "path": f"{asset['symbol']}.csv",
            }
            for asset in assets
        ],
    }
    package_path = output / "dataset-package.json"
    package_path.write_text(
        json.dumps(package, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    audit = {
        "schemaVersion": 1,
        "kind": "autoquant-provider-acquisition-audit",
        "provider": package["provider"],
        "request": {
            "startClose": args.start_close.isoformat(),
            "endClose": args.end_close.isoformat(),
            "baseInterval": "1h",
            "featureIntervals": feature_intervals,
        },
        "timestampTransformation": (
            "Binance open time plus one nominal hour; output means bar close"
        ),
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "Spot OHLCV is not order-book, fill, futures, or account evidence.",
            "Provider identity and access terms remain external claims.",
        ],
    }
    (output / "provider-audit.json").write_text(
        json.dumps(audit, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "datasetPackage": str(package_path),
                "retrievedAt": retrieved_at,
                "assets": len(assets),
                "rowsPerAsset": len(
                    pd.date_range(
                        args.start_close,
                        args.end_close,
                        freq="1h",
                        tz="UTC",
                    )
                ),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
