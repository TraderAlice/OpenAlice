"""Materialize canonical AutoQuant Skills into the repository Workspace."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from autoquant.skill_bundle import (
    SKILL_DISCOVERY_ROOTS,
    WORKSPACE_SKILLS_MANIFEST,
    materialize_workspace_skills,
    workspace_skill_bundle_manifest,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", nargs="?", default=".")
    parser.add_argument(
        "--replace-generated",
        action="store_true",
        help="replace only current canonical Skill ids and the bundle manifest",
    )
    args = parser.parse_args()
    root = Path(args.workspace).expanduser().absolute()
    if args.replace_generated:
        manifest = workspace_skill_bundle_manifest()
        for discovery_root in SKILL_DISCOVERY_ROOTS:
            for skill in manifest["skills"]:
                destination = root / discovery_root / skill["id"]
                if destination.exists() and not destination.is_symlink():
                    shutil.rmtree(destination)
        (root / WORKSPACE_SKILLS_MANIFEST).unlink(missing_ok=True)
    manifest = materialize_workspace_skills(root)
    print(
        f"materialized {len(manifest['skills'])} Skills into "
        + ", ".join(SKILL_DISCOVERY_ROOTS)
    )


if __name__ == "__main__":
    main()
