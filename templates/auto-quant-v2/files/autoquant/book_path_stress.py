"""Fixed authority for reported-book historical path stress."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .studies import hash_json
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ValidationIssue,
)


BOOK_PATH_STRESS_POLICY = "strategies/book-path-stress.json"
BOOK_PATH_STRESS_KIND = "autoquant-book-path-stress-policy"
PATH_STRESS_POLICY_KIND = "fixed-unit-worst-terminal-loss-episodes"
OVERLAP_POLICY = "greedy-worst-terminal-loss-non-overlapping"
MIN_HOLDING_BARS = 1
MAX_HOLDING_BARS = 252
MIN_EPISODES = 1
MAX_EPISODES = 50
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _issue(path: str | Path, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def normalize_path_stress_policy(
    value: Any,
    path: str | Path = "pathStressPolicy",
) -> dict[str, Any]:
    """Validate the small caller-owned surface of the fixed method."""

    required = {"kind", "holdingBars", "episodeCount", "overlapPolicy"}
    issues: list[ValidationIssue] = []
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, "path-stress.type", "pathStressPolicy must be an object")]
        )
    for key in sorted(required - set(value)):
        issues.append(_issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'"))
    for key in sorted(set(value) - required):
        issues.append(_issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'"))
    if value.get("kind") != PATH_STRESS_POLICY_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "path-stress.kind",
                f"Expected {PATH_STRESS_POLICY_KIND}",
            )
        )
    for key, lower, upper in (
        ("holdingBars", MIN_HOLDING_BARS, MAX_HOLDING_BARS),
        ("episodeCount", MIN_EPISODES, MAX_EPISODES),
    ):
        item = value.get(key)
        if not isinstance(item, int) or isinstance(item, bool) or not lower <= item <= upper:
            issues.append(
                _issue(
                    f"{path}/{key}",
                    "path-stress.bound",
                    f"{key} must be an integer between {lower} and {upper}",
                )
            )
    if value.get("overlapPolicy") != OVERLAP_POLICY:
        issues.append(
            _issue(
                f"{path}/overlapPolicy",
                "path-stress.overlap",
                f"Expected {OVERLAP_POLICY}",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        "kind": PATH_STRESS_POLICY_KIND,
        "holdingBars": int(value["holdingBars"]),
        "episodeCount": int(value["episodeCount"]),
        "overlapPolicy": OVERLAP_POLICY,
    }


def build_book_path_stress_policy(request: dict[str, Any]) -> dict[str, Any]:
    """Derive immutable semantics from one normalized request."""

    public = normalize_path_stress_policy(request.get("pathStressPolicy"))
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": BOOK_PATH_STRESS_KIND,
        "path": {
            "method": "window-start-fixed-units-buy-and-hold",
            "price": "split-adjusted-close",
            "holdingBars": public["holdingBars"],
            "cashReturn": 0.0,
            "rebalancing": "none-within-window",
        },
        "ranking": {
            "metric": "terminal-book-return",
            "direction": "ascending",
            "tieBreak": "earlier-window-start",
            "episodeCount": public["episodeCount"],
            "overlapPolicy": public["overlapPolicy"],
            "intervalBoundary": "inclusive",
        },
        "attribution": {
            "method": "opening-weight-times-asset-cumulative-return",
            "cashContribution": 0.0,
            "reconciliationTolerance": 1e-10,
        },
        "authority": {
            "decisionPath": "caller-bounded-historical-path-stress",
            "positionTruth": "external-reported-not-authenticated",
            "tradingAuthority": "none",
        },
        "source": {
            "kind": "research-request",
            "requestHash": hash_json(request),
        },
    }
    return {**payload, "id": f"book-path-stress-{hash_json(payload)[:16]}"}


def validate_book_path_stress_policy(
    value: Any,
    path: str | Path = BOOK_PATH_STRESS_POLICY,
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "path",
        "ranking",
        "attribution",
        "authority",
        "source",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise AutoQuantValidationError(
            [_issue(path, "path-stress.schema", "Invalid Path Stress authority fields")]
        )
    try:
        public = normalize_path_stress_policy(
            {
                "kind": PATH_STRESS_POLICY_KIND,
                "holdingBars": value["path"]["holdingBars"],
                "episodeCount": value["ranking"]["episodeCount"],
                "overlapPolicy": value["ranking"]["overlapPolicy"],
            },
            path,
        )
    except (KeyError, TypeError):
        raise AutoQuantValidationError(
            [_issue(path, "path-stress.schema", "Invalid Path Stress authority")]
        ) from None
    if (
        value.get("schemaVersion") != SCHEMA_VERSION
        or value.get("kind") != BOOK_PATH_STRESS_KIND
        or not isinstance(value.get("id"), str)
        or not re.fullmatch(r"book-path-stress-[0-9a-f]{16}", value["id"])
        or value.get("path")
        != {
            "method": "window-start-fixed-units-buy-and-hold",
            "price": "split-adjusted-close",
            "holdingBars": public["holdingBars"],
            "cashReturn": 0.0,
            "rebalancing": "none-within-window",
        }
        or value.get("ranking")
        != {
            "metric": "terminal-book-return",
            "direction": "ascending",
            "tieBreak": "earlier-window-start",
            "episodeCount": public["episodeCount"],
            "overlapPolicy": OVERLAP_POLICY,
            "intervalBoundary": "inclusive",
        }
        or value.get("attribution")
        != {
            "method": "opening-weight-times-asset-cumulative-return",
            "cashContribution": 0.0,
            "reconciliationTolerance": 1e-10,
        }
        or value.get("authority")
        != {
            "decisionPath": "caller-bounded-historical-path-stress",
            "positionTruth": "external-reported-not-authenticated",
            "tradingAuthority": "none",
        }
        or not isinstance(value.get("source"), dict)
        or set(value["source"]) != {"kind", "requestHash"}
        or value["source"].get("kind") != "research-request"
        or not isinstance(value["source"].get("requestHash"), str)
        or not SHA256.fullmatch(value["source"]["requestHash"])
    ):
        raise AutoQuantValidationError(
            [_issue(path, "path-stress.contract", "Path Stress authority differs from the fixed contract")]
        )
    payload = {key: value[key] for key in required - {"id"}}
    expected_id = f"book-path-stress-{hash_json(payload)[:16]}"
    if value["id"] != expected_id:
        raise AutoQuantValidationError(
            [_issue(f"{path}/id", "path-stress.id", "Path Stress authority id does not reconcile")]
        )
    return value


def load_book_path_stress_policy(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AutoQuantValidationError(
            [_issue(path, "path-stress.json", f"Cannot read Path Stress authority: {error}")]
        ) from None
    return validate_book_path_stress_policy(value, path)


BOOK_PATH_STRESS_POLICY_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant fixed reported-book path stress policy",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion", "kind", "id", "path", "ranking",
        "attribution", "authority", "source",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": BOOK_PATH_STRESS_KIND},
        "id": {"type": "string", "pattern": "^book-path-stress-[0-9a-f]{16}$"},
        "path": {"type": "object"},
        "ranking": {"type": "object"},
        "attribution": {"type": "object"},
        "authority": {"type": "object"},
        "source": {"type": "object"},
    },
}
