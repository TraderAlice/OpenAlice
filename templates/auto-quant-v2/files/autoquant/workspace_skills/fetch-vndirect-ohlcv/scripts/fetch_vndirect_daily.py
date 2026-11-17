"""Fetch auditable Vietnam daily OHLCV from VNDIRECT."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd


BASE_URL = "https://api-finfo.vndirect.com.vn/v4/stock_prices"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
FLOORS = {"HOSE": "HOSE", "HNX": "HNX", "UPCOM": "UPCoM"}
PRICE_SCALE = 1000.0
PAGE_SIZE = 500


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("expected YYYY-MM-DD") from exc


def load_assets(path: Path) -> list[dict[str, str]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    required = {
        "symbol",
        "providerSymbol",
        "providerFloor",
        "venue",
        "currency",
        "assetClass",
    }
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
        if not SAFE_SYMBOL.fullmatch(normalized["providerSymbol"]):
            raise ValueError(f"assets[{index}].providerSymbol is invalid")
        floor = normalized["providerFloor"].upper()
        if floor not in FLOORS:
            raise ValueError(f"assets[{index}].providerFloor is unsupported")
        if normalized["venue"] != FLOORS[floor]:
            raise ValueError(f"assets[{index}] provider floor/venue mismatch")
        if normalized["currency"] != "VND":
            raise ValueError(f"assets[{index}].currency must be VND")
        if normalized["assetClass"] != "equity":
            raise ValueError(f"assets[{index}].assetClass must be equity")
        normalized["providerFloor"] = floor
        assets.append(normalized)
    for key in ("symbol", "providerSymbol"):
        values = [item[key] for item in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def request_uri(symbol: str, start: date, end_inclusive: date, page: int) -> str:
    query = urllib.parse.urlencode(
        {
            "sort": "date",
            "q": (
                f"code:{symbol}~date:gte:{start.isoformat()}"
                f"~date:lte:{end_inclusive.isoformat()}"
            ),
            "size": str(PAGE_SIZE),
            "page": str(page),
        }
    )
    return f"{BASE_URL}?{query}"


def fetch_bytes(uri: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        uri,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Referer": "https://dstock.vndirect.com.vn/",
            "User-Agent": "Mozilla/5.0 AutoQuantMarketDataSkill/1.0",
        },
    )
    errors: list[str] = []
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
                metadata = {
                    "status": str(response.status),
                    "contentType": response.headers.get("Content-Type", ""),
                    "contentLength": str(len(payload)),
                }
            if not payload:
                raise ValueError("provider returned an empty body")
            return payload, metadata
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            if attempt == 4:
                raise RuntimeError(
                    "VNDIRECT route failed after 5 attempts: "
                    + " | ".join(errors)
                ) from exc
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def fetch_symbol(
    asset: dict[str, str],
    start: date,
    end_inclusive: date,
    raw_dir: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    audits: list[dict[str, Any]] = []
    page = 1
    expected_pages: int | None = None
    while expected_pages is None or page <= expected_pages:
        uri = request_uri(asset["providerSymbol"], start, end_inclusive, page)
        raw_bytes, response = fetch_bytes(uri)
        raw_path = raw_dir / f"page-{page:04d}.json"
        raw_path.write_bytes(raw_bytes)
        try:
            payload = json.loads(raw_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"{asset['providerSymbol']}: page {page} is not JSON"
            ) from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise ValueError(f"{asset['providerSymbol']}: malformed page {page}")
        declared_page = int(payload.get("currentPage", page))
        if declared_page != page:
            raise ValueError(f"{asset['providerSymbol']}: page identity mismatch")
        pages = int(payload.get("totalPages", 0))
        if pages < 1:
            raise ValueError(f"{asset['providerSymbol']}: no provider pages")
        if expected_pages is None:
            expected_pages = pages
        elif pages != expected_pages:
            raise ValueError(f"{asset['providerSymbol']}: pagination changed")
        records.extend(payload["data"])
        audits.append(
            {
                "page": page,
                "requestUri": uri,
                "response": response,
                "declaredRows": len(payload["data"]),
                "totalElements": int(payload.get("totalElements", 0)),
                "rawPath": raw_path.name,
                "rawSha256": sha256(raw_path),
            }
        )
        page += 1
        time.sleep(0.1)
    if not records:
        raise ValueError(f"{asset['providerSymbol']}: no provider records")
    if audits[-1]["totalElements"] != len(records):
        raise ValueError(f"{asset['providerSymbol']}: pagination row mismatch")
    return records, audits


def frame_for(
    asset: dict[str, str],
    records: list[dict[str, Any]],
    adjustment: str,
    start: date,
    end_exclusive: date,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    fields = (
        ("open", "high", "low", "close")
        if adjustment == "raw"
        else ("adOpen", "adHigh", "adLow", "adClose")
    )
    parsed: list[dict[str, Any]] = []
    value_checks = 0
    for index, row in enumerate(records):
        if not isinstance(row, dict):
            raise ValueError(f"{asset['providerSymbol']}: malformed row {index}")
        if str(row.get("code")) != asset["providerSymbol"]:
            raise ValueError(f"{asset['providerSymbol']}: code mismatch")
        if str(row.get("floor", "")).upper() != asset["providerFloor"]:
            raise ValueError(f"{asset['providerSymbol']}: floor mismatch")
        volume = float(row["nmVolume"])
        value = float(row["nmValue"])
        average = float(row["average"]) * PRICE_SCALE
        if volume > 0:
            observed_average = value / volume
            tolerance = max(1.0, abs(average) * 0.001)
            if abs(observed_average - average) > tolerance:
                raise ValueError(
                    f"{asset['providerSymbol']}: VND price-scale check failed"
                )
            value_checks += 1
        elif value != 0:
            raise ValueError(f"{asset['providerSymbol']}: value with zero volume")
        parsed.append(
            {
                "date": date.fromisoformat(str(row["date"])),
                "open": float(row[fields[0]]) * PRICE_SCALE,
                "high": float(row[fields[1]]) * PRICE_SCALE,
                "low": float(row[fields[2]]) * PRICE_SCALE,
                "close": float(row[fields[3]]) * PRICE_SCALE,
                "volume": volume,
            }
        )
    frame = pd.DataFrame(parsed)
    frame = frame.loc[
        (frame["date"] >= start) & (frame["date"] < end_exclusive)
    ].sort_values("date")
    if frame.empty or frame["date"].duplicated().any():
        raise ValueError(f"{asset['providerSymbol']}: empty or duplicate dates")
    if not (frame[["open", "high", "low", "close"]] > 0).all(axis=None):
        raise ValueError(f"{asset['providerSymbol']}: nonpositive price")
    if frame["volume"].lt(0).any():
        raise ValueError(f"{asset['providerSymbol']}: negative volume")
    invalid_bounds = (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    )
    invalid_bound_examples = [
        {
            "date": str(row["date"]),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
        }
        for _, row in frame.loc[invalid_bounds].head(5).iterrows()
    ]
    invalid_bound_rows = int(invalid_bounds.sum())
    frame = frame.loc[~invalid_bounds].copy()
    if frame.empty:
        raise ValueError(
            f"{asset['providerSymbol']}: no valid OHLC rows after bounds audit"
        )
    first_date = frame["date"].iloc[0]
    last_date = frame["date"].iloc[-1]
    if first_date > start + timedelta(days=15):
        raise ValueError(f"{asset['providerSymbol']}: start appears truncated")
    if last_date < end_exclusive - timedelta(days=16):
        raise ValueError(f"{asset['providerSymbol']}: end appears stale")
    frame = frame.reset_index(drop=True)
    frame["date"] = frame["date"].astype(str)
    return frame, {
        "providerRows": len(records),
        "outputRowsBeforeAlignment": len(frame),
        "firstDate": str(first_date),
        "lastDate": str(last_date),
        "zeroVolumeRows": int(frame["volume"].eq(0).sum()),
        "providerPriceUnit": "thousand-VND-per-share",
        "outputPriceUnit": "VND-per-share",
        "priceMultiplier": int(PRICE_SCALE),
        "providerVolumeUnit": "share",
        "outputVolumeUnit": "share",
        "normalValueChecks": value_checks,
        "invalidBoundsRowsDropped": invalid_bound_rows,
        "invalidBoundsExamples": invalid_bound_examples,
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
    parser.add_argument("--start", type=parse_date, required=True)
    parser.add_argument("--end-exclusive", type=parse_date, required=True)
    parser.add_argument(
        "--adjustment",
        choices=("raw", "provider-adjusted"),
        required=True,
    )
    parser.add_argument(
        "--panel",
        choices=("aligned", "observed-only"),
        default="observed-only",
    )
    parser.add_argument("--terms", required=True)
    args = parser.parse_args()
    if args.end_exclusive <= args.start:
        parser.error("--end-exclusive must be after --start")
    if not SAFE_SYMBOL.fullmatch(args.dataset_id):
        parser.error("--dataset-id must be a path-safe AutoQuant identifier")

    assets = load_assets(args.assets.expanduser().absolute())
    output = args.output.expanduser().absolute()
    ensure_output(output)
    raw_root = output / "raw"
    raw_root.mkdir()
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    end_inclusive = args.end_exclusive - timedelta(days=1)
    frames: dict[str, pd.DataFrame] = {}
    audits: dict[str, Any] = {}
    for asset in assets:
        asset_raw = raw_root / asset["symbol"]
        asset_raw.mkdir()
        records, pages = fetch_symbol(asset, args.start, end_inclusive, asset_raw)
        frame, summary = frame_for(
            asset,
            records,
            args.adjustment,
            args.start,
            args.end_exclusive,
        )
        frames[asset["symbol"]] = frame
        audits[asset["symbol"]] = {
            **summary,
            "providerSymbol": asset["providerSymbol"],
            "providerFloor": asset["providerFloor"],
            "declaredVenue": asset["venue"],
            "declaredCurrency": "VND",
            "declaredAssetClass": "equity",
            "pages": pages,
        }

    if args.panel == "aligned":
        common = sorted(
            set.intersection(*(set(frame["date"]) for frame in frames.values()))
        )
        if not common:
            raise ValueError("assets have no common observed dates")
        for symbol in frames:
            frames[symbol] = (
                frames[symbol].set_index("date").loc[common].reset_index()
            )
    for asset in assets:
        symbol = asset["symbol"]
        csv_path = output / f"{symbol}.csv"
        frames[symbol].to_csv(csv_path, index=False)
        audits[symbol]["outputRows"] = len(frames[symbol])
        audits[symbol]["csvPath"] = csv_path.name
        audits[symbol]["csvSha256"] = sha256(csv_path)

    all_dates = sorted(set.union(*(set(frame["date"]) for frame in frames.values())))
    schema_version = 1 if args.panel == "aligned" else 4
    package: dict[str, Any] = {
        "schemaVersion": schema_version,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": args.dataset_id,
        "version": f"{all_dates[0]}_{all_dates[-1]}",
        "assetClass": "equity",
        "frequency": "1d",
        "market": {
            "clock": "session",
            "calendar": "Vietnam-listed-venues",
            "timezone": "Asia/Ho_Chi_Minh",
        },
        "priceAdjustment": args.adjustment,
        "provider": {
            "name": "vndirect-observed-stock-prices",
            "retrievedAt": retrieved_at,
            "sourceUri": BASE_URL,
            "terms": args.terms,
        },
        "assets": [
            {
                "symbol": asset["symbol"],
                "assetClass": "equity",
                "venue": asset["venue"],
                "currency": "VND",
                "path": f"{asset['symbol']}.csv",
            }
            for asset in assets
        ],
    }
    if schema_version == 4:
        package["panelPolicy"] = {
            "alignment": "observed-only",
            "missingObservation": "absent-no-fill",
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
            "start": args.start.isoformat(),
            "endExclusive": args.end_exclusive.isoformat(),
            "interval": "1d",
            "panel": args.panel,
            "adjustment": args.adjustment,
        },
        "transformation": (
            "selected provider OHLC multiplied by 1000 from thousand VND "
            "into VND; nmVolume preserved as shares"
        ),
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "VNDIRECT is not HOSE, HNX, or UPCoM authority.",
            "Provider adjustment and access terms remain external claims.",
            "No survivorship, delisting, or symbol-reuse claim follows.",
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
                "panel": args.panel,
                "firstDate": all_dates[0],
                "lastDate": all_dates[-1],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
