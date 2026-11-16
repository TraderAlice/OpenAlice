"""Audit one staged AutoQuant OHLCV package without mutating its bytes."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

import pandas as pd

REQUIRED_COLUMNS = ("date", "open", "high", "low", "close", "volume")
SAFE_VERSIONS = {1, 2, 3, 4, 5, 6}
PROVIDER_KEYS = {"name", "retrievedAt", "sourceUri", "terms"}
SOURCE_KEYS = {"id", "sourcePackage", "provider"}
SOURCE_PACKAGE_KEYS = {"id", "version", "sha256"}
SAFE_SOURCE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def confined(root: Path, relative: str) -> Path:
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise ValueError(f"asset path is not a confined POSIX descendant: {relative}")
    path = root.joinpath(*pure.parts)
    if path.is_symlink():
        raise ValueError(f"asset path cannot be a symlink: {path}")
    resolved_root = root.resolve()
    resolved = path.resolve()
    if resolved_root not in resolved.parents:
        raise ValueError(f"asset path escapes manifest root: {relative}")
    if not resolved.is_file():
        raise ValueError(f"asset file is unavailable: {resolved}")
    return resolved


def load_frame(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        frame = pd.read_csv(path)
    elif suffix == ".parquet":
        frame = pd.read_parquet(path)
    elif suffix == ".feather":
        frame = pd.read_feather(path)
    else:
        raise ValueError(f"unsupported asset format: {path}")
    frame = frame.copy()
    frame.columns = [str(column).strip().lower() for column in frame.columns]
    if "date" not in frame:
        for alias in ("timestamp", "datetime", "time"):
            if alias in frame:
                frame = frame.rename(columns={alias: "date"})
                break
    missing = [column for column in REQUIRED_COLUMNS if column not in frame]
    if missing:
        raise ValueError(f"{path}: missing columns {missing}")
    frame = frame.loc[:, REQUIRED_COLUMNS]
    frame["date"] = pd.to_datetime(frame["date"], utc=True, errors="coerce")
    for column in REQUIRED_COLUMNS[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    if frame.empty or frame.isna().any().any():
        raise ValueError(f"{path}: empty, null, or unparsable OHLCV")
    if not frame["date"].is_monotonic_increasing:
        raise ValueError(f"{path}: timestamps are not increasing")
    if frame["date"].duplicated().any():
        raise ValueError(f"{path}: duplicate timestamps")
    if (frame["volume"] < 0).any():
        raise ValueError(f"{path}: negative volume")
    bad_bounds = frame["high"].lt(frame[["open", "low", "close"]].max(axis=1)) | frame[
        "low"
    ].gt(frame[["open", "high", "close"]].min(axis=1))
    if bad_bounds.any():
        raise ValueError(f"{path}: inconsistent OHLC bounds")
    return frame


def validate_provider(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != PROVIDER_KEYS:
        raise ValueError(f"{label} must contain the exact AutoQuant claim fields")
    if not isinstance(value["name"], str) or not value["name"].strip():
        raise ValueError(f"{label}.name must be non-empty")
    if not isinstance(value["terms"], str) or not value["terms"].strip():
        raise ValueError(f"{label}.terms must be non-empty")
    for key in ("retrievedAt", "sourceUri"):
        if value[key] is not None and (
            not isinstance(value[key], str) or not value[key].strip()
        ):
            raise ValueError(f"{label}.{key} must be null or non-empty")
    return value


def validate_sources(value: Any) -> tuple[list[dict[str, Any]], set[str]]:
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError("V6 sources must contain at least two claims")
    source_ids: list[str] = []
    package_hashes: list[str] = []
    providers: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict) or set(item) != SOURCE_KEYS:
            raise ValueError(f"sources[{index}] must contain exact V6 source fields")
        source_id = item.get("id")
        if not isinstance(source_id, str) or not SAFE_SOURCE_ID.fullmatch(source_id):
            raise ValueError(f"sources[{index}].id must be lowercase path-safe")
        package = item.get("sourcePackage")
        if not isinstance(package, dict) or set(package) != SOURCE_PACKAGE_KEYS:
            raise ValueError(f"sources[{index}].sourcePackage is invalid")
        for key in ("id", "version"):
            if not isinstance(package[key], str) or not package[key].strip():
                raise ValueError(f"sources[{index}].sourcePackage.{key} is empty")
        if not isinstance(package["sha256"], str) or not SHA256.fullmatch(
            package["sha256"]
        ):
            raise ValueError(f"sources[{index}].sourcePackage.sha256 is invalid")
        provider = validate_provider(item.get("provider"), f"sources[{index}].provider")
        source_ids.append(source_id)
        package_hashes.append(package["sha256"])
        providers.add(json.dumps(provider, sort_keys=True, separators=(",", ":")))
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("V6 source ids must be unique")
    if len(package_hashes) != len(set(package_hashes)):
        raise ValueError("V6 source-package hashes must be unique")
    if len(providers) < 2:
        raise ValueError("V6 requires at least two distinct provider claims")
    return value, set(source_ids)


def audit(package_path: Path) -> dict[str, Any]:
    if package_path.is_symlink() or not package_path.is_file():
        raise ValueError(f"package must be a real JSON file: {package_path}")
    package = json.loads(package_path.read_text(encoding="utf-8"))
    if not isinstance(package, dict):
        raise ValueError("package root must be an object")
    if package.get("kind") != "autoquant-ohlcv-dataset-package":
        raise ValueError("unexpected package kind")
    version = package.get("schemaVersion")
    if version not in SAFE_VERSIONS:
        raise ValueError(f"unsupported schemaVersion: {version!r}")
    provider: dict[str, Any] | None = None
    sources: list[dict[str, Any]] | None = None
    declared_source_ids: set[str] = set()
    if version == 6:
        sources, declared_source_ids = validate_sources(package.get("sources"))
        if "provider" in package:
            raise ValueError("V6 must use sources instead of one top-level provider")
    else:
        provider = validate_provider(package.get("provider"), "provider")
        if "sources" in package:
            raise ValueError("V1-V5 cannot declare V6 sources")
    assets = package.get("assets")
    if not isinstance(assets, list) or not assets:
        raise ValueError("assets must be a non-empty array")

    root = package_path.parent
    summaries: dict[str, Any] = {}
    timestamp_sets: list[set[int]] = []
    used_source_ids: set[str] = set()
    for asset in assets:
        if not isinstance(asset, dict):
            raise ValueError("asset entries must be objects")
        symbol = asset.get("symbol")
        relative = asset.get("path")
        if not isinstance(symbol, str) or not symbol:
            raise ValueError("asset symbol must be a non-empty string")
        if not isinstance(relative, str) or not relative:
            raise ValueError(f"{symbol}: asset path must be a non-empty string")
        if version == 6:
            source_id = asset.get("sourceId")
            if source_id not in declared_source_ids:
                raise ValueError(f"{symbol}: sourceId must name one declared V6 source")
            used_source_ids.add(source_id)
        path = confined(root, relative)
        frame = load_frame(path)
        timestamps = set(frame["date"].astype("int64"))
        timestamp_sets.append(timestamps)
        spacing = frame["date"].diff().dropna().dt.total_seconds()
        summaries[symbol] = {
            "path": relative,
            **({"sourceId": asset["sourceId"]} if version == 6 else {}),
            "sha256": sha256(path),
            "rows": len(frame),
            "firstTimestamp": frame["date"].iloc[0].isoformat(),
            "lastTimestamp": frame["date"].iloc[-1].isoformat(),
            "zeroVolumeRows": int(frame["volume"].eq(0).sum()),
            "minimumSpacingSeconds": (
                float(spacing.min()) if not spacing.empty else None
            ),
            "maximumSpacingSeconds": (
                float(spacing.max()) if not spacing.empty else None
            ),
        }
    if len(summaries) != len(assets):
        raise ValueError("asset symbols must be unique")
    if version == 6 and used_source_ids != declared_source_ids:
        raise ValueError("every V6 source must own at least one asset")
    union = set.union(*timestamp_sets)
    intersection = set.intersection(*timestamp_sets)
    return {
        "schemaVersion": 1,
        "kind": "autoquant-ohlcv-package-audit",
        "package": str(package_path),
        "packageSha256": sha256(package_path),
        "datasetId": package.get("id"),
        "datasetSchemaVersion": version,
        "priceAdjustment": package.get("priceAdjustment"),
        **({"sources": sources} if version == 6 else {"provider": provider}),
        "assets": summaries,
        "panel": {
            "unionTimestamps": len(union),
            "intersectionTimestamps": len(intersection),
            "fullyAligned": len(union) == len(intersection),
        },
        "limitations": [
            "This audit checks files and basic OHLCV invariants, not provider truth.",
            "Strict aq project intake or atomic aq study create intake remains required.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--write-audit", type=Path)
    args = parser.parse_args()
    result = audit(args.package.expanduser().absolute())
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.write_audit:
        output = args.write_audit.expanduser().absolute()
        if output.exists() or output.is_symlink():
            parser.error(f"--write-audit target already exists: {output}")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
