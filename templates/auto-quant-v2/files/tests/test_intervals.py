from __future__ import annotations

import unittest

import pandas as pd

from autoquant.intervals import (
    AGGREGATION_METHOD,
    IntervalContractError,
    aggregate_completed_ohlcv,
    aggregate_xnys_session_ohlcv,
    build_configurable_multi_interval_frame,
    build_multi_interval_frame,
    configurable_interval_surface,
    interval_surface,
    normalize_feature_intervals,
    observed_interval_surface,
    validate_observed_ohlcv,
    validate_xnys_session_ohlcv,
)


def hourly_fixture(periods: int = 72) -> pd.DataFrame:
    timestamps = pd.date_range(
        "2026-01-01T01:00:00Z",
        periods=periods,
        freq="1h",
    )
    sequence = pd.Series(range(periods), dtype=float)
    opens = 100.0 + sequence
    closes = opens + 0.5
    return pd.DataFrame(
        {
            "timestamp": timestamps,
            "open": opens,
            "high": closes + 1.0,
            "low": opens - 1.0,
            "close": closes,
            "volume": 1_000.0 + sequence,
        }
    )


def close_fixture(timestamps: list[str]) -> pd.DataFrame:
    sequence = pd.Series(range(len(timestamps)), dtype=float)
    opens = 100.0 + sequence
    closes = opens + 0.5
    return pd.DataFrame(
        {
            "timestamp": timestamps,
            "open": opens,
            "high": closes + 1.0,
            "low": opens - 1.0,
            "close": closes,
            "volume": 1_000.0 + sequence,
        }
    )


class MultiIntervalCoreTests(unittest.TestCase):
    def test_interval_surface_is_canonical_and_strict(self) -> None:
        self.assertEqual(
            normalize_feature_intervals(["1d", "3h", "12h"]),
            ("3h", "12h", "1d"),
        )
        surface = interval_surface(["12h", "3h"]).to_dict()
        self.assertEqual(surface["baseInterval"], "1h")
        self.assertEqual(surface["featureIntervals"], ["3h", "12h"])
        self.assertEqual(surface["timestampSemantics"], "bar-close")
        self.assertEqual(surface["aggregationMethod"], AGGREGATION_METHOD)
        with self.assertRaisesRegex(IntervalContractError, "selected from"):
            normalize_feature_intervals(["2h"])
        with self.assertRaisesRegex(IntervalContractError, "unique"):
            normalize_feature_intervals(["3h", "3h"])

    def test_aggregation_reconciles_complete_utc_buckets(self) -> None:
        base = hourly_fixture()
        three_hour = aggregate_completed_ohlcv(base, "3h")
        first = three_hour.iloc[0]
        self.assertEqual(first["timestamp"], pd.Timestamp("2026-01-01T03:00:00Z"))
        self.assertEqual(first["open"], 100.0)
        self.assertEqual(first["high"], 103.5)
        self.assertEqual(first["low"], 99.0)
        self.assertEqual(first["close"], 102.5)
        self.assertEqual(first["volume"], 3_003.0)
        daily = aggregate_completed_ohlcv(base, "1d")
        self.assertEqual(len(daily), 3)
        self.assertEqual(
            daily.iloc[0]["timestamp"],
            pd.Timestamp("2026-01-02T00:00:00Z"),
        )
        self.assertEqual(daily.iloc[0]["volume"], sum(1_000.0 + i for i in range(24)))

    def test_forming_bars_are_invisible_and_completed_bars_carry_backward(self) -> None:
        joined = build_multi_interval_frame(hourly_fixture(30), ["3h", "1d"])
        at_two = joined.loc[
            joined["timestamp"] == pd.Timestamp("2026-01-01T02:00:00Z")
        ].iloc[0]
        self.assertTrue(pd.isna(at_two["bar_close__3h"]))
        at_three = joined.loc[
            joined["timestamp"] == pd.Timestamp("2026-01-01T03:00:00Z")
        ].iloc[0]
        self.assertEqual(
            at_three["bar_close__3h"],
            pd.Timestamp("2026-01-01T03:00:00Z"),
        )
        self.assertEqual(at_three["age_bars__3h"], 0)
        at_four = joined.loc[
            joined["timestamp"] == pd.Timestamp("2026-01-01T04:00:00Z")
        ].iloc[0]
        self.assertEqual(
            at_four["bar_close__3h"],
            pd.Timestamp("2026-01-01T03:00:00Z"),
        )
        self.assertEqual(at_four["age_bars__3h"], 1)
        before_daily_close = joined.iloc[22]
        self.assertTrue(pd.isna(before_daily_close["bar_close__1d"]))
        at_daily_close = joined.iloc[23]
        self.assertEqual(
            at_daily_close["bar_close__1d"],
            pd.Timestamp("2026-01-02T00:00:00Z"),
        )

    def test_future_withholding_cannot_change_already_aligned_rows(self) -> None:
        base = hourly_fixture()
        full = build_multi_interval_frame(base, ["3h", "4h", "6h", "12h", "1d"])
        for cut in (24, 37, 55):
            prefix = build_multi_interval_frame(
                base.iloc[:cut].copy(),
                ["3h", "4h", "6h", "12h", "1d"],
            )
            pd.testing.assert_frame_equal(
                full.iloc[:cut].reset_index(drop=True),
                prefix,
            )

    def test_gaps_naive_timestamps_and_bad_bar_geometry_are_rejected(self) -> None:
        gap = hourly_fixture().drop(index=10).reset_index(drop=True)
        with self.assertRaisesRegex(IntervalContractError, "without gaps"):
            build_multi_interval_frame(gap, ["3h"])
        naive = hourly_fixture()
        naive["timestamp"] = naive["timestamp"].dt.tz_localize(None)
        with self.assertRaisesRegex(IntervalContractError, "explicit UTC offset"):
            build_multi_interval_frame(naive, ["3h"])
        bad = hourly_fixture()
        bad.loc[0, "high"] = bad.loc[0, "open"] - 2.0
        with self.assertRaisesRegex(IntervalContractError, "bar geometry"):
            build_multi_interval_frame(bad, ["3h"])

    def test_observed_surface_preserves_gaps_and_zero_volume(self) -> None:
        surface = observed_interval_surface("1h").to_dict()
        self.assertEqual(
            surface,
            {
                "baseInterval": "1h",
                "featureIntervals": [],
                "timestampSemantics": "bar-close",
                "marketClock": "observed",
                "calendar": "provider-observed",
                "timezone": "UTC",
                "aggregationMethod": "none-observed-base-bars-v1",
                "alignment": "observed-only",
                "missingObservation": "absent-no-fill",
                "horizonClock": "per-target-observed-bars",
            },
        )
        observed = hourly_fixture(6).drop(index=[1, 4]).reset_index(drop=True)
        observed.loc[:, "volume"] = 0.0
        observed.loc[1, "timestamp"] = pd.Timestamp(
            "2026-01-01T03:30:00Z"
        )
        validated = validate_observed_ohlcv(observed)
        self.assertEqual(len(validated), 4)
        self.assertTrue(validated["volume"].eq(0).all())

        naive = observed.copy()
        naive["timestamp"] = naive["timestamp"].dt.tz_localize(None)
        with self.assertRaisesRegex(IntervalContractError, "explicit UTC offset"):
            validate_observed_ohlcv(naive)

        negative = observed.copy()
        negative.loc[0, "volume"] = -1.0
        with self.assertRaisesRegex(IntervalContractError, "non-negative"):
            validate_observed_ohlcv(negative)

    def test_v3_continuous_base_interval_is_explicit_and_causal(self) -> None:
        timestamps = pd.date_range(
            "2026-01-01T00:15:00Z",
            periods=32,
            freq="15min",
        )
        base = close_fixture(
            [value.isoformat().replace("+00:00", "Z") for value in timestamps]
        )
        surface = configurable_interval_surface(
            "15m",
            ["30m", "1h", "4h"],
            {
                "clock": "continuous",
                "calendar": "24/7",
                "timezone": "UTC",
            },
        ).to_dict()
        self.assertEqual(surface["baseInterval"], "15m")
        self.assertEqual(
            surface["featureIntervals"],
            ["30m", "1h", "4h"],
        )
        joined = build_configurable_multi_interval_frame(base, surface)
        self.assertEqual(joined.loc[1, "bar_close__30m"], timestamps[1])
        self.assertEqual(joined.loc[2, "age_bars__30m"], 1)
        self.assertTrue(pd.isna(joined.loc[14, "bar_close__4h"]))
        self.assertEqual(joined.loc[15, "bar_close__4h"], timestamps[15])
        prefix = build_configurable_multi_interval_frame(
            base.iloc[:20].copy(),
            surface,
        )
        pd.testing.assert_frame_equal(
            joined.iloc[:20].reset_index(drop=True),
            prefix,
        )
        with self.assertRaisesRegex(IntervalContractError, "exact multiple"):
            configurable_interval_surface(
                "4h",
                ["6h"],
                {
                    "clock": "continuous",
                    "calendar": "24/7",
                    "timezone": "UTC",
                },
            )

    def test_xnys_sessions_follow_dst_and_complete_at_market_close(self) -> None:
        before_dst = [
            "2026-03-06T15:30:00Z",
            "2026-03-06T16:30:00Z",
            "2026-03-06T17:30:00Z",
            "2026-03-06T18:30:00Z",
            "2026-03-06T19:30:00Z",
            "2026-03-06T20:30:00Z",
            "2026-03-06T21:00:00Z",
        ]
        after_dst = [
            "2026-03-09T14:30:00Z",
            "2026-03-09T15:30:00Z",
            "2026-03-09T16:30:00Z",
            "2026-03-09T17:30:00Z",
            "2026-03-09T18:30:00Z",
            "2026-03-09T19:30:00Z",
            "2026-03-09T20:00:00Z",
        ]
        base = close_fixture([*before_dst, *after_dst])
        validated = validate_xnys_session_ohlcv(base, "1h")
        self.assertEqual(len(validated), 14)
        daily = aggregate_xnys_session_ohlcv(base, "1h", "1d")
        self.assertEqual(
            daily["timestamp"].tolist(),
            [
                pd.Timestamp("2026-03-06T21:00:00Z"),
                pd.Timestamp("2026-03-09T20:00:00Z"),
            ],
        )
        three_hour = aggregate_xnys_session_ohlcv(base, "1h", "3h")
        self.assertEqual(
            three_hour["timestamp"].tolist(),
            [
                pd.Timestamp("2026-03-06T17:30:00Z"),
                pd.Timestamp("2026-03-06T20:30:00Z"),
                pd.Timestamp("2026-03-06T21:00:00Z"),
                pd.Timestamp("2026-03-09T16:30:00Z"),
                pd.Timestamp("2026-03-09T19:30:00Z"),
                pd.Timestamp("2026-03-09T20:00:00Z"),
            ],
        )

    def test_xnys_session_identity_ignores_datetime_storage_resolution(self) -> None:
        base = close_fixture(
            [
                "2026-03-09T14:30:00Z",
                "2026-03-09T15:30:00Z",
                "2026-03-09T16:30:00Z",
                "2026-03-09T17:30:00Z",
                "2026-03-09T18:30:00Z",
                "2026-03-09T19:30:00Z",
                "2026-03-09T20:00:00Z",
            ]
        )
        base["timestamp"] = pd.DatetimeIndex(
            pd.to_datetime(base["timestamp"], utc=True)
        ).as_unit("us")

        validated = validate_xnys_session_ohlcv(base, "1h")

        self.assertEqual(len(validated), 7)
        self.assertEqual(
            validated.iloc[-1]["timestamp"],
            pd.Timestamp("2026-03-09T20:00:00Z"),
        )

    def test_xnys_early_close_and_exact_panel_are_enforced(self) -> None:
        early_close = close_fixture(
            [
                "2026-11-27T15:30:00Z",
                "2026-11-27T16:30:00Z",
                "2026-11-27T17:30:00Z",
                "2026-11-27T18:00:00Z",
            ]
        )
        daily = aggregate_xnys_session_ohlcv(
            early_close,
            "1h",
            "1d",
        )
        self.assertEqual(len(daily), 1)
        self.assertEqual(
            daily.iloc[0]["timestamp"],
            pd.Timestamp("2026-11-27T18:00:00Z"),
        )
        missing = early_close.drop(index=1).reset_index(drop=True)
        with self.assertRaisesRegex(
            IntervalContractError,
            "exact complete XNYS",
        ):
            validate_xnys_session_ohlcv(missing, "1h")
        premarket = pd.concat(
            [
                close_fixture(["2026-11-27T14:00:00Z"]),
                early_close,
            ],
            ignore_index=True,
        )
        with self.assertRaisesRegex(IntervalContractError, "outside"):
            validate_xnys_session_ohlcv(premarket, "1h")
        with self.assertRaisesRegex(
            IntervalContractError,
            "must be selected",
        ):
            configurable_interval_surface(
                "1h",
                ["12h"],
                {
                    "clock": "session",
                    "calendar": "XNYS",
                    "timezone": "America/New_York",
                },
            )


if __name__ == "__main__":
    unittest.main()
