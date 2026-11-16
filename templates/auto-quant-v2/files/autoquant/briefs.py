"""Strict delegated research requests and Session-bound Research Briefs."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .allocation_policies import (
    ALLOCATION_METHOD,
    MAX_CONTRIBUTION_TOLERANCE,
    MAX_COVARIANCE_WINDOW,
    MIN_CONTRIBUTION_TOLERANCE,
    MIN_COVARIANCE_WINDOW,
    normalize_allocation_policy,
    normalize_fixed_weight_benchmark,
)
from .factor_claims import (
    FACTOR_OUTCOMES,
    KNOWN_FACTOR_STYLES,
    normalize_factor_policy,
)
from .horizons import (
    MAX_DIAGNOSTIC_HORIZONS,
    MAX_FORWARD_BARS,
    MIN_DIAGNOSTIC_HORIZONS,
    MIN_FORWARD_BARS,
)
from .event_studies import (
    EVENT_COMPARATOR,
    EVENT_POLICY_KIND,
    MAX_EVENT_COUNT,
    MAX_HOLDING_BARS,
    MAX_WAIT_BARS,
    MIN_EVENT_COUNT,
    MIN_HOLDING_BARS,
    MIN_WAIT_BARS,
    OVERLAP_POLICY,
    normalize_event_policy,
)
from .book_path_stress import (
    MAX_EPISODES as MAX_PATH_STRESS_EPISODES,
    MAX_HOLDING_BARS as MAX_PATH_STRESS_HOLDING_BARS,
    MIN_EPISODES as MIN_PATH_STRESS_EPISODES,
    MIN_HOLDING_BARS as MIN_PATH_STRESS_HOLDING_BARS,
    OVERLAP_POLICY as PATH_STRESS_OVERLAP_POLICY,
    PATH_STRESS_POLICY_KIND,
    normalize_path_stress_policy,
)
from .studies import hash_json
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
)


RESEARCH_REQUEST = "request.json"
RESEARCH_BRIEF = "brief.json"
REQUEST_KIND = "autoquant-research-request"
BRIEF_KIND = "autoquant-research-brief"
REQUEST_DIRECTIONS = {
    "long",
    "short",
    "long-short",
    "relative-value",
    "research-only",
}
SOURCE_SYSTEMS = {"openalice", "external", "local"}
ASSET_CLASSES = {"equity", "fund", "future", "forex", "crypto", "index", "other"}
ASSET_POSITION_ROLES = {
    "long-only",
    "short-only",
    "two-sided",
    "context-only",
}
PORTFOLIO_POLICY_NUMERIC_FIELDS = {
    "grossLimit",
    "maxAbsWeight",
    "annualizedVolatilityCeiling",
    "baseCostBps",
    "noTradeOneWay",
    "referenceNav",
}
PORTFOLIO_POLICY_FIELDS = {
    *PORTFOLIO_POLICY_NUMERIC_FIELDS,
    "assetMaxAbsWeights",
    "decisionSchedule",
}
DECISION_ANCHORS = {"dataset-start", "session-start"}
DECISION_SCHEDULE_KINDS = {"every-bars", "calendar-month-end"}
POSITION_SNAPSHOT_KINDS = {"reported-weights", "hypothetical-weights"}
POSITION_SCENARIO_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_POSITION_SCENARIOS = 8
POSITION_SIZING_KIND = "one-asset-against-cash-for-volatility-ceiling"
POSITION_SIZING_DIRECTIONS = {"increase", "decrease"}
POSITION_SIZING_LOOKBACKS = {63, 126, 252}


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _strict_keys(
    value: dict[str, Any],
    required: set[str],
    path: Path | str,
    *,
    optional: set[str] | None = None,
) -> list[ValidationIssue]:
    allowed = required | (optional or set())
    issues = [
        _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        for key in sorted(required - value.keys())
    ]
    issues.extend(
        _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        for key in sorted(value.keys() - allowed)
    )
    return issues


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.missing", f"Missing {label}: {path}")]
        ) from None
    except json.JSONDecodeError as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    f"{label}.json",
                    f"Invalid JSON at line {error.lineno}, column "
                    f"{error.colno}: {error.msg}",
                )
            ]
        ) from None
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.type", f"{label} must be a JSON object")]
        )
    return value


def _non_empty(value: Any, path: str) -> list[ValidationIssue]:
    if not isinstance(value, str) or not value.strip():
        return [_issue(path, "schema.string", "Must be a non-empty string")]
    return []


def _string_list(
    value: Any,
    path: str,
    *,
    allow_empty: bool,
) -> list[ValidationIssue]:
    if (
        not isinstance(value, list)
        or (not allow_empty and not value)
        or not all(isinstance(item, str) and item.strip() for item in value)
    ):
        qualifier = "non-empty " if not allow_empty else ""
        return [
            _issue(
                path,
                "schema.array",
                f"Must be a {qualifier}array of non-empty strings",
            )
        ]
    return []


def _normalize_position_snapshot(
    value: Any,
    path: str,
    issues: list[ValidationIssue],
) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        issues.append(
            _issue(path, "schema.type", "positionSnapshot must be an object")
        )
        return None
    issues.extend(
        _strict_keys(
            value,
            {"kind", "asOf", "baseCurrency", "weights", "cashWeight"},
            path,
        )
    )
    kind = value.get("kind")
    if kind not in POSITION_SNAPSHOT_KINDS:
        issues.append(
            _issue(
                f"{path}/kind",
                "request.position-snapshot-kind",
                "Position snapshot kind must be reported-weights or "
                "hypothetical-weights",
            )
        )
    as_of = value.get("asOf")
    parsed_as_of: datetime | None = None
    if not isinstance(as_of, str) or not as_of.strip():
        issues.append(
            _issue(
                f"{path}/asOf",
                "request.position-snapshot-time",
                "Position snapshot asOf must be a timezone-aware timestamp",
            )
        )
    else:
        try:
            parsed_as_of = datetime.fromisoformat(
                as_of.strip().replace("Z", "+00:00")
            )
        except ValueError:
            parsed_as_of = None
        if parsed_as_of is None or parsed_as_of.tzinfo is None:
            issues.append(
                _issue(
                    f"{path}/asOf",
                    "request.position-snapshot-time",
                    "Position snapshot asOf must be a timezone-aware timestamp",
                )
            )
    currency = value.get("baseCurrency")
    if (
        not isinstance(currency, str)
        or not currency.strip()
        or len(currency.strip()) > 16
    ):
        issues.append(
            _issue(
                f"{path}/baseCurrency",
                "request.position-snapshot-currency",
                "Position snapshot baseCurrency must be a non-empty string "
                "of at most 16 characters",
            )
        )
    raw_weights = value.get("weights")
    weights: dict[str, float] = {}
    if not isinstance(raw_weights, dict) or not raw_weights:
        issues.append(
            _issue(
                f"{path}/weights",
                "request.position-snapshot-weights",
                "Position snapshot weights must be a non-empty object",
            )
        )
    elif len(raw_weights) > 256:
        issues.append(
            _issue(
                f"{path}/weights",
                "request.position-snapshot-count",
                "Position snapshot may contain at most 256 assets",
            )
        )
    else:
        for symbol, raw_weight in raw_weights.items():
            item_path = f"{path}/weights/{symbol}"
            if not isinstance(symbol, str) or not symbol.strip():
                issues.append(
                    _issue(
                        item_path,
                        "request.position-snapshot-symbol",
                        "Position snapshot symbols must be non-empty strings",
                    )
                )
                continue
            if (
                not isinstance(raw_weight, (int, float))
                or isinstance(raw_weight, bool)
                or not math.isfinite(float(raw_weight))
                or abs(float(raw_weight)) > 2.0
                or abs(float(raw_weight)) <= 1e-12
            ):
                issues.append(
                    _issue(
                        item_path,
                        "request.position-snapshot-weight",
                        "Position weights must be finite, non-zero, and have "
                        "absolute value at most 2",
                    )
                )
                continue
            normalized_symbol = symbol.strip()
            if normalized_symbol in weights:
                issues.append(
                    _issue(
                        item_path,
                        "request.position-snapshot-duplicate",
                        "Position symbols must be unique after whitespace "
                        "normalization",
                    )
                )
                continue
            weights[normalized_symbol] = float(raw_weight)
    cash_weight = value.get("cashWeight")
    if (
        not isinstance(cash_weight, (int, float))
        or isinstance(cash_weight, bool)
        or not math.isfinite(float(cash_weight))
        or not -3.0 <= float(cash_weight) <= 3.0
    ):
        issues.append(
            _issue(
                f"{path}/cashWeight",
                "request.position-snapshot-cash",
                "Position snapshot cashWeight must be finite and between "
                "-3 and 3",
            )
        )
    elif weights:
        total = float(cash_weight) + sum(weights.values())
        gross = sum(abs(weight) for weight in weights.values())
        if not math.isclose(total, 1.0, rel_tol=0.0, abs_tol=1e-9):
            issues.append(
                _issue(
                    path,
                    "request.position-snapshot-funded",
                    "Position weights plus cashWeight must sum to 1",
                )
            )
        if gross > 4.0 + 1e-12:
            issues.append(
                _issue(
                    f"{path}/weights",
                    "request.position-snapshot-gross",
                    "Position snapshot gross exposure may not exceed 4",
                )
            )
    if (
        kind not in POSITION_SNAPSHOT_KINDS
        or parsed_as_of is None
        or parsed_as_of.tzinfo is None
        or not isinstance(currency, str)
        or not currency.strip()
        or not weights
        or not isinstance(cash_weight, (int, float))
        or isinstance(cash_weight, bool)
        or not math.isfinite(float(cash_weight))
    ):
        return None
    return {
        "kind": kind,
        "asOf": parsed_as_of.isoformat().replace("+00:00", "Z"),
        "baseCurrency": currency.strip().upper(),
        "weights": {
            symbol: weights[symbol] for symbol in sorted(weights)
        },
        "cashWeight": float(cash_weight),
    }


def _normalize_position_scenarios(
    value: Any,
    baseline: dict[str, Any] | None,
    path: str,
    issues: list[ValidationIssue],
) -> list[dict[str, Any]] | None:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_POSITION_SCENARIOS:
        issues.append(
            _issue(
                path,
                "request.position-scenarios-count",
                "positionScenarios must contain one to "
                f"{MAX_POSITION_SCENARIOS} complete hypothetical books",
            )
        )
        return None
    if baseline is None:
        issues.append(
            _issue(
                path,
                "request.position-scenarios-baseline",
                "positionScenarios requires a valid positionSnapshot baseline",
            )
        )
        return None
    normalized: list[dict[str, Any]] = []
    identifiers: set[str] = set()
    books = {
        json.dumps(
            {
                "weights": baseline["weights"],
                "cashWeight": baseline["cashWeight"],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    }
    for index, raw in enumerate(value):
        item_path = f"{path}/{index}"
        if not isinstance(raw, dict):
            issues.append(
                _issue(
                    item_path,
                    "schema.type",
                    "Each position scenario must be an object",
                )
            )
            continue
        issues.extend(
            _strict_keys(
                raw,
                {
                    "id",
                    "name",
                    "kind",
                    "asOf",
                    "baseCurrency",
                    "weights",
                    "cashWeight",
                },
                item_path,
            )
        )
        identifier = raw.get("id")
        name = raw.get("name")
        if (
            not isinstance(identifier, str)
            or not 1 <= len(identifier) <= 64
            or not POSITION_SCENARIO_ID.fullmatch(identifier)
        ):
            issues.append(
                _issue(
                    f"{item_path}/id",
                    "request.position-scenario-id",
                    "Scenario id must be a 1..64 character lowercase "
                    "kebab-case identifier",
                )
            )
        elif identifier in identifiers:
            issues.append(
                _issue(
                    f"{item_path}/id",
                    "request.position-scenario-duplicate-id",
                    "Scenario ids must be unique",
                )
            )
        else:
            identifiers.add(identifier)
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name.strip()) > 120
        ):
            issues.append(
                _issue(
                    f"{item_path}/name",
                    "request.position-scenario-name",
                    "Scenario name must be a non-empty string of at most "
                    "120 characters",
                )
            )
        snapshot = _normalize_position_snapshot(
            {
                key: raw.get(key)
                for key in (
                    "kind",
                    "asOf",
                    "baseCurrency",
                    "weights",
                    "cashWeight",
                )
            },
            item_path,
            issues,
        )
        if snapshot is None:
            continue
        if snapshot["kind"] != "hypothetical-weights":
            issues.append(
                _issue(
                    f"{item_path}/kind",
                    "request.position-scenario-kind",
                    "Position scenarios must be hypothetical-weights",
                )
            )
        if snapshot["asOf"] != baseline["asOf"]:
            issues.append(
                _issue(
                    f"{item_path}/asOf",
                    "request.position-scenario-time",
                    "Scenario asOf must exactly match the baseline",
                )
            )
        if snapshot["baseCurrency"] != baseline["baseCurrency"]:
            issues.append(
                _issue(
                    f"{item_path}/baseCurrency",
                    "request.position-scenario-currency",
                    "Scenario baseCurrency must exactly match the baseline",
                )
            )
        book = json.dumps(
            {
                "weights": snapshot["weights"],
                "cashWeight": snapshot["cashWeight"],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        if book in books:
            issues.append(
                _issue(
                    item_path,
                    "request.position-scenario-duplicate-book",
                    "Each scenario must differ from the baseline and every "
                    "other scenario",
                )
            )
        else:
            books.add(book)
        if (
            isinstance(identifier, str)
            and POSITION_SCENARIO_ID.fullmatch(identifier)
            and isinstance(name, str)
            and name.strip()
        ):
            normalized.append(
                {
                    "id": identifier,
                    "name": name.strip(),
                    **snapshot,
                }
            )
    return normalized


def _normalize_position_sizing(
    value: Any,
    baseline: dict[str, Any] | None,
    path: str,
    issues: list[ValidationIssue],
) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        issues.append(
            _issue(path, "schema.type", "positionSizing must be an object")
        )
        return None
    issues.extend(
        _strict_keys(
            value,
            {
                "kind",
                "asset",
                "direction",
                "annualizedVolatilityCeiling",
                "lookbackBars",
            },
            path,
            optional={"minimumWeight", "maximumWeight"},
        )
    )
    kind = value.get("kind")
    if kind != POSITION_SIZING_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "request.position-sizing-kind",
                f"positionSizing kind must be {POSITION_SIZING_KIND}",
            )
        )
    asset = value.get("asset")
    if not isinstance(asset, str) or not asset.strip():
        issues.append(
            _issue(
                f"{path}/asset",
                "request.position-sizing-asset",
                "positionSizing asset must be one non-empty symbol",
            )
        )
    direction = value.get("direction")
    if direction not in POSITION_SIZING_DIRECTIONS:
        issues.append(
            _issue(
                f"{path}/direction",
                "request.position-sizing-direction",
                "positionSizing direction must be increase or decrease",
            )
        )
    ceiling = value.get("annualizedVolatilityCeiling")
    if (
        not isinstance(ceiling, (int, float))
        or isinstance(ceiling, bool)
        or not math.isfinite(float(ceiling))
        or not 0 < float(ceiling) <= 10
    ):
        issues.append(
            _issue(
                f"{path}/annualizedVolatilityCeiling",
                "request.position-sizing-ceiling",
                "Annualized volatility ceiling must be finite, positive, "
                "and no greater than 10",
            )
        )
    lookback = value.get("lookbackBars")
    if (
        not isinstance(lookback, int)
        or isinstance(lookback, bool)
        or lookback not in POSITION_SIZING_LOOKBACKS
    ):
        issues.append(
            _issue(
                f"{path}/lookbackBars",
                "request.position-sizing-lookback",
                "positionSizing lookbackBars must be one of 63, 126, or 252",
            )
        )
    normalized_asset = asset.strip() if isinstance(asset, str) else ""
    minimum_weight = value.get("minimumWeight")
    maximum_weight = value.get("maximumWeight")
    for key, item in (
        ("minimumWeight", minimum_weight),
        ("maximumWeight", maximum_weight),
    ):
        if key in value and (
            not isinstance(item, (int, float))
            or isinstance(item, bool)
            or not math.isfinite(float(item))
            or not 0 <= float(item) <= 2
        ):
            issues.append(
                _issue(
                    f"{path}/{key}",
                    "request.position-sizing-weight-bound",
                    f"{key} must be finite and between 0 and 2",
                )
            )
    if baseline is None:
        issues.append(
            _issue(
                path,
                "request.position-sizing-baseline",
                "positionSizing requires a valid positionSnapshot baseline",
            )
        )
    elif direction == "decrease":
        if (
            normalized_asset not in baseline["weights"]
            or baseline["weights"].get(normalized_asset, 0.0) <= 0
        ):
            issues.append(
                _issue(
                    f"{path}/asset",
                    "request.position-sizing-held-long",
                    "A decreased asset must be a strictly positive baseline "
                    "holding",
                )
            )
        if "minimumWeight" not in value:
            issues.append(
                _issue(
                    f"{path}/minimumWeight",
                    "schema.missing",
                    "A decrease sizing path requires minimumWeight",
                )
            )
        if "maximumWeight" in value:
            issues.append(
                _issue(
                    f"{path}/maximumWeight",
                    "request.position-sizing-directional-bound",
                    "A decrease sizing path may declare only minimumWeight",
                )
            )
        starting_weight = baseline["weights"].get(normalized_asset, 0.0)
        if (
            isinstance(minimum_weight, (int, float))
            and not isinstance(minimum_weight, bool)
            and math.isfinite(float(minimum_weight))
            and not 0 <= float(minimum_weight) < starting_weight
        ):
            issues.append(
                _issue(
                    f"{path}/minimumWeight",
                    "request.position-sizing-directional-bound",
                    "minimumWeight must be non-negative and below the "
                    "baseline holding",
                )
            )
    elif direction == "increase":
        if baseline["weights"].get(normalized_asset, 0.0) < 0:
            issues.append(
                _issue(
                    f"{path}/asset",
                    "request.position-sizing-entry-long",
                    "An increased asset must be absent, zero, or a positive "
                    "baseline holding",
                )
            )
        if "maximumWeight" not in value:
            issues.append(
                _issue(
                    f"{path}/maximumWeight",
                    "schema.missing",
                    "An increase sizing path requires maximumWeight",
                )
            )
        if "minimumWeight" in value:
            issues.append(
                _issue(
                    f"{path}/minimumWeight",
                    "request.position-sizing-directional-bound",
                    "An increase sizing path may declare only maximumWeight",
                )
            )
        starting_weight = baseline["weights"].get(normalized_asset, 0.0)
        if (
            isinstance(maximum_weight, (int, float))
            and not isinstance(maximum_weight, bool)
            and math.isfinite(float(maximum_weight))
            and not starting_weight < float(maximum_weight) <= 2
        ):
            issues.append(
                _issue(
                    f"{path}/maximumWeight",
                    "request.position-sizing-directional-bound",
                    "maximumWeight must be above the baseline holding and "
                    "no greater than 2",
                )
            )
        if baseline["cashWeight"] <= 0:
            issues.append(
                _issue(
                    f"{path}/direction",
                    "request.position-sizing-positive-cash",
                    "An increased asset requires strictly positive baseline "
                    "cash",
                )
            )
    if (
        kind != POSITION_SIZING_KIND
        or not normalized_asset
        or direction not in POSITION_SIZING_DIRECTIONS
        or not isinstance(ceiling, (int, float))
        or isinstance(ceiling, bool)
        or not math.isfinite(float(ceiling))
        or not 0 < float(ceiling) <= 10
        or not isinstance(lookback, int)
        or isinstance(lookback, bool)
        or lookback not in POSITION_SIZING_LOOKBACKS
        or baseline is None
        or (
            direction == "decrease"
            and (
                baseline["weights"].get(normalized_asset, 0.0) <= 0
                or not isinstance(minimum_weight, (int, float))
                or isinstance(minimum_weight, bool)
                or not math.isfinite(float(minimum_weight))
                or not 0
                <= float(minimum_weight)
                < baseline["weights"].get(normalized_asset, 0.0)
                or "maximumWeight" in value
            )
        )
        or (
            direction == "increase"
            and (
                baseline["weights"].get(normalized_asset, 0.0) < 0
                or baseline["cashWeight"] <= 0
                or not isinstance(maximum_weight, (int, float))
                or isinstance(maximum_weight, bool)
                or not math.isfinite(float(maximum_weight))
                or not baseline["weights"].get(normalized_asset, 0.0)
                < float(maximum_weight)
                <= 2
                or "minimumWeight" in value
            )
        )
    ):
        return None
    return {
        "kind": POSITION_SIZING_KIND,
        "asset": normalized_asset,
        "direction": direction,
        **(
            {"minimumWeight": float(minimum_weight)}
            if direction == "decrease"
            else {"maximumWeight": float(maximum_weight)}
        ),
        "annualizedVolatilityCeiling": float(ceiling),
        "lookbackBars": lookback,
    }


def validate_research_request(
    value: dict[str, Any],
    path: Path | str = "research-request",
) -> dict[str, Any]:
    """Validate and return one canonical caller-supplied request object."""

    required = {
        "schemaVersion",
        "kind",
        "title",
        "question",
        "decisionContext",
        "assets",
        "direction",
        "horizon",
        "hypotheses",
        "constraints",
        "deliverables",
        "source",
    }
    issues = _strict_keys(
        value,
        required,
        path,
        optional={
            "portfolioPolicy",
            "benchmarkPolicy",
            "horizonPolicy",
            "factorPolicy",
            "allocationPolicy",
            "positionSnapshot",
            "positionScenarios",
            "positionSizing",
            "eventPolicy",
            "pathStressPolicy",
        },
    )
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(_issue(f"{path}/schemaVersion", "schema.version", "Expected V1"))
    if value.get("kind") != REQUEST_KIND:
        issues.append(_issue(f"{path}/kind", "request.kind", f"Expected {REQUEST_KIND}"))
    for key in ("title", "question", "decisionContext", "horizon"):
        issues.extend(_non_empty(value.get(key), f"{path}/{key}"))
    if value.get("direction") not in REQUEST_DIRECTIONS:
        issues.append(
            _issue(
                f"{path}/direction",
                "schema.choice",
                "Invalid requested direction",
            )
        )
    factor_policy = value.get("factorPolicy")
    normalized_factor_policy: dict[str, Any] | None = None
    if "factorPolicy" in value:
        try:
            normalized_factor_policy = normalize_factor_policy(factor_policy)
        except AutoQuantValidationError as error:
            issues.extend(
                _issue(
                    f"{path}/{issue.path}",
                    issue.code,
                    issue.message,
                )
                for issue in error.issues
            )
    normalized_position_snapshot: dict[str, Any] | None = None
    if "positionSnapshot" in value:
        normalized_position_snapshot = _normalize_position_snapshot(
            value.get("positionSnapshot"),
            f"{path}/positionSnapshot",
            issues,
        )
    normalized_position_scenarios: list[dict[str, Any]] | None = None
    if "positionScenarios" in value:
        normalized_position_scenarios = _normalize_position_scenarios(
            value.get("positionScenarios"),
            normalized_position_snapshot,
            f"{path}/positionScenarios",
            issues,
        )
    normalized_position_sizing: dict[str, Any] | None = None
    if "positionSizing" in value:
        normalized_position_sizing = _normalize_position_sizing(
            value.get("positionSizing"),
            normalized_position_snapshot,
            f"{path}/positionSizing",
            issues,
        )
    normalized_event_policy: dict[str, Any] | None = None
    if "eventPolicy" in value:
        try:
            normalized_event_policy = normalize_event_policy(
                value.get("eventPolicy"),
                f"{path}/eventPolicy",
            )
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    normalized_path_stress_policy: dict[str, Any] | None = None
    if "pathStressPolicy" in value:
        try:
            normalized_path_stress_policy = normalize_path_stress_policy(
                value.get("pathStressPolicy"),
                f"{path}/pathStressPolicy",
            )
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    normalized_allocation_policy: dict[str, Any] | None = None
    if "allocationPolicy" in value:
        try:
            normalized_allocation_policy = normalize_allocation_policy(
                value.get("allocationPolicy"),
                f"{path}/allocationPolicy",
            )
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    if "positionSizing" in value and "positionScenarios" in value:
        issues.append(
            _issue(
                path,
                "request.position-sizing-scenarios",
                "positionSizing and positionScenarios cannot be requested "
                "together",
            )
        )
    benchmark_policy = value.get("benchmarkPolicy")
    normalized_benchmark_policy: dict[str, Any] | None = None
    if "benchmarkPolicy" in value:
        benchmark_path = f"{path}/benchmarkPolicy"
        if not isinstance(benchmark_policy, dict):
            issues.append(
                _issue(
                    benchmark_path,
                    "schema.type",
                    "benchmarkPolicy must be an object",
                )
            )
        elif benchmark_policy.get("kind") == "fixed-weights":
            try:
                normalized_benchmark_policy = normalize_fixed_weight_benchmark(
                    benchmark_policy,
                    path=benchmark_path,
                )
            except AutoQuantValidationError as error:
                issues.extend(error.issues)
        else:
            issues.extend(
                _strict_keys(
                    benchmark_policy,
                    {"kind", "symbol"},
                    benchmark_path,
                )
            )
            benchmark_kind = benchmark_policy.get("kind")
            benchmark_symbol = benchmark_policy.get("symbol")
            if benchmark_kind not in {"cash", "asset"}:
                issues.append(
                    _issue(
                        f"{benchmark_path}/kind",
                        "request.benchmark-kind",
                        "Benchmark kind must be cash or asset",
                    )
                )
            elif benchmark_kind == "cash":
                if benchmark_symbol is not None:
                    issues.append(
                        _issue(
                            f"{benchmark_path}/symbol",
                            "request.cash-benchmark-symbol",
                            "Cash benchmark symbol must be null",
                        )
                    )
                else:
                    normalized_benchmark_policy = {
                        "kind": "cash",
                        "symbol": None,
                    }
            elif (
                not isinstance(benchmark_symbol, str)
                or not benchmark_symbol.strip()
            ):
                issues.append(
                    _issue(
                        f"{benchmark_path}/symbol",
                        "request.asset-benchmark-symbol",
                        "Asset benchmark symbol must be non-empty",
                    )
                )
            else:
                normalized_benchmark_policy = {
                    "kind": "asset",
                    "symbol": benchmark_symbol.strip(),
                }
    policy = value.get("portfolioPolicy")
    normalized_policy: dict[str, Any] | None = None
    if policy is not None:
        if not isinstance(policy, dict):
            issues.append(
                _issue(
                    f"{path}/portfolioPolicy",
                    "schema.type",
                    "portfolioPolicy must be an object or null",
                )
            )
        else:
            issues.extend(
                _strict_keys(
                    policy,
                    PORTFOLIO_POLICY_FIELDS,
                    f"{path}/portfolioPolicy",
                )
            )
            numeric: dict[str, float] = {}
            for key in sorted(PORTFOLIO_POLICY_NUMERIC_FIELDS):
                item = policy.get(key)
                if (
                    not isinstance(item, (int, float))
                    or isinstance(item, bool)
                    or not math.isfinite(float(item))
                ):
                    issues.append(
                        _issue(
                            f"{path}/portfolioPolicy/{key}",
                            "request.portfolio-policy-number",
                            f"{key} must be a finite number",
                        )
                    )
                else:
                    numeric[key] = float(item)
            raw_asset_caps = policy.get("assetMaxAbsWeights")
            asset_caps: dict[str, float] | None = None
            if not isinstance(raw_asset_caps, dict):
                issues.append(
                    _issue(
                        f"{path}/portfolioPolicy/assetMaxAbsWeights",
                        "request.asset-cap-map",
                        "assetMaxAbsWeights must be an object",
                    )
                )
            else:
                asset_caps = {}
                if len(raw_asset_caps) > 256:
                    issues.append(
                        _issue(
                            f"{path}/portfolioPolicy/assetMaxAbsWeights",
                            "request.asset-cap-count",
                            "assetMaxAbsWeights may contain at most 256 assets",
                        )
                    )
                for symbol, item in raw_asset_caps.items():
                    cap_path = (
                        f"{path}/portfolioPolicy/"
                        f"assetMaxAbsWeights/{symbol}"
                    )
                    if not isinstance(symbol, str) or not symbol.strip():
                        issues.append(
                            _issue(
                                cap_path,
                                "request.asset-cap-symbol",
                                "Asset cap symbols must be non-empty strings",
                            )
                        )
                    elif (
                        not isinstance(item, (int, float))
                        or isinstance(item, bool)
                        or not math.isfinite(float(item))
                    ):
                        issues.append(
                            _issue(
                                cap_path,
                                "request.asset-cap-number",
                                "Asset caps must be finite numbers",
                            )
                        )
                    else:
                        normalized_symbol = symbol.strip()
                        if normalized_symbol in asset_caps:
                            issues.append(
                                _issue(
                                    cap_path,
                                    "request.duplicate-asset-cap",
                                    "Asset cap symbols must be unique after "
                                    "whitespace normalization",
                                )
                            )
                        else:
                            asset_caps[normalized_symbol] = float(item)
            raw_schedule = policy.get("decisionSchedule")
            decision_schedule: dict[str, Any] | None = None
            if not isinstance(raw_schedule, dict):
                issues.append(
                    _issue(
                        f"{path}/portfolioPolicy/decisionSchedule",
                        "request.decision-schedule",
                        "decisionSchedule must be an object",
                    )
                )
            else:
                kind = raw_schedule.get("kind")
                if kind == "every-bars":
                    issues.extend(
                        _strict_keys(
                            raw_schedule,
                            {"kind", "bars", "anchor"},
                            f"{path}/portfolioPolicy/decisionSchedule",
                        )
                    )
                    bars = raw_schedule.get("bars")
                    anchor = raw_schedule.get("anchor")
                    if (
                        not isinstance(bars, int)
                        or isinstance(bars, bool)
                        or not 1 <= bars <= 252
                    ):
                        issues.append(
                            _issue(
                                f"{path}/portfolioPolicy/"
                                "decisionSchedule/bars",
                                "request.decision-cadence",
                                "Every-bars schedule bars must be an integer "
                                "from 1 to 252",
                            )
                        )
                    if anchor not in DECISION_ANCHORS:
                        issues.append(
                            _issue(
                                f"{path}/portfolioPolicy/"
                                "decisionSchedule/anchor",
                                "request.decision-anchor",
                                "Every-bars schedule anchor must be "
                                "dataset-start or session-start",
                            )
                        )
                    if (
                        isinstance(bars, int)
                        and not isinstance(bars, bool)
                        and 1 <= bars <= 252
                        and anchor in DECISION_ANCHORS
                    ):
                        decision_schedule = {
                            "kind": "every-bars",
                            "bars": bars,
                            "anchor": anchor,
                        }
                elif kind == "calendar-month-end":
                    issues.extend(
                        _strict_keys(
                            raw_schedule,
                            {"kind"},
                            f"{path}/portfolioPolicy/decisionSchedule",
                        )
                    )
                    decision_schedule = {
                        "kind": "calendar-month-end",
                    }
                else:
                    issues.append(
                        _issue(
                            f"{path}/portfolioPolicy/decisionSchedule/kind",
                            "request.decision-schedule-kind",
                            "Decision schedule kind must be every-bars or "
                            "calendar-month-end",
                        )
                    )
            if (
                len(numeric) == len(PORTFOLIO_POLICY_NUMERIC_FIELDS)
                and asset_caps is not None
                and decision_schedule is not None
            ):
                bounds = (
                    ("grossLimit", 0.0, 2.0, False),
                    ("maxAbsWeight", 0.0, 2.0, False),
                    (
                        "annualizedVolatilityCeiling",
                        0.0,
                        1.0,
                        False,
                    ),
                    ("baseCostBps", 0.0, 1000.0, True),
                    ("noTradeOneWay", 0.0, 1.0, True),
                    ("referenceNav", 0.0, 1e12, False),
                )
                for key, lower, upper, inclusive_lower in bounds:
                    item = numeric[key]
                    lower_ok = (
                        item >= lower if inclusive_lower else item > lower
                    )
                    if not lower_ok or item > upper:
                        issues.append(
                            _issue(
                                f"{path}/portfolioPolicy/{key}",
                                "request.portfolio-policy-bound",
                                f"{key} is outside its supported bound",
                            )
                        )
                gross = numeric["grossLimit"]
                cap = numeric["maxAbsWeight"]
                direction = value.get("direction")
                raw_assets = value.get("assets")
                explicit_roles = (
                    [item.get("positionRole") for item in raw_assets]
                    if isinstance(raw_assets, list)
                    and raw_assets
                    and all(isinstance(item, dict) for item in raw_assets)
                    and all("positionRole" in item for item in raw_assets)
                    else []
                )
                has_long = any(
                    role in {"long-only", "two-sided"}
                    for role in explicit_roles
                )
                has_short = any(
                    role in {"short-only", "two-sided"}
                    for role in explicit_roles
                )
                maximum_cap = (
                    gross / 2.0
                    if (
                        has_long
                        and has_short
                        or (
                            not explicit_roles
                            and direction
                            in {
                                "long-short",
                                "relative-value",
                                "research-only",
                            }
                        )
                    )
                    else gross
                )
                if cap > maximum_cap:
                    issues.append(
                        _issue(
                            f"{path}/portfolioPolicy/maxAbsWeight",
                            "request.portfolio-policy-cap",
                            "maxAbsWeight exceeds the permitted directional "
                            "side budget",
                        )
                    )
                normalized_policy = {
                    **numeric,
                    "decisionSchedule": decision_schedule,
                    "assetMaxAbsWeights": {
                        symbol: asset_caps[symbol]
                        for symbol in sorted(asset_caps)
                    },
                }
    horizon_policy = value.get("horizonPolicy")
    normalized_horizon_policy: dict[str, Any] | None = None
    if horizon_policy is not None:
        horizon_path = f"{path}/horizonPolicy"
        if not isinstance(horizon_policy, dict):
            issues.append(
                _issue(
                    horizon_path,
                    "schema.type",
                    "horizonPolicy must be an object or null",
                )
            )
        else:
            issues.extend(
                _strict_keys(
                    horizon_policy,
                    {"primaryForwardBars", "diagnosticForwardBars"},
                    horizon_path,
                )
            )
            primary = horizon_policy.get("primaryForwardBars")
            diagnostics = horizon_policy.get("diagnosticForwardBars")
            if (
                not isinstance(primary, int)
                or isinstance(primary, bool)
                or not MIN_FORWARD_BARS
                <= primary
                <= MAX_FORWARD_BARS
            ):
                issues.append(
                    _issue(
                        f"{horizon_path}/primaryForwardBars",
                        "request.horizon-primary",
                        "primaryForwardBars must be a supported positive "
                        "integer",
                    )
                )
            if (
                not isinstance(diagnostics, list)
                or not MIN_DIAGNOSTIC_HORIZONS
                <= len(diagnostics)
                <= MAX_DIAGNOSTIC_HORIZONS
            ):
                issues.append(
                    _issue(
                        f"{horizon_path}/diagnosticForwardBars",
                        "request.horizon-diagnostics",
                        "diagnosticForwardBars must contain one to five bars",
                    )
                )
            elif any(
                not isinstance(item, int)
                or isinstance(item, bool)
                or not MIN_FORWARD_BARS
                <= item
                <= MAX_FORWARD_BARS
                for item in diagnostics
            ):
                issues.append(
                    _issue(
                        f"{horizon_path}/diagnosticForwardBars",
                        "request.horizon-diagnostic",
                        "Every diagnostic forward bar must be a supported "
                        "positive integer",
                    )
                )
            elif diagnostics != sorted(set(diagnostics)):
                issues.append(
                    _issue(
                        f"{horizon_path}/diagnosticForwardBars",
                        "request.horizon-order",
                        "Diagnostic forward bars must be sorted and unique",
                    )
                )
            elif (
                isinstance(primary, int)
                and len({primary, *diagnostics})
                > MAX_DIAGNOSTIC_HORIZONS
            ):
                issues.append(
                    _issue(
                        f"{horizon_path}/diagnosticForwardBars",
                        "request.horizon-count",
                        "Primary plus diagnostic forward bars must contain "
                        "at most five distinct evaluated horizons",
                    )
                )
            else:
                normalized_horizon_policy = {
                    "primaryForwardBars": primary,
                    "diagnosticForwardBars": sorted(
                        {primary, *diagnostics}
                    ),
                }
    for key, allow_empty in (
        ("hypotheses", True),
        ("constraints", True),
        ("deliverables", False),
    ):
        issues.extend(
            _string_list(value.get(key), f"{path}/{key}", allow_empty=allow_empty)
        )

    assets = value.get("assets")
    if not isinstance(assets, list) or not assets:
        issues.append(
            _issue(
                f"{path}/assets",
                "schema.array",
                "Assets must be a non-empty array",
            )
        )
        assets = []
    asset_identities: list[tuple[Any, Any, Any]] = []
    declared_position_roles = 0
    position_capable_roles = 0
    for index, asset in enumerate(assets):
        asset_path = f"{path}/assets/{index}"
        if not isinstance(asset, dict):
            issues.append(_issue(asset_path, "schema.type", "Asset must be an object"))
            continue
        issues.extend(
            _strict_keys(
                asset,
                {"symbol", "assetClass", "venue"},
                asset_path,
                optional={"positionRole"},
            )
        )
        issues.extend(_non_empty(asset.get("symbol"), f"{asset_path}/symbol"))
        if asset.get("assetClass") not in ASSET_CLASSES:
            issues.append(
                _issue(
                    f"{asset_path}/assetClass",
                    "schema.choice",
                    "Invalid asset class",
                )
            )
        venue = asset.get("venue")
        if venue is not None:
            issues.extend(_non_empty(venue, f"{asset_path}/venue"))
        if "positionRole" in asset:
            declared_position_roles += 1
            role = asset.get("positionRole")
            if role not in ASSET_POSITION_ROLES:
                issues.append(
                    _issue(
                        f"{asset_path}/positionRole",
                        "request.asset-position-role",
                        "positionRole must be long-only, short-only, "
                        "two-sided, or context-only",
                    )
                )
            elif role != "context-only":
                position_capable_roles += 1
        asset_identities.append(
            (asset.get("assetClass"), asset.get("symbol"), venue)
        )
    if len(asset_identities) != len(set(asset_identities)):
        issues.append(
            _issue(f"{path}/assets", "request.duplicate-asset", "Assets must be unique")
        )
    if declared_position_roles not in {0, len(assets)}:
        issues.append(
            _issue(
                f"{path}/assets",
                "request.partial-asset-position-roles",
                "If one requested asset declares positionRole, every "
                "requested asset must declare one",
            )
        )
    descriptive_event_roles = (
        normalized_event_policy is not None
        and value.get("direction") == "research-only"
    )
    if (
        declared_position_roles == len(assets)
        and position_capable_roles == 0
        and not descriptive_event_roles
    ):
        issues.append(
            _issue(
                f"{path}/assets",
                "request.no-position-capable-asset",
                "An explicit role contract requires at least one "
                "position-capable asset",
            )
        )
    if declared_position_roles == len(assets):
        valid_roles = {
            asset.get("positionRole")
            for asset in assets
            if isinstance(asset, dict)
        }
        has_long_role = bool(
            valid_roles & {"long-only", "two-sided"}
        )
        has_short_role = bool(
            valid_roles & {"short-only", "two-sided"}
        )
        direction = value.get("direction")
        if direction == "long" and not has_long_role:
            issues.append(
                _issue(
                    f"{path}/assets",
                    "request.direction-role-conflict",
                    "A long request requires at least one long-capable asset",
                )
            )
        if direction == "short" and not has_short_role:
            issues.append(
                _issue(
                    f"{path}/assets",
                    "request.direction-role-conflict",
                    "A short request requires at least one short-capable asset",
                )
            )
        if (
            direction in {"long-short", "relative-value"}
            and not (has_long_role and has_short_role)
        ):
            issues.append(
                _issue(
                    f"{path}/assets",
                    "request.direction-role-conflict",
                    "A two-sided request requires both long-capable and "
                    "short-capable assets",
                )
            )
    if normalized_factor_policy is not None:
        claim = normalized_factor_policy["claim"]
        prediction_assets = normalized_factor_policy.get("predictionAssets")
        requested_symbols = [
            asset.get("symbol")
            for asset in assets
            if isinstance(asset, dict)
            and isinstance(asset.get("symbol"), str)
        ]
        if claim == "decision-signal" and prediction_assets is None:
            issues.append(
                _issue(
                    f"{path}/factorPolicy/predictionAssets",
                    "request.factor-prediction-assets-required",
                    "decision-signal requires explicit predictionAssets",
                )
            )
        elif claim != "decision-signal" and prediction_assets is not None:
            issues.append(
                _issue(
                    f"{path}/factorPolicy/predictionAssets",
                    "request.factor-prediction-assets-claim",
                    "Only decision-signal may declare predictionAssets; "
                    "novel and known-style claims evaluate the complete "
                    "research universe",
                )
            )
        elif isinstance(prediction_assets, list):
            unknown = [
                asset
                for asset in prediction_assets
                if asset not in requested_symbols
            ]
            if unknown:
                issues.append(
                    _issue(
                        f"{path}/factorPolicy/predictionAssets",
                        "request.factor-prediction-assets-unrequested",
                        "predictionAssets may name requested assets only: "
                        + ", ".join(unknown),
                    )
                )
    if normalized_event_policy is not None:
        requested_symbols = {
            identity[1]
            for identity in asset_identities
            if isinstance(identity[1], str)
        }
        for key in ("asset", "referenceAsset"):
            symbol = normalized_event_policy[key]
            if symbol not in requested_symbols:
                issues.append(
                    _issue(
                        f"{path}/eventPolicy/{key}",
                        "request.event-policy-unrequested",
                        f"{key} must name one requested asset",
                    )
                )
    if normalized_policy is not None:
        requested_symbols = {
            identity[1]
            for identity in asset_identities
            if isinstance(identity[1], str)
        }
        requested_roles = {
            asset.get("symbol"): asset.get("positionRole")
            for asset in assets
            if isinstance(asset, dict)
            and isinstance(asset.get("symbol"), str)
        }
        global_cap = normalized_policy["maxAbsWeight"]
        for symbol, asset_cap in normalized_policy[
            "assetMaxAbsWeights"
        ].items():
            cap_path = (
                f"{path}/portfolioPolicy/assetMaxAbsWeights/{symbol}"
            )
            if symbol not in requested_symbols:
                issues.append(
                    _issue(
                        cap_path,
                        "request.asset-cap-unrequested",
                        "Per-asset caps may name requested assets only",
                    )
                )
            elif requested_roles.get(symbol) == "context-only":
                issues.append(
                    _issue(
                        cap_path,
                        "request.asset-cap-context-only",
                        "A context-only asset cannot receive a position cap",
                    )
                )
            if not 0 < asset_cap <= global_cap:
                issues.append(
                    _issue(
                        cap_path,
                        "request.asset-cap-bound",
                        "Per-asset caps must be positive and no greater "
                        "than maxAbsWeight",
                    )
                )
    if (
        normalized_benchmark_policy is not None
        and normalized_benchmark_policy.get("kind") == "fixed-weights"
    ):
        requested_roles = {
            asset.get("symbol"): asset.get("positionRole")
            for asset in assets
            if isinstance(asset, dict)
            and isinstance(asset.get("symbol"), str)
        }
        for symbol in normalized_benchmark_policy["weights"]:
            weight_path = f"{path}/benchmarkPolicy/weights/{symbol}"
            if symbol not in requested_roles:
                issues.append(
                    _issue(
                        weight_path,
                        "request.benchmark-unrequested",
                        "Benchmark weights may name requested assets only",
                    )
                )
    if normalized_position_snapshot is not None:
        requested_roles = {
            asset.get("symbol"): asset.get("positionRole")
            for asset in assets
            if isinstance(asset, dict)
            and isinstance(asset.get("symbol"), str)
        }
        for symbol in normalized_position_snapshot["weights"]:
            if symbol not in requested_roles:
                issues.append(
                    _issue(
                        f"{path}/positionSnapshot/weights/{symbol}",
                        "request.position-snapshot-unrequested",
                        "Position snapshot weights may name requested assets only",
                    )
                )
            elif requested_roles.get(symbol) == "context-only":
                issues.append(
                    _issue(
                        f"{path}/positionSnapshot/weights/{symbol}",
                        "request.position-snapshot-context-only",
                        "A context-only asset cannot appear in the position snapshot",
                    )
                )
        for index, scenario in enumerate(
            normalized_position_scenarios or []
        ):
            for symbol in scenario["weights"]:
                if symbol not in requested_roles:
                    issues.append(
                        _issue(
                            f"{path}/positionScenarios/{index}/weights/{symbol}",
                            "request.position-scenario-unrequested",
                            "Scenario weights may name requested assets only",
                        )
                    )
                elif requested_roles.get(symbol) == "context-only":
                    issues.append(
                        _issue(
                            f"{path}/positionScenarios/{index}/weights/{symbol}",
                            "request.position-scenario-context-only",
                            "A context-only asset cannot appear in a "
                            "position scenario",
                        )
                    )
        if normalized_position_sizing is not None:
            sizing_asset = normalized_position_sizing["asset"]
            if sizing_asset not in requested_roles:
                issues.append(
                    _issue(
                        f"{path}/positionSizing/asset",
                        "request.position-sizing-unrequested",
                        "The adjustable asset must be a requested asset",
                    )
                )
            elif requested_roles.get(sizing_asset) == "context-only":
                issues.append(
                    _issue(
                        f"{path}/positionSizing/asset",
                        "request.position-sizing-context-only",
                        "A context-only asset cannot be the adjustable asset",
                    )
                )
            if (
                normalized_policy is not None
                and normalized_position_sizing["direction"] == "increase"
            ):
                effective_cap = normalized_policy[
                    "assetMaxAbsWeights"
                ].get(sizing_asset, normalized_policy["maxAbsWeight"])
                if (
                    normalized_position_sizing["maximumWeight"]
                    > effective_cap + 1e-12
                ):
                    issues.append(
                        _issue(
                            f"{path}/positionSizing/maximumWeight",
                            "request.position-sizing-portfolio-cap",
                            "maximumWeight cannot exceed the effective "
                            "portfolio position cap",
                        )
                    )

    source = value.get("source")
    if not isinstance(source, dict):
        issues.append(_issue(f"{path}/source", "schema.type", "Source must be an object"))
    else:
        issues.extend(
            _strict_keys(
                source,
                {
                    "system",
                    "workspaceId",
                    "sessionId",
                    "artifactPath",
                    "artifactRevision",
                },
                f"{path}/source",
            )
        )
        if source.get("system") not in SOURCE_SYSTEMS:
            issues.append(
                _issue(
                    f"{path}/source/system",
                    "schema.choice",
                    "Invalid source system",
                )
            )
        for key in ("workspaceId", "sessionId", "artifactPath", "artifactRevision"):
            item = source.get(key)
            if item is not None:
                issues.extend(_non_empty(item, f"{path}/source/{key}"))
        has_artifact = source.get("artifactPath") is not None
        has_revision = source.get("artifactRevision") is not None
        if has_artifact != has_revision:
            issues.append(
                _issue(
                    f"{path}/source",
                    "request.source-revision",
                    "artifactPath and artifactRevision must be provided together",
                )
            )
    if issues:
        raise AutoQuantValidationError(issues)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": REQUEST_KIND,
        "title": value["title"].strip(),
        "question": value["question"].strip(),
        "decisionContext": value["decisionContext"].strip(),
        "assets": [
            {
                "symbol": asset["symbol"].strip(),
                "assetClass": asset["assetClass"],
                "venue": (
                    asset["venue"].strip()
                    if isinstance(asset["venue"], str)
                    else None
                ),
                **(
                    {"positionRole": asset["positionRole"]}
                    if "positionRole" in asset
                    else {}
                ),
            }
            for asset in value["assets"]
        ],
        "direction": value["direction"],
        **(
            {"benchmarkPolicy": normalized_benchmark_policy}
            if "benchmarkPolicy" in value
            else {}
        ),
        **(
            {"portfolioPolicy": normalized_policy}
            if "portfolioPolicy" in value
            else {}
        ),
        **(
            {"allocationPolicy": normalized_allocation_policy}
            if "allocationPolicy" in value
            else {}
        ),
        **(
            {"horizonPolicy": normalized_horizon_policy}
            if "horizonPolicy" in value
            else {}
        ),
        **(
            {"factorPolicy": normalized_factor_policy}
            if "factorPolicy" in value
            else {}
        ),
        **(
            {"positionSnapshot": normalized_position_snapshot}
            if "positionSnapshot" in value
            else {}
        ),
        **(
            {"positionScenarios": normalized_position_scenarios}
            if "positionScenarios" in value
            else {}
        ),
        **(
            {"positionSizing": normalized_position_sizing}
            if "positionSizing" in value
            else {}
        ),
        **(
            {"eventPolicy": normalized_event_policy}
            if "eventPolicy" in value
            else {}
        ),
        **(
            {"pathStressPolicy": normalized_path_stress_policy}
            if "pathStressPolicy" in value
            else {}
        ),
        "horizon": value["horizon"].strip(),
        "hypotheses": [item.strip() for item in value["hypotheses"]],
        "constraints": [item.strip() for item in value["constraints"]],
        "deliverables": [item.strip() for item in value["deliverables"]],
        "source": {
            "system": value["source"]["system"],
            **{
                key: (
                    value["source"][key].strip()
                    if isinstance(value["source"][key], str)
                    else None
                )
                for key in (
                    "workspaceId",
                    "sessionId",
                    "artifactPath",
                    "artifactRevision",
                )
            },
        },
    }


def load_research_request(path: str | Path) -> dict[str, Any]:
    request_path = Path(path).expanduser().absolute()
    return validate_research_request(
        _read_json(request_path, "research request"),
        request_path,
    )


def build_research_brief(
    request: dict[str, Any],
    project: ProjectContext,
    session_manifest: dict[str, Any],
    baseline_result: dict[str, Any],
    *,
    created_at: str,
) -> dict[str, Any]:
    """Derive one exact brief from normalized request and fixed Session inputs."""

    request_hash = hash_json(request)
    identity = {
        "requestHash": request_hash,
        "projectId": project.manifest.id,
        "sessionId": session_manifest["id"],
        "studyId": session_manifest["studyId"],
        "baselineRunId": session_manifest["baseline"]["runId"],
        "locks": {
            key: value
            for key, value in session_manifest["locks"].items()
            if key != "fixedHashes"
        },
        "createdAt": created_at,
    }
    brief_id = f"brief-{hash_json(identity)[:16]}"
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": BRIEF_KIND,
        "id": brief_id,
        "authority": "derived-research-handoff",
        "claimKind": "research-prioritization",
        "createdAt": created_at,
        "requestHash": request_hash,
        "project": {
            "id": project.manifest.id,
            "name": project.manifest.name,
        },
        "sessionId": session_manifest["id"],
        "study": {
            "id": baseline_result["study"]["id"],
            "name": baseline_result["study"]["name"],
            "hash": session_manifest["locks"]["studyHash"],
            "programHash": session_manifest["locks"]["programHash"],
            "judgeHash": session_manifest["locks"]["judgeHash"],
            "datasetHash": session_manifest["locks"]["datasetHash"],
            **(
                {
                    "dependencyHash": session_manifest["locks"][
                        "dependencyHash"
                    ]
                }
                if "dependencyHash" in session_manifest["locks"]
                else {}
            ),
            "objective": baseline_result["objective"],
            "dataset": baseline_result["dataset"],
        },
        "baseline": session_manifest["baseline"],
        "harness": session_manifest["locks"]["harness"],
        "authorityBoundary": {
            "requestContext": "caller-supplied-content-locked",
            "fixedEvaluation": "locked-study-and-judge",
            "candidateEdits": "study-editable-closure-only",
            "verdict": "locked-judge-only",
            "trading": "none",
            "openAliceProvenance": "authenticated-on-openalice-inbox-publication",
        },
    }


def validate_session_brief(
    project: ProjectContext,
    session_root: Path,
    session_manifest: dict[str, Any],
    baseline_result: dict[str, Any],
) -> dict[str, Any] | None:
    """Verify optional request/brief bytes against the mutable Session pointer."""

    request_path = session_root / RESEARCH_REQUEST
    brief_path = session_root / RESEARCH_BRIEF
    pointer = session_manifest.get("brief")
    if pointer is None:
        if (
            request_path.exists()
            or request_path.is_symlink()
            or brief_path.exists()
            or brief_path.is_symlink()
        ):
            raise AutoQuantValidationError(
                [
                    _issue(
                        session_root,
                        "brief.untracked",
                        "Session has untracked request or brief files",
                    )
                ]
            )
        return None
    issues: list[ValidationIssue] = []
    if not isinstance(pointer, dict):
        raise AutoQuantValidationError(
            [_issue(f"{session_root}/brief", "schema.type", "Brief pointer must be an object")]
        )
    issues.extend(
        _strict_keys(
            pointer,
            {"id", "requestHash", "briefHash"},
            f"{session_root}/session.json/brief",
        )
    )
    for key in ("requestHash", "briefHash"):
        if (
            not isinstance(pointer.get(key), str)
            or len(pointer.get(key, "")) != 64
            or any(character not in "0123456789abcdef" for character in pointer.get(key, ""))
        ):
            issues.append(
                _issue(
                    f"{session_root}/session.json/brief/{key}",
                    "schema.hash",
                    f"Invalid {key}",
                )
            )
    request = validate_research_request(
        _read_json(request_path, "research request"),
        request_path,
    )
    brief = _read_json(brief_path, "research brief")
    brief_required = {
        "schemaVersion",
        "kind",
        "id",
        "authority",
        "claimKind",
        "createdAt",
        "requestHash",
        "project",
        "sessionId",
        "study",
        "baseline",
        "harness",
        "authorityBoundary",
    }
    issues.extend(_strict_keys(brief, brief_required, brief_path))
    if brief.get("schemaVersion") != SCHEMA_VERSION or brief.get("kind") != BRIEF_KIND:
        issues.append(_issue(brief_path, "brief.schema", "Invalid Research Brief schema"))
    if not isinstance(brief.get("createdAt"), str) or not brief["createdAt"]:
        issues.append(_issue(f"{brief_path}/createdAt", "schema.string", "Invalid createdAt"))
    if issues:
        raise AutoQuantValidationError(issues)
    expected = build_research_brief(
        request,
        project,
        session_manifest,
        baseline_result,
        created_at=brief["createdAt"],
    )
    request_hash = hash_json(request)
    brief_hash = hash_json(brief)
    if request_hash != pointer.get("requestHash"):
        issues.append(_issue(request_path, "brief.request-hash", "Request hash mismatch"))
    if brief != expected:
        issues.append(
            _issue(brief_path, "brief.derived", "Research Brief differs from fixed inputs")
        )
    if brief.get("id") != pointer.get("id"):
        issues.append(_issue(brief_path, "brief.id", "Research Brief id mismatch"))
    if brief_hash != pointer.get("briefHash"):
        issues.append(_issue(brief_path, "brief.hash", "Research Brief hash mismatch"))
    if issues:
        raise AutoQuantValidationError(issues)
    return {"request": request, "brief": brief}


RESEARCH_REQUEST_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant delegated research request",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "title",
        "question",
        "decisionContext",
        "assets",
        "direction",
        "horizon",
        "hypotheses",
        "constraints",
        "deliverables",
        "source",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": REQUEST_KIND},
        "title": {"type": "string", "minLength": 1},
        "question": {"type": "string", "minLength": 1},
        "decisionContext": {"type": "string", "minLength": 1},
        "assets": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["symbol", "assetClass", "venue"],
                "properties": {
                    "symbol": {"type": "string", "minLength": 1},
                    "assetClass": {"enum": sorted(ASSET_CLASSES)},
                    "venue": {
                        "anyOf": [
                            {"type": "null"},
                            {"type": "string", "minLength": 1},
                        ]
                    },
                    "positionRole": {
                        "enum": sorted(ASSET_POSITION_ROLES),
                    },
                },
            },
        },
        "direction": {"enum": sorted(REQUEST_DIRECTIONS)},
        "factorPolicy": {
            "oneOf": [
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "claim",
                        "knownStyle",
                        "predictionAssets",
                    ],
                    "properties": {
                        "claim": {"const": "decision-signal"},
                        "knownStyle": {"type": "null"},
                        "outcome": {"enum": sorted(FACTOR_OUTCOMES)},
                        "predictionAssets": {
                            "type": "array",
                            "minItems": 1,
                            "uniqueItems": True,
                            "items": {"type": "string", "minLength": 1},
                        },
                    },
                },
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["claim", "knownStyle"],
                    "properties": {
                        "claim": {"const": "novel-factor"},
                        "knownStyle": {"type": "null"},
                        "outcome": {"enum": sorted(FACTOR_OUTCOMES)},
                    },
                },
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["claim", "knownStyle"],
                    "properties": {
                        "claim": {"const": "known-style-validation"},
                        "knownStyle": {
                            "enum": sorted(KNOWN_FACTOR_STYLES),
                        },
                        "outcome": {"enum": sorted(FACTOR_OUTCOMES)},
                    },
                },
            ]
        },
        "benchmarkPolicy": {
            "oneOf": [
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["kind", "symbol"],
                    "properties": {
                        "kind": {"const": "cash"},
                        "symbol": {"type": "null"},
                    },
                },
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["kind", "symbol"],
                    "properties": {
                        "kind": {"const": "asset"},
                        "symbol": {
                            "type": "string",
                            "minLength": 1,
                        },
                    },
                },
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["kind", "weights"],
                    "properties": {
                        "kind": {"const": "fixed-weights"},
                        "weights": {
                            "type": "object",
                            "minProperties": 1,
                            "maxProperties": 256,
                            "additionalProperties": {
                                "type": "number",
                                "exclusiveMinimum": 0,
                                "maximum": 1,
                            },
                        },
                    },
                },
            ]
        },
        "allocationPolicy": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "covarianceWindow",
                "minimumObservations",
                "contributionTolerance",
                "scaleUp",
            ],
            "properties": {
                "kind": {"const": ALLOCATION_METHOD},
                "covarianceWindow": {
                    "type": "integer",
                    "minimum": MIN_COVARIANCE_WINDOW,
                    "maximum": MAX_COVARIANCE_WINDOW,
                },
                "minimumObservations": {"type": "integer", "minimum": 2},
                "contributionTolerance": {
                    "type": "number",
                    "minimum": MIN_CONTRIBUTION_TOLERANCE,
                    "maximum": MAX_CONTRIBUTION_TOLERANCE,
                },
                "scaleUp": {"const": False},
            },
        },
        "positionSnapshot": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "asOf",
                "baseCurrency",
                "weights",
                "cashWeight",
            ],
            "properties": {
                "kind": {"enum": sorted(POSITION_SNAPSHOT_KINDS)},
                "asOf": {"type": "string", "format": "date-time"},
                "baseCurrency": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 16,
                },
                "weights": {
                    "type": "object",
                    "minProperties": 1,
                    "maxProperties": 256,
                    "additionalProperties": {
                        "type": "number",
                        "minimum": -2,
                        "maximum": 2,
                    },
                },
                "cashWeight": {
                    "type": "number",
                    "minimum": -3,
                    "maximum": 3,
                },
            },
        },
        "positionScenarios": {
            "type": "array",
            "minItems": 1,
            "maxItems": MAX_POSITION_SCENARIOS,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "name",
                    "kind",
                    "asOf",
                    "baseCurrency",
                    "weights",
                    "cashWeight",
                ],
                "properties": {
                    "id": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 64,
                        "pattern": POSITION_SCENARIO_ID.pattern,
                    },
                    "name": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 120,
                    },
                    "kind": {"const": "hypothetical-weights"},
                    "asOf": {"type": "string", "format": "date-time"},
                    "baseCurrency": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 16,
                    },
                    "weights": {
                        "type": "object",
                        "minProperties": 1,
                        "maxProperties": 256,
                        "additionalProperties": {
                            "type": "number",
                            "minimum": -2,
                            "maximum": 2,
                        },
                    },
                    "cashWeight": {
                        "type": "number",
                        "minimum": -3,
                        "maximum": 3,
                    },
                },
            },
        },
        "positionSizing": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "asset",
                "direction",
                "annualizedVolatilityCeiling",
                "lookbackBars",
            ],
            "properties": {
                "kind": {"const": POSITION_SIZING_KIND},
                "asset": {"type": "string", "minLength": 1},
                "direction": {
                    "enum": sorted(POSITION_SIZING_DIRECTIONS),
                },
                "minimumWeight": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2,
                },
                "maximumWeight": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2,
                },
                "annualizedVolatilityCeiling": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 10,
                },
                "lookbackBars": {
                    "enum": sorted(POSITION_SIZING_LOOKBACKS),
                },
            },
            "allOf": [
                {
                    "if": {
                        "properties": {"direction": {"const": "increase"}}
                    },
                    "then": {
                        "required": ["maximumWeight"],
                        "not": {"required": ["minimumWeight"]},
                    },
                },
                {
                    "if": {
                        "properties": {"direction": {"const": "decrease"}}
                    },
                    "then": {
                        "required": ["minimumWeight"],
                        "not": {"required": ["maximumWeight"]},
                    },
                },
            ],
        },
        "eventPolicy": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "asset",
                "comparator",
                "thresholdReturn",
                "waitBars",
                "holdingBars",
                "referenceAsset",
                "overlapPolicy",
                "minimumEvents",
            ],
            "properties": {
                "kind": {"const": EVENT_POLICY_KIND},
                "asset": {"type": "string", "minLength": 1},
                "comparator": {"const": EVENT_COMPARATOR},
                "thresholdReturn": {
                    "type": "number",
                    "exclusiveMinimum": -1,
                    "exclusiveMaximum": 0,
                },
                "waitBars": {
                    "type": "integer",
                    "minimum": MIN_WAIT_BARS,
                    "maximum": MAX_WAIT_BARS,
                },
                "holdingBars": {
                    "type": "integer",
                    "minimum": MIN_HOLDING_BARS,
                    "maximum": MAX_HOLDING_BARS,
                },
                "referenceAsset": {"type": "string", "minLength": 1},
                "overlapPolicy": {"const": OVERLAP_POLICY},
                "minimumEvents": {
                    "type": "integer",
                    "minimum": MIN_EVENT_COUNT,
                    "maximum": MAX_EVENT_COUNT,
                },
            },
        },
        "pathStressPolicy": {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "holdingBars", "episodeCount", "overlapPolicy"],
            "properties": {
                "kind": {"const": PATH_STRESS_POLICY_KIND},
                "holdingBars": {
                    "type": "integer",
                    "minimum": MIN_PATH_STRESS_HOLDING_BARS,
                    "maximum": MAX_PATH_STRESS_HOLDING_BARS,
                },
                "episodeCount": {
                    "type": "integer",
                    "minimum": MIN_PATH_STRESS_EPISODES,
                    "maximum": MAX_PATH_STRESS_EPISODES,
                },
                "overlapPolicy": {"const": PATH_STRESS_OVERLAP_POLICY},
            },
        },
        "portfolioPolicy": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": sorted(PORTFOLIO_POLICY_FIELDS),
                    "properties": {
                        "grossLimit": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                            "maximum": 2,
                        },
                        "maxAbsWeight": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                            "maximum": 2,
                        },
                        "assetMaxAbsWeights": {
                            "type": "object",
                            "maxProperties": 256,
                            "additionalProperties": {
                                "type": "number",
                                "exclusiveMinimum": 0,
                                "maximum": 2,
                            },
                        },
                        "annualizedVolatilityCeiling": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                            "maximum": 1,
                        },
                        "baseCostBps": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1000,
                        },
                        "noTradeOneWay": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "referenceNav": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                            "maximum": 1e12,
                        },
                        "decisionSchedule": {
                            "oneOf": [
                                {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": [
                                        "kind",
                                        "bars",
                                        "anchor",
                                    ],
                                    "properties": {
                                        "kind": {
                                            "const": "every-bars",
                                        },
                                        "bars": {
                                            "type": "integer",
                                            "minimum": 1,
                                            "maximum": 252,
                                        },
                                        "anchor": {
                                            "enum": sorted(
                                                DECISION_ANCHORS
                                            ),
                                        },
                                    },
                                },
                                {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["kind"],
                                    "properties": {
                                        "kind": {
                                            "const": "calendar-month-end",
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            ]
        },
        "horizonPolicy": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "primaryForwardBars",
                        "diagnosticForwardBars",
                    ],
                    "properties": {
                        "primaryForwardBars": {
                            "type": "integer",
                            "minimum": MIN_FORWARD_BARS,
                            "maximum": MAX_FORWARD_BARS,
                            "description": (
                                "Required validation-selection horizon. Core "
                                "always evaluates it and adds it to the "
                                "canonical evaluated horizon set."
                            ),
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
                            "description": (
                                "Sorted unique additional context horizons. "
                                "The primary may be omitted here; Core stores "
                                "the sorted union, capped at five total."
                            ),
                        },
                    },
                },
            ]
        },
        "horizon": {"type": "string", "minLength": 1},
        "hypotheses": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
        },
        "constraints": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
        },
        "deliverables": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string", "minLength": 1},
        },
        "source": {
            "description": (
                "Caller-supplied, unauthenticated origin claim. "
                "artifactPath and artifactRevision are a pair: set both to "
                "non-empty strings when an exact source artifact is known, "
                "or set both to null when it is not."
            ),
            "type": "object",
            "additionalProperties": False,
            "required": [
                "system",
                "workspaceId",
                "sessionId",
                "artifactPath",
                "artifactRevision",
            ],
            "properties": {
                "system": {"enum": sorted(SOURCE_SYSTEMS)},
                "workspaceId": {
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "minLength": 1},
                    ]
                },
                "sessionId": {
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "minLength": 1},
                    ]
                },
                "artifactPath": {
                    "description": (
                        "Exact caller artifact locator, or null. Must be "
                        "non-null if and only if artifactRevision is non-null."
                    ),
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "minLength": 1},
                    ]
                },
                "artifactRevision": {
                    "description": (
                        "Exact revision claim for artifactPath, or null. Must "
                        "be non-null if and only if artifactPath is non-null; "
                        "a local immutable file may use an explicit content "
                        "digest such as sha256:<hex>."
                    ),
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "minLength": 1},
                    ]
                },
            },
            "oneOf": [
                {
                    "properties": {
                        "artifactPath": {"type": "null"},
                        "artifactRevision": {"type": "null"},
                    }
                },
                {
                    "properties": {
                        "artifactPath": {
                            "type": "string",
                            "minLength": 1,
                        },
                        "artifactRevision": {
                            "type": "string",
                            "minLength": 1,
                        },
                    }
                },
            ],
        },
    },
}
