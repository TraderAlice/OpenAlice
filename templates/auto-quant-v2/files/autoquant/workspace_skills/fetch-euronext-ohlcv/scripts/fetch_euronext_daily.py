"""Fetch auditable official XPAR daily OHLCV from Euronext Live."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd


BASE_URL = (
    "https://live.euronext.com/en/ajax/AwlHistoricalPrice/"
    "getFullDownloadAjax"
)
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
PRODUCT_ID = re.compile(r"^(?P<isin>[A-Z]{2}[A-Z0-9]{10})-(?P<mic>[A-Z0-9]{4})$")
MAX_DAYS = 731


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
        "providerInstrument",
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
        match = PRODUCT_ID.fullmatch(normalized["providerInstrument"])
        if match is None:
            raise ValueError(f"assets[{index}].providerInstrument is invalid")
        if match.group("mic") != normalized["venue"]:
            raise ValueError(f"assets[{index}] provider MIC/venue mismatch")
        if normalized["venue"] != "XPAR":
            raise ValueError(f"assets[{index}].venue must be XPAR")
        if normalized["currency"] != "EUR":
            raise ValueError(f"assets[{index}].currency must be EUR")
        if normalized["assetClass"] != "equity":
            raise ValueError(f"assets[{index}].assetClass must be equity")
        assets.append(normalized)
    for key in ("symbol", "providerInstrument"):
        values = [item[key] for item in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def request_uri(
    product: str,
    start: date,
    end_inclusive: date,
    adjustment: str,
) -> str:
    query = urllib.parse.urlencode(
        {
            "format": "csv",
            "decimal_separator": ".",
            "date_form": "d/m/Y",
            "adjusted": "N" if adjustment == "raw" else "Y",
            "startdate": start.isoformat(),
            "enddate": end_inclusive.isoformat(),
        }
    )
    return f"{BASE_URL}/{product}?{query}"


def fetch_bytes(uri: str, product: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        uri,
        headers={
            "Accept": "text/csv,*/*",
            "Referer": (
                "https://live.euronext.com/en/popout-page/"
                f"getHistoricalPrice/{product}"
            ),
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
                    "contentDisposition": response.headers.get(
                        "Content-Disposition", ""
                    ),
                    "contentLength": str(len(payload)),
                    "finalUri": response.geturl(),
                }
            if not payload:
                raise ValueError("official route returned an empty body")
            if payload.lstrip().lower().startswith(b"<html"):
                raise ValueError("official route returned HTML")
            return payload, metadata
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            if attempt == 4:
                raise RuntimeError(
                    "Euronext route failed after 5 attempts: "
                    + " | ".join(errors)
                ) from exc
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def parse_payload(
    product: str,
    raw_bytes: bytes,
    start: date,
    end_exclusive: date,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{product}: response is not UTF-8") from exc
    lines = text.splitlines()
    if len(lines) < 6 or not lines[0].strip().strip('"').startswith("Historical Data"):
        raise ValueError(f"{product}: unexpected historical CSV preamble")
    declared_isin = lines[2].strip().strip('"')
    expected_isin = product.split("-", 1)[0]
    if declared_isin != expected_isin:
        raise ValueError(f"{product}: declared ISIN mismatch")
    reader = csv.DictReader(io.StringIO("\n".join(lines[3:])), delimiter=";")
    expected_fields = {
        "Date",
        "Open",
        "High",
        "Low",
        "Last",
        "Close",
        "Number of Shares",
        "Number of Trades",
        "Turnover",
        "vwap",
    }
    if set(reader.fieldnames or []) != expected_fields:
        raise ValueError(f"{product}: unexpected CSV fields {reader.fieldnames}")
    parsed: list[dict[str, Any]] = []
    last_close_mismatches = 0
    unusable: list[dict[str, str]] = []
    for index, row in enumerate(reader):
        try:
            session_date = datetime.strptime(row["Date"], "%d/%m/%Y").date()
            observation = {
                "date": session_date,
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": float(row["Number of Shares"]),
            }
            last_value = float(row["Last"])
        except (TypeError, ValueError) as exc:
            unusable.append({"row": str(index), "reason": str(exc)})
            continue
        if last_value != observation["close"]:
            last_close_mismatches += 1
        parsed.append(observation)
    frame = pd.DataFrame(
        parsed,
        columns=["date", "open", "high", "low", "close", "volume"],
    )
    frame = frame.loc[
        (frame["date"] >= start) & (frame["date"] < end_exclusive)
    ].sort_values("date")
    if frame.empty or frame["date"].duplicated().any():
        raise ValueError(f"{product}: empty or duplicate dates")
    if not (frame[["open", "high", "low", "close"]] > 0).all(axis=None):
        raise ValueError(f"{product}: nonpositive price")
    if frame["volume"].lt(0).any():
        raise ValueError(f"{product}: negative volume")
    if (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    ).any():
        raise ValueError(f"{product}: invalid OHLC bounds")
    first_date = frame["date"].iloc[0]
    last_date = frame["date"].iloc[-1]
    if first_date > start + timedelta(days=15):
        raise ValueError(f"{product}: start appears truncated")
    if last_date < end_exclusive - timedelta(days=16):
        raise ValueError(f"{product}: end appears stale")
    frame = frame.reset_index(drop=True)
    frame["date"] = frame["date"].astype(str)
    return frame, {
        "providerRows": len(parsed) + len(unusable),
        "outputRowsBeforeAlignment": len(frame),
        "firstDate": str(first_date),
        "lastDate": str(last_date),
        "zeroVolumeRows": int(frame["volume"].eq(0).sum()),
        "providerVolumeUnit": "share",
        "outputVolumeUnit": "share",
        "lastCloseMismatchRows": last_close_mismatches,
        "unusableRowsDropped": len(unusable),
        "unusableRowExamples": unusable[:5],
        "declaredIsin": declared_isin,
        "declaredRange": lines[1].strip().strip('"'),
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
    parser.add_argument("--request-delay", type=float, default=1.0)
    parser.add_argument("--terms", required=True)
    args = parser.parse_args()
    if args.end_exclusive <= args.start:
        parser.error("--end-exclusive must be after --start")
    if (args.end_exclusive - args.start).days > MAX_DAYS:
        parser.error("Euronext Live request exceeds the observed two-year limit")
    if args.request_delay < 0:
        parser.error("--request-delay must be nonnegative")
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
    for index, asset in enumerate(assets):
        uri = request_uri(
            asset["providerInstrument"],
            args.start,
            end_inclusive,
            args.adjustment,
        )
        raw_bytes, response = fetch_bytes(uri, asset["providerInstrument"])
        raw_path = raw_root / f"{asset['symbol']}.csv"
        raw_path.write_bytes(raw_bytes)
        frame, summary = parse_payload(
            asset["providerInstrument"],
            raw_bytes,
            args.start,
            args.end_exclusive,
        )
        frames[asset["symbol"]] = frame
        audits[asset["symbol"]] = {
            **summary,
            "providerInstrument": asset["providerInstrument"],
            "declaredVenue": "XPAR",
            "declaredCurrency": "EUR",
            "declaredAssetClass": "equity",
            "requestUri": uri,
            "response": response,
            "rawPath": raw_path.relative_to(output).as_posix(),
            "rawSha256": sha256(raw_path),
        }
        if index + 1 < len(assets):
            time.sleep(args.request_delay)

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
            "calendar": "XPAR",
            "timezone": "Europe/Paris",
        },
        "priceAdjustment": args.adjustment,
        "provider": {
            "name": "euronext-live-historical-download",
            "retrievedAt": retrieved_at,
            "sourceUri": BASE_URL,
            "terms": args.terms,
        },
        "assets": [
            {
                "symbol": asset["symbol"],
                "assetClass": "equity",
                "venue": "XPAR",
                "currency": "EUR",
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
            "requestDelaySeconds": args.request_delay,
        },
        "transformation": (
            "official semicolon CSV parsed; Close used as close; "
            "Number of Shares preserved as share volume"
        ),
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "This proof covers XPAR only, not one synthetic EU calendar.",
            "Euronext adjustment and access terms remain external claims.",
            "No survivorship, delisting, or redistribution claim follows.",
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
