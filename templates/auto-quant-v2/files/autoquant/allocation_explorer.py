"""Strict read model for immutable portfolio-native Allocation Runs."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .allocation_policies import load_allocation_contract
from .intake import (
    intake_dataset_class_context,
    load_project_intake,
)
from .project_templates.ohlcv_portfolio_lab.portfolio_core import performance_metrics
from .runs import load_run
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
)


ALLOCATION_DIAGNOSTICS_KIND = "autoquant-allocation-diagnostics"
REPORT_KIND = "autoquant-allocation-report"
DEFAULT_ALLOCATION_POINTS = 180
MIN_ALLOCATION_POINTS = 40
MAX_ALLOCATION_POINTS = 400
ARTIFACTS = {
    "allocation-report": "allocation-report.json",
    "allocation-daily": "allocation-daily.csv",
    "allocation-targets": "allocation-target-weights.csv",
    "allocation-weights": "allocation-executed-weights.csv",
    "allocation-reference-weights": "allocation-reference-weights.csv",
    "allocation-decisions": "allocation-decisions.csv",
}
DAILY_COLUMNS = (
    "candidate_gross_return",
    "candidate_net_return",
    "candidate_cost",
    "candidate_one_way_turnover",
    "candidate_gross_exposure",
    "candidate_cash_weight",
    "candidate_forecast_volatility",
    "candidate_risk_status",
    "reference_gross_return",
    "reference_net_return",
    "reference_cost",
    "reference_one_way_turnover",
    "reference_gross_exposure",
    "excess_net_return",
)


def _fail(path: str | Path, code: str, message: str) -> None:
    raise AutoQuantValidationError(
        [ValidationIssue(str(path), code, message)]
    )


def _object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        _fail(path, "allocation.json", f"Cannot read JSON evidence: {error}")
    if not isinstance(value, dict):
        _fail(path, "allocation.type", "JSON evidence must be an object")
    return value


def _close(left: float, right: float, path: str | Path) -> None:
    if not math.isclose(float(left), float(right), rel_tol=1e-8, abs_tol=1e-11):
        _fail(path, "allocation.reconcile", "Derived evidence does not reconcile")


def _reconcile(actual: Any, expected: Any, path: str) -> None:
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            _fail(path, "allocation.reconcile", "Object does not reconcile")
        for key, value in expected.items():
            _reconcile(actual[key], value, f"{path}/{key}")
    elif isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            _fail(path, "allocation.reconcile", "Array does not reconcile")
        for index, value in enumerate(expected):
            _reconcile(actual[index], value, f"{path}/{index}")
    elif isinstance(expected, float):
        if not isinstance(actual, (int, float)) or isinstance(actual, bool):
            _fail(path, "allocation.number", "Expected one finite number")
        _close(float(actual), expected, path)
    elif actual != expected:
        _fail(path, "allocation.reconcile", "Value does not reconcile")


def _performance(
    candidate: pd.Series,
    reference: pd.Series,
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
            "informationRatio": (
                float(excess.mean() / excess_std * math.sqrt(periods))
                if excess_std > 1e-12
                else 0.0
            ),
        },
    }


def _sample(frame: pd.DataFrame, points: int) -> list[dict[str, Any]]:
    positions = np.unique(
        np.linspace(0, len(frame) - 1, min(points, len(frame)), dtype=int)
    )
    rows: list[dict[str, Any]] = []
    for position in positions:
        timestamp = frame.index[position]
        row = frame.iloc[position]
        rows.append(
            {
                "timestamp": timestamp.date().isoformat(),
                "candidateNetReturn": float(row["candidate_net_return"]),
                "referenceNetReturn": float(row["reference_net_return"]),
                "candidateGrossExposure": float(row["candidate_gross_exposure"]),
                "candidateForecastVolatility": float(
                    row["candidate_forecast_volatility"]
                ),
            }
        )
    return rows


def _construction_fidelity(
    decisions: pd.DataFrame,
    split_protocol: dict[str, Any],
    *,
    tolerance: float,
) -> dict[str, Any]:
    solver_rows = decisions.drop_duplicates("timestamp").sort_values(
        "timestamp"
    )
    by_split: dict[str, Any] = {}
    for name, split in split_protocol["splits"].items():
        selected = solver_rows[
            (solver_rows["timestamp"] >= pd.Timestamp(split["start"]))
            & (solver_rows["timestamp"] <= pd.Timestamp(split["end"]))
        ]
        eligible = selected[
            selected["solver_status"] != "insufficient-history"
        ]
        within = int(
            (eligible["solver_status"] == "within-tolerance").sum()
        )
        latest = None
        if not eligible.empty:
            row = eligible.iloc[-1]
            latest = {
                "asOf": row["timestamp"].date().isoformat(),
                "status": str(row["solver_status"]),
                "solverConverged": bool(row["solver_converged"]),
                "withinTolerance": bool(
                    row["solver_status"] == "within-tolerance"
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
                    eligible["solver_status"]
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
                    pd.to_numeric(
                        eligible["maximum_contribution_error"]
                    ).max()
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


def load_allocation_diagnostics(
    project: ProjectContext,
    run_id: str,
    *,
    points: int = DEFAULT_ALLOCATION_POINTS,
) -> dict[str, Any]:
    """Verify and independently rederive one immutable Allocation result."""

    if not MIN_ALLOCATION_POINTS <= points <= MAX_ALLOCATION_POINTS:
        _fail(points, "allocation.points", "points is outside the supported bound")
    run = load_run(project, run_id)
    if run.result["status"] != "succeeded":
        _fail(run.root_dir, "allocation.run-status", "Allocation Run did not succeed")
    if run.result["study"]["id"] != "ohlcv-risk-parity-allocation":
        _fail(run.root_dir, "allocation.study", "Run is not an Allocation Study")
    declared = {item["kind"]: item["path"] for item in run.result["artifacts"]}
    if set(declared) != set(ARTIFACTS):
        _fail(
            run.root_dir,
            "allocation.artifacts",
            "Allocation artifact inventory differs from the fixed contract",
        )
    paths: dict[str, Path] = {}
    for kind, filename in ARTIFACTS.items():
        expected = f"artifacts/{filename}"
        if declared[kind] != expected:
            _fail(
                run.root_dir / declared[kind],
                "allocation.artifact-path",
                "Allocation artifact path differs from the fixed contract",
            )
        paths[kind] = run.root_dir / expected
    contract = load_allocation_contract(
        run.root_dir
        / "inputs"
        / "dependency-sources"
        / "strategies"
        / "allocation-policy.json"
    )
    report = _object(paths["allocation-report"])
    if (
        report.get("schemaVersion") != SCHEMA_VERSION
        or report.get("kind") != REPORT_KIND
        or report.get("inputHash") != run.result["inputHash"]
        or report.get("contract") != contract
    ):
        _fail(
            paths["allocation-report"],
            "allocation.report",
            "Allocation report identity or frozen contract is invalid",
        )
    intake = load_project_intake(project)
    dataset_class_context = None
    if intake is not None:
        frozen_snapshot_hash = (
            run.result.get("dataset", {})
            .get("sourceHashes", {})
            .get("ohlcv/snapshot.json")
        )
        if (
            frozen_snapshot_hash
            != intake["manifest"]["datasetSnapshotHash"]
        ):
            _fail(
                paths["allocation-report"],
                "allocation.dataset-context",
                "Project intake classes do not belong to this Run dataset",
            )
        dataset_class_context = intake_dataset_class_context(intake)
    try:
        daily = pd.read_csv(
            paths["allocation-daily"],
            parse_dates=["timestamp"],
        ).set_index("timestamp")
        targets = pd.read_csv(
            paths["allocation-targets"],
            parse_dates=["timestamp"],
        ).set_index("timestamp")
        weights = pd.read_csv(
            paths["allocation-weights"],
            parse_dates=["timestamp"],
        ).set_index("timestamp")
        reference_weights = pd.read_csv(
            paths["allocation-reference-weights"],
            parse_dates=["timestamp"],
        ).set_index("timestamp")
        decisions = pd.read_csv(
            paths["allocation-decisions"],
            parse_dates=["timestamp"],
            keep_default_na=False,
        )
    except (OSError, ValueError) as error:
        _fail(paths["allocation-daily"], "allocation.csv", f"Cannot read evidence: {error}")
    universe = contract["universe"]
    if (
        tuple(daily.columns) != DAILY_COLUMNS
        or list(targets.columns) != universe
        or list(weights.columns) != universe
        or list(reference_weights.columns) != universe
        or not daily.index.equals(weights.index)
        or not daily.index.equals(reference_weights.index)
        or len(targets) not in {len(daily), len(daily) + 1}
        or not targets.index[: len(daily)].equals(daily.index)
        or daily.index.duplicated().any()
        or not daily.index.is_monotonic_increasing
    ):
        _fail(
            paths["allocation-daily"],
            "allocation.csv-contract",
            "Allocation path shapes or columns differ from the fixed contract",
        )
    numeric_daily = daily.drop(columns=["candidate_risk_status"]).to_numpy(dtype=float)
    if not np.isfinite(numeric_daily).all():
        _fail(paths["allocation-daily"], "allocation.number", "Daily path is non-finite")
    if not np.allclose(
        daily["excess_net_return"].to_numpy(dtype=float),
        (
            daily["candidate_net_return"]
            - daily["reference_net_return"]
        ).to_numpy(dtype=float),
        rtol=1e-10,
        atol=1e-12,
    ):
        _fail(
            paths["allocation-daily"],
            "allocation.excess",
            "Excess return path does not reconcile",
        )
    for frame, path in (
        (targets, paths["allocation-targets"]),
        (weights, paths["allocation-weights"]),
        (reference_weights, paths["allocation-reference-weights"]),
    ):
        if not np.isfinite(frame.to_numpy(dtype=float)).all():
            _fail(path, "allocation.number", "Weight path is non-finite")
    tradable = set(contract["tradableAssets"])
    caps = {
        asset: float(
            contract["portfolioPolicy"]["assetMaxAbsWeights"].get(
                asset,
                contract["portfolioPolicy"]["maxAbsWeight"],
            )
        )
        for asset in tradable
    }
    if any(
        (weights[asset] < -1e-10).any()
        or (weights[asset] > caps[asset] + 1e-10).any()
        for asset in tradable
    ) or any(
        weights[asset].abs().max() > 1e-10
        for asset in set(universe) - tradable
    ):
        _fail(
            paths["allocation-weights"],
            "allocation.constraints",
            "Executed candidate weights violate role or cap authority",
        )
    if (weights.sum(axis=1) > contract["portfolioPolicy"]["grossLimit"] + 1e-10).any():
        _fail(
            paths["allocation-weights"],
            "allocation.gross",
            "Executed candidate gross exceeds authority",
        )
    periods = int(report["dataset"]["annualizationPeriods"])
    for name, split in report["splitProtocol"]["splits"].items():
        selected = daily.loc[
            pd.Timestamp(split["start"]) : pd.Timestamp(split["end"])
        ]
        if len(selected) != split["observations"]:
            _fail(
                paths["allocation-daily"],
                "allocation.split",
                f"{name} split population does not reconcile",
            )
        derived = _performance(
            selected["candidate_net_return"],
            selected["reference_net_return"],
            periods,
        )
        _reconcile(report["splits"][name], derived, f"report/splits/{name}")
        implementation = {
            "candidateTotalCost": float(selected["candidate_cost"].sum()),
            "referenceTotalCost": float(selected["reference_cost"].sum()),
            "candidateAnnualizedOneWayTurnover": float(
                selected["candidate_one_way_turnover"].mean() * periods
            ),
            "referenceAnnualizedOneWayTurnover": float(
                selected["reference_one_way_turnover"].mean() * periods
            ),
            "candidateMaximumForecastVolatility": float(
                selected["candidate_forecast_volatility"].max()
            ),
            "candidateRiskLimit": float(
                contract["portfolioPolicy"]["annualizedVolatilityCeiling"]
            ),
            "candidateRiskBreaches": int(
                (
                    selected["candidate_forecast_volatility"]
                    > float(
                        contract["portfolioPolicy"]["annualizedVolatilityCeiling"]
                    )
                    + 1e-10
                ).sum()
            ),
        }
        _reconcile(
            report["implementation"][name],
            implementation,
            f"report/implementation/{name}",
        )
    expected_decision_columns = {
        "timestamp",
        "asset",
        "decision_eligible",
        "solver_status",
        "solver_observations",
        "solver_converged",
        "maximum_contribution_error",
        "cap_binding_assets",
        "raw_target_weight",
        "executed_weight",
        "reference_executed_weight",
        "target_risk_contribution_share",
        "executed_risk_contribution_share",
        "trade_weight",
        "reference_trade_weight",
    }
    if (
        set(decisions.columns) != expected_decision_columns
        or decisions.empty
        or decisions.duplicated(["timestamp", "asset"]).any()
        or set(decisions["asset"]) != set(universe)
        or not decisions.groupby("timestamp").size().eq(len(universe)).all()
    ):
        _fail(
            paths["allocation-decisions"],
            "allocation.decisions",
            "Decision ledger differs from the fixed contract",
        )
    solver_metadata = [
        "decision_eligible",
        "solver_status",
        "solver_observations",
        "solver_converged",
        "maximum_contribution_error",
        "cap_binding_assets",
    ]
    if (
        decisions.groupby("timestamp")[solver_metadata]
        .nunique(dropna=False)
        .gt(1)
        .any()
        .any()
    ):
        _fail(
            paths["allocation-decisions"],
            "allocation.decision-solver",
            "Per-asset decision rows disagree on solver evidence",
        )
    solver_rows = decisions.drop_duplicates("timestamp")
    eligible_solver = solver_rows[
        solver_rows["solver_status"] != "insufficient-history"
    ]
    derived_solver = {
        "scheduledDecisions": int(len(solver_rows)),
        "eligibleDecisions": int(len(eligible_solver)),
        "withinToleranceDecisions": int(
            (eligible_solver["solver_status"] == "within-tolerance").sum()
        ),
        "capInducedParityGapDecisions": int(
            (
                eligible_solver["solver_status"]
                == "cap-induced-parity-gap"
            ).sum()
        ),
        "maximumContributionError": float(
            pd.to_numeric(
                eligible_solver["maximum_contribution_error"]
            ).max()
        ),
    }
    _reconcile(report["solver"], derived_solver, "report/solver")
    construction_fidelity = _construction_fidelity(
        decisions,
        report["splitProtocol"],
        tolerance=float(
            contract["method"]["contributionTolerance"]
        ),
    )
    if "constructionFidelity" in report:
        _reconcile(
            report["constructionFidelity"],
            construction_fidelity,
            "report/constructionFidelity",
        )
    latest_timestamp = eligible_solver["timestamp"].max()
    latest_rows = decisions[decisions["timestamp"] == latest_timestamp]
    latest = report["latestDecision"]
    if latest["asOf"] != latest_timestamp.date().isoformat():
        _fail(
            paths["allocation-decisions"],
            "allocation.latest",
            "Latest decision timestamp does not reconcile",
        )
    for report_key, column in (
        ("targetWeights", "raw_target_weight"),
        ("executedWeights", "executed_weight"),
        ("referenceWeights", "reference_executed_weight"),
        ("targetRiskContributionShares", "target_risk_contribution_share"),
    ):
        derived = {
            row["asset"]: float(row[column])
            for _, row in latest_rows.iterrows()
        }
        _reconcile(latest[report_key], derived, f"report/latestDecision/{report_key}")
    latest_solver = eligible_solver[
        eligible_solver["timestamp"] == latest_timestamp
    ].iloc[0]
    raw_contribution_shares = {
        row["asset"]: float(row["target_risk_contribution_share"])
        for _, row in latest_rows.iterrows()
    }
    tradable_contributions = [
        raw_contribution_shares[asset]
        for asset in contract["tradableAssets"]
    ]
    target_share = 1.0 / len(contract["tradableAssets"])
    derived_latest_error = max(
        abs(value - target_share)
        for value in tradable_contributions
    )
    _close(
        latest["maximumContributionError"],
        derived_latest_error,
        "report/latestDecision/maximumContributionError",
    )
    if (
        latest["status"] != latest_solver["solver_status"]
        or bool(latest["solverConverged"])
        != bool(latest_solver["solver_converged"])
        or not math.isclose(
            sum(tradable_contributions),
            1.0,
            rel_tol=0.0,
            abs_tol=1e-8,
        )
    ):
        _fail(
            paths["allocation-decisions"],
            "allocation.latest-risk",
            "Latest risk-contribution evidence does not reconcile",
        )
    _close(
        latest["forecastAnnualizedVolatility"],
        float(daily.loc[latest_timestamp, "candidate_forecast_volatility"]),
        "report/latestDecision/forecastAnnualizedVolatility",
    )
    current = report.get("currentState")
    if (
        not isinstance(current, dict)
        or current.get("asOf") != targets.index[-1].date().isoformat()
        or not isinstance(current.get("ordinaryRebalanceDue"), bool)
        or current.get("mechanicalResearchStateOnly") is not True
        or current.get("tradingAuthority") != "none"
    ):
        _fail(
            paths["allocation-report"],
            "allocation.current-state",
            "Current allocation state is missing or has invalid authority",
        )
    for key in (
        "candidatePretradeWeights",
        "candidateExecutedWeights",
        "referencePretradeWeights",
        "referenceExecutedWeights",
    ):
        values = current.get(key)
        if (
            not isinstance(values, dict)
            or set(values) != set(universe)
            or not all(
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(float(value))
                for value in values.values()
            )
        ):
            _fail(
                paths["allocation-report"],
                "allocation.current-weights",
                f"Current state {key} is invalid",
            )
    scheduled = current.get("scheduledTargetWeights")
    if current["ordinaryRebalanceDue"]:
        expected_scheduled = {
            asset: float(targets.iloc[-1][asset])
            for asset in universe
        }
        _reconcile(
            scheduled,
            expected_scheduled,
            "report/currentState/scheduledTargetWeights",
        )
    elif scheduled is not None:
        _fail(
            paths["allocation-report"],
            "allocation.current-schedule",
            "A hold date cannot publish a scheduled target",
        )
    validation_advantage = float(
        report["splits"]["validation"]["comparison"]["netSharpeAdvantage"]
    )
    expected_status = "supported" if validation_advantage > 0 else "rejected"
    conclusion_scope = report["conclusion"].get("scope")
    if (
        report["conclusion"]["status"] != expected_status
        or report["conclusion"]["testUsedForSelection"] is not False
        or report["conclusion"]["tradingAuthority"] != "none"
        or conclusion_scope not in {None, "relative-performance-only"}
        or (
            "constructionFidelity" in report
            and conclusion_scope != "relative-performance-only"
        )
    ):
        _fail(
            paths["allocation-report"],
            "allocation.conclusion",
            "Conclusion does not follow validation-only authority",
        )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": ALLOCATION_DIAGNOSTICS_KIND,
        "run": {
            "id": run.result["id"],
            "status": run.result["status"],
            "harness": run.result["harness"],
            "inputHash": run.result["inputHash"],
        },
        "contract": contract,
        "dataset": {
            **report["dataset"],
            **(
                dataset_class_context
                if dataset_class_context is not None
                else {}
            ),
        },
        "splitProtocol": report["splitProtocol"],
        "splits": report["splits"],
        "solver": report["solver"],
        "implementation": report["implementation"],
        "latestDecision": report["latestDecision"],
        "currentState": report["currentState"],
        "conclusion": {
            **report["conclusion"],
            "scope": "relative-performance-only",
        },
        "constructionFidelity": construction_fidelity,
        "path": _sample(daily, points),
        "artifacts": {
            kind: {"path": declared[kind]}
            for kind in sorted(declared)
        },
        "verification": {
            "strict": True,
            "accountingReconciled": True,
            "weightsReconciled": True,
            "solverReconciled": True,
            "constructionFidelityReconciled": True,
            "riskContributionsReconciled": True,
            "currentStateReconciled": True,
            "selectionAuthorityReconciled": True,
            "tradingAuthority": "none",
        },
    }

CONSTRUCTION_FIDELITY_SPLIT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "scheduledDecisions",
        "eligibleDecisions",
        "withinToleranceDecisions",
        "capInducedParityGapDecisions",
        "withinToleranceRate",
        "maximumContributionError",
        "latestEligibleDecision",
    ],
    "properties": {
        "scheduledDecisions": {"type": "integer", "minimum": 0},
        "eligibleDecisions": {"type": "integer", "minimum": 0},
        "withinToleranceDecisions": {
            "type": "integer",
            "minimum": 0,
        },
        "capInducedParityGapDecisions": {
            "type": "integer",
            "minimum": 0,
        },
        "withinToleranceRate": {
            "type": ["number", "null"],
            "minimum": 0,
            "maximum": 1,
        },
        "maximumContributionError": {
            "type": ["number", "null"],
            "minimum": 0,
        },
        "latestEligibleDecision": {
            "oneOf": [
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "asOf",
                        "status",
                        "solverConverged",
                        "withinTolerance",
                        "maximumContributionError",
                        "capBindingAssets",
                    ],
                    "properties": {
                        "asOf": {
                            "type": "string",
                            "format": "date",
                        },
                        "status": {
                            "enum": [
                                "within-tolerance",
                                "cap-induced-parity-gap",
                            ]
                        },
                        "solverConverged": {"type": "boolean"},
                        "withinTolerance": {"type": "boolean"},
                        "maximumContributionError": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "capBindingAssets": {
                            "type": "array",
                            "uniqueItems": True,
                            "items": {
                                "type": "string",
                                "minLength": 1,
                            },
                        },
                    },
                },
                {"type": "null"},
            ]
        },
    },
}

CONSTRUCTION_FIDELITY_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "kind",
        "tolerance",
        "selectionSplit",
        "testRole",
        "performanceConclusionIndependent",
        "bySplit",
    ],
    "properties": {
        "kind": {"const": "erc-contribution-tolerance-by-split"},
        "tolerance": {"type": "number", "exclusiveMinimum": 0},
        "selectionSplit": {"const": "validation"},
        "testRole": {"const": "visible-audit-only"},
        "performanceConclusionIndependent": {"const": True},
        "bySplit": {
            "type": "object",
            "additionalProperties": False,
            "required": ["train", "validation", "test"],
            "properties": {
                name: CONSTRUCTION_FIDELITY_SPLIT_JSON_SCHEMA
                for name in ("train", "validation", "test")
            },
        },
    },
}


ALLOCATION_DIAGNOSTICS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Allocation Diagnostics",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "run",
        "contract",
        "dataset",
        "splitProtocol",
        "splits",
        "solver",
        "constructionFidelity",
        "implementation",
        "latestDecision",
        "currentState",
        "conclusion",
        "path",
        "artifacts",
        "verification",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": ALLOCATION_DIAGNOSTICS_KIND},
        "run": {"type": "object"},
        "contract": {"type": "object"},
        "dataset": {"type": "object"},
        "splitProtocol": {"type": "object"},
        "splits": {"type": "object"},
        "solver": {"type": "object"},
        "constructionFidelity": CONSTRUCTION_FIDELITY_JSON_SCHEMA,
        "implementation": {"type": "object"},
        "latestDecision": {"type": "object"},
        "currentState": {"type": "object"},
        "conclusion": {"type": "object"},
        "path": {"type": "array"},
        "artifacts": {"type": "object"},
        "verification": {
            "type": "object",
            "required": ["constructionFidelityReconciled"],
            "properties": {
                "constructionFidelityReconciled": {"const": True},
            },
        },
    },
}
