from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

from autoquant.python_runner import interpreter_command, main as py_runner_main
from autoquant.skill_bundle import (
    SKILL_DISCOVERY_ROOTS,
    WORKSPACE_SKILLS_MANIFEST,
    SkillBundleError,
    bundled_workspace_skills,
    materialize_workspace_skills,
    remove_materialized_workspace_skills,
    verify_materialized_workspace_skills,
    workspace_skill_bundle_manifest,
)
from autoquant.version import current_version


class WorkspaceSkillsAndRunnerTests(unittest.TestCase):
    def test_bundled_skills_materialize_verify_and_remove(self) -> None:
        skills = bundled_workspace_skills()
        skill_ids = {s["id"] for s in skills}
        self.assertIn("acquire-market-ohlcv", skill_ids)
        self.assertIn("fetch-yahoo-ohlcv", skill_ids)
        self.assertGreaterEqual(len(skill_ids), 16)

        manifest = workspace_skill_bundle_manifest()
        self.assertEqual(manifest["harnessVersion"], current_version())
        self.assertEqual(manifest["harnessVersion"], "1.0.0")

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp) / "desk"
            ws.mkdir()
            written = materialize_workspace_skills(ws)
            self.assertTrue((ws / WORKSPACE_SKILLS_MANIFEST).is_file())
            for root in SKILL_DISCOVERY_ROOTS:
                self.assertTrue((ws / root / "fetch-yahoo-ohlcv" / "SKILL.md").is_file())

            verified = verify_materialized_workspace_skills(ws)
            self.assertEqual(verified["bundleSha256"], written["bundleSha256"])

            # Drift detection when a materialized copy is altered
            target_md = ws / ".agents" / "skills" / "fetch-yahoo-ohlcv" / "SKILL.md"
            original = target_md.read_text(encoding="utf-8")
            target_md.write_text(original + "\n<!-- drifted -->\n", encoding="utf-8")
            with self.assertRaises(SkillBundleError):
                verify_materialized_workspace_skills(ws)
            target_md.write_text(original, encoding="utf-8")
            verify_materialized_workspace_skills(ws)

            remove_materialized_workspace_skills(ws, written)
            self.assertFalse((ws / WORKSPACE_SKILLS_MANIFEST).exists())

    def test_python_runner_command(self) -> None:
        cmd = interpreter_command(["-c", "print(1)"])
        self.assertEqual(cmd, [sys.executable, "-c", "print(1)"])
        self.assertEqual(py_runner_main([]), 2)


if __name__ == "__main__":
    unittest.main()
