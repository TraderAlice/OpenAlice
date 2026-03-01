#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path

import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from runner_guard import STATE_CLOSED, STATE_HALF_OPEN, STATE_OPEN, evaluate_runner_guard  # noqa: E402


class TestRunnerGuard(unittest.TestCase):
    def test_learning_mode_never_hard_opens(self) -> None:
        policy = {
            "mode": "learning",
            "thresholds": {"failRateMax": 0.1, "timeoutRateMax": 0.05},
        }
        history = [
            {"status": "policy_fail", "blockingIssues": ["timeout"]},
            {"status": "tool_error", "blockingIssues": ["timeout"]},
        ]
        report = evaluate_runner_guard(policy, history, STATE_CLOSED)
        self.assertEqual(STATE_CLOSED, report["state"])
        self.assertGreater(len(report["issues"]), 0)

    def test_enforced_mode_opens_on_breach(self) -> None:
        policy = {
            "mode": "enforced",
            "thresholds": {"failRateMax": 0.1, "timeoutRateMax": 0.05},
        }
        history = [
            {"status": "policy_fail", "blockingIssues": ["timeout"]},
            {"status": "tool_error", "blockingIssues": ["timeout"]},
        ]
        report = evaluate_runner_guard(policy, history, STATE_CLOSED)
        self.assertEqual(STATE_OPEN, report["state"])

    def test_open_to_half_open_to_closed_recovery(self) -> None:
        policy = {
            "mode": "enforced",
            "thresholds": {"failRateMax": 0.5, "timeoutRateMax": 0.5},
        }
        history = [{"status": "pass", "blockingIssues": []}]
        first = evaluate_runner_guard(policy, history, STATE_OPEN)
        self.assertEqual(STATE_HALF_OPEN, first["state"])
        second = evaluate_runner_guard(policy, history, STATE_HALF_OPEN)
        self.assertEqual(STATE_CLOSED, second["state"])


if __name__ == "__main__":
    unittest.main()
