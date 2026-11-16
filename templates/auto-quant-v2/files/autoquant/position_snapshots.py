"""Request-bound reported-position snapshot authority."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .studies import hash_json
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ValidationIssue,
)


POSITION_SNAPSHOT = "strategies/position-snapshot.json"
POSITION_SNAPSHOT_KIND = "autoquant-position-snapshot"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SCENARIO_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_SCENARIOS = 8
BASELINE_AUTHORITY = {
    "positionTruth": "external-reported-not-authenticated",
    "tradingAuthority": "none",
}
SCENARIO_AUTHORITY = {
    "positionTruth": "caller-hypothetical-not-authenticated",
    "tradingAuthority": "none",
}
SIZING_AUTHORITY = {
    "decisionPath": "caller-bounded-historical-sizing",
    "tradingAuthority": "none",
}


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def build_position_snapshot(request: dict[str, Any]) -> dict[str, Any]:
    source = request.get("positionSnapshot")
    if not isinstance(source, dict):
        raise AutoQuantValidationError(
            [
                _issue(
                    "request/positionSnapshot",
                    "request.position-snapshot-required",
                    "Book Risk requires one normalized positionSnapshot",
                )
            ]
        )
    request_hash = hash_json(request)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": POSITION_SNAPSHOT_KIND,
        "id": f"position-{request_hash[:16]}",
        "source": {
            "requestHash": request_hash,
            "requestSystem": request["source"]["system"],
            "requestArtifactPath": request["source"]["artifactPath"],
            "requestArtifactRevision": request["source"][
                "artifactRevision"
            ],
        },
        "snapshotKind": source["kind"],
        "asOf": source["asOf"],
        "baseCurrency": source["baseCurrency"],
        "weights": dict(source["weights"]),
        "cashWeight": float(source["cashWeight"]),
        "authority": dict(BASELINE_AUTHORITY),
        "scenarios": [
            {
                "id": scenario["id"],
                "name": scenario["name"],
                "snapshotKind": scenario["kind"],
                "asOf": scenario["asOf"],
                "baseCurrency": scenario["baseCurrency"],
                "weights": dict(scenario["weights"]),
                "cashWeight": float(scenario["cashWeight"]),
                "authority": dict(SCENARIO_AUTHORITY),
            }
            for scenario in request.get("positionScenarios", [])
        ],
        "sizingPolicy": (
            {
                **request["positionSizing"],
                "authority": dict(SIZING_AUTHORITY),
            }
            if "positionSizing" in request
            else None
        ),
    }


def _valid_funded_weights(weights: Any, cash: Any) -> bool:
    return bool(
        isinstance(weights, dict)
        and weights
        and len(weights) <= 256
        and all(
            isinstance(symbol, str)
            and symbol == symbol.strip()
            and bool(symbol)
            and isinstance(weight, (int, float))
            and not isinstance(weight, bool)
            and math.isfinite(float(weight))
            and 1e-12 < abs(float(weight)) <= 2
            for symbol, weight in weights.items()
        )
        and isinstance(cash, (int, float))
        and not isinstance(cash, bool)
        and math.isfinite(float(cash))
        and -3 <= float(cash) <= 3
        and sum(abs(float(weight)) for weight in weights.values())
        <= 4 + 1e-12
        and math.isclose(
            sum(float(weight) for weight in weights.values()) + float(cash),
            1.0,
            rel_tol=0.0,
            abs_tol=1e-9,
        )
    )


def _valid_identity(as_of: Any, base_currency: Any) -> bool:
    try:
        parsed_as_of = (
            datetime.fromisoformat(as_of.replace("Z", "+00:00"))
            if isinstance(as_of, str)
            else None
        )
    except ValueError:
        parsed_as_of = None
    return bool(
        parsed_as_of is not None
        and parsed_as_of.tzinfo is not None
        and isinstance(base_currency, str)
        and bool(base_currency)
        and base_currency == base_currency.strip().upper()
        and len(base_currency) <= 16
    )


def validate_position_snapshot(
    value: dict[str, Any],
    path: Path | str = POSITION_SNAPSHOT,
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "source",
        "snapshotKind",
        "asOf",
        "baseCurrency",
        "weights",
        "cashWeight",
        "authority",
        "scenarios",
        "sizingPolicy",
    }
    issues = [
        *(
            _issue(f"{path}/{key}", "schema.missing", f"Missing field '{key}'")
            for key in sorted(required - value.keys())
        ),
        *(
            _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
            for key in sorted(value.keys() - required)
        ),
    ]
    if (
        value.get("schemaVersion") != SCHEMA_VERSION
        or value.get("kind") != POSITION_SNAPSHOT_KIND
    ):
        issues.append(
            _issue(path, "position-snapshot.schema", "Invalid position snapshot")
        )
    identifier = value.get("id")
    if (
        not isinstance(identifier, str)
        or not re.fullmatch(r"position-[0-9a-f]{16}", identifier)
    ):
        issues.append(
            _issue(f"{path}/id", "position-snapshot.id", "Invalid snapshot id")
        )
    source = value.get("source")
    if not isinstance(source, dict) or set(source) != {
        "requestHash",
        "requestSystem",
        "requestArtifactPath",
        "requestArtifactRevision",
    }:
        issues.append(
            _issue(
                f"{path}/source",
                "position-snapshot.source",
                "Invalid request provenance",
            )
        )
    elif (
        not isinstance(source.get("requestHash"), str)
        or not SHA256.fullmatch(source["requestHash"])
        or source.get("requestSystem") not in {"openalice", "external", "local"}
        or (
            source.get("requestArtifactPath") is None
            and source.get("requestArtifactRevision") is not None
        )
        or (
            source.get("requestArtifactPath") is not None
            and source.get("requestArtifactRevision") is None
        )
    ):
        issues.append(
            _issue(
                f"{path}/source",
                "position-snapshot.source",
                "Invalid request provenance values",
            )
        )
    weights = value.get("weights")
    cash = value.get("cashWeight")
    if not _valid_funded_weights(weights, cash):
        issues.append(
            _issue(
                path,
                "position-snapshot.weights",
                "Invalid funded position weights",
            )
        )
    if value.get("snapshotKind") not in {
        "reported-weights",
        "hypothetical-weights",
    }:
        issues.append(
            _issue(
                f"{path}/snapshotKind",
                "position-snapshot.snapshot-kind",
                "Invalid snapshot kind",
            )
        )
    as_of = value.get("asOf")
    base_currency = value.get("baseCurrency")
    if not _valid_identity(as_of, base_currency):
        issues.append(
            _issue(path, "position-snapshot.identity", "Invalid snapshot identity")
        )
    if value.get("authority") != BASELINE_AUTHORITY:
        issues.append(
            _issue(
                f"{path}/authority",
                "position-snapshot.authority",
                "Position snapshot authority differs from the fixed boundary",
            )
        )
    scenarios = value.get("scenarios")
    if (
        not isinstance(scenarios, list)
        or len(scenarios) > MAX_SCENARIOS
        or not all(isinstance(item, dict) for item in scenarios)
    ):
        issues.append(
            _issue(
                f"{path}/scenarios",
                "position-snapshot.scenarios",
                "Position scenarios must be a bounded array of objects",
            )
        )
        scenarios = []
    scenario_ids: set[str] = set()
    books = {
        json.dumps(
            {"weights": weights, "cashWeight": cash},
            sort_keys=True,
            separators=(",", ":"),
        )
        if isinstance(weights, dict)
        else ""
    }
    scenario_keys = {
        "id",
        "name",
        "snapshotKind",
        "asOf",
        "baseCurrency",
        "weights",
        "cashWeight",
        "authority",
    }
    for index, scenario in enumerate(scenarios):
        scenario_path = f"{path}/scenarios/{index}"
        if set(scenario) != scenario_keys:
            issues.append(
                _issue(
                    scenario_path,
                    "position-snapshot.scenario-schema",
                    "Scenario fields differ from the fixed contract",
                )
            )
            continue
        identifier = scenario.get("id")
        name = scenario.get("name")
        if (
            not isinstance(identifier, str)
            or not 1 <= len(identifier) <= 64
            or not SCENARIO_ID.fullmatch(identifier)
            or identifier in scenario_ids
            or not isinstance(name, str)
            or not name
            or name != name.strip()
            or len(name) > 120
        ):
            issues.append(
                _issue(
                    scenario_path,
                    "position-snapshot.scenario-identity",
                    "Scenario id or name is invalid or duplicated",
                )
            )
        elif isinstance(identifier, str):
            scenario_ids.add(identifier)
        if (
            scenario.get("snapshotKind") != "hypothetical-weights"
            or scenario.get("asOf") != as_of
            or scenario.get("baseCurrency") != base_currency
            or scenario.get("authority") != SCENARIO_AUTHORITY
            or not _valid_identity(
                scenario.get("asOf"),
                scenario.get("baseCurrency"),
            )
            or not _valid_funded_weights(
                scenario.get("weights"),
                scenario.get("cashWeight"),
            )
        ):
            issues.append(
                _issue(
                    scenario_path,
                    "position-snapshot.scenario",
                    "Scenario identity, authority, or funded weights are invalid",
                )
            )
        scenario_book = json.dumps(
            {
                "weights": scenario.get("weights"),
                "cashWeight": scenario.get("cashWeight"),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        if scenario_book in books:
            issues.append(
                _issue(
                    scenario_path,
                    "position-snapshot.scenario-duplicate-book",
                    "Scenario books must be unique and differ from baseline",
                )
            )
        books.add(scenario_book)
    sizing = value.get("sizingPolicy")
    if sizing is not None:
        common_sizing_keys = {
            "kind",
            "asset",
            "direction",
            "annualizedVolatilityCeiling",
            "lookbackBars",
            "authority",
        }
        direction = sizing.get("direction") if isinstance(sizing, dict) else None
        sizing_keys = common_sizing_keys | (
            {"minimumWeight"}
            if direction == "decrease"
            else {"maximumWeight"}
            if direction == "increase"
            else set()
        )
        sizing_asset = sizing.get("asset") if isinstance(sizing, dict) else None
        starting_weight = (
            float(weights.get(sizing_asset, 0.0))
            if isinstance(weights, dict) and isinstance(sizing_asset, str)
            else 0.0
        )
        directional_bound = (
            sizing.get("minimumWeight")
            if direction == "decrease" and isinstance(sizing, dict)
            else sizing.get("maximumWeight")
            if direction == "increase" and isinstance(sizing, dict)
            else None
        )
        if (
            not isinstance(sizing, dict)
            or set(sizing) != sizing_keys
            or sizing.get("kind")
            != "one-asset-against-cash-for-volatility-ceiling"
            or sizing.get("direction") not in {"increase", "decrease"}
            or sizing.get("authority") != SIZING_AUTHORITY
            or not isinstance(sizing.get("asset"), str)
            or not sizing["asset"]
            or not isinstance(
                sizing.get("annualizedVolatilityCeiling"),
                (int, float),
            )
            or isinstance(
                sizing.get("annualizedVolatilityCeiling"),
                bool,
            )
            or not math.isfinite(
                float(sizing.get("annualizedVolatilityCeiling", 0.0))
            )
            or not 0
            < float(sizing.get("annualizedVolatilityCeiling", 0.0))
            <= 10
            or sizing.get("lookbackBars") not in {63, 126, 252}
            or not isinstance(directional_bound, (int, float))
            or isinstance(directional_bound, bool)
            or not math.isfinite(float(directional_bound))
            or (
                direction == "decrease"
                and (
                    sizing_asset
                    not in (weights if isinstance(weights, dict) else {})
                    or starting_weight <= 0
                    or not 0 <= float(directional_bound) < starting_weight
                )
            )
            or (
                direction == "increase"
                and (
                    starting_weight < 0
                    or not isinstance(cash, (int, float))
                    or isinstance(cash, bool)
                    or float(cash) <= 0
                    or not starting_weight < float(directional_bound) <= 2
                )
            )
            or scenarios
        ):
            issues.append(
                _issue(
                    f"{path}/sizingPolicy",
                    "position-snapshot.sizing-policy",
                    "Sizing policy differs from the bounded caller-authority "
                    "contract",
                )
            )
    if issues:
        raise AutoQuantValidationError(issues)
    return value


def load_position_snapshot(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "position-snapshot.json",
                    f"Cannot read position snapshot: {error}",
                )
            ]
        ) from None
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, "position-snapshot.type", "Must be an object")]
        )
    return validate_position_snapshot(value, path)
