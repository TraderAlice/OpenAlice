"""Deterministic causal equal-risk-contribution construction primitives."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd


class AllocationFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class AllocationSolution:
    weights: pd.Series
    risk_contribution_shares: pd.Series
    maximum_contribution_error: float
    converged: bool
    iterations: int
    cap_binding_assets: tuple[str, ...]


def risk_contribution_shares(
    weights: pd.Series,
    covariance: pd.DataFrame,
) -> pd.Series:
    """Return signed component-variance shares for one aligned book."""

    aligned = covariance.reindex(index=weights.index, columns=weights.index)
    vector = weights.to_numpy(dtype=float)
    matrix = aligned.to_numpy(dtype=float)
    marginal = matrix @ vector
    component = vector * marginal
    variance = float(component.sum())
    if (
        not np.isfinite(matrix).all()
        or not math.isfinite(variance)
        or variance <= 1e-18
    ):
        return pd.Series(0.0, index=weights.index, dtype=float)
    return pd.Series(component / variance, index=weights.index, dtype=float)


def _cap_and_redistribute(
    weights: pd.Series,
    caps: pd.Series,
) -> pd.Series:
    """Project a positive funded book onto upper bounds by proportional refill."""

    if float(caps.sum()) < 1.0 - 1e-12:
        raise AllocationFailure(
            "allocation.infeasible-caps",
            "Long-only caps cannot fund a unit-gross allocation",
        )
    output = pd.Series(0.0, index=weights.index, dtype=float)
    remaining = list(weights.index)
    remaining_budget = 1.0
    while remaining:
        strengths = weights.loc[remaining].clip(lower=0.0)
        total = float(strengths.sum())
        if total <= 1e-18:
            strengths[:] = 1.0
            total = float(len(strengths))
        proposed = strengths / total * remaining_budget
        binding = [
            asset
            for asset in remaining
            if float(proposed.loc[asset]) > float(caps.loc[asset]) + 1e-14
        ]
        if not binding:
            output.loc[remaining] = proposed
            break
        for asset in binding:
            output.loc[asset] = float(caps.loc[asset])
            remaining_budget -= float(caps.loc[asset])
            remaining.remove(asset)
        if remaining_budget < -1e-12:
            raise AllocationFailure(
                "allocation.cap-projection",
                "Cap projection exceeded the funded budget",
            )
    if not math.isclose(float(output.sum()), 1.0, rel_tol=0.0, abs_tol=1e-10):
        raise AllocationFailure(
            "allocation.cap-projection",
            "Cap projection did not produce a funded book",
        )
    return output


def solve_equal_risk_contribution(
    covariance: pd.DataFrame,
    caps: pd.Series,
    *,
    tolerance: float,
    maximum_iterations: int = 10_000,
) -> AllocationSolution:
    """Solve the positive risk-budgeting system, then enforce caller caps.

    Cyclical coordinate descent solves the standard convex risk-budgeting
    objective. Upper bounds are a separate deterministic projection. If that
    projection changes risk shares beyond the caller tolerance, the result is
    explicitly returned as non-converged rather than mislabeled exact parity.
    """

    assets = list(covariance.index)
    if (
        not assets
        or list(covariance.columns) != assets
        or not caps.index.equals(covariance.index)
        or not np.isfinite(covariance.to_numpy(dtype=float)).all()
        or not np.isfinite(caps.to_numpy(dtype=float)).all()
        or (caps <= 0).any()
    ):
        raise AllocationFailure(
            "allocation.inputs",
            "Covariance and caps must be finite, positive, and aligned",
        )
    matrix = covariance.to_numpy(dtype=float)
    matrix = (matrix + matrix.T) / 2.0
    diagonal = np.diag(matrix)
    if (diagonal <= 1e-18).any():
        raise AllocationFailure(
            "allocation.covariance",
            "Every tradable asset needs positive estimated variance",
        )
    eigen_minimum = float(np.linalg.eigvalsh(matrix).min())
    if eigen_minimum < 1e-12:
        matrix = matrix + np.eye(len(assets)) * (1e-12 - eigen_minimum)
    budget = np.full(len(assets), 1.0 / len(assets), dtype=float)
    x = 1.0 / np.sqrt(np.diag(matrix))
    x /= x.sum()
    iterations = 0
    for iterations in range(1, maximum_iterations + 1):
        previous = x.copy()
        sigma_x = matrix @ x
        for index in range(len(x)):
            without = float(sigma_x[index] - matrix[index, index] * x[index])
            discriminant = without * without + 4.0 * matrix[index, index] * budget[index]
            updated = (
                -without + math.sqrt(max(discriminant, 0.0))
            ) / (2.0 * matrix[index, index])
            delta = updated - x[index]
            x[index] = updated
            sigma_x += matrix[:, index] * delta
        if float(np.max(np.abs(x - previous))) <= 1e-13:
            break
    unconstrained = pd.Series(x / x.sum(), index=assets, dtype=float)
    capped = _cap_and_redistribute(unconstrained, caps.astype(float))
    covariance_frame = pd.DataFrame(matrix, index=assets, columns=assets)
    shares = risk_contribution_shares(capped, covariance_frame)
    target = 1.0 / len(assets)
    error = float((shares - target).abs().max())
    binding = tuple(
        asset
        for asset in assets
        if math.isclose(
            float(capped.loc[asset]),
            float(caps.loc[asset]),
            rel_tol=0.0,
            abs_tol=1e-10,
        )
    )
    return AllocationSolution(
        weights=capped,
        risk_contribution_shares=shares,
        maximum_contribution_error=error,
        converged=bool(error <= tolerance),
        iterations=iterations,
        cap_binding_assets=binding,
    )


def runtime_mandate(
    contract: dict[str, Any],
    *,
    reference: bool,
) -> dict[str, Any]:
    """Translate the fixed allocation contract into Portfolio Core authority."""

    universe = list(contract["universe"])
    tradable = list(contract["tradableAssets"])
    portfolio = contract["portfolioPolicy"]
    benchmark_weights = contract["benchmark"]["weights"]
    if reference:
        funded = set(benchmark_weights)
        roles = {
            asset: "long-only" if asset in funded else "context-only"
            for asset in universe
        }
        tradable = [asset for asset in universe if asset in funded]
        context = [asset for asset in universe if asset not in funded]
        gross_limit = 1.0
        max_weight = 1.0
        caps = {
            asset: (
                1.0 if asset in funded else 0.0
            )
            for asset in universe
        }
        volatility_ceiling = 1.0
        source_suffix = "fixed-weight-reference"
    else:
        roles = dict(contract["assetPositionRoles"])
        context = list(contract["contextAssets"])
        gross_limit = float(portfolio["grossLimit"])
        max_weight = float(portfolio["maxAbsWeight"])
        overrides = portfolio["assetMaxAbsWeights"]
        caps = {
            asset: (
                float(overrides.get(asset, max_weight))
                if asset in tradable
                else 0.0
            )
            for asset in universe
        }
        volatility_ceiling = float(portfolio["annualizedVolatilityCeiling"])
        source_suffix = "erc-candidate"
    return {
        "schemaVersion": 1,
        "kind": "autoquant-portfolio-mandate",
        "id": f"{contract['id']}-{source_suffix}",
        "source": {
            "kind": "allocation-contract",
            "requestHash": contract["source"]["requestHash"],
            "direction": "long",
            "portfolioPolicy": "caller-supplied",
            "benchmarkPolicy": "direction-default",
            "assetPositionRoles": "caller-supplied",
        },
        "researchUniverse": universe,
        "tradableAssets": tradable,
        "contextAssets": context,
        "construction": {
            "family": "asset-role",
            "grossLimit": gross_limit,
            "longGrossLimit": gross_limit,
            "shortGrossLimit": 0.0,
            "netRule": "bounded-by-side-limits",
            "maxAbsWeight": max_weight,
            "assetMaxAbsWeights": caps,
            "assetPositionRoles": roles,
            "cashAllowed": True,
            "shortAllowed": False,
            "benchmark": {
                "source": "direction-default",
                "kind": "cash",
                "asset": None,
                "weights": {asset: 0.0 for asset in universe},
            },
            "riskPolicy": {
                "method": "trailing-covariance-volatility-ceiling-v1",
                "annualizedVolatilityCeiling": volatility_ceiling,
                "covarianceWindow": (
                    2 if reference else int(contract["method"]["covarianceWindow"])
                ),
                "minimumObservations": (
                    2 if reference else int(contract["method"]["minimumObservations"])
                ),
                "annualizationPeriods": int(contract["annualizationPeriods"]),
                "scaleUp": False,
            },
        },
        "implementationPolicy": {
            "baseCostBps": float(portfolio["baseCostBps"]),
            "noTradeOneWay": float(portfolio["noTradeOneWay"]),
            "referenceNav": float(portfolio["referenceNav"]),
            "decisionPolicy": {
                "source": "caller-supplied",
                **portfolio["decisionSchedule"],
            },
            "costModel": "linear-traded-notional-v1",
            "capacityModel": "trailing-dollar-volume-participation-v1",
        },
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
    }


def construct_erc_targets(
    closes: pd.DataFrame,
    contract: dict[str, Any],
    decision_mask: pd.Series,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Construct only scheduled causal ERC targets and an exact solver ledger."""

    universe = list(contract["universe"])
    tradable = list(contract["tradableAssets"])
    method = contract["method"]
    portfolio = contract["portfolioPolicy"]
    targets = pd.DataFrame(0.0, index=closes.index, columns=universe)
    returns = closes[tradable].pct_change(fill_method=None)
    caps = pd.Series(
        {
            asset: float(
                portfolio["assetMaxAbsWeights"].get(
                    asset,
                    portfolio["maxAbsWeight"],
                )
            )
            for asset in tradable
        },
        dtype=float,
    )
    records: list[dict[str, Any]] = []
    for timestamp in closes.index[decision_mask.astype(bool)]:
        history = (
            returns.loc[:timestamp]
            .tail(int(method["covarianceWindow"]))
            .dropna(how="any")
        )
        if len(history) < int(method["minimumObservations"]):
            records.append(
                {
                    "timestamp": timestamp,
                    "status": "insufficient-history",
                    "observations": int(len(history)),
                    "iterations": 0,
                    "converged": False,
                    "maximum_contribution_error": 0.0,
                    "cap_binding_assets": "",
                }
            )
            continue
        covariance = history.cov(ddof=0).reindex(
            index=tradable,
            columns=tradable,
        )
        solution = solve_equal_risk_contribution(
            covariance,
            caps,
            tolerance=float(method["contributionTolerance"]),
        )
        targets.loc[timestamp, tradable] = solution.weights
        records.append(
            {
                "timestamp": timestamp,
                "status": (
                    "within-tolerance"
                    if solution.converged
                    else "cap-induced-parity-gap"
                ),
                "observations": int(len(history)),
                "iterations": int(solution.iterations),
                "converged": bool(solution.converged),
                "maximum_contribution_error": float(
                    solution.maximum_contribution_error
                ),
                "cap_binding_assets": ",".join(solution.cap_binding_assets),
            }
        )
    ledger = pd.DataFrame(records)
    return targets, ledger


def fixed_reference_targets(
    index: pd.Index,
    universe: list[str],
    benchmark: dict[str, Any],
    decision_mask: pd.Series,
) -> pd.DataFrame:
    targets = pd.DataFrame(0.0, index=index, columns=universe)
    for timestamp in index[decision_mask.astype(bool)]:
        for asset, weight in benchmark["weights"].items():
            targets.loc[timestamp, asset] = float(weight)
    return targets
