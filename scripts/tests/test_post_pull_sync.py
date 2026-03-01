#!/usr/bin/env python3
"""Regression tests for scripts/post_pull_sync.py orchestration behavior."""

from __future__ import annotations

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts/post_pull_sync.py"


def load_module():
    spec = importlib.util.spec_from_file_location("post_pull_sync", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load module: {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cp(returncode: int, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(
        args=["mocked"],
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )


class TestPostPullSync(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mod = load_module()

    def test_resolve_overall_exit_priority(self) -> None:
        steps = [
            {"name": "a", "status": "policy_fail", "exitCode": 2},
            {"name": "b", "status": "tool_error", "exitCode": 3},
            {"name": "c", "status": "pass", "exitCode": 0},
        ]
        self.assertEqual(3, self.mod.resolve_overall_exit(steps))

    def test_resolve_overall_exit_maps_unknown_nonzero_to_tool_error(self) -> None:
        steps = [
            {"name": "a", "status": "failed", "exitCode": 127},
            {"name": "b", "status": "pass", "exitCode": 0},
        ]
        self.assertEqual(3, self.mod.resolve_overall_exit(steps))

    def test_run_sync_auto_skips_evidence_when_packet_missing(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-postpull-skip-") as tmp:
            repo_root = Path(tmp)
            with patch.object(
                self.mod,
                "run_cmd",
                side_effect=[cp(0), cp(0), cp(0)],
            ) as mocked_run_cmd:
                with patch.object(
                    self.mod,
                    "load_scheduler_status",
                    return_value={"heartbeatConfig": {}, "heartbeatCronJob": {}},
                ):
                    report, exit_code = self.mod.run_sync(repo_root, "auto")

            self.assertEqual(0, exit_code)
            self.assertEqual(3, mocked_run_cmd.call_count)
            self.assertFalse(bool(report.get("evidenceStepExecuted")))

            steps = report.get("steps", [])
            self.assertEqual(4, len(steps))
            evidence_step = steps[3]
            self.assertEqual("validate_decision_packet", evidence_step.get("name"))
            self.assertEqual("skipped", evidence_step.get("status"))

    def test_run_sync_auto_runs_evidence_when_packet_exists(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-postpull-run-") as tmp:
            repo_root = Path(tmp)
            packet_dir = repo_root / "decision_packet"
            packet_dir.mkdir(parents=True, exist_ok=True)
            (packet_dir / "evidence_pack.json").write_text("{}\n", encoding="utf-8")

            with patch.object(
                self.mod,
                "run_cmd",
                side_effect=[cp(0), cp(0), cp(0), cp(2)],
            ) as mocked_run_cmd:
                with patch.object(
                    self.mod,
                    "load_scheduler_status",
                    return_value={"heartbeatConfig": {}, "heartbeatCronJob": {}},
                ):
                    report, exit_code = self.mod.run_sync(repo_root, "auto")

            self.assertEqual(2, exit_code)
            self.assertEqual(4, mocked_run_cmd.call_count)
            self.assertTrue(bool(report.get("evidenceStepExecuted")))
            self.assertEqual("policy_fail", report["overall"]["status"])

    def test_run_sync_prioritizes_tool_error_across_steps(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-postpull-toolerr-") as tmp:
            repo_root = Path(tmp)

            with patch.object(
                self.mod,
                "run_cmd",
                side_effect=[cp(0), cp(3), cp(0)],
            ):
                with patch.object(
                    self.mod,
                    "load_scheduler_status",
                    return_value={"heartbeatConfig": {}, "heartbeatCronJob": {}},
                ):
                    report, exit_code = self.mod.run_sync(repo_root, "never")

            self.assertEqual(3, exit_code)
            self.assertEqual("tool_error", report["overall"]["status"])


if __name__ == "__main__":
    unittest.main()
