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


class TestMigrationV4ToV5(unittest.TestCase):
    def test_migrate_profile_with_reason_aliases(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-migrate-") as tmp:
            tmp_dir = Path(tmp)
            legacy_path = tmp_dir / "legacy.json"
            output_path = tmp_dir / "migrated.yaml"
            report_path = tmp_dir / "migration_report.json"
            conversion_path = tmp_dir / "conversion_log.json"

            legacy_payload = {
                "thresholds": {
                    "meanPboMax": 0.18,
                    "meanDsrProbabilityMin": 0.55,
                    "fdrQMax": 0.08,
                    "minBacktestDays": 210,
                },
                "hard_block_reason_codes_g3": [
                    "LEAKAGE_DETECTED",
                    "SOURCE_HEALTH_FAIL",
                    "HARD_METRIC_MISSING",
                ],
            }
            legacy_path.write_text(
                json.dumps(legacy_payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

            proc = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS_DIR / "migrate_v4_to_v5.py"),
                    "--input",
                    str(legacy_path),
                    "--base-profile",
                    str(REPO_ROOT / "data/config/profiles/profile_m0_72h.v5_1.yaml"),
                    "--output",
                    str(output_path),
                    "--report-output",
                    str(report_path),
                    "--conversion-log-output",
                    str(conversion_path),
                ],
                cwd=str(REPO_ROOT),
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(0, proc.returncode, msg=proc.stderr)
            self.assertTrue(output_path.exists())
            self.assertTrue(report_path.exists())
            self.assertTrue(conversion_path.exists())

            migrated = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(0.18, migrated["strategy"]["pbo_max"])
            self.assertEqual(0.55, migrated["strategy"]["dsr_probability_min"])
            self.assertEqual(0.08, migrated["strategy"]["fdr_q_max"])
            self.assertEqual(210, migrated["strategy"]["min_backtest_days"])
            self.assertIn(
                "HARD_LEAKAGE_DETECTED",
                migrated["hard_block_reason_codes_g3"],
            )
            self.assertIn(
                "HARD_SOURCE_HEALTH_FAIL",
                migrated["hard_block_reason_codes_g3"],
            )


if __name__ == "__main__":
    unittest.main()
