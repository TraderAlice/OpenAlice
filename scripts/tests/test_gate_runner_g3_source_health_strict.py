#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from gate_runner import STATUS_POLICY_FAIL, _gate_g3  # noqa: E402


class TestGateRunnerG3SourceHealthStrict(unittest.TestCase):
    def test_strict_mode_fails_when_source_health_fields_missing(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-g3-health-") as tmp:
            tmp_dir = Path(tmp)
            run_dir = tmp_dir / "run"
            run_dir.mkdir(parents=True, exist_ok=True)

            dataset = tmp_dir / "dataset.json"
            features = tmp_dir / "features.json"
            labels = tmp_dir / "labels.json"
            split = tmp_dir / "split.json"
            for path in (dataset, features, labels, split):
                path.write_text("{}\n", encoding="utf-8")

            strategy_metrics = tmp_dir / "strategy_metrics.json"
            strategy_metrics.write_text(
                json.dumps(
                    {
                        "min_trades": 30,
                        "min_backtest_days": 220,
                        "min_effective_observations": 600,
                        "pbo": 0.1,
                        "dsr_probability": 0.7,
                        "fdr_q": 0.05,
                        "baseline_net_trim10_mean": 100.0,
                        "candidate_net_trim10_mean": 95.0,
                        "statistics_lock": {
                            "pbo_method": "cscv_pbo_v1",
                            "dsr_method": "lopez_de_prado_dsr_v1",
                            "fdr_method": "benjamini_hochberg_v1",
                            "seed_policy": "fixed_seed_set_v1",
                            "seed_set": [7, 42, 87],
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            admission = tmp_dir / "admission.json"
            admission.write_text(
                json.dumps(
                    {
                        "total_candidates": 3,
                        "rows": [
                            {"main_eligible": True},
                            {"main_eligible": True},
                            {"main_eligible": True},
                        ],
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            external = tmp_dir / "external.json"
            external.write_text(
                json.dumps(
                    {
                        "baseline": {"net_trim10_mean": 100.0},
                        "aggregate": [{"net_trim10_mean": 95.0}],
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            # Missing most source health fields on purpose.
            health = tmp_dir / "health.json"
            health.write_text(json.dumps({"stale_watch_minutes": 5}) + "\n", encoding="utf-8")

            budget = tmp_dir / "budget.json"
            budget.write_text(
                json.dumps(
                    {
                        "daily_tokens": 1000,
                        "per_task_tokens": 100,
                        "daily_cost_usd": 1.0,
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            profile = {
                "validation_mode": "strict",
                "strategy": {
                    "min_poc_count": 3,
                    "pass_candidates_min": 1,
                    "min_trades": 20,
                    "min_backtest_days": 180,
                    "min_effective_observations": 350,
                    "pbo_max": 0.2,
                    "dsr_probability_min": 0.5,
                    "fdr_q_max": 0.1,
                    "stress_net_trim10_decline_max": 0.15,
                },
                "source_health": {
                    "stale_watch_minutes_max": 90,
                    "stale_optimize_minutes_max": 20,
                    "stale_queue_drain_minutes_max": 20,
                    "queue_length_max": 36,
                    "legacy_ratio_max": 0.65,
                },
                "budget": {
                    "daily_token_soft_cap": 800000,
                    "daily_token_hard_cap": 1200000,
                    "per_task_token_hard_cap": 120000,
                    "cost_soft_cap_usd": 40.0,
                    "cost_hard_cap_usd": 80.0,
                },
            }
            registry = {
                "statistics_lock": {
                    "pbo_method": "cscv_pbo_v1",
                    "dsr_method": "lopez_de_prado_dsr_v1",
                    "fdr_method": "benjamini_hochberg_v1",
                    "seed_policy": "fixed_seed_set_v1",
                    "seed_set": [7, 42, 87],
                }
            }

            result = _gate_g3(
                run_id="g3_test",
                run_dir=run_dir,
                profile=profile,
                registry=registry,
                strategy_metrics_path=strategy_metrics,
                admission_report_path=admission,
                external_report_path=external,
                health_report_path=health,
                budget_usage_path=budget,
                dataset_path=dataset,
                features_path=features,
                labels_path=labels,
                split_path=split,
            )

            self.assertEqual(STATUS_POLICY_FAIL, result["status"])
            self.assertIn("HARD_SOURCE_HEALTH_FAIL", result["reasonCodes"])
            issues = result["blockingIssues"]
            self.assertTrue(
                any("source health metric missing:" in item for item in issues),
                msg=str(issues),
            )


if __name__ == "__main__":
    unittest.main()
