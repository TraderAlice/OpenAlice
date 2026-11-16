"""Fixed portfolio-native equal-risk-contribution allocation Study."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from autoquant.allocation_policies import (
    ALLOCATION_POLICY,
    load_allocation_contract,
)
from autoquant.intervals import (
    IntervalContractError,
    annualization_periods,
    load_multi_interval_asset,
    timestamp_label,
)
from judges.allocation_core import (
    AllocationFailure,
    construct_erc_targets,
    fixed_reference_targets,
    risk_contribution_shares,
    runtime_mandate,
)
from judges.portfolio_core import (
    PortfolioFailure,
    build_risk_covariance_cache,
    decision_schedule_mask,
    drift_weights,
    execute_risk_compliant_book,
    performance_metrics,
    simulate_targets,
)


REPORT_KIND = "autoquant-allocation-report"
REQUIRED_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")


class JudgeFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _write_output(value: dict[str, Any]) -> None:
    Path(os.environ["AUTOQUANT_RUN_OUTPUT"]).write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _study() -> tuple[dict[str, Any], Path, Path]:
    study_path = Path(os.environ["AUTOQUANT_STUDY_PATH"])
    try:
        study = json.loads(study_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise JudgeFailure("study.contract", f"Cannot read fixed Study: {error}") from error
    return (
        study,
        Path(os.environ["AUTOQUANT_PROJECT_ROOT"]).resolve(),
        Path(os.environ["AUTOQUANT_DATA_ROOT"]).resolve(),
    )


def _load_asset(
    data_root: Path,
    asset: str,
    start: str,
    end: str,
) -> pd.DataFrame:
    try:
        multi = load_multi_interval_asset(
            data_root,
            asset,
            start=start,
            end=end,
        )
    except IntervalContractError as error:
        raise JudgeFailure(error.code, str(error)) from error
    if multi is not None:
        frame = multi.loc[:, list(REQUIRED_COLUMNS)].copy()
    else:
        source = (data_root / "ohlcv" / f"{asset}.csv").resolve()
        if data_root not in source.parents or not source.is_file():
            raise JudgeFailure("dataset.asset", f"Missing confined OHLCV for {asset}")
        frame = pd.read_csv(source)
        if tuple(frame.columns) != REQUIRED_COLUMNS:
            raise JudgeFailure(
                "dataset.columns",
                f"{asset} columns must be exactly {', '.join(REQUIRED_COLUMNS)}",
            )
        frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="raise")
        frame = frame[
            (frame["timestamp"] >= pd.Timestamp(start))
            & (frame["timestamp"] <= pd.Timestamp(end))
        ].copy()
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="raise")
    for column in REQUIRED_COLUMNS[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    numeric = frame.loc[:, REQUIRED_COLUMNS[1:]].to_numpy(dtype=float)
    if (
        frame.empty
        or frame["timestamp"].duplicated().any()
        or not frame["timestamp"].is_monotonic_increasing
        or not np.isfinite(numeric).all()
        or (numeric <= 0).any()
    ):
        raise JudgeFailure("dataset.asset", f"{asset} OHLCV is invalid")
    return frame.reset_index(drop=True)


def _split_indices(index: pd.DatetimeIndex) -> tuple[dict[str, pd.Index], dict[str, Any]]:
    count = len(index)
    train_end = int(count * 0.60)
    validation_end = int(count * 0.80)
    if train_end < 20 or validation_end - train_end < 20 or count - validation_end < 20:
        raise JudgeFailure("allocation.population", "Chronological splits need 20 rows each")
    splits = {
        "train": index[:train_end],
        "validation": index[train_end:validation_end],
        "test": index[validation_end:],
    }
    return splits, {
        "method": "chronological-60-20-20-v1",
        "selectionSplit": "validation",
        "testRole": "visible-audit-only",
        "splits": {
            name: {
                "start": timestamp_label(values[0]),
                "end": timestamp_label(values[-1]),
                "observations": len(values),
            }
            for name, values in splits.items()
        },
    }


def _portfolio_metrics(
    candidate: pd.Series,
    reference: pd.Series,
    *,
    periods: int,
) -> dict[str, Any]:
    candidate_metrics = performance_metrics(
        candidate,
        reference,
        annual_periods=periods,
    )
    reference_metrics = performance_metrics(
        reference,
        pd.Series(0.0, index=reference.index),
        annual_periods=periods,
    )
    excess = candidate - reference
    excess_std = float(excess.std(ddof=0))
    information_ratio = (
        float(excess.mean() / excess_std * math.sqrt(periods))
        if excess_std > 1e-12
        else 0.0
    )
    return {
        "candidate": candidate_metrics,
        "reference": reference_metrics,
        "comparison": {
            "netSharpeAdvantage": float(
                candidate_metrics["sharpe"] - reference_metrics["sharpe"]
            ),
            "annualReturnAdvantage": float(
                candidate_metrics["annual_return"]
                - reference_metrics["annual_return"]
            ),
            "annualVolatilityDifference": float(
                candidate_metrics["annual_volatility"]
                - reference_metrics["annual_volatility"]
            ),
            "maximumDrawdownDifference": float(
                candidate_metrics["maximum_drawdown"]
                - reference_metrics["maximum_drawdown"]
            ),
            "informationRatio": information_ratio,
        },
    }


def _construction_fidelity(
    solver_ledger: pd.DataFrame,
    split_protocol: dict[str, Any],
    *,
    tolerance: float,
) -> dict[str, Any]:
    by_split: dict[str, Any] = {}
    for name, split in split_protocol["splits"].items():
        selected = solver_ledger[
            (solver_ledger["timestamp"] >= pd.Timestamp(split["start"]))
            & (solver_ledger["timestamp"] <= pd.Timestamp(split["end"]))
        ].sort_values("timestamp")
        eligible = selected[
            selected["status"] != "insufficient-history"
        ]
        within = int(
            (eligible["status"] == "within-tolerance").sum()
        )
        latest = None
        if not eligible.empty:
            row = eligible.iloc[-1]
            latest = {
                "asOf": timestamp_label(row["timestamp"]),
                "status": str(row["status"]),
                "solverConverged": bool(row["converged"]),
                "withinTolerance": bool(
                    row["status"] == "within-tolerance"
                ),
                "maximumContributionError": float(
                    row["maximum_contribution_error"]
                ),
                "capBindingAssets": (
                    str(row["cap_binding_assets"]).split(",")
                    if str(row["cap_binding_assets"])
                    else []
                ),
            }
        by_split[name] = {
            "scheduledDecisions": int(len(selected)),
            "eligibleDecisions": int(len(eligible)),
            "withinToleranceDecisions": within,
            "capInducedParityGapDecisions": int(
                (
                    eligible["status"]
                    == "cap-induced-parity-gap"
                ).sum()
            ),
            "withinToleranceRate": (
                float(within / len(eligible))
                if len(eligible)
                else None
            ),
            "maximumContributionError": (
                float(
                    eligible["maximum_contribution_error"].max()
                )
                if len(eligible)
                else None
            ),
            "latestEligibleDecision": latest,
        }
    return {
        "kind": "erc-contribution-tolerance-by-split",
        "tolerance": float(tolerance),
        "selectionSplit": split_protocol["selectionSplit"],
        "testRole": split_protocol["testRole"],
        "performanceConclusionIndependent": True,
        "bySplit": by_split,
    }


def _evaluate() -> tuple[
    dict[str, Any],
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
]:
    study, project_root, data_root = _study()
    contract = load_allocation_contract(project_root / ALLOCATION_POLICY)
    dataset = study["dataset"]
    universe = list(dataset["universe"])
    if universe != contract["universe"]:
        raise JudgeFailure(
            "allocation.universe",
            "Allocation contract differs from the fixed Study universe",
        )
    closes: dict[str, pd.Series] = {}
    volumes: dict[str, pd.Series] = {}
    for asset in universe:
        frame = _load_asset(
            data_root,
            asset,
            dataset["time_range"]["start"],
            dataset["time_range"]["end"],
        )
        timestamp = pd.DatetimeIndex(frame["timestamp"])
        closes[asset] = pd.Series(
            frame["close"].to_numpy(dtype=float),
            index=timestamp,
        )
        volumes[asset] = pd.Series(
            frame["volume"].to_numpy(dtype=float),
            index=timestamp,
        )
    close_panel = pd.DataFrame(closes).dropna(how="any")
    volume_panel = pd.DataFrame(volumes).reindex(close_panel.index)
    if volume_panel.isna().any().any() or len(close_panel) < 120:
        raise JudgeFailure(
            "allocation.panel",
            "Allocation requires an aligned complete OHLCV panel",
        )
    periods = annualization_periods(close_panel.index)
    if periods != contract["annualizationPeriods"]:
        raise JudgeFailure(
            "allocation.annualization",
            "Allocation contract annualization differs from the data clock",
        )
    candidate_mandate = runtime_mandate(contract, reference=False)
    reference_mandate = runtime_mandate(contract, reference=True)
    decision_policy = candidate_mandate["implementationPolicy"]["decisionPolicy"]
    decision_mask = decision_schedule_mask(close_panel.index, decision_policy)
    raw_targets, solver_ledger = construct_erc_targets(
        close_panel,
        contract,
        decision_mask,
    )
    reference_targets = fixed_reference_targets(
        close_panel.index,
        universe,
        contract["benchmark"],
        decision_mask,
    )
    candidate_cache = build_risk_covariance_cache(
        close_panel,
        mandate=candidate_mandate,
    )
    reference_cache = build_risk_covariance_cache(
        close_panel,
        mandate=reference_mandate,
    )
    candidate = simulate_targets(
        raw_targets,
        close_panel,
        volume_panel,
        mandate=candidate_mandate,
        risk_covariance_cache=candidate_cache,
    )
    reference = simulate_targets(
        reference_targets,
        close_panel,
        volume_panel,
        mandate=reference_mandate,
        risk_covariance_cache=reference_cache,
    )
    common = candidate.daily.index.intersection(reference.daily.index)
    if not candidate.daily.index.equals(reference.daily.index):
        raise JudgeFailure(
            "allocation.accounting-alignment",
            "Candidate and reference accounting clocks differ",
        )
    splits, split_protocol = _split_indices(pd.DatetimeIndex(common))
    split_metrics = {
        name: _portfolio_metrics(
            candidate.daily.loc[index, "net_return"],
            reference.daily.loc[index, "net_return"],
            periods=periods,
        )
        for name, index in splits.items()
    }
    validation_advantage = float(
        split_metrics["validation"]["comparison"]["netSharpeAdvantage"]
    )
    conclusion_status = "supported" if validation_advantage > 0 else "rejected"
    conclusion = {
        "status": conclusion_status,
        "scope": "relative-performance-only",
        "selectionBasis": "validation-net-sharpe-advantage",
        "validationNetSharpeAdvantage": validation_advantage,
        "testUsedForSelection": False,
        "statement": (
            "The fixed ERC construction outperformed the fixed weighted "
            "reference on validation net Sharpe."
            if conclusion_status == "supported"
            else "The fixed ERC construction did not outperform the fixed "
            "weighted reference on validation net Sharpe."
        ),
        "tradingAuthority": "none",
    }
    daily = pd.DataFrame(
        {
            "candidate_gross_return": candidate.daily["gross_return"],
            "candidate_net_return": candidate.daily["net_return"],
            "candidate_cost": candidate.daily["cost"],
            "candidate_one_way_turnover": candidate.daily["one_way_turnover"],
            "candidate_gross_exposure": candidate.daily["gross_exposure"],
            "candidate_cash_weight": candidate.daily["cash_weight"],
            "candidate_forecast_volatility": candidate.daily[
                "executed_risk_forecast_annualized"
            ],
            "candidate_risk_status": candidate.daily["execution_risk_status"],
            "reference_gross_return": reference.daily["gross_return"],
            "reference_net_return": reference.daily["net_return"],
            "reference_cost": reference.daily["cost"],
            "reference_one_way_turnover": reference.daily["one_way_turnover"],
            "reference_gross_exposure": reference.daily["gross_exposure"],
        },
        index=common,
    )
    daily["excess_net_return"] = (
        daily["candidate_net_return"] - daily["reference_net_return"]
    )
    solver_by_timestamp = (
        solver_ledger.set_index("timestamp")
        if not solver_ledger.empty
        else pd.DataFrame()
    )
    close_returns = close_panel.pct_change(fill_method=None)
    decision_rows: list[dict[str, Any]] = []
    for timestamp in close_panel.index[decision_mask]:
        solver = (
            solver_by_timestamp.loc[timestamp]
            if not solver_by_timestamp.empty and timestamp in solver_by_timestamp.index
            else None
        )
        history = (
            close_returns.loc[:timestamp, contract["tradableAssets"]]
            .tail(int(contract["method"]["covarianceWindow"]))
            .dropna(how="any")
        )
        covariance = (
            history.cov(ddof=0)
            if len(history) >= int(contract["method"]["minimumObservations"])
            else None
        )
        executed = candidate.weights.loc[timestamp]
        executed_tradable = executed.loc[contract["tradableAssets"]]
        executed_shares = (
            risk_contribution_shares(executed_tradable, covariance)
            if covariance is not None
            else pd.Series(0.0, index=contract["tradableAssets"])
        )
        target_shares = (
            risk_contribution_shares(
                raw_targets.loc[timestamp, contract["tradableAssets"]],
                covariance,
            )
            if covariance is not None
            else pd.Series(0.0, index=contract["tradableAssets"])
        )
        for asset in universe:
            decision_rows.append(
                {
                    "timestamp": timestamp,
                    "asset": asset,
                    "decision_eligible": True,
                    "solver_status": (
                        str(solver["status"])
                        if solver is not None
                        else "missing"
                    ),
                    "solver_observations": (
                        int(solver["observations"]) if solver is not None else 0
                    ),
                    "solver_converged": (
                        bool(solver["converged"]) if solver is not None else False
                    ),
                    "maximum_contribution_error": (
                        float(solver["maximum_contribution_error"])
                        if solver is not None
                        else 0.0
                    ),
                    "cap_binding_assets": (
                        str(solver["cap_binding_assets"])
                        if solver is not None
                        else ""
                    ),
                    "raw_target_weight": float(raw_targets.loc[timestamp, asset]),
                    "executed_weight": float(executed.loc[asset]),
                    "reference_executed_weight": float(
                        reference.weights.loc[timestamp, asset]
                    ),
                    "target_risk_contribution_share": float(
                        target_shares.get(asset, 0.0)
                    ),
                    "executed_risk_contribution_share": float(
                        executed_shares.get(asset, 0.0)
                    ),
                    "trade_weight": float(candidate.trades.loc[timestamp, asset]),
                    "reference_trade_weight": float(
                        reference.trades.loc[timestamp, asset]
                    ),
                }
            )
    decisions = pd.DataFrame(decision_rows)
    eligible_solver = solver_ledger[
        solver_ledger["status"] != "insufficient-history"
    ]
    construction_fidelity = _construction_fidelity(
        solver_ledger,
        split_protocol,
        tolerance=float(contract["method"]["contributionTolerance"]),
    )
    latest_timestamp = eligible_solver["timestamp"].max()
    latest_decisions = decisions[decisions["timestamp"] == latest_timestamp]
    latest = {
        "asOf": timestamp_label(latest_timestamp),
        "status": str(eligible_solver.iloc[-1]["status"]),
        "solverConverged": bool(eligible_solver.iloc[-1]["converged"]),
        "maximumContributionError": float(
            eligible_solver.iloc[-1]["maximum_contribution_error"]
        ),
        "targetWeights": {
            row["asset"]: float(row["raw_target_weight"])
            for _, row in latest_decisions.iterrows()
        },
        "executedWeights": {
            row["asset"]: float(row["executed_weight"])
            for _, row in latest_decisions.iterrows()
        },
        "referenceWeights": {
            row["asset"]: float(row["reference_executed_weight"])
            for _, row in latest_decisions.iterrows()
        },
        "targetRiskContributionShares": {
            row["asset"]: float(row["target_risk_contribution_share"])
            for _, row in latest_decisions.iterrows()
        },
        "forecastAnnualizedVolatility": float(
            candidate.daily.loc[
                latest_timestamp,
                "executed_risk_forecast_annualized",
            ]
        ),
        "mechanicalResearchTargetOnly": True,
        "tradingAuthority": "none",
    }
    current_timestamp = close_panel.index[-1]
    if current_timestamp in candidate.weights.index:
        candidate_pretrade = candidate.weights.loc[current_timestamp]
        reference_pretrade = reference.weights.loc[current_timestamp]
    else:
        prior_timestamp = candidate.weights.index[-1]
        if prior_timestamp >= current_timestamp:
            raise JudgeFailure(
                "allocation.current-state",
                "Current allocation clock cannot be reconciled",
            )
        candidate_pretrade = drift_weights(
            candidate.weights.loc[prior_timestamp],
            close_returns.loc[current_timestamp],
        )
        reference_pretrade = drift_weights(
            reference.weights.loc[prior_timestamp],
            close_returns.loc[current_timestamp],
        )
    current_due = bool(decision_mask.loc[current_timestamp])
    current_candidate, current_candidate_risk = execute_risk_compliant_book(
        candidate_pretrade,
        raw_targets.loc[current_timestamp],
        close_returns,
        current_timestamp,
        mandate=candidate_mandate,
        no_trade_one_way=float(
            contract["portfolioPolicy"]["noTradeOneWay"]
        ),
        ordinary_rebalance_allowed=current_due,
        risk_covariance_cache=candidate_cache,
    )
    current_reference, current_reference_risk = execute_risk_compliant_book(
        reference_pretrade,
        reference_targets.loc[current_timestamp],
        close_returns,
        current_timestamp,
        mandate=reference_mandate,
        no_trade_one_way=float(
            contract["portfolioPolicy"]["noTradeOneWay"]
        ),
        ordinary_rebalance_allowed=current_due,
        risk_covariance_cache=reference_cache,
    )
    current_state = {
        "asOf": timestamp_label(current_timestamp),
        "ordinaryRebalanceDue": current_due,
        "scheduledTargetWeights": (
            {
                asset: float(raw_targets.loc[current_timestamp, asset])
                for asset in universe
            }
            if current_due
            else None
        ),
        "candidatePretradeWeights": {
            asset: float(candidate_pretrade.loc[asset])
            for asset in universe
        },
        "candidateExecutedWeights": {
            asset: float(current_candidate.loc[asset])
            for asset in universe
        },
        "referencePretradeWeights": {
            asset: float(reference_pretrade.loc[asset])
            for asset in universe
        },
        "referenceExecutedWeights": {
            asset: float(current_reference.loc[asset])
            for asset in universe
        },
        "candidateExecutionReason": str(
            current_candidate_risk["execution_reason"]
        ),
        "candidateForecastAnnualizedVolatility": float(
            current_candidate_risk["executed_forecast_annualized"]
        ),
        "referenceExecutionReason": str(
            current_reference_risk["execution_reason"]
        ),
        "mechanicalResearchStateOnly": True,
        "tradingAuthority": "none",
    }
    report = {
        "schemaVersion": 1,
        "kind": REPORT_KIND,
        "inputHash": os.environ["AUTOQUANT_INPUT_HASH"],
        "contract": contract,
        "dataset": {
            "id": dataset["id"],
            "version": dataset["version"],
            "universe": universe,
            "tradableAssets": contract["tradableAssets"],
            "timeRange": dataset["time_range"],
            "observations": len(close_panel),
            "annualizationPeriods": periods,
        },
        "splitProtocol": split_protocol,
        "splits": split_metrics,
        "solver": {
            "scheduledDecisions": int(len(solver_ledger)),
            "eligibleDecisions": int(len(eligible_solver)),
            "withinToleranceDecisions": int(
                (eligible_solver["status"] == "within-tolerance").sum()
            ),
            "capInducedParityGapDecisions": int(
                (eligible_solver["status"] == "cap-induced-parity-gap").sum()
            ),
            "maximumContributionError": float(
                eligible_solver["maximum_contribution_error"].max()
            ),
        },
        "constructionFidelity": construction_fidelity,
        "implementation": {
            name: {
                "candidateTotalCost": float(
                    candidate.daily.loc[index, "cost"].sum()
                ),
                "referenceTotalCost": float(
                    reference.daily.loc[index, "cost"].sum()
                ),
                "candidateAnnualizedOneWayTurnover": float(
                    candidate.daily.loc[index, "one_way_turnover"].mean()
                    * periods
                ),
                "referenceAnnualizedOneWayTurnover": float(
                    reference.daily.loc[index, "one_way_turnover"].mean()
                    * periods
                ),
                "candidateMaximumForecastVolatility": float(
                    candidate.daily.loc[
                        index,
                        "executed_risk_forecast_annualized",
                    ].max()
                ),
                "candidateRiskLimit": float(
                    contract["portfolioPolicy"]["annualizedVolatilityCeiling"]
                ),
                "candidateRiskBreaches": int(
                    (
                        candidate.daily.loc[
                            index,
                            "executed_risk_forecast_annualized",
                        ]
                        > float(
                            contract["portfolioPolicy"][
                                "annualizedVolatilityCeiling"
                            ]
                        )
                        + 1e-10
                    ).sum()
                ),
            }
            for name, index in splits.items()
        },
        "latestDecision": latest,
        "currentState": current_state,
        "conclusion": conclusion,
    }
    return (
        report,
        daily,
        raw_targets,
        candidate.weights,
        reference.weights,
        decisions,
    )


def main() -> None:
    try:
        report, daily, targets, weights, reference_weights, decisions = _evaluate()
        artifacts = Path(os.environ["AUTOQUANT_ARTIFACTS_DIR"]).resolve()
        artifacts.mkdir(parents=True, exist_ok=True)
        (artifacts / "allocation-report.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        for frame, filename in (
            (daily, "allocation-daily.csv"),
            (targets, "allocation-target-weights.csv"),
            (weights, "allocation-executed-weights.csv"),
            (reference_weights, "allocation-reference-weights.csv"),
        ):
            output = frame.copy()
            output.index = [timestamp_label(value) for value in output.index]
            output.index.name = "timestamp"
            output.to_csv(artifacts / filename, float_format="%.17g")
        decision_output = decisions.copy()
        decision_output["timestamp"] = decision_output["timestamp"].map(
            timestamp_label
        )
        decision_output.to_csv(
            artifacts / "allocation-decisions.csv",
            index=False,
            float_format="%.17g",
        )
        validation_advantage = float(
            report["splits"]["validation"]["comparison"][
                "netSharpeAdvantage"
            ]
        )
        validation_fidelity = report["constructionFidelity"]["bySplit"][
            "validation"
        ]
        validation_rate = validation_fidelity["withinToleranceRate"]
        validation_rate_label = (
            f"{validation_rate:.3f}"
            if validation_rate is not None
            else "unavailable"
        )
        _write_output(
            {
                "schema_version": 1,
                "status": "succeeded",
                "summary": (
                    "Fixed ERC allocation evaluated against the same-clock "
                    "fixed-weight reference; validation net Sharpe advantage="
                    f"{validation_advantage:.6f}; validation ERC "
                    "within-tolerance="
                    f"{validation_fidelity['withinToleranceDecisions']}/"
                    f"{validation_fidelity['eligibleDecisions']} "
                    f"({validation_rate_label}); performance conclusion is "
                    "relative-performance-only"
                ),
                "metrics": {
                    "validation_net_sharpe_advantage": validation_advantage,
                    "conclusion": report["conclusion"],
                    "construction_fidelity": report[
                        "constructionFidelity"
                    ],
                    "latest_decision": report["latestDecision"],
                    "current_state": report["currentState"],
                    "solver": report["solver"],
                    "splits": report["splits"],
                    "implementation": report["implementation"],
                },
                "artifacts": [
                    {
                        "kind": "allocation-report",
                        "path": "allocation-report.json",
                        "description": "Fixed contract, splits, comparison, solver, risk, and latest decision evidence",
                    },
                    {
                        "kind": "allocation-daily",
                        "path": "allocation-daily.csv",
                        "description": "Same-clock candidate and reference return, cost, turnover, and risk path",
                    },
                    {
                        "kind": "allocation-targets",
                        "path": "allocation-target-weights.csv",
                        "description": "Exact scheduled causal ERC targets",
                    },
                    {
                        "kind": "allocation-weights",
                        "path": "allocation-executed-weights.csv",
                        "description": "Post-drift, no-trade, cap, and risk-compliant candidate weights",
                    },
                    {
                        "kind": "allocation-reference-weights",
                        "path": "allocation-reference-weights.csv",
                        "description": "Same-clock drifted and costed fixed-weight reference path",
                    },
                    {
                        "kind": "allocation-decisions",
                        "path": "allocation-decisions.csv",
                        "description": "Scheduled solver, parity, target, executed, trade, and reference evidence",
                    },
                ],
                "errors": [],
            }
        )
    except (JudgeFailure, AllocationFailure, PortfolioFailure) as error:
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "summary": str(error),
                "metrics": {},
                "artifacts": [],
                "errors": [
                    {
                        "code": getattr(error, "code", "allocation.failure"),
                        "message": str(error),
                    }
                ],
            }
        )
    except Exception as error:
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "summary": f"Allocation evaluation raised {type(error).__name__}: {error}",
                "metrics": {},
                "artifacts": [],
                "errors": [
                    {
                        "code": "allocation.exception",
                        "message": f"{type(error).__name__}: {error}",
                    }
                ],
            }
        )


if __name__ == "__main__":
    main()
