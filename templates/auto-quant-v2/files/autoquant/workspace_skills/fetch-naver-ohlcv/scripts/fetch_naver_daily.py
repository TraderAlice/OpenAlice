"""Fetch auditable provider-adjusted South Korea daily OHLCV from Naver."""

from __future__ import annotations

import argparse
import ast
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


BASE_URL = "https://api.finance.naver.com/siseJson.naver"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
PROVIDER_SYMBOL = re.compile(r"^[0-9]{6}$")
EXPECTED_HEADERS = ["날짜", "시가", "고가", "저가", "종가", "거래량"]
PRICE_ADJUSTMENT = "provider-adjusted"


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
    required = {"symbol", "providerSymbol", "venue", "currency", "assetClass"}
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
        if not PROVIDER_SYMBOL.fullmatch(normalized["providerSymbol"]):
            raise ValueError(f"assets[{index}].providerSymbol is invalid")
        if normalized["venue"] != "XKRX":
            raise ValueError(f"assets[{index}].venue must be XKRX")
        if normalized["currency"] != "KRW":
            raise ValueError(f"assets[{index}].currency must be KRW")
        if normalized["assetClass"] != "equity":
            raise ValueError(f"assets[{index}].assetClass must be equity")
        assets.append(normalized)
    for key in ("symbol", "providerSymbol"):
        values = [item[key] for item in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def request_uri(symbol: str, start: date, end_inclusive: date) -> str:
    query = urllib.parse.urlencode(
        {
            "symbol": symbol,
            "requestType": "1",
            "startTime": start.strftime("%Y%m%d"),
            "endTime": end_inclusive.strftime("%Y%m%d"),
            "timeframe": "day",
        }
    )
    return f"{BASE_URL}?{query}"


def fetch_bytes(uri: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        uri,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Referer": "https://finance.naver.com/",
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
                    "Naver route failed after 5 attempts: "
                    + " | ".join(errors)
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
        table = ast.literal_eval(raw_bytes.decode("utf-8").strip())
    except (UnicodeDecodeError, SyntaxError, ValueError) as exc:
        raise ValueError(f"{provider_symbol}: response is not a literal table") from exc
    if not isinstance(table, list) or len(table) < 2:
        raise ValueError(f"{provider_symbol}: response table is empty")
    headers = table[0]
    if not isinstance(headers, list) or headers[:6] != EXPECTED_HEADERS:
        raise ValueError(
            f"{provider_symbol}: unexpected headers {headers!r}"
        )
    rows: list[list[Any]] = []
    for index, row in enumerate(table[1:]):
        if not isinstance(row, list) or len(row) < 6:
            raise ValueError(f"{provider_symbol}: malformed row {index}")
        rows.append(row[:6])
    frame = pd.DataFrame(
        rows,
        columns=["date", "open", "high", "low", "close", "volume"],
    )
    frame["date"] = pd.to_datetime(
        frame["date"].astype(str),
        format="%Y%m%d",
        errors="raise",
    ).dt.date
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    frame = frame.loc[
        (frame["date"] >= start) & (frame["date"] < end_exclusive)
    ].sort_values("date")
    if frame.empty:
        raise ValueError(f"{provider_symbol}: no rows in requested range")
    if frame["date"].duplicated().any():
        raise ValueError(f"{provider_symbol}: duplicate session dates")
    placeholder_mask = (
        frame[["open", "high", "low"]].eq(0).all(axis=1)
        & frame["close"].gt(0)
        & frame["volume"].eq(0)
    )
    placeholder_observations = [
        {
            "providerSymbol": provider_symbol,
            "date": row.date.isoformat(),
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
        }
        for row in frame.loc[placeholder_mask].itertuples(index=False)
    ]
    frame = frame.loc[~placeholder_mask].copy()
    if frame.empty:
        raise ValueError(f"{provider_symbol}: no traded observations in requested range")
    if not (frame[["open", "high", "low", "close"]] > 0).all(axis=None):
        raise ValueError(f"{provider_symbol}: nonpositive price")
    if frame["volume"].lt(0).any():
        raise ValueError(f"{provider_symbol}: negative volume")
    expected_high = frame[["open", "low", "close"]].max(axis=1)
    expected_low = frame[["open", "high", "close"]].min(axis=1)
    high_gap = (expected_high - frame["high"]).clip(lower=0)
    low_gap = (frame["low"] - expected_low).clip(lower=0)
    rounded_bound_mask = (
        (high_gap.gt(0) | low_gap.gt(0))
        & high_gap.le(1)
        & low_gap.le(1)
    )
    rounded_bound_observations = [
        {
            "providerSymbol": provider_symbol,
            "date": row.date.isoformat(),
            "rawHigh": float(row.high),
            "normalizedHigh": float(max(row.high, row.open, row.low, row.close)),
            "rawLow": float(row.low),
            "normalizedLow": float(min(row.low, row.open, row.high, row.close)),
        }
        for row in frame.loc[rounded_bound_mask].itertuples(index=False)
    ]
    frame.loc[rounded_bound_mask, "high"] = expected_high.loc[rounded_bound_mask]
    frame.loc[rounded_bound_mask, "low"] = expected_low.loc[rounded_bound_mask]
    invalid_bounds = (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    )
    if invalid_bounds.any():
        raise ValueError(f"{provider_symbol}: inconsistent OHLC bounds")
    first_date = frame["date"].iloc[0]
    last_date = frame["date"].iloc[-1]
    if first_date > start + timedelta(days=12):
        raise ValueError(f"{provider_symbol}: requested start appears truncated")
    if last_date < end_exclusive - timedelta(days=13):
        raise ValueError(f"{provider_symbol}: requested end appears stale")
    frame = frame.reset_index(drop=True)
    frame["date"] = frame["date"].astype(str)
    return frame, {
        "providerRows": len(rows),
        "outputRowsBeforeAlignment": len(frame),
        "firstDate": str(first_date),
        "lastDate": str(last_date),
        "zeroVolumeRows": int(frame["volume"].eq(0).sum()),
        "providerVolumeUnit": "share",
        "outputVolumeUnit": "share",
        "nonTradingPlaceholderRows": len(placeholder_observations),
        "nonTradingPlaceholderObservations": placeholder_observations,
        "roundedBoundRows": len(rounded_bound_observations),
        "roundedBoundObservations": rounded_bound_observations,
        "headers": headers,
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
        uri = request_uri(asset["providerSymbol"], args.start, end_inclusive)
        raw_bytes, response = fetch_bytes(uri)
        raw_path = raw_dir / f"{asset['symbol']}.txt"
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
            "declaredVenue": "XKRX",
            "declaredCurrency": "KRW",
            "declaredAssetClass": "equity",
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
            "name": "naver-finance-observed-history",
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
    placeholder_observations = [
        {"symbol": symbol, **observation}
        for symbol, summary in audits.items()
        for observation in summary["nonTradingPlaceholderObservations"]
    ]
    rounded_bound_observations = [
        {"symbol": symbol, **observation}
        for symbol, summary in audits.items()
        for observation in summary["roundedBoundObservations"]
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
            "provider-adjusted KRW OHLC and provider share volume preserved; "
            "exact no-trade placeholder rows omitted from normalized observed history"
        ),
        "nonTradingPlaceholders": {
            "policy": "omit-exact-no-trade-placeholder",
            "affectedAssets": sorted(
                {
                    observation["symbol"]
                    for observation in placeholder_observations
                }
            ),
            "observationsFound": len(placeholder_observations),
            "observationsOmitted": len(placeholder_observations),
            "observations": placeholder_observations,
        },
        "roundedBounds": {
            "policy": "expand-violated-bound-by-at-most-one-krw",
            "affectedAssets": sorted(
                {
                    observation["symbol"]
                    for observation in rounded_bound_observations
                }
            ),
            "observationsNormalized": len(rounded_bound_observations),
            "observations": rounded_bound_observations,
        },
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "Naver Finance is not KRX venue or calendar authority.",
            "Board identity and access terms remain external claims.",
            "Observed Samsung history is back-adjusted across its 2018 split, "
            "but Naver does not establish a complete adjustment methodology.",
            "Exact zero-OHLC, positive-close, zero-volume provider placeholders "
            "are not traded observations and remain available only in raw evidence.",
            "A violated OHLC bound is expanded only when the exact provider "
            "difference is at most one KRW; every normalized value is audited.",
            "No split-only, dividend, survivorship, or delisting claim follows.",
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
                "nonTradingPlaceholders": len(placeholder_observations),
                "roundedBounds": len(rounded_bound_observations),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
