"""Strict request-bound portfolio mandate contracts."""

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


PORTFOLIO_MANDATE = "strategies/portfolio-mandate.json"
PORTFOLIO_MANDATE_KIND = "autoquant-portfolio-mandate"
PORTFOLIO_MANDATE_AUTHORITY = "quantitative-decision-support"
PORTFOLIO_MANDATE_DIRECTIONS = {
    "long",
    "short",
    "long-short",
    "relative-value",
    "research-only",
}
PORTFOLIO_FAMILIES = {
    "long": "long-cash",
    "short": "short-cash",
    "long-short": "dollar-neutral",
    "relative-value": "dollar-neutral",
    "research-only": "dollar-neutral",
}
PORTFOLIO_NET_RULES = {
    "long": "long-only",
    "short": "short-only",
    "long-short": "zero",
    "relative-value": "zero",
    "research-only": "zero",
}
ASSET_POSITION_ROLES = {
    "long-only",
    "short-only",
    "two-sided",
    "context-only",
}
DERIVED_ASSET_POSITION_ROLES = {
    "long": "long-only",
    "short": "short-only",
    "long-short": "two-sided",
    "relative-value": "two-sided",
    "research-only": "two-sided",
}
PORTFOLIO_BENCHMARKS = {
    "long": "equal-weight-long-tradable",
    "short": "equal-weight-short-tradable",
    "long-short": "cash",
    "relative-value": "cash",
    "research-only": "equal-weight-long-research-universe",
}
BENCHMARK_KINDS = {
    "cash",
    "fixed-weights",
    "equal-weight-long-research-universe",
    "equal-weight-long-tradable",
    "equal-weight-short-tradable",
    "equal-weight-long-capable",
    "equal-weight-short-capable",
    "single-asset-long",
}
PORTFOLIO_RISK_POLICY = {
    "method": "trailing-covariance-volatility-ceiling-v1",
    "annualizedVolatilityCeiling": 0.15,
    "covarianceWindow": 60,
    "minimumObservations": 20,
    "annualizationPeriods": 252,
    "scaleUp": False,
}
DEFAULT_PORTFOLIO_POLICY = {
    "grossLimit": 1.0,
    "maxAbsWeight": 0.30,
    "assetMaxAbsWeights": {},
    "annualizedVolatilityCeiling": 0.15,
    "baseCostBps": 10.0,
    "noTradeOneWay": 0.05,
    "referenceNav": 1_000_000.0,
    "decisionSchedule": {
        "kind": "every-bars",
        "bars": 1,
        "anchor": "dataset-start",
    },
}
IMPLEMENTATION_COST_MODEL = "linear-traded-notional-v1"
IMPLEMENTATION_CAPACITY_MODEL = "trailing-dollar-volume-participation-v1"
MIN_ANNUALIZATION_PERIODS = 1
MAX_ANNUALIZATION_PERIODS = 365 * 24 * 60
SHA256 = "^[0-9a-f]{64}$"


def _valid_annualization_periods(value: Any) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and MIN_ANNUALIZATION_PERIODS
        <= value
        <= MAX_ANNUALIZATION_PERIODS
    )


def _valid_decision_schedule(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if value.get("kind") == "every-bars":
        bars = value.get("bars")
        return (
            set(value) == {"kind", "bars", "anchor"}
            and isinstance(bars, int)
            and not isinstance(bars, bool)
            and 1 <= bars <= 252
            and value.get("anchor") in {"dataset-start", "session-start"}
        )
    return (
        value.get("kind") == "calendar-month-end"
        and set(value) == {"kind"}
    )


def _valid_portfolio_policy(
    value: dict[str, Any],
    direction: str,
    asset_position_roles: list[str] | None = None,
) -> bool:
    required = set(DEFAULT_PORTFOLIO_POLICY)
    if set(value) != required:
        return False
    numeric_fields = required - {
        "assetMaxAbsWeights",
        "decisionSchedule",
    }
    if any(
        not isinstance(value[key], (int, float))
        or isinstance(value[key], bool)
        or not math.isfinite(float(value[key]))
        for key in numeric_fields
    ):
        return False
    asset_caps = value["assetMaxAbsWeights"]
    if (
        not isinstance(asset_caps, dict)
        or len(asset_caps) > 256
        or any(
            not isinstance(symbol, str)
            or not symbol.strip()
            or symbol != symbol.strip()
            or not isinstance(item, (int, float))
            or isinstance(item, bool)
            or not math.isfinite(float(item))
            for symbol, item in asset_caps.items()
        )
    ):
        return False
    gross = float(value["grossLimit"])
    cap = float(value["maxAbsWeight"])
    ceiling = float(value["annualizedVolatilityCeiling"])
    cost = float(value["baseCostBps"])
    no_trade = float(value["noTradeOneWay"])
    nav = float(value["referenceNav"])
    decision_schedule = value["decisionSchedule"]
    has_long = (
        any(role in {"long-only", "two-sided"} for role in asset_position_roles)
        if asset_position_roles is not None
        else direction in {"long", "long-short", "relative-value", "research-only"}
    )
    has_short = (
        any(role in {"short-only", "two-sided"} for role in asset_position_roles)
        if asset_position_roles is not None
        else direction in {"short", "long-short", "relative-value", "research-only"}
    )
    maximum_cap = gross / 2.0 if has_long and has_short else gross
    return (
        0 < gross <= 2
        and 0 < cap <= maximum_cap
        and 0 < ceiling <= 1
        and 0 <= cost <= 1000
        and 0 <= no_trade <= 1
        and 0 < nav <= 1e12
        and _valid_decision_schedule(decision_schedule)
        and all(
            0 < float(asset_cap) <= cap
            for asset_cap in asset_caps.values()
        )
    )


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _strict_keys(
    value: dict[str, Any],
    required: set[str],
    path: Path | str,
) -> list[ValidationIssue]:
    issues = [
        _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        for key in sorted(required - value.keys())
    ]
    issues.extend(
        _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        for key in sorted(value.keys() - required)
    )
    return issues


def _valid_hash(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _symbol_list(
    value: Any,
    path: Path | str,
    *,
    allow_empty: bool,
) -> tuple[list[str], list[ValidationIssue]]:
    issues: list[ValidationIssue] = []
    if (
        not isinstance(value, list)
        or (not allow_empty and not value)
        or not all(isinstance(item, str) and item for item in value)
    ):
        issues.append(
            _issue(
                path,
                "mandate.assets",
                "Must be a list of unique non-empty asset symbols",
            )
        )
        return [], issues
    if len(value) != len(set(value)):
        issues.append(
            _issue(path, "mandate.duplicate-asset", "Asset symbols must be unique")
        )
    return list(value), issues


def _canonical_payload(
    *,
    source_kind: str,
    request_hash: str | None,
    direction: str,
    research_universe: list[str],
    tradable_assets: list[str],
    annualization_periods: int,
    portfolio_policy: dict[str, Any],
    policy_source: str,
    benchmark_policy: dict[str, Any] | None,
    benchmark_source: str,
    asset_position_roles: dict[str, str],
    asset_position_roles_source: str,
) -> dict[str, Any]:
    tradable_set = {
        asset
        for asset in tradable_assets
        if asset_position_roles[asset] != "context-only"
    }
    tradable_assets = [
        asset for asset in research_universe if asset in tradable_set
    ]
    context_assets = [
        asset for asset in research_universe if asset not in tradable_set
    ]
    overrides = portfolio_policy["assetMaxAbsWeights"]
    asset_caps = {
        asset: (
            float(overrides.get(asset, portfolio_policy["maxAbsWeight"]))
            if asset in tradable_set
            else 0.0
        )
        for asset in research_universe
    }
    explicit_roles = asset_position_roles_source == "caller-supplied"
    long_capable = [
        asset
        for asset in tradable_assets
        if asset_position_roles[asset] in {"long-only", "two-sided"}
    ]
    short_capable = [
        asset
        for asset in tradable_assets
        if asset_position_roles[asset] in {"short-only", "two-sided"}
    ]
    explicit_relative_value_pair = (
        explicit_roles
        and direction == "relative-value"
        and len(tradable_assets) == 2
        and all(
            asset_position_roles[asset] == "two-sided"
            for asset in tradable_assets
        )
    )
    if benchmark_policy is None:
        if not explicit_roles:
            benchmark_kind = PORTFOLIO_BENCHMARKS[direction]
        elif direction == "long":
            benchmark_kind = "equal-weight-long-capable"
        elif direction == "short":
            benchmark_kind = "equal-weight-short-capable"
        elif direction in {"long-short", "relative-value"}:
            benchmark_kind = "cash"
        elif long_capable:
            benchmark_kind = "equal-weight-long-capable"
        else:
            benchmark_kind = "equal-weight-short-capable"
        benchmark_asset = None
    elif benchmark_policy["kind"] == "cash":
        benchmark_kind = "cash"
        benchmark_asset = None
    elif benchmark_policy["kind"] == "fixed-weights":
        benchmark_kind = "fixed-weights"
        benchmark_asset = None
    else:
        benchmark_kind = "single-asset-long"
        benchmark_asset = benchmark_policy["symbol"]
    if benchmark_kind == "cash":
        benchmark_weights = {
            asset: 0.0 for asset in research_universe
        }
    elif benchmark_kind == "equal-weight-long-research-universe":
        equal_weight = 1.0 / len(research_universe)
        benchmark_weights = {
            asset: equal_weight for asset in research_universe
        }
    elif benchmark_kind == "equal-weight-long-tradable":
        equal_weight = 1.0 / len(tradable_assets)
        benchmark_weights = {
            asset: (
                equal_weight if asset in tradable_set else 0.0
            )
            for asset in research_universe
        }
    elif benchmark_kind == "equal-weight-short-tradable":
        equal_weight = -1.0 / len(tradable_assets)
        benchmark_weights = {
            asset: (
                equal_weight if asset in tradable_set else 0.0
            )
            for asset in research_universe
        }
    elif benchmark_kind == "equal-weight-long-capable":
        equal_weight = 1.0 / len(long_capable)
        benchmark_weights = {
            asset: equal_weight if asset in long_capable else 0.0
            for asset in research_universe
        }
    elif benchmark_kind == "equal-weight-short-capable":
        equal_weight = -1.0 / len(short_capable)
        benchmark_weights = {
            asset: equal_weight if asset in short_capable else 0.0
            for asset in research_universe
        }
    elif benchmark_kind == "fixed-weights":
        benchmark_weights = {
            asset: float(benchmark_policy["weights"].get(asset, 0.0))
            for asset in research_universe
        }
    elif (
        benchmark_kind == "single-asset-long"
        and benchmark_asset in research_universe
    ):
        benchmark_weights = {
            asset: 1.0 if asset == benchmark_asset else 0.0
            for asset in research_universe
        }
    else:
        raise ValueError("benchmark policy is outside the research universe")
    has_long = any(
        asset_position_roles[asset] in {"long-only", "two-sided"}
        for asset in tradable_assets
    )
    has_short = any(
        asset_position_roles[asset] in {"short-only", "two-sided"}
        for asset in tradable_assets
    )
    if has_long and has_short:
        long_gross_limit = float(portfolio_policy["grossLimit"]) / 2.0
        short_gross_limit = float(portfolio_policy["grossLimit"]) / 2.0
    elif has_long:
        long_gross_limit = float(portfolio_policy["grossLimit"])
        short_gross_limit = 0.0
    elif has_short:
        long_gross_limit = 0.0
        short_gross_limit = float(portfolio_policy["grossLimit"])
    else:
        raise ValueError("portfolio mandate requires a position-capable asset")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": PORTFOLIO_MANDATE_KIND,
        "source": {
            "kind": source_kind,
            "requestHash": request_hash,
            "direction": direction,
            "portfolioPolicy": policy_source,
            "benchmarkPolicy": benchmark_source,
            "assetPositionRoles": asset_position_roles_source,
        },
        "researchUniverse": list(research_universe),
        "tradableAssets": list(tradable_assets),
        "contextAssets": context_assets,
        "construction": {
            "family": (
                "asset-role"
                if explicit_roles and not explicit_relative_value_pair
                else PORTFOLIO_FAMILIES[direction]
            ),
            "grossLimit": portfolio_policy["grossLimit"],
            "longGrossLimit": long_gross_limit,
            "shortGrossLimit": short_gross_limit,
            "netRule": (
                "bounded-by-side-limits"
                if explicit_roles and not explicit_relative_value_pair
                else PORTFOLIO_NET_RULES[direction]
            ),
            "maxAbsWeight": portfolio_policy["maxAbsWeight"],
            "assetMaxAbsWeights": asset_caps,
            "assetPositionRoles": {
                asset: asset_position_roles[asset]
                for asset in research_universe
            },
            "cashAllowed": True,
            "shortAllowed": has_short,
            "benchmark": {
                "source": benchmark_source,
                "kind": benchmark_kind,
                "asset": benchmark_asset,
                "weights": benchmark_weights,
            },
            "riskPolicy": {
                **PORTFOLIO_RISK_POLICY,
                "annualizedVolatilityCeiling": portfolio_policy[
                    "annualizedVolatilityCeiling"
                ],
                "annualizationPeriods": annualization_periods,
            },
        },
        "implementationPolicy": {
            "baseCostBps": portfolio_policy["baseCostBps"],
            "noTradeOneWay": portfolio_policy["noTradeOneWay"],
            "referenceNav": portfolio_policy["referenceNav"],
            "decisionPolicy": {
                "source": policy_source,
                **portfolio_policy["decisionSchedule"],
            },
            "costModel": IMPLEMENTATION_COST_MODEL,
            "capacityModel": IMPLEMENTATION_CAPACITY_MODEL,
        },
        "authority": PORTFOLIO_MANDATE_AUTHORITY,
        "tradingAuthority": "none",
    }


def build_portfolio_mandate(
    request: dict[str, Any] | None,
    research_universe: list[str],
    *,
    annualization_periods: int = 252,
) -> dict[str, Any]:
    """Derive one fixed mandate from a normalized request or template default."""

    if not research_universe or len(research_universe) != len(set(research_universe)):
        raise ValueError("research_universe must contain unique assets")
    if not _valid_annualization_periods(annualization_periods):
        raise ValueError("unsupported annualization_periods")
    if request is None:
        policy = dict(DEFAULT_PORTFOLIO_POLICY)
        payload = _canonical_payload(
            source_kind="template-default",
            request_hash=None,
            direction="research-only",
            research_universe=research_universe,
            tradable_assets=research_universe,
            annualization_periods=annualization_periods,
            portfolio_policy=policy,
            policy_source="reference-default",
            benchmark_policy=None,
            benchmark_source="direction-default",
            asset_position_roles={
                asset: "two-sided" for asset in research_universe
            },
            asset_position_roles_source="direction-derived",
        )
    else:
        direction = request.get("direction")
        if direction not in PORTFOLIO_MANDATE_DIRECTIONS:
            raise ValueError("request has an invalid portfolio direction")
        requested = [item["symbol"] for item in request["assets"]]
        missing = sorted(set(requested) - set(research_universe))
        if missing:
            raise ValueError(
                "requested assets are outside the research universe: "
                + ", ".join(missing)
            )
        explicit_roles = all(
            "positionRole" in item for item in request["assets"]
        )
        requested_roles = {
            item["symbol"]: (
                item["positionRole"]
                if explicit_roles
                else DERIVED_ASSET_POSITION_ROLES[direction]
            )
            for item in request["assets"]
        }
        has_long_role = any(
            role in {"long-only", "two-sided"}
            for role in requested_roles.values()
        )
        has_short_role = any(
            role in {"short-only", "two-sided"}
            for role in requested_roles.values()
        )
        if (
            direction == "long"
            and not has_long_role
            or direction == "short"
            and not has_short_role
            or direction in {"long-short", "relative-value"}
            and not (has_long_role and has_short_role)
        ):
            raise ValueError("request direction conflicts with asset position roles")
        asset_position_roles = {
            asset: (
                "two-sided"
                if direction == "research-only" and not explicit_roles
                else requested_roles.get(asset, "context-only")
            )
            for asset in research_universe
        }
        tradable_assets = [
            asset
            for asset in research_universe
            if asset_position_roles[asset] != "context-only"
        ]
        if not tradable_assets:
            raise ValueError("request has no position-capable assets")
        supplied_policy = request.get("portfolioPolicy")
        policy = (
            dict(DEFAULT_PORTFOLIO_POLICY)
            if supplied_policy is None
            else dict(supplied_policy)
        )
        if not _valid_portfolio_policy(
            policy,
            direction,
            list(requested_roles.values()) if explicit_roles else None,
        ):
            raise ValueError("request has an invalid portfolio policy")
        unknown_caps = sorted(
            set(policy["assetMaxAbsWeights"]) - set(requested)
        )
        if unknown_caps:
            raise ValueError(
                "per-asset caps name unrequested assets: "
                + ", ".join(unknown_caps)
            )
        supplied_benchmark = request.get("benchmarkPolicy")
        if supplied_benchmark is not None:
            valid_cash_or_asset = (
                isinstance(supplied_benchmark, dict)
                and set(supplied_benchmark) == {"kind", "symbol"}
                and supplied_benchmark.get("kind") in {"cash", "asset"}
                and (
                    supplied_benchmark.get("kind") != "cash"
                    or supplied_benchmark.get("symbol") is None
                )
                and (
                    supplied_benchmark.get("kind") != "asset"
                    or (
                        isinstance(supplied_benchmark.get("symbol"), str)
                        and supplied_benchmark["symbol"] in research_universe
                    )
                )
            )
            supplied_weights = (
                supplied_benchmark.get("weights")
                if isinstance(supplied_benchmark, dict)
                else None
            )
            valid_fixed_weights = (
                isinstance(supplied_benchmark, dict)
                and set(supplied_benchmark) == {"kind", "weights"}
                and supplied_benchmark.get("kind") == "fixed-weights"
                and isinstance(supplied_weights, dict)
                and bool(supplied_weights)
                and set(supplied_weights) <= set(requested)
                and all(
                    isinstance(weight, (int, float))
                    and not isinstance(weight, bool)
                    and math.isfinite(float(weight))
                    and 0.0 < float(weight) <= 1.0
                    for weight in supplied_weights.values()
                )
                and math.isclose(
                    sum(float(weight) for weight in supplied_weights.values()),
                    1.0,
                    rel_tol=0.0,
                    abs_tol=1e-9,
                )
            )
            if not (valid_cash_or_asset or valid_fixed_weights):
                raise ValueError("request has an invalid benchmark policy")
        payload = _canonical_payload(
            source_kind="research-request",
            request_hash=hash_json(request),
            direction=direction,
            research_universe=research_universe,
            tradable_assets=(
                research_universe
                if direction == "research-only" and not explicit_roles
                else tradable_assets
            ),
            annualization_periods=annualization_periods,
            portfolio_policy=policy,
            policy_source=(
                "reference-default"
                if supplied_policy is None
                else "caller-supplied"
            ),
            benchmark_policy=supplied_benchmark,
            benchmark_source=(
                "direction-default"
                if supplied_benchmark is None
                else "caller-supplied"
            ),
            asset_position_roles=asset_position_roles,
            asset_position_roles_source=(
                "caller-supplied"
                if explicit_roles
                else "direction-derived"
            ),
        )
    return {
        **payload,
        "id": f"mandate-{hash_json(payload)[:16]}",
    }


def validate_portfolio_mandate(
    value: dict[str, Any],
    path: Path | str = PORTFOLIO_MANDATE,
) -> dict[str, Any]:
    """Validate one mandate and return its canonical representation."""

    required = {
        "schemaVersion",
        "kind",
        "id",
        "source",
        "researchUniverse",
        "tradableAssets",
        "contextAssets",
        "construction",
        "implementationPolicy",
        "authority",
        "tradingAuthority",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(_issue(f"{path}/schemaVersion", "schema.version", "Expected V1"))
    if value.get("kind") != PORTFOLIO_MANDATE_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "mandate.kind",
                f"Expected {PORTFOLIO_MANDATE_KIND}",
            )
        )
    if value.get("authority") != PORTFOLIO_MANDATE_AUTHORITY:
        issues.append(
            _issue(f"{path}/authority", "mandate.authority", "Invalid authority")
        )
    if value.get("tradingAuthority") != "none":
        issues.append(
            _issue(
                f"{path}/tradingAuthority",
                "mandate.trading-authority",
                "Portfolio Mandate cannot grant trading authority",
            )
        )

    source = value.get("source")
    direction: Any = None
    source_kind: Any = None
    request_hash: Any = None
    policy_source: Any = None
    benchmark_source: Any = None
    asset_position_roles_source: Any = None
    if not isinstance(source, dict):
        issues.append(_issue(f"{path}/source", "schema.type", "Source must be an object"))
    else:
        issues.extend(
            _strict_keys(
                source,
                {
                    "kind",
                    "requestHash",
                    "direction",
                    "portfolioPolicy",
                    "benchmarkPolicy",
                    "assetPositionRoles",
                },
                f"{path}/source",
            )
        )
        source_kind = source.get("kind")
        request_hash = source.get("requestHash")
        direction = source.get("direction")
        policy_source = source.get("portfolioPolicy")
        benchmark_source = source.get("benchmarkPolicy")
        asset_position_roles_source = source.get("assetPositionRoles")
        if source_kind not in {"research-request", "template-default"}:
            issues.append(
                _issue(
                    f"{path}/source/kind",
                    "mandate.source-kind",
                    "Invalid mandate source kind",
                )
            )
        if direction not in PORTFOLIO_MANDATE_DIRECTIONS:
            issues.append(
                _issue(
                    f"{path}/source/direction",
                    "mandate.direction",
                    "Invalid mandate direction",
                )
            )
        if policy_source not in {"caller-supplied", "reference-default"}:
            issues.append(
                _issue(
                    f"{path}/source/portfolioPolicy",
                    "mandate.policy-source",
                    "Invalid Portfolio policy source",
                )
            )
        if benchmark_source not in {
            "caller-supplied",
            "direction-default",
        }:
            issues.append(
                _issue(
                    f"{path}/source/benchmarkPolicy",
                    "mandate.benchmark-source",
                    "Invalid benchmark policy source",
                )
            )
        if asset_position_roles_source not in {
            "caller-supplied",
            "direction-derived",
        }:
            issues.append(
                _issue(
                    f"{path}/source/assetPositionRoles",
                    "mandate.asset-position-roles-source",
                    "Invalid asset position roles source",
                )
            )
        if source_kind == "research-request" and not _valid_hash(request_hash):
            issues.append(
                _issue(
                    f"{path}/source/requestHash",
                    "mandate.request-hash",
                    "Request-derived mandate requires a SHA-256 request hash",
                )
            )
        if source_kind == "template-default" and (
            request_hash is not None
            or direction != "research-only"
            or policy_source != "reference-default"
            or benchmark_source != "direction-default"
            or asset_position_roles_source != "direction-derived"
        ):
            issues.append(
                _issue(
                    f"{path}/source",
                    "mandate.template-default",
                    "Template default must be request-free research-only",
                )
            )

    research, research_issues = _symbol_list(
        value.get("researchUniverse"),
        f"{path}/researchUniverse",
        allow_empty=False,
    )
    tradable, tradable_issues = _symbol_list(
        value.get("tradableAssets"),
        f"{path}/tradableAssets",
        allow_empty=False,
    )
    context, context_issues = _symbol_list(
        value.get("contextAssets"),
        f"{path}/contextAssets",
        allow_empty=True,
    )
    issues.extend(research_issues)
    issues.extend(tradable_issues)
    issues.extend(context_issues)
    if not set(tradable).issubset(research):
        issues.append(
            _issue(
                f"{path}/tradableAssets",
                "mandate.tradable-universe",
                "Tradable assets must be a subset of the research universe",
            )
        )
    expected_context = [asset for asset in research if asset not in set(tradable)]
    if context != expected_context:
        issues.append(
            _issue(
                f"{path}/contextAssets",
                "mandate.context-assets",
                "Context assets must exactly complement tradable assets",
            )
        )

    construction = value.get("construction")
    implementation = value.get("implementationPolicy")
    normalized_policy: dict[str, Any] | None = None
    if not isinstance(implementation, dict):
        issues.append(
            _issue(
                f"{path}/implementationPolicy",
                "schema.type",
                "Implementation policy must be an object",
            )
        )
    else:
        issues.extend(
            _strict_keys(
                implementation,
                {
                    "baseCostBps",
                    "noTradeOneWay",
                    "referenceNav",
                    "decisionPolicy",
                    "costModel",
                    "capacityModel",
                },
                f"{path}/implementationPolicy",
            )
        )
    if not isinstance(construction, dict):
        issues.append(
            _issue(
                f"{path}/construction",
                "schema.type",
                "Construction must be an object",
            )
        )
    else:
        issues.extend(
            _strict_keys(
                construction,
                {
                    "family",
                    "grossLimit",
                    "longGrossLimit",
                    "shortGrossLimit",
                    "netRule",
                    "maxAbsWeight",
                    "assetMaxAbsWeights",
                    "assetPositionRoles",
                    "cashAllowed",
                    "shortAllowed",
                    "benchmark",
                    "riskPolicy",
                },
                f"{path}/construction",
            )
        )
        if direction in PORTFOLIO_MANDATE_DIRECTIONS:
            risk_policy = construction.get("riskPolicy")
            complete_roles = construction.get("assetPositionRoles")
            valid_complete_roles = (
                isinstance(complete_roles, dict)
                and set(complete_roles) == set(research)
                and all(
                    complete_roles[asset] in ASSET_POSITION_ROLES
                    for asset in research
                )
                and all(
                    (
                        complete_roles[asset] != "context-only"
                        if asset in tradable
                        else complete_roles[asset] == "context-only"
                    )
                    for asset in research
                )
            )
            if not valid_complete_roles:
                issues.append(
                    _issue(
                        f"{path}/construction/assetPositionRoles",
                        "mandate.asset-position-roles",
                        "Position roles must exactly classify tradable and "
                        "context assets",
                    )
                )
            benchmark = construction.get("benchmark")
            normalized_benchmark_policy: dict[str, Any] | None = None
            if not isinstance(benchmark, dict):
                issues.append(
                    _issue(
                        f"{path}/construction/benchmark",
                        "mandate.benchmark",
                        "Benchmark must be a structured object",
                    )
                )
            else:
                issues.extend(
                    _strict_keys(
                        benchmark,
                        {"source", "kind", "asset", "weights"},
                        f"{path}/construction/benchmark",
                    )
                )
                benchmark_kind = benchmark.get("kind")
                benchmark_asset = benchmark.get("asset")
                benchmark_weights = benchmark.get("weights")
                if (
                    benchmark.get("source") != benchmark_source
                    or benchmark_kind not in BENCHMARK_KINDS
                    or not isinstance(benchmark_weights, dict)
                    or set(benchmark_weights) != set(research)
                    or any(
                        not isinstance(item, (int, float))
                        or isinstance(item, bool)
                        or not math.isfinite(float(item))
                        for item in benchmark_weights.values()
                    )
                ):
                    issues.append(
                        _issue(
                            f"{path}/construction/benchmark",
                            "mandate.benchmark-contract",
                            "Benchmark source, kind, or complete weights are invalid",
                        )
                    )
                elif benchmark_source == "caller-supplied":
                    if (
                        benchmark_kind == "cash"
                        and benchmark_asset is None
                        and all(
                            abs(float(item)) <= 1e-12
                            for item in benchmark_weights.values()
                        )
                    ):
                        normalized_benchmark_policy = {
                            "kind": "cash",
                            "symbol": None,
                        }
                    elif (
                        benchmark_kind == "single-asset-long"
                        and isinstance(benchmark_asset, str)
                        and benchmark_asset in research
                        and all(
                            math.isclose(
                                float(benchmark_weights[asset]),
                                1.0 if asset == benchmark_asset else 0.0,
                                rel_tol=0.0,
                                abs_tol=1e-12,
                            )
                            for asset in research
                        )
                    ):
                        normalized_benchmark_policy = {
                            "kind": "asset",
                            "symbol": benchmark_asset,
                        }
                    elif (
                        benchmark_kind == "fixed-weights"
                        and benchmark_asset is None
                        and all(
                            0.0 <= float(weight) <= 1.0
                            for weight in benchmark_weights.values()
                        )
                        and any(
                            float(weight) > 0.0
                            for weight in benchmark_weights.values()
                        )
                        and math.isclose(
                            sum(
                                float(weight)
                                for weight in benchmark_weights.values()
                            ),
                            1.0,
                            rel_tol=0.0,
                            abs_tol=1e-9,
                        )
                    ):
                        normalized_benchmark_policy = {
                            "kind": "fixed-weights",
                            "weights": {
                                asset: float(benchmark_weights[asset])
                                for asset in research
                                if float(benchmark_weights[asset]) > 0.0
                            },
                        }
                    else:
                        issues.append(
                            _issue(
                                f"{path}/construction/benchmark",
                                "mandate.caller-benchmark",
                                "Caller benchmark must be cash, one unlevered "
                                "long asset, or a funded fixed-weight reference",
                            )
                        )
            annualization_periods = (
                risk_policy.get("annualizationPeriods")
                if isinstance(risk_policy, dict)
                else None
            )
            if not _valid_annualization_periods(annualization_periods):
                issues.append(
                    _issue(
                        f"{path}/construction/riskPolicy/annualizationPeriods",
                        "mandate.annualization",
                        "Annualization periods must match a supported market clock",
                    )
                )
                annualization_periods = 252
            if isinstance(implementation, dict):
                normalized_policy = {
                    "grossLimit": construction.get("grossLimit"),
                    "maxAbsWeight": construction.get("maxAbsWeight"),
                    "assetMaxAbsWeights": {},
                    "annualizedVolatilityCeiling": (
                        risk_policy.get("annualizedVolatilityCeiling")
                        if isinstance(risk_policy, dict)
                        else None
                    ),
                    "baseCostBps": implementation.get("baseCostBps"),
                    "noTradeOneWay": implementation.get("noTradeOneWay"),
                    "referenceNav": implementation.get("referenceNav"),
                    "decisionSchedule": (
                        {
                            key: item
                            for key, item in implementation.get(
                                "decisionPolicy",
                                {},
                            ).items()
                            if key != "source"
                        }
                        if isinstance(
                            implementation.get("decisionPolicy"),
                            dict,
                        )
                        else None
                    ),
                }
                complete_caps = construction.get(
                    "assetMaxAbsWeights"
                )
                if (
                    isinstance(complete_caps, dict)
                    and set(complete_caps) == set(research)
                ):
                    normalized_policy["assetMaxAbsWeights"] = {
                        asset: complete_caps[asset]
                        for asset in tradable
                        if complete_caps[asset]
                        != construction.get("maxAbsWeight")
                    }
                if not _valid_portfolio_policy(
                    normalized_policy,
                    direction,
                    (
                        [complete_roles[asset] for asset in tradable]
                        if asset_position_roles_source == "caller-supplied"
                        and valid_complete_roles
                        else None
                    ),
                ):
                    issues.append(
                        _issue(
                            path,
                            "mandate.portfolio-policy",
                            "Portfolio policy contains unsupported values",
                        )
                    )
            expected = _canonical_payload(
                source_kind=(
                    source_kind
                    if source_kind in {"research-request", "template-default"}
                    else "research-request"
                ),
                request_hash=(
                    request_hash
                    if isinstance(request_hash, str)
                    else None
                ),
                direction=direction,
                research_universe=research,
                tradable_assets=tradable,
                annualization_periods=annualization_periods,
                portfolio_policy=(
                    normalized_policy
                    if normalized_policy is not None
                    else DEFAULT_PORTFOLIO_POLICY
                ),
                policy_source=(
                    policy_source
                    if policy_source
                    in {"caller-supplied", "reference-default"}
                    else "reference-default"
                ),
                benchmark_policy=(
                    normalized_benchmark_policy
                    if benchmark_source == "caller-supplied"
                    and normalized_benchmark_policy is not None
                    else None
                ),
                benchmark_source=(
                    benchmark_source
                    if benchmark_source
                    in {"caller-supplied", "direction-default"}
                    else "direction-default"
                ),
                asset_position_roles=(
                    {
                        asset: complete_roles[asset]
                        for asset in research
                    }
                    if valid_complete_roles
                    else {
                        asset: (
                            DERIVED_ASSET_POSITION_ROLES[direction]
                            if asset in tradable
                            else "context-only"
                        )
                        for asset in research
                    }
                ),
                asset_position_roles_source=(
                    asset_position_roles_source
                    if asset_position_roles_source
                    in {"caller-supplied", "direction-derived"}
                    else "direction-derived"
                ),
            )
            if (
                construction != expected["construction"]
                or implementation != expected["implementationPolicy"]
            ):
                issues.append(
                    _issue(
                        path,
                        "mandate.construction",
                        "Portfolio policy differs from the fixed request contract",
                    )
                )
        if (
            direction == "research-only"
            and asset_position_roles_source == "direction-derived"
            and tradable != research
        ):
            issues.append(
                _issue(
                    f"{path}/tradableAssets",
                    "mandate.research-universe",
                    "Research-only mandate must use the complete research universe",
                )
            )

    payload = {
        key: value.get(key)
        for key in (
            "schemaVersion",
            "kind",
            "source",
            "researchUniverse",
            "tradableAssets",
            "contextAssets",
            "construction",
            "implementationPolicy",
            "authority",
            "tradingAuthority",
        )
    }
    expected_id = f"mandate-{hash_json(payload)[:16]}"
    if value.get("id") != expected_id:
        issues.append(
            _issue(
                f"{path}/id",
                "mandate.derived-id",
                "Mandate id is not derived from its complete content",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {**payload, "id": expected_id}


def load_portfolio_mandate(path: str | Path) -> dict[str, Any]:
    mandate_path = Path(path).expanduser().absolute()
    try:
        value = json.loads(mandate_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [
                _issue(
                    mandate_path,
                    "mandate.missing",
                    f"Missing Portfolio Mandate: {mandate_path}",
                )
            ]
        ) from None
    except json.JSONDecodeError as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    mandate_path,
                    "mandate.json",
                    f"Invalid JSON at line {error.lineno}, column "
                    f"{error.colno}: {error.msg}",
                )
            ]
        ) from None
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(mandate_path, "mandate.type", "Mandate must be an object")]
        )
    return validate_portfolio_mandate(value, mandate_path)


PORTFOLIO_MANDATE_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant request-bound Portfolio Mandate",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "source",
        "researchUniverse",
        "tradableAssets",
        "contextAssets",
        "construction",
        "implementationPolicy",
        "authority",
        "tradingAuthority",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": PORTFOLIO_MANDATE_KIND},
        "id": {"type": "string", "pattern": "^mandate-[0-9a-f]{16}$"},
        "source": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "requestHash",
                "direction",
                "portfolioPolicy",
                "benchmarkPolicy",
                "assetPositionRoles",
            ],
            "properties": {
                "kind": {"enum": ["research-request", "template-default"]},
                "requestHash": {
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "pattern": SHA256},
                    ]
                },
                "direction": {"enum": sorted(PORTFOLIO_MANDATE_DIRECTIONS)},
                "portfolioPolicy": {
                    "enum": ["caller-supplied", "reference-default"]
                },
                "benchmarkPolicy": {
                    "enum": ["caller-supplied", "direction-default"]
                },
                "assetPositionRoles": {
                    "enum": ["caller-supplied", "direction-derived"]
                },
            },
        },
        "researchUniverse": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": True,
            "items": {"type": "string", "minLength": 1},
        },
        "tradableAssets": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": True,
            "items": {"type": "string", "minLength": 1},
        },
        "contextAssets": {
            "type": "array",
            "uniqueItems": True,
            "items": {"type": "string", "minLength": 1},
        },
        "construction": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "family",
                "grossLimit",
                "longGrossLimit",
                "shortGrossLimit",
                "netRule",
                "maxAbsWeight",
                "assetMaxAbsWeights",
                "assetPositionRoles",
                "cashAllowed",
                "shortAllowed",
                "benchmark",
                "riskPolicy",
            ],
            "properties": {
                "family": {
                    "enum": [
                        "long-cash",
                        "short-cash",
                        "dollar-neutral",
                        "asset-role",
                    ]
                },
                "grossLimit": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 2,
                },
                "longGrossLimit": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2,
                },
                "shortGrossLimit": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2,
                },
                "netRule": {
                    "enum": [
                        "long-only",
                        "short-only",
                        "zero",
                        "bounded-by-side-limits",
                    ]
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
                        "minimum": 0,
                        "maximum": 2,
                    },
                },
                "assetPositionRoles": {
                    "type": "object",
                    "maxProperties": 256,
                    "additionalProperties": {
                        "enum": sorted(ASSET_POSITION_ROLES),
                    },
                },
                "cashAllowed": {"const": True},
                "shortAllowed": {"type": "boolean"},
                "benchmark": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "source",
                        "kind",
                        "asset",
                        "weights",
                    ],
                    "properties": {
                        "source": {
                            "enum": [
                                "caller-supplied",
                                "direction-default",
                            ]
                        },
                        "kind": {"enum": sorted(BENCHMARK_KINDS)},
                        "asset": {
                            "anyOf": [
                                {"type": "null"},
                                {"type": "string", "minLength": 1},
                            ]
                        },
                        "weights": {
                            "type": "object",
                            "maxProperties": 256,
                            "additionalProperties": {
                                "type": "number",
                                "minimum": -1,
                                "maximum": 1,
                            },
                        },
                    },
                },
                "riskPolicy": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "method",
                        "annualizedVolatilityCeiling",
                        "covarianceWindow",
                        "minimumObservations",
                        "annualizationPeriods",
                        "scaleUp",
                    ],
                    "properties": {
                        "method": {
                            "const": "trailing-covariance-volatility-ceiling-v1"
                        },
                        "annualizedVolatilityCeiling": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                            "maximum": 1,
                        },
                        "covarianceWindow": {"const": 60},
                        "minimumObservations": {"const": 20},
                        "annualizationPeriods": {
                            "type": "integer",
                            "minimum": MIN_ANNUALIZATION_PERIODS,
                            "maximum": MAX_ANNUALIZATION_PERIODS,
                        },
                        "scaleUp": {"const": False},
                    },
                },
            },
        },
        "implementationPolicy": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "baseCostBps",
                "noTradeOneWay",
                "referenceNav",
                "decisionPolicy",
                "costModel",
                "capacityModel",
            ],
            "properties": {
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
                "decisionPolicy": {
                    "oneOf": [
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "source",
                                "kind",
                                "bars",
                                "anchor",
                            ],
                            "properties": {
                                "source": {
                                    "enum": [
                                        "caller-supplied",
                                        "reference-default",
                                    ]
                                },
                                "kind": {"const": "every-bars"},
                                "bars": {
                                    "type": "integer",
                                    "minimum": 1,
                                    "maximum": 252,
                                },
                                "anchor": {
                                    "enum": [
                                        "dataset-start",
                                        "session-start",
                                    ]
                                },
                            },
                        },
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["source", "kind"],
                            "properties": {
                                "source": {
                                    "enum": [
                                        "caller-supplied",
                                        "reference-default",
                                    ]
                                },
                                "kind": {
                                    "const": "calendar-month-end",
                                },
                            },
                        },
                    ],
                },
                "costModel": {"const": IMPLEMENTATION_COST_MODEL},
                "capacityModel": {
                    "const": IMPLEMENTATION_CAPACITY_MODEL
                },
            },
        },
        "authority": {"const": PORTFOLIO_MANDATE_AUTHORITY},
        "tradingAuthority": {"const": "none"},
    },
}
