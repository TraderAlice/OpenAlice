"""Fetch auditable raw mainland-China daily OHLCV from Sohu Finance."""

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


BASE_URL = "https://q.stock.sohu.com/hisHq"
CALLBACK = "historySearchHandler"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
PROVIDER_SYMBOL = re.compile(r"^cn_[0-9]{6}$")
SUPPORTED_VENUES = {"XSHG", "XSHE", "XBSE"}


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
        if normalized["providerSymbol"][3:] != normalized["symbol"]:
            raise ValueError(f"assets[{index}] provider symbol/code mismatch")
        if normalized["venue"] not in SUPPORTED_VENUES:
            raise ValueError(f"assets[{index}].venue is unsupported")
        if normalized["currency"] != "CNY":
            raise ValueError(f"assets[{index}].currency must be CNY")
        if normalized["assetClass"] not in {"equity", "fund"}:
            raise ValueError(
                f"assets[{index}].assetClass must be equity or fund"
            )
        assets.append(normalized)
    for key in ("symbol", "providerSymbol"):
        values = [asset[key] for asset in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def request_uri(symbol: str, start: date, end_exclusive: date) -> str:
    query = urllib.parse.urlencode(
        {
            "code": symbol,
            "start": start.strftime("%Y%m%d"),
            "end": (end_exclusive - timedelta(days=1)).strftime("%Y%m%d"),
            "stat": "1",
            "order": "D",
            "period": "d",
            "callback": CALLBACK,
            "rt": "jsonp",
        }
    )
    return f"{BASE_URL}?{query}"


def fetch_bytes(uri: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        uri,
        headers={
            "Accept": "application/javascript,text/javascript,*/*",
            "Referer": "https://q.stock.sohu.com/",
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
                    "Sohu route failed after 5 attempts: " + " | ".join(errors)
                ) from exc
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def parse_payload(
    provider_symbol: str,
    raw_bytes: bytes,
    start: date,
    end_exclusive: date,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    try:
        text = raw_bytes.decode("gb18030").strip()
    except UnicodeDecodeError as exc:
        raise ValueError(f"{provider_symbol}: response is not GB18030") from exc
    prefix = f"{CALLBACK}("
    if not text.startswith(prefix) or not text.endswith(")"):
        raise ValueError(f"{provider_symbol}: response is not expected JSONP")
    try:
        payload = json.loads(text[len(prefix) : -1])
    except json.JSONDecodeError as exc:
        raise ValueError(f"{provider_symbol}: JSONP body is invalid") from exc
    if not isinstance(payload, list) or len(payload) != 1:
        raise ValueError(f"{provider_symbol}: unexpected response envelope")
    result = payload[0]
    if (
        not isinstance(result, dict)
        or int(result.get("status", -1)) != 0
        or result.get("code") != provider_symbol
        or not isinstance(result.get("hq"), list)
        or not result["hq"]
    ):
        raise ValueError(f"{provider_symbol}: provider response is not usable")

    parsed: list[dict[str, Any]] = []
    value_checks = 0
    for index, row in enumerate(result["hq"]):
        if not isinstance(row, list) or len(row) < 9:
            raise ValueError(f"{provider_symbol}: malformed row {index}")
        try:
            volume_lots = float(str(row[7]).replace(",", ""))
            traded_value_ten_thousand = float(str(row[8]).replace(",", ""))
            observation = {
                "date": date.fromisoformat(str(row[0])),
                "open": float(row[1]),
                "high": float(row[6]),
                "low": float(row[5]),
                "close": float(row[2]),
                "volume": volume_lots * 100.0,
            }
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{provider_symbol}: unusable row {index}") from exc
        if observation["volume"] > 0:
            vwap = traded_value_ten_thousand * 10_000 / observation["volume"]
            tolerance = max(0.011, observation["high"] * 0.002)
            if not observation["low"] - tolerance <= vwap <= observation["high"] + tolerance:
                raise ValueError(f"{provider_symbol}: traded-value check failed")
            value_checks += 1
        elif traded_value_ten_thousand != 0:
            raise ValueError(f"{provider_symbol}: traded value with zero volume")
        parsed.append(observation)

    source = pd.DataFrame(parsed)
    source_first = source["date"].min()
    source_last = source["date"].max()
    frame = source.loc[
        (source["date"] >= start) & (source["date"] < end_exclusive)
    ].sort_values("date")
    if frame.empty or frame["date"].duplicated().any():
        raise ValueError(f"{provider_symbol}: empty or duplicate requested dates")
    if source_first > start + timedelta(days=15):
        raise ValueError(f"{provider_symbol}: requested start appears truncated")
    if source_last < end_exclusive - timedelta(days=16):
        raise ValueError(f"{provider_symbol}: provider output appears stale")
    if not (frame[["open", "high", "low", "close"]] > 0).all(axis=None):
        raise ValueError(f"{provider_symbol}: nonpositive price")
    if frame["volume"].lt(0).any():
        raise ValueError(f"{provider_symbol}: negative volume")
    if (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    ).any():
        raise ValueError(f"{provider_symbol}: invalid OHLC bounds")
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
        "providerVolumeUnit": "100-share-lot",
        "outputVolumeUnit": "share",
        "volumeMultiplier": 100,
        "valueVolumeRowsChecked": value_checks,
        "providerStatistics": result.get("stat"),
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
        uri = request_uri(
            asset["providerSymbol"], args.start, args.end_exclusive
        )
        raw_bytes, response = fetch_bytes(uri)
        raw_path = raw_root / f"{asset['symbol']}.jsonp"
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
            "providerSymbol": asset["providerSymbol"],
            "declaredVenue": asset["venue"],
            "declaredCurrency": "CNY",
            "declaredAssetClass": asset["assetClass"],
            "requestUri": uri,
            "response": response,
            "rawPath": raw_path.relative_to(output).as_posix(),
            "rawSha256": sha256(raw_path),
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
    asset_classes = {asset["assetClass"] for asset in assets}
    package_asset_class = (
        next(iter(asset_classes)) if len(asset_classes) == 1 else "mixed"
    )
    package: dict[str, Any] = {
        "schemaVersion": schema_version,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": args.dataset_id,
        "version": f"{all_dates[0]}_{all_dates[-1]}",
        "assetClass": package_asset_class,
        "frequency": "1d",
        "market": {
            "clock": "session",
            "calendar": "China-listed-venues",
            "timezone": "Asia/Shanghai",
        },
        "priceAdjustment": "raw",
        "provider": {
            "name": "sohu-finance-observed-history",
            "retrievedAt": retrieved_at,
            "sourceUri": BASE_URL,
            "terms": args.terms,
        },
        "assets": [
            {
                "symbol": asset["symbol"],
                "assetClass": asset["assetClass"],
                "venue": asset["venue"],
                "currency": "CNY",
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
            "adjustment": "raw",
        },
        "transformation": (
            "provider raw OHLC parsed as CNY per share; 100-share lots "
            "multiplied by 100 and checked against ten-thousand-CNY value"
        ),
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "Sohu is an observable provider, not exchange authority.",
            "Venue identity, volume scope, access, and terms remain external claims.",
            "Provider response shape is undocumented and may change.",
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
