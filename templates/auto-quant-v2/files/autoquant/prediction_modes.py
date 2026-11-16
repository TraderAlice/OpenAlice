"""Caller-owned Factor population and prediction-mode semantics."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .factor_claims import (
    FORWARD_REALIZED_VOLATILITY_OUTCOME,
    FORWARD_RETURN_OUTCOME,
    factor_outcome,
    normalize_factor_policy,
)
from .studies import hash_json
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ValidationIssue,
)


FACTOR_POPULATION = "strategies/factor-population.json"
FACTOR_POPULATION_KIND = "autoquant-factor-population"
CROSS_SECTIONAL_MODE = "cross-sectional"
SINGLE_ASSET_TEMPORAL_MODE = "single-asset-temporal"
TWO_ASSET_RELATIVE_VALUE_MODE = "two-asset-relative-value"
TEMPORAL_EVALUATION_MODES = frozenset(
    {SINGLE_ASSET_TEMPORAL_MODE, TWO_ASSET_RELATIVE_VALUE_MODE}
)
MIN_CROSS_SECTIONAL_ASSETS = 4
TEMPORAL_SCORE_WINDOW = 60
TEMPORAL_SCORE_MINIMUM = 20
SIGNAL_TRANSLATION_METHOD = "prediction-mode-causal-percentile-v2"


class PredictionModeError(ValueError):
    """A fixed Factor population does not define one supported mode."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _validate_universe(research_universe: list[str]) -> None:
    if (
        not research_universe
        or len(research_universe) != len(set(research_universe))
        or any(
            not isinstance(asset, str) or not asset
            for asset in research_universe
        )
    ):
        raise PredictionModeError(
            "factor-population.research-universe",
            "Research universe must contain unique non-empty asset symbols",
        )


def _resolve_mode(
    prediction_assets: list[str],
    *,
    claim: str,
    outcome: str,
    direction: str | None,
) -> tuple[str, dict[str, Any] | None]:
    if len(prediction_assets) == 1:
        if claim != "decision-signal":
            raise PredictionModeError(
                "factor-population.claim",
                "Single-asset temporal evaluation is available only for a "
                "caller-owned decision-signal population",
            )
        return SINGLE_ASSET_TEMPORAL_MODE, None
    if len(prediction_assets) == 2:
        if claim != "decision-signal":
            raise PredictionModeError(
                "factor-population.claim",
                "Two-asset relative-value evaluation is available only for "
                "a caller-owned decision-signal population",
            )
        if outcome != FORWARD_RETURN_OUTCOME:
            raise PredictionModeError(
                "factor-population.relative-value-outcome",
                "Two-asset relative-value evaluation currently requires "
                "forward-return outcome meaning",
            )
        if direction != "relative-value":
            raise PredictionModeError(
                "factor-population.relative-value-direction",
                "Two prediction assets require caller direction "
                "relative-value so the ordered contrast has explicit meaning",
            )
        left, right = prediction_assets
        return TWO_ASSET_RELATIVE_VALUE_MODE, {
            "left_asset": left,
            "right_asset": right,
            "factor_contrast": "factor(left_asset)-factor(right_asset)",
            "target_contrast": (
                "forward_return(left_asset)-forward_return(right_asset)"
            ),
            "portfolio_construction_authority": "none",
        }
    if len(prediction_assets) >= MIN_CROSS_SECTIONAL_ASSETS:
        return CROSS_SECTIONAL_MODE, None
    raise PredictionModeError(
        "factor-population.size",
        "Factor evaluation supports one temporal prediction asset, exactly "
        "two ordered relative-value assets, or at least four cross-sectional "
        f"prediction assets; received {len(prediction_assets)}. A three-asset "
        "basket requires explicit caller-owned contrast weights.",
    )


@dataclass(frozen=True)
class PredictionPopulation:
    id: str
    research_assets: tuple[str, ...]
    prediction_assets: tuple[str, ...]
    context_assets: tuple[str, ...]
    claim: str
    outcome: str
    authority: str
    evaluation_mode: str
    asset_prediction_roles: dict[str, str]
    relative_value_pair: dict[str, Any] | None

    def as_metrics(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "claim": self.claim,
            "outcome": self.outcome,
            "authority": self.authority,
            "evaluation_mode": self.evaluation_mode,
            "research_assets": list(self.research_assets),
            "prediction_assets": list(self.prediction_assets),
            "context_assets": list(self.context_assets),
            "asset_prediction_roles": dict(self.asset_prediction_roles),
            "evaluation_authority": "factor-evaluation-only",
            "portfolio_authority": "none",
            "trading_authority": "none",
            "relative_value_pair": self.relative_value_pair,
        }


def build_factor_population(
    request: dict[str, Any] | None,
    research_universe: list[str],
) -> dict[str, Any]:
    """Derive one content-addressed Factor-only evaluation population."""

    _validate_universe(research_universe)
    supplied = request.get("factorPolicy") if request is not None else None
    policy = normalize_factor_policy(supplied)
    claim = str(policy["claim"])
    outcome = factor_outcome(policy)
    if claim == "decision-signal":
        prediction_assets = policy.get("predictionAssets")
        if not isinstance(prediction_assets, list):
            raise PredictionModeError(
                "factor-population.prediction-assets-required",
                "decision-signal requires explicit factorPolicy.predictionAssets",
            )
        prediction_assets = list(prediction_assets)
        if any(asset not in research_universe for asset in prediction_assets):
            raise PredictionModeError(
                "factor-population.prediction-assets-unrequested",
                "Prediction assets must belong to the research universe",
            )
        if len(prediction_assets) >= MIN_CROSS_SECTIONAL_ASSETS:
            selected = set(prediction_assets)
            prediction_assets = [
                asset for asset in research_universe if asset in selected
            ]
        authority = "caller-factor-policy-prediction-assets"
    else:
        if "predictionAssets" in policy:
            raise PredictionModeError(
                "factor-population.claim",
                "Novel and known-style claims evaluate the complete research universe",
            )
        prediction_assets = list(research_universe)
        authority = "factor-claim-complete-research-universe"
    evaluation_mode, relative_value_pair = _resolve_mode(
        prediction_assets,
        claim=claim,
        outcome=outcome,
        direction=request.get("direction") if request is not None else None,
    )
    context_assets = [
        asset for asset in research_universe if asset not in prediction_assets
    ]
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": FACTOR_POPULATION_KIND,
        "source": {
            "kind": "research-request" if request is not None else "template-default",
            "requestHash": hash_json(request) if request is not None else None,
            "factorPolicy": (
                "caller-supplied" if supplied is not None else "reference-default"
            ),
        },
        "claim": claim,
        "outcome": outcome,
        "researchUniverse": list(research_universe),
        "predictionAssets": prediction_assets,
        "contextAssets": context_assets,
        "evaluationMode": evaluation_mode,
        "assetPredictionRoles": {
            asset: (
                "prediction" if asset in prediction_assets else "context-only"
            )
            for asset in research_universe
        },
        "relativeValuePair": relative_value_pair,
        "authority": authority,
        "evaluationAuthority": "factor-evaluation-only",
        "portfolioAuthority": "none",
        "tradingAuthority": "none",
    }
    return {
        **payload,
        "id": f"factor-population-{hash_json(payload)[:16]}",
    }


def validate_factor_population(
    value: Any,
    path: Path | str = FACTOR_POPULATION,
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "source",
        "claim",
        "outcome",
        "researchUniverse",
        "predictionAssets",
        "contextAssets",
        "evaluationMode",
        "assetPredictionRoles",
        "relativeValuePair",
        "authority",
        "evaluationAuthority",
        "portfolioAuthority",
        "tradingAuthority",
    }
    issues: list[ValidationIssue] = []
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, "factor-population.type", "Factor population must be an object")]
        )
    for key in sorted(required - value.keys()):
        issues.append(_issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'"))
    for key in sorted(value.keys() - required):
        issues.append(_issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'"))
    research = value.get("researchUniverse")
    prediction = value.get("predictionAssets")
    context = value.get("contextAssets")
    roles = value.get("assetPredictionRoles")
    source = value.get("source")
    try:
        _validate_universe(research)
    except (PredictionModeError, TypeError) as error:
        issues.append(_issue(f"{path}/researchUniverse", "factor-population.research-universe", str(error)))
        research = []
    if (
        not isinstance(prediction, list)
        or not prediction
        or len(prediction) != len(set(prediction))
        or any(not isinstance(asset, str) or asset not in research for asset in prediction)
    ):
        issues.append(_issue(f"{path}/predictionAssets", "factor-population.prediction-assets", "Prediction assets must be one unique non-empty subset of the research universe"))
        prediction = []
    expected_context = [asset for asset in research if asset not in prediction]
    if context != expected_context:
        issues.append(_issue(f"{path}/contextAssets", "factor-population.context-assets", "Context assets must be the ordered research-universe complement"))
    expected_roles = {
        asset: "prediction" if asset in prediction else "context-only"
        for asset in research
    }
    if roles != expected_roles:
        issues.append(_issue(f"{path}/assetPredictionRoles", "factor-population.asset-roles", "Factor roles must exactly identify prediction and context-only assets"))
    if (
        not isinstance(source, dict)
        or set(source) != {"kind", "requestHash", "factorPolicy"}
        or source.get("kind") not in {"research-request", "template-default"}
        or source.get("factorPolicy") not in {"caller-supplied", "reference-default"}
        or (
            source.get("kind") == "research-request"
            and (not isinstance(source.get("requestHash"), str) or len(source["requestHash"]) != 64)
        )
        or (source.get("kind") == "template-default" and source.get("requestHash") is not None)
    ):
        issues.append(_issue(f"{path}/source", "factor-population.source", "Invalid Factor population source"))
    claim = value.get("claim")
    outcome = value.get("outcome")
    if claim not in {
        "decision-signal",
        "novel-factor",
        "known-style-validation",
    }:
        issues.append(
            _issue(
                f"{path}/claim",
                "factor-population.claim",
                "Factor population has an unsupported claim",
            )
        )
    if outcome not in {
        FORWARD_RETURN_OUTCOME,
        FORWARD_REALIZED_VOLATILITY_OUTCOME,
    }:
        issues.append(
            _issue(
                f"{path}/outcome",
                "factor-population.outcome",
                "Factor population has an unsupported outcome",
            )
        )
    direction = (
        "relative-value"
        if value.get("evaluationMode") == TWO_ASSET_RELATIVE_VALUE_MODE
        else None
    )
    try:
        mode, pair = _resolve_mode(
            list(prediction),
            claim=str(claim),
            outcome=str(outcome),
            direction=direction,
        )
        if value.get("evaluationMode") != mode or value.get("relativeValuePair") != pair:
            issues.append(_issue(path, "factor-population.mode", "Evaluation mode or relative-value contrast differs from the fixed population"))
    except PredictionModeError as error:
        issues.append(_issue(path, error.code, str(error)))
    expected_authority = (
        "caller-factor-policy-prediction-assets"
        if claim == "decision-signal"
        else "factor-claim-complete-research-universe"
    )
    if (
        value.get("schemaVersion") != SCHEMA_VERSION
        or value.get("kind") != FACTOR_POPULATION_KIND
        or value.get("authority") != expected_authority
        or value.get("evaluationAuthority") != "factor-evaluation-only"
        or value.get("portfolioAuthority") != "none"
        or value.get("tradingAuthority") != "none"
    ):
        issues.append(_issue(path, "factor-population.authority", "Factor population identity or authority is invalid"))
    payload = {key: value.get(key) for key in required - {"id"}}
    expected_id = f"factor-population-{hash_json(payload)[:16]}"
    if value.get("id") != expected_id:
        issues.append(_issue(f"{path}/id", "factor-population.derived-id", "Factor population id is not derived from its complete content"))
    if issues:
        raise AutoQuantValidationError(issues)
    return {**payload, "id": expected_id}


def load_factor_population(path: str | Path) -> dict[str, Any]:
    population_path = Path(path).expanduser().absolute()
    try:
        value = json.loads(population_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [_issue(population_path, "factor-population.missing", f"Missing Factor population: {population_path}")]
        ) from None
    except json.JSONDecodeError as error:
        raise AutoQuantValidationError(
            [_issue(population_path, "factor-population.json", f"Invalid JSON at line {error.lineno}, column {error.colno}: {error.msg}")]
        ) from None
    return validate_factor_population(value, population_path)


def resolve_prediction_population(
    research_universe: list[str],
    factor_claim: dict[str, Any],
    factor_population: dict[str, Any],
) -> PredictionPopulation:
    """Resolve and reconcile one strict Factor-owned prediction population."""

    _validate_universe(research_universe)
    try:
        population = validate_factor_population(factor_population)
    except AutoQuantValidationError as error:
        first = error.issues[0]
        raise PredictionModeError(first.code, first.message) from error
    if population["researchUniverse"] != research_universe:
        raise PredictionModeError(
            "factor-population.research-universe",
            "Factor population researchUniverse must equal the Study universe",
        )
    if population["claim"] != factor_claim.get("claim") or population["outcome"] != factor_outcome(factor_claim):
        raise PredictionModeError(
            "factor-population.factor-claim",
            "Factor population claim and outcome must equal the fixed Factor Claim",
        )
    return PredictionPopulation(
        id=str(population["id"]),
        research_assets=tuple(population["researchUniverse"]),
        prediction_assets=tuple(population["predictionAssets"]),
        context_assets=tuple(population["contextAssets"]),
        claim=str(population["claim"]),
        outcome=str(population["outcome"]),
        authority=str(population["authority"]),
        evaluation_mode=str(population["evaluationMode"]),
        asset_prediction_roles=dict(population["assetPredictionRoles"]),
        relative_value_pair=population["relativeValuePair"],
    )


def validate_population_mandate_compatibility(
    population: dict[str, Any],
    mandate: dict[str, Any],
) -> None:
    """Require Portfolio authority to consume exactly the Factor population."""

    prediction_assets = population.get("prediction_assets")
    research_assets = population.get("research_assets")
    if mandate.get("researchUniverse") != research_assets:
        raise PredictionModeError(
            "factor-population.portfolio-research-universe",
            "Portfolio Mandate researchUniverse must equal the Factor population",
        )
    tradable_assets = mandate.get("tradableAssets")
    incompatible_assets = (
        not isinstance(tradable_assets, list)
        or any(asset not in prediction_assets for asset in tradable_assets)
        or (
            population.get("claim") == "decision-signal"
            and tradable_assets != prediction_assets
        )
    )
    if incompatible_assets:
        raise PredictionModeError(
            "factor-population.portfolio-assets",
            "Portfolio Mandate tradableAssets must equal a decision-signal "
            "population or be a subset of a complete-universe Factor claim",
        )
    if population.get("evaluation_mode") == TWO_ASSET_RELATIVE_VALUE_MODE:
        construction = mandate.get("construction")
        roles = construction.get("assetPositionRoles") if isinstance(construction, dict) else None
        if (
            not isinstance(construction, dict)
            or construction.get("family") != "dollar-neutral"
            or construction.get("netRule") != "zero"
            or not isinstance(roles, dict)
            or any(roles.get(asset) != "two-sided" for asset in prediction_assets)
        ):
            raise PredictionModeError(
                "factor-population.relative-value-mandate",
                "Portfolio consumption of a two-asset Factor requires a symmetric two-sided dollar-neutral Mandate",
            )


def validate_prediction_population_metrics(
    value: Any,
    research_universe: list[str],
    factor_claim: dict[str, Any],
) -> dict[str, Any]:
    """Validate the complete Factor Population projection retained by a Run."""

    required = {
        "id",
        "claim",
        "outcome",
        "authority",
        "evaluation_mode",
        "research_assets",
        "prediction_assets",
        "context_assets",
        "asset_prediction_roles",
        "evaluation_authority",
        "portfolio_authority",
        "trading_authority",
        "relative_value_pair",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise PredictionModeError(
            "factor-population.metrics",
            "Run prediction_universe is not one complete Factor Population projection",
        )
    prediction_assets = value["prediction_assets"]
    context_assets = [
        asset for asset in research_universe if asset not in prediction_assets
    ] if isinstance(prediction_assets, list) else None
    expected_roles = {
        asset: "prediction" if asset in prediction_assets else "context-only"
        for asset in research_universe
    } if isinstance(prediction_assets, list) else None
    direction = (
        "relative-value"
        if value["evaluation_mode"] == TWO_ASSET_RELATIVE_VALUE_MODE
        else None
    )
    try:
        expected_mode, expected_pair = _resolve_mode(
            list(prediction_assets),
            claim=str(value["claim"]),
            outcome=str(value["outcome"]),
            direction=direction,
        )
    except (PredictionModeError, TypeError) as error:
        if isinstance(error, PredictionModeError):
            raise
        raise PredictionModeError(
            "factor-population.metrics",
            "Run prediction assets are invalid",
        ) from error
    expected_authority = (
        "caller-factor-policy-prediction-assets"
        if value["claim"] == "decision-signal"
        else "factor-claim-complete-research-universe"
    )
    if (
        value["research_assets"] != research_universe
        or not isinstance(prediction_assets, list)
        or not prediction_assets
        or len(prediction_assets) != len(set(prediction_assets))
        or any(asset not in research_universe for asset in prediction_assets)
        or value["context_assets"] != context_assets
        or value["asset_prediction_roles"] != expected_roles
        or value["claim"] != factor_claim.get("claim")
        or value["outcome"] != factor_outcome(factor_claim)
        or value["evaluation_mode"] != expected_mode
        or value["relative_value_pair"] != expected_pair
        or value["authority"] != expected_authority
        or value["evaluation_authority"] != "factor-evaluation-only"
        or value["portfolio_authority"] != "none"
        or value["trading_authority"] != "none"
        or not isinstance(value["id"], str)
        or not value["id"].startswith("factor-population-")
    ):
        raise PredictionModeError(
            "factor-population.metrics",
            "Run Factor population does not reconcile its universe, claim, outcome, or authority",
        )
    return dict(value)


def signal_translation_contract(
    population: dict[str, Any],
    *,
    temporal_window: int = TEMPORAL_SCORE_WINDOW,
    temporal_minimum: int = TEMPORAL_SCORE_MINIMUM,
) -> dict[str, Any]:
    """Return fixed Factor-to-decision-score semantics for one mode."""

    mode = population.get("evaluation_mode")
    if mode not in {
        CROSS_SECTIONAL_MODE,
        SINGLE_ASSET_TEMPORAL_MODE,
        TWO_ASSET_RELATIVE_VALUE_MODE,
    }:
        raise PredictionModeError(
            "factor-population.evaluation-mode",
            "Factor population has no supported evaluation mode",
        )
    if (
        not isinstance(temporal_window, int)
        or isinstance(temporal_window, bool)
        or not isinstance(temporal_minimum, int)
        or isinstance(temporal_minimum, bool)
        or temporal_minimum < 2
        or temporal_window < temporal_minimum
    ):
        raise PredictionModeError(
            "factor-population.translation-window",
            "Temporal translation window must contain its integer minimum",
        )
    return {
        "method": SIGNAL_TRANSLATION_METHOD,
        "evaluation_mode": mode,
        "prediction_assets": population.get("prediction_assets"),
        "context_assets": population.get("context_assets"),
        "authority": population.get("authority"),
        "score_basis": (
            "same-timestamp-prediction-population"
            if mode == CROSS_SECTIONAL_MODE
            else "causal-own-factor-history"
            if mode == SINGLE_ASSET_TEMPORAL_MODE
            else "causal-ordered-factor-spread-history"
        ),
        "window_observations": None if mode == CROSS_SECTIONAL_MODE else temporal_window,
        "minimum_observations": MIN_CROSS_SECTIONAL_ASSETS if mode == CROSS_SECTIONAL_MODE else temporal_minimum,
        "relative_value_pair": population.get("relative_value_pair"),
        "context_score": "unavailable-never-ranked",
        "selection_authority": "fixed-mechanical-translation",
        "trading_authority": "none",
    }


FACTOR_POPULATION_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant caller-owned Factor evaluation population",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion", "kind", "id", "source", "claim", "outcome",
        "researchUniverse", "predictionAssets", "contextAssets",
        "evaluationMode", "assetPredictionRoles", "relativeValuePair",
        "authority", "evaluationAuthority", "portfolioAuthority",
        "tradingAuthority",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": FACTOR_POPULATION_KIND},
        "id": {"type": "string", "pattern": "^factor-population-[0-9a-f]{16}$"},
        "source": {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "requestHash", "factorPolicy"],
            "properties": {
                "kind": {"enum": ["research-request", "template-default"]},
                "requestHash": {
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    ]
                },
                "factorPolicy": {
                    "enum": ["caller-supplied", "reference-default"]
                },
            },
        },
        "claim": {"enum": ["decision-signal", "known-style-validation", "novel-factor"]},
        "outcome": {"enum": [FORWARD_RETURN_OUTCOME, FORWARD_REALIZED_VOLATILITY_OUTCOME]},
        "researchUniverse": {"type": "array", "minItems": 1, "uniqueItems": True, "items": {"type": "string", "minLength": 1}},
        "predictionAssets": {"type": "array", "minItems": 1, "uniqueItems": True, "items": {"type": "string", "minLength": 1}},
        "contextAssets": {"type": "array", "uniqueItems": True, "items": {"type": "string", "minLength": 1}},
        "evaluationMode": {"enum": [CROSS_SECTIONAL_MODE, SINGLE_ASSET_TEMPORAL_MODE, TWO_ASSET_RELATIVE_VALUE_MODE]},
        "assetPredictionRoles": {
            "type": "object",
            "minProperties": 1,
            "additionalProperties": {
                "enum": ["prediction", "context-only"]
            },
        },
        "relativeValuePair": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "left_asset",
                        "right_asset",
                        "factor_contrast",
                        "target_contrast",
                        "portfolio_construction_authority",
                    ],
                    "properties": {
                        "left_asset": {"type": "string", "minLength": 1},
                        "right_asset": {"type": "string", "minLength": 1},
                        "factor_contrast": {
                            "const": "factor(left_asset)-factor(right_asset)"
                        },
                        "target_contrast": {
                            "const": "forward_return(left_asset)-forward_return(right_asset)"
                        },
                        "portfolio_construction_authority": {"const": "none"},
                    },
                },
            ]
        },
        "authority": {"enum": ["caller-factor-policy-prediction-assets", "factor-claim-complete-research-universe"]},
        "evaluationAuthority": {"const": "factor-evaluation-only"},
        "portfolioAuthority": {"const": "none"},
        "tradingAuthority": {"const": "none"},
    },
}
