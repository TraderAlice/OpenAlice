"""Strict request-bound portfolio-native allocation contracts."""

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


ALLOCATION_POLICY = "strategies/allocation-policy.json"
ALLOCATION_POLICY_KIND = "autoquant-allocation-policy"
ALLOCATION_METHOD = "equal-risk-contribution"
MIN_COVARIANCE_WINDOW = 20
MAX_COVARIANCE_WINDOW = 756
MIN_CONTRIBUTION_TOLERANCE = 1e-6
MAX_CONTRIBUTION_TOLERANCE = 0.25


def _issue(path: str | Path, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def normalize_allocation_policy(
    value: Any,
    path: str | Path = "allocationPolicy",
) -> dict[str, Any]:
    """Validate the one deliberately narrow portfolio construction method."""

    issues: list[ValidationIssue] = []
    required = {
        "kind",
        "covarianceWindow",
        "minimumObservations",
        "contributionTolerance",
        "scaleUp",
    }
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, "allocation-policy.type", "allocationPolicy must be an object")]
        )
    for key in sorted(required - set(value)):
        issues.append(
            _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        )
    for key in sorted(set(value) - required):
        issues.append(
            _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        )
    kind = value.get("kind")
    if kind != ALLOCATION_METHOD:
        issues.append(
            _issue(
                f"{path}/kind",
                "allocation-policy.kind",
                f"Allocation kind must be {ALLOCATION_METHOD}",
            )
        )
    window = value.get("covarianceWindow")
    minimum = value.get("minimumObservations")
    tolerance = value.get("contributionTolerance")
    if (
        not isinstance(window, int)
        or isinstance(window, bool)
        or not MIN_COVARIANCE_WINDOW <= window <= MAX_COVARIANCE_WINDOW
    ):
        issues.append(
            _issue(
                f"{path}/covarianceWindow",
                "allocation-policy.window",
                f"covarianceWindow must be an integer from "
                f"{MIN_COVARIANCE_WINDOW} to {MAX_COVARIANCE_WINDOW}",
            )
        )
    if (
        not isinstance(minimum, int)
        or isinstance(minimum, bool)
        or not isinstance(window, int)
        or isinstance(window, bool)
        or not 2 <= minimum <= window
    ):
        issues.append(
            _issue(
                f"{path}/minimumObservations",
                "allocation-policy.minimum-observations",
                "minimumObservations must be an integer from 2 through "
                "covarianceWindow",
            )
        )
    if (
        not isinstance(tolerance, (int, float))
        or isinstance(tolerance, bool)
        or not math.isfinite(float(tolerance))
        or not MIN_CONTRIBUTION_TOLERANCE
        <= float(tolerance)
        <= MAX_CONTRIBUTION_TOLERANCE
    ):
        issues.append(
            _issue(
                f"{path}/contributionTolerance",
                "allocation-policy.tolerance",
                "contributionTolerance is outside the supported bound",
            )
        )
    if value.get("scaleUp") is not False:
        issues.append(
            _issue(
                f"{path}/scaleUp",
                "allocation-policy.scale-up",
                "Portfolio-native ERC supports scale-down only",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        "kind": ALLOCATION_METHOD,
        "covarianceWindow": int(window),
        "minimumObservations": int(minimum),
        "contributionTolerance": float(tolerance),
        "scaleUp": False,
    }


def normalize_fixed_weight_benchmark(
    value: Any,
    *,
    requested_symbols: set[str] | None = None,
    path: str | Path = "benchmarkPolicy",
) -> dict[str, Any]:
    """Validate one funded, non-negative, fixed-weight reference portfolio."""

    issues: list[ValidationIssue] = []
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, "benchmark.type", "benchmarkPolicy must be an object")]
        )
    required = {"kind", "weights"}
    for key in sorted(required - set(value)):
        issues.append(
            _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        )
    for key in sorted(set(value) - required):
        issues.append(
            _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        )
    if value.get("kind") != "fixed-weights":
        issues.append(
            _issue(
                f"{path}/kind",
                "request.benchmark-kind",
                "This benchmark must use kind fixed-weights",
            )
        )
    raw_weights = value.get("weights")
    weights: dict[str, float] = {}
    if not isinstance(raw_weights, dict) or not raw_weights:
        issues.append(
            _issue(
                f"{path}/weights",
                "request.benchmark-weights",
                "Fixed-weight benchmark weights must be a non-empty object",
            )
        )
    else:
        for symbol, raw_weight in raw_weights.items():
            item_path = f"{path}/weights/{symbol}"
            if not isinstance(symbol, str) or not symbol.strip():
                issues.append(
                    _issue(
                        item_path,
                        "request.benchmark-symbol",
                        "Benchmark symbols must be non-empty strings",
                    )
                )
                continue
            normalized_symbol = symbol.strip()
            if normalized_symbol in weights:
                issues.append(
                    _issue(
                        item_path,
                        "request.benchmark-duplicate",
                        "Benchmark symbols must be unique after whitespace normalization",
                    )
                )
                continue
            if (
                not isinstance(raw_weight, (int, float))
                or isinstance(raw_weight, bool)
                or not math.isfinite(float(raw_weight))
                or float(raw_weight) <= 0
                or float(raw_weight) > 1
            ):
                issues.append(
                    _issue(
                        item_path,
                        "request.benchmark-weight",
                        "Every funded benchmark weight must be finite and in (0, 1]",
                    )
                )
                continue
            weights[normalized_symbol] = float(raw_weight)
    if weights and not math.isclose(
        sum(weights.values()),
        1.0,
        rel_tol=0.0,
        abs_tol=1e-9,
    ):
        issues.append(
            _issue(
                f"{path}/weights",
                "request.benchmark-funded",
                "Fixed-weight benchmark weights must sum to 1",
            )
        )
    if requested_symbols is not None:
        unknown = sorted(set(weights) - requested_symbols)
        if unknown:
            issues.append(
                _issue(
                    f"{path}/weights",
                    "request.benchmark-unrequested",
                    "Benchmark weights name unrequested assets: " + ", ".join(unknown),
                )
            )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        "kind": "fixed-weights",
        "weights": {symbol: weights[symbol] for symbol in sorted(weights)},
    }


def build_allocation_contract(
    request: dict[str, Any],
    universe: list[str],
    *,
    annualization_periods: int,
) -> dict[str, Any]:
    """Freeze the exact allocation and comparison authority consumed by the Judge."""

    policy = normalize_allocation_policy(request.get("allocationPolicy"))
    benchmark = normalize_fixed_weight_benchmark(
        request.get("benchmarkPolicy"),
        requested_symbols=set(universe),
    )
    portfolio = request.get("portfolioPolicy")
    if not isinstance(portfolio, dict):
        raise ValueError("allocation request requires portfolioPolicy")
    roles = {
        item["symbol"]: item.get("positionRole")
        for item in request["assets"]
    }
    tradable = [
        symbol
        for symbol in universe
        if roles.get(symbol) == "long-only"
    ]
    context = [symbol for symbol in universe if symbol not in tradable]
    if not tradable:
        raise ValueError("allocation request has no long-only assets")
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": ALLOCATION_POLICY_KIND,
        "source": {
            "kind": "research-request",
            "requestHash": hash_json(request),
        },
        "method": policy,
        "universe": list(universe),
        "tradableAssets": tradable,
        "contextAssets": context,
        "assetPositionRoles": {
            symbol: roles.get(symbol, "context-only")
            for symbol in universe
        },
        "portfolioPolicy": portfolio,
        "benchmark": benchmark,
        "annualizationPeriods": int(annualization_periods),
        "selectionPolicy": {
            "primarySplit": "validation",
            "primaryMetric": "netSharpeAdvantage",
            "testRole": "visible-audit-only",
        },
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
    }
    return {
        **payload,
        "id": f"allocation-{hash_json(payload)[:16]}",
    }


def validate_allocation_contract(
    value: dict[str, Any],
    path: str | Path = ALLOCATION_POLICY,
) -> dict[str, Any]:
    """Validate a frozen contract by rebuilding its canonical identity."""

    required = {
        "schemaVersion",
        "kind",
        "id",
        "source",
        "method",
        "universe",
        "tradableAssets",
        "contextAssets",
        "assetPositionRoles",
        "portfolioPolicy",
        "benchmark",
        "annualizationPeriods",
        "selectionPolicy",
        "authority",
        "tradingAuthority",
    }
    if set(value) != required:
        raise AutoQuantValidationError(
            [_issue(path, "allocation-contract.schema", "Contract fields differ")]
        )
    request_hash = value.get("source", {}).get("requestHash")
    universe = value.get("universe")
    tradable = value.get("tradableAssets")
    context = value.get("contextAssets")
    roles = value.get("assetPositionRoles")
    if (
        value.get("schemaVersion") != SCHEMA_VERSION
        or value.get("kind") != ALLOCATION_POLICY_KIND
        or not isinstance(request_hash, str)
        or len(request_hash) != 64
        or not isinstance(universe, list)
        or not universe
        or len(universe) != len(set(universe))
        or not isinstance(tradable, list)
        or not tradable
        or not isinstance(context, list)
        or set(tradable) | set(context) != set(universe)
        or set(tradable) & set(context)
        or not isinstance(roles, dict)
        or set(roles) != set(universe)
        or any(
            roles[symbol]
            != ("long-only" if symbol in tradable else "context-only")
            for symbol in universe
        )
        or not isinstance(value.get("annualizationPeriods"), int)
        or value["annualizationPeriods"] < 1
        or value.get("selectionPolicy")
        != {
            "primarySplit": "validation",
            "primaryMetric": "netSharpeAdvantage",
            "testRole": "visible-audit-only",
        }
        or value.get("authority") != "quantitative-decision-support"
        or value.get("tradingAuthority") != "none"
    ):
        raise AutoQuantValidationError(
            [_issue(path, "allocation-contract.contract", "Allocation contract is invalid")]
        )
    method = normalize_allocation_policy(value.get("method"), f"{path}/method")
    benchmark = normalize_fixed_weight_benchmark(
        value.get("benchmark"),
        requested_symbols=set(universe),
        path=f"{path}/benchmark",
    )
    portfolio = value.get("portfolioPolicy")
    if not isinstance(portfolio, dict):
        raise AutoQuantValidationError(
            [_issue(f"{path}/portfolioPolicy", "allocation-contract.portfolio", "Invalid portfolioPolicy")]
        )
    payload = {key: value[key] for key in required - {"id"}}
    payload["method"] = method
    payload["benchmark"] = benchmark
    expected_id = f"allocation-{hash_json(payload)[:16]}"
    if value.get("id") != expected_id:
        raise AutoQuantValidationError(
            [_issue(f"{path}/id", "allocation-contract.id", "Contract id does not reconcile")]
        )
    return {**payload, "id": expected_id}


def load_allocation_contract(path: str | Path) -> dict[str, Any]:
    target = Path(path)
    try:
        value = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AutoQuantValidationError(
            [_issue(target, "allocation-contract.json", f"Cannot read contract: {error}")]
        ) from error
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(target, "allocation-contract.type", "Contract must be an object")]
        )
    return validate_allocation_contract(value, target)


ALLOCATION_POLICY_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Allocation Policy",
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
}
