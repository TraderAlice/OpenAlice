from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

import numpy as np
import pandas as pd

import autoquant as aq


class FactorAndBacktestTests(unittest.TestCase):
    def test_backtest_weights_strict_causality_and_costs(self) -> None:
        # Bar t0..t4 flat at 100; t4 -> t5 jumps +50% to 150; t5 -> t6 flat at 150!
        dates = pd.date_range("2024-01-01", periods=7, freq="1D", tz="UTC")
        closes = [100.0, 100.0, 100.0, 100.0, 100.0, 150.0, 150.0]
        panel = pd.DataFrame(
            {
                "timestamp": dates,
                "asset": ["AAA"] * 7,
                "open": closes,
                "high": closes,
                "low": closes,
                "close": closes,
                "volume": [1000.0] * 7,
            }
        )
        # Cheating/late signal entering at t5 close (AFTER seeing 150) must earn 0 gross return!
        late_w = pd.DataFrame({"AAA": [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0]}, index=dates)
        late_bt = aq.backtest_weights(late_w, panel, cost_bps=10.0, record=False)
        # Only pays 10 bps entry cost on t5 -> t6, zero price gain
        self.assertAlmostEqual(late_bt.metrics["total_return"], -0.001, places=6)
        self.assertAlmostEqual(late_bt.metrics["total_cost"], 0.001, places=6)

        # Causal signal entering at t4 close earns the +50% t4 -> t5 move minus 10 bps cost!
        causal_w = pd.DataFrame({"AAA": [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0]}, index=dates)
        causal_bt = aq.backtest_weights(causal_w, panel, cost_bps=10.0, record=False)
        self.assertAlmostEqual(causal_bt.metrics["total_return"], 0.50 - 0.001, places=6)

    def test_vol_target_scales_down_only_and_caps_enforced(self) -> None:
        rng = np.random.default_rng(42)
        dates = pd.bdate_range("2023-01-02", periods=120, tz="UTC")
        rows = []
        for sym, sigma in (("HIGH_VOL", 0.04), ("LOW_VOL", 0.005)):
            rets = rng.normal(0.0005, sigma, size=len(dates))
            px = 100.0 * np.cumprod(1.0 + rets)
            for d, p in zip(dates, px):
                rows.append(
                    {
                        "timestamp": d,
                        "asset": sym,
                        "open": p,
                        "high": p * 1.01,
                        "low": p * 0.99,
                        "close": p,
                        "volume": 5000.0,
                    }
                )
        panel = aq.normalize_ohlcv(pd.DataFrame(rows))
        close = aq.wide_close(panel)

        raw_w = pd.DataFrame(1.0, index=close.index, columns=close.columns)
        bt_capped = aq.backtest_weights(
            raw_w,
            panel,
            max_weight=0.4,
            max_gross=0.6,
            vol_target=0.10,
            vol_lookback=20,
            benchmark="LOW_VOL",
            record=False,
        )
        # Gross exposure never exceeds max_gross=0.6, and scales below 0.6 when vol > 0.10
        self.assertLessEqual(float(bt_capped.equity["gross_exposure"].max()), 0.6 + 1e-9)
        self.assertLess(float(bt_capped.equity["gross_exposure"].iloc[-1]), 0.6)
        self.assertIn("active_return", bt_capped.metrics)
        self.assertIn("information_ratio", bt_capped.metrics)

    def test_inverse_vol_and_equal_risk_contribution_weights(self) -> None:
        rng = np.random.default_rng(7)
        dates = pd.bdate_range("2023-01-02", periods=90, tz="UTC")
        # Asset A has 3x the volatility of Asset B, Asset C intermediate
        rets = pd.DataFrame(
            {
                "A": rng.normal(0.0, 0.03, size=len(dates)),
                "B": rng.normal(0.0, 0.01, size=len(dates)),
                "C": rng.normal(0.0, 0.015, size=len(dates)),
            },
            index=dates,
        )
        iv_w = aq.inverse_vol_weights(rets, lookback=30, max_gross=1.0)
        last_iv = iv_w.iloc[-1]
        self.assertAlmostEqual(float(last_iv.sum()), 1.0, places=6)
        self.assertGreater(float(last_iv["B"]), float(last_iv["A"]) * 2.0)

        erc_w = aq.equal_risk_contribution_weights(rets, lookback=60, max_gross=1.0)
        w = erc_w.iloc[-1].to_numpy()
        self.assertAlmostEqual(float(w.sum()), 1.0, places=6)
        cov = np.cov(rets.iloc[-60:].to_numpy(), rowvar=False, ddof=1)
        rc = w * (cov @ w)
        rc_shares = rc / rc.sum()
        np.testing.assert_allclose(rc_shares, np.full(3, 1.0 / 3.0), atol=1e-4)

    def test_evaluate_factor_predictive_ic_quantiles_and_run_bundle(self) -> None:
        rng = np.random.default_rng(123)
        dates = pd.bdate_range("2023-01-02", periods=80, tz="UTC")
        symbols = [f"SYM{i}" for i in range(10)]

        # Construct synthetic panel where known signal S[t, i] drives return r[t -> t+1, i]
        signal = rng.normal(0.0, 1.0, size=(len(dates), len(symbols)))
        fwd_noise = rng.normal(0.0, 0.005, size=(len(dates), len(symbols)))
        # Realized return at t+1 is 0.01 * signal[t] + noise
        rets = np.zeros_like(signal)
        rets[1:] = 0.01 * signal[:-1] + fwd_noise[1:]
        closes = 100.0 * np.cumprod(1.0 + rets, axis=0)

        rows = []
        for ti, d in enumerate(dates):
            for si, sym in enumerate(symbols):
                px = float(closes[ti, si])
                rows.append(
                    {
                        "timestamp": d,
                        "asset": sym,
                        "open": px,
                        "high": px * 1.002,
                        "low": px * 0.998,
                        "close": px,
                        "volume": 1000.0,
                    }
                )

        with tempfile.TemporaryDirectory() as tmp:
            ws = aq.initialize_workspace(Path(tmp) / "desk", materialize_skills=False)
            proj = aq.create_project(ws, "alpha-lab")
            aq.ingest_ohlcv(proj, pd.DataFrame(rows))
            panel = aq.load_panel(proj)

            factor_df = pd.DataFrame(signal, index=dates, columns=symbols)
            res = aq.evaluate_factor(
                factor_df,
                panel,
                horizons=(1, 5, 10),
                quantiles=5,
                project=proj,
                name="syn-alpha",
                hypothesis="Synthetic cross-sectional driver",
            )
            self.assertGreater(res.metrics["ic_mean"], 0.5)
            self.assertGreater(res.metrics["rank_ic_mean"], 0.5)
            self.assertGreater(res.metrics["long_short_sharpe"], 2.0)
            q_means = [q["mean_return"] for q in res.quantiles["quantiles"]]
            self.assertGreater(q_means[-1], q_means[0])
            self.assertIsNotNone(res.run_id)

            run_dir = proj.runs_dir / str(res.run_id)
            self.assertTrue((run_dir / "run.json").is_file())
            self.assertTrue((run_dir / "series" / "ic.csv").is_file())
            self.assertTrue((run_dir / "series" / "quantiles.json").is_file())
            self.assertTrue((run_dir / "series" / "equity.csv").is_file())


if __name__ == "__main__":
    unittest.main()
