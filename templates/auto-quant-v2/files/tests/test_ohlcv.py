from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from autoquant.intake import _read_source
from autoquant.ohlcv import OhlcvValidationError, normalize_ohlcv
from autoquant.workspace import AutoQuantValidationError


def candles(dates: list[str]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "timestamp": dates,
            "open": [100.0 + index for index in range(len(dates))],
            "high": [101.0 + index for index in range(len(dates))],
            "low": [99.0 + index for index in range(len(dates))],
            "close": [100.5 + index for index in range(len(dates))],
            "volume": [1_000 + index for index in range(len(dates))],
            "ignored_vendor_column": ["x"] * len(dates),
        }
    )


class OhlcvContractTests(unittest.TestCase):
    def test_normalize_accepts_conventional_timestamp_alias(self) -> None:
        frame = normalize_ohlcv(candles(["2026-01-02T15:30:00Z"]))

        self.assertEqual(
            list(frame.columns),
            ["date", "open", "high", "low", "close", "volume"],
        )
        self.assertEqual(str(frame["date"].dt.tz), "UTC")

    def test_normalize_rejects_invalid_price_bounds(self) -> None:
        frame = candles(["2026-01-02T15:30:00Z"])
        frame.loc[0, "high"] = 90.0

        with self.assertRaisesRegex(
            OhlcvValidationError,
            "OHLC price bounds are inconsistent",
        ):
            normalize_ohlcv(frame, source="bad.csv")

    def test_columnar_input_explains_its_optional_runtime(self) -> None:
        with (
            patch.object(pd, "read_feather", side_effect=ImportError("pyarrow")),
            self.assertRaisesRegex(
                AutoQuantValidationError,
                "optional 'columnar' dependency",
            ),
        ):
            _read_source(Path("prices.feather"))


if __name__ == "__main__":
    unittest.main()
