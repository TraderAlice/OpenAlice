"""Fetch auditable recent raw Japanese daily OHLCV from Nikkei."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import pandas as pd


BASE_URL = "https://www.nikkei.com/nkd/company/history/dprice/"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
STOCK_CODE = re.compile(r"^[0-9]{4}$")
AS_OF = re.compile(
    r'class="l-miH02_date"[^>]*>\s*(\d{4})年(\d{1,2})月(\d{1,2})日'
)
SESSION = re.compile(r"^\s*(\d{1,2})/(\d{1,2})")
HEADERS = ["日付", "始値", "高値", "安値", "終値", "売買高", "修正後終値"]


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._table_depth = 0
        self._rows: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag == "table":
            self._table_depth += 1
            if self._table_depth == 1:
                self._rows = []
        elif self._table_depth == 1 and tag == "tr":
            self._row = []
        elif self._table_depth == 1 and tag in {"th", "td"}:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._table_depth == 1 and tag in {"th", "td"} and self._cell is not None:
            assert self._row is not None
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif self._table_depth == 1 and tag == "tr" and self._row is not None:
            if self._row:
                assert self._rows is not None
                self._rows.append(self._row)
            self._row = None
        elif tag == "table" and self._table_depth:
            if self._table_depth == 1 and self._rows is not None:
                self.tables.append(self._rows)
                self._rows = None
            self._table_depth -= 1


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
        "providerCode",
        "providerMarket",
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
        if not STOCK_CODE.fullmatch(normalized["providerCode"]):
            raise ValueError(f"assets[{index}].providerCode must be four digits")
        if normalized["providerMarket"] != "1":
            raise ValueError(f"assets[{index}].providerMarket must be 1")
        if (
            normalized["venue"] != "XTKS"
            or normalized["currency"] != "JPY"
            or normalized["assetClass"] != "equity"
        ):
            raise ValueError(f"assets[{index}] must be XTKS/JPY/equity")
        assets.append(normalized)
    for key in ("symbol", "providerCode"):
        values = [asset[key] for asset in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def request_uri(code: str, market: str) -> str:
    return f"{BASE_URL}?{urllib.parse.urlencode({'scode': code, 'ba': market})}"


def fetch_bytes(uri: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        uri,
        headers={
            "Accept": "text/html,application/xhtml+xml",
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
                raise ValueError("provider returned an empty page")
            return payload, metadata
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            if attempt == 4:
                raise RuntimeError(
                    "Nikkei route failed after 5 attempts: "
                    + " | ".join(errors)
                ) from exc
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def number(value: str) -> float:
    rendered = value.replace(",", "").strip()
    if rendered in {"", "-", "--"}:
        raise ValueError(f"missing numeric value {value!r}")
    return float(rendered)


def resolve_session(value: str, as_of: date) -> date:
    match = SESSION.match(value)
    if match is None:
        raise ValueError(f"unsupported Nikkei session label {value!r}")
    month, day = (int(part) for part in match.groups())
    year = as_of.year if (month, day) <= (as_of.month, as_of.day) else as_of.year - 1
    session_date = date(year, month, day)
    if session_date > as_of:
        raise ValueError(f"resolved future Nikkei session {value!r}")
    return session_date


def parse_payload(
    code: str,
    raw_bytes: bytes,
    start: date,
    end_exclusive: date,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{code}: page is not UTF-8") from exc
    as_of_match = AS_OF.search(text)
    if as_of_match is None:
        raise ValueError(f"{code}: explicit page as-of date is absent")
    as_of = date(*(int(part) for part in as_of_match.groups()))
    parser = TableParser()
    parser.feed(text)
    candidates = [
        table
        for table in parser.tables
        if table and table[0] == HEADERS
    ]
    if len(candidates) != 1:
        raise ValueError(f"{code}: expected exactly one OHLCV table")
    parsed: list[dict[str, Any]] = []
    adjusted_close_differences = 0
    unusable: list[dict[str, str]] = []
    for index, row in enumerate(candidates[0][1:]):
        if len(row) != len(HEADERS):
            unusable.append({"row": str(index), "reason": "wrong cell count"})
            continue
        try:
            observation = {
                "date": resolve_session(row[0], as_of),
                "open": number(row[1]),
                "high": number(row[2]),
                "low": number(row[3]),
                "close": number(row[4]),
                "volume": number(row[5]),
            }
            adjusted_close = number(row[6])
        except ValueError as exc:
            unusable.append({"row": str(index), "reason": str(exc)})
            continue
        if adjusted_close != observation["close"]:
            adjusted_close_differences += 1
        parsed.append(observation)
    frame = pd.DataFrame(
        parsed,
        columns=["date", "open", "high", "low", "close", "volume"],
    )
    source_first = frame["date"].min()
    source_last = frame["date"].max()
    frame = frame.loc[
        (frame["date"] >= start) & (frame["date"] < end_exclusive)
    ].sort_values("date")
    if frame.empty or frame["date"].duplicated().any():
        raise ValueError(f"{code}: empty or duplicate requested dates")
    if source_first > start:
        raise ValueError(
            f"{code}: requested start predates displayed recent history"
        )
    if source_last < min(as_of, end_exclusive - timedelta(days=1)) - timedelta(days=4):
        raise ValueError(f"{code}: page appears stale")
    if not (frame[["open", "high", "low", "close"]] > 0).all(axis=None):
        raise ValueError(f"{code}: nonpositive price")
    if frame["volume"].lt(0).any():
        raise ValueError(f"{code}: negative volume")
    if (
        frame["high"].lt(frame[["open", "low", "close"]].max(axis=1))
        | frame["low"].gt(frame[["open", "high", "close"]].min(axis=1))
    ).any():
        raise ValueError(f"{code}: invalid OHLC bounds")
    frame = frame.reset_index(drop=True)
    frame["date"] = frame["date"].astype(str)
    return frame, {
        "pageAsOf": as_of.isoformat(),
        "sourceRows": len(parsed) + len(unusable),
        "sourceFirstDate": source_first.isoformat(),
        "sourceLastDate": source_last.isoformat(),
        "outputRowsBeforeAlignment": len(frame),
        "firstDate": frame["date"].iloc[0],
        "lastDate": frame["date"].iloc[-1],
        "zeroVolumeRows": int(frame["volume"].eq(0).sum()),
        "providerVolumeUnit": "share",
        "outputVolumeUnit": "share",
        "adjustedCloseDifferenceRows": adjusted_close_differences,
        "unusableRowsDropped": len(unusable),
        "unusableRowExamples": unusable[:5],
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
    parser.add_argument("--request-delay", type=float, default=1.0)
    parser.add_argument("--terms", required=True)
    args = parser.parse_args()
    if args.end_exclusive <= args.start:
        parser.error("--end-exclusive must be after --start")
    if (args.end_exclusive - args.start).days > 45:
        parser.error("Nikkei displayed-history request must be at most 45 days")
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
    frames: dict[str, pd.DataFrame] = {}
    audits: dict[str, Any] = {}
    for index, asset in enumerate(assets):
        uri = request_uri(asset["providerCode"], asset["providerMarket"])
        raw_bytes, response = fetch_bytes(uri)
        raw_path = raw_root / f"{asset['symbol']}.html"
        raw_path.write_bytes(raw_bytes)
        frame, summary = parse_payload(
            asset["providerCode"],
            raw_bytes,
            args.start,
            args.end_exclusive,
        )
        frames[asset["symbol"]] = frame
        audits[asset["symbol"]] = {
            **summary,
            "providerCode": asset["providerCode"],
            "providerMarket": asset["providerMarket"],
            "declaredVenue": "XTKS",
            "declaredCurrency": "JPY",
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
            "calendar": "XTKS",
            "timezone": "Asia/Tokyo",
        },
        "priceAdjustment": "raw",
        "provider": {
            "name": "nikkei-displayed-four-price-history",
            "retrievedAt": retrieved_at,
            "sourceUri": BASE_URL,
            "terms": args.terms,
        },
        "assets": [
            {
                "symbol": asset["symbol"],
                "assetClass": "equity",
                "venue": "XTKS",
                "currency": "JPY",
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
            "requestDelaySeconds": args.request_delay,
        },
        "transformation": (
            "displayed raw OHLC and share volume parsed; yearless session "
            "labels resolved against the explicit page as-of date"
        ),
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "Nikkei displays only a recent month and is not JPX authority.",
            "Displayed adjusted close is not used to construct adjusted OHLC.",
            "Provider venue, access, and terms remain external claims.",
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
