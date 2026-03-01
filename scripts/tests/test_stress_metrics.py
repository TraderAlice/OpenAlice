#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path

import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from stress_metrics import FORMULA_HASH, FORMULA_ID, stress_net_trim10_decline  # noqa: E402


class TestStressMetrics(unittest.TestCase):
    def test_formula_metadata_stable(self) -> None:
        self.assertEqual("stress_net_trim10_decline_v1", FORMULA_ID)
        self.assertEqual(64, len(FORMULA_HASH))

    def test_decline_positive_when_candidate_below_baseline(self) -> None:
        decline = stress_net_trim10_decline(100.0, 85.0)
        self.assertAlmostEqual(0.15, decline, places=8)

    def test_decline_zero_when_candidate_above_baseline(self) -> None:
        decline = stress_net_trim10_decline(100.0, 120.0)
        self.assertAlmostEqual(0.0, decline, places=8)

    def test_decline_handles_zero_baseline(self) -> None:
        decline = stress_net_trim10_decline(0.0, 0.0)
        self.assertAlmostEqual(0.0, decline, places=8)


if __name__ == "__main__":
    unittest.main()
