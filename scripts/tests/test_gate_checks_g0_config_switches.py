#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from gate_checks_g0 import run_g0  # noqa: E402


class TestGateChecksG0ConfigSwitches(unittest.TestCase):
    def test_respects_optional_switches(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-g0-switch-") as tmp:
            tmp_dir = Path(tmp)
            reason_codes_path = tmp_dir / "reason_codes.json"
            reason_codes_path.write_text(
                '{"codes":[{"code":"HARD_REASON_CODE_UNKNOWN"}]}\n',
                encoding="utf-8",
            )

            profile = {
                "g0": {
                    "clock_drift_ms_max": 2000,
                    "require_reason_code_lint": False,
                    "require_secrets_hygiene": False,
                    "require_command_availability": False,
                },
                "hard_block_reason_codes_g3": ["HARD_METRIC_MISSING"],
            }

            with (
                mock.patch("gate_checks_g0.lint_reason_codes", return_value=["bad"]),
                mock.patch(
                    "gate_checks_g0.validate_required_codes", return_value=["missing"]
                ),
                mock.patch("gate_checks_g0.command_availability", return_value=["node"]),
                mock.patch("gate_checks_g0.scan_repo", return_value=[{"x": 1}]),
                mock.patch("gate_checks_g0.measure_clock_drift_ms", return_value=0),
            ):
                report = run_g0(
                    repo_root=REPO_ROOT,
                    profile=profile,
                    reason_codes_path=reason_codes_path,
                )

            self.assertTrue(report["passed"])
            self.assertEqual([], report["issues"])
            self.assertEqual([], report["reasonCodes"])
            details = report["details"]
            self.assertTrue(details.get("reasonCodeLintSkipped"))
            self.assertTrue(details.get("commandAvailabilitySkipped"))
            self.assertTrue(details.get("secretsHygieneSkipped"))


if __name__ == "__main__":
    unittest.main()
