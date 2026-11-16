"""Materialize exact scheduled daily closes from explicit calendar authority."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from importlib.metadata import version as distribution_version
from pathlib import Path, PurePosixPath
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import exchange_calendars as xcals
import pandas as pd


PACKAGE_KIND = "autoquant-ohlcv-dataset-package"
AUTHORITY_KIND = "autoquant-daily-close-time-authority"
AUDIT_KIND = "autoquant-daily-close-time-materialization-audit"
SOURCE_KEYS = {
    "schemaVersion",
    "kind",
    "id",
    "version",
    "assetClass",
    "frequency",
    "panelPolicy",
    "market",
    "priceAdjustment",
    "provider",
    "assets",
}
SOURCE_ASSET_KEYS = {
    "symbol",
    "assetClass",
    "venue",
    "currency",
    "path",
}
AUTHORITY_KEYS = {
    "schemaVersion",
    "kind",
    "sourcePackage",
    "outputDataset",
    "calendarAuthority",
    "assets",
}
AUTHORITY_ASSET_KEYS = {
    "symbol",
    "calendar",
    "timezone",
    "volumeSemantics",
}
OHLCV_COLUMNS = ("open", "high", "low", "close", "volume")
SOURCE_COLUMNS = ("date", *OHLCV_COLUMNS)
OUTPUT_COLUMNS = ("timestamp", *OHLCV_COLUMNS)
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ASSET_CLASSES = {
    "crypto",
    "equity",
    "forex",
    "fund",
    "future",
    "index",
    "other",
}
PRICE_ADJUSTMENTS = {
    "raw",
    "split-adjusted",
    "split-and-dividend-adjusted",
    "provider-adjusted",
}
VOLUME_SEMANTICS = {
    "provider-reported-nonnegative",
    "unavailable-zero",
}
SOURCE_PANEL_POLICY = {
    "alignment": "observed-only",
    "missingObservation": "absent-no-fill",
}
OUTPUT_PANEL_POLICY = {
    **SOURCE_PANEL_POLICY,
    "horizonClock": "per-target-observed-bars",
}
OUTPUT_MARKET = {
    "clock": "observed",
    "calendar": "provider-observed",
    "timezone": "UTC",
}


@dataclass(frozen=True)
class SourceRow:
    session_date: date
    values: tuple[str, str, str, str, str]
    decimals: tuple[Decimal, Decimal, Decimal, Decimal, Decimal]


@dataclass(frozen=True)
class PreparedAsset:
    source: dict[str, str]
    authority: dict[str, str]
    source_path: Path
    rows: tuple[SourceRow, ...]
    closes: tuple[pd.Timestamp, ...]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_json(value: Any) -> str:
    rendered = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(rendered).hexdigest()


def require_exact_keys(value: Any, expected: set[str], label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ValueError(
            f"{label} must contain exact keys; missing={missing}, extra={extra}"
        )
    return value


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    if value != value.strip():
        raise ValueError(f"{label} cannot contain surrounding whitespace")
    return value


def real_json_file(path: Path, label: str) -> Path:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"{label} must be a real JSON file: {path}")
    return path


def confined_file(root: Path, relative: str, label: str) -> Path:
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise ValueError(f"{label} is not a confined POSIX descendant: {relative}")
    candidate = root
    for part in pure.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ValueError(f"{label} cannot traverse a symlink: {relative}")
    resolved_root = root.resolve()
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValueError(f"{label} is unavailable: {relative}") from exc
    if resolved_root not in resolved.parents or not resolved.is_file():
        raise ValueError(f"{label} escapes the package root: {relative}")
    return resolved


def parse_decimal(value: Any, label: str) -> Decimal:
    text = str(value).strip()
    if not text:
        raise ValueError(f"{label} must be a finite number")
    try:
        parsed = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"{label} must be a finite number") from exc
    if not parsed.is_finite():
        raise ValueError(f"{label} must be a finite number")
    return parsed


def canonical_decimal(value: Decimal) -> str:
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def scalar_text(value: Any) -> str:
    if pd.isna(value):
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value)


def load_source_rows(path: Path, symbol: str) -> tuple[SourceRow, ...]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            if tuple(reader.fieldnames or ()) != SOURCE_COLUMNS:
                raise ValueError(
                    f"{symbol}: CSV columns must be exactly {SOURCE_COLUMNS}"
                )
            records = [dict(record) for record in reader]
    elif suffix == ".parquet":
        frame = pd.read_parquet(path)
        if tuple(str(column) for column in frame.columns) != SOURCE_COLUMNS:
            raise ValueError(
                f"{symbol}: Parquet columns must be exactly {SOURCE_COLUMNS}"
            )
        records = [
            {column: scalar_text(row[column]) for column in SOURCE_COLUMNS}
            for _, row in frame.iterrows()
        ]
    elif suffix == ".feather":
        frame = pd.read_feather(path)
        if tuple(str(column) for column in frame.columns) != SOURCE_COLUMNS:
            raise ValueError(
                f"{symbol}: Feather columns must be exactly {SOURCE_COLUMNS}"
            )
        records = [
            {column: scalar_text(row[column]) for column in SOURCE_COLUMNS}
            for _, row in frame.iterrows()
        ]
    else:
        raise ValueError(f"{symbol}: unsupported daily asset format: {path}")

    if not records:
        raise ValueError(f"{symbol}: source contains no observations")
    rows: list[SourceRow] = []
    previous: date | None = None
    for index, record in enumerate(records, start=2):
        raw_date = scalar_text(record.get("date"))
        try:
            session_date = date.fromisoformat(raw_date)
        except ValueError as exc:
            raise ValueError(
                f"{symbol}: row {index} date must be exact YYYY-MM-DD"
            ) from exc
        if session_date.isoformat() != raw_date:
            raise ValueError(
                f"{symbol}: row {index} date must be exact YYYY-MM-DD"
            )
        if previous is not None and session_date <= previous:
            raise ValueError(
                f"{symbol}: session dates must be unique and increasing"
            )
        values = tuple(scalar_text(record.get(column)) for column in OHLCV_COLUMNS)
        decimals = tuple(
            parse_decimal(value, f"{symbol}: row {index} {column}")
            for column, value in zip(OHLCV_COLUMNS, values, strict=True)
        )
        open_value, high, low, close, volume = decimals
        if min(open_value, high, low, close) <= 0:
            raise ValueError(f"{symbol}: row {index} OHLC must be positive")
        if volume < 0:
            raise ValueError(f"{symbol}: row {index} volume must be nonnegative")
        if high < max(open_value, low, close) or low > min(
            open_value,
            high,
            close,
        ):
            raise ValueError(f"{symbol}: row {index} has invalid OHLC geometry")
        rows.append(SourceRow(session_date, values, decimals))
        previous = session_date
    return tuple(rows)


def load_source_package(path: Path) -> dict[str, Any]:
    package = json.loads(real_json_file(path, "source package").read_text("utf-8"))
    require_exact_keys(package, SOURCE_KEYS, "source package")
    if package["schemaVersion"] != 4 or package["kind"] != PACKAGE_KIND:
        raise ValueError("source package must be strict AutoQuant V4")
    for key in ("id", "version", "assetClass"):
        require_string(package[key], f"source package.{key}")
    if package["frequency"] != "1d":
        raise ValueError("source package.frequency must equal '1d'")
    if package["panelPolicy"] != SOURCE_PANEL_POLICY:
        raise ValueError("source package must be observed-only absent-no-fill V4")
    if package["priceAdjustment"] not in PRICE_ADJUSTMENTS:
        raise ValueError("source package has unsupported priceAdjustment")

    market = require_exact_keys(
        package["market"],
        {"clock", "calendar", "timezone"},
        "source package.market",
    )
    if market["clock"] != "session":
        raise ValueError("source package.market.clock must equal 'session'")
    require_string(market["calendar"], "source package.market.calendar")
    timezone_name = require_string(
        market["timezone"],
        "source package.market.timezone",
    )
    try:
        ZoneInfo(timezone_name)
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ValueError("source package.market.timezone must be an IANA name") from exc

    provider = require_exact_keys(
        package["provider"],
        {"name", "retrievedAt", "sourceUri", "terms"},
        "source package.provider",
    )
    require_string(provider["name"], "source package.provider.name")
    require_string(provider["terms"], "source package.provider.terms")
    if provider["sourceUri"] is not None:
        require_string(provider["sourceUri"], "source package.provider.sourceUri")
    retrieved = provider["retrievedAt"]
    if retrieved is not None:
        retrieved_text = require_string(retrieved, "source package.provider.retrievedAt")
        try:
            parsed_retrieved = datetime.fromisoformat(
                retrieved_text.replace("Z", "+00:00")
            )
        except ValueError as exc:
            raise ValueError(
                "source package.provider.retrievedAt must be ISO-8601"
            ) from exc
        if parsed_retrieved.tzinfo is None:
            raise ValueError(
                "source package.provider.retrievedAt must be timezone-aware"
            )

    assets = package["assets"]
    if not isinstance(assets, list) or not assets:
        raise ValueError("source package.assets must be a non-empty array")
    symbols: list[str] = []
    paths: list[str] = []
    classes: list[str] = []
    for index, item in enumerate(assets):
        asset = require_exact_keys(
            item,
            SOURCE_ASSET_KEYS,
            f"source package.assets[{index}]",
        )
        for key in SOURCE_ASSET_KEYS:
            require_string(asset[key], f"source package.assets[{index}].{key}")
        if not SAFE_SYMBOL.fullmatch(asset["symbol"]):
            raise ValueError(f"source package.assets[{index}].symbol is not path-safe")
        if asset["assetClass"] not in ASSET_CLASSES:
            raise ValueError(f"source package.assets[{index}].assetClass is unsupported")
        symbols.append(asset["symbol"])
        paths.append(asset["path"])
        classes.append(asset["assetClass"])
    if len(symbols) != len(set(symbols)):
        raise ValueError("source package asset symbols must be unique")
    if len(paths) != len(set(paths)):
        raise ValueError("source package asset paths must be unique")
    expected_class = classes[0] if len(set(classes)) == 1 else "mixed"
    if package["assetClass"] != expected_class:
        raise ValueError(
            f"source package.assetClass must summarize assets as {expected_class!r}"
        )
    return package


def load_authority(
    path: Path,
    source_package: dict[str, Any],
    source_hash: str,
) -> tuple[dict[str, Any], dict[str, dict[str, str]], str]:
    authority = json.loads(real_json_file(path, "authority").read_text("utf-8"))
    require_exact_keys(authority, AUTHORITY_KEYS, "authority")
    if authority["schemaVersion"] != 1 or authority["kind"] != AUTHORITY_KIND:
        raise ValueError(f"authority must be schemaVersion 1 kind {AUTHORITY_KIND}")
    source = require_exact_keys(
        authority["sourcePackage"],
        {"id", "version", "sha256"},
        "authority.sourcePackage",
    )
    if source != {
        "id": source_package["id"],
        "version": source_package["version"],
        "sha256": source_hash,
    }:
        raise ValueError("authority.sourcePackage does not bind the exact source package")
    output = require_exact_keys(
        authority["outputDataset"],
        {"id", "version"},
        "authority.outputDataset",
    )
    for key in ("id", "version"):
        require_string(output[key], f"authority.outputDataset.{key}")
    if not SAFE_SYMBOL.fullmatch(output["id"]):
        raise ValueError("authority.outputDataset.id must be path-safe")

    calendar_authority = require_exact_keys(
        authority["calendarAuthority"],
        {"library", "version", "closeSemantics", "limitations"},
        "authority.calendarAuthority",
    )
    installed_version = distribution_version("exchange-calendars")
    expected_calendar_authority = {
        "library": "exchange_calendars",
        "version": installed_version,
        "closeSemantics": "scheduled-regular-session-close",
    }
    for key, expected in expected_calendar_authority.items():
        if calendar_authority.get(key) != expected:
            raise ValueError(
                f"authority.calendarAuthority.{key} must equal {expected!r}"
            )
    limitations = calendar_authority["limitations"]
    if not isinstance(limitations, list) or not limitations:
        raise ValueError("authority.calendarAuthority.limitations must be non-empty")
    for index, limitation in enumerate(limitations):
        require_string(
            limitation,
            f"authority.calendarAuthority.limitations[{index}]",
        )

    raw_assets = authority["assets"]
    if not isinstance(raw_assets, list) or not raw_assets:
        raise ValueError("authority.assets must be a non-empty array")
    mapped: dict[str, dict[str, str]] = {}
    for index, item in enumerate(raw_assets):
        asset = require_exact_keys(
            item,
            AUTHORITY_ASSET_KEYS,
            f"authority.assets[{index}]",
        )
        normalized = {
            key: require_string(asset[key], f"authority.assets[{index}].{key}")
            for key in AUTHORITY_ASSET_KEYS
        }
        if normalized["symbol"] in mapped:
            raise ValueError("authority asset symbols must be unique")
        if normalized["volumeSemantics"] not in VOLUME_SEMANTICS:
            raise ValueError(
                f"authority.assets[{index}].volumeSemantics is unsupported"
            )
        mapped[normalized["symbol"]] = normalized
    source_symbols = {item["symbol"] for item in source_package["assets"]}
    if set(mapped) != source_symbols:
        raise ValueError(
            "authority asset inventory must exactly match the source package"
        )
    return authority, mapped, installed_version


def calendar_closes(
    symbol: str,
    rows: tuple[SourceRow, ...],
    authority: dict[str, str],
) -> tuple[pd.Timestamp, ...]:
    calendar_name = authority["calendar"]
    try:
        calendar = xcals.get_calendar(
            calendar_name,
            start=rows[0].session_date.isoformat(),
            end=rows[-1].session_date.isoformat(),
        )
    except Exception as exc:
        raise ValueError(f"{symbol}: unknown or unavailable calendar {calendar_name!r}") from exc
    if calendar.name != calendar_name:
        raise ValueError(
            f"{symbol}: calendar alias {calendar_name!r} resolved to {calendar.name!r}; "
            "declare the canonical calendar name"
        )
    actual_timezone = str(calendar.tz)
    if authority["timezone"] != actual_timezone:
        raise ValueError(
            f"{symbol}: authority timezone {authority['timezone']!r} differs "
            f"from {calendar_name} timezone {actual_timezone!r}"
        )
    closes: list[pd.Timestamp] = []
    for row in rows:
        session = pd.Timestamp(row.session_date)
        try:
            is_session = calendar.is_session(session)
        except Exception:
            is_session = False
        if not is_session:
            raise ValueError(
                f"{symbol}: {row.session_date.isoformat()} is not a "
                f"{calendar_name} session"
            )
        close = pd.Timestamp(calendar.session_close(session))
        if close.tzinfo is None:
            raise ValueError(f"{symbol}: calendar returned a timezone-naive close")
        closes.append(close.tz_convert("UTC"))
    if pd.DatetimeIndex(closes).duplicated().any() or any(
        right <= left for left, right in zip(closes, closes[1:], strict=False)
    ):
        raise ValueError(f"{symbol}: scheduled close timestamps are not unique and increasing")
    return tuple(closes)


def close_iso(value: pd.Timestamp) -> str:
    return value.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def prepare_assets(
    source_path: Path,
    package: dict[str, Any],
    authority_assets: dict[str, dict[str, str]],
) -> tuple[PreparedAsset, ...]:
    prepared: list[PreparedAsset] = []
    for source in package["assets"]:
        symbol = source["symbol"]
        source_file = confined_file(
            source_path.parent,
            source["path"],
            f"{symbol} source path",
        )
        rows = load_source_rows(source_file, symbol)
        authority = authority_assets[symbol]
        if authority["volumeSemantics"] == "unavailable-zero" and any(
            row.decimals[-1] != 0 for row in rows
        ):
            raise ValueError(
                f"{symbol}: unavailable-zero volume semantics requires all-zero volume"
            )
        prepared.append(
            PreparedAsset(
                source=source,
                authority=authority,
                source_path=source_file,
                rows=rows,
                closes=calendar_closes(symbol, rows, authority),
            )
        )
    return tuple(prepared)


def ohlcv_hash(rows: tuple[SourceRow, ...]) -> str:
    return hash_json(
        [
            [canonical_decimal(value) for value in row.decimals]
            for row in rows
        ]
    )


def write_asset(path: Path, asset: PreparedAsset) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(OUTPUT_COLUMNS)
        for row, close in zip(asset.rows, asset.closes, strict=True):
            writer.writerow((close_iso(close), *row.values))


def verify_written_asset(path: Path, asset: PreparedAsset) -> None:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != OUTPUT_COLUMNS:
            raise ValueError(f"{asset.source['symbol']}: output columns changed")
        records = list(reader)
    if len(records) != len(asset.rows):
        raise ValueError(f"{asset.source['symbol']}: output row count changed")
    for index, (record, row, close) in enumerate(
        zip(records, asset.rows, asset.closes, strict=True),
        start=2,
    ):
        if record["timestamp"] != close_iso(close):
            raise ValueError(
                f"{asset.source['symbol']}: row {index} output timestamp changed"
            )
        output_values = tuple(
            parse_decimal(
                record[column],
                f"{asset.source['symbol']}: output row {index} {column}",
            )
            for column in OHLCV_COLUMNS
        )
        if output_values != row.decimals:
            raise ValueError(
                f"{asset.source['symbol']}: row {index} OHLCV value changed"
            )


def transition_rows(asset: PreparedAsset) -> list[dict[str, str]]:
    transitions: list[dict[str, str]] = []
    prior: str | None = None
    for row, close in zip(asset.rows, asset.closes, strict=True):
        current = close.strftime("%H:%M:%SZ")
        if prior is not None and current != prior:
            transitions.append(
                {
                    "sessionDate": row.session_date.isoformat(),
                    "previousCloseTimeUtc": prior,
                    "scheduledCloseTimeUtc": current,
                }
            )
        prior = current
    return transitions


def build_output_package(
    source: dict[str, Any],
    authority: dict[str, Any],
) -> dict[str, Any]:
    assets = [
        {
            "symbol": item["symbol"],
            "assetClass": item["assetClass"],
            "venue": item["venue"],
            "currency": item["currency"],
            "path": f"assets/{item['symbol']}.csv",
            "volumeSemantics": next(
                authority_item["volumeSemantics"]
                for authority_item in authority["assets"]
                if authority_item["symbol"] == item["symbol"]
            ),
        }
        for item in source["assets"]
    ]
    return {
        "schemaVersion": 5,
        "kind": PACKAGE_KIND,
        "id": authority["outputDataset"]["id"],
        "version": authority["outputDataset"]["version"],
        "assetClass": source["assetClass"],
        "baseInterval": "1d",
        "timestampSemantics": "bar-close",
        "panelPolicy": dict(OUTPUT_PANEL_POLICY),
        "market": dict(OUTPUT_MARKET),
        "priceAdjustment": source["priceAdjustment"],
        "provider": source["provider"],
        "assets": assets,
    }


def build_audit(
    source_path: Path,
    source: dict[str, Any],
    source_hash: str,
    authority_path: Path,
    authority: dict[str, Any],
    calendar_version: str,
    prepared: tuple[PreparedAsset, ...],
    staging: Path,
    output: Path,
    output_package: dict[str, Any],
) -> dict[str, Any]:
    asset_audits: dict[str, Any] = {}
    for asset in prepared:
        symbol = asset.source["symbol"]
        output_relative = f"assets/{symbol}.csv"
        output_path = staging / output_relative
        value_hash = ohlcv_hash(asset.rows)
        asset_audits[symbol] = {
            "source": {
                "path": asset.source["path"],
                "sha256": sha256(asset.source_path),
            },
            "calendar": asset.authority["calendar"],
            "timezone": asset.authority["timezone"],
            "volumeSemantics": asset.authority["volumeSemantics"],
            "observations": len(asset.rows),
            "firstSessionDate": asset.rows[0].session_date.isoformat(),
            "lastSessionDate": asset.rows[-1].session_date.isoformat(),
            "firstScheduledClose": close_iso(asset.closes[0]),
            "lastScheduledClose": close_iso(asset.closes[-1]),
            "scheduledCloseTimesUtc": sorted(
                {close.strftime("%H:%M:%SZ") for close in asset.closes}
            ),
            "closeTimeTransitions": transition_rows(asset),
            "observedDateSha256": hash_json(
                [row.session_date.isoformat() for row in asset.rows]
            ),
            "scheduledTimestampSha256": hash_json(
                [close_iso(close) for close in asset.closes]
            ),
            "sourceOhlcvSha256": value_hash,
            "outputOhlcvSha256": value_hash,
            "output": {
                "path": output_relative,
                "sha256": sha256(output_path),
            },
            "preservation": {
                "rowCountUnchanged": True,
                "observedDatesUnchanged": True,
                "ohlcvValuesUnchanged": True,
                "absentRowsRemainAbsent": True,
            },
        }
    package_path = staging / "dataset-package.json"
    return {
        "schemaVersion": 1,
        "kind": AUDIT_KIND,
        "sourcePackage": {
            "path": str(source_path),
            "sha256": source_hash,
            "id": source["id"],
            "version": source["version"],
            "schemaVersion": source["schemaVersion"],
            "market": source["market"],
            "panelPolicy": source["panelPolicy"],
            "priceAdjustment": source["priceAdjustment"],
            "provider": source["provider"],
        },
        "authority": {
            "path": str(authority_path),
            "sha256": sha256(authority_path),
            "library": "exchange_calendars",
            "version": calendar_version,
            "closeSemantics": "scheduled-regular-session-close",
            "limitations": authority["calendarAuthority"]["limitations"],
        },
        "transformation": {
            "inputLabel": "provider-observed-session-date",
            "outputLabel": "scheduled-completed-bar-close-utc",
            "calendarInference": False,
            "alignment": False,
            "fill": False,
            "rowRemoval": False,
            "ohlcvMutation": False,
        },
        "assets": asset_audits,
        "outputPackage": {
            "path": str(output / "dataset-package.json"),
            "relativePath": "dataset-package.json",
            "sha256": sha256(package_path),
            "id": output_package["id"],
            "version": output_package["version"],
            "schemaVersion": output_package["schemaVersion"],
        },
        "limitations": [
            "Scheduled closes come from the explicitly pinned calendar library; they are not authenticated exchange records.",
            "The transformation does not reconstruct unscheduled halts, provider corrections, corporate actions, or missing observations.",
            "Structural V5 intake remains required and does not authenticate source-provider claims.",
        ],
    }


def materialize(
    source_path: Path,
    authority_path: Path,
    output: Path,
) -> dict[str, Any]:
    source_path = source_path.expanduser().absolute()
    authority_path = authority_path.expanduser().absolute()
    output = output.expanduser().absolute()
    if output.exists() or output.is_symlink():
        raise ValueError(f"output must be absent: {output}")
    source = load_source_package(source_path)
    source_hash = sha256(source_path)
    authority, authority_assets, calendar_version = load_authority(
        authority_path,
        source,
        source_hash,
    )
    prepared = prepare_assets(source_path, source, authority_assets)
    output_package = build_output_package(source, authority)

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = output.parent / f".{output.name}.creating-{uuid.uuid4().hex}"
    if staging.exists() or staging.is_symlink():
        raise ValueError(f"transaction staging path unexpectedly exists: {staging}")
    try:
        (staging / "assets").mkdir(parents=True)
        for asset in prepared:
            path = staging / "assets" / f"{asset.source['symbol']}.csv"
            write_asset(path, asset)
            verify_written_asset(path, asset)
        package_path = staging / "dataset-package.json"
        package_path.write_text(
            json.dumps(output_package, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        audit = build_audit(
            source_path,
            source,
            source_hash,
            authority_path,
            authority,
            calendar_version,
            prepared,
            staging,
            output,
            output_package,
        )
        (staging / "close-time-audit.json").write_text(
            json.dumps(audit, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.rename(staging, output)
    except Exception:
        if staging.exists() and not staging.is_symlink():
            shutil.rmtree(staging)
        raise

    return {
        "schemaVersion": 1,
        "kind": "autoquant-daily-close-time-materialization-result",
        "datasetPackage": str(output / "dataset-package.json"),
        "audit": str(output / "close-time-audit.json"),
        "assets": len(prepared),
        "observations": sum(len(asset.rows) for asset in prepared),
        "calendarLibrary": {
            "name": "exchange_calendars",
            "version": calendar_version,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Convert one exact observed-only V4 daily package into an "
            "audited close-time-aware V5 package"
        )
    )
    parser.add_argument("--source-package", type=Path, required=True)
    parser.add_argument("--authority", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = materialize(
            args.source_package,
            args.authority,
            args.output,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
