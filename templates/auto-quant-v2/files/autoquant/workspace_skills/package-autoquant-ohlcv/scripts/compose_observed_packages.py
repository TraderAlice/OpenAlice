"""Compose complete strict V5 packages into one audited multi-source V6 package."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

import pandas as pd

PACKAGE_KIND = "autoquant-ohlcv-dataset-package"
AUTHORITY_KIND = "autoquant-observed-package-composition"
AUDIT_KIND = "autoquant-observed-package-composition-audit"
PACKAGE_KEYS = {
    "schemaVersion",
    "kind",
    "id",
    "version",
    "assetClass",
    "baseInterval",
    "timestampSemantics",
    "panelPolicy",
    "market",
    "priceAdjustment",
    "provider",
    "assets",
}
ASSET_KEYS = {
    "symbol",
    "assetClass",
    "venue",
    "currency",
    "path",
    "volumeSemantics",
}
AUTHORITY_KEYS = {
    "schemaVersion",
    "kind",
    "outputDataset",
    "sourcePackages",
}
SOURCE_AUTHORITY_KEYS = {"id", "path", "sha256"}
PROVIDER_KEYS = {"name", "retrievedAt", "sourceUri", "terms"}
SOURCE_PACKAGE_KEYS = {"id", "version", "sha256"}
OHLCV_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
SAFE_SOURCE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SUPPORTED_SUFFIXES = {".csv", ".parquet", ".feather"}
SUPPORTED_INTERVALS = {"1m", "5m", "15m", "30m", "1h", "4h", "1d"}
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
PANEL_POLICY = {
    "alignment": "observed-only",
    "missingObservation": "absent-no-fill",
    "horizonClock": "per-target-observed-bars",
}
MARKET = {
    "clock": "observed",
    "calendar": "provider-observed",
    "timezone": "UTC",
}


@dataclass(frozen=True)
class PreparedAsset:
    source_id: str
    manifest_path: Path
    source: dict[str, str]
    source_path: Path
    source_hash: str
    rows: int
    first_timestamp: str
    last_timestamp: str


@dataclass(frozen=True)
class PreparedSource:
    source_id: str
    manifest_path: Path
    manifest_hash: str
    package: dict[str, Any]
    assets: tuple[PreparedAsset, ...]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_exact_keys(value: Any, expected: set[str], label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    actual = set(value)
    if actual != expected:
        raise ValueError(
            f"{label} must contain exact keys; "
            f"missing={sorted(expected - actual)}, extra={sorted(actual - expected)}"
        )
    return value


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    if value != value.strip():
        raise ValueError(f"{label} cannot contain surrounding whitespace")
    return value


def confined_file(root: Path, relative: str, label: str) -> Path:
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise ValueError(f"{label} is not a confined POSIX descendant: {relative}")
    candidate = root
    for part in pure.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ValueError(f"{label} cannot traverse a symlink: {relative}")
    try:
        resolved_root = root.resolve(strict=True)
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValueError(f"{label} is unavailable: {relative}") from exc
    if resolved_root not in resolved.parents or not resolved.is_file():
        raise ValueError(f"{label} escapes its authority root: {relative}")
    return resolved


def require_real_output_parent(output: Path) -> None:
    current = output.parent
    missing: list[Path] = []
    while not current.exists() and not current.is_symlink():
        missing.append(current)
        if current == current.parent:
            break
        current = current.parent
    if current.is_symlink() or not current.is_dir():
        raise ValueError(f"output parent must not traverse a symlink: {output.parent}")
    for path in reversed(missing):
        path.mkdir()


def normalize_provider(value: Any, label: str) -> dict[str, Any]:
    provider = require_exact_keys(value, PROVIDER_KEYS, label)
    normalized: dict[str, Any] = {}
    normalized["name"] = require_string(provider["name"], f"{label}.name")
    normalized["terms"] = require_string(provider["terms"], f"{label}.terms")
    uri = provider["sourceUri"]
    normalized["sourceUri"] = (
        require_string(uri, f"{label}.sourceUri") if uri is not None else None
    )
    retrieved = provider["retrievedAt"]
    if retrieved is None:
        normalized["retrievedAt"] = None
    else:
        text = require_string(retrieved, f"{label}.retrievedAt")
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError(f"{label}.retrievedAt must be ISO-8601") from exc
        if parsed.tzinfo is None:
            raise ValueError(f"{label}.retrievedAt must be timezone-aware")
        normalized["retrievedAt"] = text
    return normalized


def load_frame(path: Path, symbol: str, volume_semantics: str) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        frame = pd.read_csv(path)
    elif suffix == ".parquet":
        frame = pd.read_parquet(path)
    elif suffix == ".feather":
        frame = pd.read_feather(path)
    else:
        raise ValueError(f"{symbol}: unsupported observed asset format {suffix!r}")
    if tuple(str(column) for column in frame.columns) != OHLCV_COLUMNS:
        raise ValueError(f"{symbol}: columns must be exactly {OHLCV_COLUMNS}")
    frame = frame.copy()
    raw_timestamp = frame["timestamp"]
    parsed_timestamp = pd.to_datetime(raw_timestamp, utc=True, errors="coerce")
    if frame.empty or parsed_timestamp.isna().any():
        raise ValueError(f"{symbol}: empty or unparsable observed timestamps")
    if (
        not parsed_timestamp.is_monotonic_increasing
        or parsed_timestamp.duplicated().any()
    ):
        raise ValueError(f"{symbol}: timestamps must be unique and increasing")
    for column in OHLCV_COLUMNS[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    numeric = frame.loc[:, OHLCV_COLUMNS[1:]]
    if numeric.isna().any().any():
        raise ValueError(f"{symbol}: null or non-finite OHLCV")
    if not numeric.apply(lambda series: series.map(pd.notna)).all().all():
        raise ValueError(f"{symbol}: null OHLCV")
    if not numeric.map(lambda value: bool(pd.api.types.is_number(value))).all().all():
        raise ValueError(f"{symbol}: non-numeric OHLCV")
    if (
        not numeric.map(
            lambda value: (
                float(value) == float(value) and abs(float(value)) != float("inf")
            )
        )
        .all()
        .all()
    ):
        raise ValueError(f"{symbol}: non-finite OHLCV")
    if (frame[["open", "high", "low", "close"]] <= 0).any().any():
        raise ValueError(f"{symbol}: OHLC must be positive")
    if (frame["volume"] < 0).any():
        raise ValueError(f"{symbol}: volume must be nonnegative")
    bad_bounds = frame["high"].lt(frame[["open", "low", "close"]].max(axis=1)) | frame[
        "low"
    ].gt(frame[["open", "high", "close"]].min(axis=1))
    if bad_bounds.any():
        raise ValueError(f"{symbol}: inconsistent OHLC bounds")
    if volume_semantics == "unavailable-zero" and not frame["volume"].eq(0).all():
        raise ValueError(f"{symbol}: unavailable-zero requires all-zero volume")
    frame["timestamp"] = parsed_timestamp
    return frame


def load_v5_package(source_id: str, manifest_path: Path) -> PreparedSource:
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError(f"{source_id}: source package must be a real JSON file")
    package = json.loads(manifest_path.read_text(encoding="utf-8"))
    require_exact_keys(package, PACKAGE_KEYS, f"{source_id} package")
    if package["schemaVersion"] != 5 or package["kind"] != PACKAGE_KIND:
        raise ValueError(f"{source_id}: source package must be strict AutoQuant V5")
    for key in ("id", "version", "assetClass"):
        require_string(package[key], f"{source_id} package.{key}")
    if package["baseInterval"] not in SUPPORTED_INTERVALS:
        raise ValueError(f"{source_id}: unsupported baseInterval")
    if package["timestampSemantics"] != "bar-close":
        raise ValueError(f"{source_id}: timestampSemantics must equal 'bar-close'")
    if package["panelPolicy"] != PANEL_POLICY:
        raise ValueError(f"{source_id}: package must preserve observed-only authority")
    if package["market"] != MARKET:
        raise ValueError(
            f"{source_id}: package market must equal V5 observed UTC authority"
        )
    if package["priceAdjustment"] not in PRICE_ADJUSTMENTS:
        raise ValueError(f"{source_id}: unsupported priceAdjustment")
    package["provider"] = normalize_provider(
        package["provider"],
        f"{source_id} package.provider",
    )
    raw_assets = package["assets"]
    if not isinstance(raw_assets, list) or not raw_assets:
        raise ValueError(f"{source_id}: assets must be a non-empty array")
    symbols: list[str] = []
    paths: list[str] = []
    classes: list[str] = []
    prepared: list[PreparedAsset] = []
    for index, item in enumerate(raw_assets):
        asset = require_exact_keys(
            item,
            ASSET_KEYS,
            f"{source_id} package.assets[{index}]",
        )
        for key in ASSET_KEYS:
            require_string(asset[key], f"{source_id} package.assets[{index}].{key}")
        symbol = asset["symbol"]
        if not SAFE_SYMBOL.fullmatch(symbol):
            raise ValueError(f"{source_id}: asset symbol is not path-safe: {symbol!r}")
        if asset["assetClass"] not in ASSET_CLASSES:
            raise ValueError(f"{source_id}/{symbol}: unsupported assetClass")
        if asset["volumeSemantics"] not in VOLUME_SEMANTICS:
            raise ValueError(f"{source_id}/{symbol}: unsupported volumeSemantics")
        source_path = confined_file(
            manifest_path.parent,
            asset["path"],
            f"{source_id}/{symbol} asset path",
        )
        if source_path.suffix.lower() not in SUPPORTED_SUFFIXES:
            raise ValueError(f"{source_id}/{symbol}: unsupported asset suffix")
        frame = load_frame(source_path, symbol, asset["volumeSemantics"])
        symbols.append(symbol)
        paths.append(asset["path"])
        classes.append(asset["assetClass"])
        prepared.append(
            PreparedAsset(
                source_id=source_id,
                manifest_path=manifest_path,
                source=asset,
                source_path=source_path,
                source_hash=sha256(source_path),
                rows=len(frame),
                first_timestamp=frame["timestamp"]
                .iloc[0]
                .isoformat()
                .replace("+00:00", "Z"),
                last_timestamp=frame["timestamp"]
                .iloc[-1]
                .isoformat()
                .replace("+00:00", "Z"),
            )
        )
    if len(symbols) != len(set(symbols)):
        raise ValueError(f"{source_id}: asset symbols must be unique")
    if len(paths) != len(set(paths)):
        raise ValueError(f"{source_id}: asset paths must be unique")
    expected_class = classes[0] if len(set(classes)) == 1 else "mixed"
    if package["assetClass"] != expected_class:
        raise ValueError(
            f"{source_id}: assetClass must summarize assets as {expected_class!r}"
        )
    return PreparedSource(
        source_id=source_id,
        manifest_path=manifest_path,
        manifest_hash=sha256(manifest_path),
        package=package,
        assets=tuple(prepared),
    )


def load_authority(path: Path) -> tuple[dict[str, Any], tuple[PreparedSource, ...]]:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"authority must be a real JSON file: {path}")
    authority = json.loads(path.read_text(encoding="utf-8"))
    require_exact_keys(authority, AUTHORITY_KEYS, "authority")
    if authority["schemaVersion"] != 1 or authority["kind"] != AUTHORITY_KIND:
        raise ValueError(f"authority must be schemaVersion 1 kind {AUTHORITY_KIND}")
    output = require_exact_keys(
        authority["outputDataset"],
        {"id", "version"},
        "authority.outputDataset",
    )
    for key in ("id", "version"):
        require_string(output[key], f"authority.outputDataset.{key}")
    if not SAFE_SYMBOL.fullmatch(output["id"]):
        raise ValueError("authority.outputDataset.id must be path-safe")
    raw_sources = authority["sourcePackages"]
    if not isinstance(raw_sources, list) or len(raw_sources) < 2:
        raise ValueError("authority.sourcePackages must contain at least two packages")
    source_ids: list[str] = []
    declared_hashes: list[str] = []
    prepared: list[PreparedSource] = []
    for index, item in enumerate(raw_sources):
        source = require_exact_keys(
            item,
            SOURCE_AUTHORITY_KEYS,
            f"authority.sourcePackages[{index}]",
        )
        source_id = require_string(
            source["id"], f"authority.sourcePackages[{index}].id"
        )
        if not SAFE_SOURCE_ID.fullmatch(source_id):
            raise ValueError(
                f"authority source id is not lowercase path-safe: {source_id!r}"
            )
        relative = require_string(
            source["path"], f"authority.sourcePackages[{index}].path"
        )
        expected_hash = require_string(
            source["sha256"],
            f"authority.sourcePackages[{index}].sha256",
        )
        if not SHA256.fullmatch(expected_hash):
            raise ValueError(f"{source_id}: authority sha256 must be lowercase SHA-256")
        manifest_path = confined_file(
            path.parent, relative, f"{source_id} source package"
        )
        actual_hash = sha256(manifest_path)
        if actual_hash != expected_hash:
            raise ValueError(
                f"{source_id}: authority sha256 does not bind source package"
            )
        loaded = load_v5_package(source_id, manifest_path)
        source_ids.append(source_id)
        declared_hashes.append(expected_hash)
        prepared.append(loaded)
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("authority source ids must be unique")
    if len(declared_hashes) != len(set(declared_hashes)):
        raise ValueError("authority source-package hashes must be unique")
    providers = {
        json.dumps(source.package["provider"], sort_keys=True, separators=(",", ":"))
        for source in prepared
    }
    if len(providers) < 2:
        raise ValueError("composition requires at least two distinct provider claims")
    symbols = [asset.source["symbol"] for source in prepared for asset in source.assets]
    if len(symbols) != len(set(symbols)):
        raise ValueError("source package asset inventories must be disjoint")
    compatibility = (
        "baseInterval",
        "timestampSemantics",
        "panelPolicy",
        "market",
        "priceAdjustment",
    )
    first = prepared[0].package
    for source in prepared[1:]:
        for key in compatibility:
            if source.package[key] != first[key]:
                raise ValueError(f"source packages disagree on {key}")
    return authority, tuple(prepared)


def build_package(
    authority: dict[str, Any],
    sources: tuple[PreparedSource, ...],
) -> dict[str, Any]:
    classes = [
        asset.source["assetClass"] for source in sources for asset in source.assets
    ]
    first = sources[0].package
    return {
        "schemaVersion": 6,
        "kind": PACKAGE_KIND,
        "id": authority["outputDataset"]["id"],
        "version": authority["outputDataset"]["version"],
        "assetClass": classes[0] if len(set(classes)) == 1 else "mixed",
        "baseInterval": first["baseInterval"],
        "timestampSemantics": first["timestampSemantics"],
        "panelPolicy": first["panelPolicy"],
        "market": first["market"],
        "priceAdjustment": first["priceAdjustment"],
        "sources": [
            {
                "id": source.source_id,
                "sourcePackage": {
                    "id": source.package["id"],
                    "version": source.package["version"],
                    "sha256": source.manifest_hash,
                },
                "provider": source.package["provider"],
            }
            for source in sources
        ],
        "assets": [
            {
                **asset.source,
                "path": f"assets/{asset.source['symbol']}{asset.source_path.suffix.lower()}",
                "sourceId": source.source_id,
            }
            for source in sources
            for asset in source.assets
        ],
    }


def write_and_verify_assets(staging: Path, sources: tuple[PreparedSource, ...]) -> None:
    assets_root = staging / "assets"
    assets_root.mkdir(parents=True)
    for source in sources:
        for asset in source.assets:
            output = (
                assets_root
                / f"{asset.source['symbol']}{asset.source_path.suffix.lower()}"
            )
            shutil.copyfile(asset.source_path, output)
            if sha256(output) != asset.source_hash:
                raise ValueError(f"{asset.source['symbol']}: copied bytes changed")
            frame = load_frame(
                output, asset.source["symbol"], asset.source["volumeSemantics"]
            )
            first = frame["timestamp"].iloc[0].isoformat().replace("+00:00", "Z")
            last = frame["timestamp"].iloc[-1].isoformat().replace("+00:00", "Z")
            if (
                len(frame) != asset.rows
                or first != asset.first_timestamp
                or last != asset.last_timestamp
            ):
                raise ValueError(
                    f"{asset.source['symbol']}: copied observations changed"
                )


def build_audit(
    authority_path: Path,
    authority: dict[str, Any],
    sources: tuple[PreparedSource, ...],
    staging: Path,
    output: Path,
    package: dict[str, Any],
) -> dict[str, Any]:
    source_records: list[dict[str, Any]] = []
    for source in sources:
        asset_records: list[dict[str, Any]] = []
        for asset in source.assets:
            relative = (
                f"assets/{asset.source['symbol']}{asset.source_path.suffix.lower()}"
            )
            copied = staging / relative
            asset_records.append(
                {
                    "symbol": asset.source["symbol"],
                    "input": {
                        "path": asset.source["path"],
                        "sha256": asset.source_hash,
                    },
                    "output": {"path": relative, "sha256": sha256(copied)},
                    "observations": asset.rows,
                    "firstTimestamp": asset.first_timestamp,
                    "lastTimestamp": asset.last_timestamp,
                    "preservation": {
                        "bytesUnchanged": True,
                        "rowCountUnchanged": True,
                        "timestampsUnchanged": True,
                        "ohlcvValuesUnchanged": True,
                    },
                }
            )
        source_records.append(
            {
                "id": source.source_id,
                "package": {
                    "path": str(source.manifest_path),
                    "id": source.package["id"],
                    "version": source.package["version"],
                    "sha256": source.manifest_hash,
                },
                "provider": source.package["provider"],
                "assets": asset_records,
            }
        )
    package_path = staging / "dataset-package.json"
    first = sources[0].package
    return {
        "schemaVersion": 1,
        "kind": AUDIT_KIND,
        "authority": {
            "path": str(authority_path),
            "sha256": sha256(authority_path),
        },
        "compatibility": {
            "baseInterval": first["baseInterval"],
            "timestampSemantics": first["timestampSemantics"],
            "panelPolicy": first["panelPolicy"],
            "market": first["market"],
            "priceAdjustment": first["priceAdjustment"],
        },
        "composition": {
            "subset": False,
            "alignment": False,
            "fill": False,
            "transformation": False,
            "conflictResolution": False,
        },
        "sources": source_records,
        "outputPackage": {
            "path": str(output / "dataset-package.json"),
            "relativePath": "dataset-package.json",
            "id": package["id"],
            "version": package["version"],
            "schemaVersion": package["schemaVersion"],
            "sha256": sha256(package_path),
        },
        "limitations": [
            "Composition preserves complete source-package inventories and claims; it does not authenticate providers.",
            "Composition does not align, fill, subset, transform, or resolve conflicting symbols.",
            "Strict AutoQuant V6 Factor intake remains required.",
        ],
    }


def compose(authority_path: Path, output: Path) -> dict[str, Any]:
    authority_path = authority_path.expanduser().absolute()
    output = output.expanduser().absolute()
    if output.exists() or output.is_symlink():
        raise ValueError(f"output must be absent: {output}")
    authority, sources = load_authority(authority_path)
    package = build_package(authority, sources)
    require_real_output_parent(output)
    staging = output.parent / f".{output.name}.creating-{uuid.uuid4().hex}"
    if staging.exists() or staging.is_symlink():
        raise ValueError(f"transaction staging path unexpectedly exists: {staging}")
    try:
        staging.mkdir()
        write_and_verify_assets(staging, sources)
        package_path = staging / "dataset-package.json"
        package_path.write_text(
            json.dumps(package, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        audit = build_audit(
            authority_path,
            authority,
            sources,
            staging,
            output,
            package,
        )
        (staging / "composition-audit.json").write_text(
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
        "kind": "autoquant-observed-package-composition-result",
        "datasetPackage": str(output / "dataset-package.json"),
        "audit": str(output / "composition-audit.json"),
        "sources": len(sources),
        "assets": sum(len(source.assets) for source in sources),
        "observations": sum(
            asset.rows for source in sources for asset in source.assets
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compose complete strict V5 packages into one audited V6 package"
    )
    parser.add_argument("--authority", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = compose(args.authority, args.output)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
