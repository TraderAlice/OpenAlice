from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

import jsonschema

from autoquant.briefs import (
    RESEARCH_REQUEST_JSON_SCHEMA,
    validate_research_request,
)
from autoquant.factor_claims import build_factor_claim
from autoquant.mandates import build_portfolio_mandate
from autoquant.prediction_modes import (
    FACTOR_POPULATION_JSON_SCHEMA,
    PredictionModeError,
    build_factor_population,
    load_factor_population,
    resolve_prediction_population,
    validate_factor_population,
    validate_population_mandate_compatibility,
)
from autoquant.workspace import AutoQuantValidationError


UNIVERSE = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "CONTEXT"]


def request(
    *,
    claim: str = "decision-signal",
    prediction_assets: list[str] | None = None,
    outcome: str = "forward-return",
    direction: str = "long",
) -> dict[str, object]:
    policy: dict[str, object] = {
        "claim": claim,
        "knownStyle": None,
        "outcome": outcome,
    }
    if prediction_assets is not None:
        policy["predictionAssets"] = prediction_assets
    return {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "Explicit Factor population",
        "question": "Which requested assets carry the fixed prediction claim?",
        "decisionContext": "A delegated research-only Factor question.",
        "assets": [
            {
                "symbol": asset,
                "assetClass": "equity",
                "venue": "TEST",
            }
            for asset in UNIVERSE
        ],
        "direction": direction,
        "factorPolicy": policy,
        "horizon": "one observed bar",
        "hypotheses": [],
        "constraints": ["No Portfolio or trading authority."],
        "deliverables": ["Factor evidence"],
        "source": {
            "system": "local",
            "workspaceId": None,
            "sessionId": None,
            "artifactPath": None,
            "artifactRevision": None,
        },
    }


class FactorPopulationTests(unittest.TestCase):
    def test_decision_signal_requires_requested_prediction_assets(self) -> None:
        for raw, expected_code in (
            (
                request(prediction_assets=None),
                "request.factor-prediction-assets-required",
            ),
            (
                request(prediction_assets=["MISSING"]),
                "request.factor-prediction-assets-unrequested",
            ),
        ):
            with self.subTest(expected_code=expected_code):
                with self.assertRaises(AutoQuantValidationError) as raised:
                    validate_research_request(raw)
                self.assertIn(
                    expected_code,
                    {issue.code for issue in raised.exception.issues},
                )

    def test_non_decision_claim_cannot_narrow_complete_universe(self) -> None:
        raw = request(
            claim="novel-factor",
            prediction_assets=["ALPHA"],
        )
        with self.assertRaises(AutoQuantValidationError) as raised:
            validate_research_request(raw)
        self.assertIn(
            "request.factor-prediction-assets-claim",
            {issue.code for issue in raised.exception.issues},
        )

    def test_single_risk_population_is_factor_only_and_content_locked(self) -> None:
        normalized = validate_research_request(
            request(
                prediction_assets=["ALPHA"],
                outcome="forward-realized-volatility",
            )
        )
        jsonschema.validate(normalized, RESEARCH_REQUEST_JSON_SCHEMA)
        population = build_factor_population(normalized, UNIVERSE)
        jsonschema.validate(population, FACTOR_POPULATION_JSON_SCHEMA)
        resolved = resolve_prediction_population(
            UNIVERSE,
            build_factor_claim(normalized),
            population,
        ).as_metrics()
        self.assertEqual(resolved["prediction_assets"], ["ALPHA"])
        self.assertEqual(resolved["context_assets"], UNIVERSE[1:])
        self.assertEqual(resolved["evaluation_mode"], "single-asset-temporal")
        self.assertEqual(resolved["portfolio_authority"], "none")
        self.assertEqual(resolved["trading_authority"], "none")
        self.assertEqual(
            resolved["asset_prediction_roles"]["CONTEXT"],
            "context-only",
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "factor-population.json"
            path.write_text(
                json.dumps(population, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            self.assertEqual(load_factor_population(path), population)
            tampered = copy.deepcopy(population)
            tampered["portfolioAuthority"] = "target-weight-construction"
            with self.assertRaises(AutoQuantValidationError):
                validate_factor_population(tampered)

    def test_unsupported_population_shapes_fail_before_research(self) -> None:
        for raw, expected_code in (
            (
                request(
                    prediction_assets=["ALPHA", "BRAVO"],
                    outcome="forward-realized-volatility",
                    direction="relative-value",
                ),
                "factor-population.relative-value-outcome",
            ),
            (
                request(prediction_assets=["ALPHA", "BRAVO", "CHARLIE"]),
                "factor-population.size",
            ),
        ):
            with self.subTest(expected_code=expected_code):
                normalized = validate_research_request(raw)
                with self.assertRaises(PredictionModeError) as raised:
                    build_factor_population(normalized, UNIVERSE)
                self.assertEqual(raised.exception.code, expected_code)

    def test_portfolio_authority_is_separate_and_compatible(self) -> None:
        raw_decision = request(prediction_assets=UNIVERSE[:4])
        for asset in raw_decision["assets"]:
            asset["positionRole"] = (
                "context-only"
                if asset["symbol"] == "CONTEXT"
                else "long-only"
            )
        decision_request = validate_research_request(raw_decision)
        decision_population = resolve_prediction_population(
            UNIVERSE,
            build_factor_claim(decision_request),
            build_factor_population(decision_request, UNIVERSE),
        ).as_metrics()
        exact_mandate = build_portfolio_mandate(decision_request, UNIVERSE)
        validate_population_mandate_compatibility(
            decision_population,
            exact_mandate,
        )

        mismatched = copy.deepcopy(exact_mandate)
        mismatched["tradableAssets"] = UNIVERSE[:3]
        with self.assertRaises(PredictionModeError):
            validate_population_mandate_compatibility(
                decision_population,
                mismatched,
            )

        novel_request = validate_research_request(
            request(claim="novel-factor")
        )
        novel_population = resolve_prediction_population(
            UNIVERSE,
            build_factor_claim(novel_request),
            build_factor_population(novel_request, UNIVERSE),
        ).as_metrics()
        subset_mandate = build_portfolio_mandate(novel_request, UNIVERSE)
        validate_population_mandate_compatibility(
            novel_population,
            subset_mandate,
        )


if __name__ == "__main__":
    unittest.main()
