"""Fetch auditable raw South Korean daily OHLCV from Daum Finance."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd


BASE_URL = "https://finance.daum.net/api/quote"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
PROVIDER_SYMBOL = re.compile(r"^A[0-9]{6}$")
PAGE_SIZE = 1000
PRICE_ADJUSTMENT = "raw"


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
        if not PROVIDER_SYMBOL.fullmatch(normalized["providerSymbol"]):
            raise ValueError(f"assets[{index}].providerSymbol is invalid")
        if (
            normalized["venue"] != "XKRX"
            or normalized["currency"] != "KRW"
            or normalized["assetClass"] != "equity"
        ):
            raise ValueError(f"assets[{index}] must be XKRX/KRW/equity")
        assets.append(normalized)
    for key in ("symbol", "providerSymbol"):
        values = [asset[key] for asset in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def request_uri(symbol: str, page: int) -> str:
    query = urllib.parse.urlencode(
        {"symbolCode": symbol, "page": page, "perPage": PAGE_SIZE}
    )
    return f"{BASE_URL}/{symbol}/days?{query}"


def fetch_bytes(uri: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        uri,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Referer": "https://finance.daum.net/",
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
                    "finalUri": response.geturl(),
                }
            if not payload:
                raise ValueError("provider returned an empty body")
            return payload, metadata
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            if attempt == 4:
                raise RuntimeError(
                    "Daum route failed after 5 attempts: " + " | ".join(errors)
                ) from exc
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def parse_page(
    symbol: str,
    raw_bytes: bytes,
    page: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        payload = json.loads(raw_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{symbol}: page {page} is not JSON") from exc
    if (
        not isinstance(payload, dict)
        or int(payload.get("code", -1)) != 200
        or not isinstance(payload.get("data"), list)
    ):
        raise ValueError(f"{symbol}: malformed provider page {page}")
    current_page = int(payload.get("currentPage", -1))
    page_size = int(payload.get("pageSize", -1))
    total_count = int(payload.get("totalCount", -1))
    total_pages = int(payload.get("totalPages", -1))
    if current_page != page or page_size != PAGE_SIZE:
        raise ValueError(f"{symbol}: provider page identity mismatch")
    if total_pages != math.ceil(total_count / page_size):
        raise ValueError(f"{symbol}: provider pagination mismatch")
    return payload["data"], {
        "currentPage": current_page,
        "pageSize": page_size,
        "totalCount": total_count,
        "totalPages": total_pages,
        "rows": len(payload["data"]),
        "message": payload.get("message"),
    }


def frame_for(
    symbol: str,
    records: list[dict[str, Any]],
    start: date,
    end_exclusive: date,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    value_volume_diagnostics: list[dict[str, Any]] = []
    for index, row in enumerate(records):
        if not isinstance(row, dict) or row.get("symbolCode") != symbol:
            raise ValueError(f"{symbol}: malformed or mismatched row {index}")
        try:
            volume = float(row["accTradeVolume"])
            value = float(row["accTradePrice"])
            observation = {
                "date": datetime.strptime(
                    str(row["date"]), "%Y-%m-%d %H:%M:%S"
                ).date(),
                "open": float(row["openingPrice"]),
                "high": float(row["highPrice"]),
                "low": float(row["lowPrice"]),
                "close": float(row["tradePrice"]),
                "volume": volume,
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"{symbol}: unusable row {index}") from exc
        if not math.isfinite(volume) or not math.isfinite(value) or value < 0:
            raise ValueError(f"{symbol}: invalid accumulated trade fields")
        if volume > 0:
            derived_value_per_share = value / volume
            if derived_value_per_share < observation["low"]:
                relation = "below-low"
                relative_distance = (
                    observation["low"] - derived_value_per_share
                ) / observation["low"]
            elif derived_value_per_share > observation["high"]:
                relation = "above-high"
                relative_distance = (
                    derived_value_per_share - observation["high"]
                ) / observation["high"]
            else:
                relation = "within-ohlc"
                relative_distance = 0.0
            value_volume_diagnostics.append(
                {
                    "date": observation["date"],
                    "accTradePrice": value,
                    "accTradeVolume": volume,
                    "derivedValuePerShare": derived_value_per_share,
                    "low": observation["low"],
                    "high": observation["high"],
                    "relation": relation,
                    "relativeDistanceFromNearestBound": relative_distance,
                }
            )
        elif value != 0:
            value_volume_diagnostics.append(
                {
                    "date": observation["date"],
                    "accTradePrice": value,
                    "accTradeVolume": volume,
                    "derivedValuePerShare": None,
                    "low": observation["low"],
                    "high": observation["high"],
                    "relation": "positive-value-zero-volume",
                    "relativeDistanceFromNearestBound": None,
                }
            )
        parsed.append(observation)
    source = pd.DataFrame(parsed)
    source_first = source["date"].min()
    source_last = source["date"].max()
    frame = source.loc[
        (source["date"] >= start) & (source["date"] < end_exclusive)
    ].sort_values("date")
    if frame.empty or frame["date"].duplicated().any():
        raise ValueError(f"{symbol}: empty or duplicate requested dates")
    if source_first > start + timedelta(days=15):
        raise ValueError(f"{symbol}: requested start appears truncated")
    if source_last < end_exclusive - timedelta(days=16):
        raise ValueError(f"{symbol}: provider output appears stale")
    if not (frame[["open", "high", "low", "close"]] > 0).all(axis=None):
        raise ValueError(f"{symbol}: nonpositive price")
    if frame["volume"].lt(0).any():
        raise ValueError(f"{symbol}: negative volume")
    if (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    ).any():
        raise ValueError(f"{symbol}: invalid OHLC bounds")
    scoped_value_volume = [
        {
            **diagnostic,
            "date": diagnostic["date"].isoformat(),
        }
        for diagnostic in value_volume_diagnostics
        if start <= diagnostic["date"] < end_exclusive
    ]
    value_volume_anomalies = [
        diagnostic
        for diagnostic in scoped_value_volume
        if diagnostic["relation"] != "within-ohlc"
    ]
    frame = frame.reset_index(drop=True)
    frame["date"] = frame["date"].astype(str)
    return frame, {
        "providerRows": len(source),
        "sourceFirstDate": source_first.isoformat(),
        "sourceLastDate": source_last.isoformat(),
        "outputRowsBeforeAlignment": len(frame),
        "firstDate": frame["date"].iloc[0],
        "lastDate": frame["date"].iloc[-1],
        "zeroVolumeRows": int(frame["volume"].eq(0).sum()),
        "providerVolumeUnit": "share",
        "outputVolumeUnit": "share",
        "valueVolumeRowsChecked": sum(
            diagnostic["accTradeVolume"] > 0
            for diagnostic in scoped_value_volume
        ),
        "valueVolumeAnomalyRows": len(value_volume_anomalies),
        "valueVolumeAnomalies": value_volume_anomalies,
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
    frames: dict[str, pd.DataFrame] = {}
    audits: dict[str, Any] = {}
    for asset in assets:
        records: list[dict[str, Any]] = []
        pages: list[dict[str, Any]] = []
        page = 1
        while True:
            uri = request_uri(asset["providerSymbol"], page)
            raw_bytes, response = fetch_bytes(uri)
            raw_path = raw_root / f"{asset['symbol']}-page-{page:04d}.json"
            raw_path.write_bytes(raw_bytes)
            page_records, summary = parse_page(
                asset["providerSymbol"], raw_bytes, page
            )
            records.extend(page_records)
            pages.append(
                {
                    **summary,
                    "requestUri": uri,
                    "response": response,
                    "rawPath": raw_path.relative_to(output).as_posix(),
                    "rawSha256": sha256(raw_path),
                }
            )
            oldest = min(
                datetime.strptime(str(row["date"]), "%Y-%m-%d %H:%M:%S").date()
                for row in page_records
            )
            if oldest <= args.start or page >= summary["totalPages"]:
                break
            page += 1
            time.sleep(0.2)
        frame, summary = frame_for(
            asset["providerSymbol"], records, args.start, args.end_exclusive
        )
        frames[asset["symbol"]] = frame
        audits[asset["symbol"]] = {
            **summary,
            "providerSymbol": asset["providerSymbol"],
            "declaredVenue": "XKRX",
            "declaredCurrency": "KRW",
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
            "calendar": "XKRX",
            "timezone": "Asia/Seoul",
        },
        "priceAdjustment": PRICE_ADJUSTMENT,
        "provider": {
            "name": "daum-finance-observed-daily-history",
            "retrievedAt": retrieved_at,
            "sourceUri": BASE_URL,
            "terms": args.terms,
        },
        "assets": [
            {
                "symbol": asset["symbol"],
                "assetClass": "equity",
                "venue": "XKRX",
                "currency": "KRW",
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
    value_volume_observations = [
        {"symbol": symbol, **observation}
        for symbol, summary in audits.items()
        for observation in summary["valueVolumeAnomalies"]
    ]
    audit = {
        "schemaVersion": 1,
        "kind": "autoquant-provider-acquisition-audit",
        "provider": package["provider"],
        "request": {
            "start": args.start.isoformat(),
            "endExclusive": args.end_exclusive.isoformat(),
            "interval": "1d",
            "panel": args.panel,
            "adjustment": PRICE_ADJUSTMENT,
        },
        "transformation": (
            "provider daily OHLC parsed as KRW per share; accTradeVolume "
            "preserved as shares; accTradePrice/accTradeVolume retained as a "
            "diagnostic without assuming identical provider session scope"
        ),
        "valueVolume": {
            "interpretation": "diagnostic-only-provider-aggregate-scope-unknown",
            "rowsChecked": sum(
                summary["valueVolumeRowsChecked"] for summary in audits.values()
            ),
            "anomalyRows": len(value_volume_observations),
            "affectedAssets": sorted(
                {observation["symbol"] for observation in value_volume_observations}
            ),
            "observations": value_volume_observations,
        },
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "Daum is an observable provider, not KRX authority.",
            "KOSPI/KOSDAQ identity and access terms remain external claims.",
            "accTradePrice and accTradeVolume may not share the exact session "
            "scope of daily OHLC; their derived ratio is diagnostic only.",
            "No corporate-action, survivorship, or delisting claim follows.",
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
                "valueVolumeAnomalies": len(value_volume_observations),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
