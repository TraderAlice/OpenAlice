#!/usr/bin/env python3
from __future__ import annotations

import time
import unittest
from pathlib import Path

import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from gate_runner import _call_gate_fn_with_timeout  # noqa: E402


class TestGateRunnerTimeout(unittest.TestCase):
    def test_returns_when_gate_finishes_before_timeout(self) -> None:
        def gate_fn(_: int) -> dict[str, str]:
            return {"status": "pass"}

        outcome = _call_gate_fn_with_timeout(gate_fn, 1, 3)
        self.assertEqual("pass", outcome["status"])

    def test_raises_timeout_for_slow_gate(self) -> None:
        def gate_fn(_: int) -> dict[str, str]:
            time.sleep(2)
            return {"status": "pass"}

        with self.assertRaises(TimeoutError):
            _call_gate_fn_with_timeout(gate_fn, 1, 1)


if __name__ == "__main__":
    unittest.main()
