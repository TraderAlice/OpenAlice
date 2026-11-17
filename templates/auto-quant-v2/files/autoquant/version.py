"""AutoQuant distribution version and code/git provenance helpers."""

from __future__ import annotations

from collections.abc import Iterable
import hashlib
from importlib.metadata import PackageNotFoundError, version
import inspect
import re
import subprocess
from pathlib import Path
from typing import Any


COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
VERSION_PATTERN = re.compile(r'^version\s*=\s*"([^"]+)"', re.MULTILINE)
DIRTY_PATHS = (
    "autoquant",
    "hatch_build.py",
    "pyproject.toml",
    "uv.lock",
)


def _pyproject_version() -> str | None:
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    try:
        text = pyproject.read_text(encoding="utf-8")
    except OSError:
        return None
    match = VERSION_PATTERN.search(text)
    return match.group(1) if match else None


def current_version() -> str:
    """Return the installed AutoQuant version or source pyproject fallback."""

    try:
        return version("auto-quant")
    except PackageNotFoundError:
        return _pyproject_version() or "1.0.0"


def _embedded_build_identity() -> dict[str, Any] | None:
    try:
        from ._build_identity import BUILD_COMMIT, BUILD_DIRTY
    except (ImportError, AttributeError):
        return None
    if (
        isinstance(BUILD_COMMIT, str)
        and (COMMIT_PATTERN.fullmatch(BUILD_COMMIT) or BUILD_COMMIT == "unavailable")
        and isinstance(BUILD_DIRTY, bool)
    ):
        return {
            "commit": BUILD_COMMIT,
            "dirty": BUILD_DIRTY,
            "provenance": "embedded-distribution",
        }
    return None


def _source_checkout_identity(root: Path) -> dict[str, Any] | None:
    try:
        top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=root,
            capture_output=True,
            check=True,
            text=True,
            timeout=5,
        ).stdout.strip()
        if Path(top).resolve() != root.resolve():
            return None
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            check=True,
            text=True,
            timeout=5,
        ).stdout.strip()
        if not COMMIT_PATTERN.fullmatch(commit):
            return None
        status = subprocess.run(
            ["git", "status", "--porcelain", "--", *DIRTY_PATHS],
            cwd=root,
            capture_output=True,
            check=True,
            text=True,
            timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return {
        "commit": commit,
        "dirty": bool(status.strip()),
        "provenance": "source-checkout",
    }


def current_build_identity() -> dict[str, Any]:
    """Return embedded distribution identity or an exact-root source identity."""

    embedded = _embedded_build_identity()
    if embedded is not None:
        return embedded
    source_root = Path(__file__).resolve().parents[1]
    checkout = _source_checkout_identity(source_root)
    if checkout is not None:
        return checkout
    return {
        "commit": "unavailable",
        "dirty": False,
        "provenance": "unavailable",
    }


def git_repo_state(cwd: str | Path | None = None) -> tuple[str, bool]:
    """Resolve `(git_commit, git_dirty)` for a workspace or project directory."""

    target = Path(cwd or ".").expanduser().resolve()
    if target.is_file():
        target = target.parent
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=target,
            capture_output=True,
            check=True,
            text=True,
            timeout=3,
        ).stdout.strip()
        if not COMMIT_PATTERN.fullmatch(commit):
            return "unavailable", False
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=target,
            capture_output=True,
            check=True,
            text=True,
            timeout=3,
        ).stdout
        return commit, bool(status.strip())
    except (OSError, subprocess.SubprocessError):
        return "unavailable", False


def compute_code_sha256(
    code_paths: str | Path | Iterable[str | Path] | None = None,
    *,
    fallback_payload: bytes | None = None,
) -> str:
    """Hash explicit script/module paths or discover the calling script file."""

    paths: list[Path] = []
    if code_paths is not None:
        if isinstance(code_paths, (str, Path)):
            raw_items: Iterable[str | Path] = [code_paths]
        else:
            raw_items = code_paths
        for item in raw_items:
            candidate = Path(item).expanduser().resolve()
            if candidate.is_dir():
                paths.extend(
                    p for p in sorted(candidate.rglob("*.py")) if p.is_file()
                )
            elif candidate.is_file():
                paths.append(candidate)
            else:
                raise FileNotFoundError(f"Code provenance path does not exist: {item}")
    else:
        pkg_dir = Path(__file__).resolve().parent
        for frame_info in inspect.stack()[1:]:
            filename = frame_info.filename
            if not filename or filename.startswith("<"):
                continue
            candidate = Path(filename).resolve()
            if pkg_dir in candidate.parents or "site-packages" in candidate.parts:
                continue
            if candidate.name == "unittest" or "/unittest/" in candidate.as_posix():
                continue
            if candidate.is_file():
                paths.append(candidate)
                break

    digest = hashlib.sha256()
    if paths:
        unique_sorted = sorted({p.resolve() for p in paths}, key=lambda p: p.as_posix())
        for file_path in unique_sorted:
            digest.update(file_path.name.encode("utf-8"))
            digest.update(b"\0")
            digest.update(file_path.read_bytes())
            digest.update(b"\0")
        return digest.hexdigest()

    if fallback_payload is not None:
        digest.update(fallback_payload)
    else:
        digest.update(f"autoquant:{current_version()}".encode("utf-8"))
    return digest.hexdigest()


def resolve_provenance(
    *,
    code_paths: str | Path | Iterable[str | Path] | None = None,
    cwd: str | Path | None = None,
    fallback_payload: bytes | None = None,
) -> dict[str, Any]:
    """Build canonical run/holdout provenance metadata."""

    git_commit, git_dirty = git_repo_state(cwd)
    return {
        "harness_version": current_version(),
        "code_sha256": compute_code_sha256(
            code_paths,
            fallback_payload=fallback_payload,
        ),
        "git_commit": git_commit,
        "git_dirty": git_dirty,
    }
