"""Hatch build hook that freezes honest source provenance into distributions."""

from __future__ import annotations

import ast
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
EMBEDDED_IDENTITY = Path("autoquant/_build_identity.py")
DIRTY_PATHS = (
    "autoquant",
    "hatch_build.py",
    "pyproject.toml",
    "uv.lock",
)


def _embedded_identity(root: Path) -> tuple[str, bool] | None:
    path = root / EMBEDDED_IDENTITY
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (FileNotFoundError, OSError, SyntaxError, UnicodeError):
        return None
    values: dict[str, object] = {}
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in {"BUILD_COMMIT", "BUILD_DIRTY"}
        ):
            try:
                values[node.targets[0].id] = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                return None
    commit = values.get("BUILD_COMMIT")
    dirty = values.get("BUILD_DIRTY")
    if (
        isinstance(commit, str)
        and (COMMIT_PATTERN.fullmatch(commit) or commit == "unavailable")
        and isinstance(dirty, bool)
    ):
        return commit, dirty
    return None


def _checkout_identity(root: Path) -> tuple[str, bool] | None:
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
    return commit, bool(status.strip())


def resolve_build_identity(root: Path) -> tuple[str, bool]:
    """Resolve embedded sdist identity first, then an exact-root Git checkout."""

    embedded = _embedded_identity(root)
    if embedded is not None:
        return embedded
    checkout = _checkout_identity(root)
    if checkout is not None:
        return checkout
    return "unavailable", False


def render_build_identity(commit: str, dirty: bool) -> str:
    return (
        '"""Generated distribution build identity; do not edit."""\n\n'
        f"BUILD_COMMIT = {commit!r}\n"
        f"BUILD_DIRTY = {dirty!r}\n"
    )


class CustomBuildHook(BuildHookInterface):
    """Force one generated identity module into every distribution target."""

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        commit, dirty = resolve_build_identity(Path(self.root))
        generated_root = Path(tempfile.mkdtemp(prefix="autoquant-build-identity-"))
        generated = generated_root / "_build_identity.py"
        generated.write_text(
            render_build_identity(commit, dirty),
            encoding="utf-8",
        )
        self._generated_root = generated_root
        build_data["force_include"][str(generated)] = EMBEDDED_IDENTITY.as_posix()

    def finalize(
        self,
        version: str,
        build_data: dict[str, Any],
        artifact_path: str,
    ) -> None:
        generated_root = getattr(self, "_generated_root", None)
        if generated_root is not None:
            shutil.rmtree(generated_root, ignore_errors=True)
