from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

import numpy as np
import pandas as pd

import autoquant as aq


class GuardrailsAndHoldoutTests(unittest.TestCase):
    def _create_project_with_data(self, root: Path) -> aq.ProjectContext:
        ws = aq.initialize_workspace(root / "desk", materialize_skills=False)
        proj = aq.create_project(
            ws,
            "us-trend",
            train_end="2023-02-28",
            val_end="2023-04-30",
            holdout_end="2023-06-30",
        )
        dates = pd.bdate_range("2023-01-02", "2023-06-30", tz="UTC")
        rows = []
        for idx, sym in enumerate(("AAPL", "MSFT", "NVDA")):
            prices = 100.0 * np.exp(np.cumsum(np.full(len(dates), 0.001 * (idx + 1))))
            for d, px in zip(dates, prices):
                rows.append(
                    {
                        "timestamp": d,
                        "asset": sym,
                        "open": px * 0.998,
                        "high": px * 1.005,
                        "low": px * 0.995,
                        "close": px,
                        "volume": 10000.0,
                    }
                )
        aq.ingest_ohlcv(proj, pd.DataFrame(rows))
        return proj

    def test_load_panel_isolates_train_and_val_and_blocks_holdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proj = self._create_project_with_data(Path(tmp))

            # Default split='val' physically excludes dates > 2023-04-30
            val_panel = aq.load_panel(proj)
            self.assertEqual(val_panel.attrs["split"], "val")
            self.assertLessEqual(
                val_panel["timestamp"].max(),
                pd.Timestamp("2023-04-30 23:59:59.999999999", tz="UTC"),
            )

            # split='train' physically excludes dates > 2023-02-28
            train_panel = aq.load_panel(proj, split="train")
            self.assertEqual(train_panel.attrs["split"], "train")
            self.assertLessEqual(
                train_panel["timestamp"].max(),
                pd.Timestamp("2023-02-28 23:59:59.999999999", tz="UTC"),
            )
            self.assertLess(len(train_panel), len(val_panel))

            # Direct holdout access via load_panel is forbidden
            with self.assertRaises(aq.HoldoutLockedError):
                aq.load_panel(proj, split="holdout")

    def test_evaluate_holdout_audits_unlock_and_scores_strictly_post_val_end(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proj = self._create_project_with_data(Path(tmp))

            def strategy_eval(panel: pd.DataFrame) -> aq.BacktestResult:
                close = aq.wide_close(panel)
                # Rolling 10-bar momentum using warmup bars cleanly
                mom = close / close.shift(10) - 1.0
                ranks = mom.rank(axis=1, pct=True) - 0.5
                return aq.backtest_weights(ranks, panel, project=proj, name="mom-candidate")

            holdout_run = aq.evaluate_holdout(
                proj,
                strategy_eval,
                warmup_bars=15,
                name="mom-holdout-v1",
                hypothesis="Out-of-sample momentum test",
            )
            self.assertEqual(holdout_run["split"], "holdout")
            self.assertEqual(holdout_run["kind"], "backtest")

            # Verify only ONE run was created (inner record=True captured cleanly)
            all_runs = aq.list_runs(proj)
            self.assertEqual(len(all_runs), 1)
            self.assertEqual(all_runs[0]["id"], holdout_run["id"])

            # Verify every scored timestamp in series/equity.csv is strictly > val_end (2023-04-30)
            loaded = aq.load_run(proj, holdout_run["id"], include_series=True)
            eq_dates = pd.to_datetime([r["timestamp"] for r in loaded["series"]["equity"]], utc=True)
            self.assertTrue((eq_dates > pd.Timestamp("2023-04-30 23:59:59", tz="UTC")).all())

            # Verify project.json holdout_audit incremented to 1
            refreshed = aq.load_project(proj.root_dir)
            self.assertEqual(refreshed.holdout_audit["unlock_count"], 1)
            self.assertEqual(refreshed.holdout_audit["unlocks"][0]["run_id"], holdout_run["id"])

            # Retroactive split mutation is blocked once holdout is unlocked
            with self.assertRaises(aq.AutoQuantValidationError):
                aq.set_project_splits(refreshed, train_end="2023-01-31", val_end="2023-05-15")


if __name__ == "__main__":
    unittest.main()
