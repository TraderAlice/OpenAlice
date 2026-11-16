"""Fetch an auditable raw Eastmoney A-share daily OHLCV staging package."""

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


BASE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
FIELDS1 = "f1,f2,f3,f4,f5,f6"
FIELDS2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
UT_TOKEN = "fa5fd1943c7b386f172d6893dbfba10b"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
SECID = re.compile(r"^[01]\.[0-9]{6}$")
VENUES = {"XSHG", "XSHE", "XBSE"}
VOLUME_MULTIPLIER = 100.0


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
        "providerSecid",
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
        if not SECID.fullmatch(normalized["providerSecid"]):
            raise ValueError(f"assets[{index}].providerSecid is invalid")
        if normalized["venue"] not in VENUES:
            raise ValueError(f"assets[{index}].venue is unsupported")
        if normalized["currency"] != "CNY":
            raise ValueError(f"assets[{index}].currency must be CNY")
        if normalized["assetClass"] not in {"equity", "fund"}:
            raise ValueError(
                f"assets[{index}].assetClass must be equity or fund"
            )
        assets.append(normalized)
    for key in ("symbol", "providerSecid"):
        values = [item[key] for item in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def request_uri(secid: str, start: date, end_inclusive: date) -> str:
    query = urllib.parse.urlencode(
        {
            "secid": secid,
            "fields1": FIELDS1,
            "fields2": FIELDS2,
            "klt": "101",
            "fqt": "0",
            "beg": start.strftime("%Y%m%d"),
            "end": end_inclusive.strftime("%Y%m%d"),
            "lmt": "1000000",
            "ut": UT_TOKEN,
        }
    )
    return f"{BASE_URL}?{query}"


def fetch_bytes(uri: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        uri,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Referer": "https://quote.eastmoney.com/",
            "User-Agent": (
                "Mozilla/5.0 AutoQuantMarketDataSkill/1.0"
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
                    "Eastmoney route failed after 5 attempts: "
                    + " | ".join(errors)
                ) from exc
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def parse_payload(
    provider_secid: str,
    raw_bytes: bytes,
    start: date,
    end_exclusive: date,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    try:
        payload = json.loads(raw_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{provider_secid}: response is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{provider_secid}: response must be an object")
    if payload.get("rc") not in (0, None):
        raise ValueError(f"{provider_secid}: provider rc={payload.get('rc')!r}")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError(f"{provider_secid}: response lacks data")
    code = provider_secid.split(".", 1)[1]
    if str(data.get("code")) != code:
        raise ValueError(
            f"{provider_secid}: provider code {data.get('code')!r} mismatches"
        )
    klines = data.get("klines")
    if not isinstance(klines, list) or not klines:
        raise ValueError(f"{provider_secid}: response has no K-line rows")

    rows: list[list[str]] = []
    for index, row in enumerate(klines):
        if not isinstance(row, str):
            raise ValueError(f"{provider_secid}: row {index} is not text")
        fields = row.split(",")
        if len(fields) != 11:
            raise ValueError(
                f"{provider_secid}: row {index} has {len(fields)} fields"
            )
        rows.append(fields)
    frame = pd.DataFrame(
        rows,
        columns=[
            "date",
            "open",
            "close",
            "high",
            "low",
            "provider_volume_lots",
            "amount_cny",
            "amplitude_pct",
            "change_pct",
            "change_cny",
            "turnover_pct",
        ],
    )
    frame["date"] = pd.to_datetime(frame["date"], errors="raise").dt.date
    numeric = [
        "open",
        "close",
        "high",
        "low",
        "provider_volume_lots",
        "amount_cny",
        "amplitude_pct",
        "change_pct",
        "change_cny",
        "turnover_pct",
    ]
    for column in numeric:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    frame = frame.loc[
        (frame["date"] >= start) & (frame["date"] < end_exclusive)
    ].copy()
    if frame.empty:
        raise ValueError(f"{provider_secid}: no rows in requested range")
    if frame["date"].duplicated().any():
        raise ValueError(f"{provider_secid}: duplicate session dates")
    frame = frame.sort_values("date").reset_index(drop=True)
    if not (frame[["open", "high", "low", "close"]] > 0).all(axis=None):
        raise ValueError(f"{provider_secid}: nonpositive price")
    if (frame[["provider_volume_lots", "amount_cny"]] < 0).any(axis=None):
        raise ValueError(f"{provider_secid}: negative volume or amount")
    invalid_bounds = (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    )
    if invalid_bounds.any():
        raise ValueError(f"{provider_secid}: inconsistent OHLC bounds")

    frame["volume"] = frame["provider_volume_lots"] * VOLUME_MULTIPLIER
    nonzero = frame["volume"].gt(0)
    if frame.loc[~nonzero, "amount_cny"].ne(0).any():
        raise ValueError(f"{provider_secid}: amount exists with zero volume")
    frame["derived_vwap"] = float("nan")
    frame.loc[nonzero, "derived_vwap"] = (
        frame.loc[nonzero, "amount_cny"] / frame.loc[nonzero, "volume"]
    )
    tolerance = 0.011
    invalid_vwap = nonzero & (
        frame["derived_vwap"].lt(frame["low"] - tolerance)
        | frame["derived_vwap"].gt(frame["high"] + tolerance)
    )
    if invalid_vwap.any():
        sample = frame.loc[
            invalid_vwap,
            ["date", "low", "high", "derived_vwap"],
        ].head(3)
        raise ValueError(
            f"{provider_secid}: lot-to-share amount check failed "
            f"{sample.to_dict(orient='records')}"
        )

    output = frame.loc[
        :, ["date", "open", "high", "low", "close", "volume"]
    ].copy()
    output["date"] = output["date"].astype(str)
    return output, {
        "providerName": data.get("name"),
        "providerCode": data.get("code"),
        "providerMarket": data.get("market"),
        "providerDecimal": data.get("decimal"),
        "providerRows": len(klines),
        "outputRowsBeforeAlignment": len(output),
        "zeroVolumeRows": int(output["volume"].eq(0).sum()),
        "firstDate": output["date"].iloc[0],
        "lastDate": output["date"].iloc[-1],
        "providerVolumeUnit": "lot",
        "outputVolumeUnit": "share",
        "volumeMultiplier": int(VOLUME_MULTIPLIER),
        "amountCurrency": "CNY",
        "amountVwapRowsChecked": int(nonzero.sum()),
        "amountVwapMinimum": (
            float(frame.loc[nonzero, "derived_vwap"].min())
            if nonzero.any()
            else None
        ),
        "amountVwapMaximum": (
            float(frame.loc[nonzero, "derived_vwap"].max())
            if nonzero.any()
            else None
        ),
        "amountVwapTolerance": tolerance,
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
    frames: dict[str, pd.DataFrame] = {}
    audits: dict[str, Any] = {}
    end_inclusive = args.end_exclusive - timedelta(days=1)

    for asset in assets:
        uri = request_uri(
            asset["providerSecid"],
            args.start,
            end_inclusive,
        )
        raw_bytes, response_metadata = fetch_bytes(uri)
        raw_path = raw_dir / f"{asset['symbol']}.json"
        raw_path.write_bytes(raw_bytes)
        frame, summary = parse_payload(
            asset["providerSecid"],
            raw_bytes,
            args.start,
            args.end_exclusive,
        )
        frames[asset["symbol"]] = frame
        audits[asset["symbol"]] = {
            **summary,
            "providerSecid": asset["providerSecid"],
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
            "calendar": "CN-equity-venues",
            "timezone": "Asia/Shanghai",
        },
        "priceAdjustment": "raw",
        "provider": {
            "name": "eastmoney-observed-historical-kline",
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
            "providerEndInclusive": end_inclusive.isoformat(),
            "interval": "1d",
            "panel": args.panel,
            "adjustment": "raw",
        },
        "transformation": (
            "raw OHLC preserved; f56 lots multiplied by 100 into shares; "
            "f57 amount divided by converted shares checked inside daily range"
        ),
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "The observable Eastmoney endpoint is not a documented stable API.",
            "Venue identity, calendar, and terms remain external claims.",
            "Only raw fqt=0 daily prices are supported by this Skill revision.",
            "No survivorship, delisting, or corporate-action claim follows.",
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
