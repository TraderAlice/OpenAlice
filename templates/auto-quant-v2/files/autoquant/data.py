"""OHLCV dataset ingestion, manifest management, and OpenAlice market bar bridge."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any

import pandas as pd

from .panel import PANEL_COLUMNS, format_timestamps, normalize_ohlcv, validate_panel
from .workspace import (
    DATA_MANIFEST_REL,
    SCHEMA_VERSION,
    AutoQuantError,
    AutoQuantValidationError,
    ProjectContext,
    atomic_write_json,
    confined_path,
    read_json_object,
    resolve_project,
    utc_now_iso,
)


DATASET_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")
SUPPORTED_FORMATS = frozenset({"csv", "parquet"})


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_dataset_id(dataset_id: str) -> str:
    if not isinstance(dataset_id, str) or not DATASET_ID_PATTERN.fullmatch(dataset_id.strip()):
        raise AutoQuantValidationError(
            f"Invalid dataset_id {dataset_id!r}; expected slug matching {DATASET_ID_PATTERN.pattern}"
        )
    return dataset_id.strip()


def load_data_manifest(project: str | Path | ProjectContext) -> dict[str, Any]:
    """Load `<project>/data/manifest.json` or return an empty v1 manifest."""

    ctx = resolve_project(project)
    manifest_path = confined_path(ctx.root_dir, DATA_MANIFEST_REL)
    if not manifest_path.exists() and not manifest_path.is_symlink():
        return {"schema_version": SCHEMA_VERSION, "datasets": {}}
    raw = read_json_object(manifest_path, DATA_MANIFEST_REL)
    if raw.get("schema_version") != SCHEMA_VERSION:
        raise AutoQuantValidationError(
            f"{DATA_MANIFEST_REL} schema_version must be {SCHEMA_VERSION}"
        )
    datasets = raw.get("datasets")
    if not isinstance(datasets, dict):
        raise AutoQuantValidationError(f"{DATA_MANIFEST_REL} datasets must be an object")
    return {"schema_version": SCHEMA_VERSION, "datasets": dict(datasets)}


def list_datasets(
    project: str | Path | ProjectContext,
    *,
    project_id: str | None = None,
) -> list[dict[str, Any]]:
    """Return ingested datasets in `<project>/data/manifest.json` sorted by ID."""

    ctx = resolve_project(project, project_id=project_id)
    manifest = load_data_manifest(ctx)
    return [manifest["datasets"][key] for key in sorted(manifest["datasets"])]


def get_dataset_entry(
    project: str | Path | ProjectContext,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Resolve one dataset entry from `<project>/data/manifest.json`."""

    ctx = resolve_project(project)
    datasets = load_data_manifest(ctx)["datasets"]
    if not datasets:
        raise AutoQuantValidationError(
            f"Project {ctx.id!r} has no ingested datasets; call aq.ingest_ohlcv(...) "
            "or `aq data ingest` first"
        )
    if dataset_id is not None:
        if dataset_id not in datasets:
            available = ", ".join(sorted(datasets))
            raise AutoQuantValidationError(
                f"Dataset {dataset_id!r} not found in project {ctx.id!r} (available: {available})"
            )
        return dict(datasets[dataset_id])

    if len(datasets) == 1:
        return dict(next(iter(datasets.values())))
    if "ohlcv" in datasets:
        return dict(datasets["ohlcv"])

    available = ", ".join(sorted(datasets))
    raise AutoQuantValidationError(
        f"Project {ctx.id!r} has multiple datasets ({available}); specify dataset_id explicitly"
    )


def _read_tabular_file(path: Path) -> pd.DataFrame:
    if path.is_symlink():
        raise AutoQuantValidationError(f"Source data file cannot be a symlink: {path}")
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in {".parquet", ".pq"}:
        try:
            return pd.read_parquet(path)
        except ImportError as exc:
            raise AutoQuantError(
                "Reading Parquet requires pyarrow (`uv sync --extra columnar`)"
            ) from exc
    raise AutoQuantValidationError(
        f"Unsupported OHLCV file extension {suffix!r} for {path}; expected .csv or .parquet"
    )


def _has_asset_column(df: pd.DataFrame) -> bool:
    lowered = {str(col).strip().lower() for col in df.columns}
    return bool(lowered & {"asset", "symbol", "ticker", "instrument"})


def _load_source_to_panel(
    source_path_or_df: str | Path | pd.DataFrame,
    *,
    symbol: str | None = None,
    calendar: str | Mapping[str, str] | None = None,
) -> tuple[pd.DataFrame, str | None]:
    """Load DataFrame, single file, or directory of per-symbol files into a Panel."""

    if isinstance(source_path_or_df, pd.DataFrame):
        return (
            normalize_ohlcv(source_path_or_df, symbol=symbol, sort=True, calendar=calendar),
            None,
        )

    src = Path(source_path_or_df).expanduser().resolve()
    if not src.exists():
        raise AutoQuantValidationError(f"OHLCV source path does not exist: {src}")

    if src.is_file():
        raw = _read_tabular_file(src)
        inferred_symbol = symbol
        if inferred_symbol is None and not _has_asset_column(raw):
            inferred_symbol = src.stem
        return (
            normalize_ohlcv(raw, symbol=inferred_symbol, sort=True, calendar=calendar),
            None,
        )

    if src.is_dir():
        inferred_interval: str | None = None
        symbol_by_relpath: dict[str, str] = {}
        pkg_json = src / "dataset-package.json"
        search_dir = src
        if pkg_json.is_file():
            try:
                pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
                if isinstance(pkg, dict):
                    if isinstance(pkg.get("interval"), str):
                        inferred_interval = pkg["interval"]
                    for asset_entry in pkg.get("assets", []):
                        if isinstance(asset_entry, dict) and asset_entry.get("path") and asset_entry.get("symbol"):
                            symbol_by_relpath[str(asset_entry["path"])] = str(asset_entry["symbol"])
            except (OSError, json.JSONDecodeError):
                pass
            if (src / "bars").is_dir():
                search_dir = src / "bars"

        data_files = sorted(
            p
            for p in search_dir.iterdir()
            if p.is_file() and not p.is_symlink() and p.suffix.lower() in {".csv", ".parquet", ".pq"}
        )
        if not data_files:
            raise AutoQuantValidationError(
                f"No .csv or .parquet OHLCV files found in directory: {src}"
            )
        frames: list[pd.DataFrame] = []
        for file_path in data_files:
            raw = _read_tabular_file(file_path)
            rel = file_path.relative_to(src).as_posix()
            sym = symbol_by_relpath.get(rel) or (None if _has_asset_column(raw) else file_path.stem)
            if sym is not None and not _has_asset_column(raw):
                raw = raw.copy()
                raw["asset"] = sym
            frames.append(raw)
        combined = pd.concat(frames, ignore_index=True)
        return (
            normalize_ohlcv(combined, symbol=symbol, sort=True, calendar=calendar),
            inferred_interval,
        )

    raise AutoQuantValidationError(f"Unsupported OHLCV source: {src}")


def ingest_ohlcv(
    project: str | Path | ProjectContext,
    source_path_or_df: str | Path | pd.DataFrame,
    *,
    dataset_id: str = "ohlcv",
    interval: str = "1d",
    source: str = "local",
    format: str = "csv",
    symbol: str | None = None,
    calendar: str | Mapping[str, str] | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Validate, normalize, and snapshot OHLCV bars into `<project>/data/`."""

    ctx = resolve_project(project, project_id=project_id)
    ds_id = validate_dataset_id(dataset_id)
    fmt = format.strip().lower()
    if fmt not in SUPPORTED_FORMATS:
        raise AutoQuantValidationError(
            f"Unsupported storage format {format!r}; expected 'csv' or 'parquet'"
        )
    if not isinstance(interval, str) or not interval.strip():
        raise AutoQuantValidationError("interval must be a non-empty string (e.g. '1d', '1h')")

    panel, pkg_interval = _load_source_to_panel(
        source_path_or_df,
        symbol=symbol,
        calendar=calendar,
    )
    effective_interval = pkg_interval if (interval == "1d" and pkg_interval) else interval.strip()

    ctx.data_dir.mkdir(parents=True, exist_ok=True)
    rel_file = f"data/{ds_id}.{fmt}"
    dest_path = confined_path(ctx.root_dir, rel_file)

    serializable = panel.loc[:, list(PANEL_COLUMNS)].copy()
    ts_strings = format_timestamps(pd.DatetimeIndex(serializable["timestamp"]))

    if fmt == "csv":
        csv_frame = serializable.copy()
        csv_frame["timestamp"] = ts_strings
        tmp_dest = dest_path.with_name(f".{dest_path.name}.tmp")
        try:
            csv_frame.to_csv(tmp_dest, index=False)
            tmp_dest.replace(dest_path)
        finally:
            tmp_dest.unlink(missing_ok=True)
    else:
        try:
            tmp_dest = dest_path.with_name(f".{dest_path.name}.tmp")
            try:
                serializable.to_parquet(tmp_dest, index=False)
                tmp_dest.replace(dest_path)
            finally:
                tmp_dest.unlink(missing_ok=True)
        except ImportError as exc:
            raise AutoQuantError(
                "Writing Parquet requires pyarrow (`uv sync --extra columnar`)"
            ) from exc

    file_hash = _sha256_file(dest_path)
    symbols_sorted = sorted(panel["asset"].unique().tolist())
    entry = {
        "id": ds_id,
        "path": rel_file,
        "format": fmt,
        "sha256": file_hash,
        "symbols": symbols_sorted,
        "interval": effective_interval,
        "start": ts_strings[0],
        "end": ts_strings[-1],
        "rows": int(len(panel)),
        "source": str(source).strip() or "local",
        "ingested_at": utc_now_iso(),
    }

    manifest = load_data_manifest(ctx)
    manifest["datasets"][ds_id] = entry
    atomic_write_json(confined_path(ctx.root_dir, DATA_MANIFEST_REL), manifest)
    return entry


def read_dataset_panel(
    project: str | Path | ProjectContext,
    dataset_id: str | None = None,
    *,
    calendar: str | Mapping[str, str] | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Read and verify integrity of a stored dataset snapshot from `<project>/data/`."""

    ctx = resolve_project(project)
    entry = get_dataset_entry(ctx, dataset_id=dataset_id)
    data_path = confined_path(ctx.root_dir, entry["path"])
    if not data_path.is_file():
        raise AutoQuantValidationError(
            f"Dataset snapshot file is missing: {data_path}"
        )
    expected_sha = entry.get("sha256")
    if isinstance(expected_sha, str) and expected_sha:
        actual_sha = _sha256_file(data_path)
        if actual_sha != expected_sha:
            raise AutoQuantValidationError(
                f"Dataset {entry['id']!r} SHA-256 mismatch (expected {expected_sha}, got {actual_sha})"
            )

    raw = _read_tabular_file(data_path)
    panel = validate_panel(raw, calendar=calendar)
    return panel, entry


def _symbol_from_bar_id(bar_id: str, meta: dict[str, Any] | None) -> str:
    if isinstance(meta, dict) and isinstance(meta.get("symbol"), str) and meta["symbol"].strip():
        return meta["symbol"].strip()
    if "|" in bar_id:
        _, right = bar_id.split("|", 1)
        if right.strip():
            return right.strip()
    return bar_id.strip()


def fetch_alice_bars(
    bar_ids: str | Sequence[str],
    *,
    interval: str = "1d",
    count: int | None = 1000,
    start: str | None = None,
    end: str | None = None,
    asset_class: str | None = None,
    symbols: Mapping[str, str] | None = None,
    alice_bin: str = "alice",
    timeout: int = 60,
) -> pd.DataFrame:
    """Fetch OHLCV bars via `alice market bars` CLI and return a normalized long Panel."""

    ids = [bar_ids] if isinstance(bar_ids, str) else list(bar_ids)
    cleaned_ids = [str(item).strip() for item in ids if str(item).strip()]
    if not cleaned_ids:
        raise AutoQuantValidationError("bar_ids must contain at least one non-empty barId")

    exe = shutil.which(alice_bin)
    if exe is None:
        candidate = Path(alice_bin)
        if candidate.is_file():
            exe = str(candidate)
        else:
            raise AutoQuantError(
                f"{alice_bin!r} CLI was not found on PATH; run inside an OpenAlice Workspace "
                "or ingest local CSV/Parquet files via aq.ingest_ohlcv(...)"
            )

    frames: list[pd.DataFrame] = []
    for bar_id in cleaned_ids:
        cmd = [exe, "market", "bars", "--bar-id", bar_id, "--interval", interval]
        if asset_class:
            cmd.extend(["--asset-class", asset_class])
        if start:
            cmd.extend(["--start", str(start)])
        if end:
            cmd.extend(["--end", str(end)])
        if count is not None and not (start and end):
            cmd.extend(["--count", str(int(count))])

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                check=False,
                text=True,
                timeout=timeout,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise AutoQuantError(f"Failed executing `alice market bars` for {bar_id!r}: {exc}") from exc

        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip()
            raise AutoQuantError(
                f"`alice market bars` exited with code {proc.returncode} for {bar_id!r}: {detail}"
            )

        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise AutoQuantError(
                f"`alice market bars` returned non-JSON output for {bar_id!r}: {exc}"
            ) from exc

        meta: dict[str, Any] | None = None
        if isinstance(payload, list):
            bars = payload
        elif isinstance(payload, dict):
            meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else None
            if isinstance(payload.get("bars"), list):
                bars = payload["bars"]
            elif isinstance(payload.get("data"), dict) and isinstance(payload["data"].get("bars"), list):
                bars = payload["data"]["bars"]
                if meta is None and isinstance(payload["data"].get("meta"), dict):
                    meta = payload["data"]["meta"]
            else:
                raise AutoQuantError(
                    f"`alice market bars` response for {bar_id!r} lacked a 'bars' array"
                )
        else:
            raise AutoQuantError(f"Unexpected `alice market bars` JSON type for {bar_id!r}")

        if not bars:
            raise AutoQuantError(f"`alice market bars` returned 0 bars for {bar_id!r}")

        asset_symbol = (
            symbols[bar_id]
            if symbols is not None and bar_id in symbols
            else _symbol_from_bar_id(bar_id, meta)
        )
        raw_df = pd.DataFrame(bars)
        raw_df["asset"] = asset_symbol
        frames.append(raw_df)

    combined = pd.concat(frames, ignore_index=True)
    return normalize_ohlcv(combined, sort=True)
