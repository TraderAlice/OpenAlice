from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from autoquant.factor_claims import (
    build_factor_claim,
    factor_outcome,
    factor_outcome_contract,
    known_style_candidate_source,
    normalize_factor_policy,
)
from autoquant.workspace import AutoQuantValidationError


class KnownStyleCandidateTests(unittest.TestCase):
    def test_explicit_outcome_is_hashed_and_legacy_policy_remains_implicit(self) -> None:
        legacy = normalize_factor_policy(
            {"claim": "decision-signal", "knownStyle": None}
        )
        self.assertNotIn("outcome", legacy)
        self.assertEqual(factor_outcome(legacy), "forward-return")

        request = {
            "factorPolicy": {
                "claim": "decision-signal",
                "knownStyle": None,
                "outcome": "forward-realized-volatility",
            }
        }
        claim = build_factor_claim(request)
        self.assertEqual(
            claim["outcome"],
            "forward-realized-volatility",
        )
        contract = factor_outcome_contract(claim)
        self.assertTrue(contract["explicit"])
        self.assertEqual(contract["portfolioAuthority"], "none")
        self.assertEqual(contract["annualization"], "none")

        with self.assertRaises(AutoQuantValidationError):
            normalize_factor_policy(
                {
                    "claim": "decision-signal",
                    "knownStyle": None,
                    "outcome": "future-drawdown",
                }
            )

    def test_every_supported_known_style_seeds_the_exact_fixed_formula(
        self,
    ) -> None:
        timestamps = pd.date_range("2026-01-01", periods=30, freq="D")
        panel = pd.DataFrame(
            [
                {
                    "asset": asset,
                    "timestamp": timestamp,
                    "close": float(base + offset),
                    "volume": float((base * 100) + offset**2),
                }
                for offset, timestamp in enumerate(timestamps)
                for asset, base in (("AAA", 100), ("BBB", 200))
            ]
        )
        assets = panel["asset"]
        close = panel["close"]
        volume = panel["volume"]
        returns = close.groupby(assets, sort=False).pct_change(
            fill_method=None
        )
        expected = {
            "momentum_20": close.groupby(
                assets,
                sort=False,
            ).pct_change(20, fill_method=None),
            "reversal_5": -close.groupby(
                assets,
                sort=False,
            ).pct_change(5, fill_method=None),
            "realized_volatility_20": returns.groupby(
                assets,
                sort=False,
            ).rolling(20, min_periods=20).std(ddof=0).reset_index(
                level=0,
                drop=True,
            ).reindex(panel.index),
            "relative_volume_20": (
                volume
                / volume.groupby(assets, sort=False)
                .rolling(20, min_periods=20)
                .mean()
                .reset_index(level=0, drop=True)
                .reindex(panel.index)
                - 1.0
            ),
        }

        for style, expected_values in expected.items():
            with self.subTest(style=style):
                source = known_style_candidate_source(
                    {
                        "factorPolicy": {
                            "claim": "known-style-validation",
                            "knownStyle": style,
                        }
                    }
                )
                self.assertIsNotNone(source)
                namespace: dict[str, object] = {}
                exec(source, namespace)
                observed = namespace["compute_factor"](panel.copy())
                pd.testing.assert_series_equal(
                    observed,
                    expected_values.rename(style),
                )
                self.assertTrue(
                    np.array_equal(
                        namespace["compute_factor_components"](
                            panel.copy()
                        )[style].isna().to_numpy(),
                        observed.isna().to_numpy(),
                    )
                )

    def test_non_known_style_requests_keep_the_exploratory_template(self) -> None:
        for claim in ("decision-signal", "novel-factor"):
            with self.subTest(claim=claim):
                self.assertIsNone(
                    known_style_candidate_source(
                        {
                            "factorPolicy": {
                                "claim": claim,
                                "knownStyle": None,
                            }
                        }
                    )
                )


if __name__ == "__main__":
    unittest.main()
