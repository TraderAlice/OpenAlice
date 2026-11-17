"""Immutable Run ledger (`<project_id>/runs/<run_id>/`) and multi-run comparison."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import secrets
import shutil
import threading
from typing import Any

import pandas as pd

from .panel import format_timestamps
from .version import resolve_provenance
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    atomic_write_json,
    confined_path,
    read_json_object,
    resolve_project,
    sanitize_json_value,
    utc_now_iso,
)


RUN_ID_PATTERN = re.compile(r"^run-\d{8}T\d{6}\d{6}Z-[0-9a-f]{8}$")
SAFE_ARTIFACT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
VALID_RUN_KINDS = frozenset({"factor", "backtest", "custom"})
VALID_SPLITS = frozenset({"train", "val", "holdout", "in_sample"})
VALID_ARTIFACT_KINDS = frozenset({"chart", "table", "markdown", "svg", "file"})

EQUITY_REQUIRED_COLUMNS = (
    "timestamp",
    "equity",
    "returns",
    "drawdown",
    "turnover",
    "gross_exposure",
    "net_exposure",
)
IC_REQUIRED_COLUMNS = ("timestamp", "ic", "rank_ic")


class _HoldoutCaptureState(threading.local):
    active: bool = False
    captured_kwargs: dict[str, Any] | None = None


_HOLDOUT_CAPTURE = _HoldoutCaptureState()


def generate_run_id(now: datetime | None = None) -> str:
    """Generate a unique chronological `run-<YYYYMMDDTHHMMSSffffffZ>-<8hex>` ID."""

    ts = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    stamp = ts.strftime("%Y%m%dT%H%M%S%fZ")
    return f"run-{stamp}-{secrets.token_hex(4)}"


def validate_run_id(run_id: str) -> str:
    if not isinstance(run_id, str) or not RUN_ID_PATTERN.fullmatch(run_id):
        raise AutoQuantValidationError(
            f"Invalid run_id {run_id!r}; expected format run-<YYYYMMDDTHHMMSSffffffZ>-<8hex>"
        )
    return run_id


def sanitize_metrics(metrics: Mapping[str, Any]) -> dict[str, float]:
    """Keep finite numeric metrics as Python floats."""

    if not isinstance(metrics, Mapping):
        raise AutoQuantValidationError("metrics must be a mapping of metric_name -> float")
    clean: dict[str, float] = {}
    for key, val in metrics.items():
        if val is None or isinstance(val, bool):
            continue
        try:
            num = float(val)
        except (TypeError, ValueError):
            continue
        if math.isfinite(num):
            clean[str(key)] = num
    return clean


def _infer_artifact_kind(filename: str, content_obj: Any = None) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".svg":
        return "svg"
    if suffix in {".md", ".markdown"}:
        return "markdown"
    if suffix == ".csv":
        return "table"
    if suffix == ".json":
        if isinstance(content_obj, Mapping):
            t = str(content_obj.get("type", "")).lower()
            if t == "table":
                return "table"
            if t in {"line", "bar", "chart", "scatter"}:
                return "chart"
        return "chart"
    return "file"


def _write_artifacts(
    staging_dir: Path,
    artifacts: Sequence[Any] | Mapping[str, Any] | None,
) -> list[dict[str, str]]:
    if not artifacts:
        return []

    artifacts_dir = staging_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    manifest_entries: list[dict[str, str]] = []
    seen_names: set[str] = set()

    items: list[Any]
    if isinstance(artifacts, Mapping):
        items = [{"name": k, "content": v} for k, v in artifacts.items()]
    elif isinstance(artifacts, Sequence) and not isinstance(artifacts, (str, bytes)):
        items = list(artifacts)
    else:
        raise AutoQuantValidationError("artifacts must be a list or dict")

    for raw_item in items:
        src_path: Path | None = None
        inline_content: Any = None
        has_inline = False
        explicit_kind: str | None = None

        if isinstance(raw_item, (str, Path)):
            src_path = Path(raw_item).expanduser()
            file_name = src_path.name
            display_name = src_path.name
        elif isinstance(raw_item, Mapping):
            raw_path = raw_item.get("source") or raw_item.get("path")
            if "content" in raw_item or "data" in raw_item:
                has_inline = True
                inline_content = raw_item.get("content", raw_item.get("data"))
            if raw_path is not None and not has_inline:
                src_path = Path(str(raw_path)).expanduser()
            elif isinstance(inline_content, Path):
                src_path = inline_content.expanduser()
                has_inline = False
                inline_content = None
            raw_name = raw_item.get("name") or (src_path.name if src_path is not None else None)
            if not raw_name:
                raise AutoQuantValidationError("Artifact entry requires 'name' or file 'path'")
            file_name = Path(str(raw_name)).name
            display_name = str(raw_item.get("name") or file_name)
            if raw_item.get("kind") is not None:
                explicit_kind = str(raw_item["kind"])
        else:
            raise AutoQuantValidationError(f"Unsupported artifact specification: {raw_item!r}")

        if not SAFE_ARTIFACT_NAME.fullmatch(file_name) or file_name in {".", ".."}:
            raise AutoQuantValidationError(f"Unsafe artifact filename: {file_name!r}")
        if file_name in seen_names:
            raise AutoQuantValidationError(f"Duplicate artifact filename: {file_name!r}")
        seen_names.add(file_name)

        dest = artifacts_dir / file_name
        parsed_json_hint: Any = None
        if src_path is not None:
            if src_path.is_symlink() or not src_path.is_file():
                raise AutoQuantValidationError(
                    f"Artifact source must be an existing regular file: {src_path}"
                )
            shutil.copyfile(src_path, dest)
            if file_name.lower().endswith(".json"):
                try:
                    parsed_json_hint = json.loads(dest.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    parsed_json_hint = None
        elif has_inline:
            if isinstance(inline_content, bytes):
                dest.write_bytes(inline_content)
            elif isinstance(inline_content, str):
                dest.write_text(inline_content, encoding="utf-8")
            elif isinstance(inline_content, pd.DataFrame):
                inline_content.to_csv(dest, index=False)
            else:
                parsed_json_hint = inline_content
                atomic_write_json(dest, dict(inline_content) if isinstance(inline_content, Mapping) else {"data": inline_content})
        else:
            raise AutoQuantValidationError(f"Artifact {display_name!r} has neither source path nor content")

        kind = explicit_kind or _infer_artifact_kind(file_name, parsed_json_hint)
        if kind not in VALID_ARTIFACT_KINDS:
            raise AutoQuantValidationError(
                f"Invalid artifact kind {kind!r}; expected one of {sorted(VALID_ARTIFACT_KINDS)}"
            )
        manifest_entries.append(
            {
                "name": display_name,
                "path": f"artifacts/{file_name}",
                "kind": kind,
            }
        )
    return manifest_entries


def _write_equity_series(series_dir: Path, equity_df: pd.DataFrame) -> str:
    missing = [c for c in EQUITY_REQUIRED_COLUMNS if c not in equity_df.columns]
    if missing:
        raise AutoQuantValidationError(f"equity_df missing required columns: {missing}")
    cols = list(EQUITY_REQUIRED_COLUMNS)
    if "benchmark_equity" in equity_df.columns:
        cols.append("benchmark_equity")
    out = equity_df.loc[:, cols].copy()
    if isinstance(out["timestamp"].dtype, pd.DatetimeTZDtype) or pd.api.types.is_datetime64_any_dtype(out["timestamp"]):
        out["timestamp"] = format_timestamps(pd.DatetimeIndex(out["timestamp"]))
    series_dir.mkdir(parents=True, exist_ok=True)
    out.to_csv(series_dir / "equity.csv", index=False)
    return "series/equity.csv"


def _write_ic_series(series_dir: Path, ic_df: pd.DataFrame) -> str:
    missing = [c for c in IC_REQUIRED_COLUMNS if c not in ic_df.columns]
    if missing:
        raise AutoQuantValidationError(f"ic_df missing required columns: {missing}")
    out = ic_df.loc[:, list(IC_REQUIRED_COLUMNS)].copy()
    if isinstance(out["timestamp"].dtype, pd.DatetimeTZDtype) or pd.api.types.is_datetime64_any_dtype(out["timestamp"]):
        out["timestamp"] = format_timestamps(pd.DatetimeIndex(out["timestamp"]))
    series_dir.mkdir(parents=True, exist_ok=True)
    out.to_csv(series_dir / "ic.csv", index=False)
    return "series/ic.csv"


def record_run(
    project: str | Path | ProjectContext,
    *,
    kind: str = "custom",
    name: str = "run",
    split: str = "val",
    metrics: Mapping[str, Any] | None = None,
    hypothesis: str = "",
    parameters: Mapping[str, Any] | None = None,
    dataset: Mapping[str, Any] | None = None,
    code_paths: str | Path | Iterable[str | Path] | None = None,
    equity_df: pd.DataFrame | None = None,
    ic_df: pd.DataFrame | None = None,
    quantiles_payload: Mapping[str, Any] | None = None,
    artifacts: Sequence[Any] | Mapping[str, Any] | None = None,
    notes: str = "",
    run_id: str | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Write an immutable Run bundle under `<project_id>/runs/<run_id>/`."""

    if kind not in VALID_RUN_KINDS:
        raise AutoQuantValidationError(
            f"Invalid run kind {kind!r}; expected one of {sorted(VALID_RUN_KINDS)}"
        )
    if split not in VALID_SPLITS:
        raise AutoQuantValidationError(
            f"Invalid split {split!r}; expected one of {sorted(VALID_SPLITS)}"
        )
    if not isinstance(name, str) or not name.strip():
        raise AutoQuantValidationError("Run name must be a non-empty string")

    if getattr(_HOLDOUT_CAPTURE, "active", False):
        _HOLDOUT_CAPTURE.captured_kwargs = {
            "kind": kind,
            "name": name.strip(),
            "metrics": sanitize_metrics(metrics or {}),
            "hypothesis": hypothesis,
            "parameters": dict(parameters or {}),
            "dataset": dict(dataset) if isinstance(dataset, Mapping) else None,
            "code_paths": code_paths,
            "equity_df": equity_df,
            "ic_df": ic_df,
            "quantiles_payload": dict(quantiles_payload) if isinstance(quantiles_payload, Mapping) else None,
            "artifacts": artifacts,
            "notes": notes,
        }
        return {
            "schema_version": SCHEMA_VERSION,
            "id": "pending-holdout-run",
            "kind": kind,
            "name": name.strip(),
            "split": "holdout",
            "metrics": sanitize_metrics(metrics or {}),
        }

    ctx = resolve_project(project, project_id=project_id)
    rid = validate_run_id(run_id) if run_id is not None else generate_run_id()
    ctx.runs_dir.mkdir(parents=True, exist_ok=True)
    final_dir = confined_path(ctx.runs_dir, rid)
    if final_dir.exists() or final_dir.is_symlink():
        raise AutoQuantValidationError(f"Immutable run directory already exists: {final_dir}")

    clean_params = sanitize_json_value(dict(parameters or {}))
    clean_metrics = sanitize_metrics(metrics or {})
    clean_dataset = sanitize_json_value(dict(dataset)) if isinstance(dataset, Mapping) else None

    fallback_bytes = json.dumps(
        {"kind": kind, "name": name.strip(), "parameters": clean_params},
        sort_keys=True,
    ).encode("utf-8")
    provenance = resolve_provenance(
        code_paths=code_paths,
        cwd=ctx.workspace_dir or ctx.root_dir,
        fallback_payload=fallback_bytes,
    )

    staging_dir = ctx.runs_dir / f".staging-{rid}-{secrets.token_hex(3)}"
    staging_dir.mkdir(parents=True, exist_ok=False)
    try:
        series_files: dict[str, str] = {}
        series_dir = staging_dir / "series"
        if equity_df is not None and not equity_df.empty:
            series_files["equity"] = _write_equity_series(series_dir, equity_df)
        if ic_df is not None and not ic_df.empty:
            series_files["ic"] = _write_ic_series(series_dir, ic_df)
        if quantiles_payload is not None:
            series_dir.mkdir(parents=True, exist_ok=True)
            atomic_write_json(series_dir / "quantiles.json", dict(quantiles_payload))
            series_files["quantiles"] = "series/quantiles.json"

        artifact_entries = _write_artifacts(staging_dir, artifacts)

        run_payload: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "id": rid,
            "project_id": ctx.id,
            "kind": kind,
            "name": name.strip(),
            "split": split,
            "created_at": utc_now_iso(),
            "hypothesis": str(hypothesis or ""),
            "parameters": clean_params,
            "dataset": clean_dataset,
            "provenance": provenance,
            "metrics": clean_metrics,
            "series_files": series_files,
            "artifacts": artifact_entries,
            "notes": str(notes or ""),
        }
        atomic_write_json(staging_dir / "run.json", run_payload)
        staging_dir.rename(final_dir)
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise

    return load_run(ctx, rid)


def load_run(
    project: str | Path | ProjectContext,
    run_id: str,
    *,
    include_series: bool = False,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Load an immutable `run.json` (and optional series data) from `<project>/runs/`."""

    ctx = resolve_project(project, project_id=project_id)
    validate_run_id(run_id)
    run_dir = confined_path(ctx.runs_dir, run_id)
    if not run_dir.is_dir():
        raise AutoQuantValidationError(f"Run {run_id!r} not found in project {ctx.id!r}")
    manifest = read_json_object(confined_path(run_dir, "run.json"), "run.json")
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise AutoQuantValidationError(f"Unsupported run.json schema_version in {run_id!r}")
    if manifest.get("id") != run_id:
        raise AutoQuantValidationError(f"run.json id mismatch inside {run_dir}")

    if include_series:
        series_data: dict[str, Any] = {}
        series_files = manifest.get("series_files") or {}
        if isinstance(series_files, Mapping):
            if "equity" in series_files:
                eq_path = confined_path(run_dir, str(series_files["equity"]))
                if eq_path.is_file():
                    series_data["equity"] = pd.read_csv(eq_path).to_dict(orient="records")
            if "ic" in series_files:
                ic_path = confined_path(run_dir, str(series_files["ic"]))
                if ic_path.is_file():
                    series_data["ic"] = pd.read_csv(ic_path).to_dict(orient="records")
            if "quantiles" in series_files:
                q_path = confined_path(run_dir, str(series_files["quantiles"]))
                if q_path.is_file():
                    series_data["quantiles"] = read_json_object(q_path, "quantiles.json")
        manifest = dict(manifest)
        manifest["series"] = series_data
    return manifest


def list_runs(
    project: str | Path | ProjectContext,
    *,
    split: str | None = None,
    kind: str | None = None,
    project_id: str | None = None,
) -> list[dict[str, Any]]:
    """List immutable Runs in `<project>/runs/` sorted newest-first."""

    ctx = resolve_project(project, project_id=project_id)
    if not ctx.runs_dir.exists():
        return []
    runs: list[dict[str, Any]] = []
    for entry in ctx.runs_dir.iterdir():
        if entry.name.startswith("."):
            continue
        if entry.is_symlink():
            raise AutoQuantValidationError(f"Run directory cannot be a symlink: {entry}")
        if not entry.is_dir() or not RUN_ID_PATTERN.fullmatch(entry.name):
            continue
        run_json = entry / "run.json"
        if not run_json.exists() and not run_json.is_symlink():
            continue
        item = load_run(ctx, entry.name)
        if split is not None and item.get("split") != split:
            continue
        if kind is not None and item.get("kind") != kind:
            continue
        runs.append(item)

    runs.sort(key=lambda r: (str(r.get("created_at", "")), str(r.get("id", ""))), reverse=True)
    return runs


def compare_runs(
    project: str | Path | ProjectContext,
    run_ids: Sequence[str] | None = None,
    *,
    split: str | None = None,
    kind: str | None = None,
    sort_by: str = "sharpe",
    project_id: str | None = None,
) -> dict[str, Any]:
    """Compare selected or all Runs side-by-side with holdout audit context."""

    ctx = resolve_project(project, project_id=project_id)
    if run_ids:
        selected = [load_run(ctx, rid) for rid in run_ids]
        if split is not None:
            selected = [r for r in selected if r.get("split") == split]
        if kind is not None:
            selected = [r for r in selected if r.get("kind") == kind]
    else:
        selected = list_runs(ctx, split=split, kind=kind)

    if sort_by == "created_at":
        selected.sort(key=lambda r: (str(r.get("created_at", "")), str(r.get("id", ""))), reverse=True)
    else:
        def _sort_key(run: dict[str, Any]) -> tuple[int, float, str]:
            val = (run.get("metrics") or {}).get(sort_by)
            if isinstance(val, (int, float)) and math.isfinite(val):
                return (1, float(val), str(run.get("id", "")))
            return (0, float("-inf"), str(run.get("id", "")))

        selected.sort(key=_sort_key, reverse=True)

    rows = [
        {
            "id": r["id"],
            "name": r["name"],
            "kind": r["kind"],
            "split": r["split"],
            "created_at": r["created_at"],
            "hypothesis": r.get("hypothesis", ""),
            "metrics": dict(r.get("metrics") or {}),
            "parameters": dict(r.get("parameters") or {}),
            "git_commit": (r.get("provenance") or {}).get("git_commit", "unavailable"),
        }
        for r in selected
    ]
    return {
        "project_id": ctx.id,
        "splits": dict(ctx.splits),
        "holdout_audit": dict(ctx.holdout_audit),
        "sort_by": sort_by,
        "count": len(rows),
        "runs": rows,
    }
