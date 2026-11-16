"""Strict request-bound numerical research-horizon contracts."""

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


RESEARCH_HORIZON = "strategies/research-horizon.json"
RESEARCH_HORIZON_KIND = "autoquant-research-horizon"
RESEARCH_HORIZON_AUTHORITY = "quantitative-decision-support"
RESEARCH_HORIZON_TARGET = (
    "close-t-to-close-t-plus-n-decision-bars"
)
DEFAULT_HORIZON_POLICY = {
    "primaryForwardBars": 1,
    "diagnosticForwardBars": [1, 5, 10],
}
MIN_FORWARD_BARS = 1
MAX_FORWARD_BARS = 252
MIN_DIAGNOSTIC_HORIZONS = 1
MAX_DIAGNOSTIC_HORIZONS = 5
MIN_PURGED_SPLIT_OBSERVATIONS = 20


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _valid_policy(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "primaryForwardBars",
        "diagnosticForwardBars",
    }:
        return False
    primary = value.get("primaryForwardBars")
    diagnostics = value.get("diagnosticForwardBars")
    if (
        not isinstance(primary, int)
        or isinstance(primary, bool)
        or not MIN_FORWARD_BARS <= primary <= MAX_FORWARD_BARS
        or not isinstance(diagnostics, list)
        or not MIN_DIAGNOSTIC_HORIZONS
        <= len(diagnostics)
        <= MAX_DIAGNOSTIC_HORIZONS
        or any(
            not isinstance(item, int)
            or isinstance(item, bool)
            or not MIN_FORWARD_BARS <= item <= MAX_FORWARD_BARS
            for item in diagnostics
        )
        or diagnostics != sorted(set(diagnostics))
        or primary not in diagnostics
    ):
        return False
    return True


def normalize_horizon_policy(value: Any) -> dict[str, Any]:
    """Return the canonical evaluated set or the reference default.

    The separately declared primary horizon is always evaluated. Callers may
    therefore list only additional diagnostic horizons; canonical policy stores
    their sorted union with the primary.
    """

    if value is None:
        return {
            "primaryForwardBars": DEFAULT_HORIZON_POLICY[
                "primaryForwardBars"
            ],
            "diagnosticForwardBars": list(
                DEFAULT_HORIZON_POLICY["diagnosticForwardBars"]
            ),
        }
    if not isinstance(value, dict) or set(value) != {
        "primaryForwardBars",
        "diagnosticForwardBars",
    }:
        raise AutoQuantValidationError(
            [
                _issue(
                    "horizonPolicy",
                    "horizon.policy",
                    "Invalid numerical research horizon policy",
                )
            ]
        )
    primary = value.get("primaryForwardBars")
    diagnostics = value.get("diagnosticForwardBars")
    if (
        not isinstance(primary, int)
        or isinstance(primary, bool)
        or not MIN_FORWARD_BARS <= primary <= MAX_FORWARD_BARS
        or not isinstance(diagnostics, list)
        or not MIN_DIAGNOSTIC_HORIZONS
        <= len(diagnostics)
        <= MAX_DIAGNOSTIC_HORIZONS
        or any(
            not isinstance(item, int)
            or isinstance(item, bool)
            or not MIN_FORWARD_BARS <= item <= MAX_FORWARD_BARS
            for item in diagnostics
        )
        or diagnostics != sorted(set(diagnostics))
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    "horizonPolicy",
                    "horizon.policy",
                    "Invalid numerical research horizon policy",
                )
            ]
        )
    evaluated = sorted({primary, *diagnostics})
    if len(evaluated) > MAX_DIAGNOSTIC_HORIZONS:
        raise AutoQuantValidationError(
            [
                _issue(
                    "horizonPolicy/diagnosticForwardBars",
                    "horizon.policy",
                    "Primary plus diagnostic forward bars exceed the "
                    "five-horizon evaluated-set limit",
                )
            ]
        )
    return {
        "primaryForwardBars": primary,
        "diagnosticForwardBars": evaluated,
    }


def validate_horizon_capacity(
    policy: dict[str, Any],
    observations: int,
    path: Path | str = "horizonPolicy",
) -> None:
    """Require enough rows for every purged 60/20/20 split."""

    if not _valid_policy(policy):
        raise AutoQuantValidationError(
            [_issue(path, "horizon.policy", "Invalid horizon policy")]
        )
    if (
        not isinstance(observations, int)
        or isinstance(observations, bool)
        or observations < 1
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "horizon.observations",
                    "Observation count must be a positive integer",
                )
            ]
        )
    train_end = int(observations * 0.60)
    validation_end = int(observations * 0.80)
    split_sizes = (
        train_end,
        validation_end - train_end,
        observations - validation_end,
    )
    maximum = max(policy["diagnosticForwardBars"])
    minimum_eligible = min(size - maximum for size in split_sizes)
    if minimum_eligible < MIN_PURGED_SPLIT_OBSERVATIONS:
        required_split = maximum + MIN_PURGED_SPLIT_OBSERVATIONS
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "horizon.insufficient-history",
                    "Largest diagnostic horizon leaves fewer than "
                    f"{MIN_PURGED_SPLIT_OBSERVATIONS} eligible observations "
                    "in a purged split; each split needs at least "
                    f"{required_split} rows",
                )
            ]
        )


def validate_external_holdout_horizon_capacity(
    policy: dict[str, Any],
    observations: int,
    path: Path | str = "horizonPolicy",
) -> None:
    """Require a usable fixed validation objective for a frozen later period."""

    if not _valid_policy(policy):
        raise AutoQuantValidationError(
            [_issue(path, "horizon.policy", "Invalid horizon policy")]
        )
    if (
        not isinstance(observations, int)
        or isinstance(observations, bool)
        or observations < 1
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "horizon.observations",
                    "Observation count must be a positive integer",
                )
            ]
        )
    train_end = int(observations * 0.60)
    validation_end = int(observations * 0.80)
    validation_rows = validation_end - train_end
    primary = policy["primaryForwardBars"]
    eligible = validation_rows - primary
    if eligible < MIN_PURGED_SPLIT_OBSERVATIONS:
        required_validation_rows = primary + MIN_PURGED_SPLIT_OBSERVATIONS
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "horizon.insufficient-holdout-history",
                    "Primary forward horizon leaves fewer than "
                    f"{MIN_PURGED_SPLIT_OBSERVATIONS} eligible observations "
                    "in the frozen holdout validation slice; the slice needs "
                    f"at least {required_validation_rows} rows",
                )
            ]
        )


def build_research_horizon(
    request: dict[str, Any] | None,
) -> dict[str, Any]:
    """Derive one content-addressed Horizon Mandate."""

    supplied = (
        request.get("horizonPolicy")
        if isinstance(request, dict)
        else None
    )
    policy = normalize_horizon_policy(supplied)
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESEARCH_HORIZON_KIND,
        "source": {
            "kind": (
                "research-request"
                if request is not None
                else "template-default"
            ),
            "requestHash": (
                hash_json(request) if request is not None else None
            ),
            "horizon": (
                request["horizon"]
                if request is not None
                else "reference decision-bar horizon"
            ),
            "horizonPolicy": (
                "caller-supplied"
                if supplied is not None
                else "reference-default"
            ),
        },
        "primaryForwardBars": policy["primaryForwardBars"],
        "diagnosticForwardBars": policy["diagnosticForwardBars"],
        "targetSemantics": RESEARCH_HORIZON_TARGET,
        "selectionAuthority": {
            "primary": "validation-only",
            "diagnostics": "context-only",
        },
        "authority": RESEARCH_HORIZON_AUTHORITY,
        "tradingAuthority": "none",
    }
    return {
        **payload,
        "id": f"horizon-{hash_json(payload)[:16]}",
    }


def validate_research_horizon(
    value: dict[str, Any],
    path: Path | str = RESEARCH_HORIZON,
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "source",
        "primaryForwardBars",
        "diagnosticForwardBars",
        "targetSemantics",
        "selectionAuthority",
        "authority",
        "tradingAuthority",
    }
    issues: list[ValidationIssue] = []
    if set(value) != required:
        for key in sorted(required - value.keys()):
            issues.append(
                _issue(
                    f"{path}/{key}",
                    "schema.missing",
                    f"Missing required field '{key}'",
                )
            )
        for key in sorted(value.keys() - required):
            issues.append(
                _issue(
                    f"{path}/{key}",
                    "schema.unknown",
                    f"Unknown field '{key}'",
                )
            )
    source = value.get("source")
    selection = value.get("selectionAuthority")
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(
            _issue(f"{path}/schemaVersion", "schema.version", "Expected V1")
        )
    if value.get("kind") != RESEARCH_HORIZON_KIND:
        issues.append(
            _issue(f"{path}/kind", "horizon.kind", "Invalid horizon kind")
        )
    if (
        not isinstance(source, dict)
        or set(source)
        != {"kind", "requestHash", "horizon", "horizonPolicy"}
        or source.get("kind") not in {"research-request", "template-default"}
        or not isinstance(source.get("horizon"), str)
        or not source["horizon"].strip()
        or source.get("horizonPolicy")
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
            _issue(
                f"{path}/source",
                "horizon.source",
                "Invalid Horizon Mandate source",
            )
        )
    policy = {
        "primaryForwardBars": value.get("primaryForwardBars"),
        "diagnosticForwardBars": value.get("diagnosticForwardBars"),
    }
    if not _valid_policy(policy):
        issues.append(
            _issue(
                path,
                "horizon.policy",
                "Invalid primary or diagnostic forward bars",
            )
        )
    if value.get("targetSemantics") != RESEARCH_HORIZON_TARGET:
        issues.append(
            _issue(
                f"{path}/targetSemantics",
                "horizon.semantics",
                "Invalid forward-target semantics",
            )
        )
    if selection != {
        "primary": "validation-only",
        "diagnostics": "context-only",
    }:
        issues.append(
            _issue(
                f"{path}/selectionAuthority",
                "horizon.selection",
                "Invalid selection authority",
            )
        )
    if (
        value.get("authority") != RESEARCH_HORIZON_AUTHORITY
        or value.get("tradingAuthority") != "none"
    ):
        issues.append(
            _issue(
                path,
                "horizon.authority",
                "Horizon Mandate cannot grant trading authority",
            )
        )
    payload = {key: value.get(key) for key in required - {"id"}}
    expected_id = f"horizon-{hash_json(payload)[:16]}"
    if value.get("id") != expected_id:
        issues.append(
            _issue(
                f"{path}/id",
                "horizon.derived-id",
                "Horizon id is not derived from its complete content",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {**payload, "id": expected_id}


def load_research_horizon(path: str | Path) -> dict[str, Any]:
    horizon_path = Path(path).expanduser().absolute()
    try:
        value = json.loads(horizon_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [
                _issue(
                    horizon_path,
                    "horizon.missing",
                    f"Missing Horizon Mandate: {horizon_path}",
                )
            ]
        ) from None
    except json.JSONDecodeError as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    horizon_path,
                    "horizon.json",
                    f"Invalid JSON at line {error.lineno}, column "
                    f"{error.colno}: {error.msg}",
                )
            ]
        ) from None
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [
                _issue(
                    horizon_path,
                    "horizon.type",
                    "Horizon Mandate must be an object",
                )
            ]
        )
    return validate_research_horizon(value, horizon_path)


RESEARCH_HORIZON_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant request-bound numerical research horizon",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "source",
        "primaryForwardBars",
        "diagnosticForwardBars",
        "targetSemantics",
        "selectionAuthority",
        "authority",
        "tradingAuthority",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": RESEARCH_HORIZON_KIND},
        "id": {"type": "string", "pattern": "^horizon-[0-9a-f]{16}$"},
        "source": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "requestHash",
                "horizon",
                "horizonPolicy",
            ],
            "properties": {
                "kind": {
                    "enum": ["research-request", "template-default"]
                },
                "requestHash": {
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    ]
                },
                "horizon": {"type": "string", "minLength": 1},
                "horizonPolicy": {
                    "enum": ["caller-supplied", "reference-default"]
                },
            },
        },
        "primaryForwardBars": {
            "type": "integer",
            "minimum": MIN_FORWARD_BARS,
            "maximum": MAX_FORWARD_BARS,
        },
        "diagnosticForwardBars": {
            "type": "array",
            "minItems": MIN_DIAGNOSTIC_HORIZONS,
            "maxItems": MAX_DIAGNOSTIC_HORIZONS,
            "uniqueItems": True,
            "items": {
                "type": "integer",
                "minimum": MIN_FORWARD_BARS,
                "maximum": MAX_FORWARD_BARS,
            },
        },
        "targetSemantics": {"const": RESEARCH_HORIZON_TARGET},
        "selectionAuthority": {
            "type": "object",
            "additionalProperties": False,
            "required": ["primary", "diagnostics"],
            "properties": {
                "primary": {"const": "validation-only"},
                "diagnostics": {"const": "context-only"},
            },
        },
        "authority": {"const": RESEARCH_HORIZON_AUTHORITY},
        "tradingAuthority": {"const": "none"},
    },
}
