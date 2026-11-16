"""Versioned Workspace Skill bundle discovery and materialization."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from .version import current_version


WORKSPACE_SKILLS_MANIFEST = "autoquant-skills.json"
SKILL_DISCOVERY_ROOTS = (".agents/skills", ".claude/skills")
SKILL_SOURCE_ROOT = Path(__file__).resolve().parent / "workspace_skills"


class SkillBundleError(ValueError):
    """Raised when the bundled or materialized Workspace Skills are invalid."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _skill_files(skill_root: Path) -> list[dict[str, str]]:
    files: list[dict[str, str]] = []
    for path in sorted(skill_root.rglob("*")):
        relative_parts = path.relative_to(skill_root).parts
        if "__pycache__" in relative_parts or path.suffix == ".pyc":
            continue
        if path.is_symlink():
            raise SkillBundleError(f"Bundled Skill paths cannot be symlinks: {path}")
        if not path.is_file():
            continue
        relative = path.relative_to(skill_root).as_posix()
        files.append({"path": relative, "sha256": _sha256(path)})
    if not files or files[0]["path"] == "":
        raise SkillBundleError(f"Bundled Skill is empty: {skill_root}")
    return files


def bundled_workspace_skills() -> tuple[dict[str, Any], ...]:
    """Return the canonical Skill inventory shipped by this Harness."""

    if not SKILL_SOURCE_ROOT.is_dir() or SKILL_SOURCE_ROOT.is_symlink():
        raise SkillBundleError(
            f"Bundled Skill source is unavailable: {SKILL_SOURCE_ROOT}"
        )
    skills: list[dict[str, Any]] = []
    for path in sorted(SKILL_SOURCE_ROOT.iterdir()):
        if path.name.startswith("."):
            continue
        if path.is_symlink() or not path.is_dir():
            raise SkillBundleError(f"Invalid bundled Skill entry: {path}")
        skill_file = path / "SKILL.md"
        if not skill_file.is_file() or skill_file.is_symlink():
            raise SkillBundleError(f"Bundled Skill lacks a real SKILL.md: {path}")
        if not path.name or any(
            character not in "abcdefghijklmnopqrstuvwxyz0123456789-"
            for character in path.name
        ):
            raise SkillBundleError(f"Invalid bundled Skill id: {path.name}")
        skills.append(
            {
                "id": path.name,
                "files": _skill_files(path),
            }
        )
    if not skills:
        raise SkillBundleError("AutoQuant ships no Workspace Skills")
    return tuple(skills)


def workspace_skill_bundle_manifest() -> dict[str, Any]:
    """Build the deterministic manifest for the canonical Skill bundle."""

    skills = list(bundled_workspace_skills())
    canonical = json.dumps(
        skills,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return {
        "schemaVersion": 1,
        "kind": "autoquant-workspace-skill-bundle",
        "harnessVersion": current_version(),
        "discoveryRoots": list(SKILL_DISCOVERY_ROOTS),
        "bundleSha256": hashlib.sha256(canonical).hexdigest(),
        "skills": skills,
    }


def _remove_empty_parents(path: Path, stop: Path) -> None:
    current = path
    while current != stop and current.exists():
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def materialize_workspace_skills(
    workspace_root: str | Path,
) -> dict[str, Any]:
    """Copy the canonical bundle into Agent discovery roots transactionally."""

    root = Path(workspace_root).expanduser().absolute()
    manifest_path = root / WORKSPACE_SKILLS_MANIFEST
    if manifest_path.exists() or manifest_path.is_symlink():
        raise SkillBundleError(
            f"Workspace Skill manifest already exists: {manifest_path}"
        )
    manifest = workspace_skill_bundle_manifest()
    skills = manifest["skills"]

    destinations: list[tuple[Path, Path]] = []
    for discovery_root in SKILL_DISCOVERY_ROOTS:
        for skill in skills:
            destination = root / discovery_root / skill["id"]
            if destination.exists() or destination.is_symlink():
                raise SkillBundleError(
                    f"Workspace Skill destination already exists: {destination}"
                )
            destinations.append((SKILL_SOURCE_ROOT / skill["id"], destination))

    copied: list[Path] = []
    created_parents: list[Path] = []
    temporary_manifest: Path | None = None
    try:
        for source, destination in destinations:
            parent = destination.parent
            if not parent.exists():
                parent.mkdir(parents=True)
                created_parents.append(parent)
            shutil.copytree(source, destination)
            copied.append(destination)

        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=root,
            prefix=f".{WORKSPACE_SKILLS_MANIFEST}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            json.dump(manifest, handle, indent=2, sort_keys=True)
            handle.write("\n")
            temporary_manifest = Path(handle.name)
        os.replace(temporary_manifest, manifest_path)
        temporary_manifest = None
    except Exception:
        if temporary_manifest is not None:
            temporary_manifest.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        for destination in reversed(copied):
            shutil.rmtree(destination, ignore_errors=True)
        for parent in reversed(created_parents):
            _remove_empty_parents(parent, root)
        raise
    return manifest


def verify_materialized_workspace_skills(
    workspace_root: str | Path,
) -> dict[str, Any]:
    """Verify both discovery copies against the checked-in canonical source."""

    root = Path(workspace_root).expanduser().absolute()
    manifest_path = root / WORKSPACE_SKILLS_MANIFEST
    try:
        observed = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SkillBundleError(
            f"Workspace Skill manifest is unreadable: {manifest_path}"
        ) from exc
    expected = workspace_skill_bundle_manifest()
    if observed != expected:
        raise SkillBundleError(
            "Workspace Skill manifest does not match the current Harness bundle"
        )
    for discovery_root in SKILL_DISCOVERY_ROOTS:
        for skill in expected["skills"]:
            destination = root / discovery_root / skill["id"]
            if not destination.is_dir() or destination.is_symlink():
                raise SkillBundleError(
                    f"Workspace Skill is unavailable: {destination}"
                )
            if _skill_files(destination) != skill["files"]:
                raise SkillBundleError(
                    f"Workspace Skill copy has drifted: {destination}"
                )
    return expected


def remove_materialized_workspace_skills(
    workspace_root: str | Path,
    manifest: dict[str, Any],
) -> None:
    """Remove only Skill ids named by a materialization result."""

    root = Path(workspace_root).expanduser().absolute()
    for discovery_root in SKILL_DISCOVERY_ROOTS:
        for skill in manifest.get("skills", []):
            identifier = skill.get("id")
            if not isinstance(identifier, str) or not identifier:
                continue
            destination = root / discovery_root / identifier
            if destination.is_dir() and not destination.is_symlink():
                shutil.rmtree(destination)
        _remove_empty_parents(root / discovery_root, root)
    (root / WORKSPACE_SKILLS_MANIFEST).unlink(missing_ok=True)
