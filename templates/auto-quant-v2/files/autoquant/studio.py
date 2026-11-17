"""Modular read-only Quant Studio backend and OpenAlice managed surface."""

from __future__ import annotations

import csv
import ipaddress
import json
import math
import os
import re
import signal
import sys
import threading
import webbrowser
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from pathlib import Path, PurePosixPath
from typing import Any, Mapping
from urllib.parse import parse_qs, unquote, urlsplit

from .version import current_version

SCHEMA_VERSION = 1
STUDIO_KIND = "autoquant-studio-snapshot"
STUDIO_HEALTH_KIND = "autoquant-studio-health"
STUDIO_RUN_KIND = "autoquant-studio-run"
WORKSPACE_MANIFEST = "autoquant-workspace.json"
WORKSPACE_LOCAL_MANIFEST = "autoquant-workspace.local.json"
PROJECT_MANIFEST = "project.json"

HARNESS_CAPABILITY = "HARNESS_CAPABILITY"
HARNESS_HOST = "HARNESS_HOST"
HARNESS_PORTS = "HARNESS_PORTS"
HARNESS_NO_OPEN = "HARNESS_NO_OPEN"
STUDIO_MANAGED_PORT_NAMES = frozenset({"http"})
STANDALONE_STUDIO_HOST = "127.0.0.1"
STANDALONE_STUDIO_PORT = 8765

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
MAX_TEXT_ARTIFACT_BYTES = 1_048_576
MAX_CSV_PREVIEW_ROWS = 100

STUDIO_ASSETS: dict[str, tuple[str, str]] = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/assets/studio.css": ("studio.css", "text/css; charset=utf-8"),
    "/assets/studio.js": ("studio.js", "text/javascript; charset=utf-8"),
}

STANDALONE_SECURITY_HEADERS: dict[str, str] = {
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}

MANAGED_SECURITY_HEADERS: dict[str, str] = {
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
        "base-uri 'none'; form-action 'none'; frame-ancestors app: "
        "http://127.0.0.1:* http://localhost:* http://*.localhost:*"
    ),
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}


@dataclass(frozen=True)
class ValidationIssue:
    path: str
    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


class StudioError(ValueError):
    """Validation or confinement failure while reading or serving Studio state."""

    def __init__(self, issues_or_message: list[ValidationIssue] | str, *, code: str = "studio.invalid"):
        self.issues = (
            [ValidationIssue("", code, issues_or_message)]
            if isinstance(issues_or_message, str)
            else list(issues_or_message)
        )
        super().__init__("; ".join(item.message for item in self.issues))


class StudioNotFoundError(StudioError):
    """Requested Project or Run does not exist."""


AutoQuantValidationError = StudioError


@dataclass(frozen=True)
class StudioLaunch:
    host: str
    port: int
    open_browser: bool
    managed: bool


def studio_security_headers(*, managed: bool) -> Mapping[str, str]:
    return MANAGED_SECURITY_HEADERS if managed else STANDALONE_SECURITY_HEADERS


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _sanitize_json(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): _sanitize_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_json(v) for v in value]
    return value


def _parse_float(raw: str | None) -> float | None:
    if raw is None or not raw.strip():
        return None
    try:
        val = float(raw.strip())
    except ValueError:
        return None
    return val if math.isfinite(val) else None


def _validate_id(value: str, label: str) -> str:
    if not isinstance(value, str) or not SAFE_ID_RE.fullmatch(value) or ".." in value:
        raise StudioError([_issue(label, "studio.id", f"Invalid {label}: {value!r}")])
    return value


def _resolve_non_symlink_root(path: str | Path) -> Path:
    raw = Path(path).expanduser().absolute()
    if raw.is_symlink():
        raise StudioError([_issue(raw, "path.symlink", f"Root path cannot be a symlink: {raw}")])
    resolved = raw.resolve()
    if not resolved.exists():
        raise StudioNotFoundError([_issue(raw, "path.missing", f"Path does not exist: {raw}")])
    if not resolved.is_dir():
        raise StudioError([_issue(raw, "path.not-dir", f"Expected directory path: {raw}")])
    return resolved


def _confined_path(root: Path, relative: str, issue_path: str | Path = "") -> Path:
    label = issue_path or relative
    if not isinstance(relative, str) or not relative or "\\" in relative or "\x00" in relative:
        raise StudioError([_issue(label, "path.invalid", f"Invalid relative path: {relative!r}")])
    posix = PurePosixPath(relative)
    if posix.is_absolute() or relative in {".", ".."} or ".." in posix.parts or "." in posix.parts:
        raise StudioError([_issue(label, "path.escape", f"Path escapes root: {relative!r}")])
    current = root
    for segment in posix.parts:
        current = current / segment
        if current.is_symlink():
            raise StudioError([_issue(label, "path.symlink", f"Symlink not allowed: {current}")])
    resolved = current.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        raise StudioError([_issue(label, "path.escape", f"Path escapes root: {relative!r}")]) from None
    return resolved


def _read_json_dict(path: Path) -> dict[str, Any]:
    if path.is_symlink():
        raise StudioError([_issue(path, "path.symlink", f"Symlink not allowed: {path}")])
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise StudioNotFoundError([_issue(path, "manifest.missing", f"Missing file: {path}")]) from None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise StudioError([_issue(path, "json.invalid", f"Invalid JSON in {path}: {error}")]) from None
    if not isinstance(raw, dict):
        raise StudioError([_issue(path, "json.object", f"Expected JSON object in {path}")])
    return _sanitize_json(raw)


def _managed_ports(raw: str | None) -> dict[str, Any]:
    if raw is None:
        raise StudioError([_issue(HARNESS_PORTS, "studio.managed-ports", "Managed Studio requires HARNESS_PORTS JSON")])

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, val in pairs:
            if key in out:
                raise ValueError(f"duplicate port key: {key}")
            out[key] = val
        return out

    try:
        parsed = json.loads(raw, object_pairs_hook=reject_duplicates)
    except (json.JSONDecodeError, ValueError) as error:
        raise StudioError([_issue(HARNESS_PORTS, "studio.managed-ports", "Managed Studio ports must be unambiguous JSON")]) from error
    if not isinstance(parsed, dict):
        raise StudioError([_issue(HARNESS_PORTS, "studio.managed-ports", "Managed Studio ports must be a JSON object")])
    return parsed


def _managed_host(raw: str | None) -> str:
    if raw is None or not raw or raw.strip() != raw:
        raise StudioError([_issue(HARNESS_HOST, "studio.managed-host", "Managed Studio requires one non-empty injected host")])
    if raw.casefold() == "localhost":
        return raw
    try:
        address = ipaddress.ip_address(raw)
    except ValueError:
        address = None
    if isinstance(address, ipaddress.IPv4Address) and address.is_loopback:
        return raw
    raise StudioError([_issue(HARNESS_HOST, "studio.managed-host", "Managed Studio host must be localhost or IPv4 loopback")])


def resolve_studio_launch(
    *,
    host: str | None = None,
    port: int | None = None,
    no_open: bool = False,
    open_browser: bool | None = None,
    environ: Mapping[str, str] | None = None,
) -> StudioLaunch:
    """Resolve standalone defaults or strict OpenAlice Harness authority."""

    effective_no_open = (not open_browser) if open_browser is not None else bool(no_open)
    environment = os.environ if environ is None else environ
    if environment.get(HARNESS_CAPABILITY) != "studio":
        return StudioLaunch(
            host=STANDALONE_STUDIO_HOST if host is None else host,
            port=STANDALONE_STUDIO_PORT if port is None else port,
            open_browser=not effective_no_open,
            managed=False,
        )

    injected_host = _managed_host(environment.get(HARNESS_HOST))
    ports = _managed_ports(environment.get(HARNESS_PORTS))
    if set(ports) != STUDIO_MANAGED_PORT_NAMES:
        raise StudioError([_issue(HARNESS_PORTS, "studio.managed-port-names", "Managed Studio ports must match manifest: http")])
    injected_port = ports["http"]
    if not isinstance(injected_port, int) or isinstance(injected_port, bool) or not 1 <= injected_port <= 65535:
        raise StudioError([_issue(f"{HARNESS_PORTS}.http", "studio.managed-http-port", "Managed Studio http port must be 1..65535")])
    issues: list[ValidationIssue] = []
    if host is not None and host != injected_host:
        issues.append(_issue("--host", "studio.managed-host-conflict", f"Explicit Studio host {host!r} conflicts with injected host {injected_host!r}"))
    if port is not None and port != injected_port:
        issues.append(_issue("--port", "studio.managed-port-conflict", f"Explicit Studio port {port} conflicts with injected port {injected_port}"))
    if issues:
        raise StudioError(issues)
    return StudioLaunch(
        host=injected_host,
        port=injected_port,
        open_browser=(not effective_no_open and environment.get(HARNESS_NO_OPEN) != "1"),
        managed=True,
    )


def _locate_source(path: str | Path) -> tuple[str, Path, dict[str, Any], Path | None]:
    root = _resolve_non_symlink_root(path)
    ws_manifest, ws_local, proj_manifest = root / WORKSPACE_MANIFEST, root / WORKSPACE_LOCAL_MANIFEST, root / PROJECT_MANIFEST

    if ws_manifest.exists() or ws_manifest.is_symlink():
        active_cfg = _read_json_dict(ws_manifest)
        cfg_source = "workspace-manifest"
        if ws_local.exists() or ws_local.is_symlink():
            if ws_local.is_symlink() or not ws_local.is_file():
                raise StudioError([_issue(ws_local, "path.symlink", "Local workspace override must be a regular file")])
            active_cfg = _read_json_dict(ws_local)
            cfg_source = "local-override"
            raw_dir = active_cfg.get("projects_directory", "projects")
            if not isinstance(raw_dir, str) or not raw_dir.strip() or "\x00" in raw_dir:
                raise StudioError([_issue(ws_local, "workspace.projects_directory", "Invalid projects_directory")])
            cand = Path(raw_dir).expanduser()
            if cand.is_absolute():
                if cand.is_symlink():
                    raise StudioError([_issue(cand, "path.symlink", f"Projects directory cannot be a symlink: {cand}")])
                projects_dir = cand.resolve()
            else:
                projects_dir = _confined_path(root, raw_dir, f"{ws_local}/projects_directory")
        else:
            projects_dir = _confined_path(root, active_cfg.get("projects_directory", "projects"), f"{ws_manifest}/projects_directory")
        if projects_dir.exists() and not projects_dir.is_dir():
            raise StudioError([_issue(projects_dir, "workspace.projects_directory", "Projects path must be a directory")])
        default_proj = active_cfg.get("default_project")
        if default_proj is not None:
            _validate_id(str(default_proj), "default_project")
        return "workspace", root, {
            "scope": "workspace",
            "root_dir": str(root),
            "name": str(active_cfg.get("name") or root.name),
            "projects_dir": str(projects_dir),
            "default_project": default_proj,
            "configuration_source": cfg_source,
        }, projects_dir

    if proj_manifest.exists() or proj_manifest.is_symlink():
        raw_proj = _read_json_dict(proj_manifest)
        return "project", root, {
            "scope": "project",
            "root_dir": str(root),
            "name": str(raw_proj.get("name") or raw_proj.get("id") or root.name),
            "projects_dir": None,
            "default_project": raw_proj.get("id"),
            "configuration_source": "project-manifest",
        }, None

    raise StudioError([_issue(root, "studio.root", f"No {WORKSPACE_MANIFEST} or {PROJECT_MANIFEST} found in {root}")])


def _normalize_run(raw: dict[str, Any], fallback_id: str, project_id: str) -> dict[str, Any]:
    metrics_raw = raw.get("metrics") if isinstance(raw.get("metrics"), dict) else {}
    metrics = {
        str(k): (float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(float(v)) else None)
        for k, v in metrics_raw.items()
    }
    return {
        "schema_version": raw.get("schema_version", SCHEMA_VERSION),
        "id": str(raw.get("id") or fallback_id),
        "project_id": str(raw.get("project_id") or project_id),
        "kind": str(raw.get("kind") or "custom"),
        "name": str(raw.get("name") or raw.get("id") or fallback_id),
        "split": str(raw.get("split") or "in_sample"),
        "created_at": str(raw.get("created_at") or ""),
        "hypothesis": str(raw.get("hypothesis") or ""),
        "parameters": raw.get("parameters") if isinstance(raw.get("parameters"), dict) else {},
        "dataset": raw.get("dataset"),
        "provenance": raw.get("provenance") if isinstance(raw.get("provenance"), dict) else {},
        "metrics": metrics,
        "series_files": raw.get("series_files") if isinstance(raw.get("series_files"), dict) else {},
        "artifacts": raw.get("artifacts") if isinstance(raw.get("artifacts"), list) else [],
        "notes": str(raw.get("notes") or ""),
    }


def _load_project_summary(project_dir: Path) -> dict[str, Any]:
    raw = _read_json_dict(_confined_path(project_dir, PROJECT_MANIFEST, f"{project_dir}/{PROJECT_MANIFEST}"))
    proj_id = _validate_id(str(raw.get("id") or project_dir.name), "project.id")

    raw_splits = raw.get("splits") if isinstance(raw.get("splits"), dict) else {}
    splits = {"train_end": raw_splits.get("train_end"), "val_end": raw_splits.get("val_end"), "holdout_end": raw_splits.get("holdout_end")}
    raw_audit = raw.get("holdout_audit") if isinstance(raw.get("holdout_audit"), dict) else {}
    unlocks = raw_audit.get("unlocks") if isinstance(raw.get("unlocks"), list) else []
    unlock_count = raw_audit.get("unlock_count")
    if not isinstance(unlock_count, int) or isinstance(unlock_count, bool):
        unlock_count = len(unlocks)

    research_md = ""
    research_path = _confined_path(project_dir, "research.md", f"{project_dir}/research.md")
    if research_path.exists():
        if not research_path.is_file():
            raise StudioError([_issue(research_path, "path.invalid", "research.md must be a regular file")])
        research_md = research_path.read_text(encoding="utf-8", errors="replace")

    datasets: list[dict[str, Any]] = []
    if (project_dir / "data").is_symlink():
        raise StudioError([_issue(project_dir / "data", "path.symlink", "Symlink not allowed: data")])
    manifest_json = _confined_path(project_dir, "data/manifest.json", f"{project_dir}/data/manifest.json")
    if manifest_json.exists():
        raw_data = _read_json_dict(manifest_json).get("datasets", {})
        if isinstance(raw_data, dict):
            datasets.extend({"id": k, **v} for k, v in sorted(raw_data.items()) if isinstance(v, dict))
        elif isinstance(raw_data, list):
            datasets.extend(item for item in raw_data if isinstance(item, dict))

    runs: list[dict[str, Any]] = []
    runs_dir = _confined_path(project_dir, "runs", f"{project_dir}/runs")
    if runs_dir.exists():
        if not runs_dir.is_dir():
            raise StudioError([_issue(runs_dir, "path.not-dir", "runs must be a directory")])
        for entry in sorted(runs_dir.iterdir(), key=lambda p: p.name):
            if entry.is_symlink():
                raise StudioError([_issue(entry, "path.symlink", f"Symlink not allowed in runs: {entry}")])
            if entry.name.startswith(".") or not entry.is_dir():
                continue
            run_id = _validate_id(entry.name, "run.id")
            run_file = _confined_path(entry, "run.json", f"{entry}/run.json")
            if run_file.exists():
                runs.append(_normalize_run(_read_json_dict(run_file), run_id, proj_id))
    runs.sort(key=lambda r: (r["created_at"], r["id"]), reverse=True)

    return {
        "id": proj_id,
        "name": str(raw.get("name") or proj_id),
        "description": str(raw.get("description") or ""),
        "created_at": str(raw.get("created_at") or ""),
        "root_dir": str(project_dir),
        "splits": splits,
        "holdout_audit": {"unlock_count": unlock_count, "unlocks": unlocks},
        "research_markdown": research_md,
        "datasets": datasets,
        "runs": runs,
    }


def build_studio_snapshot(path: str | Path, *, project_id: str | None = None) -> dict[str, Any]:
    """Build a verified read-only Studio snapshot for a Workspace or Project."""

    scope, root, source_info, projects_dir = _locate_source(path)
    projects: list[dict[str, Any]] = []

    if scope == "project":
        summary = _load_project_summary(root)
        if project_id is not None and project_id != summary["id"]:
            raise StudioNotFoundError([_issue(project_id, "project.not-found", f"Direct project is {summary['id']!r}, not {project_id!r}")])
        projects.append(summary)
    else:
        assert projects_dir is not None
        if project_id is not None:
            _validate_id(project_id, "project_id")
            target = _confined_path(projects_dir, project_id, f"{projects_dir}/{project_id}")
            if not target.is_dir() or (not (target / PROJECT_MANIFEST).exists() and not (target / PROJECT_MANIFEST).is_symlink()):
                raise StudioNotFoundError([_issue(target, "project.not-found", f"Unknown project: {project_id}")])
            projects.append(_load_project_summary(target))
        elif projects_dir.exists():
            for entry in sorted(projects_dir.iterdir(), key=lambda p: p.name):
                if entry.is_symlink():
                    raise StudioError([_issue(entry, "path.symlink", f"Symlink not allowed in projects: {entry}")])
                if entry.name.startswith(".") or not entry.is_dir():
                    continue
                if (entry / PROJECT_MANIFEST).exists() or (entry / PROJECT_MANIFEST).is_symlink():
                    projects.append(_load_project_summary(entry))

    default_proj = source_info.get("default_project")
    proj_ids = [p["id"] for p in projects]
    active_id = project_id if (project_id and project_id in proj_ids) else (default_proj if default_proj in proj_ids else (proj_ids[0] if proj_ids else None))

    return {
        "schema_version": SCHEMA_VERSION,
        "kind": STUDIO_KIND,
        "version": current_version(),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source_info,
        "active_project_id": active_id,
        "projects": projects,
    }


def _read_csv_series(path: Path, *, compute_drawdown: bool = False) -> list[dict[str, Any]]:
    if path.is_symlink():
        raise StudioError([_issue(path, "path.symlink", f"Symlink not allowed: {path}")])
    rows: list[dict[str, Any]] = []
    peak = -math.inf
    with path.open("r", encoding="utf-8", newline="") as handle:
        for raw_row in csv.DictReader(handle):
            item: dict[str, Any] = {}
            for key, val in raw_row.items():
                if key is None:
                    continue
                col = key.strip()
                item[col] = (val or "").strip() if col == "timestamp" else _parse_float(val)
            if compute_drawdown and item.get("drawdown") is None:
                eq = item.get("equity")
                if isinstance(eq, float) and eq > 0:
                    peak = max(peak, eq)
                    item["drawdown"] = (eq / peak) - 1.0 if peak > 0 else 0.0
            rows.append(item)
    return rows


def _sanitize_svg_text(text: str) -> str:
    cleaned = re.sub(r"(?is)<\s*(script|foreignObject|iframe|object|embed)\b[^>]*>.*?<\s*/\s*\1\s*>", "", text)
    cleaned = re.sub(r"(?is)<\s*(script|foreignObject|iframe|object|embed)\b[^>]*/?\s*>", "", cleaned)
    cleaned = re.sub(r'(?i)\s+on[a-z0-9_]+\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+)', "", cleaned)
    return re.sub(r'(?i)(href|xlink:href)\s*=\s*(["\'])\s*(?:javascript:|https?:|//)[^"\']*\2', "", cleaned)


def _load_artifact_entry(run_dir: Path, rel_path: str, name: str | None, declared_kind: str | None) -> dict[str, Any]:
    file_path = _confined_path(run_dir, rel_path, f"{run_dir}/{rel_path}")
    if not file_path.exists() or not file_path.is_file():
        raise StudioError([_issue(file_path, "artifact.missing", f"Missing or invalid artifact file: {rel_path}")])
    size_bytes = file_path.stat().st_size
    suffix = file_path.suffix.lower()
    base = {"name": name or file_path.name, "path": rel_path, "declared_kind": declared_kind, "size_bytes": size_bytes}

    if size_bytes > MAX_TEXT_ARTIFACT_BYTES:
        return {**base, "kind": "binary"}
    if suffix == ".json":
        try:
            raw_json = json.loads(file_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise StudioError([_issue(file_path, "json.invalid", f"Invalid artifact JSON: {error}")]) from None
        return {**base, "kind": "json", "data": _sanitize_json(raw_json)}
    if suffix == ".svg":
        return {**base, "kind": "svg", "text": _sanitize_svg_text(file_path.read_text(encoding="utf-8", errors="replace"))}
    if suffix in {".md", ".markdown"}:
        return {**base, "kind": "markdown", "text": file_path.read_text(encoding="utf-8", errors="replace")}
    if suffix == ".csv":
        text = file_path.read_text(encoding="utf-8", errors="replace")
        with file_path.open("r", encoding="utf-8", newline="") as handle:
            reader = list(csv.reader(handle))
        return {
            **base,
            "kind": "csv",
            "text": text,
            "columns": reader[0] if reader else [],
            "rows": reader[1 : 1 + MAX_CSV_PREVIEW_ROWS] if len(reader) > 1 else [],
            "total_rows": max(0, len(reader) - 1),
        }
    try:
        return {**base, "kind": "text", "text": file_path.read_text(encoding="utf-8")}
    except UnicodeDecodeError:
        return {**base, "kind": "binary"}


def _scan_artifacts_dir(run_dir: Path, current: Path, depth: int = 0) -> list[str]:
    if current.is_symlink():
        raise StudioError([_issue(current, "path.symlink", f"Symlink not allowed in artifacts: {current}")])
    if not current.exists() or depth > 3:
        return []
    found: list[str] = []
    for entry in sorted(current.iterdir(), key=lambda p: p.name):
        if entry.is_symlink():
            raise StudioError([_issue(entry, "path.symlink", f"Symlink not allowed in artifacts: {entry}")])
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            found.extend(_scan_artifacts_dir(run_dir, entry, depth + 1))
        elif entry.is_file():
            found.append(entry.relative_to(run_dir).as_posix())
    return found


def load_studio_run(
    path: str | Path,
    *,
    project_id: str | None,
    run_id: str,
    fixed_project_id: str | None = None,
) -> dict[str, Any]:
    """Load detailed Run series and confined custom artifacts."""

    _validate_id(run_id, "run_id")
    scope, root, source_info, projects_dir = _locate_source(path)

    if scope == "project":
        proj_manifest = _read_json_dict(_confined_path(root, PROJECT_MANIFEST))
        resolved_proj_id = _validate_id(str(proj_manifest.get("id") or root.name), "project.id")
        if project_id is not None and project_id != resolved_proj_id:
            raise StudioNotFoundError([_issue(project_id, "project.not-found", f"Unknown project: {project_id}")])
        project_dir = root
    else:
        assert projects_dir is not None
        effective_proj = project_id or fixed_project_id or source_info.get("default_project")
        if not effective_proj:
            raise StudioError([_issue("project", "studio.project-required", "Project id is required")])
        resolved_proj_id = _validate_id(str(effective_proj), "project_id")
        if fixed_project_id is not None and resolved_proj_id != fixed_project_id:
            raise StudioNotFoundError([_issue(resolved_proj_id, "project.not-found", f"Server restricted to project {fixed_project_id!r}")])
        project_dir = _confined_path(projects_dir, resolved_proj_id, f"{projects_dir}/{resolved_proj_id}")
        if not project_dir.is_dir():
            raise StudioNotFoundError([_issue(project_dir, "project.not-found", f"Unknown project: {resolved_proj_id}")])

    run_dir = _confined_path(project_dir, f"runs/{run_id}", f"{project_dir}/runs/{run_id}")
    if not run_dir.is_dir():
        raise StudioNotFoundError([_issue(run_dir, "run.not-found", f"Unknown run: {run_id}")])
    run_data = _normalize_run(_read_json_dict(_confined_path(run_dir, "run.json")), run_id, resolved_proj_id)

    if (run_dir / "series").is_symlink():
        raise StudioError([_issue(run_dir / "series", "path.symlink", "Symlink not allowed: series")])
    sf = run_data["series_files"]
    eq_path = _confined_path(run_dir, sf.get("equity", "series/equity.csv"))
    ic_path = _confined_path(run_dir, sf.get("ic", "series/ic.csv"))
    qt_path = _confined_path(run_dir, sf.get("quantiles", "series/quantiles.json"))

    seen_paths: dict[str, tuple[str | None, str | None]] = {}
    for item in run_data["artifacts"]:
        if isinstance(item, dict) and isinstance(item.get("path"), str):
            seen_paths[item["path"]] = (item.get("name"), item.get("kind"))
        elif isinstance(item, str):
            seen_paths[item] = (None, None)
    for scanned_rel in _scan_artifacts_dir(run_dir, run_dir / "artifacts"):
        seen_paths.setdefault(scanned_rel, (None, None))

    return {
        "ok": True,
        "kind": STUDIO_RUN_KIND,
        "project_id": resolved_proj_id,
        "run": run_data,
        "series": {
            "equity": _read_csv_series(eq_path, compute_drawdown=True) if eq_path.is_file() else [],
            "ic": _read_csv_series(ic_path, compute_drawdown=False) if ic_path.is_file() else [],
            "quantiles": _read_json_dict(qt_path) if qt_path.is_file() else None,
        },
        "artifacts": [_load_artifact_entry(run_dir, rel, meta[0], meta[1]) for rel, meta in seen_paths.items()],
    }


def _asset_bytes(name: str) -> bytes:
    return files("autoquant").joinpath("studio_assets", name).read_bytes()


def _handler(directory: Path, fixed_project_id: str | None, *, managed: bool) -> type[BaseHTTPRequestHandler]:
    headers_policy = studio_security_headers(managed=managed)

    class StudioHandler(BaseHTTPRequestHandler):
        server_version = "AutoQuantStudio"
        sys_version = ""

        def _send(self, status: HTTPStatus, content_type: str, body: bytes, *, cache_control: str = "no-store", head_only: bool = False) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache_control)
            for key, value in headers_policy.items():
                self.send_header(key, value)
            self.end_headers()
            if not head_only:
                self.wfile.write(body)

        def _send_json(self, status: HTTPStatus, payload: dict[str, Any], *, head_only: bool = False) -> None:
            raw = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
            self._send(status, "application/json; charset=utf-8", raw, head_only=head_only)

        def _route(self, *, head_only: bool = False) -> None:
            parsed = urlsplit(self.path)
            route_path, query = parsed.path, parse_qs(parsed.query, keep_blank_values=False)
            try:
                if route_path == "/api/v1/health":
                    self._send_json(
                        HTTPStatus.OK,
                        {"ok": True, "kind": STUDIO_HEALTH_KIND, "service": "autoquant-studio", "mode": "read-only", "version": current_version(), "managed": managed},
                        head_only=head_only,
                    )
                    return
                if route_path == "/api/v1/snapshot":
                    req_proj = query.get("project", [None])[0]
                    if fixed_project_id is not None and req_proj is not None and req_proj != fixed_project_id:
                        raise StudioNotFoundError(f"Server restricted to project {fixed_project_id!r}")
                    self._send_json(HTTPStatus.OK, build_studio_snapshot(directory, project_id=fixed_project_id or req_proj), head_only=head_only)
                    return
                if route_path == "/api/v1/run":
                    req_run = query.get("run", [None])[0]
                    if not req_run:
                        raise StudioError("Query parameter 'run' is required", code="studio.run-required")
                    detail = load_studio_run(directory, project_id=query.get("project", [None])[0], run_id=req_run, fixed_project_id=fixed_project_id)
                    self._send_json(HTTPStatus.OK, detail, head_only=head_only)
                    return
                if route_path.startswith("/api/v1/runs/"):
                    parts = route_path.removeprefix("/api/v1/runs/").split("/")
                    if len(parts) != 2 or not parts[0] or not parts[1]:
                        raise StudioError("Expected /api/v1/runs/<project_id>/<run_id>", code="studio.route")
                    detail = load_studio_run(directory, project_id=unquote(parts[0]), run_id=unquote(parts[1]), fixed_project_id=fixed_project_id)
                    self._send_json(HTTPStatus.OK, detail, head_only=head_only)
                    return
                if route_path in STUDIO_ASSETS:
                    asset_name, content_type = STUDIO_ASSETS[route_path]
                    self._send(HTTPStatus.OK, content_type, _asset_bytes(asset_name), cache_control="no-cache", head_only=head_only)
                    return
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": {"code": "studio.not-found", "message": f"Not found: {route_path}"}}, head_only=head_only)
            except (BrokenPipeError, ConnectionResetError):
                return
            except StudioNotFoundError as error:
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": {"code": "studio.not-found", "message": str(error), "issues": [i.to_dict() for i in error.issues]}}, head_only=head_only)
            except StudioError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": {"code": "studio.bad-request", "message": str(error), "issues": [i.to_dict() for i in error.issues]}}, head_only=head_only)
            except Exception as error:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": {"code": "studio.internal", "message": str(error)}}, head_only=head_only)

        def do_GET(self) -> None:
            self._route()

        def do_HEAD(self) -> None:
            self._route(head_only=True)

        def _read_only(self) -> None:
            self._send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"ok": False, "error": {"code": "studio.read-only", "message": "Studio routes are read-only"}})

        do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = _read_only

        def log_message(self, format: str, *args: Any) -> None:
            return

    return StudioHandler


class AutoQuantStudioServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def create_studio_server(
    path: str | Path,
    *,
    project_id: str | None = None,
    host: str = STANDALONE_STUDIO_HOST,
    port: int = STANDALONE_STUDIO_PORT,
    managed: bool = False,
) -> AutoQuantStudioServer:
    if not isinstance(port, int) or isinstance(port, bool) or not 0 <= port <= 65535:
        raise StudioError([_issue(port, "studio.port", "Studio port must be an integer 0..65535")])
    root = Path(path).expanduser().absolute()
    build_studio_snapshot(root, project_id=project_id)
    return AutoQuantStudioServer((host, port), _handler(root, project_id, managed=managed))


def serve_studio(
    path: str | Path,
    *,
    project_id: str | None = None,
    host: str | None = STANDALONE_STUDIO_HOST,
    port: int | None = STANDALONE_STUDIO_PORT,
    open_browser: bool = True,
    no_open: bool | None = None,
    explicit_host: bool = False,
    explicit_port: bool = False,
    managed: bool | None = None,
    environ: Mapping[str, str] | None = None,
) -> None:
    """Serve AutoQuant Studio in standalone mode or under OpenAlice Harness authority."""

    env = os.environ if environ is None else environ
    if managed is None:
        if env.get(HARNESS_CAPABILITY) == "studio":
            cli_host = (
                host
                if explicit_host or (host is not None and host != STANDALONE_STUDIO_HOST)
                else (host if host is not None and any(a == "--host" or a.startswith("--host=") for a in sys.argv[1:]) else None)
            )
            cli_port = (
                port
                if explicit_port or (port is not None and port != STANDALONE_STUDIO_PORT)
                else (port if port is not None and any(a == "--port" or a.startswith("--port=") for a in sys.argv[1:]) else None)
            )
        else:
            cli_host, cli_port = host, port
        eff_no_open = (not open_browser) if no_open is None else bool(no_open)
        launch = resolve_studio_launch(host=cli_host, port=cli_port, no_open=eff_no_open, environ=env)
    else:
        eff_open = open_browser if no_open is None else (not no_open)
        launch = StudioLaunch(
            host=STANDALONE_STUDIO_HOST if host is None else host,
            port=STANDALONE_STUDIO_PORT if port is None else port,
            open_browser=eff_open,
            managed=bool(managed),
        )

    server = create_studio_server(path, project_id=project_id, host=launch.host, port=launch.port, managed=launch.managed)
    display_host = "127.0.0.1" if launch.host in {"0.0.0.0", "::"} else launch.host
    url = f"http://{display_host}:{server.server_port}"
    print(f"AutoQuant Studio: {url}", flush=True)
    print("Mode: local read-only observation", flush=True)
    if launch.open_browser:
        threading.Thread(target=webbrowser.open, args=(url,), daemon=True).start()

    previous_sigterm = None
    if threading.current_thread() is threading.main_thread():
        previous_sigterm = signal.signal(signal.SIGTERM, lambda _s, _f: threading.Thread(target=server.shutdown, daemon=True).start())

    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        if previous_sigterm is not None:
            signal.signal(signal.SIGTERM, previous_sigterm)
        server.server_close()


STUDIO_SNAPSHOT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Studio Snapshot",
    "type": "object",
    "required": ["schema_version", "kind", "version", "generated_at", "source", "active_project_id", "projects"],
}
