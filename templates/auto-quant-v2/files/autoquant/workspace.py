"""Workspace, Project, split boundary, and path-confinement primitives."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import tempfile
from typing import Any

import pandas as pd

SCHEMA_VERSION = 1
WORKSPACE_MANIFEST = "autoquant-workspace.json"
WORKSPACE_LOCAL_MANIFEST = "autoquant-workspace.local.json"
PROJECT_MANIFEST = "project.json"
RESEARCH_BRIEF_FILE = "research.md"
DATA_MANIFEST_REL = "data/manifest.json"
PROJECT_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATE_ONLY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class AutoQuantError(ValueError):
    """Base error for AutoQuant operations."""


class AutoQuantValidationError(AutoQuantError):
    """Raised when workspace, project, panel, or split invariants fail."""


class HoldoutLockedError(AutoQuantValidationError):
    """Raised when attempting to access holdout bars without audited unlock."""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sanitize_json_value(value: Any) -> Any:
    """Convert numpy/pandas scalars and strip non-finite floats for strict JSON."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "item") and callable(value.item):
        try:
            return sanitize_json_value(value.item())
        except (ValueError, TypeError):
            pass
    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        ts = value.tz_convert("UTC") if value.tzinfo is not None else value.tz_localize("UTC")
        fmt = "%Y-%m-%d" if (ts.hour == 0 and ts.minute == 0 and ts.second == 0 and ts.nanosecond == 0) else "%Y-%m-%dT%H:%M:%SZ"
        return ts.strftime(fmt)
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, dict):
        return {str(k): sanitize_json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_json_value(item) for item in value]
    return str(value)


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    """Atomically write strict JSON (no NaN/Infinity) to `path`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    clean_payload = sanitize_json_value(payload)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as handle:
            json.dump(clean_payload, handle, indent=2, allow_nan=False)
            handle.write("\n")
            tmp_path = Path(handle.name)
        os.replace(tmp_path, path)
        tmp_path = None
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


def read_json_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink():
        raise AutoQuantValidationError(f"{label} cannot be a symlink: {path}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AutoQuantValidationError(f"{label} does not exist: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise AutoQuantValidationError(f"{label} is invalid JSON: {path}") from exc
    if not isinstance(raw, dict):
        raise AutoQuantValidationError(f"{label} must be a JSON object: {path}")
    return raw


def confined_path(root: str | Path, relative_path: str | Path) -> Path:
    """Resolve `relative_path` strictly inside `root` rejecting `..` and symlinks."""
    base = Path(root).expanduser().absolute()
    if base.is_symlink():
        raise AutoQuantValidationError(f"Root directory cannot be a symlink: {base}")
    base_resolved = base.resolve()

    raw_str = str(relative_path)
    if not raw_str or "\x00" in raw_str:
        raise AutoQuantValidationError(f"Invalid relative path: {relative_path!r}")
    rel = Path(raw_str)
    if rel.is_absolute() or any(part in {"", ".", ".."} for part in rel.parts):
        raise AutoQuantValidationError(f"Unsafe or non-relative path rejected: {relative_path}")

    current = base
    for part in rel.parts:
        current = current / part
        if current.is_symlink():
            raise AutoQuantValidationError(f"Symlink escape rejected inside {base_resolved}: {current}")
    try:
        current.resolve().relative_to(base_resolved)
    except ValueError as exc:
        raise AutoQuantValidationError(f"Path escapes confinement root {base_resolved}: {relative_path}") from exc
    return current


def validate_project_id(project_id: str) -> str:
    if not isinstance(project_id, str) or not PROJECT_ID_PATTERN.fullmatch(project_id):
        raise AutoQuantValidationError(
            f"Invalid project_id {project_id!r}; expected lowercase slug matching {PROJECT_ID_PATTERN.pattern}"
        )
    return project_id


def parse_split_end(bound: str) -> pd.Timestamp:
    """Parse an inclusive split upper bound (`YYYY-MM-DD` includes end-of-day UTC)."""
    if not isinstance(bound, str) or not bound.strip():
        raise AutoQuantValidationError(f"Split boundary must be a non-empty string, got {bound!r}")
    text = bound.strip()
    try:
        if DATE_ONLY_PATTERN.fullmatch(text):
            day = pd.Timestamp(text, tz="UTC")
            if pd.isna(day):
                raise ValueError(text)
            return day + pd.Timedelta(days=1) - pd.Timedelta(nanoseconds=1)
        ts = pd.Timestamp(text)
        if pd.isna(ts):
            raise ValueError(text)
    except ValueError as exc:
        raise AutoQuantValidationError(f"Invalid split timestamp {bound!r}") from exc
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")


def validate_splits_dict(splits: dict[str, Any] | None) -> dict[str, str | None]:
    if splits is None:
        return {"train_end": None, "val_end": None, "holdout_end": None}
    if not isinstance(splits, dict):
        raise AutoQuantValidationError("splits must be an object")
    extra = set(splits) - {"train_end", "val_end", "holdout_end"}
    if extra:
        raise AutoQuantValidationError(f"Unknown split keys: {sorted(extra)}")

    normalized: dict[str, str | None] = {}
    parsed: dict[str, pd.Timestamp] = {}
    for key in ("train_end", "val_end", "holdout_end"):
        val = splits.get(key)
        if val is None or val == "":
            normalized[key] = None
        elif isinstance(val, str):
            normalized[key] = val.strip()
            parsed[key] = parse_split_end(normalized[key])  # type: ignore[arg-type]
        else:
            raise AutoQuantValidationError(f"splits.{key} must be a string or null")

    for left, right in (("train_end", "val_end"), ("val_end", "holdout_end"), ("train_end", "holdout_end")):
        if left in parsed and right in parsed and parsed[left] >= parsed[right]:
            raise AutoQuantValidationError(f"{left} ({normalized[left]}) must precede {right} ({normalized[right]})")
    return normalized


def validate_holdout_audit(raw: dict[str, Any] | None) -> dict[str, Any]:
    if raw is None:
        return {"unlock_count": 0, "unlocks": []}
    if not isinstance(raw, dict):
        raise AutoQuantValidationError("holdout_audit must be an object")
    count = raw.get("unlock_count", 0)
    unlocks = raw.get("unlocks", [])
    if not isinstance(count, int) or isinstance(count, bool) or count < 0 or not isinstance(unlocks, list):
        raise AutoQuantValidationError("Invalid holdout_audit structure")
    cleaned = []
    for idx, entry in enumerate(unlocks):
        if not isinstance(entry, dict):
            raise AutoQuantValidationError(f"holdout_audit.unlocks[{idx}] must be an object")
        cleaned.append(
            {
                "unlocked_at": str(entry.get("unlocked_at", "")),
                "run_id": str(entry.get("run_id", "")),
                "code_sha256": str(entry.get("code_sha256", "")),
                "git_commit": str(entry.get("git_commit", "unavailable")),
                "git_dirty": bool(entry.get("git_dirty", False)),
            }
        )
    return {"unlock_count": max(count, len(cleaned)), "unlocks": cleaned}


@dataclass(frozen=True)
class WorkspaceManifest:
    schema_version: int
    name: str
    projects_directory: str
    default_project: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "name": self.name,
            "projects_directory": self.projects_directory,
            "default_project": self.default_project,
        }


@dataclass(frozen=True)
class WorkspaceContext:
    root_dir: Path
    manifest: WorkspaceManifest
    projects_dir: Path
    local_overrides: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "root_dir": str(self.root_dir),
            "projects_dir": str(self.projects_dir),
            "manifest": self.manifest.to_dict(),
            "has_local_override": bool(self.local_overrides),
        }


@dataclass(frozen=True)
class ProjectManifest:
    schema_version: int
    id: str
    name: str
    description: str
    created_at: str
    splits: dict[str, str | None]
    holdout_audit: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at,
            "splits": dict(self.splits),
            "holdout_audit": {
                "unlock_count": self.holdout_audit["unlock_count"],
                "unlocks": [dict(u) for u in self.holdout_audit["unlocks"]],
            },
        }


@dataclass(frozen=True)
class ProjectContext:
    root_dir: Path
    manifest: ProjectManifest
    workspace_dir: Path | None = None

    @property
    def id(self) -> str:
        return self.manifest.id

    @property
    def name(self) -> str:
        return self.manifest.name

    @property
    def splits(self) -> dict[str, str | None]:
        return self.manifest.splits

    @property
    def holdout_audit(self) -> dict[str, Any]:
        return self.manifest.holdout_audit

    @property
    def data_dir(self) -> Path:
        return confined_path(self.root_dir, "data")

    @property
    def runs_dir(self) -> Path:
        return confined_path(self.root_dir, "runs")

    @property
    def research_path(self) -> Path:
        return confined_path(self.root_dir, RESEARCH_BRIEF_FILE)

    def to_dict(self) -> dict[str, Any]:
        payload = self.manifest.to_dict()
        payload["root_dir"] = str(self.root_dir)
        if self.workspace_dir is not None:
            payload["workspace_dir"] = str(self.workspace_dir)
        return payload


def _resolve_projects_dir(workspace_root: Path, projects_directory: str, *, allow_absolute: bool) -> Path:
    if not isinstance(projects_directory, str) or not projects_directory.strip():
        raise AutoQuantValidationError("projects_directory must be a non-empty string")
    raw = Path(projects_directory.strip()).expanduser()
    if raw.is_absolute():
        if not allow_absolute:
            raise AutoQuantValidationError("Committed autoquant-workspace.json projects_directory must be relative")
        if ".." in raw.parts or raw.is_symlink():
            raise AutoQuantValidationError(f"Unsafe local projects_directory: {projects_directory}")
        return raw.resolve()
    return confined_path(workspace_root, raw)


def load_workspace(directory: str | Path = ".") -> WorkspaceContext:
    """Load and validate an AutoQuant Workspace directory."""
    root = Path(directory).expanduser().absolute()
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(f"Workspace directory is invalid: {root}")
    raw = read_json_object(confined_path(root, WORKSPACE_MANIFEST), WORKSPACE_MANIFEST)
    if raw.get("schema_version") != SCHEMA_VERSION:
        raise AutoQuantValidationError(f"{WORKSPACE_MANIFEST} schema_version must be {SCHEMA_VERSION}")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        raise AutoQuantValidationError(f"{WORKSPACE_MANIFEST} name must be a non-empty string")
    projects_directory = raw.get("projects_directory", "projects")
    _resolve_projects_dir(root, projects_directory, allow_absolute=False)

    default_project = raw.get("default_project")
    if default_project is not None:
        validate_project_id(default_project)

    local_path = confined_path(root, WORKSPACE_LOCAL_MANIFEST)
    local_overrides: dict[str, Any] = {}
    effective_pd = projects_directory
    if local_path.exists() or local_path.is_symlink():
        local_overrides = read_json_object(local_path, WORKSPACE_LOCAL_MANIFEST)
        if isinstance(local_overrides.get("name"), str) and local_overrides["name"].strip():
            name = local_overrides["name"].strip()
        if "default_project" in local_overrides:
            dp = local_overrides["default_project"]
            if dp is not None:
                validate_project_id(dp)
            default_project = dp
        if "projects_directory" in local_overrides:
            lpd = local_overrides["projects_directory"]
            if not isinstance(lpd, str) or not lpd.strip():
                raise AutoQuantValidationError(f"{WORKSPACE_LOCAL_MANIFEST} projects_directory must be non-empty")
            effective_pd = lpd.strip()

    projects_dir = _resolve_projects_dir(root, effective_pd, allow_absolute="projects_directory" in local_overrides)
    if projects_dir.exists() and (projects_dir.is_symlink() or not projects_dir.is_dir()):
        raise AutoQuantValidationError(f"Projects directory is not a real directory: {projects_dir}")

    return WorkspaceContext(
        root_dir=root,
        manifest=WorkspaceManifest(SCHEMA_VERSION, name.strip(), effective_pd, default_project),
        projects_dir=projects_dir,
        local_overrides=local_overrides,
    )


def initialize_workspace(
    directory: str | Path,
    *,
    name: str | None = None,
    adopt_existing: bool = False,
    materialize_skills: bool = True,
) -> WorkspaceContext:
    """Initialize a new or explicitly adopted AutoQuant Workspace directory."""
    root = Path(directory).expanduser().absolute()
    if root.is_symlink() or (root.exists() and not root.is_dir()):
        raise AutoQuantValidationError(f"Invalid target Workspace directory: {root}")

    if root.exists():
        if any(root.iterdir()) and not adopt_existing:
            raise AutoQuantValidationError(f"Target directory is not empty: {root} (pass --adopt-existing to adopt)")
        for fname in (WORKSPACE_MANIFEST, WORKSPACE_LOCAL_MANIFEST):
            if (root / fname).exists() or (root / fname).is_symlink():
                raise AutoQuantValidationError(f"Manifest already exists: {root / fname}")
        proj_cand = root / "projects"
        if proj_cand.is_symlink() or (
            proj_cand.exists() and (not proj_cand.is_dir() or any(p.name != ".gitkeep" for p in proj_cand.iterdir()))
        ):
            raise AutoQuantValidationError(f"Cannot adopt existing projects directory: {proj_cand}")
    else:
        root.mkdir(parents=True, exist_ok=True)

    confined_path(root, "projects").mkdir(parents=True, exist_ok=True)
    ws_name = (name or "AutoQuant Research Desk").strip()
    if not ws_name:
        raise AutoQuantValidationError("Workspace name must be non-empty")

    atomic_write_json(
        confined_path(root, WORKSPACE_MANIFEST),
        {"schema_version": SCHEMA_VERSION, "name": ws_name, "projects_directory": "projects", "default_project": None},
    )
    if materialize_skills:
        from .skill_bundle import WORKSPACE_SKILLS_MANIFEST, materialize_workspace_skills

        if not (root / WORKSPACE_SKILLS_MANIFEST).exists():
            materialize_workspace_skills(root)
    return load_workspace(root)


def load_project(project_dir: str | Path, *, workspace_dir: Path | None = None) -> ProjectContext:
    """Load and validate `<project_id>/project.json`."""
    root = Path(project_dir).expanduser().absolute()
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(f"Project directory is invalid: {root}")
    raw = read_json_object(confined_path(root, PROJECT_MANIFEST), PROJECT_MANIFEST)
    if raw.get("schema_version") != SCHEMA_VERSION:
        raise AutoQuantValidationError(f"{PROJECT_MANIFEST} schema_version must be {SCHEMA_VERSION}")
    project_id = validate_project_id(raw.get("id", ""))
    if root.name != project_id:
        raise AutoQuantValidationError(f"Project folder {root.name!r} does not match id {project_id!r}")
    name = raw.get("name")
    created_at = raw.get("created_at")
    description = raw.get("description", "")
    if not isinstance(name, str) or not name.strip() or not isinstance(created_at, str) or not created_at.strip():
        raise AutoQuantValidationError("project.json requires non-empty 'name' and 'created_at'")
    if not isinstance(description, str):
        raise AutoQuantValidationError("project.json description must be a string")

    inferred_ws = workspace_dir or (root.parent.parent if (root.parent.parent / WORKSPACE_MANIFEST).is_file() else None)
    manifest = ProjectManifest(
        schema_version=SCHEMA_VERSION,
        id=project_id,
        name=name.strip(),
        description=description,
        created_at=created_at.strip(),
        splits=validate_splits_dict(raw.get("splits")),
        holdout_audit=validate_holdout_audit(raw.get("holdout_audit")),
    )
    return ProjectContext(root_dir=root, manifest=manifest, workspace_dir=inferred_ws)


def create_project(
    workspace_or_dir: str | Path | WorkspaceContext,
    project_id: str,
    *,
    name: str | None = None,
    description: str = "",
    train_end: str | None = None,
    val_end: str | None = None,
    holdout_end: str | None = None,
    set_default: bool = False,
) -> ProjectContext:
    """Create `<projects_dir>/<project_id>/{project.json,research.md,data/,runs/}`."""
    validate_project_id(project_id)
    ws = workspace_or_dir if isinstance(workspace_or_dir, WorkspaceContext) else load_workspace(workspace_or_dir)
    ws.projects_dir.mkdir(parents=True, exist_ok=True)
    project_dir = confined_path(ws.projects_dir, project_id)
    if project_dir.exists() or project_dir.is_symlink():
        raise AutoQuantValidationError(f"Project already exists: {project_dir}")

    splits = validate_splits_dict({"train_end": train_end, "val_end": val_end, "holdout_end": holdout_end})
    display_name = name.strip() if isinstance(name, str) and name.strip() else " ".join(p.capitalize() for p in project_id.split("-"))
    project_dir.mkdir(parents=True, exist_ok=False)
    (project_dir / "data").mkdir()
    (project_dir / "runs").mkdir()

    atomic_write_json(
        confined_path(project_dir, PROJECT_MANIFEST),
        {
            "schema_version": SCHEMA_VERSION,
            "id": project_id,
            "name": display_name,
            "description": description,
            "created_at": utc_now_iso(),
            "splits": splits,
            "holdout_audit": {"unlock_count": 0, "unlocks": []},
        },
    )
    desc_line = f"\n{description.strip()}\n" if description.strip() else "\n"
    brief = (
        f"# {display_name} (`{project_id}`)\n{desc_line}\n"
        "## Hypothesis & Universe\n\n- Document economic thesis, universe, rebalance cadence, and cost assumptions.\n\n"
        f"## Split Guardrails\n\n- Train end: `{splits['train_end'] or 'unconfigured'}`\n"
        f"- Validation end: `{splits['val_end'] or 'unconfigured'}`\n"
        f"- Holdout end: `{splits['holdout_end'] or 'unconfigured'}`\n\n"
        "## Research Findings\n\n- Record key immutable `run_id` results and diagnostics here.\n"
    )
    confined_path(project_dir, RESEARCH_BRIEF_FILE).write_text(brief, encoding="utf-8")

    if set_default:
        ws_path = confined_path(ws.root_dir, WORKSPACE_MANIFEST)
        ws_raw = read_json_object(ws_path, WORKSPACE_MANIFEST)
        ws_raw["default_project"] = project_id
        atomic_write_json(ws_path, ws_raw)

    return load_project(project_dir, workspace_dir=ws.root_dir)


def list_projects(workspace_or_dir: str | Path | WorkspaceContext = ".") -> list[ProjectContext]:
    ws = workspace_or_dir if isinstance(workspace_or_dir, WorkspaceContext) else load_workspace(workspace_or_dir)
    if not ws.projects_dir.exists():
        return []
    out: list[ProjectContext] = []
    for entry in sorted(ws.projects_dir.iterdir(), key=lambda p: p.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink():
            raise AutoQuantValidationError(f"Project directory cannot be a symlink: {entry}")
        if entry.is_dir() and ((entry / PROJECT_MANIFEST).exists() or (entry / PROJECT_MANIFEST).is_symlink()):
            out.append(load_project(entry, workspace_dir=ws.root_dir))
    return out


list_workspace_projects = list_projects


def resolve_project_directory(workspace_or_dir: str | Path | WorkspaceContext, project_id: str) -> Path:
    validate_project_id(project_id)
    ws = workspace_or_dir if isinstance(workspace_or_dir, WorkspaceContext) else load_workspace(workspace_or_dir)
    return confined_path(ws.projects_dir, project_id)


def resolve_project(
    path_or_project: str | Path | ProjectContext | WorkspaceContext = ".",
    project_id: str | None = None,
) -> ProjectContext:
    """Resolve a `ProjectContext` from a Project dir, Workspace dir, or slug."""
    if isinstance(path_or_project, ProjectContext):
        ctx = load_project(path_or_project.root_dir, workspace_dir=path_or_project.workspace_dir)
        if project_id is not None and ctx.id != project_id:
            raise AutoQuantValidationError(f"Requested project {project_id!r} does not match {ctx.id!r}")
        return ctx

    if isinstance(path_or_project, WorkspaceContext):
        ws = path_or_project
    else:
        raw_str = str(path_or_project)
        cand = Path(raw_str).expanduser().absolute()
        if cand.is_dir():
            if (cand / PROJECT_MANIFEST).is_file():
                ctx = load_project(cand)
                if project_id is not None and ctx.id != project_id:
                    raise AutoQuantValidationError(f"Project directory {cand} has id {ctx.id!r}, not {project_id!r}")
                return ctx
            if (cand / WORKSPACE_MANIFEST).is_file():
                ws = load_workspace(cand)
            else:
                raise AutoQuantValidationError(f"Not an AutoQuant Workspace or Project directory: {cand}")
        elif project_id is None and PROJECT_ID_PATTERN.fullmatch(raw_str) and (Path.cwd() / WORKSPACE_MANIFEST).is_file():
            ws = load_workspace(Path.cwd())
            project_id = raw_str
        else:
            raise AutoQuantValidationError(f"Path does not exist: {cand}")

    target_id = project_id or ws.manifest.default_project
    if target_id is not None:
        proj_dir = resolve_project_directory(ws, target_id)
        if not proj_dir.exists():
            raise AutoQuantValidationError(f"Project {target_id!r} does not exist in {ws.projects_dir}")
        return load_project(proj_dir, workspace_dir=ws.root_dir)

    projects = list_projects(ws)
    if len(projects) == 1:
        return projects[0]
    if not projects:
        raise AutoQuantValidationError(f"Workspace at {ws.root_dir} has no projects; run `aq project create`")
    raise AutoQuantValidationError(
        f"Multiple projects in {ws.root_dir} ({', '.join(p.id for p in projects)}); pass project_id / --project"
    )


def set_project_splits(
    project: str | Path | ProjectContext,
    *,
    train_end: str | None = None,
    val_end: str | None = None,
    holdout_end: str | None = None,
    project_id: str | None = None,
    force: bool = False,
) -> ProjectContext:
    ctx = resolve_project(project, project_id=project_id)
    new_splits = validate_splits_dict({"train_end": train_end, "val_end": val_end, "holdout_end": holdout_end})
    if not force and ctx.holdout_audit["unlock_count"] > 0 and new_splits != ctx.splits:
        raise AutoQuantValidationError(
            f"Project {ctx.id!r} has unlocked holdout {ctx.holdout_audit['unlock_count']}x; "
            "refusing to mutate splits retroactively without force=True"
        )
    payload = ctx.manifest.to_dict()
    payload["splits"] = new_splits
    atomic_write_json(confined_path(ctx.root_dir, PROJECT_MANIFEST), payload)
    return load_project(ctx.root_dir, workspace_dir=ctx.workspace_dir)


def record_holdout_unlock(
    project: str | Path | ProjectContext,
    *,
    run_id: str,
    code_sha256: str,
    git_commit: str,
    git_dirty: bool,
    unlocked_at: str | None = None,
) -> dict[str, Any]:
    ctx = resolve_project(project)
    payload = ctx.manifest.to_dict()
    audit = validate_holdout_audit(payload.get("holdout_audit"))
    audit["unlocks"].append(
        {
            "unlocked_at": unlocked_at or utc_now_iso(),
            "run_id": run_id,
            "code_sha256": code_sha256,
            "git_commit": git_commit,
            "git_dirty": bool(git_dirty),
        }
    )
    audit["unlock_count"] = len(audit["unlocks"])
    payload["holdout_audit"] = audit
    atomic_write_json(confined_path(ctx.root_dir, PROJECT_MANIFEST), payload)
    return audit
