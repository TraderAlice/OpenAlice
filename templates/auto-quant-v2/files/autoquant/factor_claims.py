"""Strict request-bound Factor research-claim contracts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .studies import hash_json
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ValidationIssue,
)


FACTOR_CLAIM = "strategies/factor-claim.json"
FACTOR_CLAIM_KIND = "autoquant-factor-claim"
FACTOR_CLAIMS = {
    "decision-signal",
    "novel-factor",
    "known-style-validation",
}
FORWARD_RETURN_OUTCOME = "forward-return"
FORWARD_REALIZED_VOLATILITY_OUTCOME = "forward-realized-volatility"
FACTOR_OUTCOMES = {
    FORWARD_RETURN_OUTCOME,
    FORWARD_REALIZED_VOLATILITY_OUTCOME,
}
KNOWN_FACTOR_STYLES = {
    "momentum_20",
    "reversal_5",
    "realized_volatility_20",
    "relative_volume_20",
}
DEFAULT_FACTOR_POLICY = {
    "claim": "novel-factor",
    "knownStyle": None,
}
FACTOR_OUTCOME_CONTRACTS = {
    FORWARD_RETURN_OUTCOME: {
        "label": "forward close-to-close return",
        "targetSemantics": "close-t-to-close-t-plus-h-simple-return",
        "scoreDirection": "higher-factor-predicts-higher-outcome",
        "annualization": "not-applicable",
        "downstreamMeaning": "expected-return-research-only",
    },
    FORWARD_REALIZED_VOLATILITY_OUTCOME: {
        "label": "forward realized volatility",
        "targetSemantics": (
            "sqrt-sum-squared-close-log-returns-t-plus-1-through-"
            "t-plus-h-unannualized"
        ),
        "scoreDirection": "higher-factor-predicts-higher-outcome",
        "annualization": "none",
        "downstreamMeaning": "risk-forecast-only-no-return-signal",
    },
}
KNOWN_STYLE_LABELS = {
    "momentum_20": "20-session cross-sectional momentum",
    "reversal_5": "Five-session cross-sectional reversal",
    "realized_volatility_20": "20-session realized volatility",
    "relative_volume_20": "Relative 20-session volume",
}
KNOWN_STYLE_HYPOTHESES = {
    "momentum_20": "Recent relative leaders continue to lead.",
    "reversal_5": "Recent relative losers rebound over the next horizon.",
    "realized_volatility_20": (
        "Relative realized volatility carries cross-sectional information."
    ),
    "relative_volume_20": (
        "Relative trading activity carries cross-sectional information."
    ),
}


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def normalize_factor_policy(value: Any) -> dict[str, Any]:
    """Return one strict caller policy or the novel-factor default."""

    if value is None:
        return dict(DEFAULT_FACTOR_POLICY)
    if not isinstance(value, dict) or not {
        "claim",
        "knownStyle",
    }.issubset(value) or not set(value).issubset(
        {"claim", "knownStyle", "outcome", "predictionAssets"}
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    "factorPolicy",
                    "factor-claim.policy",
                    "factorPolicy must contain claim and knownStyle, with "
                    "optional outcome and predictionAssets",
                )
            ]
        )
    claim = value.get("claim")
    known_style = value.get("knownStyle")
    outcome = value.get("outcome", FORWARD_RETURN_OUTCOME)
    prediction_assets = value.get("predictionAssets")
    if claim not in FACTOR_CLAIMS:
        raise AutoQuantValidationError(
            [
                _issue(
                    "factorPolicy/claim",
                    "factor-claim.claim",
                    "Unknown Factor research claim",
                )
            ]
        )
    if (
        claim in {"decision-signal", "novel-factor"}
        and known_style is not None
    ) or (
        claim == "known-style-validation"
        and known_style not in KNOWN_FACTOR_STYLES
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    "factorPolicy/knownStyle",
                    "factor-claim.known-style",
                    "knownStyle must be null for decision-signal and "
                    "novel-factor, and one supported style for "
                    "known-style-validation",
                )
            ]
        )
    if outcome not in FACTOR_OUTCOMES:
        raise AutoQuantValidationError(
            [
                _issue(
                    "factorPolicy/outcome",
                    "factor-claim.outcome",
                    "Unknown Factor prediction outcome",
                )
            ]
        )
    if "predictionAssets" in value and (
        not isinstance(prediction_assets, list)
        or not prediction_assets
        or any(
            not isinstance(asset, str) or not asset.strip()
            for asset in prediction_assets
        )
        or len(prediction_assets) != len(set(prediction_assets))
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    "factorPolicy/predictionAssets",
                    "factor-population.prediction-assets",
                    "predictionAssets must contain unique non-empty symbols",
                )
            ]
        )
    return {
        "claim": claim,
        "knownStyle": known_style,
        **({"outcome": outcome} if "outcome" in value else {}),
        **(
            {
                "predictionAssets": [
                    asset.strip() for asset in prediction_assets
                ]
            }
            if "predictionAssets" in value
            else {}
        ),
    }


def factor_outcome(value: dict[str, Any]) -> str:
    """Resolve explicit V2 outcome or the historical forward-return default."""

    outcome = value.get("outcome", FORWARD_RETURN_OUTCOME)
    if outcome not in FACTOR_OUTCOMES:
        raise AutoQuantValidationError(
            [
                _issue(
                    "factorPolicy/outcome",
                    "factor-claim.outcome",
                    "Unknown Factor prediction outcome",
                )
            ]
        )
    return str(outcome)


def factor_outcome_contract(value: dict[str, Any]) -> dict[str, Any]:
    """Project one exact target contract without changing stored identity."""

    outcome = factor_outcome(value)
    return {
        "kind": outcome,
        "explicit": "outcome" in value,
        **FACTOR_OUTCOME_CONTRACTS[outcome],
        "portfolioAuthority": (
            "qualification-gated"
            if outcome == FORWARD_RETURN_OUTCOME
            else "none"
        ),
        "rlAuthority": (
            "portfolio-evidence-gated"
            if outcome == FORWARD_RETURN_OUTCOME
            else "none"
        ),
        "tradingAuthority": "none",
    }


def build_factor_claim(request: dict[str, Any] | None) -> dict[str, Any]:
    """Derive one content-addressed Factor claim from request authority."""

    supplied = (
        request.get("factorPolicy")
        if isinstance(request, dict)
        else None
    )
    normalized = normalize_factor_policy(supplied)
    policy = {
        "claim": normalized["claim"],
        "knownStyle": normalized["knownStyle"],
        **(
            {"outcome": normalized["outcome"]}
            if "outcome" in normalized
            else {}
        ),
    }
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": FACTOR_CLAIM_KIND,
        "source": {
            "kind": (
                "research-request"
                if request is not None
                else "template-default"
            ),
            "requestHash": (
                hash_json(request) if request is not None else None
            ),
            "factorPolicy": (
                "caller-supplied"
                if supplied is not None
                else "reference-default"
            ),
        },
        **policy,
        "selectionAuthority": "validation-only",
        "testRole": "visible-audit",
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
    }
    return {
        **payload,
        "id": f"factor-claim-{hash_json(payload)[:16]}",
    }


def known_style_candidate_source(
    request: dict[str, Any] | None,
) -> str | None:
    """Return an inspectable exact-style candidate for one fixed request."""

    policy = normalize_factor_policy(
        request.get("factorPolicy")
        if isinstance(request, dict)
        else None
    )
    if policy["claim"] != "known-style-validation":
        return None
    style = policy["knownStyle"]
    assert isinstance(style, str)
    label = KNOWN_STYLE_LABELS[style]
    hypothesis = KNOWN_STYLE_HYPOTHESES[style]
    return f'''"""Request-seeded exact known-style Factor candidate.

Generated by AutoQuant intake from fixed caller authority. Edit only by
starting a different research question; the independent validation contract
expects this exact definition to remain frozen.
"""

from __future__ import annotations

import pandas as pd


KNOWN_STYLE = {style!r}

FACTOR_COMPONENTS = {{
    KNOWN_STYLE: {{
        "label": {label!r},
        "role": "cross-sectional-score",
        "intervals": ["base"],
        "hypothesis": {hypothesis!r},
    }},
}}


def _rolling(
    values: pd.Series,
    assets: pd.Series,
    window: int,
    method: str,
) -> pd.Series:
    rolling = values.groupby(assets, sort=False).rolling(
        window,
        min_periods=window,
    )
    return (
        (
            rolling.std(ddof=0)
            if method == "std"
            else getattr(rolling, method)()
        )
        .reset_index(level=0, drop=True)
        .reindex(values.index)
    )


def _known_style(panel: pd.DataFrame) -> pd.Series:
    assets = panel["asset"]
    close = panel["close"].astype(float)
    if KNOWN_STYLE == "momentum_20":
        return close.groupby(assets, sort=False).pct_change(
            20,
            fill_method=None,
        )
    if KNOWN_STYLE == "reversal_5":
        return -close.groupby(assets, sort=False).pct_change(
            5,
            fill_method=None,
        )
    if KNOWN_STYLE == "realized_volatility_20":
        returns = close.groupby(assets, sort=False).pct_change(
            fill_method=None,
        )
        return _rolling(returns, assets, 20, "std")
    volume = panel["volume"].astype(float)
    return volume / _rolling(volume, assets, 20, "mean") - 1.0


def compute_factor_components(panel: pd.DataFrame) -> pd.DataFrame:
    """Materialize only the exact request-predeclared known style."""

    return pd.DataFrame(
        {{KNOWN_STYLE: _known_style(panel)}},
        index=panel.index,
    )


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    """Return the exact request-predeclared known style."""

    return _known_style(panel).rename(KNOWN_STYLE)
'''


def validate_factor_claim(
    value: Any,
    path: Path | str = FACTOR_CLAIM,
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "source",
        "claim",
        "knownStyle",
        "selectionAuthority",
        "testRole",
        "authority",
        "tradingAuthority",
    }
    optional = {"outcome"}
    issues: list[ValidationIssue] = []
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, "factor-claim.type", "Factor claim must be an object")]
        )
    for key in sorted(required - value.keys()):
        issues.append(
            _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        )
    for key in sorted(value.keys() - required - optional):
        issues.append(
            _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        )
    source = value.get("source")
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(_issue(f"{path}/schemaVersion", "schema.version", "Expected V1"))
    if value.get("kind") != FACTOR_CLAIM_KIND:
        issues.append(_issue(f"{path}/kind", "factor-claim.kind", "Invalid Factor claim kind"))
    if (
        not isinstance(source, dict)
        or set(source) != {"kind", "requestHash", "factorPolicy"}
        or source.get("kind") not in {"research-request", "template-default"}
        or source.get("factorPolicy")
        not in {"caller-supplied", "reference-default"}
        or (
            source.get("kind") == "research-request"
            and (
                not isinstance(source.get("requestHash"), str)
                or len(source["requestHash"]) != 64
            )
        )
        or (
            source.get("kind") == "template-default"
            and source.get("requestHash") is not None
        )
    ):
        issues.append(
            _issue(f"{path}/source", "factor-claim.source", "Invalid Factor claim source")
        )
    try:
        policy = normalize_factor_policy(
            {
                "claim": value.get("claim"),
                "knownStyle": value.get("knownStyle"),
                **(
                    {"outcome": value.get("outcome")}
                    if "outcome" in value
                    else {}
                ),
            }
        )
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
        policy = {
            "claim": value.get("claim"),
            "knownStyle": value.get("knownStyle"),
            **(
                {"outcome": value.get("outcome")}
                if "outcome" in value
                else {}
            ),
        }
    if (
        value.get("selectionAuthority") != "validation-only"
        or value.get("testRole") != "visible-audit"
        or value.get("authority") != "quantitative-decision-support"
        or value.get("tradingAuthority") != "none"
    ):
        issues.append(
            _issue(
                path,
                "factor-claim.authority",
                "Factor claim cannot alter selection or trading authority",
            )
        )
    payload = {
        key: value.get(key)
        for key in required - {"id"}
    }
    if "outcome" in value:
        payload["outcome"] = value.get("outcome")
    expected_id = f"factor-claim-{hash_json(payload)[:16]}"
    if value.get("id") != expected_id:
        issues.append(
            _issue(
                f"{path}/id",
                "factor-claim.derived-id",
                "Factor claim id is not derived from its complete content",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        **payload,
        **policy,
        "id": expected_id,
    }


def load_factor_claim(path: str | Path) -> dict[str, Any]:
    claim_path = Path(path).expanduser().absolute()
    try:
        value = json.loads(claim_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [
                _issue(
                    claim_path,
                    "factor-claim.missing",
                    f"Missing Factor claim: {claim_path}",
                )
            ]
        ) from None
    except json.JSONDecodeError as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    claim_path,
                    "factor-claim.json",
                    f"Invalid JSON at line {error.lineno}, column "
                    f"{error.colno}: {error.msg}",
                )
            ]
        ) from None
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(claim_path, "factor-claim.type", "Factor claim must be an object")]
        )
    return validate_factor_claim(value, claim_path)


FACTOR_CLAIM_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant request-bound Factor research claim",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "source",
        "claim",
        "knownStyle",
        "selectionAuthority",
        "testRole",
        "authority",
        "tradingAuthority",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": FACTOR_CLAIM_KIND},
        "id": {
            "type": "string",
            "pattern": "^factor-claim-[0-9a-f]{16}$",
        },
        "source": {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "requestHash", "factorPolicy"],
            "properties": {
                "kind": {
                    "enum": ["research-request", "template-default"],
                },
                "requestHash": {
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    ]
                },
                "factorPolicy": {
                    "enum": ["caller-supplied", "reference-default"],
                },
            },
        },
        "claim": {"enum": sorted(FACTOR_CLAIMS)},
        "knownStyle": {
            "anyOf": [
                {"type": "null"},
                {"enum": sorted(KNOWN_FACTOR_STYLES)},
            ]
        },
        "outcome": {"enum": sorted(FACTOR_OUTCOMES)},
        "selectionAuthority": {"const": "validation-only"},
        "testRole": {"const": "visible-audit"},
        "authority": {"const": "quantitative-decision-support"},
        "tradingAuthority": {"const": "none"},
    },
    "allOf": [
        {
            "if": {
                "properties": {
                    "claim": {"const": "novel-factor"},
                }
            },
            "then": {
                "properties": {
                    "knownStyle": {"type": "null"},
                }
            },
        },
        {
            "if": {
                "properties": {
                    "claim": {"const": "decision-signal"},
                }
            },
            "then": {
                "properties": {
                    "knownStyle": {"type": "null"},
                }
            },
        },
        {
            "if": {
                "properties": {
                    "claim": {"const": "known-style-validation"},
                }
            },
            "then": {
                "properties": {
                    "knownStyle": {"enum": sorted(KNOWN_FACTOR_STYLES)},
                }
            },
        },
    ],
}
