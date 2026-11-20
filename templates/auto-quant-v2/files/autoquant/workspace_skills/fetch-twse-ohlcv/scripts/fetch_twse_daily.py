"""Fetch auditable official TWSE monthly raw daily OHLCV."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import pandas as pd


BASE_URL = "https://www.twse.com.tw/exchangeReport/STOCK_DAY"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
STOCK_NO = re.compile(r"^[A-Za-z0-9]{4,8}$")
RECEIPT_HEADERS = (
    "Content-Type",
    "Content-Length",
    "Location",
    "Server",
    "Date",
    "Retry-After",
)


class TwseResponseError(ValueError):
    """A successful HTTP response that is not usable official JSON."""

    def __init__(
        self,
        message: str,
        body: bytes,
        metadata: dict[str, str],
    ) -> None:
        super().__init__(message)
        self.body = body
        self.metadata = metadata


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
        "providerStockNo",
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
        if not STOCK_NO.fullmatch(normalized["providerStockNo"]):
            raise ValueError(f"assets[{index}].providerStockNo is invalid")
        if normalized["venue"] != "TWSE":
            raise ValueError(f"assets[{index}].venue must be TWSE")
        if normalized["currency"] != "TWD":
            raise ValueError(f"assets[{index}].currency must be TWD")
        if normalized["assetClass"] != "equity":
            raise ValueError(f"assets[{index}].assetClass must be equity")
        assets.append(normalized)
    for key in ("symbol", "providerStockNo"):
        values = [item[key] for item in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def months(start: date, end_exclusive: date) -> Iterator[date]:
    cursor = date(start.year, start.month, 1)
    final = date(end_exclusive.year, end_exclusive.month, 1)
    if end_exclusive.day == 1:
        if final.month == 1:
            final = date(final.year - 1, 12, 1)
        else:
            final = date(final.year, final.month - 1, 1)
    while cursor <= final:
        yield cursor
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)


def request_uri(stock_no: str, month: date) -> str:
    query = urllib.parse.urlencode(
        {
            # TWSE's CDN currently accepts this official route only when the
            # response selector is the first query parameter. Preserve the
            # observed ordering rather than sorting these parameters.
            "response": "json",
            "stockNo": stock_no,
            "date": month.strftime("%Y%m01"),
        }
    )
    return f"{BASE_URL}?{query}"


def _write_request_attempts(
    directory: Path,
    uri: str,
    attempts: list[dict[str, Any]],
    bodies: list[bytes],
    *,
    status: str,
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    recorded: list[dict[str, Any]] = []
    for attempt, body in zip(attempts, bodies):
        current = dict(attempt)
        response = current.get("response")
        if isinstance(response, dict) and body:
            suffix = (
                ".html"
                if body.lstrip().lower().startswith((b"<html", b"<!doctype html"))
                else ".body"
            )
            body_path = directory / f"attempt-{current['attempt']:02d}{suffix}"
            body_path.write_bytes(body)
            response = dict(response)
            response["bodyPath"] = body_path.name
            response["bodySha256"] = sha256(body_path)
            response["bodyBytes"] = len(body)
            current["response"] = response
        recorded.append(current)
    receipt = {
        "schemaVersion": 1,
        "kind": "autoquant-twse-request-attempts",
        "status": status,
        "requestUri": uri,
        "attempts": recorded,
        "limitations": [
            "This receipt proves only what the official route returned to this local process."
        ],
    }
    path = directory / "request-attempts.json"
    path.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def _failure_attempt(
    attempt: int,
    error: Exception,
) -> tuple[dict[str, Any], bytes]:
    recorded: dict[str, Any] = {
        "attempt": attempt,
        "attemptedAt": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "errorType": type(error).__name__,
        "message": str(error),
    }
    body = b""
    if isinstance(error, urllib.error.HTTPError):
        try:
            body = error.read()
        except OSError:
            body = b""
        recorded["response"] = {
            "status": error.code,
            "reason": str(error.reason),
            "finalUri": error.geturl(),
            "headers": {
                name: value
                for name in RECEIPT_HEADERS
                if (value := error.headers.get(name)) is not None
            },
        }
    elif isinstance(error, TwseResponseError):
        body = error.body
        recorded["response"] = {
            "status": int(error.metadata["status"]),
            "reason": "unusable-response-body",
            "finalUri": error.metadata["finalUri"],
            "headers": {
                "Content-Type": error.metadata["contentType"],
                "Content-Length": error.metadata["contentLength"],
            },
        }
    return recorded, body


def fetch_bytes(
    uri: str,
    *,
    attempt_directory: Path | None = None,
) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        uri,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Referer": (
                "https://www.twse.com.tw/en/trading/historical/"
                "stock-day.html"
            ),
            "User-Agent": "Mozilla/5.0 AutoQuantMarketDataSkill/1.0",
        },
    )
    errors: list[str] = []
    attempts: list[dict[str, Any]] = []
    bodies: list[bytes] = []
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
                raise TwseResponseError(
                    "official route returned an empty body",
                    payload,
                    metadata,
                )
            if payload.lstrip().lower().startswith(
                (b"<html", b"<!doctype html")
            ):
                raise TwseResponseError(
                    "official TWSE security page blocked the request",
                    payload,
                    metadata,
                )
            if attempts and attempt_directory is not None:
                _write_request_attempts(
                    attempt_directory,
                    uri,
                    attempts,
                    bodies,
                    status="succeeded-after-retry",
                )
            return payload, metadata
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            recorded, body = _failure_attempt(attempt + 1, exc)
            attempts.append(recorded)
            bodies.append(body)
            if attempt == 4:
                if attempt_directory is not None:
                    _write_request_attempts(
                        attempt_directory,
                        uri,
                        attempts,
                        bodies,
                        status="failed",
                    )
                raise RuntimeError(
                    "TWSE official route failed after 5 attempts: "
                    + " | ".join(errors)
                ) from exc
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def normalize_field(value: Any) -> str:
    return "".join(
        character
        for character in str(value).strip().casefold()
        if character.isalnum()
    )


def roc_date(value: Any) -> date:
    parts = str(value).strip().split("/")
    if len(parts) != 3:
        raise ValueError(f"unsupported TWSE date: {value!r}")
    year, month, day = (int(part) for part in parts)
    if year < 1911:
        year += 1911
    return date(year, month, day)


def number(value: Any) -> float:
    rendered = str(value).strip().replace(",", "")
    if rendered in {"", "--", "---"}:
        raise ValueError(f"missing TWSE numeric value: {value!r}")
    return float(rendered)


def parse_month(
    stock_no: str,
    raw_bytes: bytes,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    try:
        payload = json.loads(raw_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{stock_no}: response is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{stock_no}: response must be an object")
    status = str(payload.get("stat", payload.get("status", ""))).strip()
    rows = payload.get("data")
    fields = payload.get("fields")
    if not isinstance(fields, list) or not isinstance(rows, list):
        raise ValueError(
            f"{stock_no}: official response lacks fields/data ({status})"
        )
    normalized = {normalize_field(field): index for index, field in enumerate(fields)}

    def locate(*aliases: str) -> int:
        for alias in aliases:
            if normalize_field(alias) in normalized:
                return normalized[normalize_field(alias)]
        raise ValueError(
            f"{stock_no}: required field absent; aliases={aliases} fields={fields}"
        )

    indices = {
        "date": locate("Date", "日期"),
        "volume": locate("Trade Volume", "成交股數"),
        "open": locate("Opening Price", "開盤價"),
        "high": locate("Highest Price", "最高價"),
        "low": locate("Lowest Price", "最低價"),
        "close": locate("Closing Price", "收盤價"),
    }
    parsed: list[dict[str, Any]] = []
    unusable_rows: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        if not isinstance(row, list) or len(row) < len(fields):
            raise ValueError(f"{stock_no}: malformed row {index}")
        session_date = roc_date(row[indices["date"]])
        try:
            observation = {
                "date": session_date,
                "open": number(row[indices["open"]]),
                "high": number(row[indices["high"]]),
                "low": number(row[indices["low"]]),
                "close": number(row[indices["close"]]),
                "volume": number(row[indices["volume"]]),
            }
        except ValueError as exc:
            unusable_rows.append(
                {
                    "date": session_date.isoformat(),
                    "reason": str(exc),
                    "row": row,
                }
            )
            continue
        parsed.append(observation)
    frame = pd.DataFrame(
        parsed,
        columns=["date", "open", "high", "low", "close", "volume"],
    )
    return frame, {
        "status": status,
        "title": payload.get("title"),
        "fields": fields,
        "rows": len(frame),
        "providerRows": len(rows),
        "unusableRowsDropped": len(unusable_rows),
        "unusableRowExamples": unusable_rows[:5],
    }


def validate_frame(
    stock_no: str,
    frame: pd.DataFrame,
    start: date,
    end_exclusive: date,
) -> pd.DataFrame:
    frame = frame.loc[
        (frame["date"] >= start) & (frame["date"] < end_exclusive)
    ].sort_values("date")
    if frame.empty:
        raise ValueError(f"{stock_no}: no rows in requested range")
    if frame["date"].duplicated().any():
        raise ValueError(f"{stock_no}: duplicate session dates")
    if not (frame[["open", "high", "low", "close"]] > 0).all(axis=None):
        raise ValueError(f"{stock_no}: nonpositive prices")
    if frame["volume"].lt(0).any():
        raise ValueError(f"{stock_no}: negative volume")
    invalid_bounds = (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    )
    if invalid_bounds.any():
        raise ValueError(f"{stock_no}: inconsistent OHLC bounds")
    result = frame.reset_index(drop=True).copy()
    result["date"] = result["date"].astype(str)
    return result


def ensure_output(path: Path) -> None:
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError(f"output must be absent or empty: {path}")
    path.mkdir(parents=True, exist_ok=True)


def write_provider_failure(
    output: Path,
    *,
    retrieved_at: str,
    args: argparse.Namespace,
    symbol: str,
    stock_no: str,
    month: date,
    uri: str,
    attempt_receipt: Path,
    error: Exception,
) -> Path:
    failure = {
        "schemaVersion": 1,
        "kind": "autoquant-provider-acquisition-failure",
        "status": "failed",
        "provider": {
            "name": "twse-official-stock-day",
            "sourceUri": BASE_URL,
            "terms": args.terms,
        },
        "startedAt": retrieved_at,
        "failedAt": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "request": {
            "start": args.start.isoformat(),
            "endExclusive": args.end_exclusive.isoformat(),
            "interval": "1d",
            "panel": args.panel,
            "requestDelaySeconds": args.request_delay,
            "adjustment": "raw",
        },
        "failedRequest": {
            "symbol": symbol,
            "providerStockNo": stock_no,
            "month": month.isoformat(),
            "requestUri": uri,
            "attemptReceipt": attempt_receipt.relative_to(output).as_posix(),
        },
        "error": {
            "type": type(error).__name__,
            "message": str(error),
        },
        "limitations": [
            "This receipt proves a local official-route failure, not global TWSE unavailability.",
            "No dataset package or provider success audit was produced.",
        ],
    }
    path = output / "provider-failure.json"
    path.write_text(
        json.dumps(failure, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


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
    parser.add_argument(
        "--request-delay",
        type=float,
        default=3.0,
        help="seconds between official monthly requests (default: 3.0)",
    )
    parser.add_argument("--terms", required=True)
    args = parser.parse_args()
    if args.end_exclusive <= args.start:
        parser.error("--end-exclusive must be after --start")
    if not SAFE_SYMBOL.fullmatch(args.dataset_id):
        parser.error("--dataset-id must be a path-safe AutoQuant identifier")
    if args.request_delay < 0:
        parser.error("--request-delay must be nonnegative")

    assets = load_assets(args.assets.expanduser().absolute())
    output = args.output.expanduser().absolute()
    ensure_output(output)
    raw_dir = output / "raw"
    raw_dir.mkdir()
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    frames: dict[str, pd.DataFrame] = {}
    audits: dict[str, Any] = {}

    for asset in assets:
        symbol = asset["symbol"]
        stock_no = asset["providerStockNo"]
        asset_raw_dir = raw_dir / symbol
        asset_raw_dir.mkdir()
        monthly_frames: list[pd.DataFrame] = []
        monthly_audits: list[dict[str, Any]] = []
        for month in months(args.start, args.end_exclusive):
            uri = request_uri(stock_no, month)
            attempt_directory = (
                output
                / "request-attempts"
                / symbol
                / month.strftime("%Y-%m")
            )
            try:
                raw_bytes, response_metadata = fetch_bytes(
                    uri,
                    attempt_directory=attempt_directory,
                )
            except Exception as error:
                write_provider_failure(
                    output,
                    retrieved_at=retrieved_at,
                    args=args,
                    symbol=symbol,
                    stock_no=stock_no,
                    month=month,
                    uri=uri,
                    attempt_receipt=(
                        attempt_directory / "request-attempts.json"
                    ),
                    error=error,
                )
                raise
            raw_path = asset_raw_dir / f"{month.strftime('%Y-%m')}.json"
            raw_path.write_bytes(raw_bytes)
            frame, summary = parse_month(stock_no, raw_bytes)
            monthly_frames.append(frame)
            monthly_audits.append(
                {
                    "month": month.isoformat(),
                    "requestUri": uri,
                    "response": response_metadata,
                    "rawPath": raw_path.relative_to(output).as_posix(),
                    "rawSha256": sha256(raw_path),
                    **summary,
                }
            )
            time.sleep(args.request_delay)
        frame = validate_frame(
            stock_no,
            pd.concat(monthly_frames, ignore_index=True),
            args.start,
            args.end_exclusive,
        )
        frames[symbol] = frame
        audits[symbol] = {
            "providerStockNo": stock_no,
            "declaredVenue": "TWSE",
            "declaredCurrency": "TWD",
            "declaredAssetClass": "equity",
            "monthsRequested": len(monthly_audits),
            "monthlyResponses": monthly_audits,
            "outputRowsBeforeAlignment": len(frame),
            "firstDate": frame["date"].iloc[0],
            "lastDate": frame["date"].iloc[-1],
            "zeroVolumeRows": int(frame["volume"].eq(0).sum()),
            "providerVolumeUnit": "share",
            "outputVolumeUnit": "share",
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
    package: dict[str, Any] = {
        "schemaVersion": schema_version,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": args.dataset_id,
        "version": f"{all_dates[0]}_{all_dates[-1]}",
        "assetClass": "equity",
        "frequency": "1d",
        "market": {
            "clock": "session",
            "calendar": "TWSE",
            "timezone": "Asia/Taipei",
        },
        "priceAdjustment": "raw",
        "provider": {
            "name": "twse-official-stock-day",
            "retrievedAt": retrieved_at,
            "sourceUri": BASE_URL,
            "terms": args.terms,
        },
        "assets": [
            {
                "symbol": asset["symbol"],
                "assetClass": "equity",
                "venue": "TWSE",
                "currency": "TWD",
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
            "requestDelaySeconds": args.request_delay,
            "adjustment": "raw",
        },
        "transformation": (
            "official monthly rows; ROC dates converted to Gregorian; "
            "numeric separators removed; trade volume preserved as shares"
        ),
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "This route covers TWSE, not TPEx.",
            "Official market-data use and redistribution terms still apply.",
            "No corporate-action adjustment or survivorship claim follows.",
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
