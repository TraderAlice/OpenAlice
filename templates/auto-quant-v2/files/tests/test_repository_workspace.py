from __future__ import annotations

import unittest
from pathlib import Path

from autoquant.skill_bundle import (
    WORKSPACE_SKILLS_MANIFEST,
    bundled_workspace_skills,
    verify_materialized_workspace_skills,
)
from autoquant.studio import build_studio_snapshot
from autoquant.version import current_version
from autoquant.workspace import list_workspace_projects, load_workspace


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


class RepositoryWorkspaceTests(unittest.TestCase):
    def test_repository_skill_bundle_matches_current_harness(self) -> None:
        skills = bundled_workspace_skills()
        self.assertEqual(len(skills), 16)
        if (REPOSITORY_ROOT / WORKSPACE_SKILLS_MANIFEST).is_file():
            manifest = verify_materialized_workspace_skills(REPOSITORY_ROOT)
            self.assertEqual(manifest["harnessVersion"], current_version())
            self.assertEqual(len(manifest["skills"]), 16)

    def test_repository_ignores_workspace_staging(self) -> None:
        ignore_rules = (
            (REPOSITORY_ROOT / ".gitignore")
            .read_text(encoding="utf-8")
            .splitlines()
        )

        self.assertIn("/staging/", ignore_rules)

    def test_repository_workspace_starts_clean_and_studio_ready(self) -> None:
        workspace = load_workspace(REPOSITORY_ROOT, use_local_override=False)

        self.assertIsNone(workspace.manifest.default_project)
        self.assertEqual(list_workspace_projects(REPOSITORY_ROOT), [])
        snapshot = build_studio_snapshot(REPOSITORY_ROOT)
        self.assertEqual(snapshot["source"]["scope"], "workspace")
        self.assertEqual(snapshot["projects"], [])


if __name__ == "__main__":
    unittest.main()
