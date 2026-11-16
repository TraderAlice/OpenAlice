"""Bounded, verified diagnostics for immutable governed RL Runs."""

from __future__ import annotations

import csv
import json
import math
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any

from .factor_claims import FACTOR_CLAIM, validate_factor_claim
from .horizons import (
    RESEARCH_HORIZON,
    RESEARCH_HORIZON_JSON_SCHEMA,
    validate_research_horizon,
)
from .intervals import annualization_periods, timestamp_label
from .mandates import (
    PORTFOLIO_MANDATE,
    validate_portfolio_mandate,
)
from .prediction_modes import (
    FACTOR_POPULATION,
    PredictionModeError,
    signal_translation_contract,
    validate_population_mandate_compatibility,
    validate_prediction_population_metrics,
)
from .runs import RunContext, load_run
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


RL_DIAGNOSTICS_KIND = "autoquant-rl-policy-diagnostics"
DEFAULT_RL_POINTS = 180
MIN_RL_POINTS = 40
MAX_RL_POINTS = 400
MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
MAX_ACTION_ROWS = 1_000_000
BASE_ARTIFACT_KINDS = {
    "rl-report",
    "policy-models",
    "training-history",
    "policy-actions",
}
POLICY_RATIONALE_ARTIFACT_KIND = "policy-rationales"
POLICY_OPPORTUNITY_ARTIFACT_KIND = "policy-opportunities"
POLICY_INCREMENTAL_ATTRIBUTION_ARTIFACT_KIND = (
    "policy-incremental-attribution"
)
EXPECTED_ARTIFACT_KINDS = BASE_ARTIFACT_KINDS | {
    POLICY_RATIONALE_ARTIFACT_KIND,
    POLICY_OPPORTUNITY_ARTIFACT_KIND,
    POLICY_INCREMENTAL_ATTRIBUTION_ARTIFACT_KIND,
}
FACTOR_OPPORTUNITY_METHOD = (
    "actual-pretrade-one-step-governed-action-audit-v1"
)
FACTOR_OPPORTUNITY_POLICY = {
    "method": FACTOR_OPPORTUNITY_METHOD,
    "path_propagation": "selected-policy-only",
    "oracle_role": "ex-post-audit-upper-bound",
    "selection_authority": "context-only",
    "trading_authority": "none",
}
def _factor_opportunity_reward(cost_bps: float) -> str:
    return (
        f"net-return-after-{cost_bps:g}bps-cost-minus-"
        "0.10-times-gross-return-squared"
    )
INCREMENTAL_ATTRIBUTION_POLICY = {
    "method": "selected-baseline-full-path-active-attribution-v1",
    "comparison_path": "independent-full-rollouts",
    "baseline_selection": "validation-only-per-fold",
    "test_role": "visible-diagnostic",
    "selection_authority": "context-only",
    "trading_authority": "none",
}
FACTOR_FUSION_DIAGNOSIS_METHOD = (
    "candidate-opportunity-adaptive-transmission-stability-diagnosis-v1"
)
LEARNING_CONTRACT = {
    "method": "fixed-after-train-only-blocked-stability-audit-v1",
    "development_selection_scope": (
        "reference-fixture-outer-train-only-70/30-blocked"
    ),
    "candidate_configurations": 5,
    "selection_order": [
        "maximize-minimum-seed-advantage-vs-contextual-ridge",
        "maximize-mean-seed-advantage-vs-contextual-ridge",
        "minimize-within-fold-seed-dispersion",
        "minimize-pairwise-action-mismatch",
    ],
    "runtime_policy": "harness-fixed-before-study-validation",
    "validation_role": "post-freeze-selection-evidence",
    "test_role": "visible-diagnostic",
    "trading_authority": "none",
}
ACTION_COLUMNS = [
    "fold",
    "seed",
    "split",
    "timestamp",
    "action",
    "decision_eligible",
    "decision_schedule_kind",
    "decision_every_bars",
    "decision_anchor",
    "decision_session",
    "reward",
    "gross_return",
    "net_return",
    "one_way_turnover",
    "cost",
]
ACTION_EXECUTION_RISK_COLUMNS = [
    "execution_risk_status",
    "execution_risk_forecast_available",
    "execution_risk_observations",
    "pretrade_risk_forecast_annualized",
    "executed_risk_forecast_annualized",
    "execution_risk_ceiling_annualized",
    "risk_rebalance_override",
    "execution_reason",
    "gross_exposure",
    "proposed_one_way_turnover",
]
ACTION_EXECUTION_CONSTRAINT_COLUMNS = [
    "constraint_rebalance_override",
    "constraint_repair_one_way",
    "executed_constraint_maximum_error",
]
SPLITS = ("validation", "test")


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _fail(path: Path | str, code: str, message: str) -> None:
    raise AutoQuantValidationError([_issue(path, code, message)])


def _finite(value: Any, path: Path | str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        _fail(path, "rl.number", "Expected a finite numeric value")
    if not math.isfinite(number):
        _fail(path, "rl.number", "Expected a finite numeric value")
    return number


def _csv_nonnegative_integer(value: Any, path: Path | str) -> int:
    number = _finite(value, path)
    if number < 0 or not number.is_integer():
        _fail(path, "rl.integer", "Expected a non-negative integer")
    return int(number)


def _integer(value: Any, path: Path | str, *, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        _fail(path, "rl.integer", f"Expected an integer >= {minimum}")
    return value


def _session_date(value: Any, path: Path | str) -> str:
    if not isinstance(value, str):
        _fail(
            path,
            "rl.timestamp",
            "Timestamp must be an ISO date or UTC date-time",
        )
    try:
        normalized = timestamp_label(value)
    except (TypeError, ValueError):
        _fail(
            path,
            "rl.timestamp",
            "Timestamp must be an ISO date or UTC date-time",
        )
    if normalized != value:
        _fail(
            path,
            "rl.timestamp",
            "Timestamp must be a canonical ISO date or UTC date-time",
        )
    return value


def _close(
    actual: Any,
    expected: Any,
    path: Path | str,
    label: str,
    *,
    tolerance: float = 1e-9,
) -> None:
    actual_number = _finite(actual, path)
    expected_number = _finite(expected, path)
    if not math.isclose(
        actual_number,
        expected_number,
        rel_tol=tolerance,
        abs_tol=tolerance,
    ):
        _fail(path, "rl.reconciliation", f"Artifact does not reconcile {label}")


def _artifact_paths(
    run: RunContext,
) -> tuple[dict[str, Path], dict[str, dict[str, str]]]:
    if run.result["status"] != "succeeded":
        _fail(
            run.root_dir,
            "rl.run-status",
            "RL diagnostics require a successful immutable Run",
        )
    artifacts = run.result.get("artifacts")
    if not isinstance(artifacts, list):
        _fail(run.root_dir, "rl.artifacts", "Run artifacts must be an array")
    paths: dict[str, Path] = {}
    identities: dict[str, dict[str, str]] = {}
    for index, artifact in enumerate(artifacts):
        artifact_path = f"{run.root_dir}/result.json/artifacts/{index}"
        if not isinstance(artifact, dict):
            _fail(artifact_path, "rl.artifact", "Artifact must be an object")
        kind = artifact.get("kind")
        if kind not in EXPECTED_ARTIFACT_KINDS:
            continue
        if kind in paths:
            _fail(
                artifact_path,
                "rl.duplicate-artifact",
                f"RL artifact kind must be unique: {kind}",
            )
        relative = artifact.get("path")
        if not isinstance(relative, str):
            _fail(
                artifact_path,
                "rl.artifact-path",
                "RL artifact path must be a string",
            )
        path = confined_path(run.root_dir, relative, artifact_path)
        if not path.is_file():
            _fail(path, "rl.artifact-missing", f"Missing artifact: {kind}")
        if path.stat().st_size > MAX_ARTIFACT_BYTES:
            _fail(
                path,
                "rl.artifact-size",
                f"RL artifact exceeds {MAX_ARTIFACT_BYTES} bytes",
            )
        content_hash = run.manifest["files"].get(relative)
        if not isinstance(content_hash, str):
            _fail(
                path,
                "rl.artifact-identity",
                "Artifact is absent from immutable Run identity",
            )
        paths[kind] = path
        identities[kind] = {"path": relative, "sha256": content_hash}
    missing = BASE_ARTIFACT_KINDS - paths.keys()
    if missing:
        _fail(
            run.root_dir,
            "rl.artifacts",
            "Run does not declare the fixed RL artifact set: "
            + ", ".join(sorted(missing)),
        )
    return paths, identities


def _read_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        _fail(path, "rl.json", f"{label} must be one UTF-8 JSON object")
    if not isinstance(value, dict):
        _fail(path, "rl.json", f"{label} must be one JSON object")
    return value


def _configuration(metrics: dict[str, Any]) -> dict[str, Any]:
    value = metrics.get("configuration")
    if not isinstance(value, dict):
        _fail("RunResult/metrics/configuration", "rl.configuration", "Missing configuration")
    actions = value.get("actions")
    folds = value.get("folds")
    seeds = value.get("seeds")
    features = value.get("featureNames")
    raw_fields = value.get("rawStateFields")
    factor_experts = value.get("factorExperts")
    if (
        not isinstance(actions, list)
        or not actions
        or len(actions) != len(set(actions))
        or not all(isinstance(item, str) and item for item in actions)
    ):
        _fail("metrics/configuration/actions", "rl.actions", "Actions must be unique strings")
    if (
        not isinstance(folds, list)
        or not folds
        or len(folds) != len(set(folds))
        or not all(isinstance(item, str) and item for item in folds)
    ):
        _fail("metrics/configuration/folds", "rl.folds", "Folds must be unique strings")
    if (
        not isinstance(seeds, list)
        or not seeds
        or len(seeds) != len(set(seeds))
        or not all(isinstance(item, int) and not isinstance(item, bool) for item in seeds)
    ):
        _fail("metrics/configuration/seeds", "rl.seeds", "Seeds must be unique integers")
    if (
        not isinstance(features, list)
        or not features
        or len(features) != len(set(features))
        or not all(isinstance(item, str) and item for item in features)
        or not isinstance(raw_fields, list)
        or not all(isinstance(item, str) and item for item in raw_fields)
    ):
        _fail("metrics/configuration/features", "rl.features", "Feature declarations are invalid")
    if factor_experts is None:
        if "candidate" in actions:
            _fail(
                "metrics/configuration/factorExperts",
                "rl.factor-experts",
                "Candidate-fusion Runs must declare their fixed factor experts",
            )
    elif (
        not isinstance(factor_experts, list)
        or "candidate" not in factor_experts
        or len(factor_experts) != len(set(factor_experts))
        or not all(
            isinstance(item, str) and item in actions
            for item in factor_experts
        )
    ):
        _fail(
            "metrics/configuration/factorExperts",
            "rl.factor-experts",
            "Factor experts must be unique declared actions including candidate",
        )
    episodes = _integer(value.get("episodes"), "metrics/configuration/episodes", minimum=1)
    contextual_iterations = value.get("contextualRidgeIterations")
    if contextual_iterations is not None:
        contextual_iterations = _integer(
            contextual_iterations,
            "metrics/configuration/contextualRidgeIterations",
            minimum=1,
        )
    learning_contract = value.get("learningContract")
    if learning_contract is not None and learning_contract != LEARNING_CONTRACT:
        _fail(
            "metrics/configuration/learningContract",
            "rl.learning-contract",
            "Learning configuration provenance differs from the fixed contract",
        )
    decision_schedule = value.get("decisionSchedule")
    if not isinstance(decision_schedule, dict):
        _fail(
            "configuration/decisionSchedule",
            "rl.decision-schedule",
            "Decision schedule must be an object",
        )
    kind = decision_schedule.get("kind")
    if kind == "every-bars":
        if (
            set(decision_schedule) != {"source", "kind", "bars", "anchor"}
            or decision_schedule.get("source")
            not in {"caller-supplied", "reference-default"}
            or not isinstance(decision_schedule.get("bars"), int)
            or isinstance(decision_schedule.get("bars"), bool)
            or not 1 <= decision_schedule["bars"] <= 252
            or decision_schedule.get("anchor")
            not in {"dataset-start", "session-start"}
        ):
            _fail(
                "configuration/decisionSchedule",
                "rl.decision-schedule",
                "Every-bars decision schedule is invalid",
            )
    elif (
        kind != "calendar-month-end"
        or set(decision_schedule) != {"source", "kind"}
        or decision_schedule.get("source")
        not in {"caller-supplied", "reference-default"}
    ):
        _fail(
            "configuration/decisionSchedule",
            "rl.decision-schedule",
            "Calendar month-end decision schedule is invalid",
        )
    return {
        **value,
        "actions": actions,
        "folds": folds,
        "seeds": seeds,
        "featureNames": features,
        "rawStateFields": raw_fields,
        "episodes": episodes,
        "contextualRidgeIterations": contextual_iterations,
        "epsilonStart": _finite(value.get("epsilonStart"), "configuration/epsilonStart"),
        "epsilonEnd": _finite(value.get("epsilonEnd"), "configuration/epsilonEnd"),
        "learningRate": _finite(value.get("learningRate"), "configuration/learningRate"),
        "discount": _finite(value.get("discount"), "configuration/discount"),
        "riskAversion": _finite(value.get("riskAversion"), "configuration/riskAversion"),
        "costBps": _finite(value.get("costBps"), "configuration/costBps"),
        "decisionSchedule": decision_schedule,
    }


def _ranges(
    fold_value: dict[str, Any],
    fold: str,
) -> dict[str, dict[str, Any]]:
    ranges = fold_value.get("ranges")
    if not isinstance(ranges, dict) or set(ranges) != {"train", *SPLITS}:
        _fail(f"metrics/rl/folds/{fold}/ranges", "rl.ranges", "Fold ranges are incomplete")
    output: dict[str, dict[str, Any]] = {}
    previous_end: str | None = None
    for split in ("train", *SPLITS):
        item = ranges.get(split)
        if not isinstance(item, dict):
            _fail(f"metrics/rl/folds/{fold}/ranges/{split}", "rl.range", "Range must be an object")
        start = _session_date(item.get("start"), f"{fold}/{split}/start")
        end = _session_date(item.get("end"), f"{fold}/{split}/end")
        observations = _integer(item.get("observations"), f"{fold}/{split}/observations", minimum=1)
        if start > end or (previous_end is not None and start <= previous_end):
            _fail(f"{fold}/{split}", "rl.range-order", "Fold ranges must be chronological")
        output[split] = {
            "start": start,
            "end": end,
            "observations": observations,
            "role": "training" if split == "train" else (
                "selection" if split == "validation" else "visible-audit"
            ),
        }
        previous_end = end
    return output


def _baseline_split(
    baselines: dict[str, Any],
    name: str,
    split: str,
    path: str,
) -> dict[str, Any]:
    if name.startswith("fixed:"):
        value = baselines.get("fixed_factor_or_blend", {}).get(name.split(":", 1)[1], {}).get(split)
    elif name == "best-training-expert":
        value = baselines.get("best_training_expert", {}).get(split)
    elif name == "contextual-ridge":
        value = baselines.get("contextual_ridge", {}).get(split)
    else:
        _fail(path, "rl.baseline-name", f"Unknown baseline: {name}")
    if not isinstance(value, dict):
        _fail(path, "rl.baseline", f"Missing {name} {split} baseline evidence")
    return value


def _performance(
    value: Any,
    path: str,
    actions: list[str],
) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(path, "rl.performance", "Trial split evidence must be an object")
    net = value.get("net")
    implementation = value.get("implementation")
    frequencies = value.get("action_frequency")
    if not isinstance(net, dict) or not isinstance(implementation, dict) or not isinstance(frequencies, dict):
        _fail(path, "rl.performance", "Trial performance evidence is incomplete")
    if set(frequencies) != set(actions):
        _fail(path, "rl.action-frequency", "Action frequencies differ from configuration")
    normalized_frequencies = {
        action: _finite(frequencies[action], f"{path}/action_frequency/{action}")
        for action in actions
    }
    if (
        any(value < -1e-12 or value > 1.0 + 1e-12 for value in normalized_frequencies.values())
        or not math.isclose(sum(normalized_frequencies.values()), 1.0, abs_tol=1e-9)
    ):
        _fail(path, "rl.action-frequency", "Action frequencies must sum to one")
    execution_risk = value.get("execution_risk")
    if execution_risk is None:
        normalized_execution_risk = {
            "available": False,
            "activeDates": 0,
            "forecastAvailableDates": 0,
            "forecastCoverage": 0.0,
            "pretradeBreachDates": 0,
            "riskRebalanceOverrideDates": 0,
            "executedBreachDates": 0,
            "maximumExecutedForecastAnnualized": 0.0,
            "maximumCeilingError": 0.0,
        }
    elif isinstance(execution_risk, dict):
        normalized_execution_risk = {
            "available": True,
            "activeDates": _integer(
                execution_risk.get("active_dates"),
                f"{path}/execution_risk/active_dates",
            ),
            "forecastAvailableDates": _integer(
                execution_risk.get("forecast_available_dates"),
                f"{path}/execution_risk/forecast_available_dates",
            ),
            "forecastCoverage": _finite(
                execution_risk.get("forecast_coverage"),
                f"{path}/execution_risk/forecast_coverage",
            ),
            "pretradeBreachDates": _integer(
                execution_risk.get("pretrade_breach_dates"),
                f"{path}/execution_risk/pretrade_breach_dates",
            ),
            "riskRebalanceOverrideDates": _integer(
                execution_risk.get("risk_rebalance_override_dates"),
                f"{path}/execution_risk/risk_rebalance_override_dates",
            ),
            "executedBreachDates": _integer(
                execution_risk.get("executed_breach_dates"),
                f"{path}/execution_risk/executed_breach_dates",
            ),
            "maximumExecutedForecastAnnualized": _finite(
                execution_risk.get(
                    "maximum_executed_forecast_annualized"
                ),
                f"{path}/execution_risk/maximum_executed_forecast_annualized",
            ),
            "maximumCeilingError": _finite(
                execution_risk.get("maximum_ceiling_error"),
                f"{path}/execution_risk/maximum_ceiling_error",
            ),
        }
        if (
            normalized_execution_risk["forecastAvailableDates"]
            > normalized_execution_risk["activeDates"]
            or not 0
            <= normalized_execution_risk["forecastCoverage"]
            <= 1
            or normalized_execution_risk["executedBreachDates"]
            or normalized_execution_risk["maximumCeilingError"] > 1e-10
        ):
            _fail(
                f"{path}/execution_risk",
                "rl.execution-risk",
                "Trial executed-book risk evidence is invalid",
            )
    else:
        _fail(
            f"{path}/execution_risk",
            "rl.execution-risk",
            "Trial executed-book risk evidence must be an object",
        )
    return {
        "netSharpe": _finite(net.get("sharpe"), f"{path}/net/sharpe"),
        "netTotalReturn": _finite(net.get("total_return"), f"{path}/net/total_return"),
        "maximumDrawdown": _finite(net.get("maximum_drawdown"), f"{path}/net/maximum_drawdown"),
        "observations": _integer(net.get("observations"), f"{path}/net/observations", minimum=1),
        "cumulativeReward": _finite(value.get("cumulative_reward"), f"{path}/cumulative_reward"),
        "meanReward": _finite(value.get("mean_reward"), f"{path}/mean_reward"),
        "meanOneWayTurnover": _finite(
            implementation.get("mean_one_way_turnover"),
            f"{path}/implementation/mean_one_way_turnover",
        ),
        "totalCostDrag": _finite(
            implementation.get("total_cost_drag"),
            f"{path}/implementation/total_cost_drag",
        ),
        "actionFrequency": normalized_frequencies,
        "executionRisk": normalized_execution_risk,
    }


def _aggregate(values: list[float]) -> dict[str, Any]:
    mean = sum(values) / len(values)
    return {
        "observations": len(values),
        "mean": mean,
        "standardDeviation": math.sqrt(
            sum((value - mean) ** 2 for value in values) / len(values)
        ),
        "minimum": min(values),
        "maximum": max(values),
    }


def _reconcile_aggregate(actual: Any, values: list[float], path: str) -> dict[str, Any]:
    if not isinstance(actual, dict):
        _fail(path, "rl.aggregate", "Aggregate evidence must be an object")
    expected = _aggregate(values)
    if actual.get("observations") != expected["observations"]:
        _fail(path, "rl.reconciliation", "Aggregate observation count differs")
    for actual_name, expected_name in (
        ("mean", "mean"),
        ("standard_deviation", "standardDeviation"),
        ("minimum", "minimum"),
        ("maximum", "maximum"),
    ):
        _close(actual.get(actual_name), expected[expected_name], f"{path}/{actual_name}", actual_name)
    return expected


def _models(
    value: dict[str, Any],
    configuration: dict[str, Any],
    input_hash: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if (
        value.get("inputHash") != input_hash
        or value.get("featureNames") != configuration["featureNames"]
        or value.get("configuration") != configuration
    ):
        _fail("policy-models", "rl.model-identity", "Model identity/configuration differs from RunResult")
    models = value.get("models")
    if not isinstance(models, dict) or set(models) != set(configuration["folds"]):
        _fail("policy-models/models", "rl.models", "Model folds differ from configuration")
    output: list[dict[str, Any]] = []
    contextual: list[dict[str, Any]] = []
    for fold in configuration["folds"]:
        fold_models = models.get(fold)
        if not isinstance(fold_models, dict) or not isinstance(fold_models.get("contextualRidgeBaseline"), dict):
            _fail(f"policy-models/models/{fold}", "rl.models", "Fold model evidence is incomplete")
        ridge = fold_models["contextualRidgeBaseline"]
        ridge_columns = ridge.get("columns")
        ridge_mean = ridge.get("mean")
        ridge_scale = ridge.get("scale")
        ridge_coefficients = ridge.get("coefficients")
        if (
            not isinstance(ridge_columns, list)
            or not ridge_columns
            or len(ridge_columns) != len(set(ridge_columns))
            or not all(isinstance(item, str) and item for item in ridge_columns)
            or not isinstance(ridge_mean, dict)
            or set(ridge_mean) != set(ridge_columns)
            or not isinstance(ridge_scale, dict)
            or set(ridge_scale) != set(ridge_columns)
            or not isinstance(ridge_coefficients, list)
            or len(ridge_coefficients) != len(configuration["actions"])
            or any(
                not isinstance(row, list)
                or len(row) != len(ridge_columns) + 1
                for row in ridge_coefficients
            )
        ):
            _fail(
                f"policy-models/models/{fold}/contextualRidgeBaseline",
                "rl.ridge-shape",
                "Contextual ridge parameters have the wrong shape",
            )
        for column in ridge_columns:
            _finite(ridge_mean[column], f"policy-models/{fold}/ridge/mean/{column}")
            if _finite(ridge_scale[column], f"policy-models/{fold}/ridge/scale/{column}") <= 0:
                _fail(
                    f"policy-models/{fold}/ridge/scale/{column}",
                    "rl.ridge-scale",
                    "Contextual ridge scale must be positive",
                )
        for action_index, coefficients in enumerate(ridge_coefficients):
            for coefficient_index, coefficient in enumerate(coefficients):
                _finite(
                    coefficient,
                    f"policy-models/{fold}/ridge/{action_index}/{coefficient_index}",
                )
        expected_iterations = configuration.get(
            "contextualRidgeIterations"
        )
        if expected_iterations is None:
            contextual.append(
                {
                    "fold": fold,
                    "available": False,
                    "method": "legacy-fixed-path-contextual-ridge",
                    "labelScope": "legacy",
                    "anchorAction": None,
                    "iterations": None,
                    "columns": ridge_columns,
                    "history": [],
                }
            )
        else:
            history = ridge.get("history")
            if (
                ridge.get("method")
                != "iterative-same-pretrade-contextual-ridge-v1"
                or ridge.get("labelScope") != "train-only"
                or ridge.get("anchorAction") != "balanced"
                or ridge.get("iterations") != expected_iterations
                or not isinstance(history, list)
                or len(history) != expected_iterations
            ):
                _fail(
                    f"policy-models/models/{fold}/contextualRidgeBaseline",
                    "rl.ridge-contract",
                    "Contextual ridge training contract is incomplete",
                )
            projected_history: list[dict[str, Any]] = []
            for iteration, item in enumerate(history, start=1):
                path = (
                    f"policy-models/models/{fold}/"
                    f"contextualRidgeBaseline/history/{iteration}"
                )
                if (
                    not isinstance(item, dict)
                    or item.get("iteration") != iteration
                ):
                    _fail(
                        path,
                        "rl.ridge-history",
                        "Contextual ridge iterations must be complete and ordered",
                    )
                rows = _integer(
                    item.get("trainingRows"),
                    f"{path}/trainingRows",
                    minimum=1,
                )
                evaluations = _integer(
                    item.get("sharedPretradeActionEvaluations"),
                    f"{path}/sharedPretradeActionEvaluations",
                    minimum=1,
                )
                if evaluations != rows * len(configuration["actions"]):
                    _fail(
                        path,
                        "rl.ridge-reconciliation",
                        "Contextual ridge action evaluations do not reconcile",
                    )
                frequencies: dict[str, dict[str, float]] = {}
                for source, label in (
                    ("behaviorActionFrequency", "behavior"),
                    ("improvedActionFrequency", "improved"),
                ):
                    raw_frequency = item.get(source)
                    if (
                        not isinstance(raw_frequency, dict)
                        or set(raw_frequency)
                        != set(configuration["actions"])
                    ):
                        _fail(
                            f"{path}/{source}",
                            "rl.ridge-frequency",
                            "Contextual ridge action frequency is incomplete",
                        )
                    observed = {
                        action: _finite(
                            raw_frequency[action],
                            f"{path}/{source}/{action}",
                        )
                        for action in configuration["actions"]
                    }
                    if (
                        any(value < 0.0 or value > 1.0 for value in observed.values())
                        or not math.isclose(
                            sum(observed.values()),
                            1.0,
                            rel_tol=0.0,
                            abs_tol=1e-10,
                        )
                    ):
                        _fail(
                            f"{path}/{source}",
                            "rl.ridge-frequency",
                            "Contextual ridge action frequencies must sum to one",
                        )
                    frequencies[label] = observed
                oracle_hit = _finite(
                    item.get("behaviorOracleHitRate"),
                    f"{path}/behaviorOracleHitRate",
                )
                regret = _finite(
                    item.get("behaviorMeanRealizedRegret"),
                    f"{path}/behaviorMeanRealizedRegret",
                )
                if not 0.0 <= oracle_hit <= 1.0 or regret < 0.0:
                    _fail(
                        path,
                        "rl.ridge-opportunity",
                        "Contextual ridge opportunity evidence is out of bounds",
                    )
                projected_history.append(
                    {
                        "iteration": iteration,
                        "trainingRows": rows,
                        "sharedPretradeActionEvaluations": evaluations,
                        "behaviorActionFrequency": frequencies["behavior"],
                        "improvedActionFrequency": frequencies["improved"],
                        "improvedTrainingNetSharpe": _finite(
                            item.get("improvedTrainingNetSharpe"),
                            f"{path}/improvedTrainingNetSharpe",
                        ),
                        "behaviorOracleHitRate": oracle_hit,
                        "behaviorMeanRealizedRegret": regret,
                    }
                )
            contextual.append(
                {
                    "fold": fold,
                    "available": True,
                    "method": ridge["method"],
                    "labelScope": ridge["labelScope"],
                    "anchorAction": ridge["anchorAction"],
                    "iterations": ridge["iterations"],
                    "columns": ridge_columns,
                    "history": projected_history,
                }
            )
        seeds = fold_models.get("seeds")
        if not isinstance(seeds, dict) or set(seeds) != {str(seed) for seed in configuration["seeds"]}:
            _fail(f"policy-models/models/{fold}/seeds", "rl.models", "Model seeds differ from configuration")
        for seed in configuration["seeds"]:
            weights = seeds[str(seed)].get("weights") if isinstance(seeds[str(seed)], dict) else None
            if (
                not isinstance(weights, list)
                or len(weights) != len(configuration["actions"])
                or any(
                    not isinstance(row, list)
                    or len(row) != len(configuration["featureNames"])
                    for row in weights
                )
            ):
                _fail(f"policy-models/{fold}/{seed}", "rl.model-shape", "Q weights have the wrong shape")
            normalized = [
                [
                    _finite(weight, f"policy-models/{fold}/{seed}/{action_index}/{feature_index}")
                    for feature_index, weight in enumerate(row)
                ]
                for action_index, row in enumerate(weights)
            ]
            output.append({"fold": fold, "seed": seed, "weights": normalized})
    return output, contextual


def _training(
    value: dict[str, Any],
    configuration: dict[str, Any],
    ranges: dict[str, dict[str, dict[str, Any]]],
    input_hash: str,
) -> list[dict[str, Any]]:
    if value.get("inputHash") != input_hash:
        _fail("training-history/inputHash", "rl.training-identity", "Training identity differs from RunResult")
    histories = value.get("histories")
    if not isinstance(histories, dict) or set(histories) != set(configuration["folds"]):
        _fail("training-history/histories", "rl.training", "Training folds differ from configuration")
    output: list[dict[str, Any]] = []
    for fold in configuration["folds"]:
        fold_histories = histories.get(fold)
        if not isinstance(fold_histories, dict) or set(fold_histories) != {
            str(seed) for seed in configuration["seeds"]
        }:
            _fail(f"training-history/{fold}", "rl.training", "Training seeds differ from configuration")
        for seed in configuration["seeds"]:
            episodes = fold_histories[str(seed)]
            if not isinstance(episodes, list) or len(episodes) != configuration["episodes"]:
                _fail(f"training-history/{fold}/{seed}", "rl.training-budget", "Training episode budget differs")
            for index, episode in enumerate(episodes, start=1):
                path = f"training-history/{fold}/{seed}/{index}"
                if not isinstance(episode, dict) or episode.get("episode") != index:
                    _fail(path, "rl.training-episode", "Training episodes must be complete and ordered")
                counts = episode.get("actionCounts")
                if not isinstance(counts, dict) or set(counts) != set(configuration["actions"]):
                    _fail(path, "rl.training-actions", "Training action counts differ from configuration")
                normalized_counts = {
                    action: _integer(counts[action], f"{path}/actionCounts/{action}")
                    for action in configuration["actions"]
                }
                if sum(normalized_counts.values()) != ranges[fold]["train"]["observations"]:
                    _fail(path, "rl.training-observations", "Training action counts do not match fold observations")
                epsilon = _finite(episode.get("epsilon"), f"{path}/epsilon")
                expected_epsilon = configuration["epsilonStart"] + (
                    (index - 1) / max(1, configuration["episodes"] - 1)
                ) * (configuration["epsilonEnd"] - configuration["epsilonStart"])
                _close(epsilon, expected_epsilon, f"{path}/epsilon", "epsilon schedule")
                total_reward = _finite(episode.get("totalReward"), f"{path}/totalReward")
                mean_reward = _finite(episode.get("meanReward"), f"{path}/meanReward")
                _close(
                    mean_reward,
                    total_reward / ranges[fold]["train"]["observations"],
                    f"{path}/meanReward",
                    "mean training reward",
                )
                output.append(
                    {
                        "fold": fold,
                        "seed": seed,
                        "episode": index,
                        "epsilon": epsilon,
                        "totalReward": total_reward,
                        "meanReward": mean_reward,
                        "actionCounts": normalized_counts,
                    }
                )
    return output


def _action_rows(
    path: Path,
    configuration: dict[str, Any],
    ranges: dict[str, dict[str, dict[str, Any]]],
) -> list[dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            fields = tuple(reader.fieldnames or [])
            constraint_fields = tuple(
                [
                    *ACTION_COLUMNS,
                    *ACTION_EXECUTION_RISK_COLUMNS,
                    *ACTION_EXECUTION_CONSTRAINT_COLUMNS,
                ]
            )
            if fields != constraint_fields:
                _fail(path, "rl.csv-columns", "Action CSV columns differ from the fixed contract")
            has_execution_risk = True
            has_execution_constraints = True
            rows: list[dict[str, Any]] = []
            seen: set[tuple[str, int, str, str]] = set()
            last_dates: dict[tuple[str, int, str], str] = {}
            previous_actions: dict[tuple[str, int, str], str] = {}
            for row_number, row in enumerate(reader, start=2):
                if None in row or any(value is None for value in row.values()):
                    _fail(f"{path}:{row_number}", "rl.csv-width", "Action row width differs from header")
                fold = row["fold"]
                split = row["split"]
                action = row["action"]
                try:
                    seed = int(row["seed"])
                except ValueError:
                    _fail(f"{path}:{row_number}", "rl.seed", "Action seed must be an integer")
                if fold not in configuration["folds"] or seed not in configuration["seeds"]:
                    _fail(f"{path}:{row_number}", "rl.trial", "Action row uses an undeclared fold/seed")
                if split not in SPLITS or action not in configuration["actions"]:
                    _fail(f"{path}:{row_number}", "rl.action", "Action row uses an undeclared split/action")
                timestamp = _session_date(row["timestamp"], f"{path}:{row_number}/timestamp")
                declared = ranges[fold][split]
                if not declared["start"] <= timestamp <= declared["end"]:
                    _fail(f"{path}:{row_number}", "rl.action-range", "Action timestamp lies outside its fold split")
                key = (fold, seed, split, timestamp)
                group = (fold, seed, split)
                if key in seen or timestamp <= last_dates.get(group, ""):
                    _fail(f"{path}:{row_number}", "rl.action-order", "Action timestamps must be unique and ordered")
                seen.add(key)
                last_dates[group] = timestamp
                if row["decision_eligible"] not in {"True", "False"}:
                    _fail(
                        f"{path}:{row_number}/decision_eligible",
                        "rl.decision-cadence",
                        "Decision eligibility must be a boolean",
                    )
                decision_eligible = row["decision_eligible"] == "True"
                configured_schedule = configuration["decisionSchedule"]
                decision_kind = row["decision_schedule_kind"]
                if decision_kind != configured_schedule["kind"]:
                    _fail(
                        f"{path}:{row_number}/decision_schedule_kind",
                        "rl.decision-schedule",
                        "Action schedule differs from configuration",
                    )
                if decision_kind == "calendar-month-end":
                    if row["decision_every_bars"] or row["decision_anchor"]:
                        _fail(
                            f"{path}:{row_number}",
                            "rl.decision-schedule",
                            "Calendar month-end rows must leave bars and anchor empty",
                        )
                    decision_schedule = {"kind": decision_kind}
                else:
                    decision_every_bars = _csv_nonnegative_integer(
                        row["decision_every_bars"],
                        f"{path}:{row_number}/decision_every_bars",
                    )
                    decision_anchor = row["decision_anchor"]
                    decision_schedule = {
                        "kind": decision_kind,
                        "bars": decision_every_bars,
                        "anchor": decision_anchor,
                    }
                    expected_schedule = {
                        key: value
                        for key, value in configured_schedule.items()
                        if key != "source"
                    }
                    if decision_schedule != expected_schedule:
                        _fail(
                            f"{path}:{row_number}",
                            "rl.decision-schedule",
                            "Action schedule differs from configuration",
                        )
                decision_session = row["decision_session"]
                expected_session = (
                    timestamp[:7]
                    if decision_kind == "calendar-month-end"
                    else (
                        "dataset"
                        if decision_schedule["anchor"] == "dataset-start"
                        else timestamp[:10]
                    )
                )
                if (
                    decision_session != expected_session
                ):
                    _fail(
                        f"{path}:{row_number}/decision_anchor",
                        "rl.decision-anchor",
                        "Action anchor/session differs from configuration",
                    )
                previous_action = previous_actions.get(group, "balanced")
                if not decision_eligible and action != previous_action:
                    _fail(
                        f"{path}:{row_number}/action",
                        "rl.decision-schedule-hold",
                        "An ineligible bar changed the governed RL action",
                    )
                previous_actions[group] = action
                rows.append(
                    {
                        "fold": fold,
                        "seed": seed,
                        "split": split,
                        "timestamp": timestamp,
                        "action": action,
                        "decisionEligible": decision_eligible,
                        "decisionSchedule": decision_schedule,
                        "decisionSession": decision_session,
                        "reward": _finite(row["reward"], f"{path}:{row_number}/reward"),
                        "grossReturn": _finite(row["gross_return"], f"{path}:{row_number}/gross_return"),
                        "netReturn": _finite(row["net_return"], f"{path}:{row_number}/net_return"),
                        "oneWayTurnover": _finite(row["one_way_turnover"], f"{path}:{row_number}/one_way_turnover"),
                        "cost": _finite(row["cost"], f"{path}:{row_number}/cost"),
                        **(
                            {
                                "executionRiskStatus": row[
                                    "execution_risk_status"
                                ],
                                "executionRiskForecastAvailable": (
                                    row[
                                        "execution_risk_forecast_available"
                                    ]
                                    == "True"
                                ),
                                "executionRiskObservations": (
                                    _csv_nonnegative_integer(
                                        row[
                                            "execution_risk_observations"
                                        ],
                                        f"{path}:{row_number}/execution_risk_observations",
                                    )
                                ),
                                "pretradeRiskForecastAnnualized": _finite(
                                    row[
                                        "pretrade_risk_forecast_annualized"
                                    ],
                                    f"{path}:{row_number}/pretrade_risk_forecast_annualized",
                                ),
                                "executedRiskForecastAnnualized": _finite(
                                    row[
                                        "executed_risk_forecast_annualized"
                                    ],
                                    f"{path}:{row_number}/executed_risk_forecast_annualized",
                                ),
                                "executionRiskCeilingAnnualized": _finite(
                                    row[
                                        "execution_risk_ceiling_annualized"
                                    ],
                                    f"{path}:{row_number}/execution_risk_ceiling_annualized",
                                ),
                                "riskRebalanceOverride": (
                                    row["risk_rebalance_override"] == "True"
                                ),
                                "constraintRebalanceOverride": (
                                    row["constraint_rebalance_override"]
                                    == "True"
                                    if has_execution_constraints
                                    else False
                                ),
                                "constraintRepairOneWay": (
                                    _finite(
                                        row["constraint_repair_one_way"],
                                        f"{path}:{row_number}/constraint_repair_one_way",
                                    )
                                    if has_execution_constraints
                                    else 0.0
                                ),
                                "executedConstraintMaximumError": (
                                    _finite(
                                        row[
                                            "executed_constraint_maximum_error"
                                        ],
                                        f"{path}:{row_number}/executed_constraint_maximum_error",
                                    )
                                    if has_execution_constraints
                                    else 0.0
                                ),
                                "executionReason": row[
                                    "execution_reason"
                                ],
                                "grossExposure": _finite(
                                    row["gross_exposure"],
                                    f"{path}:{row_number}/gross_exposure",
                                ),
                                "proposedOneWayTurnover": _finite(
                                    row["proposed_one_way_turnover"],
                                    f"{path}:{row_number}/proposed_one_way_turnover",
                                ),
                            }
                            if has_execution_risk
                            else {
                                "executionRiskStatus": (
                                    "legacy_unavailable"
                                ),
                                "executionRiskForecastAvailable": False,
                                "executionRiskObservations": 0,
                                "pretradeRiskForecastAnnualized": 0.0,
                                "executedRiskForecastAnnualized": 0.0,
                                "executionRiskCeilingAnnualized": 0.0,
                                "riskRebalanceOverride": False,
                                "constraintRebalanceOverride": False,
                                "constraintRepairOneWay": 0.0,
                                "executedConstraintMaximumError": 0.0,
                                "executionReason": "legacy_unavailable",
                                "grossExposure": 0.0,
                                "proposedOneWayTurnover": 0.0,
                            }
                        ),
                    }
                )
                if rows[-1]["oneWayTurnover"] < -1e-12 or rows[-1]["cost"] < -1e-12:
                    _fail(
                        f"{path}:{row_number}",
                        "rl.implementation",
                        "Turnover and cost must be non-negative",
                    )
                if has_execution_risk:
                    if (
                        row["execution_risk_forecast_available"]
                        not in {"True", "False"}
                        or row["risk_rebalance_override"]
                        not in {"True", "False"}
                        or (
                            has_execution_constraints
                            and row["constraint_rebalance_override"]
                            not in {"True", "False"}
                        )
                        or not rows[-1]["executionRiskStatus"]
                        or not rows[-1]["executionReason"]
                        or rows[-1]["executionRiskStatus"]
                        not in {
                            "flat",
                            "within_ceiling",
                            "volatility_limited",
                            "risk_repaired",
                            "constraint_repaired",
                            "insufficient_history_fail_flat",
                            "invalid_covariance_fail_flat",
                        }
                        or rows[-1]["executionReason"]
                        not in {
                            "risk_ceiling_override",
                            "target_risk_repair",
                            "rebalance_threshold_met",
                            "portfolio_no_trade_band",
                            "decision_schedule_hold",
                            "mandate_constraint_override",
                            "mandate_and_risk_override",
                            "target_constraint_repair",
                        }
                        or min(
                            rows[-1][
                                "pretradeRiskForecastAnnualized"
                            ],
                            rows[-1][
                                "executedRiskForecastAnnualized"
                            ],
                            rows[-1][
                                "executionRiskCeilingAnnualized"
                            ],
                        )
                        < 0
                        or rows[-1]["grossExposure"] < 0
                        or rows[-1]["proposedOneWayTurnover"] < 0
                        or rows[-1]["constraintRepairOneWay"] < 0
                        or rows[-1][
                            "executedConstraintMaximumError"
                        ] < 0
                        or (
                            rows[-1]["riskRebalanceOverride"]
                            and rows[-1]["executionReason"]
                            not in {
                                "risk_ceiling_override",
                                "mandate_and_risk_override",
                            }
                        )
                        or (
                            rows[-1]["constraintRebalanceOverride"]
                            and rows[-1]["executionReason"]
                            not in {
                                "mandate_constraint_override",
                                "mandate_and_risk_override",
                            }
                        )
                        or (
                            rows[-1]["executionReason"]
                            == "mandate_and_risk_override"
                            and (
                                not rows[-1]["riskRebalanceOverride"]
                                or not rows[-1][
                                    "constraintRebalanceOverride"
                                ]
                            )
                        )
                        or (
                            not rows[-1]["decisionEligible"]
                            and rows[-1]["oneWayTurnover"] > 1e-12
                            and not rows[-1]["riskRebalanceOverride"]
                            and not rows[-1][
                                "constraintRebalanceOverride"
                            ]
                        )
                        or (
                            rows[-1]["executionRiskForecastAvailable"]
                            and rows[-1][
                                "executedRiskForecastAnnualized"
                            ]
                            > rows[-1][
                                "executionRiskCeilingAnnualized"
                            ]
                            + 1e-10
                        )
                    ):
                        _fail(
                            f"{path}:{row_number}",
                            "rl.execution-risk",
                            "Action executed-book risk evidence is invalid",
                        )
                if len(rows) > MAX_ACTION_ROWS:
                    _fail(path, "rl.row-limit", f"Action CSV exceeds {MAX_ACTION_ROWS} rows")
    except UnicodeDecodeError:
        _fail(path, "rl.csv-encoding", "Action CSV must be UTF-8")
    if not rows:
        _fail(path, "rl.csv-empty", "Action CSV must contain data rows")
    return rows


def _action_projection(
    rows: list[dict[str, Any]],
    trials_by_key: dict[tuple[str, int], dict[str, Any]],
    configuration: dict[str, Any],
    ranges: dict[str, dict[str, dict[str, Any]]],
    point_limit: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    groups: dict[tuple[str, int, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[(row["fold"], row["seed"], row["split"])].append(row)
    summaries: list[dict[str, Any]] = []
    transitions: Counter[tuple[str, str]] = Counter()
    for fold in configuration["folds"]:
        for seed in configuration["seeds"]:
            trial = trials_by_key[(fold, seed)]
            for split in SPLITS:
                group = groups.get((fold, seed, split), [])
                expected_count = ranges[fold][split]["observations"]
                if len(group) != expected_count:
                    _fail(
                        f"policy-actions/{fold}/{seed}/{split}",
                        "rl.action-coverage",
                        "Action rows do not match declared split observations",
                    )
                expected = trial[split]
                counts = Counter(row["action"] for row in group)
                frequencies = {
                    action: counts[action] / len(group)
                    for action in configuration["actions"]
                }
                for action in configuration["actions"]:
                    _close(
                        frequencies[action],
                        expected["actionFrequency"].get(action),
                        f"policy-actions/{fold}/{seed}/{split}/{action}",
                        "action frequency",
                    )
                cumulative_reward = sum(row["reward"] for row in group)
                mean_turnover = sum(row["oneWayTurnover"] for row in group) / len(group)
                total_cost = sum(row["cost"] for row in group)
                _close(cumulative_reward, expected["cumulativeReward"], f"{fold}/{seed}/{split}/reward", "cumulative reward")
                _close(cumulative_reward / len(group), expected["meanReward"], f"{fold}/{seed}/{split}/meanReward", "mean reward")
                _close(mean_turnover, expected["meanOneWayTurnover"], f"{fold}/{seed}/{split}/turnover", "mean turnover")
                _close(total_cost, expected["totalCostDrag"], f"{fold}/{seed}/{split}/cost", "cost drag")
                expected_risk = expected["executionRisk"]
                has_action_risk = any(
                    row["executionRiskStatus"] != "legacy_unavailable"
                    for row in group
                )
                if expected_risk["available"] != has_action_risk:
                    _fail(
                        f"policy-actions/{fold}/{seed}/{split}",
                        "rl.execution-risk",
                        "Trial metrics and action risk evidence must exist together",
                    )
                if has_action_risk:
                    active_risk_rows = [
                        row
                        for row in group
                        if (
                            row["grossExposure"] > 1e-12
                            or row["proposedOneWayTurnover"] > 1e-12
                            or row["riskRebalanceOverride"]
                            or row["constraintRebalanceOverride"]
                        )
                    ]
                    available_risk_rows = [
                        row
                        for row in active_risk_rows
                        if row["executionRiskForecastAvailable"]
                    ]
                    pretrade_breaches = [
                        row
                        for row in available_risk_rows
                        if row["pretradeRiskForecastAnnualized"]
                        > row["executionRiskCeilingAnnualized"] + 1e-10
                    ]
                    executed_breaches = [
                        row
                        for row in available_risk_rows
                        if row["executedRiskForecastAnnualized"]
                        > row["executionRiskCeilingAnnualized"] + 1e-10
                    ]
                    overrides = [
                        row
                        for row in active_risk_rows
                        if row["riskRebalanceOverride"]
                    ]
                    derived_risk = {
                        "available": True,
                        "activeDates": len(active_risk_rows),
                        "forecastAvailableDates": len(
                            available_risk_rows
                        ),
                        "forecastCoverage": (
                            len(available_risk_rows)
                            / len(active_risk_rows)
                            if active_risk_rows
                            else 0.0
                        ),
                        "pretradeBreachDates": len(pretrade_breaches),
                        "riskRebalanceOverrideDates": len(overrides),
                        "executedBreachDates": len(executed_breaches),
                        "maximumExecutedForecastAnnualized": (
                            max(
                                row[
                                    "executedRiskForecastAnnualized"
                                ]
                                for row in available_risk_rows
                            )
                            if available_risk_rows
                            else 0.0
                        ),
                        "maximumCeilingError": (
                            max(
                                max(
                                    0.0,
                                    row[
                                        "executedRiskForecastAnnualized"
                                    ]
                                    - row[
                                        "executionRiskCeilingAnnualized"
                                    ],
                                )
                                for row in available_risk_rows
                            )
                            if available_risk_rows
                            else 0.0
                        ),
                    }
                    for key, value in derived_risk.items():
                        if key == "available":
                            continue
                        if isinstance(value, float):
                            _close(
                                value,
                                expected_risk[key],
                                f"{fold}/{seed}/{split}/executionRisk/{key}",
                                "executed-book risk",
                            )
                        elif value != expected_risk[key]:
                            _fail(
                                f"{fold}/{seed}/{split}/executionRisk/{key}",
                                "rl.reconciliation",
                                "Action rows do not reconcile executed-book risk",
                            )
                else:
                    derived_risk = expected_risk
                transition_count = 0
                for prior, current in zip(group, group[1:]):
                    if prior["action"] != current["action"]:
                        transitions[(prior["action"], current["action"])] += 1
                        transition_count += 1
                summaries.append(
                    {
                        "fold": fold,
                        "seed": seed,
                        "split": split,
                        "role": "selection" if split == "validation" else "visible-audit",
                        "observations": len(group),
                        "actionFrequency": frequencies,
                        "cumulativeReward": cumulative_reward,
                        "meanReward": cumulative_reward / len(group),
                        "meanOneWayTurnover": mean_turnover,
                        "totalCostDrag": total_cost,
                        "actionTransitions": transition_count,
                        "executionRisk": derived_risk,
                    }
                )

    anchors: set[int] = set()
    group_indices: dict[tuple[str, int, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        group_indices[(row["fold"], row["seed"], row["split"])].append(index)
    for indices in group_indices.values():
        anchors.update((indices[0], indices[-1]))
    anchors.add(max(range(len(rows)), key=lambda index: abs(rows[index]["reward"])))
    anchors.add(max(range(len(rows)), key=lambda index: rows[index]["cost"]))
    selected = set(anchors)
    remaining = [index for index in range(len(rows)) if index not in selected]
    slots = max(0, point_limit - len(selected))
    if slots >= len(remaining):
        selected.update(remaining)
    elif slots == 1:
        selected.add(remaining[len(remaining) // 2])
    elif slots > 1:
        selected.update(
            remaining[
                round(position * (len(remaining) - 1) / (slots - 1))
            ]
            for position in range(slots)
        )
    transition_rows = [
        {"from": source, "to": target, "count": count}
        for (source, target), count in sorted(
            transitions.items(),
            key=lambda item: (-item[1], item[0]),
        )
    ]
    return summaries, {
        "totalRows": len(rows),
        "sampledRows": len(selected),
        "pointLimit": point_limit,
        "sampling": "deterministic-even-with-trial-endpoints-and-extremes",
        "points": [rows[index] for index in sorted(selected)],
        "transitions": transition_rows,
    }


POLICY_RATIONALE_METHOD = (
    "linear-q-chosen-vs-runner-up-decomposition-v1"
)
POLICY_RATIONALE_POLICY = {
    "method": POLICY_RATIONALE_METHOD,
    "action_runs": "contiguous-actions-clipped-to-fold-seed-split",
    "q_scale": "uncalibrated-linear-model-score",
    "feature_contribution": (
        "exact-linear-chosen-minus-runner-decomposition"
    ),
    "realized_outcomes": (
        "descriptive-endogenous-action-conditioning"
    ),
    "selection_authority": "context-only",
    "trading_authority": "none",
}


def _median(values: list[float | int]) -> float:
    ordered = sorted(float(value) for value in values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2.0


def _behavior_metrics(
    rows: list[dict[str, Any]],
    split: str,
    actions: list[str],
    feature_names: list[str],
) -> dict[str, Any]:
    selected = [row for row in rows if row["split"] == split]
    if not selected:
        _fail(
            f"policy-rationales/{split}",
            "rl.policy-rationale-coverage",
            "Policy rationale split has no decisions",
        )
    groups: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for row in selected:
        groups[(row["fold"], row["seed"])].append(row)
    run_lengths: list[int] = []
    runs_by_action = {action: [] for action in actions}
    transitions = 0
    comparable = 0
    trials: list[dict[str, Any]] = []
    for (fold, seed), group in groups.items():
        lengths: list[int] = []
        current_action = group[0]["selectedAction"]
        current_length = 0
        trial_transitions = 0
        for row in group:
            if row["selectedAction"] != current_action:
                lengths.append(current_length)
                runs_by_action[current_action].append(current_length)
                current_action = row["selectedAction"]
                current_length = 0
                trial_transitions += 1
            current_length += 1
        lengths.append(current_length)
        runs_by_action[current_action].append(current_length)
        run_lengths.extend(lengths)
        transitions += trial_transitions
        comparable += max(0, len(group) - 1)
        margins = [row["actionMargin"] for row in group]
        trials.append(
            {
                "fold": fold,
                "seed": seed,
                "decisions": len(group),
                "action_runs": len(lengths),
                "transitions": trial_transitions,
                "transition_rate": (
                    trial_transitions / (len(group) - 1)
                    if len(group) > 1
                    else 0.0
                ),
                "mean_action_run_length": sum(lengths) / len(lengths),
                "mean_action_margin": sum(margins) / len(margins),
                "tie_rate": (
                    sum(row["tieForBest"] for row in group) / len(group)
                ),
            }
        )
    decisions = len(selected)
    margins = [row["actionMargin"] for row in selected]
    by_action: dict[str, dict[str, Any]] = {}
    for action in actions:
        group = [row for row in selected if row["selectedAction"] == action]
        action_runs = runs_by_action[action]
        by_action[action] = {
            "decisions": len(group),
            "frequency": len(group) / decisions,
            "action_runs": len(action_runs),
            "mean_action_run_length": (
                sum(action_runs) / len(action_runs)
                if action_runs
                else 0.0
            ),
            "mean_action_margin": (
                sum(row["actionMargin"] for row in group) / len(group)
                if group
                else 0.0
            ),
            "mean_reward": (
                sum(row["reward"] for row in group) / len(group)
                if group
                else 0.0
            ),
            "mean_net_return": (
                sum(row["netReturn"] for row in group) / len(group)
                if group
                else 0.0
            ),
            "mean_one_way_turnover": (
                sum(row["oneWayTurnover"] for row in group) / len(group)
                if group
                else 0.0
            ),
            "total_cost": sum(row["cost"] for row in group),
        }
    by_feature: dict[str, dict[str, Any]] = {}
    for feature in feature_names:
        contributions = [
            row["marginContributions"][feature] for row in selected
        ]
        dominant = sum(
            row["dominantMarginFeature"] == feature for row in selected
        )
        by_feature[feature] = {
            "dominant_decisions": dominant,
            "dominant_rate": dominant / decisions,
            "mean_signed_margin_contribution": (
                sum(contributions) / len(contributions)
            ),
            "mean_absolute_margin_contribution": (
                sum(abs(value) for value in contributions)
                / len(contributions)
            ),
        }
    total_reward = sum(row["reward"] for row in selected)
    total_net_return = sum(row["netReturn"] for row in selected)
    mean_turnover = (
        sum(row["oneWayTurnover"] for row in selected) / decisions
    )
    total_cost = sum(row["cost"] for row in selected)
    reconciliation = {
        "rationale_rows": decisions,
        "action_rows": decisions,
        "decision_count_error": abs(
            sum(item["decisions"] for item in by_action.values())
            - decisions
        ),
        "frequency_error": abs(
            sum(item["frequency"] for item in by_action.values()) - 1.0
        ),
        "reward_error": abs(
            sum(
                item["mean_reward"] * item["decisions"]
                for item in by_action.values()
            )
            - total_reward
        ),
        "net_return_error": abs(
            sum(
                item["mean_net_return"] * item["decisions"]
                for item in by_action.values()
            )
            - total_net_return
        ),
        "turnover_error": abs(
            sum(
                item["mean_one_way_turnover"] * item["frequency"]
                for item in by_action.values()
            )
            - mean_turnover
        ),
        "cost_error": abs(
            sum(item["total_cost"] for item in by_action.values())
            - total_cost
        ),
        "transition_run_error": abs(
            len(run_lengths) - transitions - len(groups)
        ),
        "dominant_feature_rate_error": abs(
            sum(item["dominant_rate"] for item in by_feature.values())
            - 1.0
        ),
    }
    reconciliation["passed"] = (
        reconciliation["rationale_rows"]
        == reconciliation["action_rows"]
        == decisions
        and max(
            float(value)
            for key, value in reconciliation.items()
            if key not in {"rationale_rows", "action_rows"}
        )
        <= 1e-10
    )
    return {
        "status": "available",
        "decisions": decisions,
        "trial_paths": len(groups),
        "transitions": transitions,
        "transition_rate": transitions / comparable if comparable else 0.0,
        "retention_rate": (
            1.0 - transitions / comparable if comparable else 1.0
        ),
        "action_runs": len(run_lengths),
        "mean_action_run_length": sum(run_lengths) / len(run_lengths),
        "median_action_run_length": _median(run_lengths),
        "maximum_action_run_length": max(run_lengths),
        "single_bar_run_rate": (
            sum(length == 1 for length in run_lengths) / len(run_lengths)
        ),
        "mean_action_margin": sum(margins) / len(margins),
        "median_action_margin": _median(margins),
        "minimum_action_margin": min(margins),
        "maximum_action_margin": max(margins),
        "tie_decisions": sum(row["tieForBest"] for row in selected),
        "tie_rate": sum(row["tieForBest"] for row in selected) / decisions,
        "total_reward": total_reward,
        "total_net_return": total_net_return,
        "mean_one_way_turnover": mean_turnover,
        "total_cost": total_cost,
        "by_action": by_action,
        "by_feature": by_feature,
        "trials": trials,
        "reconciliation": reconciliation,
    }


def _compare_policy_metrics(actual: Any, expected: Any, path: str) -> None:
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            _fail(
                path,
                "rl.policy-rationale-metrics",
                "Policy-rationale metric shape differs from reconstructed evidence",
            )
        for key, value in expected.items():
            _compare_policy_metrics(actual[key], value, f"{path}/{key}")
    elif isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            _fail(
                path,
                "rl.policy-rationale-metrics",
                "Policy-rationale metric list differs from reconstructed evidence",
            )
        for index, value in enumerate(expected):
            _compare_policy_metrics(
                actual[index],
                value,
                f"{path}/{index}",
            )
    elif isinstance(expected, bool):
        if actual is not expected:
            _fail(
                path,
                "rl.policy-rationale-metrics",
                "Policy-rationale metric differs from reconstructed evidence",
            )
    elif isinstance(expected, float):
        _close(
            actual,
            expected,
            path,
            "policy-rationale metric",
            tolerance=1e-9,
        )
    elif actual != expected:
        _fail(
            path,
            "rl.policy-rationale-metrics",
            "Policy-rationale metric differs from reconstructed evidence",
        )


def _behavior_split_projection(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": value["status"],
        "decisions": value["decisions"],
        "trialPaths": value["trial_paths"],
        "transitions": value["transitions"],
        "transitionRate": value["transition_rate"],
        "retentionRate": value["retention_rate"],
        "actionRuns": value["action_runs"],
        "meanActionRunLength": value["mean_action_run_length"],
        "medianActionRunLength": value["median_action_run_length"],
        "maximumActionRunLength": value["maximum_action_run_length"],
        "singleBarRunRate": value["single_bar_run_rate"],
        "meanActionMargin": value["mean_action_margin"],
        "medianActionMargin": value["median_action_margin"],
        "minimumActionMargin": value["minimum_action_margin"],
        "maximumActionMargin": value["maximum_action_margin"],
        "tieDecisions": value["tie_decisions"],
        "tieRate": value["tie_rate"],
        "totalReward": value["total_reward"],
        "totalNetReturn": value["total_net_return"],
        "meanOneWayTurnover": value["mean_one_way_turnover"],
        "totalCost": value["total_cost"],
        "byAction": [
            {
                "action": action,
                "decisions": metrics["decisions"],
                "frequency": metrics["frequency"],
                "actionRuns": metrics["action_runs"],
                "meanActionRunLength": metrics[
                    "mean_action_run_length"
                ],
                "meanActionMargin": metrics["mean_action_margin"],
                "meanReward": metrics["mean_reward"],
                "meanNetReturn": metrics["mean_net_return"],
                "meanOneWayTurnover": metrics[
                    "mean_one_way_turnover"
                ],
                "totalCost": metrics["total_cost"],
            }
            for action, metrics in value["by_action"].items()
        ],
        "byFeature": [
            {
                "feature": feature,
                "dominantDecisions": metrics["dominant_decisions"],
                "dominantRate": metrics["dominant_rate"],
                "meanSignedMarginContribution": metrics[
                    "mean_signed_margin_contribution"
                ],
                "meanAbsoluteMarginContribution": metrics[
                    "mean_absolute_margin_contribution"
                ],
            }
            for feature, metrics in value["by_feature"].items()
        ],
        "trials": [
            {
                "fold": trial["fold"],
                "seed": trial["seed"],
                "decisions": trial["decisions"],
                "actionRuns": trial["action_runs"],
                "transitions": trial["transitions"],
                "transitionRate": trial["transition_rate"],
                "meanActionRunLength": trial[
                    "mean_action_run_length"
                ],
                "meanActionMargin": trial["mean_action_margin"],
                "tieRate": trial["tie_rate"],
            }
            for trial in value["trials"]
        ],
        "reconciliation": value["reconciliation"],
    }


def _policy_behavior_projection(
    value: dict[str, Any] | None,
    raw_metrics: Any,
    models: list[dict[str, Any]],
    action_rows: list[dict[str, Any]],
    configuration: dict[str, Any],
    input_hash: str,
) -> dict[str, Any]:
    if value is None and raw_metrics is None:
        return {
            "available": False,
            "policy": None,
            "selectionAuthority": "context-only",
            "validation": None,
            "test": None,
            "representativeDecisions": [],
        }
    if value is None or not isinstance(raw_metrics, dict):
        _fail(
            "RunResult/metrics/policy_rationale",
            "rl.policy-rationale",
            "Policy-rationale metrics and artifact must exist together",
        )
    expected_root = {
        "schemaVersion",
        "inputHash",
        "method",
        "actions",
        "rawStateFields",
        "featureNames",
        "rows",
    }
    if (
        set(value) != expected_root
        or value["schemaVersion"] != SCHEMA_VERSION
        or value["inputHash"] != input_hash
        or value["method"] != POLICY_RATIONALE_METHOD
        or value["actions"] != configuration["actions"]
        or value["rawStateFields"] != configuration["rawStateFields"]
        or value["featureNames"] != configuration["featureNames"]
        or not isinstance(value["rows"], list)
    ):
        _fail(
            "policy-rationales",
            "rl.policy-rationale-identity",
            "Policy-rationale identity differs from the fixed Run",
        )
    if raw_metrics.get("policy") != POLICY_RATIONALE_POLICY or set(
        raw_metrics
    ) != {"policy", "validation", "test"}:
        _fail(
            "RunResult/metrics/policy_rationale/policy",
            "rl.policy-rationale-policy",
            "Policy-rationale policy differs from the fixed contract",
        )
    model_by_key = {
        (model["fold"], model["seed"]): model for model in models
    }
    expected_action_keys = [
        (
            row["fold"],
            row["seed"],
            row["split"],
            row["timestamp"],
        )
        for row in action_rows
    ]
    if len(expected_action_keys) != len(set(expected_action_keys)):
        _fail(
            "policy-actions",
            "rl.policy-rationale-action-keys",
            "Action rows must have unique rationale keys",
        )
    normalized: list[dict[str, Any]] = []
    previous_by_group: dict[tuple[str, int, str], str] = {}
    row_fields = {
        "fold",
        "seed",
        "split",
        "timestamp",
        "decisionEligible",
        "decisionSchedule",
        "decisionSession",
        "selectionReason",
        "previousAction",
        "selectedAction",
        "runnerUpAction",
        "rawState",
        "encodedFeatures",
        "qValues",
        "actionMargin",
        "tieForBest",
        "marginContributions",
        "dominantMarginFeature",
        "dominantMarginContribution",
    }
    if len(value["rows"]) != len(action_rows):
        _fail(
            "policy-rationales/rows",
            "rl.policy-rationale-coverage",
            "Policy rationale and action row counts differ",
        )
    for index, (raw, action_row) in enumerate(
        zip(value["rows"], action_rows)
    ):
        path = f"policy-rationales/rows/{index}"
        if not isinstance(raw, dict) or set(raw) != row_fields:
            _fail(
                path,
                "rl.policy-rationale-row",
                "Policy-rationale row shape differs from the fixed contract",
            )
        key = (
            raw.get("fold"),
            raw.get("seed"),
            raw.get("split"),
            raw.get("timestamp"),
        )
        if key != expected_action_keys[index]:
            _fail(
                path,
                "rl.policy-rationale-order",
                "Policy-rationale rows differ from action chronology",
            )
        group = key[:3]
        expected_previous = previous_by_group.get(group, "balanced")
        if (
            raw.get("previousAction") != expected_previous
            or raw.get("selectedAction") != action_row["action"]
            or raw.get("decisionEligible")
            != action_row["decisionEligible"]
            or raw.get("decisionSchedule")
            != action_row["decisionSchedule"]
            or raw.get("decisionSession")
            != action_row["decisionSession"]
            or raw.get("selectionReason")
            != (
                "q-argmax"
                if action_row["decisionEligible"]
                else "decision-schedule-hold"
            )
            or raw.get("selectedAction") not in configuration["actions"]
            or raw.get("runnerUpAction") not in configuration["actions"]
            or raw.get("selectedAction") == raw.get("runnerUpAction")
        ):
            _fail(
                path,
                "rl.policy-rationale-action",
                "Policy-rationale action differs from rollout continuity",
            )
        previous_by_group[group] = raw["selectedAction"]
        raw_state = raw.get("rawState")
        features = raw.get("encodedFeatures")
        q_values = raw.get("qValues")
        contributions = raw.get("marginContributions")
        if (
            not isinstance(raw_state, dict)
            or set(raw_state) != set(configuration["rawStateFields"])
            or not isinstance(features, dict)
            or set(features) != set(configuration["featureNames"])
            or not isinstance(q_values, dict)
            or set(q_values) != set(configuration["actions"])
            or not isinstance(contributions, dict)
            or set(contributions) != set(configuration["featureNames"])
        ):
            _fail(
                path,
                "rl.policy-rationale-shape",
                "Policy-rationale vectors differ from configuration order",
            )
        normalized_state = {
            name: _finite(raw_state[name], f"{path}/rawState/{name}")
            for name in configuration["rawStateFields"]
        }
        for action in configuration["actions"]:
            expected_flag = float(action == expected_previous)
            _close(
                normalized_state[f"previous_{action}"],
                expected_flag,
                f"{path}/rawState/previous_{action}",
                "previous-action state",
            )
        encoded = [
            _finite(features[name], f"{path}/encodedFeatures/{name}")
            for name in configuration["featureNames"]
        ]
        model = model_by_key.get((raw["fold"], raw["seed"]))
        if model is None:
            _fail(
                path,
                "rl.policy-rationale-model",
                "Policy-rationale row has no frozen model",
            )
        expected_q = [
            sum(weight * feature for weight, feature in zip(row, encoded))
            for row in model["weights"]
        ]
        for action_index, action in enumerate(configuration["actions"]):
            _close(
                q_values[action],
                expected_q[action_index],
                f"{path}/qValues/{action}",
                "action Q value",
                tolerance=1e-10,
            )
        ranked = sorted(
            range(len(configuration["actions"])),
            key=lambda action_index: (
                -expected_q[action_index],
                action_index,
            ),
        )
        if action_row["decisionEligible"]:
            selected_index, runner_index = ranked[:2]
        else:
            selected_index = configuration["actions"].index(
                raw["selectedAction"]
            )
            runner_index = next(
                index
                for index in ranked
                if index != selected_index
            )
        if (
            raw["selectedAction"]
            != configuration["actions"][selected_index]
            or raw["runnerUpAction"]
            != configuration["actions"][runner_index]
        ):
            _fail(
                path,
                "rl.policy-rationale-ranking",
                "Selected or runner-up action differs from frozen Q ranking",
            )
        expected_margin = (
            expected_q[selected_index] - expected_q[runner_index]
        )
        margin = _finite(raw["actionMargin"], f"{path}/actionMargin")
        _close(
            margin,
            expected_margin,
            f"{path}/actionMargin",
            "action Q margin",
            tolerance=1e-10,
        )
        expected_contributions = [
            (
                model["weights"][selected_index][feature_index]
                - model["weights"][runner_index][feature_index]
            )
            * encoded[feature_index]
            for feature_index in range(len(encoded))
        ]
        normalized_contributions: dict[str, float] = {}
        for feature_index, feature in enumerate(
            configuration["featureNames"]
        ):
            value_number = _finite(
                contributions[feature],
                f"{path}/marginContributions/{feature}",
            )
            _close(
                value_number,
                expected_contributions[feature_index],
                f"{path}/marginContributions/{feature}",
                "feature margin contribution",
                tolerance=1e-10,
            )
            normalized_contributions[feature] = value_number
        _close(
            sum(normalized_contributions.values()),
            margin,
            f"{path}/marginContributions",
            "feature contribution identity",
            tolerance=1e-10,
        )
        dominant_index = max(
            range(len(configuration["featureNames"])),
            key=lambda feature_index: (
                abs(expected_contributions[feature_index]),
                -feature_index,
            ),
        )
        dominant_feature = configuration["featureNames"][dominant_index]
        if (
            raw.get("dominantMarginFeature") != dominant_feature
            or not isinstance(raw.get("tieForBest"), bool)
            or raw.get("tieForBest") != (abs(margin) <= 1e-12)
        ):
            _fail(
                path,
                "rl.policy-rationale-dominant",
                "Tie or dominant feature differs from reconstructed rationale",
            )
        _close(
            raw.get("dominantMarginContribution"),
            normalized_contributions[dominant_feature],
            f"{path}/dominantMarginContribution",
            "dominant margin contribution",
            tolerance=1e-10,
        )
        normalized.append(
            {
                **raw,
                "seed": int(raw["seed"]),
                "rawState": normalized_state,
                "encodedFeatures": dict(
                    zip(configuration["featureNames"], encoded)
                ),
                "qValues": dict(
                    zip(configuration["actions"], expected_q)
                ),
                "actionMargin": margin,
                "marginContributions": normalized_contributions,
                "reward": action_row["reward"],
                "netReturn": action_row["netReturn"],
                "oneWayTurnover": action_row["oneWayTurnover"],
                "cost": action_row["cost"],
            }
        )
    reconstructed = {
        split: _behavior_metrics(
            normalized,
            split,
            configuration["actions"],
            configuration["featureNames"],
        )
        for split in SPLITS
    }
    for split in SPLITS:
        _compare_policy_metrics(
            raw_metrics[split],
            reconstructed[split],
            f"RunResult/metrics/policy_rationale/{split}",
        )
    representative: list[dict[str, Any]] = []
    for split in SPLITS:
        split_rows = [row for row in normalized if row["split"] == split]
        ordered = sorted(
            split_rows,
            key=lambda row: (
                row["actionMargin"],
                row["fold"],
                row["seed"],
                row["timestamp"],
            ),
        )
        selected_rows = [*ordered[:6], *ordered[-6:]]
        seen: set[tuple[str, int, str, str]] = set()
        for row in selected_rows:
            key = (
                row["fold"],
                row["seed"],
                row["split"],
                row["timestamp"],
            )
            if key in seen:
                continue
            seen.add(key)
            representative.append(
                {
                    "fold": row["fold"],
                    "seed": row["seed"],
                    "split": row["split"],
                    "role": (
                        "selection"
                        if split == "validation"
                        else "visible-audit"
                    ),
                    "timestamp": row["timestamp"],
                    "previousAction": row["previousAction"],
                    "selectedAction": row["selectedAction"],
                    "runnerUpAction": row["runnerUpAction"],
                    "actionMargin": row["actionMargin"],
                    "tieForBest": row["tieForBest"],
                    "dominantMarginFeature": row[
                        "dominantMarginFeature"
                    ],
                    "dominantMarginContribution": row[
                        "dominantMarginContribution"
                    ],
                    "reward": row["reward"],
                    "netReturn": row["netReturn"],
                    "oneWayTurnover": row["oneWayTurnover"],
                    "cost": row["cost"],
                }
            )
    policy = raw_metrics["policy"]
    return {
        "available": True,
        "policy": {
            "method": policy["method"],
            "actionRuns": policy["action_runs"],
            "qScale": policy["q_scale"],
            "featureContribution": policy["feature_contribution"],
            "realizedOutcomes": policy["realized_outcomes"],
            "selectionAuthority": policy["selection_authority"],
            "tradingAuthority": policy["trading_authority"],
        },
        "selectionAuthority": "context-only",
        "validation": _behavior_split_projection(
            reconstructed["validation"]
        ),
        "test": _behavior_split_projection(reconstructed["test"]),
        "representativeDecisions": representative,
    }


def _linear_percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def _opportunity_metrics(
    rows: list[dict[str, Any]],
    split: str,
    actions: list[str],
) -> dict[str, Any]:
    selected = [row for row in rows if row["split"] == split]
    if not selected:
        _fail(
            f"policy-opportunities/{split}",
            "rl.factor-opportunity-coverage",
            "Factor opportunity split has no decisions",
        )
    groups: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for row in selected:
        groups[(row["fold"], row["seed"])].append(row)
    decisions = len(selected)
    regrets = [row["realizedRegret"] for row in selected]
    selected_rewards = [row["selectedReward"] for row in selected]
    oracle_rewards = [row["oracleReward"] for row in selected]
    selected_ranks = [row["selectedRank"] for row in selected]
    oracle_hits = sum(row["oracleHit"] for row in selected)
    by_action: dict[str, dict[str, Any]] = {}
    for action in actions:
        selected_count = sum(
            row["selectedAction"] == action for row in selected
        )
        oracle_count = sum(
            row["oracleAction"] == action for row in selected
        )
        evidence = [row["actions"][action] for row in selected]
        by_action[action] = {
            "selected_decisions": selected_count,
            "selected_frequency": selected_count / decisions,
            "oracle_decisions": oracle_count,
            "oracle_frequency": oracle_count / decisions,
            "mean_local_reward": (
                sum(item["reward"] for item in evidence) / decisions
            ),
            "mean_one_way_turnover": (
                sum(item["oneWayTurnover"] for item in evidence) / decisions
            ),
            "total_cost": sum(item["cost"] for item in evidence),
            "risk_repair_rate": (
                sum(item["riskRebalanceOverride"] for item in evidence)
                / decisions
            ),
        }
    candidate_oracle = [
        row for row in selected if row["oracleAction"] == "candidate"
    ]
    candidate_missed = [
        row
        for row in candidate_oracle
        if row["selectedAction"] != "candidate"
    ]
    candidate_captured = len(candidate_oracle) - len(candidate_missed)
    candidate_vs_selected = [
        row["candidateMinusSelectedReward"] for row in selected
    ]
    candidate_vs_balanced = [
        row["candidateMinusBalancedReward"] for row in selected
    ]
    trials: list[dict[str, Any]] = []
    for (fold, seed), group in groups.items():
        group_candidate_oracle = sum(
            row["oracleAction"] == "candidate" for row in group
        )
        group_candidate_missed = sum(
            row["oracleAction"] == "candidate"
            and row["selectedAction"] != "candidate"
            for row in group
        )
        trials.append(
            {
                "fold": fold,
                "seed": seed,
                "decisions": len(group),
                "oracle_hits": sum(row["oracleHit"] for row in group),
                "oracle_hit_rate": (
                    sum(row["oracleHit"] for row in group) / len(group)
                ),
                "mean_selected_rank": (
                    sum(row["selectedRank"] for row in group) / len(group)
                ),
                "mean_realized_regret": (
                    sum(row["realizedRegret"] for row in group) / len(group)
                ),
                "candidate_oracle_rate": (
                    group_candidate_oracle / len(group)
                ),
                "candidate_missed_opportunity_rate": (
                    group_candidate_missed / len(group)
                ),
            }
        )
    reconciliation = {
        "decision_rows": decisions,
        "action_evaluations": sum(
            len(row["actions"]) for row in selected
        ),
        "action_evaluation_count_error": abs(
            sum(len(row["actions"]) for row in selected)
            - decisions * len(actions)
        ),
        "selected_frequency_error": abs(
            sum(item["selected_frequency"] for item in by_action.values())
            - 1.0
        ),
        "oracle_frequency_error": abs(
            sum(item["oracle_frequency"] for item in by_action.values())
            - 1.0
        ),
        "regret_identity_error": max(
            abs(
                row["oracleReward"]
                - row["selectedReward"]
                - row["realizedRegret"]
            )
            for row in selected
        ),
        "candidate_selected_delta_error": max(
            abs(
                row["actions"]["candidate"]["reward"]
                - row["selectedReward"]
                - row["candidateMinusSelectedReward"]
            )
            for row in selected
        ),
        "candidate_balanced_delta_error": max(
            abs(
                row["actions"]["candidate"]["reward"]
                - row["actions"]["balanced"]["reward"]
                - row["candidateMinusBalancedReward"]
            )
            for row in selected
        ),
        "negative_regret_error": max(
            max(0.0, -row["realizedRegret"]) for row in selected
        ),
        "selected_action_reconciliation_error": 0.0,
    }
    reconciliation["passed"] = (
        reconciliation["action_evaluations"]
        == decisions * len(actions)
        and max(
            float(value)
            for key, value in reconciliation.items()
            if key not in {"decision_rows", "action_evaluations"}
        )
        <= 1e-10
    )
    return {
        "status": "available",
        "decisions": decisions,
        "trial_paths": len(groups),
        "oracle_hit_decisions": oracle_hits,
        "oracle_hit_rate": oracle_hits / decisions,
        "mean_selected_rank": sum(selected_ranks) / decisions,
        "mean_selected_reward": sum(selected_rewards) / decisions,
        "mean_oracle_reward": sum(oracle_rewards) / decisions,
        "total_realized_regret": sum(regrets),
        "mean_realized_regret": sum(regrets) / decisions,
        "median_realized_regret": _median(regrets),
        "p90_realized_regret": _linear_percentile(regrets, 0.90),
        "maximum_realized_regret": max(regrets),
        "positive_regret_rate": (
            sum(regret > 1e-12 for regret in regrets) / decisions
        ),
        "by_action": by_action,
        "candidate": {
            "selected_decisions": by_action["candidate"][
                "selected_decisions"
            ],
            "selected_frequency": by_action["candidate"][
                "selected_frequency"
            ],
            "oracle_decisions": len(candidate_oracle),
            "oracle_frequency": len(candidate_oracle) / decisions,
            "captured_oracle_decisions": candidate_captured,
            "oracle_capture_rate": (
                candidate_captured / len(candidate_oracle)
                if candidate_oracle
                else 0.0
            ),
            "missed_opportunity_decisions": len(candidate_missed),
            "missed_opportunity_rate": len(candidate_missed) / decisions,
            "mean_reward": by_action["candidate"]["mean_local_reward"],
            "mean_vs_selected_reward": (
                sum(candidate_vs_selected) / decisions
            ),
            "mean_vs_balanced_reward": (
                sum(candidate_vs_balanced) / decisions
            ),
            "win_rate_vs_balanced": (
                sum(value > 1e-12 for value in candidate_vs_balanced)
                / decisions
            ),
        },
        "trials": trials,
        "reconciliation": reconciliation,
    }


def _opportunity_split_projection(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": value["status"],
        "decisions": value["decisions"],
        "trialPaths": value["trial_paths"],
        "oracleHitDecisions": value["oracle_hit_decisions"],
        "oracleHitRate": value["oracle_hit_rate"],
        "meanSelectedRank": value["mean_selected_rank"],
        "meanSelectedReward": value["mean_selected_reward"],
        "meanOracleReward": value["mean_oracle_reward"],
        "totalRealizedRegret": value["total_realized_regret"],
        "meanRealizedRegret": value["mean_realized_regret"],
        "medianRealizedRegret": value["median_realized_regret"],
        "p90RealizedRegret": value["p90_realized_regret"],
        "maximumRealizedRegret": value["maximum_realized_regret"],
        "positiveRegretRate": value["positive_regret_rate"],
        "byAction": [
            {
                "action": action,
                "selectedDecisions": metrics["selected_decisions"],
                "selectedFrequency": metrics["selected_frequency"],
                "oracleDecisions": metrics["oracle_decisions"],
                "oracleFrequency": metrics["oracle_frequency"],
                "meanLocalReward": metrics["mean_local_reward"],
                "meanOneWayTurnover": metrics[
                    "mean_one_way_turnover"
                ],
                "totalCost": metrics["total_cost"],
                "riskRepairRate": metrics["risk_repair_rate"],
            }
            for action, metrics in value["by_action"].items()
        ],
        "candidate": {
            "selectedDecisions": value["candidate"]["selected_decisions"],
            "selectedFrequency": value["candidate"]["selected_frequency"],
            "oracleDecisions": value["candidate"]["oracle_decisions"],
            "oracleFrequency": value["candidate"]["oracle_frequency"],
            "capturedOracleDecisions": value["candidate"][
                "captured_oracle_decisions"
            ],
            "oracleCaptureRate": value["candidate"][
                "oracle_capture_rate"
            ],
            "missedOpportunityDecisions": value["candidate"][
                "missed_opportunity_decisions"
            ],
            "missedOpportunityRate": value["candidate"][
                "missed_opportunity_rate"
            ],
            "meanReward": value["candidate"]["mean_reward"],
            "meanVsSelectedReward": value["candidate"][
                "mean_vs_selected_reward"
            ],
            "meanVsBalancedReward": value["candidate"][
                "mean_vs_balanced_reward"
            ],
            "winRateVsBalanced": value["candidate"][
                "win_rate_vs_balanced"
            ],
        },
        "trials": [
            {
                "fold": trial["fold"],
                "seed": trial["seed"],
                "decisions": trial["decisions"],
                "oracleHits": trial["oracle_hits"],
                "oracleHitRate": trial["oracle_hit_rate"],
                "meanSelectedRank": trial["mean_selected_rank"],
                "meanRealizedRegret": trial["mean_realized_regret"],
                "candidateOracleRate": trial["candidate_oracle_rate"],
                "candidateMissedOpportunityRate": trial[
                    "candidate_missed_opportunity_rate"
                ],
            }
            for trial in value["trials"]
        ],
        "reconciliation": value["reconciliation"],
    }


def _factor_opportunity_projection(
    value: dict[str, Any] | None,
    raw_metrics: Any,
    action_rows: list[dict[str, Any]],
    configuration: dict[str, Any],
    assets: list[str],
    input_hash: str,
) -> dict[str, Any]:
    if value is None and raw_metrics is None:
        return {
            "available": False,
            "policy": None,
            "selectionAuthority": "context-only",
            "validation": None,
            "test": None,
            "representativeDecisions": [],
        }
    if value is None or not isinstance(raw_metrics, dict):
        _fail(
            "RunResult/metrics/factor_opportunity",
            "rl.factor-opportunity",
            "Factor-opportunity metrics and artifact must exist together",
        )
    root_fields = {
        "schemaVersion",
        "inputHash",
        "method",
        "actions",
        "assets",
        "reward",
        "policy",
        "rows",
    }
    if (
        set(value) != root_fields
        or value["schemaVersion"] != SCHEMA_VERSION
        or value["inputHash"] != input_hash
        or value["method"] != FACTOR_OPPORTUNITY_METHOD
        or value["actions"] != configuration["actions"]
        or value["assets"] != assets
        or value["reward"]
        != _factor_opportunity_reward(float(configuration["costBps"]))
        or value["policy"] != FACTOR_OPPORTUNITY_POLICY
        or not isinstance(value["rows"], list)
        or set(raw_metrics) != {"policy", "validation", "test"}
        or raw_metrics["policy"] != FACTOR_OPPORTUNITY_POLICY
    ):
        _fail(
            "policy-opportunities",
            "rl.factor-opportunity-identity",
            "Factor-opportunity identity differs from the fixed Run",
        )
    expected_keys = [
        (row["fold"], row["seed"], row["split"], row["timestamp"])
        for row in action_rows
    ]
    if len(value["rows"]) != len(action_rows):
        _fail(
            "policy-opportunities/rows",
            "rl.factor-opportunity-coverage",
            "Opportunity and selected-action row counts differ",
        )
    row_fields = {
        "fold",
        "seed",
        "split",
        "timestamp",
        "decisionEligible",
        "decisionSchedule",
        "decisionSession",
        "selectedAction",
        "oracleAction",
        "selectedRank",
        "oracleHit",
        "selectedReward",
        "oracleReward",
        "realizedRegret",
        "candidateMinusSelectedReward",
        "candidateMinusBalancedReward",
        "pretradeWeights",
        "forwardReturns",
        "actions",
        "sharedExecution",
    }
    action_fields = {
        "proposedWeights",
        "executedWeights",
        "trades",
        "grossReturn",
        "netReturn",
        "reward",
        "oneWayTurnover",
        "cost",
        "grossExposure",
        "netExposure",
        "executionRiskStatus",
        "executionRiskForecastAvailable",
        "executionRiskObservations",
        "pretradeRiskForecastAnnualized",
        "executedRiskForecastAnnualized",
        "executionRiskCeilingAnnualized",
        "riskRebalanceOverride",
        "constraintRebalanceOverride",
        "constraintRepairOneWay",
        "executedConstraintMaximumError",
        "executionReason",
    }
    execution_fields = action_fields - {"proposedWeights"}
    normalized: list[dict[str, Any]] = []
    cost_bps = _finite(
        configuration.get("costBps"),
        "metrics/configuration/costBps",
    )
    risk_aversion = _finite(
        configuration.get("riskAversion"),
        "metrics/configuration/riskAversion",
    )
    for index, (raw, selected_action_row) in enumerate(
        zip(value["rows"], action_rows)
    ):
        path = f"policy-opportunities/rows/{index}"
        if not isinstance(raw, dict) or set(raw) != row_fields:
            _fail(
                path,
                "rl.factor-opportunity-row",
                "Factor-opportunity row shape differs from the fixed contract",
            )
        key = (
            raw.get("fold"),
            raw.get("seed"),
            raw.get("split"),
            raw.get("timestamp"),
        )
        if key != expected_keys[index]:
            _fail(
                path,
                "rl.factor-opportunity-order",
                "Factor-opportunity chronology differs from action evidence",
            )
        if (
            raw.get("selectedAction") != selected_action_row["action"]
            or raw.get("decisionEligible")
            != selected_action_row["decisionEligible"]
            or raw.get("decisionSchedule")
            != selected_action_row["decisionSchedule"]
            or raw.get("decisionSession")
            != selected_action_row["decisionSession"]
            or raw.get("selectedAction") not in configuration["actions"]
            or raw.get("oracleAction") not in configuration["actions"]
            or not isinstance(raw.get("oracleHit"), bool)
        ):
            _fail(
                path,
                "rl.factor-opportunity-action",
                "Factor-opportunity action identity is invalid",
            )
        pretrade_raw = raw.get("pretradeWeights")
        forward_raw = raw.get("forwardReturns")
        action_values = raw.get("actions")
        if (
            not isinstance(pretrade_raw, dict)
            or set(pretrade_raw) != set(assets)
            or not isinstance(forward_raw, dict)
            or set(forward_raw) != set(assets)
            or not isinstance(action_values, dict)
            or set(action_values) != set(configuration["actions"])
        ):
            _fail(
                path,
                "rl.factor-opportunity-vectors",
                "Opportunity assets/actions differ from the fixed contract",
            )
        pretrade = {
            asset: _finite(pretrade_raw[asset], f"{path}/pretrade/{asset}")
            for asset in assets
        }
        forward = {
            asset: _finite(forward_raw[asset], f"{path}/forward/{asset}")
            for asset in assets
        }
        actions: dict[str, dict[str, Any]] = {}
        shared_execution = raw.get("sharedExecution")
        decision_eligible = raw["decisionEligible"]
        if decision_eligible:
            if shared_execution is not None:
                _fail(
                    f"{path}/sharedExecution",
                    "rl.factor-opportunity-shared-execution",
                    "Decision-eligible opportunities cannot share execution",
                )
        elif (
            not isinstance(shared_execution, dict)
            or set(shared_execution) != execution_fields
        ):
            _fail(
                f"{path}/sharedExecution",
                "rl.factor-opportunity-shared-execution",
                "Schedule-held opportunities require one shared execution",
            )
        for action in configuration["actions"]:
            action_path = f"{path}/actions/{action}"
            stored_item = action_values[action]
            if decision_eligible:
                item = stored_item
                expected_item_fields = action_fields
            else:
                expected_item_fields = {"proposedWeights"}
                item = {
                    **stored_item,
                    **shared_execution,
                }
            if not isinstance(item, dict) or set(item) != action_fields:
                _fail(
                    action_path,
                    "rl.factor-opportunity-action-row",
                    "Opportunity action shape differs from the fixed contract",
                )
            if (
                not isinstance(stored_item, dict)
                or set(stored_item) != expected_item_fields
            ):
                _fail(
                    action_path,
                    "rl.factor-opportunity-action-row",
                    "Stored opportunity action shape differs from the "
                    "schedule-aware contract",
                )
            vectors: dict[str, dict[str, float]] = {}
            for artifact_name in (
                "proposedWeights",
                "executedWeights",
                "trades",
            ):
                raw_vector = item.get(artifact_name)
                if (
                    not isinstance(raw_vector, dict)
                    or set(raw_vector) != set(assets)
                ):
                    _fail(
                        f"{action_path}/{artifact_name}",
                        "rl.factor-opportunity-vector",
                        "Opportunity weight/trade assets differ",
                    )
                vectors[artifact_name] = {
                    asset: _finite(
                        raw_vector[asset],
                        f"{action_path}/{artifact_name}/{asset}",
                    )
                    for asset in assets
                }
            evidence = {
                **vectors,
                "grossReturn": _finite(
                    item.get("grossReturn"),
                    f"{action_path}/grossReturn",
                ),
                "netReturn": _finite(
                    item.get("netReturn"),
                    f"{action_path}/netReturn",
                ),
                "reward": _finite(
                    item.get("reward"),
                    f"{action_path}/reward",
                ),
                "oneWayTurnover": _finite(
                    item.get("oneWayTurnover"),
                    f"{action_path}/oneWayTurnover",
                ),
                "cost": _finite(
                    item.get("cost"),
                    f"{action_path}/cost",
                ),
                "grossExposure": _finite(
                    item.get("grossExposure"),
                    f"{action_path}/grossExposure",
                ),
                "netExposure": _finite(
                    item.get("netExposure"),
                    f"{action_path}/netExposure",
                ),
                "executionRiskStatus": item.get("executionRiskStatus"),
                "executionRiskForecastAvailable": item.get(
                    "executionRiskForecastAvailable"
                ),
                "executionRiskObservations": _integer(
                    item.get("executionRiskObservations"),
                    f"{action_path}/executionRiskObservations",
                ),
                "pretradeRiskForecastAnnualized": _finite(
                    item.get("pretradeRiskForecastAnnualized"),
                    f"{action_path}/pretradeRiskForecastAnnualized",
                ),
                "executedRiskForecastAnnualized": _finite(
                    item.get("executedRiskForecastAnnualized"),
                    f"{action_path}/executedRiskForecastAnnualized",
                ),
                "executionRiskCeilingAnnualized": _finite(
                    item.get("executionRiskCeilingAnnualized"),
                    f"{action_path}/executionRiskCeilingAnnualized",
                ),
                "riskRebalanceOverride": item.get(
                    "riskRebalanceOverride"
                ),
                "constraintRebalanceOverride": item.get(
                    "constraintRebalanceOverride"
                ),
                "constraintRepairOneWay": _finite(
                    item.get("constraintRepairOneWay"),
                    f"{action_path}/constraintRepairOneWay",
                ),
                "executedConstraintMaximumError": _finite(
                    item.get("executedConstraintMaximumError"),
                    f"{action_path}/executedConstraintMaximumError",
                ),
                "executionReason": item.get("executionReason"),
            }
            if (
                not isinstance(evidence["executionRiskStatus"], str)
                or not evidence["executionRiskStatus"]
                or not isinstance(
                    evidence["executionRiskForecastAvailable"], bool
                )
                or not isinstance(evidence["riskRebalanceOverride"], bool)
                or not isinstance(
                    evidence["constraintRebalanceOverride"], bool
                )
                or not isinstance(evidence["executionReason"], str)
                or not evidence["executionReason"]
                or min(
                    evidence["oneWayTurnover"],
                    evidence["cost"],
                    evidence["grossExposure"],
                    evidence["pretradeRiskForecastAnnualized"],
                    evidence["executedRiskForecastAnnualized"],
                    evidence["executionRiskCeilingAnnualized"],
                    evidence["constraintRepairOneWay"],
                    evidence["executedConstraintMaximumError"],
                )
                < -1e-12
                or evidence["executedConstraintMaximumError"] > 1e-10
            ):
                _fail(
                    action_path,
                    "rl.factor-opportunity-execution",
                    "Opportunity execution evidence is invalid",
                )
            executed = evidence["executedWeights"]
            trades = evidence["trades"]
            for asset in assets:
                _close(
                    trades[asset],
                    executed[asset] - pretrade[asset],
                    f"{action_path}/trades/{asset}",
                    "executed minus pretrade weight",
                    tolerance=1e-10,
                )
            traded_notional = sum(abs(trades[asset]) for asset in assets)
            gross_return = sum(
                executed[asset] * forward[asset] for asset in assets
            )
            gross_exposure = sum(
                abs(executed[asset]) for asset in assets
            )
            net_exposure = sum(executed.values())
            _close(
                evidence["oneWayTurnover"],
                0.5 * traded_notional,
                f"{action_path}/oneWayTurnover",
                "one-way turnover",
                tolerance=1e-10,
            )
            _close(
                evidence["cost"],
                traded_notional * cost_bps / 10_000.0,
                f"{action_path}/cost",
                "transaction cost",
                tolerance=1e-10,
            )
            _close(
                evidence["grossReturn"],
                gross_return,
                f"{action_path}/grossReturn",
                "executed-book gross return",
                tolerance=1e-10,
            )
            _close(
                evidence["netReturn"],
                gross_return - evidence["cost"],
                f"{action_path}/netReturn",
                "net return",
                tolerance=1e-10,
            )
            _close(
                evidence["reward"],
                evidence["netReturn"]
                - risk_aversion * evidence["grossReturn"] ** 2,
                f"{action_path}/reward",
                "fixed reward",
                tolerance=1e-10,
            )
            _close(
                evidence["grossExposure"],
                gross_exposure,
                f"{action_path}/grossExposure",
                "gross exposure",
                tolerance=1e-10,
            )
            _close(
                evidence["netExposure"],
                net_exposure,
                f"{action_path}/netExposure",
                "net exposure",
                tolerance=1e-10,
            )
            actions[action] = evidence
        rewards = {
            action: actions[action]["reward"]
            for action in configuration["actions"]
        }
        ranked = sorted(
            configuration["actions"],
            key=lambda action: (
                -rewards[action],
                configuration["actions"].index(action),
            ),
        )
        selected_action = raw["selectedAction"]
        oracle_action = ranked[0] if decision_eligible else selected_action
        selected_rank = (
            ranked.index(selected_action) + 1
            if decision_eligible
            else 1
        )
        selected_reward = _finite(
            raw.get("selectedReward"),
            f"{path}/selectedReward",
        )
        oracle_reward = _finite(
            raw.get("oracleReward"),
            f"{path}/oracleReward",
        )
        regret = _finite(
            raw.get("realizedRegret"),
            f"{path}/realizedRegret",
        )
        candidate_selected = _finite(
            raw.get("candidateMinusSelectedReward"),
            f"{path}/candidateMinusSelectedReward",
        )
        candidate_balanced = _finite(
            raw.get("candidateMinusBalancedReward"),
            f"{path}/candidateMinusBalancedReward",
        )
        if (
            raw.get("oracleAction") != oracle_action
            or raw.get("selectedRank") != selected_rank
            or raw["oracleHit"] != (selected_action == oracle_action)
            or regret < -1e-12
        ):
            _fail(
                path,
                "rl.factor-opportunity-rank",
                "Opportunity oracle/rank/regret identity is invalid",
            )
        for actual, expected, label in (
            (selected_reward, rewards[selected_action], "selected reward"),
            (oracle_reward, rewards[oracle_action], "oracle reward"),
            (
                regret,
                rewards[oracle_action] - rewards[selected_action],
                "realized regret",
            ),
            (
                candidate_selected,
                rewards["candidate"] - rewards[selected_action],
                "candidate minus selected reward",
            ),
            (
                candidate_balanced,
                rewards["candidate"] - rewards["balanced"],
                "candidate minus balanced reward",
            ),
            (
                selected_reward,
                selected_action_row["reward"],
                "selected action ledger reward",
            ),
        ):
            _close(
                actual,
                expected,
                path,
                label,
                tolerance=1e-10,
            )
        selected_evidence = actions[selected_action]
        for artifact_value, ledger_value, label in (
            (
                selected_evidence["grossReturn"],
                selected_action_row["grossReturn"],
                "selected gross return",
            ),
            (
                selected_evidence["netReturn"],
                selected_action_row["netReturn"],
                "selected net return",
            ),
            (
                selected_evidence["oneWayTurnover"],
                selected_action_row["oneWayTurnover"],
                "selected turnover",
            ),
            (
                selected_evidence["cost"],
                selected_action_row["cost"],
                "selected cost",
            ),
        ):
            _close(
                artifact_value,
                ledger_value,
                path,
                label,
                tolerance=1e-10,
            )
        if (
            selected_evidence["executionRiskStatus"]
            != selected_action_row["executionRiskStatus"]
            or selected_evidence["executionReason"]
            != selected_action_row["executionReason"]
            or selected_evidence["riskRebalanceOverride"]
            != selected_action_row["riskRebalanceOverride"]
            or selected_evidence["constraintRebalanceOverride"]
            != selected_action_row["constraintRebalanceOverride"]
            or not math.isclose(
                selected_evidence["constraintRepairOneWay"],
                selected_action_row["constraintRepairOneWay"],
                rel_tol=0.0,
                abs_tol=1e-10,
            )
            or not math.isclose(
                selected_evidence["executedConstraintMaximumError"],
                selected_action_row["executedConstraintMaximumError"],
                rel_tol=0.0,
                abs_tol=1e-10,
            )
        ):
            _fail(
                path,
                "rl.factor-opportunity-selected",
                "Selected opportunity execution differs from action ledger",
            )
        normalized.append(
            {
                "fold": raw["fold"],
                "seed": raw["seed"],
                "split": raw["split"],
                "timestamp": raw["timestamp"],
                "selectedAction": selected_action,
                "oracleAction": oracle_action,
                "selectedRank": raw["selectedRank"],
                "oracleHit": raw["oracleHit"],
                "selectedReward": selected_reward,
                "oracleReward": oracle_reward,
                "realizedRegret": max(0.0, regret),
                "candidateMinusSelectedReward": candidate_selected,
                "candidateMinusBalancedReward": candidate_balanced,
                "pretradeWeights": pretrade,
                "forwardReturns": forward,
                "actions": actions,
            }
        )
    validation = _opportunity_metrics(
        normalized,
        "validation",
        configuration["actions"],
    )
    test = _opportunity_metrics(
        normalized,
        "test",
        configuration["actions"],
    )
    _compare_policy_metrics(
        raw_metrics["validation"],
        validation,
        "metrics/factor_opportunity/validation",
    )
    _compare_policy_metrics(
        raw_metrics["test"],
        test,
        "metrics/factor_opportunity/test",
    )
    representative: list[dict[str, Any]] = []
    for split in SPLITS:
        split_rows = sorted(
            (row for row in normalized if row["split"] == split),
            key=lambda row: (
                -row["realizedRegret"],
                row["fold"],
                row["seed"],
                row["timestamp"],
            ),
        )[:8]
        for row in split_rows:
            representative.append(
                {
                    "fold": row["fold"],
                    "seed": row["seed"],
                    "split": row["split"],
                    "timestamp": row["timestamp"],
                    "selectedAction": row["selectedAction"],
                    "oracleAction": row["oracleAction"],
                    "selectedRank": row["selectedRank"],
                    "oracleHit": row["oracleHit"],
                    "selectedReward": row["selectedReward"],
                    "oracleReward": row["oracleReward"],
                    "realizedRegret": row["realizedRegret"],
                    "candidateMinusSelectedReward": row[
                        "candidateMinusSelectedReward"
                    ],
                    "candidateMinusBalancedReward": row[
                        "candidateMinusBalancedReward"
                    ],
                    "alternatives": [
                        {
                            "action": action,
                            "reward": row["actions"][action]["reward"],
                            "grossReturn": row["actions"][action][
                                "grossReturn"
                            ],
                            "netReturn": row["actions"][action]["netReturn"],
                            "oneWayTurnover": row["actions"][action][
                                "oneWayTurnover"
                            ],
                            "cost": row["actions"][action]["cost"],
                            "executionReason": row["actions"][action][
                                "executionReason"
                            ],
                            "riskRebalanceOverride": row["actions"][action][
                                "riskRebalanceOverride"
                            ],
                            "constraintRebalanceOverride": row["actions"][
                                action
                            ]["constraintRebalanceOverride"],
                            "constraintRepairOneWay": row["actions"][action][
                                "constraintRepairOneWay"
                            ],
                        }
                        for action in configuration["actions"]
                    ],
                }
            )
    return {
        "available": True,
        "policy": FACTOR_OPPORTUNITY_POLICY,
        "selectionAuthority": "context-only",
        "validation": _opportunity_split_projection(validation),
        "test": _opportunity_split_projection(test),
        "representativeDecisions": representative,
    }


def _incremental_bucket(
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    net = [float(row["netActiveReturn"]) for row in rows]
    active = [value for value in net if abs(value) > 1e-12]
    return {
        "decisions": len(rows),
        "active_decisions": len(active),
        "active_decision_rate": len(active) / len(rows),
        "mean_gross_active_return": sum(
            float(row["grossActiveReturn"]) for row in rows
        )
        / len(rows),
        "total_gross_active_return": sum(
            float(row["grossActiveReturn"]) for row in rows
        ),
        "total_incremental_cost": sum(
            float(row["incrementalCost"]) for row in rows
        ),
        "mean_net_active_return": sum(net) / len(net),
        "total_net_active_return": sum(net),
        "active_win_rate": sum(value > 0.0 for value in net) / len(net),
        "conditional_active_win_rate": (
            sum(value > 0.0 for value in active) / len(active)
            if active
            else 0.0
        ),
    }


def _relative_path_statistics(
    rows: list[dict[str, Any]],
) -> dict[str, float]:
    active = [float(row["netActiveReturn"]) for row in rows]
    mean_active = sum(active) / len(active)
    standard_deviation = math.sqrt(
        sum((value - mean_active) ** 2 for value in active) / len(active)
    )
    periods = annualization_periods(
        [row["timestamp"] for row in rows]
    )
    annualized_active_return = mean_active * periods
    tracking_error = standard_deviation * math.sqrt(periods)
    relative_path = 1.0
    running_peak = 1.0
    maximum_drawdown = 0.0
    for row in rows:
        policy_leg = 1.0 + float(row["policyNetReturn"])
        baseline_leg = 1.0 + float(row["baselineNetReturn"])
        if policy_leg <= 0.0 or baseline_leg <= 0.0:
            _fail(
                "policy-incremental-attribution",
                "rl.incremental-relative-path",
                "Relative-path wealth legs must remain positive",
            )
        relative_path *= policy_leg / baseline_leg
        running_peak = max(running_peak, relative_path)
        maximum_drawdown = min(
            maximum_drawdown,
            relative_path / running_peak - 1.0,
        )
    return {
        "annualized_active_return": annualized_active_return,
        "annualized_tracking_error": tracking_error,
        "information_ratio": (
            annualized_active_return / tracking_error
            if tracking_error > 1e-15
            else 0.0
        ),
        "relative_total_return": relative_path - 1.0,
        "relative_maximum_drawdown": maximum_drawdown,
    }


def _incremental_metrics(
    rows: list[dict[str, Any]],
    split: str,
    assets: list[str],
) -> dict[str, Any]:
    selected = [row for row in rows if row["split"] == split]
    if not selected:
        _fail(
            f"policy-incremental-attribution/{split}",
            "rl.incremental-coverage",
            "Incremental attribution split has no decisions",
        )
    groups: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for row in selected:
        groups[(row["fold"], row["seed"])].append(row)
    base = _incremental_bucket(selected)
    net = [float(row["netActiveReturn"]) for row in selected]
    path_stats = [_relative_path_statistics(group) for group in groups.values()]
    by_asset = {
        asset: {
            "total_gross_active_contribution": sum(
                row["assetGrossContribution"][asset] for row in selected
            ),
            "mean_trial_total_gross_active_contribution": sum(
                row["assetGrossContribution"][asset] for row in selected
            )
            / len(groups),
            "mean_gross_active_contribution": sum(
                row["assetGrossContribution"][asset] for row in selected
            )
            / len(selected),
        }
        for asset in assets
    }
    by_regime: dict[str, dict[str, Any]] = {}
    regime_counts: dict[str, int] = {}
    for dimension, field in {
        "volume": "volumeRegime",
        "trend": "marketTrend",
        "volatility": "volatilityRegime",
    }.items():
        regime_counts[dimension] = 0
        for bucket in sorted({str(row[field]) for row in selected}):
            group = [row for row in selected if row[field] == bucket]
            by_regime[f"{dimension}:{bucket}"] = {
                "dimension": dimension,
                "bucket": bucket,
                **_incremental_bucket(group),
            }
            regime_counts[dimension] += len(group)
    by_action_pair: dict[str, dict[str, Any]] = {}
    for policy_action, baseline_action in sorted(
        {
            (str(row["policyAction"]), str(row["baselineAction"]))
            for row in selected
        }
    ):
        group = [
            row
            for row in selected
            if row["policyAction"] == policy_action
            and row["baselineAction"] == baseline_action
        ]
        by_action_pair[f"{policy_action}->{baseline_action}"] = {
            "policy_action": policy_action,
            "baseline_action": baseline_action,
            **_incremental_bucket(group),
        }
    by_switch_state: dict[str, dict[str, Any]] = {}
    for policy_switched in (False, True):
        for baseline_switched in (False, True):
            group = [
                row
                for row in selected
                if row["policySwitched"] == policy_switched
                and row["baselineSwitched"] == baseline_switched
            ]
            if not group:
                continue
            key = (
                ("policy-switch" if policy_switched else "policy-hold")
                + "/"
                + (
                    "baseline-switch"
                    if baseline_switched
                    else "baseline-hold"
                )
            )
            by_switch_state[key] = {
                "policy_switched": policy_switched,
                "baseline_switched": baseline_switched,
                **_incremental_bucket(group),
            }
    trials = [
        {
            "fold": fold,
            "seed": seed,
            "baseline_name": str(group[0]["baselineName"]),
            "observations": len(group),
            **_incremental_bucket(group),
            **_relative_path_statistics(group),
        }
        for (fold, seed), group in groups.items()
    ]
    reconciliation = {
        "row_count": len(selected),
        "trial_path_count": len(groups),
        "gross_cost_net_error": max(
            abs(
                row["grossActiveReturn"]
                - row["incrementalCost"]
                - row["netActiveReturn"]
            )
            for row in selected
        ),
        "asset_gross_error": max(
            abs(
                sum(row["assetGrossContribution"].values())
                - row["grossActiveReturn"]
            )
            for row in selected
        ),
        "asset_total_error": abs(
            sum(
                value["total_gross_active_contribution"]
                for value in by_asset.values()
            )
            - base["total_gross_active_return"]
        ),
        "action_pair_count_error": abs(
            sum(value["decisions"] for value in by_action_pair.values())
            - len(selected)
        ),
        "switch_state_count_error": abs(
            sum(value["decisions"] for value in by_switch_state.values())
            - len(selected)
        ),
        "regime_count_error": max(
            abs(count - len(selected)) for count in regime_counts.values()
        ),
    }
    reconciliation["passed"] = (
        max(
            float(value)
            for key, value in reconciliation.items()
            if key not in {"row_count", "trial_path_count"}
        )
        <= 1e-10
    )
    return {
        "status": "available",
        "decisions": len(selected),
        "trial_paths": len(groups),
        **base,
        "mean_trial_total_gross_active_return": sum(
            item["total_gross_active_return"] for item in trials
        )
        / len(trials),
        "mean_trial_total_incremental_cost": sum(
            item["total_incremental_cost"] for item in trials
        )
        / len(trials),
        "mean_trial_total_net_active_return": sum(
            item["total_net_active_return"] for item in trials
        )
        / len(trials),
        "annualized_active_return": sum(
            item["annualized_active_return"] for item in path_stats
        )
        / len(path_stats),
        "annualized_tracking_error": sum(
            item["annualized_tracking_error"] for item in path_stats
        )
        / len(path_stats),
        "information_ratio": sum(
            item["information_ratio"] for item in path_stats
        )
        / len(path_stats),
        "relative_total_return": sum(
            item["relative_total_return"] for item in path_stats
        )
        / len(path_stats),
        "relative_maximum_drawdown": sum(
            item["relative_maximum_drawdown"] for item in path_stats
        )
        / len(path_stats),
        "p05_net_active_return": _linear_percentile(net, 0.05),
        "median_net_active_return": _median(net),
        "p95_net_active_return": _linear_percentile(net, 0.95),
        "worst_net_active_return": min(net),
        "best_net_active_return": max(net),
        "actions_differ_rate": sum(
            row["actionsDiffer"] for row in selected
        )
        / len(selected),
        "policy_switch_rate": sum(
            row["policySwitched"] for row in selected
        )
        / len(selected),
        "baseline_switch_rate": sum(
            row["baselineSwitched"] for row in selected
        )
        / len(selected),
        "by_asset": by_asset,
        "by_regime": by_regime,
        "by_action_pair": by_action_pair,
        "by_switch_state": by_switch_state,
        "trials": trials,
        "reconciliation": reconciliation,
    }


def _incremental_split_projection(
    value: dict[str, Any],
) -> dict[str, Any]:
    return {
        "status": value["status"],
        "decisions": value["decisions"],
        "activeDecisions": value["active_decisions"],
        "activeDecisionRate": value["active_decision_rate"],
        "trialPaths": value["trial_paths"],
        "meanGrossActiveReturn": value["mean_gross_active_return"],
        "totalGrossActiveReturn": value["total_gross_active_return"],
        "totalIncrementalCost": value["total_incremental_cost"],
        "meanNetActiveReturn": value["mean_net_active_return"],
        "totalNetActiveReturn": value["total_net_active_return"],
        "meanTrialTotalGrossActiveReturn": value[
            "mean_trial_total_gross_active_return"
        ],
        "meanTrialTotalIncrementalCost": value[
            "mean_trial_total_incremental_cost"
        ],
        "meanTrialTotalNetActiveReturn": value[
            "mean_trial_total_net_active_return"
        ],
        "annualizedActiveReturn": value["annualized_active_return"],
        "annualizedTrackingError": value["annualized_tracking_error"],
        "informationRatio": value["information_ratio"],
        "relativeTotalReturn": value["relative_total_return"],
        "relativeMaximumDrawdown": value["relative_maximum_drawdown"],
        "activeWinRate": value["active_win_rate"],
        "conditionalActiveWinRate": value[
            "conditional_active_win_rate"
        ],
        "p05NetActiveReturn": value["p05_net_active_return"],
        "medianNetActiveReturn": value["median_net_active_return"],
        "p95NetActiveReturn": value["p95_net_active_return"],
        "worstNetActiveReturn": value["worst_net_active_return"],
        "bestNetActiveReturn": value["best_net_active_return"],
        "actionsDifferRate": value["actions_differ_rate"],
        "policySwitchRate": value["policy_switch_rate"],
        "baselineSwitchRate": value["baseline_switch_rate"],
        "byAsset": [
            {
                "asset": asset,
                "totalGrossActiveContribution": item[
                    "total_gross_active_contribution"
                ],
                "meanTrialTotalGrossActiveContribution": item[
                    "mean_trial_total_gross_active_contribution"
                ],
                "meanGrossActiveContribution": item[
                    "mean_gross_active_contribution"
                ],
            }
            for asset, item in value["by_asset"].items()
        ],
        "byRegime": [
            {
                "key": key,
                "dimension": item["dimension"],
                "bucket": item["bucket"],
                "decisions": item["decisions"],
                "activeDecisions": item["active_decisions"],
                "activeDecisionRate": item["active_decision_rate"],
                "meanGrossActiveReturn": item[
                    "mean_gross_active_return"
                ],
                "totalGrossActiveReturn": item[
                    "total_gross_active_return"
                ],
                "totalIncrementalCost": item["total_incremental_cost"],
                "meanNetActiveReturn": item["mean_net_active_return"],
                "totalNetActiveReturn": item["total_net_active_return"],
                "activeWinRate": item["active_win_rate"],
                "conditionalActiveWinRate": item[
                    "conditional_active_win_rate"
                ],
            }
            for key, item in value["by_regime"].items()
        ],
        "byActionPair": [
            {
                "key": key,
                "policyAction": item["policy_action"],
                "baselineAction": item["baseline_action"],
                "decisions": item["decisions"],
                "activeDecisions": item["active_decisions"],
                "meanNetActiveReturn": item["mean_net_active_return"],
                "totalNetActiveReturn": item["total_net_active_return"],
                "activeWinRate": item["active_win_rate"],
                "conditionalActiveWinRate": item[
                    "conditional_active_win_rate"
                ],
            }
            for key, item in value["by_action_pair"].items()
        ],
        "bySwitchState": [
            {
                "key": key,
                "policySwitched": item["policy_switched"],
                "baselineSwitched": item["baseline_switched"],
                "decisions": item["decisions"],
                "activeDecisions": item["active_decisions"],
                "totalIncrementalCost": item["total_incremental_cost"],
                "meanNetActiveReturn": item["mean_net_active_return"],
                "totalNetActiveReturn": item["total_net_active_return"],
                "activeWinRate": item["active_win_rate"],
                "conditionalActiveWinRate": item[
                    "conditional_active_win_rate"
                ],
            }
            for key, item in value["by_switch_state"].items()
        ],
        "trials": [
            {
                "fold": item["fold"],
                "seed": item["seed"],
                "baselineName": item["baseline_name"],
                "observations": item["observations"],
                "activeDecisions": item["active_decisions"],
                "activeDecisionRate": item["active_decision_rate"],
                "totalGrossActiveReturn": item[
                    "total_gross_active_return"
                ],
                "totalIncrementalCost": item["total_incremental_cost"],
                "totalNetActiveReturn": item["total_net_active_return"],
                "activeWinRate": item["active_win_rate"],
                "conditionalActiveWinRate": item[
                    "conditional_active_win_rate"
                ],
                "annualizedActiveReturn": item[
                    "annualized_active_return"
                ],
                "annualizedTrackingError": item[
                    "annualized_tracking_error"
                ],
                "informationRatio": item["information_ratio"],
                "relativeTotalReturn": item["relative_total_return"],
                "relativeMaximumDrawdown": item[
                    "relative_maximum_drawdown"
                ],
            }
            for item in value["trials"]
        ],
        "reconciliation": value["reconciliation"],
    }


def _factor_fusion_diagnosis(
    factor_fusion: dict[str, Any],
    opportunity: dict[str, Any],
    incremental: dict[str, Any],
    trials: list[dict[str, Any]],
    baselines: list[dict[str, Any]],
    mean_validation_advantage: float,
    mean_test_advantage: float,
) -> dict[str, Any]:
    """Join verified local and full-path evidence into one bounded diagnosis."""

    base = {
        "method": FACTOR_FUSION_DIAGNOSIS_METHOD,
        "authority": "research-prioritization-only",
        "tradingAuthority": "none",
    }
    if not factor_fusion["available"]:
        return {
            **base,
            "available": False,
            "reason": "candidate-factor-fusion-unavailable",
        }
    if not opportunity["available"] or not incremental["available"]:
        return {
            **base,
            "available": False,
            "reason": "required-verified-evidence-unavailable",
        }

    selected_baselines = [
        item for item in baselines if item["selectedOnValidation"]
    ]
    balanced_baselines = [
        item for item in baselines if item["name"] == "fixed:balanced"
    ]
    if not selected_baselines or len(selected_baselines) != len(
        balanced_baselines
    ):
        _fail(
            "factorFusionDiagnosis/baselines",
            "rl.fusion-diagnosis-baselines",
            "Fusion diagnosis requires one selected and balanced baseline per fold",
        )

    def split_projection(
        split: str,
        role: str,
        candidate_summary: dict[str, Any],
        sharpe_advantage: float,
    ) -> dict[str, Any]:
        opportunity_split = opportunity[split]
        incremental_split = incremental[split]
        candidate = opportunity_split["candidate"]
        baseline_field = "validation" if split == "validation" else "test"
        balanced_sharpe = sum(
            item[baseline_field]["netSharpe"]
            for item in balanced_baselines
        ) / len(balanced_baselines)
        selected_baseline_sharpe = sum(
            item[baseline_field]["netSharpe"]
            for item in selected_baselines
        ) / len(selected_baselines)
        candidate_sharpe = candidate_summary["mean"]
        candidate_delta = candidate_sharpe - balanced_sharpe
        local_delta = candidate["meanVsBalancedReward"]
        if candidate_delta > 0.0 and local_delta > 0.0:
            candidate_assessment = "standalone-and-local-positive"
        elif candidate_delta > 0.0:
            candidate_assessment = "standalone-positive-local-nondominant"
        elif local_delta > 0.0:
            candidate_assessment = "local-opportunity-without-standalone-edge"
        else:
            candidate_assessment = "candidate-edge-absent"

        split_trials = [
            {
                "fold": item["fold"],
                "seed": item["seed"],
                "grossActiveReturn": incremental_trial[
                    "totalGrossActiveReturn"
                ],
                "netActiveReturn": incremental_trial[
                    "totalNetActiveReturn"
                ],
                "sharpeAdvantage": (
                    item["validationAdvantage"]
                    if split == "validation"
                    else item["testAdvantage"]
                ),
            }
            for item in trials
            for incremental_trial in incremental_split["trials"]
            if (
                item["fold"] == incremental_trial["fold"]
                and item["seed"] == incremental_trial["seed"]
            )
        ]
        if len(split_trials) != len(trials):
            _fail(
                f"factorFusionDiagnosis/{split}/trials",
                "rl.fusion-diagnosis-trials",
                "Fusion diagnosis trial identities do not reconcile",
            )
        net_values = [item["netActiveReturn"] for item in split_trials]
        mean_net = sum(net_values) / len(net_values)
        net_standard_deviation = math.sqrt(
            sum((value - mean_net) ** 2 for value in net_values)
            / len(net_values)
        )
        worst_trial = min(
            split_trials,
            key=lambda item: (
                item["netActiveReturn"],
                item["fold"],
                item["seed"],
            ),
        )
        worst_regime = min(
            incremental_split["byRegime"],
            key=lambda item: (
                item["totalNetActiveReturn"],
                item["key"],
            ),
        )
        worst_pair = min(
            incremental_split["byActionPair"],
            key=lambda item: (
                item["totalNetActiveReturn"],
                item["key"],
            ),
        )
        worst_switch = min(
            incremental_split["bySwitchState"],
            key=lambda item: (
                item["totalNetActiveReturn"],
                item["key"],
            ),
        )
        worst_asset = min(
            incremental_split["byAsset"],
            key=lambda item: (
                item["totalGrossActiveContribution"],
                item["asset"],
            ),
        )
        return {
            "role": role,
            "candidateFactor": {
                "assessment": candidate_assessment,
                "fixedSleeveNetSharpe": candidate_sharpe,
                "balancedFixedSleeveNetSharpe": balanced_sharpe,
                "fixedSleeveSharpeDeltaVsBalanced": candidate_delta,
                "selectedFrequency": candidate["selectedFrequency"],
                "localBestFrequency": candidate["oracleFrequency"],
                "oracleCaptureRate": candidate["oracleCaptureRate"],
                "missedOpportunityRate": candidate[
                    "missedOpportunityRate"
                ],
                "meanLocalRewardDeltaVsBalanced": local_delta,
                "meanLocalRewardDeltaVsSelected": candidate[
                    "meanVsSelectedReward"
                ],
            },
            "policySelection": {
                "selectedBaselineMeanNetSharpe": selected_baseline_sharpe,
                "oracleHitRate": opportunity_split["oracleHitRate"],
                "meanSelectedRank": opportunity_split["meanSelectedRank"],
                "meanOneStepRealizedRegret": opportunity_split[
                    "meanRealizedRegret"
                ],
            },
            "adaptiveTransmission": {
                "meanTrialGrossActiveReturn": incremental_split[
                    "meanTrialTotalGrossActiveReturn"
                ],
                "meanTrialIncrementalCost": incremental_split[
                    "meanTrialTotalIncrementalCost"
                ],
                "meanTrialNetActiveReturn": incremental_split[
                    "meanTrialTotalNetActiveReturn"
                ],
                "meanSharpeAdvantageVsSelectedBaseline": sharpe_advantage,
                "informationRatio": incremental_split["informationRatio"],
                "activeDecisionRate": incremental_split[
                    "activeDecisionRate"
                ],
                "conditionalActiveWinRate": incremental_split[
                    "conditionalActiveWinRate"
                ],
                "actionsDifferRate": incremental_split["actionsDifferRate"],
                "policySwitchRate": incremental_split["policySwitchRate"],
                "baselineSwitchRate": incremental_split[
                    "baselineSwitchRate"
                ],
            },
            "stability": {
                "trialPaths": len(split_trials),
                "positiveGrossTrialRate": sum(
                    item["grossActiveReturn"] > 0.0
                    for item in split_trials
                )
                / len(split_trials),
                "positiveNetTrialRate": sum(
                    item["netActiveReturn"] > 0.0
                    for item in split_trials
                )
                / len(split_trials),
                "positiveSharpeAdvantageTrialRate": sum(
                    item["sharpeAdvantage"] > 0.0
                    for item in split_trials
                )
                / len(split_trials),
                "netActiveReturnStandardDeviation": (
                    net_standard_deviation
                ),
                "worstTrial": worst_trial,
            },
            "lossLocator": {
                "worstRegime": {
                    "key": worst_regime["key"],
                    "decisions": worst_regime["decisions"],
                    "totalNetActiveReturn": worst_regime[
                        "totalNetActiveReturn"
                    ],
                },
                "worstActionPair": {
                    "key": worst_pair["key"],
                    "decisions": worst_pair["decisions"],
                    "totalNetActiveReturn": worst_pair[
                        "totalNetActiveReturn"
                    ],
                },
                "worstSwitchState": {
                    "key": worst_switch["key"],
                    "decisions": worst_switch["decisions"],
                    "totalNetActiveReturn": worst_switch[
                        "totalNetActiveReturn"
                    ],
                },
                "worstAssetGrossContribution": {
                    "asset": worst_asset["asset"],
                    "totalGrossActiveContribution": worst_asset[
                        "totalGrossActiveContribution"
                    ],
                },
            },
            "reconciliation": {
                "incrementalAttributionPassed": incremental_split[
                    "reconciliation"
                ]["passed"],
                "factorOpportunityPassed": opportunity_split[
                    "reconciliation"
                ]["passed"],
                "trialPathsReconciled": len(split_trials) == len(trials),
            },
        }

    validation = split_projection(
        "validation",
        "selection",
        factor_fusion["candidateValidation"],
        mean_validation_advantage,
    )
    test = split_projection(
        "test",
        "visible-audit",
        factor_fusion["candidateTestAudit"],
        mean_test_advantage,
    )
    transmission = validation["adaptiveTransmission"]
    positive_net_trial_rate = validation["stability"][
        "positiveNetTrialRate"
    ]
    candidate_assessment = validation["candidateFactor"]["assessment"]
    missed_candidate = validation["candidateFactor"][
        "missedOpportunityRate"
    ]
    if transmission["meanTrialGrossActiveReturn"] <= 0.0:
        stage = "adaptive-book-selection-negative"
        if candidate_assessment == "candidate-edge-absent":
            focus = "factor-sleeve-research"
        elif missed_candidate > 0.0:
            focus = "policy-state-and-candidate-capture"
        else:
            focus = "adaptive-book-selection"
        explanation = (
            "Validation adaptive gross active return is non-positive versus "
            "the selected mechanical baseline; implementation cost is not "
            "the first demonstrated failure."
        )
    elif transmission["meanTrialNetActiveReturn"] <= 0.0:
        stage = "implementation-cost-destroys-edge"
        focus = "switch-persistence-and-turnover"
        explanation = (
            "Validation adaptive gross active return is positive but "
            "incremental implementation cost leaves non-positive net active "
            "return."
        )
    elif transmission["meanSharpeAdvantageVsSelectedBaseline"] <= 0.0:
        stage = "risk-adjusted-adaptive-value-absent"
        focus = "active-risk-and-drawdown-control"
        explanation = (
            "Validation net active return is positive but the frozen policy "
            "does not beat the selected mechanical baseline on net Sharpe."
        )
    elif positive_net_trial_rate < 0.5:
        stage = "seed-fold-unstable"
        focus = "train-only-learning-stability"
        explanation = (
            "Aggregate validation adaptive value is positive but fewer than "
            "half of seed/fold trial paths have positive net active return."
        )
    else:
        stage = "adaptive-value-positive"
        focus = "external-holdout-and-capacity"
        explanation = (
            "Validation adaptive gross, net, risk-adjusted, and trial-breadth "
            "evidence is positive; prioritize fresh external holdout and "
            "capacity evidence."
        )
    return {
        **base,
        "available": True,
        "reason": None,
        "semantics": {
            "localOpportunity": (
                "same-pretrade-one-step-ex-post-audit"
            ),
            "adaptiveTransmission": "independent-full-policy-paths",
            "candidateFactorSource": "content-locked-study-dependency",
            "selectionSplit": "validation",
            "testEntersDiagnosis": False,
            "entersTraining": False,
            "entersSelection": False,
        },
        "diagnosis": {
            "selectionSplit": "validation",
            "testEntersDiagnosis": False,
            "stage": stage,
            "iterationFocus": focus,
            "explanation": explanation,
        },
        "validation": validation,
        "testAudit": test,
    }


def _incremental_attribution_projection(
    value: dict[str, Any] | None,
    raw_metrics: Any,
    action_rows: list[dict[str, Any]],
    configuration: dict[str, Any],
    assets: list[str],
    input_hash: str,
    selected_baselines: dict[tuple[str, int], str],
) -> dict[str, Any]:
    unavailable = {
        "available": False,
        "policy": None,
        "selectionAuthority": "context-only",
        "validation": None,
        "test": None,
        "representativeDays": [],
    }
    if value is None and raw_metrics is None:
        return unavailable
    if value is None or not isinstance(raw_metrics, dict):
        _fail(
            "RunResult/metrics/incremental_attribution",
            "rl.incremental-attribution",
            "Incremental metrics and artifact must exist together",
        )
    root_fields = {
        "schemaVersion",
        "inputHash",
        "method",
        "assets",
        "policy",
        "thresholds",
        "rows",
    }
    if (
        set(value) != root_fields
        or value.get("schemaVersion") != SCHEMA_VERSION
        or value.get("inputHash") != input_hash
        or value.get("method") != INCREMENTAL_ATTRIBUTION_POLICY["method"]
        or value.get("assets") != assets
        or value.get("policy") != INCREMENTAL_ATTRIBUTION_POLICY
        or set(raw_metrics) != {"policy", "validation", "test"}
        or raw_metrics.get("policy") != INCREMENTAL_ATTRIBUTION_POLICY
        or not isinstance(value.get("rows"), list)
        or len(value["rows"]) != len(action_rows)
    ):
        _fail(
            "policy-incremental-attribution",
            "rl.incremental-identity",
            "Incremental attribution identity differs from the fixed Run",
        )
    thresholds = value.get("thresholds")
    if (
        not isinstance(thresholds, dict)
        or set(thresholds) != set(configuration["folds"])
    ):
        _fail(
            "policy-incremental-attribution/thresholds",
            "rl.incremental-thresholds",
            "Incremental attribution thresholds differ from folds",
        )
    normalized_thresholds: dict[str, float] = {}
    for fold in configuration["folds"]:
        item = thresholds[fold]
        if not isinstance(item, dict) or set(item) != {
            "marketVolatility20Median"
        }:
            _fail(
                f"policy-incremental-attribution/thresholds/{fold}",
                "rl.incremental-thresholds",
                "Volatility threshold shape is invalid",
            )
        normalized_thresholds[fold] = _finite(
            item["marketVolatility20Median"],
            f"policy-incremental-attribution/thresholds/{fold}",
        )
    row_fields = {
        "fold",
        "seed",
        "split",
        "timestamp",
        "baselineName",
        "policyAction",
        "baselineAction",
        "policySwitched",
        "baselineSwitched",
        "actionsDiffer",
        "volumeRegimeValue",
        "marketReturn5",
        "marketVolatility20",
        "volumeRegime",
        "marketTrend",
        "volatilityRegime",
        "policyGrossReturn",
        "baselineGrossReturn",
        "grossActiveReturn",
        "policyNetReturn",
        "baselineNetReturn",
        "incrementalCost",
        "netActiveReturn",
        "policyReward",
        "baselineReward",
        "rewardDelta",
        "policyOneWayTurnover",
        "baselineOneWayTurnover",
        "oneWayTurnoverDelta",
        "assetGrossContribution",
    }
    numeric_fields = {
        "volumeRegimeValue",
        "marketReturn5",
        "marketVolatility20",
        "policyGrossReturn",
        "baselineGrossReturn",
        "grossActiveReturn",
        "policyNetReturn",
        "baselineNetReturn",
        "incrementalCost",
        "netActiveReturn",
        "policyReward",
        "baselineReward",
        "rewardDelta",
        "policyOneWayTurnover",
        "baselineOneWayTurnover",
        "oneWayTurnoverDelta",
    }
    normalized: list[dict[str, Any]] = []
    previous: dict[tuple[str, int, str], dict[str, Any]] = {}
    for index, (raw, action_row) in enumerate(
        zip(value["rows"], action_rows)
    ):
        path = f"policy-incremental-attribution/rows/{index}"
        if not isinstance(raw, dict) or set(raw) != row_fields:
            _fail(
                path,
                "rl.incremental-row",
                "Incremental attribution row shape is invalid",
            )
        key = (
            raw.get("fold"),
            raw.get("seed"),
            raw.get("split"),
            raw.get("timestamp"),
        )
        action_key = (
            action_row["fold"],
            action_row["seed"],
            action_row["split"],
            action_row["timestamp"],
        )
        if key != action_key:
            _fail(
                path,
                "rl.incremental-order",
                "Incremental attribution chronology differs from actions",
            )
        fold, seed, split, _ = key
        if (
            raw.get("baselineName")
            != selected_baselines.get((fold, seed))
            or raw.get("policyAction") != action_row["action"]
            or raw.get("policyAction") not in configuration["actions"]
            or raw.get("baselineAction") not in configuration["actions"]
            or not all(
                isinstance(raw.get(field), bool)
                for field in (
                    "policySwitched",
                    "baselineSwitched",
                    "actionsDiffer",
                )
            )
        ):
            _fail(
                path,
                "rl.incremental-action",
                "Incremental action or baseline identity is invalid",
            )
        numbers = {
            field: _finite(raw.get(field), f"{path}/{field}")
            for field in numeric_fields
        }
        contribution_raw = raw.get("assetGrossContribution")
        if (
            not isinstance(contribution_raw, dict)
            or set(contribution_raw) != set(assets)
        ):
            _fail(
                f"{path}/assetGrossContribution",
                "rl.incremental-assets",
                "Incremental asset contribution universe differs",
            )
        contributions = {
            asset: _finite(
                contribution_raw[asset],
                f"{path}/assetGrossContribution/{asset}",
            )
            for asset in assets
        }
        expected_volume = (
            "below-trend"
            if numbers["volumeRegimeValue"] < 0.0
            else "above-trend"
        )
        expected_trend = (
            "negative"
            if numbers["marketReturn5"] < 0.0
            else "nonnegative"
        )
        expected_volatility = (
            "low"
            if numbers["marketVolatility20"]
            < normalized_thresholds[fold]
            else "high"
        )
        group_key = (fold, int(seed), split)
        prior = previous.get(group_key)
        expected_policy_switch = (
            prior is not None
            and prior["policyAction"] != raw["policyAction"]
        )
        expected_baseline_switch = (
            prior is not None
            and prior["baselineAction"] != raw["baselineAction"]
        )
        if (
            raw.get("volumeRegime") != expected_volume
            or raw.get("marketTrend") != expected_trend
            or raw.get("volatilityRegime") != expected_volatility
            or raw["actionsDiffer"]
            != (raw["policyAction"] != raw["baselineAction"])
            or raw["policySwitched"] != expected_policy_switch
            or raw["baselineSwitched"] != expected_baseline_switch
        ):
            _fail(
                path,
                "rl.incremental-bucket",
                "Incremental state/action bucket is inconsistent",
            )
        for field, action_field in (
            ("policyGrossReturn", "grossReturn"),
            ("policyNetReturn", "netReturn"),
            ("policyReward", "reward"),
            ("policyOneWayTurnover", "oneWayTurnover"),
        ):
            _close(
                numbers[field],
                action_row[action_field],
                f"{path}/{field}",
                "policy action ledger",
                tolerance=1e-10,
            )
        _close(
            numbers["grossActiveReturn"],
            numbers["policyGrossReturn"] - numbers["baselineGrossReturn"],
            f"{path}/grossActiveReturn",
            "gross active return",
            tolerance=1e-10,
        )
        _close(
            numbers["incrementalCost"],
            action_row["cost"]
            - (
                numbers["baselineGrossReturn"]
                - numbers["baselineNetReturn"]
            ),
            f"{path}/incrementalCost",
            "incremental cost",
            tolerance=1e-10,
        )
        _close(
            numbers["netActiveReturn"],
            numbers["grossActiveReturn"] - numbers["incrementalCost"],
            f"{path}/netActiveReturn",
            "net active return",
            tolerance=1e-10,
        )
        _close(
            numbers["rewardDelta"],
            numbers["policyReward"] - numbers["baselineReward"],
            f"{path}/rewardDelta",
            "reward delta",
            tolerance=1e-10,
        )
        _close(
            numbers["oneWayTurnoverDelta"],
            numbers["policyOneWayTurnover"]
            - numbers["baselineOneWayTurnover"],
            f"{path}/oneWayTurnoverDelta",
            "turnover delta",
            tolerance=1e-10,
        )
        _close(
            sum(contributions.values()),
            numbers["grossActiveReturn"],
            f"{path}/assetGrossContribution",
            "asset gross contribution",
            tolerance=1e-10,
        )
        normalized_row = {
            "fold": fold,
            "seed": int(seed),
            "split": split,
            "timestamp": raw["timestamp"],
            "baselineName": raw["baselineName"],
            "policyAction": raw["policyAction"],
            "baselineAction": raw["baselineAction"],
            "policySwitched": raw["policySwitched"],
            "baselineSwitched": raw["baselineSwitched"],
            "actionsDiffer": raw["actionsDiffer"],
            "volumeRegime": raw["volumeRegime"],
            "marketTrend": raw["marketTrend"],
            "volatilityRegime": raw["volatilityRegime"],
            "assetGrossContribution": contributions,
            **numbers,
        }
        normalized.append(normalized_row)
        previous[group_key] = normalized_row
    validation = _incremental_metrics(normalized, "validation", assets)
    test = _incremental_metrics(normalized, "test", assets)
    _compare_policy_metrics(
        raw_metrics["validation"],
        validation,
        "metrics/incremental_attribution/validation",
    )
    _compare_policy_metrics(
        raw_metrics["test"],
        test,
        "metrics/incremental_attribution/test",
    )
    representative: list[dict[str, Any]] = []
    for split in SPLITS:
        ordered = sorted(
            (row for row in normalized if row["split"] == split),
            key=lambda row: (
                row["netActiveReturn"],
                row["fold"],
                row["seed"],
                row["timestamp"],
            ),
        )
        for row in [*ordered[:6], *ordered[-6:]]:
            representative.append(
                {
                    "fold": row["fold"],
                    "seed": row["seed"],
                    "split": row["split"],
                    "timestamp": row["timestamp"],
                    "baselineName": row["baselineName"],
                    "policyAction": row["policyAction"],
                    "baselineAction": row["baselineAction"],
                    "grossActiveReturn": row["grossActiveReturn"],
                    "incrementalCost": row["incrementalCost"],
                    "netActiveReturn": row["netActiveReturn"],
                    "policySwitched": row["policySwitched"],
                    "baselineSwitched": row["baselineSwitched"],
                    "volumeRegime": row["volumeRegime"],
                    "marketTrend": row["marketTrend"],
                    "volatilityRegime": row["volatilityRegime"],
                }
            )
    return {
        "available": True,
        "policy": INCREMENTAL_ATTRIBUTION_POLICY,
        "selectionAuthority": "context-only",
        "validation": _incremental_split_projection(validation),
        "test": _incremental_split_projection(test),
        "representativeDays": representative,
    }


def _execution_risk_projection(
    metrics: dict[str, Any],
    action_summaries: list[dict[str, Any]],
    action_rows: list[dict[str, Any]],
    mandate: dict[str, Any],
) -> dict[str, Any]:
    raw = metrics.get("execution_risk")
    has_actions = any(
        summary["executionRisk"]["available"]
        for summary in action_summaries
    )
    if raw is None and not has_actions:
        return {
            "available": False,
            "policy": None,
            "selectionAuthority": "context-only",
            "validation": None,
            "test": None,
        }
    if not isinstance(raw, dict) or not has_actions:
        _fail(
            "RunResult/metrics/execution_risk",
            "rl.execution-risk",
            "RL execution-risk metrics and action evidence must exist together",
        )
    expected_policy = {
        "method": (
            "post-drift-executed-book-volatility-compliance-v1"
        ),
        "risk_policy": mandate["riskPolicy"],
        "no_trade_priority": "risk-compliance-first",
        "repair": "minimum-proportional-scale-down",
        "selection_authority": "context-only",
        "trading_authority": "none",
    }
    policy = raw.get("policy")
    if policy != expected_policy:
        _fail(
            "RunResult/metrics/execution_risk/policy",
            "rl.execution-risk-policy",
            "RL execution-risk policy differs from the Portfolio Mandate",
        )
    projection: dict[str, Any] = {
        "available": True,
        "policy": {
            "method": policy["method"],
            "riskPolicy": policy["risk_policy"],
            "noTradePriority": policy["no_trade_priority"],
            "repair": policy["repair"],
            "selectionAuthority": policy["selection_authority"],
            "tradingAuthority": policy["trading_authority"],
        },
        "selectionAuthority": "context-only",
    }
    for split in SPLITS:
        items = [
            summary["executionRisk"]
            for summary in action_summaries
            if summary["split"] == split
        ]
        active = sum(item["activeDates"] for item in items)
        available = sum(item["forecastAvailableDates"] for item in items)
        derived = {
            "status": (
                "available" if available else "forecast_unavailable"
            ),
            "trial_paths": len(items),
            "active_dates": active,
            "forecast_available_dates": available,
            "forecast_coverage": available / active if active else 0.0,
            "pretrade_breach_dates": sum(
                item["pretradeBreachDates"] for item in items
            ),
            "risk_rebalance_override_dates": sum(
                item["riskRebalanceOverrideDates"] for item in items
            ),
            "executed_breach_dates": sum(
                item["executedBreachDates"] for item in items
            ),
            "maximum_executed_forecast_annualized": max(
                (
                    item["maximumExecutedForecastAnnualized"]
                    for item in items
                ),
                default=0.0,
            ),
            "maximum_ceiling_error": max(
                (item["maximumCeilingError"] for item in items),
                default=0.0,
            ),
        }
        actual = raw.get(split)
        if not isinstance(actual, dict) or set(actual) != set(derived):
            _fail(
                f"RunResult/metrics/execution_risk/{split}",
                "rl.execution-risk",
                "RL aggregate execution-risk shape differs from action evidence",
            )
        for key, value in derived.items():
            if isinstance(value, float):
                _close(
                    actual[key],
                    value,
                    f"metrics/execution_risk/{split}/{key}",
                    "aggregate executed-book risk",
                )
            elif actual[key] != value:
                _fail(
                    f"metrics/execution_risk/{split}/{key}",
                    "rl.reconciliation",
                    "RL aggregate execution risk does not reconcile",
                )
        projection[split] = {
            "status": derived["status"],
            "trialPaths": derived["trial_paths"],
            "activeDates": derived["active_dates"],
            "forecastAvailableDates": derived[
                "forecast_available_dates"
            ],
            "forecastCoverage": derived["forecast_coverage"],
            "pretradeBreachDates": derived[
                "pretrade_breach_dates"
            ],
            "riskRebalanceOverrideDates": derived[
                "risk_rebalance_override_dates"
            ],
            "executedBreachDates": derived[
                "executed_breach_dates"
            ],
            "maximumExecutedForecastAnnualized": derived[
                "maximum_executed_forecast_annualized"
            ],
            "maximumCeilingError": derived["maximum_ceiling_error"],
        }
        split_rows = [
            row for row in action_rows if row["split"] == split
        ]
        projection[split].update(
            {
                "constraintRebalanceOverrideDates": sum(
                    row["constraintRebalanceOverride"]
                    for row in split_rows
                ),
                "constraintOnlyOverrideDates": sum(
                    row["constraintRebalanceOverride"]
                    and not row["riskRebalanceOverride"]
                    for row in split_rows
                ),
                "jointConstraintRiskOverrideDates": sum(
                    row["constraintRebalanceOverride"]
                    and row["riskRebalanceOverride"]
                    for row in split_rows
                ),
                "constraintRepairOneWay": sum(
                    row["constraintRepairOneWay"]
                    for row in split_rows
                ),
                "executedConstraintBreachDates": sum(
                    row["executedConstraintMaximumError"] > 1e-10
                    for row in split_rows
                ),
                "maximumExecutedConstraintError": max(
                    (
                        row["executedConstraintMaximumError"]
                        for row in split_rows
                    ),
                    default=0.0,
                ),
            }
        )
    return projection


def load_rl_diagnostics(
    project: ProjectContext,
    run_id: str,
    *,
    point_limit: int = DEFAULT_RL_POINTS,
) -> dict[str, Any]:
    """Verify and project one immutable governed RL Run."""

    if (
        not isinstance(point_limit, int)
        or isinstance(point_limit, bool)
        or not MIN_RL_POINTS <= point_limit <= MAX_RL_POINTS
    ):
        _fail(
            point_limit,
            "rl.point-limit",
            f"point_limit must be {MIN_RL_POINTS}..{MAX_RL_POINTS}",
        )
    run = load_run(project, run_id)
    if run.result["objective"]["metric"] != "validation_mean_net_sharpe":
        _fail(run.root_dir, "rl.run-kind", "Run is not a governed RL policy evaluation")
    paths, artifacts = _artifact_paths(run)
    report = _read_object(paths["rl-report"], "RL report")
    models_value = _read_object(paths["policy-models"], "Policy models")
    histories_value = _read_object(paths["training-history"], "Training history")
    for label, value, path in (
        ("report", report, paths["rl-report"]),
        ("models", models_value, paths["policy-models"]),
        ("training history", histories_value, paths["training-history"]),
    ):
        if value.get("schemaVersion") != SCHEMA_VERSION:
            _fail(path, "rl.schema-version", f"RL {label} schema version differs")
    if report.get("inputHash") != run.result["inputHash"]:
        _fail(paths["rl-report"], "rl.report-identity", "Report input identity differs from RunResult")
    if report.get("metrics") != run.result["metrics"]:
        _fail(paths["rl-report"], "rl.report-metrics", "Report metrics differ from immutable RunResult")
    report_dataset = report.get("dataset")
    if (
        not isinstance(report_dataset, dict)
        or report_dataset.get("id") != run.result["dataset"].get("id")
        or report_dataset.get("version") != run.result["dataset"].get("version")
        or report_dataset.get("universe") != run.result["dataset"].get("universe")
    ):
        _fail(paths["rl-report"], "rl.report-dataset", "Report dataset differs from RunResult")
    semantics = report.get("semantics")
    if not isinstance(semantics, dict) or semantics.get("tradingAuthority") != "none":
        _fail(paths["rl-report"], "rl.semantics", "RL report must preserve no-trading authority")

    metrics = run.result["metrics"]
    configuration = _configuration(metrics)
    has_candidate_fusion = "candidate" in configuration["actions"]
    factor_experts = configuration.get(
        "factorExperts",
        [
            action
            for action in configuration["actions"]
            if action != "balanced"
        ],
    )
    models, contextual_baselines = _models(
        models_value,
        configuration,
        run.result["inputHash"],
    )
    rationale_value = (
        _read_object(
            paths[POLICY_RATIONALE_ARTIFACT_KIND],
            "Policy rationales",
        )
        if POLICY_RATIONALE_ARTIFACT_KIND in paths
        else None
    )
    opportunity_value = (
        _read_object(
            paths[POLICY_OPPORTUNITY_ARTIFACT_KIND],
            "Policy opportunities",
        )
        if POLICY_OPPORTUNITY_ARTIFACT_KIND in paths
        else None
    )
    incremental_value = (
        _read_object(
            paths[POLICY_INCREMENTAL_ATTRIBUTION_ARTIFACT_KIND],
            "Policy incremental attribution",
        )
        if POLICY_INCREMENTAL_ATTRIBUTION_ARTIFACT_KIND in paths
        else None
    )
    fold_metrics = metrics.get("rl", {}).get("folds")
    baseline_metrics = metrics.get("baselines")
    if (
        not isinstance(fold_metrics, dict)
        or set(fold_metrics) != set(configuration["folds"])
        or not isinstance(baseline_metrics, dict)
        or set(baseline_metrics) != set(configuration["folds"])
    ):
        _fail("RunResult/metrics", "rl.folds", "RL and baseline folds differ from configuration")

    ranges: dict[str, dict[str, dict[str, Any]]] = {}
    trials: list[dict[str, Any]] = []
    baselines: list[dict[str, Any]] = []
    validation_sharpes: list[float] = []
    test_sharpes: list[float] = []
    validation_advantages: list[float] = []
    test_advantages: list[float] = []
    candidate_validation_sharpes: list[float] = []
    candidate_test_sharpes: list[float] = []
    validation_advantages_vs_candidate: list[float] = []
    test_advantages_vs_candidate: list[float] = []
    within_fold_validation_standard_deviations: list[float] = []
    for fold in configuration["folds"]:
        fold_value = fold_metrics[fold]
        if not isinstance(fold_value, dict):
            _fail(f"metrics/rl/folds/{fold}", "rl.fold", "Fold evidence must be an object")
        ranges[fold] = _ranges(fold_value, fold)
        fold_baselines = baseline_metrics[fold]
        selected = fold_baselines.get("best_validation_policy")
        if not isinstance(selected, str):
            _fail(f"metrics/baselines/{fold}", "rl.baseline", "Missing validation-selected baseline")
        baseline_names = [
            *(f"fixed:{action}" for action in configuration["actions"]),
            "best-training-expert",
            "contextual-ridge",
        ]
        for name in baseline_names:
            validation_value = _performance(
                _baseline_split(fold_baselines, name, "validation", f"baselines/{fold}/{name}"),
                f"baselines/{fold}/{name}/validation",
                configuration["actions"],
            )
            test_value = _performance(
                _baseline_split(fold_baselines, name, "test", f"baselines/{fold}/{name}"),
                f"baselines/{fold}/{name}/test",
                configuration["actions"],
            )
            baselines.append(
                {
                    "fold": fold,
                    "name": name,
                    "selectedOnValidation": name == selected,
                    "validation": validation_value,
                    "test": test_value,
                }
            )
        selected_validation = _performance(
            _baseline_split(fold_baselines, selected, "validation", f"baselines/{fold}/{selected}"),
            f"baselines/{fold}/{selected}/validation",
            configuration["actions"],
        )
        selected_test = _performance(
            _baseline_split(fold_baselines, selected, "test", f"baselines/{fold}/{selected}"),
            f"baselines/{fold}/{selected}/test",
            configuration["actions"],
        )
        candidate_validation = None
        candidate_test = None
        if has_candidate_fusion:
            candidate_validation = _performance(
                _baseline_split(
                    fold_baselines,
                    "fixed:candidate",
                    "validation",
                    f"baselines/{fold}/fixed:candidate",
                ),
                f"baselines/{fold}/fixed:candidate/validation",
                configuration["actions"],
            )
            candidate_test = _performance(
                _baseline_split(
                    fold_baselines,
                    "fixed:candidate",
                    "test",
                    f"baselines/{fold}/fixed:candidate",
                ),
                f"baselines/{fold}/fixed:candidate/test",
                configuration["actions"],
            )
            candidate_validation_sharpes.append(
                candidate_validation["netSharpe"]
            )
            candidate_test_sharpes.append(candidate_test["netSharpe"])
        seed_values = fold_value.get("seeds")
        if not isinstance(seed_values, dict) or set(seed_values) != {
            str(seed) for seed in configuration["seeds"]
        }:
            _fail(f"metrics/rl/folds/{fold}/seeds", "rl.trials", "Trial seeds differ from configuration")
        fold_validation: list[float] = []
        fold_test: list[float] = []
        for seed in configuration["seeds"]:
            seed_value = seed_values[str(seed)]
            if not isinstance(seed_value, dict) or seed_value.get("status") != "succeeded":
                _fail(f"metrics/rl/folds/{fold}/seeds/{seed}", "rl.trial-status", "Successful RL Run must preserve every successful trial")
            validation = _performance(
                seed_value.get("validation"),
                f"rl/{fold}/{seed}/validation",
                configuration["actions"],
            )
            test = _performance(
                seed_value.get("test"),
                f"rl/{fold}/{seed}/test",
                configuration["actions"],
            )
            if (
                validation["observations"] != ranges[fold]["validation"]["observations"]
                or test["observations"] != ranges[fold]["test"]["observations"]
            ):
                _fail(f"rl/{fold}/{seed}", "rl.trial-observations", "Trial observations differ from fold ranges")
            validation_advantage = validation["netSharpe"] - selected_validation["netSharpe"]
            test_advantage = test["netSharpe"] - selected_test["netSharpe"]
            validation_advantage_vs_candidate = (
                validation["netSharpe"] - candidate_validation["netSharpe"]
                if candidate_validation is not None
                else None
            )
            test_advantage_vs_candidate = (
                test["netSharpe"] - candidate_test["netSharpe"]
                if candidate_test is not None
                else None
            )
            fold_validation.append(validation["netSharpe"])
            fold_test.append(test["netSharpe"])
            validation_sharpes.append(validation["netSharpe"])
            test_sharpes.append(test["netSharpe"])
            trials.append(
                {
                    "fold": fold,
                    "seed": seed,
                    "status": "succeeded",
                    "selectedBaseline": selected,
                    "validation": validation,
                    "test": test,
                    "validationAdvantage": validation_advantage,
                    "testAdvantage": test_advantage,
                    **(
                        {
                            "validationAdvantageVsCandidateFactor": (
                                validation_advantage_vs_candidate
                            ),
                            "testAdvantageVsCandidateFactor": (
                                test_advantage_vs_candidate
                            ),
                        }
                        if has_candidate_fusion
                        else {}
                    ),
                }
            )
        fold_aggregate = fold_value.get("aggregate")
        if not isinstance(fold_aggregate, dict):
            _fail(f"metrics/rl/folds/{fold}/aggregate", "rl.aggregate", "Missing fold aggregate")
        fold_validation_summary = _reconcile_aggregate(
            fold_aggregate.get("validation_net_sharpe"),
            fold_validation,
            f"{fold}/validation",
        )
        within_fold_validation_standard_deviations.append(
            fold_validation_summary["standardDeviation"]
        )
        _reconcile_aggregate(fold_aggregate.get("test_net_sharpe"), fold_test, f"{fold}/test")
        validation_advantage = sum(fold_validation) / len(fold_validation) - selected_validation["netSharpe"]
        test_advantage = sum(fold_test) / len(fold_test) - selected_test["netSharpe"]
        validation_advantage_vs_candidate = (
            sum(fold_validation) / len(fold_validation)
            - candidate_validation["netSharpe"]
            if candidate_validation is not None
            else None
        )
        test_advantage_vs_candidate = (
            sum(fold_test) / len(fold_test)
            - candidate_test["netSharpe"]
            if candidate_test is not None
            else None
        )
        _close(
            fold_aggregate.get("validation_advantage_vs_best_baseline"),
            validation_advantage,
            f"{fold}/validationAdvantage",
            "validation baseline advantage",
        )
        _close(
            fold_aggregate.get("test_advantage_vs_validation_selected_baseline"),
            test_advantage,
            f"{fold}/testAdvantage",
            "test baseline advantage",
        )
        if has_candidate_fusion:
            _close(
                fold_aggregate.get("validation_advantage_vs_candidate_factor"),
                validation_advantage_vs_candidate,
                f"{fold}/validationCandidateAdvantage",
                "validation candidate-factor advantage",
            )
            _close(
                fold_aggregate.get("test_advantage_vs_candidate_factor"),
                test_advantage_vs_candidate,
                f"{fold}/testCandidateAdvantage",
                "test candidate-factor advantage",
            )
        validation_advantages.append(validation_advantage)
        test_advantages.append(test_advantage)
        if has_candidate_fusion:
            validation_advantages_vs_candidate.append(
                validation_advantage_vs_candidate
            )
            test_advantages_vs_candidate.append(test_advantage_vs_candidate)

    aggregate = metrics.get("rl", {}).get("aggregate")
    if not isinstance(aggregate, dict):
        _fail("metrics/rl/aggregate", "rl.aggregate", "Missing RL aggregate")
    validation_summary = _reconcile_aggregate(
        aggregate.get("validation_net_sharpe"),
        validation_sharpes,
        "metrics/rl/aggregate/validation",
    )
    test_summary = _reconcile_aggregate(
        aggregate.get("test_net_sharpe"),
        test_sharpes,
        "metrics/rl/aggregate/test",
    )
    if aggregate.get("failures") != []:
        _fail("metrics/rl/aggregate/failures", "rl.failures", "Successful Run cannot hide trial failures")
    _close(aggregate.get("failure_rate"), 0.0, "metrics/rl/aggregate/failure_rate", "failure rate")
    _close(
        metrics.get("validation_mean_net_sharpe"),
        validation_summary["mean"],
        "metrics/validation_mean_net_sharpe",
        "primary objective",
    )
    comparison = metrics.get("comparison")
    if not isinstance(comparison, dict):
        _fail("metrics/comparison", "rl.comparison", "Missing baseline comparison")
    mean_validation_advantage = sum(validation_advantages) / len(validation_advantages)
    mean_test_advantage = sum(test_advantages) / len(test_advantages)
    mean_validation_advantage_vs_candidate = (
        sum(validation_advantages_vs_candidate)
        / len(validation_advantages_vs_candidate)
        if has_candidate_fusion
        else None
    )
    mean_test_advantage_vs_candidate = (
        sum(test_advantages_vs_candidate)
        / len(test_advantages_vs_candidate)
        if has_candidate_fusion
        else None
    )
    _close(
        comparison.get("mean_validation_advantage_vs_best_baseline"),
        mean_validation_advantage,
        "metrics/comparison/validation",
        "mean validation advantage",
    )
    _close(
        comparison.get("mean_test_advantage_vs_validation_selected_baseline"),
        mean_test_advantage,
        "metrics/comparison/test",
        "mean test advantage",
    )
    candidate_validation_summary = None
    candidate_test_summary = None
    if has_candidate_fusion:
        candidate_validation_summary = _reconcile_aggregate(
            comparison.get("candidate_factor_validation_net_sharpe"),
            candidate_validation_sharpes,
            "metrics/comparison/candidateValidation",
        )
        candidate_test_summary = _reconcile_aggregate(
            comparison.get("candidate_factor_test_net_sharpe"),
            candidate_test_sharpes,
            "metrics/comparison/candidateTest",
        )
        _close(
            comparison.get("mean_validation_advantage_vs_candidate_factor"),
            mean_validation_advantage_vs_candidate,
            "metrics/comparison/validationCandidate",
            "mean validation advantage versus candidate factor",
        )
        _close(
            comparison.get("mean_test_advantage_vs_candidate_factor"),
            mean_test_advantage_vs_candidate,
            "metrics/comparison/testCandidate",
            "mean test advantage versus candidate factor",
        )

    training = _training(histories_value, configuration, ranges, run.result["inputHash"])
    action_rows = _action_rows(paths["policy-actions"], configuration, ranges)
    within_fold_validation_action_mismatch: list[float] = []
    for fold in configuration["folds"]:
        paths_by_seed = [
            tuple(
                row["action"]
                for row in action_rows
                if row["fold"] == fold
                and row["seed"] == seed
                and row["split"] == "validation"
            )
            for seed in configuration["seeds"]
        ]
        pairwise = [
            sum(
                left_action != right_action
                for left_action, right_action in zip(left, right)
            )
            / len(left)
            for left, right in combinations(paths_by_seed, 2)
        ]
        within_fold_validation_action_mismatch.append(
            sum(pairwise) / len(pairwise) if pairwise else 0.0
        )
    trials_by_key = {(item["fold"], item["seed"]): item for item in trials}
    action_summaries, action_path = _action_projection(
        action_rows,
        trials_by_key,
        configuration,
        ranges,
        point_limit,
    )
    policy_behavior = _policy_behavior_projection(
        rationale_value,
        metrics.get("policy_rationale"),
        models,
        action_rows,
        configuration,
        run.result["inputHash"],
    )
    factor_opportunity = _factor_opportunity_projection(
        opportunity_value,
        metrics.get("factor_opportunity"),
        action_rows,
        configuration,
        list(run.result["dataset"]["universe"]),
        run.result["inputHash"],
    )
    incremental_attribution = _incremental_attribution_projection(
        incremental_value,
        metrics.get("incremental_attribution"),
        action_rows,
        configuration,
        list(run.result["dataset"]["universe"]),
        run.result["inputHash"],
        {
            (item["fold"], item["seed"]): item["selectedBaseline"]
            for item in trials
        },
    )
    validation_candidate_action_frequency = None
    if has_candidate_fusion:
        validation_candidate_action_frequency = sum(
            item["actionFrequency"]["candidate"]
            for item in action_summaries
            if item["split"] == "validation"
        ) / len(trials)
        _close(
            comparison.get("mean_validation_candidate_action_frequency"),
            validation_candidate_action_frequency,
            "metrics/comparison/candidateActionFrequency",
            "mean validation candidate action frequency",
        )
    dependencies = run.result.get("dependencies")
    if has_candidate_fusion and (
        not isinstance(dependencies, dict)
        or "factors/**" not in dependencies.get("paths", [])
        or not isinstance(dependencies.get("hash"), str)
        or not isinstance(dependencies.get("sourceHashes"), dict)
        or "factors/candidate.py" not in dependencies["sourceHashes"]
    ):
        _fail(
            "RunResult/dependencies",
            "rl.factor-dependency",
            "RL Run must bind the exact content-locked candidate factor source",
        )
    raw_mandate = metrics.get("portfolio_mandate")
    report_mandate = report.get("portfolioMandate")
    if raw_mandate is None and report_mandate is None:
        mandate_projection = {
            "available": False,
            "id": None,
            "sha256": None,
            "sourceKind": "legacy-implicit",
            "requestHash": None,
            "direction": "research-only",
            "family": "dollar-neutral",
            "positionRolesSource": "legacy-implicit",
            "researchUniverse": run.result["dataset"]["universe"],
            "tradableAssets": run.result["dataset"]["universe"],
            "contextAssets": [],
            "grossLimit": 1.0,
            "maxAbsWeight": 0.30,
            "assetMaxAbsWeights": {
                asset: 0.30
                for asset in run.result["dataset"]["universe"]
            },
            "assetPositionRoles": {
                asset: "two-sided"
                for asset in run.result["dataset"]["universe"]
            },
            "longGrossLimit": 0.5,
            "shortGrossLimit": 0.5,
            "cashAllowed": True,
            "shortAllowed": True,
            "benchmark": {
                "source": "direction-default",
                "kind": "equal-weight-long-research-universe",
                "asset": None,
                "weights": {
                    asset: 1.0
                    / len(run.result["dataset"]["universe"])
                    for asset in run.result["dataset"]["universe"]
                },
            },
            "riskPolicy": None,
            "policySource": "legacy-implicit",
            "implementationPolicy": {
                "baseCostBps": 10.0,
                "noTradeOneWay": 0.05,
                "referenceNav": 1_000_000.0,
                "decisionPolicy": {
                    "source": "reference-default",
                    "kind": "every-bars",
                    "bars": 1,
                    "anchor": "dataset-start",
                },
                "costModel": "linear-traded-notional-v1",
                "capacityModel": (
                    "trailing-dollar-volume-participation-v1"
                ),
            },
        }
    else:
        if not isinstance(raw_mandate, dict) or not isinstance(
            report_mandate,
            dict,
        ):
            _fail(
                "RunResult/metrics/portfolio_mandate",
                "rl.portfolio-mandate",
                "RL Portfolio Mandate must exist in metrics and report",
            )
        mandate = validate_portfolio_mandate(
            raw_mandate,
            "RunResult/metrics/portfolio_mandate",
        )
        if (
            report_mandate != mandate
            or mandate["researchUniverse"]
            != run.result["dataset"]["universe"]
            or configuration.get("portfolioMandateId") != mandate["id"]
        ):
            _fail(
                "RunResult/metrics/portfolio_mandate",
                "rl.portfolio-mandate",
                "RL Portfolio Mandate does not reconcile report, dataset, and configuration",
            )
        source_hashes = (
            dependencies.get("sourceHashes")
            if isinstance(dependencies, dict)
            else None
        )
        mandate_hash = (
            source_hashes.get(PORTFOLIO_MANDATE)
            if isinstance(source_hashes, dict)
            else None
        )
        if not isinstance(mandate_hash, str):
            _fail(
                "RunResult/dependencies/sourceHashes",
                "rl.portfolio-mandate-dependency",
                "RL Run does not bind the fixed Portfolio Mandate",
            )
        source = mandate["source"]
        construction = mandate["construction"]
        implementation = mandate["implementationPolicy"]
        for configuration_key, policy_key in (
            ("costBps", "baseCostBps"),
            ("noTradeOneWay", "noTradeOneWay"),
            ("referenceNav", "referenceNav"),
        ):
            if configuration.get(configuration_key) != implementation[
                policy_key
            ]:
                _fail(
                    f"metrics/configuration/{configuration_key}",
                    "rl.implementation-policy",
                    "RL configuration differs from the Portfolio Mandate",
                )
        if configuration.get("decisionSchedule") != implementation[
            "decisionPolicy"
        ]:
            _fail(
                "metrics/configuration/decisionSchedule",
                "rl.decision-schedule",
                "RL decision schedule differs from the Portfolio Mandate",
            )
        mandate_projection = {
            "available": True,
            "id": mandate["id"],
            "sha256": mandate_hash,
            "sourceKind": source["kind"],
            "policySource": source["portfolioPolicy"],
            "requestHash": source["requestHash"],
            "direction": source["direction"],
            "family": construction["family"],
            "positionRolesSource": source["assetPositionRoles"],
            "researchUniverse": mandate["researchUniverse"],
            "tradableAssets": mandate["tradableAssets"],
            "contextAssets": mandate["contextAssets"],
            "grossLimit": construction["grossLimit"],
            "maxAbsWeight": construction["maxAbsWeight"],
            "assetMaxAbsWeights": construction["assetMaxAbsWeights"],
            "assetPositionRoles": construction["assetPositionRoles"],
            "longGrossLimit": construction["longGrossLimit"],
            "shortGrossLimit": construction["shortGrossLimit"],
            "cashAllowed": construction["cashAllowed"],
            "shortAllowed": construction["shortAllowed"],
            "benchmark": construction["benchmark"],
            "riskPolicy": construction["riskPolicy"],
            "implementationPolicy": implementation,
        }
    raw_factor_claim = metrics.get("factor_claim")
    raw_prediction_population = metrics.get("prediction_universe")
    raw_signal_translation = metrics.get("signal_translation")
    if (
        not isinstance(raw_factor_claim, dict)
        or report.get("factorClaim") != raw_factor_claim
        or not isinstance(raw_mandate, dict)
    ):
        _fail(
            "RunResult/metrics/factor_claim",
            "rl.factor-claim",
            "RL Run and report must bind one identical Factor claim",
        )
    factor_claim = validate_factor_claim(
        raw_factor_claim,
        "RunResult/metrics/factor_claim",
    )
    try:
        expected_population = validate_prediction_population_metrics(
            raw_prediction_population,
            list(run.result["dataset"]["universe"]),
            factor_claim,
        )
        validate_population_mandate_compatibility(
            expected_population,
            raw_mandate,
        )
        expected_translation = signal_translation_contract(
            expected_population
        )
    except PredictionModeError as error:
        _fail(
            "RunResult/metrics/prediction_universe",
            error.code,
            str(error),
        )
    if (
        raw_prediction_population != expected_population
        or report.get("predictionUniverse") != expected_population
    ):
        _fail(
            "RunResult/metrics/prediction_universe",
            "rl.prediction-universe",
            "RL prediction population differs from fixed request authority",
        )
    if (
        raw_signal_translation != expected_translation
        or report.get("signalTranslation") != expected_translation
    ):
        _fail(
            "RunResult/metrics/signal_translation",
            "rl.signal-translation",
            "RL signal translation differs from fixed prediction-mode semantics",
        )
    if (
        not isinstance(dependencies, dict)
        or FACTOR_CLAIM not in dependencies.get("paths", [])
        or FACTOR_CLAIM not in dependencies.get("sourceHashes", {})
        or FACTOR_POPULATION not in dependencies.get("paths", [])
        or FACTOR_POPULATION not in dependencies.get("sourceHashes", {})
    ):
        _fail(
            "RunResult/dependencies",
            "rl.factor-claim-dependency",
            "RL Run does not bind its fixed Factor claim",
        )
    raw_horizon = metrics.get("research_horizon")
    if (
        not isinstance(raw_horizon, dict)
        or report.get("researchHorizon") != raw_horizon
    ):
        _fail(
            "RunResult/metrics/research_horizon",
            "rl.research-horizon",
            "RL Run and report must contain one identical Horizon Mandate",
        )
    research_horizon = validate_research_horizon(
        raw_horizon,
        "RunResult/metrics/research_horizon",
    )
    if (
        not isinstance(dependencies, dict)
        or RESEARCH_HORIZON not in dependencies.get("paths", [])
        or RESEARCH_HORIZON
        not in dependencies.get("sourceHashes", {})
        or configuration.get("researchHorizonId")
        != research_horizon["id"]
    ):
        _fail(
            "RunResult/dependencies",
            "rl.research-horizon-dependency",
            "RL Run does not bind its fixed Horizon Mandate",
        )
    mean_validation_turnover = sum(
        item["validation"]["meanOneWayTurnover"] for item in trials
    ) / len(trials)
    mean_validation_cost = sum(
        item["validation"]["totalCostDrag"] for item in trials
    ) / len(trials)
    research_integrity = metrics.get("research_integrity")
    if (
        not isinstance(research_integrity, dict)
        or research_integrity.get("selection_split") != "validation"
        or research_integrity.get("test_enters_selection") is not False
    ):
        _fail("metrics/research_integrity", "rl.selection-integrity", "RL selection integrity is incomplete")
    if (
        configuration.get("learningContract") is not None
        and research_integrity.get("learning_configuration")
        != configuration["learningContract"]
    ):
        _fail(
            "metrics/research_integrity/learning_configuration",
            "rl.learning-contract",
            "Research integrity does not preserve the frozen learning contract",
        )
    factor_fusion = {
        "available": has_candidate_fusion,
        "mode": (
            "content-locked-candidate-source"
            if has_candidate_fusion
            else "legacy-reference-only"
        ),
        "dependency": dependencies if has_candidate_fusion else None,
        "candidateValidation": candidate_validation_summary,
        "candidateTestAudit": candidate_test_summary,
        "meanValidationAdvantageVsCandidateFactor": (
            mean_validation_advantage_vs_candidate
        ),
        "meanTestAdvantageVsCandidateFactor": (
            mean_test_advantage_vs_candidate
        ),
        "meanValidationCandidateActionFrequency": (
            validation_candidate_action_frequency
        ),
        "rlBeatCandidateOnValidation": (
            mean_validation_advantage_vs_candidate > 0.0
            if has_candidate_fusion
            else None
        ),
    }
    factor_fusion_diagnosis = _factor_fusion_diagnosis(
        factor_fusion,
        factor_opportunity,
        incremental_attribution,
        trials,
        baselines,
        mean_validation_advantage,
        mean_test_advantage,
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RL_DIAGNOSTICS_KIND,
        "run": {
            "id": run.result["id"],
            "status": run.result["status"],
            "summary": run.result["summary"],
            "startedAt": run.result["startedAt"],
            "completedAt": run.result["completedAt"],
            "inputHash": run.result["inputHash"],
            "studyId": run.result["study"]["id"],
            "studyHash": run.result["study"]["hash"],
            "sourceHash": run.result["subject"]["sourceHash"],
            "objective": run.result["objective"],
        },
        "dataset": {
            "id": run.result["dataset"]["id"],
            "version": run.result["dataset"]["version"],
            "hash": run.result["dataset"]["hash"],
            "timeRange": run.result["dataset"]["time_range"],
            "universe": run.result["dataset"]["universe"],
        },
        "harness": run.result["harness"],
        "artifacts": artifacts,
        "portfolioMandate": mandate_projection,
        "predictionUniverse": {
            "id": expected_population["id"],
            "claim": expected_population["claim"],
            "outcome": expected_population["outcome"],
            "authority": expected_population["authority"],
            "evaluationMode": expected_population["evaluation_mode"],
            "researchAssets": expected_population["research_assets"],
            "predictionAssets": expected_population["prediction_assets"],
            "contextAssets": expected_population["context_assets"],
            "assetPredictionRoles": expected_population[
                "asset_prediction_roles"
            ],
            "evaluationAuthority": expected_population[
                "evaluation_authority"
            ],
            "portfolioAuthority": expected_population[
                "portfolio_authority"
            ],
            "relativeValuePair": expected_population[
                "relative_value_pair"
            ],
            "tradingAuthority": expected_population["trading_authority"],
        },
        "signalTranslation": {
            "method": expected_translation["method"],
            "evaluationMode": expected_translation["evaluation_mode"],
            "predictionAssets": expected_translation["prediction_assets"],
            "contextAssets": expected_translation["context_assets"],
            "authority": expected_translation["authority"],
            "scoreBasis": expected_translation["score_basis"],
            "windowObservations": expected_translation[
                "window_observations"
            ],
            "minimumObservations": expected_translation[
                "minimum_observations"
            ],
            "relativeValuePair": expected_translation[
                "relative_value_pair"
            ],
            "contextScore": expected_translation["context_score"],
            "selectionAuthority": expected_translation[
                "selection_authority"
            ],
            "tradingAuthority": expected_translation["trading_authority"],
        },
        "researchHorizon": research_horizon,
        "decisionCadence": {
            **mandate_projection["implementationPolicy"][
                "decisionPolicy"
            ],
            "observations": len(action_rows),
            "scheduleGroups": len(
                {
                    (
                        row["fold"],
                        row["seed"],
                        row["split"],
                        row["decisionSession"],
                    )
                    for row in action_rows
                }
            ),
            "eligibleBars": sum(
                row["decisionEligible"] for row in action_rows
            ),
            "eligibleRate": (
                sum(row["decisionEligible"] for row in action_rows)
                / len(action_rows)
            ),
            "scheduledHoldBars": sum(
                not row["decisionEligible"]
                and not row["riskRebalanceOverride"]
                and not row["constraintRebalanceOverride"]
                for row in action_rows
            ),
            "riskOnlyOverrideBars": sum(
                not row["decisionEligible"]
                and row["riskRebalanceOverride"]
                and not row["constraintRebalanceOverride"]
                for row in action_rows
            ),
            "constraintOnlyOverrideBars": sum(
                not row["decisionEligible"]
                and row["constraintRebalanceOverride"]
                and not row["riskRebalanceOverride"]
                for row in action_rows
            ),
            "jointConstraintRiskOverrideBars": sum(
                not row["decisionEligible"]
                and row["constraintRebalanceOverride"]
                and row["riskRebalanceOverride"]
                for row in action_rows
            ),
        },
        "policyBehavior": policy_behavior,
        "factorOpportunity": factor_opportunity,
        "incrementalAttribution": incremental_attribution,
        "factorFusionDiagnosis": factor_fusion_diagnosis,
        "executedBookRisk": _execution_risk_projection(
            metrics,
            action_summaries,
            action_rows,
            mandate_projection,
        ),
        "protocol": {
            "selectionSplit": "validation",
            "testRole": "visible-diagnostic",
            "testEntersSelection": False,
            "actions": configuration["actions"],
            "factorExperts": factor_experts,
            "folds": configuration["folds"],
            "seeds": configuration["seeds"],
            "featureNames": configuration["featureNames"],
            "rawStateFields": configuration["rawStateFields"],
            "episodes": configuration["episodes"],
            "configuration": configuration,
            "ranges": ranges,
            "semantics": semantics,
        },
        "summary": {
            "validation": validation_summary,
            "testAudit": test_summary,
            "meanValidationAdvantageVsBestBaseline": mean_validation_advantage,
            "meanTestAdvantageVsValidationSelectedBaseline": mean_test_advantage,
            "failureRate": 0.0,
            "trialCount": len(trials),
            "meanValidationOneWayTurnover": mean_validation_turnover,
            "meanValidationCostDrag": mean_validation_cost,
            "rlAddedValidationValue": mean_validation_advantage > 0.0,
            "withinFoldSeedStability": {
                "meanStandardDeviation": (
                    sum(within_fold_validation_standard_deviations)
                    / len(within_fold_validation_standard_deviations)
                ),
                "maximumStandardDeviation": max(
                    within_fold_validation_standard_deviations
                ),
                "exactConsensusFolds": sum(
                    value <= 1e-12
                    for value in within_fold_validation_action_mismatch
                ),
                "folds": len(within_fold_validation_standard_deviations),
                "meanPairwiseActionMismatch": (
                    sum(within_fold_validation_action_mismatch)
                    / len(within_fold_validation_action_mismatch)
                ),
                "maximumPairwiseActionMismatch": max(
                    within_fold_validation_action_mismatch
                ),
            },
        },
        "factorFusion": factor_fusion,
        "trials": trials,
        "baselines": baselines,
        "models": models,
        "contextualBaselines": contextual_baselines,
        "training": training,
        "actionSummaries": action_summaries,
        "actionPath": action_path,
        "warning": (
            (
                "RL value-add is the validation advantage versus each fold's "
                "fixed validation-selected baseline. Test is visible audit "
                "evidence only; repeated inspection consumes holdout value. "
                "The candidate sleeve is an exact content-locked Study "
                "dependency. Every action sleeve shares the exact fixed "
                "Portfolio Mandate and causal one-sided risk governor; all "
                "actions carry no trading authority."
            )
            if has_candidate_fusion
            else (
                "Legacy RL evidence predates candidate-factor fusion and uses "
                "reference sleeves only. It remains immutable and readable, "
                "but cannot support an RL-versus-candidate claim. Test is "
                "visible audit evidence and actions carry no trading authority."
            )
        ),
    }


_FUSION_CANDIDATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "assessment",
        "fixedSleeveNetSharpe",
        "balancedFixedSleeveNetSharpe",
        "fixedSleeveSharpeDeltaVsBalanced",
        "selectedFrequency",
        "localBestFrequency",
        "oracleCaptureRate",
        "missedOpportunityRate",
        "meanLocalRewardDeltaVsBalanced",
        "meanLocalRewardDeltaVsSelected",
    ],
    "properties": {
        "assessment": {
            "enum": [
                "standalone-and-local-positive",
                "standalone-positive-local-nondominant",
                "local-opportunity-without-standalone-edge",
                "candidate-edge-absent",
            ]
        },
        "fixedSleeveNetSharpe": {"type": "number"},
        "balancedFixedSleeveNetSharpe": {"type": "number"},
        "fixedSleeveSharpeDeltaVsBalanced": {"type": "number"},
        "selectedFrequency": {"type": "number", "minimum": 0, "maximum": 1},
        "localBestFrequency": {"type": "number", "minimum": 0, "maximum": 1},
        "oracleCaptureRate": {"type": "number", "minimum": 0, "maximum": 1},
        "missedOpportunityRate": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
        },
        "meanLocalRewardDeltaVsBalanced": {"type": "number"},
        "meanLocalRewardDeltaVsSelected": {"type": "number"},
    },
}


_FUSION_SPLIT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "role",
        "candidateFactor",
        "policySelection",
        "adaptiveTransmission",
        "stability",
        "lossLocator",
        "reconciliation",
    ],
    "properties": {
        "role": {"enum": ["selection", "visible-audit"]},
        "candidateFactor": _FUSION_CANDIDATE_SCHEMA,
        "policySelection": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "selectedBaselineMeanNetSharpe",
                "oracleHitRate",
                "meanSelectedRank",
                "meanOneStepRealizedRegret",
            ],
            "properties": {
                "selectedBaselineMeanNetSharpe": {"type": "number"},
                "oracleHitRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "meanSelectedRank": {"type": "number", "minimum": 1},
                "meanOneStepRealizedRegret": {
                    "type": "number",
                    "minimum": 0,
                },
            },
        },
        "adaptiveTransmission": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "meanTrialGrossActiveReturn",
                "meanTrialIncrementalCost",
                "meanTrialNetActiveReturn",
                "meanSharpeAdvantageVsSelectedBaseline",
                "informationRatio",
                "activeDecisionRate",
                "conditionalActiveWinRate",
                "actionsDifferRate",
                "policySwitchRate",
                "baselineSwitchRate",
            ],
            "properties": {
                "meanTrialGrossActiveReturn": {"type": "number"},
                "meanTrialIncrementalCost": {"type": "number"},
                "meanTrialNetActiveReturn": {"type": "number"},
                "meanSharpeAdvantageVsSelectedBaseline": {"type": "number"},
                "informationRatio": {"type": "number"},
                "activeDecisionRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "conditionalActiveWinRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "actionsDifferRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "policySwitchRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "baselineSwitchRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
            },
        },
        "stability": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "trialPaths",
                "positiveGrossTrialRate",
                "positiveNetTrialRate",
                "positiveSharpeAdvantageTrialRate",
                "netActiveReturnStandardDeviation",
                "worstTrial",
            ],
            "properties": {
                "trialPaths": {"type": "integer", "minimum": 1},
                "positiveGrossTrialRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "positiveNetTrialRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "positiveSharpeAdvantageTrialRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "netActiveReturnStandardDeviation": {
                    "type": "number",
                    "minimum": 0,
                },
                "worstTrial": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "fold",
                        "seed",
                        "grossActiveReturn",
                        "netActiveReturn",
                        "sharpeAdvantage",
                    ],
                    "properties": {
                        "fold": {"type": "string", "minLength": 1},
                        "seed": {"type": "integer"},
                        "grossActiveReturn": {"type": "number"},
                        "netActiveReturn": {"type": "number"},
                        "sharpeAdvantage": {"type": "number"},
                    },
                },
            },
        },
        "lossLocator": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "worstRegime",
                "worstActionPair",
                "worstSwitchState",
                "worstAssetGrossContribution",
            ],
            "properties": {
                "worstRegime": {"$ref": "#/$defs/fusionLossBucket"},
                "worstActionPair": {"$ref": "#/$defs/fusionLossBucket"},
                "worstSwitchState": {"$ref": "#/$defs/fusionLossBucket"},
                "worstAssetGrossContribution": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "asset",
                        "totalGrossActiveContribution",
                    ],
                    "properties": {
                        "asset": {"type": "string", "minLength": 1},
                        "totalGrossActiveContribution": {"type": "number"},
                    },
                },
            },
        },
        "reconciliation": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "incrementalAttributionPassed",
                "factorOpportunityPassed",
                "trialPathsReconciled",
            ],
            "properties": {
                "incrementalAttributionPassed": {"const": True},
                "factorOpportunityPassed": {"const": True},
                "trialPathsReconciled": {"const": True},
            },
        },
    },
}


_FACTOR_FUSION_DIAGNOSIS_SCHEMA: dict[str, Any] = {
    "oneOf": [
        {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "authority",
                "tradingAuthority",
                "available",
                "reason",
            ],
            "properties": {
                "method": {"const": FACTOR_FUSION_DIAGNOSIS_METHOD},
                "authority": {"const": "research-prioritization-only"},
                "tradingAuthority": {"const": "none"},
                "available": {"const": False},
                "reason": {
                    "enum": [
                        "candidate-factor-fusion-unavailable",
                        "required-verified-evidence-unavailable",
                    ]
                },
            },
        },
        {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "authority",
                "tradingAuthority",
                "available",
                "reason",
                "semantics",
                "diagnosis",
                "validation",
                "testAudit",
            ],
            "properties": {
                "method": {"const": FACTOR_FUSION_DIAGNOSIS_METHOD},
                "authority": {"const": "research-prioritization-only"},
                "tradingAuthority": {"const": "none"},
                "available": {"const": True},
                "reason": {"type": "null"},
                "semantics": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "localOpportunity",
                        "adaptiveTransmission",
                        "candidateFactorSource",
                        "selectionSplit",
                        "testEntersDiagnosis",
                        "entersTraining",
                        "entersSelection",
                    ],
                    "properties": {
                        "localOpportunity": {
                            "const": "same-pretrade-one-step-ex-post-audit"
                        },
                        "adaptiveTransmission": {
                            "const": "independent-full-policy-paths"
                        },
                        "candidateFactorSource": {
                            "const": "content-locked-study-dependency"
                        },
                        "selectionSplit": {"const": "validation"},
                        "testEntersDiagnosis": {"const": False},
                        "entersTraining": {"const": False},
                        "entersSelection": {"const": False},
                    },
                },
                "diagnosis": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "selectionSplit",
                        "testEntersDiagnosis",
                        "stage",
                        "iterationFocus",
                        "explanation",
                    ],
                    "properties": {
                        "selectionSplit": {"const": "validation"},
                        "testEntersDiagnosis": {"const": False},
                        "stage": {
                            "enum": [
                                "adaptive-book-selection-negative",
                                "implementation-cost-destroys-edge",
                                "risk-adjusted-adaptive-value-absent",
                                "seed-fold-unstable",
                                "adaptive-value-positive",
                            ]
                        },
                        "iterationFocus": {
                            "enum": [
                                "factor-sleeve-research",
                                "policy-state-and-candidate-capture",
                                "adaptive-book-selection",
                                "switch-persistence-and-turnover",
                                "active-risk-and-drawdown-control",
                                "train-only-learning-stability",
                                "external-holdout-and-capacity",
                            ]
                        },
                        "explanation": {"type": "string", "minLength": 1},
                    },
                },
                "validation": {
                    "allOf": [
                        _FUSION_SPLIT_SCHEMA,
                        {
                            "type": "object",
                            "properties": {"role": {"const": "selection"}},
                        },
                    ]
                },
                "testAudit": {
                    "allOf": [
                        _FUSION_SPLIT_SCHEMA,
                        {
                            "type": "object",
                            "properties": {
                                "role": {"const": "visible-audit"}
                            },
                        },
                    ]
                },
            },
        },
    ]
}


RL_DIAGNOSTICS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant bounded governed RL policy diagnostics",
    "type": "object",
    "additionalProperties": False,
    "$defs": {
        "fusionLossBucket": {
            "type": "object",
            "additionalProperties": False,
            "required": ["key", "decisions", "totalNetActiveReturn"],
            "properties": {
                "key": {"type": "string", "minLength": 1},
                "decisions": {"type": "integer", "minimum": 1},
                "totalNetActiveReturn": {"type": "number"},
            },
        }
    },
    "required": [
        "schemaVersion",
        "kind",
        "run",
        "dataset",
        "harness",
        "artifacts",
        "portfolioMandate",
        "predictionUniverse",
        "signalTranslation",
        "researchHorizon",
        "decisionCadence",
        "policyBehavior",
        "factorOpportunity",
        "incrementalAttribution",
        "factorFusionDiagnosis",
        "executedBookRisk",
        "protocol",
        "summary",
        "factorFusion",
        "trials",
        "baselines",
        "models",
        "contextualBaselines",
        "training",
        "actionSummaries",
        "actionPath",
        "warning",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": RL_DIAGNOSTICS_KIND},
        "run": {"type": "object"},
        "dataset": {"type": "object"},
        "harness": {"type": "object"},
        "artifacts": {"type": "object"},
        "portfolioMandate": {"type": "object"},
        "predictionUniverse": {
            "type": "object",
            "required": [
                "id",
                "claim",
                "outcome",
                "authority",
                "evaluationMode",
                "researchAssets",
                "predictionAssets",
                "contextAssets",
                "assetPredictionRoles",
                "evaluationAuthority",
                "portfolioAuthority",
                "relativeValuePair",
                "tradingAuthority",
            ],
        },
        "signalTranslation": {
            "type": "object",
            "required": [
                "method",
                "evaluationMode",
                "predictionAssets",
                "contextAssets",
                "authority",
                "scoreBasis",
                "windowObservations",
                "minimumObservations",
                "relativeValuePair",
                "contextScore",
                "selectionAuthority",
                "tradingAuthority",
            ],
        },
        "researchHorizon": RESEARCH_HORIZON_JSON_SCHEMA,
        "decisionCadence": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "source",
                "kind",
                "observations",
                "scheduleGroups",
                "eligibleBars",
                "eligibleRate",
                "scheduledHoldBars",
                "riskOnlyOverrideBars",
                "constraintOnlyOverrideBars",
                "jointConstraintRiskOverrideBars",
            ],
            "properties": {
                "source": {
                    "enum": ["caller-supplied", "reference-default"]
                },
                "kind": {
                    "enum": ["every-bars", "calendar-month-end"]
                },
                "bars": {"type": "integer", "minimum": 1, "maximum": 252},
                "anchor": {
                    "enum": ["dataset-start", "session-start"]
                },
                "observations": {"type": "integer", "minimum": 1},
                "scheduleGroups": {"type": "integer", "minimum": 1},
                "eligibleBars": {"type": "integer", "minimum": 0},
                "eligibleRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "scheduledHoldBars": {"type": "integer", "minimum": 0},
                "riskOnlyOverrideBars": {"type": "integer", "minimum": 0},
                "constraintOnlyOverrideBars": {
                    "type": "integer",
                    "minimum": 0,
                },
                "jointConstraintRiskOverrideBars": {
                    "type": "integer",
                    "minimum": 0,
                },
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "kind": {"const": "every-bars"}
                        }
                    },
                    "then": {"required": ["bars", "anchor"]},
                }
            ],
        },
        "policyBehavior": {"type": "object"},
        "factorOpportunity": {"type": "object"},
        "incrementalAttribution": {"type": "object"},
        "factorFusionDiagnosis": _FACTOR_FUSION_DIAGNOSIS_SCHEMA,
        "executedBookRisk": {"type": "object"},
        "protocol": {"type": "object"},
        "summary": {"type": "object"},
        "factorFusion": {"type": "object"},
        "trials": {"type": "array", "items": {"type": "object"}},
        "baselines": {"type": "array", "items": {"type": "object"}},
        "models": {"type": "array", "items": {"type": "object"}},
        "contextualBaselines": {
            "type": "array",
            "items": {"type": "object"},
        },
        "training": {"type": "array", "items": {"type": "object"}},
        "actionSummaries": {"type": "array", "items": {"type": "object"}},
        "actionPath": {"type": "object"},
        "warning": {"type": "string", "minLength": 1},
    },
}
