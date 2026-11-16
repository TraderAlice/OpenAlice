"""Fixed authority for one request-bound OHLCV price-event Study."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from .studies import hash_json
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ValidationIssue,
)


EVENT_STUDY_POLICY = "strategies/event-study.json"
EVENT_POLICY_KIND = "opening-gap-delayed-close-return"
EVENT_STUDY_KIND = "autoquant-event-study-policy"
EVENT_COMPARATOR = "less-than-or-equal"
OVERLAP_POLICY = "keep-first-until-exit"
MIN_WAIT_BARS = 0
MAX_WAIT_BARS = 20
MIN_HOLDING_BARS = 1
MAX_HOLDING_BARS = 252
MIN_EVENT_COUNT = 3
MAX_EVENT_COUNT = 1000


def _issue(path: str | Path, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def normalize_event_policy(
    value: Any,
    path: str | Path = "eventPolicy",
) -> dict[str, Any]:
    """Validate and canonicalize the narrow public request policy."""

    required = {
        "kind",
        "asset",
        "comparator",
        "thresholdReturn",
        "waitBars",
        "holdingBars",
        "referenceAsset",
        "overlapPolicy",
        "minimumEvents",
    }
    issues: list[ValidationIssue] = []
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, "event-policy.type", "eventPolicy must be an object")]
        )
    for key in sorted(required - set(value)):
        issues.append(
            _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        )
    for key in sorted(set(value) - required):
        issues.append(
            _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        )
    if value.get("kind") != EVENT_POLICY_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "event-policy.kind",
                f"Expected {EVENT_POLICY_KIND}",
            )
        )
    for key in ("asset", "referenceAsset"):
        item = value.get(key)
        if not isinstance(item, str) or not item.strip():
            issues.append(
                _issue(
                    f"{path}/{key}",
                    "event-policy.asset",
                    f"{key} must be a non-empty asset identifier",
                )
            )
    if (
        isinstance(value.get("asset"), str)
        and isinstance(value.get("referenceAsset"), str)
        and value["asset"].strip() == value["referenceAsset"].strip()
    ):
        issues.append(
            _issue(
                f"{path}/referenceAsset",
                "event-policy.reference",
                "referenceAsset must differ from the event asset",
            )
        )
    if value.get("comparator") != EVENT_COMPARATOR:
        issues.append(
            _issue(
                f"{path}/comparator",
                "event-policy.comparator",
                f"Expected {EVENT_COMPARATOR}",
            )
        )
    threshold = value.get("thresholdReturn")
    if (
        not isinstance(threshold, (int, float))
        or isinstance(threshold, bool)
        or not math.isfinite(float(threshold))
        or not -1.0 < float(threshold) < 0.0
    ):
        issues.append(
            _issue(
                f"{path}/thresholdReturn",
                "event-policy.threshold",
                "thresholdReturn must be finite, negative, and greater than -1",
            )
        )
    integer_bounds = (
        ("waitBars", MIN_WAIT_BARS, MAX_WAIT_BARS),
        ("holdingBars", MIN_HOLDING_BARS, MAX_HOLDING_BARS),
        ("minimumEvents", MIN_EVENT_COUNT, MAX_EVENT_COUNT),
    )
    for key, lower, upper in integer_bounds:
        item = value.get(key)
        if (
            not isinstance(item, int)
            or isinstance(item, bool)
            or not lower <= item <= upper
        ):
            issues.append(
                _issue(
                    f"{path}/{key}",
                    "event-policy.bound",
                    f"{key} must be an integer between {lower} and {upper}",
                )
            )
    if value.get("overlapPolicy") != OVERLAP_POLICY:
        issues.append(
            _issue(
                f"{path}/overlapPolicy",
                "event-policy.overlap",
                f"Expected {OVERLAP_POLICY}",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        "kind": EVENT_POLICY_KIND,
        "asset": value["asset"].strip(),
        "comparator": EVENT_COMPARATOR,
        "thresholdReturn": float(threshold),
        "waitBars": int(value["waitBars"]),
        "holdingBars": int(value["holdingBars"]),
        "referenceAsset": value["referenceAsset"].strip(),
        "overlapPolicy": OVERLAP_POLICY,
        "minimumEvents": int(value["minimumEvents"]),
    }


def build_event_study_policy(request: dict[str, Any]) -> dict[str, Any]:
    """Derive immutable Study authority from one normalized request."""

    policy = normalize_event_policy(request.get("eventPolicy"))
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": EVENT_STUDY_KIND,
        "event": {
            "kind": "opening-gap",
            "asset": policy["asset"],
            "comparator": policy["comparator"],
            "thresholdReturn": policy["thresholdReturn"],
            "priorReference": "previous-adjusted-close",
        },
        "timing": {
            "entryPrice": "adjusted-close",
            "waitBars": policy["waitBars"],
            "exitPrice": "adjusted-close",
            "holdingBars": policy["holdingBars"],
        },
        "references": {
            "unconditionalSameAsset": True,
            "matchedAsset": policy["referenceAsset"],
        },
        "population": {
            "raw": "all-qualified-events",
            "primary": policy["overlapPolicy"],
            "minimumEvents": policy["minimumEvents"],
        },
        "inference": {
            "method": "descriptive-normal-mean-interval-v1",
            "confidenceLevel": 0.95,
        },
        "authority": {
            "decisionPath": "caller-bounded-price-event-study",
            "tradingAuthority": "none",
        },
        "source": {
            "kind": "research-request",
            "requestHash": hash_json(request),
        },
    }
    return {
        **payload,
        "id": f"event-study-{hash_json(payload)[:16]}",
    }


def validate_event_study_policy(
    value: Any,
    path: str | Path = EVENT_STUDY_POLICY,
) -> dict[str, Any]:
    """Strictly validate and re-derive one frozen event authority."""

    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, "event-study.type", "Event Study policy must be an object")]
        )
    try:
        request_policy = {
            "kind": EVENT_POLICY_KIND,
            "asset": value["event"]["asset"],
            "comparator": value["event"]["comparator"],
            "thresholdReturn": value["event"]["thresholdReturn"],
            "waitBars": value["timing"]["waitBars"],
            "holdingBars": value["timing"]["holdingBars"],
            "referenceAsset": value["references"]["matchedAsset"],
            "overlapPolicy": value["population"]["primary"],
            "minimumEvents": value["population"]["minimumEvents"],
        }
    except (KeyError, TypeError):
        raise AutoQuantValidationError(
            [_issue(path, "event-study.schema", "Invalid Event Study authority")]
        ) from None
    policy = normalize_event_policy(request_policy, path)
    expected_keys = {
        "schemaVersion",
        "kind",
        "id",
        "event",
        "timing",
        "references",
        "population",
        "inference",
        "authority",
        "source",
    }
    valid = (
        set(value) == expected_keys
        and value.get("schemaVersion") == SCHEMA_VERSION
        and value.get("kind") == EVENT_STUDY_KIND
        and value.get("event")
        == {
            "kind": "opening-gap",
            "asset": policy["asset"],
            "comparator": EVENT_COMPARATOR,
            "thresholdReturn": policy["thresholdReturn"],
            "priorReference": "previous-adjusted-close",
        }
        and value.get("timing")
        == {
            "entryPrice": "adjusted-close",
            "waitBars": policy["waitBars"],
            "exitPrice": "adjusted-close",
            "holdingBars": policy["holdingBars"],
        }
        and value.get("references")
        == {
            "unconditionalSameAsset": True,
            "matchedAsset": policy["referenceAsset"],
        }
        and value.get("population")
        == {
            "raw": "all-qualified-events",
            "primary": OVERLAP_POLICY,
            "minimumEvents": policy["minimumEvents"],
        }
        and value.get("inference")
        == {
            "method": "descriptive-normal-mean-interval-v1",
            "confidenceLevel": 0.95,
        }
        and value.get("authority")
        == {
            "decisionPath": "caller-bounded-price-event-study",
            "tradingAuthority": "none",
        }
        and isinstance(value.get("source"), dict)
        and set(value["source"]) == {"kind", "requestHash"}
        and value["source"].get("kind") == "research-request"
        and isinstance(value["source"].get("requestHash"), str)
        and len(value["source"]["requestHash"]) == 64
    )
    payload = {key: value.get(key) for key in expected_keys - {"id"}}
    expected_id = f"event-study-{hash_json(payload)[:16]}"
    if not valid or value.get("id") != expected_id:
        raise AutoQuantValidationError(
            [_issue(path, "event-study.schema", "Invalid Event Study authority")]
        )
    return value


def load_event_study_policy(path: str | Path) -> dict[str, Any]:
    policy_path = Path(path)
    try:
        value = json.loads(policy_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    policy_path,
                    "event-study.json",
                    f"Cannot read Event Study authority: {error}",
                )
            ]
        ) from error
    return validate_event_study_policy(value, policy_path)


EVENT_STUDY_POLICY_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant OHLCV price-event Study authority",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "event",
        "timing",
        "references",
        "population",
        "inference",
        "authority",
        "source",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": EVENT_STUDY_KIND},
        "id": {
            "type": "string",
            "pattern": "^event-study-[0-9a-f]{16}$",
        },
        "event": {"type": "object"},
        "timing": {"type": "object"},
        "references": {"type": "object"},
        "population": {"type": "object"},
        "inference": {"type": "object"},
        "authority": {"type": "object"},
        "source": {"type": "object"},
    },
}
