#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"


class TestMigrationCompare(unittest.TestCase):
    def test_rejects_non_verdict_payloads(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-migrate-compare-") as tmp:
            tmp_dir = Path(tmp)
            baseline = tmp_dir / "baseline.json"
            candidate = tmp_dir / "candidate.json"
            output = tmp_dir / "report.json"

            baseline.write_text('{"foo":"bar"}\n', encoding="utf-8")
            candidate.write_text('{"hello":"world"}\n', encoding="utf-8")

            proc = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS_DIR / "migration_compare.py"),
                    "--baseline",
                    str(baseline),
                    "--candidate",
                    str(candidate),
                    "--output",
                    str(output),
                ],
                cwd=str(REPO_ROOT),
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(2, proc.returncode, msg=proc.stdout + proc.stderr)
            self.assertTrue(output.exists())
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertFalse(payload.get("valid", True))
            self.assertGreater(len(payload.get("errors", [])), 0)


if __name__ == "__main__":
    unittest.main()
