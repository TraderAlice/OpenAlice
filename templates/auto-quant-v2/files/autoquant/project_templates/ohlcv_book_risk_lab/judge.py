"""Fixed covariance audit for one reported book and supplied scenarios."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np
import pandas as pd

from autoquant.intervals import (
    IntervalContractError,
    annualization_periods,
    load_multi_interval_asset,
    timestamp_label,
)


REQUIRED_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")
REPORT_KIND = "autoquant-book-risk-report"
SCENARIO_KIND = "autoquant-book-risk-scenarios"


class JudgeFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _canonical_hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
    ).hexdigest()


def _write_output(value: dict[str, Any]) -> None:
    Path(os.environ["AUTOQUANT_RUN_OUTPUT"]).write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _read_object(path: Path, code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise JudgeFailure(code, f"Cannot read fixed JSON object {path}: {error}") from error
    if not isinstance(value, dict):
        raise JudgeFailure(code, f"Fixed JSON input must be an object: {path}")
    return value


def _fixed_input_path(project_root: Path, value: str, code: str) -> Path:
    relative = PurePosixPath(value)
    if (
        "\\" in value
        or relative.is_absolute()
        or value in {"", ".", ".."}
        or ".." in relative.parts
    ):
        raise JudgeFailure(code, "Fixed input must be a confined Project-relative path")
    path = (project_root / Path(*relative.parts)).resolve()
    try:
        path.relative_to(project_root)
    except ValueError:
        raise JudgeFailure(code, "Fixed input escapes the execution Project") from None
    return path


def _fixed_dataset_root(data_root: Path, value: str) -> Path:
    relative = PurePosixPath(value)
    if (
        "\\" in value
        or relative.is_absolute()
        or value in {"", ".."}
        or ".." in relative.parts
    ):
        raise JudgeFailure(
            "book-risk.dataset-root",
            "Fixed dataset root must be confined under Project data",
        )
    path = (
        data_root
        if value == "."
        else (data_root / Path(*relative.parts)).resolve()
    )
    try:
        path.relative_to(data_root)
    except ValueError:
        raise JudgeFailure(
            "book-risk.dataset-root",
            "Fixed dataset root escapes Project data",
        ) from None
    return path


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False, exit_on_error=False)
    parser.add_argument(
        "--position-snapshot",
        default="strategies/position-snapshot.json",
    )
    parser.add_argument(
        "--scenarios",
        default="strategies/book-risk-scenarios.json",
    )
    parser.add_argument(
        "--dataset-root",
        default=".",
    )
    try:
        arguments, unknown = parser.parse_known_args()
    except argparse.ArgumentError as error:
        raise JudgeFailure("book-risk.arguments", str(error)) from error
    if unknown:
        raise JudgeFailure(
            "book-risk.arguments",
            "Unsupported fixed Judge arguments: " + ", ".join(unknown),
        )
    return arguments


def _load_scenarios(path: Path) -> dict[str, Any]:
    value = _read_object(path, "book-risk.scenarios")
    if set(value) != {
        "schemaVersion",
        "kind",
        "lookbackBars",
        "primaryLookbackBars",
        "minimumObservations",
        "reductionWeight",
        "rollingStepBars",
    }:
        raise JudgeFailure(
            "book-risk.scenarios",
            "Book-risk scenario fields differ from the fixed contract",
        )
    lookbacks = value.get("lookbackBars")
    if (
        value.get("schemaVersion") != 1
        or value.get("kind") != SCENARIO_KIND
        or not isinstance(lookbacks, list)
        or not 1 <= len(lookbacks) <= 8
        or not all(
            isinstance(item, int)
            and not isinstance(item, bool)
            and 20 <= item <= 2520
            for item in lookbacks
        )
        or len(lookbacks) != len(set(lookbacks))
        or lookbacks != sorted(lookbacks)
        or value.get("primaryLookbackBars") not in lookbacks
        or not isinstance(value.get("minimumObservations"), int)
        or isinstance(value.get("minimumObservations"), bool)
        or not 20 <= value["minimumObservations"] <= max(lookbacks)
        or not isinstance(value.get("rollingStepBars"), int)
        or isinstance(value.get("rollingStepBars"), bool)
        or not 1 <= value["rollingStepBars"] <= 252
        or not isinstance(value.get("reductionWeight"), (int, float))
        or isinstance(value.get("reductionWeight"), bool)
        or not math.isfinite(float(value["reductionWeight"]))
        or not 0 < float(value["reductionWeight"]) <= 0.25
    ):
        raise JudgeFailure(
            "book-risk.scenarios",
            "Book-risk scenario values are outside the fixed bounded contract",
        )
    return {
        **value,
        "reductionWeight": float(value["reductionWeight"]),
    }


def _load_close(
    data_root: Path,
    asset: str,
    start: str,
    end: str,
) -> pd.Series:
    try:
        multi_interval = load_multi_interval_asset(
            data_root,
            asset,
            start=start,
            end=end,
        )
    except IntervalContractError as error:
        raise JudgeFailure(error.code, str(error)) from error
    if multi_interval is not None:
        frame = multi_interval
    else:
        source = (data_root / "ohlcv" / f"{asset}.csv").resolve()
        if data_root not in source.parents or not source.is_file():
            raise JudgeFailure(
                "dataset.asset",
                f"Missing confined OHLCV file for {asset}",
            )
        frame = pd.read_csv(source)
        if tuple(frame.columns) != REQUIRED_COLUMNS:
            raise JudgeFailure(
                "dataset.columns",
                f"{asset} columns must be exactly {', '.join(REQUIRED_COLUMNS)}",
            )
        frame["timestamp"] = pd.to_datetime(
            frame["timestamp"],
            errors="raise",
        )
        for column in REQUIRED_COLUMNS[1:]:
            frame[column] = pd.to_numeric(frame[column], errors="raise")
        frame = frame[
            (frame["timestamp"] >= pd.Timestamp(start))
            & (frame["timestamp"] <= pd.Timestamp(end))
        ].copy()
    if (
        len(frame) < 40
        or frame["timestamp"].duplicated().any()
        or not frame["timestamp"].is_monotonic_increasing
        or not np.isfinite(frame["close"].to_numpy(dtype=float)).all()
        or (frame["close"] <= 0).any()
    ):
        raise JudgeFailure(
            "dataset.asset",
            f"{asset} has invalid or insufficient closed price observations",
        )
    return pd.Series(
        frame["close"].to_numpy(dtype=float),
        index=pd.DatetimeIndex(frame["timestamp"]),
        name=asset,
    )


def _covariance_analysis(
    returns: pd.DataFrame,
    weights: pd.Series,
    annualization: int,
) -> dict[str, Any]:
    values = returns.to_numpy(dtype=float)
    covariance = np.atleast_2d(
        np.cov(values, rowvar=False, ddof=0)
    ) * annualization
    if (
        covariance.shape != (len(weights), len(weights))
        or not np.isfinite(covariance).all()
    ):
        raise JudgeFailure(
            "book-risk.covariance",
            "Covariance matrix is invalid",
        )
    weight_values = weights.to_numpy(dtype=float)
    variance = float(weight_values @ covariance @ weight_values)
    if not math.isfinite(variance) or variance <= 1e-18:
        raise JudgeFailure(
            "book-risk.zero-variance",
            "Reported book has no measurable covariance risk",
        )
    volatility = math.sqrt(max(variance, 0.0))
    marginal = covariance @ weight_values
    component_variance = weight_values * marginal
    signed_shares = component_variance / variance
    absolute = np.abs(component_variance)
    absolute_total = float(absolute.sum())
    absolute_shares = (
        absolute / absolute_total
        if absolute_total > 1e-18
        else np.zeros_like(absolute)
    )
    hhi = float(np.square(absolute_shares).sum())
    correlation = returns.corr().to_numpy(dtype=float)
    eigenvalues = np.linalg.eigvalsh(correlation)
    first_pc_share = float(
        max(float(eigenvalues[-1]), 0.0)
        / max(float(eigenvalues.sum()), 1e-18)
    )
    contributions = [
        {
            "asset": asset,
            "weight": float(weight_values[index]),
            "marginalVariance": float(marginal[index]),
            "componentVariance": float(component_variance[index]),
            "signedRiskShare": float(signed_shares[index]),
            "absoluteRiskShare": float(absolute_shares[index]),
        }
        for index, asset in enumerate(weights.index)
    ]
    return {
        "observations": int(len(returns)),
        "annualizedVolatility": volatility,
        "annualizedVariance": variance,
        "componentRiskHhi": hhi,
        "effectiveRiskBets": 1.0 / hhi if hhi > 1e-18 else 0.0,
        "firstPrincipalComponentVarianceShare": first_pc_share,
        "largestAbsoluteRiskContributorShare": float(
            absolute_shares.max(initial=0.0)
        ),
        "contributions": contributions,
        "correlation": correlation,
    }


def _drawdown_analysis(
    returns: pd.DataFrame,
    weights: pd.Series,
    initial_timestamp: pd.Timestamp,
) -> dict[str, Any]:
    """Build one static-weight close-to-close research equity path."""

    portfolio_returns = (
        returns.loc[:, list(weights.index)].to_numpy(dtype=float)
        @ weights.to_numpy(dtype=float)
    )
    if (
        len(portfolio_returns) != len(returns)
        or not np.isfinite(portfolio_returns).all()
        or (portfolio_returns <= -1.0).any()
        or pd.Timestamp(initial_timestamp) >= returns.index[0]
    ):
        raise JudgeFailure(
            "book-risk.drawdown-path",
            "Static-weight book return path is invalid",
        )
    path_returns = np.concatenate(([0.0], portfolio_returns))
    nav = np.cumprod(1.0 + path_returns)
    running_peak = np.maximum.accumulate(nav)
    drawdown = nav / running_peak - 1.0
    timestamps = pd.DatetimeIndex([initial_timestamp]).append(returns.index)
    trough_index = int(np.argmin(drawdown))
    peak_index = int(np.argmax(nav[: trough_index + 1]))
    recovery_index: int | None = None
    peak_nav = float(nav[peak_index])
    for index in range(trough_index, len(nav)):
        if float(nav[index]) >= peak_nav * (1.0 - 1e-12):
            recovery_index = index
            break
    rows = [
        {
            "timestamp": timestamp_label(timestamp),
            "portfolioReturn": float(path_returns[index]),
            "cumulativeReturn": float(nav[index] - 1.0),
            "nav": float(nav[index]),
            "runningPeak": float(running_peak[index]),
            "drawdown": float(drawdown[index]),
        }
        for index, timestamp in enumerate(timestamps)
    ]
    return {
        "summary": {
            "maximumDrawdown": float(drawdown[trough_index]),
            "peakTimestamp": rows[peak_index]["timestamp"],
            "troughTimestamp": rows[trough_index]["timestamp"],
            "recoveryTimestamp": (
                rows[recovery_index]["timestamp"]
                if recovery_index is not None
                else None
            ),
            "recovered": recovery_index is not None,
        },
        "rows": rows,
    }


def _write_csv(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def _reduction_rows(
    returns: pd.DataFrame,
    weights: pd.Series,
    cash_weight: float,
    annualization: int,
    reduction_weight: float,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    baseline = _covariance_analysis(
        returns,
        weights,
        annualization,
    )
    for asset in weights.index:
        step = min(reduction_weight, abs(float(weights[asset])))
        candidate = weights.copy()
        candidate[asset] = float(candidate[asset]) - math.copysign(
            step,
            float(candidate[asset]),
        )
        analysis = _covariance_analysis(
            returns,
            candidate,
            annualization,
        )
        volatility_reduction = (
            float(baseline["annualizedVolatility"])
            - float(analysis["annualizedVolatility"])
        )
        rows.append(
            {
                "asset": str(asset),
                "startingWeight": float(weights[asset]),
                "weightReduction": step,
                "resultingWeight": float(candidate[asset]),
                "resultingCashWeight": (
                    cash_weight
                    + math.copysign(step, float(weights[asset]))
                ),
                "annualizedVolatility": float(
                    analysis["annualizedVolatility"]
                ),
                "volatilityReduction": volatility_reduction,
                "volatilityReductionPerWeight": (
                    volatility_reduction / step
                ),
                "componentRiskHhi": float(
                    analysis["componentRiskHhi"]
                ),
                "effectiveRiskBets": float(
                    analysis["effectiveRiskBets"]
                ),
            }
        )
    rows.sort(
        key=lambda item: item["volatilityReductionPerWeight"],
        reverse=True,
    )
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    return rows


def _solve_position_sizing(
    policy: dict[str, Any] | None,
    returns: pd.DataFrame,
    weights: pd.Series,
    cash_weight: float,
    annualization: int,
    lookbacks: list[int],
    close_index: pd.DatetimeIndex,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    if policy is None:
        return {"status": "not-requested"}, [], []
    common_required = {
        "kind",
        "asset",
        "direction",
        "annualizedVolatilityCeiling",
        "lookbackBars",
        "authority",
    }
    asset = policy.get("asset")
    direction = policy.get("direction")
    ceiling = policy.get("annualizedVolatilityCeiling")
    governing_lookback = policy.get("lookbackBars")
    directional_bound = (
        policy.get("minimumWeight")
        if direction == "decrease"
        else policy.get("maximumWeight")
        if direction == "increase"
        else None
    )
    required = common_required | (
        {"minimumWeight"}
        if direction == "decrease"
        else {"maximumWeight"}
        if direction == "increase"
        else set()
    )
    if (
        set(policy) != required
        or policy.get("kind")
        != "one-asset-against-cash-for-volatility-ceiling"
        or direction not in {"increase", "decrease"}
        or policy.get("authority")
        != {
            "decisionPath": "caller-bounded-historical-sizing",
            "tradingAuthority": "none",
        }
        or not isinstance(asset, str)
        or asset not in weights.index
        or (
            direction == "decrease"
            and float(weights[asset]) <= 0
        )
        or (
            direction == "increase"
            and (
                float(weights[asset]) < 0
                or cash_weight <= 0
            )
        )
        or not isinstance(ceiling, (int, float))
        or isinstance(ceiling, bool)
        or not math.isfinite(float(ceiling))
        or float(ceiling) <= 0
        or not isinstance(governing_lookback, int)
        or isinstance(governing_lookback, bool)
        or governing_lookback not in lookbacks
        or not isinstance(directional_bound, (int, float))
        or isinstance(directional_bound, bool)
        or not math.isfinite(float(directional_bound))
        or (
            direction == "decrease"
            and not 0 <= float(directional_bound) < float(weights[asset])
        )
        or (
            direction == "increase"
            and not float(weights[asset]) < float(directional_bound) <= 2
        )
    ):
        raise JudgeFailure(
            "book-risk.position-sizing",
            "Position sizing differs from the bounded fixed contract",
        )
    selected_returns = returns.tail(governing_lookback)
    covariance = np.atleast_2d(
        np.cov(
            selected_returns.to_numpy(dtype=float),
            rowvar=False,
            ddof=0,
        )
    ) * annualization
    asset_index = list(weights.index).index(asset)
    zero_leg = weights.to_numpy(dtype=float).copy()
    zero_leg[asset_index] = 0.0
    coefficient_a = float(covariance[asset_index, asset_index])
    coefficient_b = float(
        2.0 * covariance[asset_index, :] @ zero_leg
    )
    coefficient_c = float(zero_leg @ covariance @ zero_leg)
    starting_weight = float(weights[asset])
    funding_maximum = starting_weight + cash_weight
    domain_minimum = (
        float(directional_bound)
        if direction == "decrease"
        else starting_weight
    )
    domain_maximum = (
        starting_weight
        if direction == "decrease"
        else min(funding_maximum, float(directional_bound))
    )
    target_variance = float(ceiling) ** 2

    def variance_at(weight: float) -> float:
        return float(
            coefficient_a * weight * weight
            + coefficient_b * weight
            + coefficient_c
        )

    if coefficient_a > 1e-18:
        unconstrained_minimum = -coefficient_b / (2.0 * coefficient_a)
        minimum_weight = min(
            max(unconstrained_minimum, domain_minimum),
            domain_maximum,
        )
    else:
        minimum_weight = min(
            (domain_minimum, domain_maximum),
            key=variance_at,
        )
    minimum_variance = variance_at(minimum_weight)
    starting_variance = variance_at(starting_weight)
    tolerance = max(1e-14, target_variance * 1e-10)
    if (
        direction == "decrease"
        and starting_variance <= target_variance + tolerance
    ):
        status = "unchanged-compliant"
        resulting_weight = starting_weight
        result_meaning = "unchanged-compliant-book"
        binding_constraint = "current-book"
    elif minimum_variance > target_variance + tolerance:
        status = "infeasible"
        resulting_weight = minimum_weight
        result_meaning = "constrained-minimum-evidence-not-recommendation"
        binding_constraint = "no-compliant-weight"
    elif (
        direction == "increase"
        and variance_at(domain_maximum) <= target_variance + tolerance
    ):
        caller_bound_binds = (
            float(directional_bound) < funding_maximum - 1e-12
        )
        status = (
            "maximum-weight-compliant"
            if caller_bound_binds
            else "fully-funded-compliant"
        )
        resulting_weight = domain_maximum
        result_meaning = (
            "caller-maximum-weight-compliant"
            if caller_bound_binds
            else "full-cash-allocation-compliant"
        )
        binding_constraint = (
            "caller-weight-bound"
            if caller_bound_binds
            else "available-cash"
        )
    else:
        status = "sized"
        result_meaning = (
            "smallest-compliant-decrease"
            if direction == "decrease"
            else "largest-compliant-increase"
        )
        binding_constraint = "volatility-ceiling"
        if coefficient_a <= 1e-18:
            if abs(coefficient_b) <= 1e-18:
                raise JudgeFailure(
                    "book-risk.position-sizing",
                    "Sizing path is numerically degenerate",
                )
            resulting_weight = (
                target_variance - coefficient_c
            ) / coefficient_b
        else:
            discriminant = (
                coefficient_b * coefficient_b
                - 4.0
                * coefficient_a
                * (coefficient_c - target_variance)
            )
            if discriminant < -tolerance:
                raise JudgeFailure(
                    "book-risk.position-sizing",
                    "Sizing quadratic has no valid boundary solution",
                )
            root = math.sqrt(max(discriminant, 0.0))
            resulting_weight = (
                -coefficient_b + root
            ) / (2.0 * coefficient_a)
        resulting_weight = min(
            max(float(resulting_weight), domain_minimum),
            domain_maximum,
        )
    resulting_weights = weights.copy()
    resulting_weights[asset] = resulting_weight
    weight_change = resulting_weight - starting_weight
    cash_weight_change = -weight_change
    resulting_cash = cash_weight + cash_weight_change
    lookback_rows: list[dict[str, Any]] = []
    governing_analysis: dict[str, Any] | None = None
    baseline_governing = _covariance_analysis(
        selected_returns,
        weights,
        annualization,
    )
    for lookback in lookbacks:
        selected = returns.tail(lookback)
        baseline = _covariance_analysis(
            selected,
            weights,
            annualization,
        )
        analysis = _covariance_analysis(
            selected,
            resulting_weights,
            annualization,
        )
        largest = max(
            analysis["contributions"],
            key=lambda item: item["absoluteRiskShare"],
        )
        row = {
            "lookbackBars": lookback,
            "observations": int(analysis["observations"]),
            "annualizedVolatility": float(
                analysis["annualizedVolatility"]
            ),
            "annualizedVolatilityDelta": float(
                analysis["annualizedVolatility"]
                - baseline["annualizedVolatility"]
            ),
            "componentRiskHhi": float(analysis["componentRiskHhi"]),
            "effectiveRiskBets": float(analysis["effectiveRiskBets"]),
            "largestAbsoluteRiskContributor": largest["asset"],
            "largestAbsoluteRiskContributorShare": float(
                largest["absoluteRiskShare"]
            ),
            "governing": lookback == governing_lookback,
            "ceilingSatisfied": (
                analysis["annualizedVolatility"]
                <= float(ceiling) + 1e-12
            ),
        }
        lookback_rows.append(row)
        if lookback == governing_lookback:
            governing_analysis = analysis
    if governing_analysis is None:
        raise JudgeFailure(
            "book-risk.position-sizing",
            "Governing sizing analysis is unavailable",
        )
    contribution_rows = [
        {
            "asset": row["asset"],
            "baselineWeight": float(weights[row["asset"]]),
            "resultingWeight": float(resulting_weights[row["asset"]]),
            "weightDelta": float(
                resulting_weights[row["asset"]] - weights[row["asset"]]
            ),
            "componentVariance": float(row["componentVariance"]),
            "signedRiskShare": float(row["signedRiskShare"]),
            "absoluteRiskShare": float(row["absoluteRiskShare"]),
        }
        for row in governing_analysis["contributions"]
    ]
    largest = max(
        governing_analysis["contributions"],
        key=lambda item: item["absoluteRiskShare"],
    )
    correlation = governing_analysis["correlation"]
    pairwise_correlations = [
        {
            "leftAsset": str(weights.index[left]),
            "rightAsset": str(weights.index[right]),
            "correlation": float(correlation[left, right]),
        }
        for left in range(len(weights))
        for right in range(left + 1, len(weights))
    ]
    first_return_position = close_index.get_loc(selected_returns.index[0])
    if (
        not isinstance(first_return_position, (int, np.integer))
        or first_return_position < 1
    ):
        raise JudgeFailure(
            "book-risk.position-sizing-drawdown",
            "Sizing drawdown window lacks an observed initial close",
        )
    sizing_drawdown = _drawdown_analysis(
        selected_returns,
        resulting_weights,
        close_index[first_return_position - 1],
    )
    return (
        {
            "status": status,
            "resultMeaning": result_meaning,
            "bindingConstraint": binding_constraint,
            "policy": policy,
            "quadratic": {
                "coefficientA": coefficient_a,
                "coefficientB": coefficient_b,
                "coefficientC": coefficient_c,
                "domainMinimumWeight": domain_minimum,
                "domainMaximumWeight": domain_maximum,
                "targetVariance": target_variance,
                "startingVariance": starting_variance,
                "minimumWeight": minimum_weight,
                "minimumVariance": minimum_variance,
            },
            "result": {
                "asset": asset,
                "startingWeight": starting_weight,
                "resultingWeight": resulting_weight,
                "weightChange": weight_change,
                "startingCashWeight": cash_weight,
                "resultingCashWeight": resulting_cash,
                "cashWeightChange": cash_weight_change,
                "weights": {
                    symbol: float(resulting_weights[symbol])
                    for symbol in resulting_weights.index
                },
                "annualizedVolatility": float(
                    governing_analysis["annualizedVolatility"]
                ),
                "annualizedVariance": float(
                    governing_analysis["annualizedVariance"]
                ),
                "annualizedVolatilityDelta": float(
                    governing_analysis["annualizedVolatility"]
                    - baseline_governing["annualizedVolatility"]
                ),
                "componentRiskHhi": float(
                    governing_analysis["componentRiskHhi"]
                ),
                "effectiveRiskBets": float(
                    governing_analysis["effectiveRiskBets"]
                ),
                "largestAbsoluteRiskContributor": largest["asset"],
                "largestAbsoluteRiskContributorShare": float(
                    largest["absoluteRiskShare"]
                ),
                "ceilingSatisfied": (
                    governing_analysis["annualizedVolatility"]
                    <= float(ceiling) + 1e-12
                ),
            },
            "lookbacks": lookback_rows,
            "contributions": contribution_rows,
            "pairwiseCorrelations": pairwise_correlations,
            "drawdown": {
                "method": "daily-constant-weight-close-to-close",
                "returnConvention": (
                    "Supplied asset weights are applied to each same-clock "
                    "close-to-close simple-return row; cash return is zero."
                ),
                "initialNav": 1.0,
                **sizing_drawdown["summary"],
            },
        },
        lookback_rows,
        contribution_rows,
    )


def main() -> None:
    try:
        project_root = Path(os.environ["AUTOQUANT_PROJECT_ROOT"]).resolve()
        data_root = Path(os.environ["AUTOQUANT_DATA_ROOT"]).resolve()
        artifacts = Path(os.environ["AUTOQUANT_ARTIFACTS_DIR"]).resolve()
        arguments = _arguments()
        selected_data_root = _fixed_dataset_root(
            data_root,
            arguments.dataset_root,
        )
        if not selected_data_root.is_dir():
            raise JudgeFailure(
                "book-risk.dataset-root",
                "Fixed dataset root must be a real directory",
            )
        study = _read_object(
            Path(os.environ["AUTOQUANT_STUDY_PATH"]),
            "study.invalid",
        )
        snapshot = _read_object(
            _fixed_input_path(
                project_root,
                arguments.position_snapshot,
                "book-risk.position-snapshot",
            ),
            "book-risk.position-snapshot",
        )
        weights_raw = snapshot.get("weights")
        if not isinstance(weights_raw, dict) or not weights_raw:
            raise JudgeFailure(
                "book-risk.position-snapshot",
                "Book Risk Study requires at least one reported position weight",
            )
        weights = pd.Series(weights_raw, dtype=float)
        if (
            not np.isfinite(weights.to_numpy(dtype=float)).all()
            or (weights.abs() <= 1e-12).any()
        ):
            raise JudgeFailure(
                "book-risk.position-snapshot",
                "Reported position weights are invalid",
            )
        scenario_snapshots = snapshot.get("scenarios")
        if (
            not isinstance(scenario_snapshots, list)
            or len(scenario_snapshots) > 8
            or not all(isinstance(item, dict) for item in scenario_snapshots)
        ):
            raise JudgeFailure(
                "book-risk.position-scenarios",
                "Position scenarios differ from the bounded fixed contract",
            )
        scenario_weights: list[tuple[dict[str, Any], pd.Series]] = []
        scenario_ids: set[str] = set()
        for scenario in scenario_snapshots:
            raw = scenario.get("weights")
            identifier = scenario.get("id")
            if (
                not isinstance(identifier, str)
                or not identifier
                or identifier in scenario_ids
                or not isinstance(scenario.get("name"), str)
                or not scenario["name"]
                or scenario.get("snapshotKind") != "hypothetical-weights"
                or scenario.get("asOf") != snapshot.get("asOf")
                or scenario.get("baseCurrency") != snapshot.get("baseCurrency")
                or scenario.get("authority")
                != {
                    "positionTruth": "caller-hypothetical-not-authenticated",
                    "tradingAuthority": "none",
                }
                or not isinstance(raw, dict)
                or not raw
            ):
                raise JudgeFailure(
                    "book-risk.position-scenarios",
                    "One position scenario is invalid",
                )
            candidate = pd.Series(raw, dtype=float)
            if (
                not np.isfinite(candidate.to_numpy(dtype=float)).all()
                or (candidate.abs() <= 1e-12).any()
            ):
                raise JudgeFailure(
                    "book-risk.position-scenarios",
                    "Scenario position weights are invalid",
                )
            scenario_ids.add(identifier)
            scenario_weights.append((scenario, candidate))
        sizing_policy = snapshot.get("sizingPolicy")
        if sizing_policy is not None and scenario_weights:
            raise JudgeFailure(
                "book-risk.position-sizing",
                "Position sizing cannot coexist with supplied scenarios",
            )
        scenarios = _load_scenarios(
            _fixed_input_path(
                project_root,
                arguments.scenarios,
                "book-risk.scenarios",
            )
        )
        if sizing_policy is not None:
            # A caller-authorized sizing path is governed by one exact
            # covariance window. Keep every fixed diagnostic lookback, but
            # make that governing window the report's primary/current view so
            # the ordinary ledger cannot answer a different question.
            scenarios = {
                **scenarios,
                "primaryLookbackBars": int(sizing_policy["lookbackBars"]),
            }
        dataset = study.get("dataset")
        if not isinstance(dataset, dict):
            raise JudgeFailure("study.dataset", "Study dataset is invalid")
        universe = dataset.get("universe")
        time_range = dataset.get("time_range")
        if (
            not isinstance(universe, list)
            or not set(weights.index).issubset(universe)
            or not isinstance(time_range, dict)
        ):
            raise JudgeFailure(
                "book-risk.universe",
                "Reported positions are outside the Study universe",
            )
        comparison_assets = list(weights.index)
        for _, candidate in scenario_weights:
            for asset in candidate.index:
                if asset not in comparison_assets:
                    comparison_assets.append(str(asset))
        data_assets = list(comparison_assets)
        if sizing_policy is not None:
            sizing_asset = sizing_policy.get("asset")
            if (
                not isinstance(sizing_asset, str)
                or not sizing_asset
            ):
                raise JudgeFailure(
                    "book-risk.position-sizing",
                    "Position sizing asset is invalid",
                )
            if sizing_asset not in data_assets:
                data_assets.append(sizing_asset)
        if not set(data_assets).issubset(universe):
            raise JudgeFailure(
                "book-risk.universe",
                "Scenario positions are outside the Study universe",
            )
        closes = pd.concat(
            [
                _load_close(
                    selected_data_root,
                    asset,
                    str(time_range["start"]),
                    str(time_range["end"]),
                )
                for asset in data_assets
            ],
            axis=1,
            join="inner",
        ).dropna()
        as_of = pd.Timestamp(snapshot.get("asOf"))
        comparable_as_of = (
            as_of.tz_localize(None)
            if closes.index.tz is None and as_of.tzinfo is not None
            else as_of
        )
        closes = closes.loc[closes.index <= comparable_as_of]
        returns = closes.pct_change(fill_method=None).dropna()
        baseline_returns = returns.loc[:, list(weights.index)]
        minimum = int(scenarios["minimumObservations"])
        if len(returns) < max(minimum, max(scenarios["lookbackBars"])):
            raise JudgeFailure(
                "book-risk.observations",
                "Insufficient common return observations for declared lookbacks",
            )
        annualization = annualization_periods(closes.index)
        lookback_results: list[dict[str, Any]] = []
        analyses: dict[int, dict[str, Any]] = {}
        drawdowns: dict[int, dict[str, Any]] = {}
        for lookback in scenarios["lookbackBars"]:
            selected = baseline_returns.tail(lookback)
            analysis = _covariance_analysis(
                selected,
                weights,
                annualization,
            )
            analyses[lookback] = analysis
            first_return_position = closes.index.get_loc(selected.index[0])
            if (
                not isinstance(first_return_position, (int, np.integer))
                or first_return_position < 1
            ):
                raise JudgeFailure(
                    "book-risk.drawdown-path",
                    "Drawdown window lacks an observed initial close",
                )
            drawdown = _drawdown_analysis(
                selected,
                weights,
                closes.index[first_return_position - 1],
            )
            drawdowns[lookback] = drawdown
            window_reductions = _reduction_rows(
                selected,
                weights,
                float(snapshot["cashWeight"]),
                annualization,
                float(scenarios["reductionWeight"]),
            )
            largest = max(
                analysis["contributions"],
                key=lambda item: item["absoluteRiskShare"],
            )
            lookback_results.append(
                {
                    "lookbackBars": lookback,
                    **{
                        key: value
                        for key, value in analysis.items()
                        if key not in {"contributions", "correlation"}
                    },
                    "largestAbsoluteRiskContributor": largest["asset"],
                    "maximumDrawdown": drawdown["summary"][
                        "maximumDrawdown"
                    ],
                    "firstReductionAsset": window_reductions[0]["asset"],
                    "firstReductionVolatilityPerWeight": window_reductions[0][
                        "volatilityReductionPerWeight"
                    ],
                    "reductionRanking": window_reductions,
                }
            )
        primary_lookback = int(scenarios["primaryLookbackBars"])
        primary = analyses[primary_lookback]
        primary_drawdown = drawdowns[primary_lookback]
        primary_returns = baseline_returns.tail(primary_lookback)
        correlation = primary["correlation"]
        pairwise: list[dict[str, Any]] = []
        for left in range(len(weights)):
            for right in range(left + 1, len(weights)):
                pairwise.append(
                    {
                        "leftAsset": str(weights.index[left]),
                        "rightAsset": str(weights.index[right]),
                        "correlation": float(correlation[left, right]),
                    }
                )
        pairwise.sort(
            key=lambda item: abs(item["correlation"]),
            reverse=True,
        )
        reduction_weight = float(scenarios["reductionWeight"])
        reductions = _reduction_rows(
            primary_returns,
            weights,
            float(snapshot["cashWeight"]),
            annualization,
            reduction_weight,
        )
        sizing_assets = list(weights.index)
        if (
            sizing_policy is not None
            and sizing_policy["asset"] not in sizing_assets
        ):
            sizing_assets.append(sizing_policy["asset"])
        (
            position_sizing,
            sizing_lookback_rows,
            sizing_contribution_rows,
        ) = _solve_position_sizing(
            sizing_policy,
            returns.loc[:, sizing_assets],
            weights.reindex(
                sizing_assets,
                fill_value=0.0,
            ),
            float(snapshot["cashWeight"]),
            annualization,
            list(scenarios["lookbackBars"]),
            closes.index,
        )
        comparison_weights = weights.reindex(
            comparison_assets,
            fill_value=0.0,
        )
        comparison_baselines: dict[int, dict[str, Any]] = {}
        scenario_results: list[dict[str, Any]] = []
        for scenario, candidate in scenario_weights:
            complete_candidate = candidate.reindex(
                comparison_assets,
                fill_value=0.0,
            )
            scenario_lookbacks: list[dict[str, Any]] = []
            for lookback in scenarios["lookbackBars"]:
                selected = returns.tail(lookback)
                if lookback not in comparison_baselines:
                    comparison_baselines[lookback] = _covariance_analysis(
                        selected,
                        comparison_weights,
                        annualization,
                    )
                comparison_baseline = comparison_baselines[lookback]
                analysis = _covariance_analysis(
                    selected,
                    complete_candidate,
                    annualization,
                )
                largest = max(
                    analysis["contributions"],
                    key=lambda item: item["absoluteRiskShare"],
                )
                scenario_lookbacks.append(
                    {
                        "lookbackBars": lookback,
                        "observations": int(analysis["observations"]),
                        "annualizedVolatility": float(
                            analysis["annualizedVolatility"]
                        ),
                        "annualizedVolatilityDelta": float(
                            analysis["annualizedVolatility"]
                            - comparison_baseline["annualizedVolatility"]
                        ),
                        "componentRiskHhi": float(
                            analysis["componentRiskHhi"]
                        ),
                        "componentRiskHhiDelta": float(
                            analysis["componentRiskHhi"]
                            - comparison_baseline["componentRiskHhi"]
                        ),
                        "effectiveRiskBets": float(
                            analysis["effectiveRiskBets"]
                        ),
                        "effectiveRiskBetsDelta": float(
                            analysis["effectiveRiskBets"]
                            - comparison_baseline["effectiveRiskBets"]
                        ),
                        "largestAbsoluteRiskContributor": largest["asset"],
                        "largestAbsoluteRiskContributorShare": float(
                            largest["absoluteRiskShare"]
                        ),
                    }
                )
            scenario_results.append(
                {
                    "id": scenario["id"],
                    "name": scenario["name"],
                    "weights": scenario["weights"],
                    "cashWeight": float(scenario["cashWeight"]),
                    "lookbacks": scenario_lookbacks,
                }
            )
        for lookback in scenarios["lookbackBars"]:
            ranked = sorted(
                scenario_results,
                key=lambda item: next(
                    row["annualizedVolatilityDelta"]
                    for row in item["lookbacks"]
                    if row["lookbackBars"] == lookback
                ),
            )
            for rank, scenario in enumerate(ranked, start=1):
                next(
                    row
                    for row in scenario["lookbacks"]
                    if row["lookbackBars"] == lookback
                )["volatilityRank"] = rank
        comparison_rows: list[dict[str, Any]] = []
        scenario_contribution_rows: list[dict[str, Any]] = []
        primary_comparison_baseline = comparison_baselines.get(
            primary_lookback
        )
        if scenario_results and primary_comparison_baseline is None:
            raise JudgeFailure(
                "book-risk.position-scenarios",
                "Primary scenario baseline is unavailable",
            )
        baseline_contributions = {
            row["asset"]: row
            for row in (
                primary_comparison_baseline["contributions"]
                if primary_comparison_baseline is not None
                else []
            )
        }
        for (scenario, candidate), result in zip(
            scenario_weights,
            scenario_results,
            strict=True,
        ):
            for row in result["lookbacks"]:
                comparison_rows.append(
                    {
                        "scenarioId": result["id"],
                        "scenarioName": result["name"],
                        **row,
                    }
                )
            primary_analysis = _covariance_analysis(
                returns.tail(primary_lookback),
                candidate.reindex(comparison_assets, fill_value=0.0),
                annualization,
            )
            scenario_contributions = {
                row["asset"]: row
                for row in primary_analysis["contributions"]
            }
            for asset in comparison_assets:
                baseline_row = baseline_contributions[asset]
                scenario_row = scenario_contributions[asset]
                baseline_weight = float(comparison_weights[asset])
                scenario_weight = float(
                    candidate.reindex(
                        comparison_assets,
                        fill_value=0.0,
                    )[asset]
                )
                scenario_contribution_rows.append(
                    {
                        "scenarioId": scenario["id"],
                        "asset": asset,
                        "baselineWeight": baseline_weight,
                        "scenarioWeight": scenario_weight,
                        "weightDelta": scenario_weight - baseline_weight,
                        "baselineComponentVariance": float(
                            baseline_row["componentVariance"]
                        ),
                        "scenarioComponentVariance": float(
                            scenario_row["componentVariance"]
                        ),
                        "componentVarianceDelta": float(
                            scenario_row["componentVariance"]
                            - baseline_row["componentVariance"]
                        ),
                        "baselineAbsoluteRiskShare": float(
                            baseline_row["absoluteRiskShare"]
                        ),
                        "scenarioAbsoluteRiskShare": float(
                            scenario_row["absoluteRiskShare"]
                        ),
                        "absoluteRiskShareDelta": float(
                            scenario_row["absoluteRiskShare"]
                            - baseline_row["absoluteRiskShare"]
                        ),
                    }
                )
        rolling: list[dict[str, Any]] = []
        step = int(scenarios["rollingStepBars"])
        positions = list(
            range(primary_lookback, len(baseline_returns) + 1, step)
        )
        if not positions or positions[-1] != len(baseline_returns):
            positions.append(len(baseline_returns))
        for stop in positions:
            selected = baseline_returns.iloc[
                max(0, stop - primary_lookback) : stop
            ]
            if len(selected) < minimum:
                continue
            analysis = _covariance_analysis(
                selected,
                weights,
                annualization,
            )
            rolling.append(
                {
                    "timestamp": timestamp_label(selected.index[-1]),
                    "observations": int(len(selected)),
                    "annualizedVolatility": float(
                        analysis["annualizedVolatility"]
                    ),
                    "componentRiskHhi": float(
                        analysis["componentRiskHhi"]
                    ),
                    "effectiveRiskBets": float(
                        analysis["effectiveRiskBets"]
                    ),
                    "firstPrincipalComponentVarianceShare": float(
                        analysis["firstPrincipalComponentVarianceShare"]
                    ),
                }
            )
        report = {
            "schemaVersion": 1,
            "kind": REPORT_KIND,
            "requestHash": snapshot["source"]["requestHash"],
            "positionSnapshot": snapshot,
            "authority": {
                "positionTruth": "external-reported-not-authenticated",
                "marketEvidence": "content-locked-closed-ohlcv",
                "tradingAuthority": "none",
                "reductionMeaning": "standardized-historical-sensitivity",
                "scenarioMeaning": "caller-specified-historical-comparison",
                "sizingMeaning": (
                    "caller-bounded-historical-target-position"
                ),
                "drawdownMeaning": (
                    "static-weight-close-to-close-research-path"
                ),
            },
            "method": scenarios,
            "dataset": {
                "id": dataset.get("id"),
                "version": dataset.get("version"),
                "assetClass": dataset.get("asset_class"),
                "universe": universe,
                "heldAssets": list(weights.index),
                "marketDataEnd": timestamp_label(closes.index[-1]),
                "annualizationPeriods": annualization,
            },
            "lookbacks": lookback_results,
            "current": {
                **{
                    key: value
                    for key, value in primary.items()
                    if key not in {"contributions", "correlation"}
                },
                "lookbackBars": primary_lookback,
                "grossExposure": float(weights.abs().sum()),
                "netExposure": float(weights.sum()),
                "cashWeight": float(snapshot["cashWeight"]),
                "maximumDrawdown": primary_drawdown["summary"][
                    "maximumDrawdown"
                ],
            },
            "drawdown": {
                "method": "daily-constant-weight-close-to-close",
                "returnConvention": (
                    "Supplied asset weights are applied to each same-clock "
                    "close-to-close simple-return row; cash return is zero."
                ),
                "initialNav": 1.0,
                **primary_drawdown["summary"],
            },
            "contributions": sorted(
                primary["contributions"],
                key=lambda item: item["absoluteRiskShare"],
                reverse=True,
            ),
            "pairwiseCorrelations": pairwise,
            "reductions": reductions,
            "scenarioComparison": {
                "comparisonUniverse": comparison_assets,
                "baselineLookbacks": [
                    {
                        "lookbackBars": lookback,
                        "observations": int(
                            comparison_baselines[lookback]["observations"]
                        ),
                        "annualizedVolatility": float(
                            comparison_baselines[lookback][
                                "annualizedVolatility"
                            ]
                        ),
                        "componentRiskHhi": float(
                            comparison_baselines[lookback][
                                "componentRiskHhi"
                            ]
                        ),
                        "effectiveRiskBets": float(
                            comparison_baselines[lookback][
                                "effectiveRiskBets"
                            ]
                        ),
                    }
                    for lookback in scenarios["lookbackBars"]
                    if lookback in comparison_baselines
                ],
                "scenarios": scenario_results,
                "ranking": {
                    "metric": "annualizedVolatilityDelta",
                    "direction": "minimize",
                    "selectionAuthority": "none",
                },
            },
            "positionSizing": position_sizing,
            "rollingSummary": {
                "observations": len(rolling),
                "start": rolling[0]["timestamp"],
                "end": rolling[-1]["timestamp"],
                "minimumEffectiveRiskBets": min(
                    row["effectiveRiskBets"] for row in rolling
                ),
                "maximumComponentRiskHhi": max(
                    row["componentRiskHhi"] for row in rolling
                ),
            },
        }
        (artifacts / "book-risk-report.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        _write_csv(
            artifacts / "book-risk-contributions.csv",
            [
                "asset",
                "weight",
                "marginalVariance",
                "componentVariance",
                "signedRiskShare",
                "absoluteRiskShare",
            ],
            report["contributions"],
        )
        _write_csv(
            artifacts / "book-risk-reductions.csv",
            [
                "rank",
                "asset",
                "startingWeight",
                "weightReduction",
                "resultingWeight",
                "resultingCashWeight",
                "annualizedVolatility",
                "volatilityReduction",
                "volatilityReductionPerWeight",
                "componentRiskHhi",
                "effectiveRiskBets",
            ],
            reductions,
        )
        _write_csv(
            artifacts / "book-risk-correlations.csv",
            ["leftAsset", "rightAsset", "correlation"],
            pairwise,
        )
        _write_csv(
            artifacts / "book-risk-path.csv",
            [
                "timestamp",
                "observations",
                "annualizedVolatility",
                "componentRiskHhi",
                "effectiveRiskBets",
                "firstPrincipalComponentVarianceShare",
            ],
            rolling,
        )
        _write_csv(
            artifacts / "book-risk-equity-path.csv",
            [
                "timestamp",
                "portfolioReturn",
                "cumulativeReturn",
                "nav",
                "runningPeak",
                "drawdown",
            ],
            drawdowns[max(scenarios["lookbackBars"])]["rows"],
        )
        _write_csv(
            artifacts / "book-risk-scenario-comparisons.csv",
            [
                "scenarioId",
                "scenarioName",
                "volatilityRank",
                "lookbackBars",
                "observations",
                "annualizedVolatility",
                "annualizedVolatilityDelta",
                "componentRiskHhi",
                "componentRiskHhiDelta",
                "effectiveRiskBets",
                "effectiveRiskBetsDelta",
                "largestAbsoluteRiskContributor",
                "largestAbsoluteRiskContributorShare",
            ],
            comparison_rows,
        )
        _write_csv(
            artifacts / "book-risk-scenario-contributions.csv",
            [
                "scenarioId",
                "asset",
                "baselineWeight",
                "scenarioWeight",
                "weightDelta",
                "baselineComponentVariance",
                "scenarioComponentVariance",
                "componentVarianceDelta",
                "baselineAbsoluteRiskShare",
                "scenarioAbsoluteRiskShare",
                "absoluteRiskShareDelta",
            ],
            scenario_contribution_rows,
        )
        _write_csv(
            artifacts / "book-risk-sizing-lookbacks.csv",
            [
                "lookbackBars",
                "observations",
                "annualizedVolatility",
                "annualizedVolatilityDelta",
                "componentRiskHhi",
                "effectiveRiskBets",
                "largestAbsoluteRiskContributor",
                "largestAbsoluteRiskContributorShare",
                "governing",
                "ceilingSatisfied",
            ],
            sizing_lookback_rows,
        )
        _write_csv(
            artifacts / "book-risk-sizing-contributions.csv",
            [
                "asset",
                "baselineWeight",
                "resultingWeight",
                "weightDelta",
                "componentVariance",
                "signedRiskShare",
                "absoluteRiskShare",
            ],
            sizing_contribution_rows,
        )
        metrics = {
            "current_component_risk_hhi": float(
                primary["componentRiskHhi"]
            ),
            "current_effective_risk_bets": float(
                primary["effectiveRiskBets"]
            ),
            "current_annualized_volatility": float(
                primary["annualizedVolatility"]
            ),
            "current_first_pc_variance_share": float(
                primary["firstPrincipalComponentVarianceShare"]
            ),
            "current_maximum_drawdown": float(
                primary_drawdown["summary"]["maximumDrawdown"]
            ),
            "largest_risk_contributor_share": float(
                primary["largestAbsoluteRiskContributorShare"]
            ),
            "primary_lookback_bars": primary_lookback,
            "held_assets": len(weights),
            "scenario_count": len(scenario_results),
            "sizing_requested": float(sizing_policy is not None),
            "sizing_feasible": float(
                position_sizing["status"]
                in {
                    "sized",
                    "unchanged-compliant",
                    "fully-funded-compliant",
                    "maximum-weight-compliant",
                }
            ),
            "sizing_weight_change": float(
                position_sizing.get("result", {}).get(
                    "weightChange",
                    0.0,
                )
            ),
        }
        primary_scenario_order = sorted(
            scenario_results,
            key=lambda item: next(
                row["volatilityRank"]
                for row in item["lookbacks"]
                if row["lookbackBars"] == primary_lookback
            ),
        )
        _write_output(
            {
                "schema_version": 1,
                "status": "succeeded",
                "summary": (
                    "Reported book covariance audit; effective risk bets="
                    f"{metrics['current_effective_risk_bets']:.3f}; "
                    "maximum drawdown="
                    f"{metrics['current_maximum_drawdown']:.3f}; "
                    f"first standardized reduction={reductions[0]['asset']}; "
                    f"supplied scenarios={len(scenario_results)}"
                    + (
                        "; lowest primary-window volatility scenario="
                        f"{primary_scenario_order[0]['id']}"
                        if primary_scenario_order
                        else ""
                    )
                    + (
                        "; bounded sizing="
                        f"{position_sizing['status']}"
                        if sizing_policy is not None
                        else ""
                    )
                ),
                "metrics": metrics,
                "artifacts": [
                    {
                        "kind": "book-risk-report",
                        "path": "book-risk-report.json",
                        "description": (
                            "Verified reported-book covariance, drawdown, "
                            "crowding, contribution, and reduction evidence"
                        ),
                    },
                    {
                        "kind": "book-risk-sizing-lookbacks",
                        "path": "book-risk-sizing-lookbacks.csv",
                        "description": (
                            "Fixed resulting-book evidence across declared "
                            "lookbacks"
                        ),
                    },
                    {
                        "kind": "book-risk-sizing-contributions",
                        "path": "book-risk-sizing-contributions.csv",
                        "description": (
                            "Governing-window resulting-book contribution "
                            "ledger"
                        ),
                    },
                    {
                        "kind": "book-risk-contributions",
                        "path": "book-risk-contributions.csv",
                        "description": "Per-asset component-risk ledger",
                    },
                    {
                        "kind": "book-risk-reductions",
                        "path": "book-risk-reductions.csv",
                        "description": (
                            "Standardized cash-funded reduction sensitivities"
                        ),
                    },
                    {
                        "kind": "book-risk-correlations",
                        "path": "book-risk-correlations.csv",
                        "description": "Primary-window held-asset correlations",
                    },
                    {
                        "kind": "book-risk-path",
                        "path": "book-risk-path.csv",
                        "description": "Sampled rolling primary-window risk path",
                    },
                    {
                        "kind": "book-risk-equity-path",
                        "path": "book-risk-equity-path.csv",
                        "description": (
                            "Primary-window static-weight return, NAV, and "
                            "drawdown path"
                        ),
                    },
                    {
                        "kind": "book-risk-scenario-comparisons",
                        "path": "book-risk-scenario-comparisons.csv",
                        "description": (
                            "Caller-specified funded-book lookback comparisons"
                        ),
                    },
                    {
                        "kind": "book-risk-scenario-contributions",
                        "path": "book-risk-scenario-contributions.csv",
                        "description": (
                            "Primary-window per-asset scenario contribution "
                            "changes"
                        ),
                    },
                ],
                "errors": [],
            }
        )
    except JudgeFailure as error:
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "summary": str(error),
                "metrics": {},
                "artifacts": [],
                "errors": [{"code": error.code, "message": str(error)}],
            }
        )
    except Exception as error:
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "summary": f"Book-risk evaluation raised {type(error).__name__}",
                "metrics": {},
                "artifacts": [],
                "errors": [
                    {
                        "code": "book-risk.exception",
                        "message": f"{type(error).__name__}: {error}",
                    }
                ],
            }
        )


if __name__ == "__main__":
    main()
