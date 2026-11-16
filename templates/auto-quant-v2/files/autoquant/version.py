"""AutoQuant distribution version and immutable build provenance."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
import re
import subprocess
from pathlib import Path
from typing import Any


COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
DIRTY_PATHS = (
    "autoquant",
    "hatch_build.py",
    "pyproject.toml",
    "uv.lock",
)


def current_version() -> str:
    """Return the installed AutoQuant version, or an honest unknown fallback."""

    try:
        return version("auto-quant")
    except PackageNotFoundError:
        return "0.0.0"


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
