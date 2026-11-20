"""Fetch auditable split-adjusted U.S. daily OHLCV from Nasdaq.com history."""

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


BASE_URL = "https://api.nasdaq.com/api/quote/{symbol}/historical"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
MAX_ROWS = 5000
ASSET_CLASS = {"stocks": "equity", "etf": "fund"}


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
        "providerAssetClass",
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
        if not all(
            isinstance(value, str) and value
            for value in normalized.values()
        ):
            raise ValueError(f"assets[{index}] values must be non-empty strings")
        if not SAFE_SYMBOL.fullmatch(normalized["symbol"]):
            raise ValueError(f"assets[{index}].symbol is not path-safe")
        if not SAFE_SYMBOL.fullmatch(normalized["providerSymbol"]):
            raise ValueError(f"assets[{index}].providerSymbol is invalid")
        provider_class = normalized["providerAssetClass"]
        if provider_class not in ASSET_CLASS:
            raise ValueError(
                f"assets[{index}].providerAssetClass is unsupported"
            )
        if normalized["assetClass"] != ASSET_CLASS[provider_class]:
            raise ValueError(
                f"assets[{index}] provider/AutoQuant class mismatch"
            )
        if normalized["currency"] != "USD":
            raise ValueError(f"assets[{index}].currency must be USD")
        assets.append(normalized)
    for key in ("symbol", "providerSymbol"):
        values = [item[key] for item in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def request_uri(
    provider_symbol: str,
    provider_asset_class: str,
    start: date,
    end_inclusive: date,
) -> str:
    query = urllib.parse.urlencode(
        {
            "assetclass": provider_asset_class,
            "fromdate": start.isoformat(),
            "todate": end_inclusive.isoformat(),
            "limit": str(MAX_ROWS),
        }
    )
    symbol = urllib.parse.quote(provider_symbol, safe="")
    return f"{BASE_URL.format(symbol=symbol)}?{query}"


def fetch_bytes(uri: str, provider_symbol: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        uri,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Origin": "https://www.nasdaq.com",
            "Referer": (
                "https://www.nasdaq.com/market-activity/stocks/"
                f"{provider_symbol.lower()}/historical"
            ),
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 Chrome/126 Safari/537.36 "
                "AutoQuantMarketDataSkill/1.0"
            ),
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
                    "Nasdaq.com route failed after 5 attempts: "
                    + " | ".join(errors)
                ) from exc
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def number(value: Any) -> float:
    rendered = re.sub(r"[^0-9.+-]", "", str(value).strip())
    if rendered in {"", "+", "-", "."}:
        raise ValueError(f"missing display numeric value: {value!r}")
    return float(rendered)


def parse_payload(
    provider_symbol: str,
    raw_bytes: bytes,
    start: date,
    end_exclusive: date,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    try:
        payload = json.loads(raw_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{provider_symbol}: response is not JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{provider_symbol}: response must be an object")
    status = payload.get("status")
    if not isinstance(status, dict) or status.get("rCode") != 200:
        raise ValueError(f"{provider_symbol}: provider status is {status!r}")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError(f"{provider_symbol}: response lacks data")
    table = data.get("tradesTable")
    rows = table.get("rows") if isinstance(table, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{provider_symbol}: response has no historical rows")
    total = int(data.get("totalRecords", len(rows)))
    if total > len(rows):
        raise ValueError(
            f"{provider_symbol}: response truncated {len(rows)}/{total} rows"
        )
    parsed: list[dict[str, Any]] = []
    unusable_rows = 0
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError(f"{provider_symbol}: malformed row {index}")
        try:
            parsed.append(
                {
                    "date": datetime.strptime(
                        str(row.get("date")),
                        "%m/%d/%Y",
                    ).date(),
                    "open": number(row.get("open")),
                    "high": number(row.get("high")),
                    "low": number(row.get("low")),
                    "close": number(row.get("close")),
                    "volume": number(row.get("volume")),
                }
            )
        except ValueError:
            unusable_rows += 1
    frame = pd.DataFrame(parsed)
    frame = frame.loc[
        (frame["date"] >= start) & (frame["date"] < end_exclusive)
    ].sort_values("date")
    if frame.empty:
        raise ValueError(f"{provider_symbol}: no rows in requested range")
    if frame["date"].duplicated().any():
        raise ValueError(f"{provider_symbol}: duplicate session dates")
    if not (frame[["open", "high", "low", "close"]] > 0).all(axis=None):
        raise ValueError(f"{provider_symbol}: nonpositive prices")
    if frame["volume"].lt(0).any():
        raise ValueError(f"{provider_symbol}: negative volume")
    invalid_bounds = (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    )
    if invalid_bounds.any():
        raise ValueError(f"{provider_symbol}: inconsistent OHLC bounds")
    first_date = frame["date"].iloc[0]
    last_date = frame["date"].iloc[-1]
    if first_date > start + timedelta(days=10):
        raise ValueError(f"{provider_symbol}: requested start appears truncated")
    if last_date < end_exclusive - timedelta(days=11):
        raise ValueError(f"{provider_symbol}: requested end appears stale")
    frame = frame.reset_index(drop=True)
    frame["date"] = frame["date"].astype(str)
    return frame, {
        "providerSymbol": data.get("symbol"),
        "declaredTotalRecords": total,
        "providerRows": len(rows),
        "unusableRowsDropped": unusable_rows,
        "outputRowsBeforeAlignment": len(frame),
        "firstDate": str(first_date),
        "lastDate": str(last_date),
        "zeroVolumeRows": int(frame["volume"].eq(0).sum()),
        "providerVolumeUnit": "share",
        "outputVolumeUnit": "share",
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
    raw_dir = output / "raw"
    raw_dir.mkdir()
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    end_inclusive = args.end_exclusive - timedelta(days=1)
    frames: dict[str, pd.DataFrame] = {}
    audits: dict[str, Any] = {}

    for asset in assets:
        uri = request_uri(
            asset["providerSymbol"],
            asset["providerAssetClass"],
            args.start,
            end_inclusive,
        )
        raw_bytes, response_metadata = fetch_bytes(
            uri,
            asset["providerSymbol"],
        )
        raw_path = raw_dir / f"{asset['symbol']}.json"
        raw_path.write_bytes(raw_bytes)
        frame, summary = parse_payload(
            asset["providerSymbol"],
            raw_bytes,
            args.start,
            args.end_exclusive,
        )
        frames[asset["symbol"]] = frame
        audits[asset["symbol"]] = {
            **summary,
            "requestedProviderSymbol": asset["providerSymbol"],
            "providerAssetClass": asset["providerAssetClass"],
            "declaredVenue": asset["venue"],
            "declaredCurrency": asset["currency"],
            "declaredAssetClass": asset["assetClass"],
            "requestUri": uri,
            "response": response_metadata,
            "rawPath": raw_path.relative_to(output).as_posix(),
            "rawSha256": sha256(raw_path),
        }

    if args.panel == "aligned":
        common = sorted(
            set.intersection(
                *(set(frame["date"]) for frame in frames.values())
            )
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

    all_dates = sorted(
        set.union(*(set(frame["date"]) for frame in frames.values()))
    )
    classes = {asset["assetClass"] for asset in assets}
    schema_version = 1 if args.panel == "aligned" else 4
    package: dict[str, Any] = {
        "schemaVersion": schema_version,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": args.dataset_id,
        "version": f"{all_dates[0]}_{all_dates[-1]}",
        "assetClass": next(iter(classes)) if len(classes) == 1 else "mixed",
        "frequency": "1d",
        "market": {
            "clock": "session",
            "calendar": "US-listed-venues",
            "timezone": "America/New_York",
        },
        "priceAdjustment": "split-adjusted",
        "provider": {
            "name": "nasdaq-com-historical-quotes",
            "retrievedAt": retrieved_at,
            "sourceUri": "https://api.nasdaq.com/api/quote/",
            "terms": args.terms,
        },
        "assets": [
            {
                "symbol": asset["symbol"],
                "assetClass": asset["assetClass"],
                "venue": asset["venue"],
                "currency": "USD",
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
            "providerEndInclusive": end_inclusive.isoformat(),
            "interval": "1d",
            "panel": args.panel,
            "adjustment": "split-adjusted",
        },
        "transformation": (
            "display-formatted split-adjusted OHLC and share volume parsed "
            "without an additional dividend adjustment"
        ),
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "Nasdaq.com display history is not primary-venue authority.",
            "This is not the credentialed Nasdaq Data Link Bars product.",
            "No adjustment, survivorship, or delisting claim follows.",
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
