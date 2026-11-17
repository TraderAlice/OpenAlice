from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

import autoquant as aq


class PanelAndCalendarsTests(unittest.TestCase):
    def _sample_panel(self) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "timestamp": pd.to_datetime(
                    ["2024-01-02", "2024-01-02", "2024-01-03", "2024-01-03"],
                    utc=True,
                ),
                "asset": ["AAPL", "MSFT", "AAPL", "MSFT"],
                "open": [185.0, 370.0, 186.0, 372.0],
                "high": [187.0, 375.0, 188.0, 376.0],
                "low": [184.0, 369.0, 185.0, 370.0],
                "close": [186.0, 374.0, 187.5, 375.0],
                "volume": [1_000_000.0, 800_000.0, 1_100_000.0, 850_000.0],
            }
        )

    def test_validate_panel_rejects_corrupt_bars(self) -> None:
        base = self._sample_panel()
        validated = aq.validate_panel(base, calendar="XNYS")
        self.assertEqual(len(validated), 4)

        # Duplicate (timestamp, asset)
        dup = pd.concat([base, base.iloc[[0]]], ignore_index=True)
        with self.assertRaises(aq.AutoQuantValidationError):
            aq.validate_panel(dup)

        # Negative price
        neg_p = base.copy()
        neg_p.loc[0, "close"] = -1.0
        with self.assertRaises(aq.AutoQuantValidationError):
            aq.validate_panel(neg_p)

        # Negative volume
        neg_v = base.copy()
        neg_v.loc[0, "volume"] = -10.0
        with self.assertRaises(aq.AutoQuantValidationError):
            aq.validate_panel(neg_v)

        # high < low
        bad_hl = base.copy()
        bad_hl.loc[0, "high"] = 180.0
        bad_hl.loc[0, "low"] = 184.0
        with self.assertRaises(aq.AutoQuantValidationError):
            aq.validate_panel(bad_hl)

        # Non-monotonic asset timestamps
        unsorted = base.iloc[[2, 0, 1, 3]].reset_index(drop=True)
        with self.assertRaises(aq.AutoQuantValidationError):
            aq.validate_panel(unsorted)

    def test_exchange_calendar_rejects_holidays_and_weekends(self) -> None:
        # 2024-01-01 is New Year's Day (closed on XNYS)
        holiday_df = pd.DataFrame(
            {
                "timestamp": pd.to_datetime(["2024-01-01", "2024-01-02"], utc=True),
                "asset": ["AAPL", "AAPL"],
                "open": [100.0, 101.0],
                "high": [102.0, 103.0],
                "low": [99.0, 100.0],
                "close": [101.0, 102.0],
                "volume": [1000.0, 1000.0],
            }
        )
        with self.assertRaises(aq.AutoQuantValidationError):
            aq.validate_panel(holiday_df, calendar="XNYS")
        # 24/7 crypto calendar accepts New Year's Day
        self.assertEqual(len(aq.validate_panel(holiday_df, calendar="24/7")), 2)

    def test_no_silent_ffill_on_ragged_panel_and_explicit_causal_asof_fill(self) -> None:
        # US trades Jan 2, 3, 4, 5; JP missing Jan 3 & Jan 4 (2-bar gap)
        rows = [
            ("2024-01-02", "SPY", 100.0),
            ("2024-01-03", "SPY", 101.0),
            ("2024-01-04", "SPY", 102.0),
            ("2024-01-05", "SPY", 103.0),
            ("2024-01-02", "7203.T", 2000.0),
            ("2024-01-05", "7203.T", 2050.0),
        ]
        ragged = pd.DataFrame(
            [
                {
                    "timestamp": ts,
                    "asset": sym,
                    "open": px,
                    "high": px,
                    "low": px,
                    "close": px,
                    "volume": 500.0,
                }
                for ts, sym, px in rows
            ]
        )
        panel = aq.normalize_ohlcv(ragged)
        wide = aq.panel_to_wide(panel, "close")
        self.assertTrue(np.isnan(wide.loc[pd.Timestamp("2024-01-03", tz="UTC"), "7203.T"]))
        self.assertTrue(np.isnan(wide.loc[pd.Timestamp("2024-01-04", tz="UTC"), "7203.T"]))

        # max_staleness=1 fills Jan 3 (1 bar stale) with volume=0, but leaves Jan 4 missing!
        filled_1 = aq.causal_asof_fill(panel, max_staleness=1)
        wide_1 = aq.panel_to_wide(filled_1, "close")
        vol_1 = aq.panel_to_wide(filled_1, "volume")
        self.assertEqual(wide_1.loc[pd.Timestamp("2024-01-03", tz="UTC"), "7203.T"], 2000.0)
        self.assertEqual(vol_1.loc[pd.Timestamp("2024-01-03", tz="UTC"), "7203.T"], 0.0)
        self.assertTrue(np.isnan(wide_1.loc[pd.Timestamp("2024-01-04", tz="UTC"), "7203.T"]))

    def test_aggregate_completed_bars_is_causal_and_drops_incomplete_tail(self) -> None:
        # 10 hourly bars: 00:00..03:00 (complete 4h), 04:00..07:00 (complete 4h), 08:00..09:00 (incomplete!)
        ts = pd.date_range("2024-01-02 00:00", periods=10, freq="1h", tz="UTC")
        hourly = pd.DataFrame(
            {
                "timestamp": ts,
                "asset": ["BTC"] * 10,
                "open": np.arange(100.0, 110.0),
                "high": np.arange(101.0, 111.0),
                "low": np.arange(99.0, 109.0),
                "close": np.arange(100.5, 110.5),
                "volume": [10.0] * 10,
            }
        )
        bars_4h = aq.aggregate_completed_bars(hourly, "4h", drop_incomplete=True)
        self.assertEqual(len(bars_4h), 2)
        # Completion timestamps must be 04:00 and 08:00 (never 00:00 left-edge leak!)
        self.assertEqual(
            list(bars_4h["timestamp"]),
            [
                pd.Timestamp("2024-01-02 04:00:00", tz="UTC"),
                pd.Timestamp("2024-01-02 08:00:00", tz="UTC"),
            ],
        )
        self.assertAlmostEqual(float(bars_4h.iloc[0]["open"]), 100.0)
        self.assertAlmostEqual(float(bars_4h.iloc[0]["close"]), 103.5)
        self.assertAlmostEqual(float(bars_4h.iloc[0]["volume"]), 40.0)


if __name__ == "__main__":
    unittest.main()
