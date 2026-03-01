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


class TestGateRunnerE2E(unittest.TestCase):
    def test_gate_runner_generates_verdict_and_checkpoints(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-gate-runner-") as tmp:
            tmp_dir = Path(tmp)
            output_root = tmp_dir / "runtime" / "gates"
            history_path = tmp_dir / "runtime" / "history.ndjson"
            run_id = "e2e_run_001"

            proc = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS_DIR / "gate_runner.py"),
                    "--repo-root",
                    str(REPO_ROOT),
                    "--output-root",
                    str(output_root),
                    "--history",
                    str(history_path),
                    "--run-id",
                    run_id,
                ],
                cwd=str(REPO_ROOT),
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertIn(proc.returncode, (0, 2), msg=proc.stderr)

            run_dir = output_root / run_id
            summary_path = run_dir / "run_summary.json"
            verdict_path = run_dir / "verdict.v2.json"
            checkpoints_path = run_dir / "gate_checkpoints.json"

            self.assertTrue(summary_path.exists(), "run_summary.json missing")
            self.assertTrue(verdict_path.exists(), "verdict.v2.json missing")
            self.assertTrue(checkpoints_path.exists(), "gate_checkpoints.json missing")

            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            verdict = json.loads(verdict_path.read_text(encoding="utf-8"))
            checkpoints_payload = json.loads(checkpoints_path.read_text(encoding="utf-8"))

            self.assertEqual(run_id, summary["runId"])
            self.assertIn(
                verdict["result"],
                {"NO_GO", "PAPER_ONLY_GO", "BLOCKED_WITH_RECOVERY_PLAN"},
            )

            items = checkpoints_payload.get("items")
            self.assertIsInstance(items, list)
            gates = {item.get("gate") for item in items if isinstance(item, dict)}
            self.assertEqual({"G0", "G1", "G2", "G3", "G4"}, gates)


if __name__ == "__main__":
    unittest.main()
