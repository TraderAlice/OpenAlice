"""Bounded, verified decision diagnostics for immutable Portfolio Runs."""

from __future__ import annotations

import csv
import json
import math
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from .factor_claims import FACTOR_CLAIM, validate_factor_claim
from .intervals import annualization_periods, timestamp_label
from .horizons import (
    RESEARCH_HORIZON,
    RESEARCH_HORIZON_JSON_SCHEMA,
    validate_research_horizon,
)
from .mandates import (
    PORTFOLIO_MANDATE,
    validate_portfolio_mandate,
)
from .project_templates.ohlcv_portfolio_lab.portfolio_core import (
    GROSS_TARGET,
    LONG_ENTRY_PERCENTILE,
    LONG_EXIT_PERCENTILE,
    MAX_ABS_WEIGHT,
    NO_TRADE_ONE_WAY,
    POSITION_EPISODE_COLUMNS,
    PortfolioFailure,
    SHORT_ENTRY_PERCENTILE,
    SHORT_EXIT_PERCENTILE,
    VOLATILITY_WINDOW,
    _position_role_signal_transition,
    build_position_episodes,
    decision_schedule_mask,
    performance_metrics,
    position_episode_metrics,
    translate_factor_scores,
)
from .prediction_modes import (
    CROSS_SECTIONAL_MODE,
    FACTOR_POPULATION,
    PredictionModeError,
    SIGNAL_TRANSLATION_METHOD,
    TEMPORAL_SCORE_MINIMUM,
    TEMPORAL_SCORE_WINDOW,
    TEMPORAL_EVALUATION_MODES,
    TWO_ASSET_RELATIVE_VALUE_MODE,
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


PORTFOLIO_DIAGNOSTICS_KIND = "autoquant-portfolio-diagnostics"
DEFAULT_PORTFOLIO_POINTS = 180
MIN_PORTFOLIO_POINTS = 40
MAX_PORTFOLIO_POINTS = 400
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_DAILY_ROWS = 100_000
MAX_DECISION_ROWS = 1_000_000
MAX_EPISODE_ROWS = 100_000
MAX_NEIGHBORHOOD_ROWS = 100_000
MAX_TRANSLATION_ROBUSTNESS_ROWS = 500_000
MAX_UNIVERSE = 256
MAX_RECENT_TRANSITIONS = 40
TIMESTAMP_JSON_SCHEMA = {
    "anyOf": [
        {"type": "string", "format": "date"},
        {"type": "string", "format": "date-time"},
    ]
}
NULLABLE_TIMESTAMP_JSON_SCHEMA = {
    "anyOf": [
        {"type": "null"},
        *TIMESTAMP_JSON_SCHEMA["anyOf"],
    ]
}
MECHANICAL_DECISION_METHOD = (
    "stateful-percentile-target-risk-execution-chain-v1"
)
SIZING_ANATOMY_METHOD = (
    "conviction-inverse-volatility-capped-waterfill-anatomy-v1"
)
STRATEGY_VIABILITY_METHOD = (
    "validation-factor-gross-friction-net-viability-diagnosis-v1"
)
SIGNAL_MONETIZATION_METHOD = (
    "prediction-mode-intent-sizing-governance-execution-cost-bridge-v2"
)
DIVERSIFICATION_STRESS_METHOD = (
    "causal-executed-book-diversification-stress-v1"
)
DIVERSIFICATION_SHOCK_METHOD = (
    "observed-to-perfect-position-aligned-covariance-blend-ladder"
)
DIVERSIFICATION_STRESS_SCENARIOS: tuple[dict[str, Any], ...] = (
    {
        "id": "quarter-breakdown",
        "label": "25% correlation breakdown",
        "blendToPerfectCorrelation": 0.25,
    },
    {
        "id": "half-breakdown",
        "label": "50% correlation breakdown",
        "blendToPerfectCorrelation": 0.50,
    },
    {
        "id": "perfect-aligned",
        "label": "Perfect position-aligned correlation",
        "blendToPerfectCorrelation": 1.00,
    },
)
BREAK_EVEN_COST_SEARCH_MAX_BPS = 1_000.0
PERCENTILE_DISTANCE_SEMANTICS = (
    "current-cross-sectional-percentile-points-with-peer-ranks-held-fixed"
)
EXPECTED_SIGNAL_PARAMETERS = {
    "long_entry_percentile": LONG_ENTRY_PERCENTILE,
    "long_exit_percentile": LONG_EXIT_PERCENTILE,
    "short_exit_percentile": SHORT_EXIT_PERCENTILE,
    "short_entry_percentile": SHORT_ENTRY_PERCENTILE,
    "volatility_window": VOLATILITY_WINDOW,
    "gross_target": GROSS_TARGET,
    "max_abs_weight": MAX_ABS_WEIGHT,
    "no_trade_one_way": NO_TRADE_ONE_WAY,
}
BASE_ARTIFACT_KINDS = {
    "portfolio-report",
    "portfolio-daily",
    "portfolio-targets",
    "portfolio-weights",
    "portfolio-decisions",
}
POSITION_EPISODE_ARTIFACT_KIND = "portfolio-position-episodes"
PARAMETER_NEIGHBORHOOD_ARTIFACT_KIND = (
    "portfolio-parameter-neighborhood"
)
TRANSLATION_ROBUSTNESS_ARTIFACT_KIND = (
    "portfolio-translation-robustness"
)
EXPECTED_ARTIFACT_KINDS = BASE_ARTIFACT_KINDS | {
    POSITION_EPISODE_ARTIFACT_KIND,
    PARAMETER_NEIGHBORHOOD_ARTIFACT_KIND,
    TRANSLATION_ROBUSTNESS_ARTIFACT_KIND,
}
PARAMETER_NEIGHBORHOOD_METHOD = (
    "predeclared-signal-threshold-no-trade-neighborhood-v1"
)
TRANSLATION_ROBUSTNESS_METHOD = (
    "predeclared-temporal-translation-window-stability-v1"
)
TRANSLATION_ROBUSTNESS_PROFILES: tuple[dict[str, Any], ...] = (
    {
        "id": "short-history",
        "label": "Short history",
        "window": 40,
        "minimum": TEMPORAL_SCORE_MINIMUM,
        "is_base": False,
    },
    {
        "id": "base",
        "label": "Base",
        "window": TEMPORAL_SCORE_WINDOW,
        "minimum": TEMPORAL_SCORE_MINIMUM,
        "is_base": True,
    },
    {
        "id": "long-history",
        "label": "Long history",
        "window": 120,
        "minimum": TEMPORAL_SCORE_MINIMUM,
        "is_base": False,
    },
)
TRANSLATION_ACTIVE_AGREEMENT_FLOOR = 0.80
TRANSLATION_TARGET_MAE_CEILING = 0.05
PARAMETER_SIGNAL_PROFILES: tuple[dict[str, Any], ...] = (
    {
        "id": "broad-entry",
        "label": "Broad entry",
        "longEntry": 0.55,
        "longExit": 0.55,
        "shortExit": 0.45,
        "shortEntry": 0.45,
    },
    {
        "id": "base",
        "label": "Base",
        "longEntry": 0.75,
        "longExit": 0.55,
        "shortExit": 0.45,
        "shortEntry": 0.25,
    },
    {
        "id": "selective-entry",
        "label": "Selective entry",
        "longEntry": 0.95,
        "longExit": 0.55,
        "shortExit": 0.45,
        "shortEntry": 0.05,
    },
    {
        "id": "fast-exit",
        "label": "Fast exit",
        "longEntry": 0.75,
        "longExit": 0.75,
        "shortExit": 0.25,
        "shortEntry": 0.25,
    },
    {
        "id": "selective-fast-exit",
        "label": "Selective + fast exit",
        "longEntry": 0.95,
        "longExit": 0.75,
        "shortExit": 0.25,
        "shortEntry": 0.05,
    },
)
DAILY_NUMERIC_COLUMNS = (
    "gross_return",
    "net_return",
    "benchmark_return",
    "one_way_turnover",
    "traded_notional",
    "cost",
    "gross_exposure",
    "net_exposure",
    "max_abs_weight",
    "concentration_hhi",
    "max_participation",
    "mean_participation",
)
DECISION_REQUIRED_COLUMNS = {
    "factor",
    "percentile_score",
    "translation_score",
    "translation_value",
    "translation_observations",
    "translation_method",
    "evaluation_mode",
    "prior_signal_state",
    "signal_state",
    "signal_event",
    "decision_eligible",
    "decision_schedule_kind",
    "decision_every_bars",
    "decision_anchor",
    "decision_session",
    "position_role",
    "long_gross_limit",
    "short_gross_limit",
    "conviction",
    "trailing_volatility",
    "risk_strength",
    "allocation_status",
    "prior_target_weight",
    "proposed_target_weight",
    "target_delta",
    "target_action",
    "diagonal_risk_budget_share",
    "timestamp",
    "asset",
    "regime",
    "pretrade_weight",
    "executed_weight",
    "executed_state",
    "trade_weight",
    "execution_action",
    "execution_reason",
    "asset_forward_return",
    "gross_return_contribution",
    "cost_contribution",
    "net_return_contribution",
    "one_way_turnover_contribution",
    "component_variance",
    "variance_contribution_share",
    "portfolio_variance",
    "portfolio_gross_return",
    "portfolio_cost",
    "portfolio_net_return",
    "portfolio_traded_notional",
}
DECISION_OPTIONAL_FLOATS = {
    "factor",
    "percentile_score",
    "translation_score",
    "translation_value",
    "trailing_volatility",
}
DECISION_FLOATS = {
    "conviction",
    "risk_strength",
    "prior_target_weight",
    "proposed_target_weight",
    "target_delta",
    "diagonal_risk_budget_share",
    "pretrade_weight",
    "executed_weight",
    "trade_weight",
    "asset_forward_return",
    "gross_return_contribution",
    "cost_contribution",
    "net_return_contribution",
    "one_way_turnover_contribution",
    "component_variance",
    "variance_contribution_share",
    "portfolio_variance",
    "portfolio_gross_return",
    "portfolio_cost",
    "portfolio_net_return",
    "portfolio_traded_notional",
}
RISK_DECISION_COLUMNS = {
    "pre_governor_target_weight",
    "risk_governor_status",
    "risk_estimation_observations",
    "risk_forecast_pre_annualized",
    "risk_forecast_post_annualized",
    "risk_volatility_ceiling_annualized",
    "risk_governor_scale",
}
RISK_DECISION_FLOATS = RISK_DECISION_COLUMNS - {"risk_governor_status"}
LIQUIDITY_REFERENCE_NAV = 1_000_000.0
LIQUIDITY_DECISION_COLUMNS = {
    "liquidity_capacity_status",
    "liquidity_adv_observations",
    "causal_adv_dollar_volume",
    "reference_nav_adv_participation",
    "asset_capacity_nav_1pct",
    "asset_capacity_nav_5pct",
    "portfolio_capacity_nav_1pct",
    "portfolio_capacity_nav_5pct",
    "capacity_binding_asset",
}
LIQUIDITY_DECISION_FLOATS = LIQUIDITY_DECISION_COLUMNS - {
    "liquidity_capacity_status",
    "capacity_binding_asset",
}
EXECUTION_RISK_DAILY_FLOATS = {
    "execution_risk_observations",
    "pretrade_risk_forecast_annualized",
    "proposed_risk_forecast_pre_annualized",
    "proposed_risk_forecast_post_annualized",
    "executed_risk_forecast_annualized",
    "execution_risk_ceiling_annualized",
    "proposed_runtime_risk_scale",
    "execution_risk_repair_scale",
    "proposed_one_way_turnover",
}
EXECUTION_RISK_DAILY_BOOLEANS = {
    "execution_risk_forecast_available",
    "ordinary_rebalance",
    "risk_rebalance_override",
}
EXECUTION_RISK_DAILY_STRINGS = {
    "execution_reason",
    "execution_risk_status",
}
EXECUTION_RISK_DAILY_COLUMNS = (
    EXECUTION_RISK_DAILY_FLOATS
    | EXECUTION_RISK_DAILY_BOOLEANS
    | EXECUTION_RISK_DAILY_STRINGS
)
EXECUTION_RISK_DECISION_COLUMNS = EXECUTION_RISK_DAILY_COLUMNS - {
    "execution_reason"
}
EXECUTION_RISK_DECISION_FLOATS = EXECUTION_RISK_DAILY_FLOATS
EXECUTION_CONSTRAINT_DAILY_FLOATS = {
    "constraint_repair_one_way",
    "executed_constraint_maximum_error",
}
EXECUTION_CONSTRAINT_DAILY_BOOLEANS = {
    "constraint_rebalance_override",
}
EXECUTION_CONSTRAINT_DAILY_COLUMNS = (
    EXECUTION_CONSTRAINT_DAILY_FLOATS
    | EXECUTION_CONSTRAINT_DAILY_BOOLEANS
)


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _fail(path: Path | str, code: str, message: str) -> None:
    raise AutoQuantValidationError([_issue(path, code, message)])


def _finite(value: Any, path: Path | str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        _fail(path, "portfolio.number", "Expected a finite numeric value")
    if not math.isfinite(number):
        _fail(path, "portfolio.number", "Expected a finite numeric value")
    return number


def _optional_finite(value: Any, path: Path | str) -> float | None:
    if value is None or value == "":
        return None
    return _finite(value, path)


def _session_date(value: Any, path: Path | str) -> str:
    if not isinstance(value, str):
        _fail(
            path,
            "portfolio.timestamp",
            "Timestamp must be an ISO date or UTC date-time",
        )
    try:
        normalized = timestamp_label(value)
    except (TypeError, ValueError):
        _fail(
            path,
            "portfolio.timestamp",
            "Timestamp must be an ISO date or UTC date-time",
        )
    if normalized != value:
        _fail(
            path,
            "portfolio.timestamp",
            "Timestamp must be a canonical ISO date or UTC date-time",
        )
    return value


def _artifact_paths(
    run: RunContext,
) -> tuple[dict[str, Path], dict[str, dict[str, str]]]:
    if run.result["status"] != "succeeded":
        _fail(
            run.root_dir,
            "portfolio.run-status",
            "Portfolio diagnostics require a successful immutable Run",
        )
    artifacts = run.result.get("artifacts")
    if not isinstance(artifacts, list):
        _fail(run.root_dir, "portfolio.artifacts", "Run artifacts must be an array")
    paths: dict[str, Path] = {}
    identities: dict[str, dict[str, str]] = {}
    for index, artifact in enumerate(artifacts):
        artifact_path = f"{run.root_dir}/result.json/artifacts/{index}"
        if not isinstance(artifact, dict):
            _fail(artifact_path, "portfolio.artifact", "Artifact must be an object")
        kind = artifact.get("kind")
        relative = artifact.get("path")
        if kind not in EXPECTED_ARTIFACT_KINDS:
            continue
        if kind in paths:
            _fail(
                artifact_path,
                "portfolio.duplicate-artifact",
                f"Portfolio artifact kind must be unique: {kind}",
            )
        if not isinstance(relative, str):
            _fail(
                artifact_path,
                "portfolio.artifact-path",
                "Portfolio artifact path must be a string",
            )
        path = confined_path(run.root_dir, relative, artifact_path)
        if not path.is_file():
            _fail(path, "portfolio.artifact-missing", f"Missing artifact: {kind}")
        size = path.stat().st_size
        if size > MAX_ARTIFACT_BYTES:
            _fail(
                path,
                "portfolio.artifact-size",
                f"Portfolio artifact exceeds {MAX_ARTIFACT_BYTES} bytes",
            )
        content_hash = run.manifest["files"].get(relative)
        if not isinstance(content_hash, str):
            _fail(
                path,
                "portfolio.artifact-identity",
                "Artifact is absent from immutable Run identity",
            )
        paths[kind] = path
        identities[kind] = {
            "path": relative,
            "sha256": content_hash,
        }
    missing = BASE_ARTIFACT_KINDS - paths.keys()
    if missing:
        _fail(
            run.root_dir,
            "portfolio.artifacts",
            "Run does not declare the fixed Portfolio artifact set: "
            + ", ".join(sorted(missing)),
        )
    return paths, identities


def _read_csv(
    path: Path,
    *,
    required: set[str],
    maximum_rows: int,
) -> tuple[list[str], list[dict[str, str]]]:
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            fields = reader.fieldnames
            if (
                fields is None
                or len(fields) != len(set(fields))
                or any(not field for field in fields)
            ):
                _fail(
                    path,
                    "portfolio.csv-header",
                    "CSV must have unique non-empty headers",
                )
            missing = required - set(fields)
            if missing:
                _fail(
                    path,
                    "portfolio.csv-columns",
                    "CSV is missing columns: " + ", ".join(sorted(missing)),
                )
            rows: list[dict[str, str]] = []
            for row_number, row in enumerate(reader, start=2):
                if None in row:
                    _fail(
                        f"{path}:{row_number}",
                        "portfolio.csv-width",
                        "CSV row has more values than headers",
                    )
                if any(value is None for value in row.values()):
                    _fail(
                        f"{path}:{row_number}",
                        "portfolio.csv-width",
                        "CSV row has fewer values than headers",
                    )
                rows.append(row)
                if len(rows) > maximum_rows:
                    _fail(
                        path,
                        "portfolio.row-limit",
                        f"CSV exceeds the {maximum_rows}-row diagnostics limit",
                    )
    except UnicodeDecodeError:
        _fail(path, "portfolio.csv-encoding", "CSV must be UTF-8")
    if not rows:
        _fail(path, "portfolio.csv-empty", "CSV must contain data rows")
    return fields, rows


def _strict_dates(rows: list[dict[str, str]], path: Path) -> list[str]:
    dates = [
        _session_date(row.get("timestamp"), f"{path}:{index}/timestamp")
        for index, row in enumerate(rows, start=2)
    ]
    if dates != sorted(dates) or len(dates) != len(set(dates)):
        _fail(
            path,
            "portfolio.timestamp-order",
            "Timestamps must be unique and strictly increasing",
        )
    return dates


@dataclass(frozen=True)
class ParsedDaily:
    dates: list[str]
    rows: list[dict[str, Any]]


def _parse_flat_decision_schedule(
    raw: dict[str, str],
    path: str,
) -> tuple[dict[str, object], int | None, str | None]:
    kind = raw["decision_schedule_kind"]
    if kind == "calendar-month-end":
        if raw["decision_every_bars"] or raw["decision_anchor"]:
            _fail(
                path,
                "portfolio.decision-schedule",
                "Calendar month-end rows must leave bars and anchor empty",
            )
        return {"kind": kind}, None, None
    if kind != "every-bars":
        _fail(
            f"{path}/decision_schedule_kind",
            "portfolio.decision-schedule",
            "decision_schedule_kind is invalid",
        )
    try:
        bars = int(raw["decision_every_bars"])
    except ValueError:
        bars = 0
    if (
        str(bars) != raw["decision_every_bars"]
        or not 1 <= bars <= 252
    ):
        _fail(
            f"{path}/decision_every_bars",
            "portfolio.decision-cadence",
            "decision_every_bars must be an integer from 1 to 252",
        )
    anchor = raw["decision_anchor"]
    if anchor not in {"dataset-start", "session-start"}:
        _fail(
            f"{path}/decision_anchor",
            "portfolio.decision-anchor",
            "decision_anchor must be dataset-start or session-start",
        )
    return {
        "kind": kind,
        "bars": bars,
        "anchor": anchor,
    }, bars, anchor


def _parse_daily(path: Path) -> ParsedDaily:
    required = {
        "timestamp",
        "rebalanced",
        "decision_eligible",
        "decision_schedule_kind",
        "decision_every_bars",
        "decision_anchor",
        "decision_session",
        *DAILY_NUMERIC_COLUMNS,
        *EXECUTION_RISK_DAILY_COLUMNS,
        *EXECUTION_CONSTRAINT_DAILY_COLUMNS,
    }
    fields, raw_rows = _read_csv(
        path,
        required=required,
        maximum_rows=MAX_DAILY_ROWS,
    )
    dates = _strict_dates(raw_rows, path)
    has_execution_risk = EXECUTION_RISK_DAILY_COLUMNS.issubset(fields)
    if EXECUTION_RISK_DAILY_COLUMNS & set(fields) and not has_execution_risk:
        _fail(
            path,
            "portfolio.execution-risk-columns",
            "Daily evidence must contain the complete execution-risk column set",
        )
    has_execution_constraints = (
        EXECUTION_CONSTRAINT_DAILY_COLUMNS.issubset(fields)
    )
    if (
        EXECUTION_CONSTRAINT_DAILY_COLUMNS & set(fields)
        and not has_execution_constraints
    ):
        _fail(
            path,
            "portfolio.execution-constraint-columns",
            "Daily evidence must contain the complete executed-constraint column set",
        )
    rows: list[dict[str, Any]] = []
    for index, (timestamp, raw) in enumerate(zip(dates, raw_rows), start=2):
        values = {
            key: _finite(raw[key], f"{path}:{index}/{key}")
            for key in DAILY_NUMERIC_COLUMNS
        }
        cash_weight = (
            _finite(raw["cash_weight"], f"{path}:{index}/cash_weight")
            if "cash_weight" in fields
            else 1.0 - values["gross_exposure"]
        )
        if not math.isclose(
            cash_weight,
            1.0 - values["gross_exposure"],
            rel_tol=0.0,
            abs_tol=1e-9,
        ):
            _fail(
                f"{path}:{index}/cash_weight",
                "portfolio.cash-reconciliation",
                "Cash weight must equal one minus gross exposure",
            )
        if (
            values["gross_return"] <= -1.0
            or values["net_return"] <= -1.0
            or values["benchmark_return"] <= -1.0
        ):
            _fail(
                f"{path}:{index}",
                "portfolio.return",
                "Daily compounded returns must be greater than -1",
            )
        decision_schedule, decision_every_bars, decision_anchor = (
            _parse_flat_decision_schedule(raw, f"{path}:{index}")
        )
        decision_session = raw["decision_session"]
        if (
            not decision_session
            or (
                decision_anchor == "dataset-start"
                and decision_session != "dataset"
            )
        ):
            _fail(
                f"{path}:{index}/decision_session",
                "portfolio.decision-session",
                "decision_session is inconsistent with the anchor",
            )
        for key in (
            "one_way_turnover",
            "traded_notional",
            "cost",
            "gross_exposure",
            "max_abs_weight",
            "concentration_hhi",
            "max_participation",
            "mean_participation",
        ):
            if values[key] < 0:
                _fail(
                    f"{path}:{index}/{key}",
                    "portfolio.non-negative",
                    f"{key} must be non-negative",
                )
        if raw["rebalanced"] not in {"True", "False"}:
            _fail(
                f"{path}:{index}/rebalanced",
                "portfolio.boolean",
                "rebalanced must be True or False",
            )
        if raw["decision_eligible"] not in {"True", "False"}:
            _fail(
                f"{path}:{index}/decision_eligible",
                "portfolio.boolean",
                "decision_eligible must be True or False",
            )
        if has_execution_risk:
            execution_numeric = {
                key: _finite(raw[key], f"{path}:{index}/{key}")
                for key in EXECUTION_RISK_DAILY_FLOATS
            }
            execution_boolean: dict[str, bool] = {}
            for key in EXECUTION_RISK_DAILY_BOOLEANS:
                if raw[key] not in {"True", "False"}:
                    _fail(
                        f"{path}:{index}/{key}",
                        "portfolio.boolean",
                        f"{key} must be True or False",
                    )
                execution_boolean[key] = raw[key] == "True"
            if any(not raw[key] for key in EXECUTION_RISK_DAILY_STRINGS):
                _fail(
                    f"{path}:{index}",
                    "portfolio.execution-risk-string",
                    "Execution-risk status and reason must be non-empty",
                )
            if (
                any(value < 0 for value in execution_numeric.values())
                or not 0
                <= execution_numeric["proposed_runtime_risk_scale"]
                <= 1
                or not 0
                <= execution_numeric["execution_risk_repair_scale"]
                <= 1
                or not math.isclose(
                    execution_numeric["execution_risk_observations"],
                    round(
                        execution_numeric["execution_risk_observations"]
                    ),
                    rel_tol=0.0,
                    abs_tol=1e-12,
                )
                or (
                    execution_boolean[
                        "execution_risk_forecast_available"
                    ]
                    and execution_numeric[
                        "executed_risk_forecast_annualized"
                    ]
                    > execution_numeric[
                        "execution_risk_ceiling_annualized"
                    ]
                    + 1e-10
                )
                or (
                    execution_boolean["risk_rebalance_override"]
                    and (
                        execution_boolean["ordinary_rebalance"]
                        or raw["execution_reason"]
                        not in {
                            "risk_ceiling_override",
                            "mandate_and_risk_override",
                        }
                        or raw["rebalanced"] != "True"
                    )
                )
            ):
                _fail(
                    f"{path}:{index}",
                    "portfolio.execution-risk-value",
                    "Executed-book risk evidence is invalid",
                )
            execution_values: dict[str, Any] = {
                **execution_numeric,
                **execution_boolean,
                "execution_reason": raw["execution_reason"],
                "execution_risk_status": raw[
                    "execution_risk_status"
                ],
            }
            if has_execution_constraints:
                for key in EXECUTION_CONSTRAINT_DAILY_BOOLEANS:
                    if raw[key] not in {"True", "False"}:
                        _fail(
                            f"{path}:{index}/{key}",
                            "portfolio.boolean",
                            f"{key} must be True or False",
                        )
                execution_values.update(
                    {
                        key: _finite(raw[key], f"{path}:{index}/{key}")
                        for key in EXECUTION_CONSTRAINT_DAILY_FLOATS
                    }
                )
                execution_values.update(
                    {
                        key: raw[key] == "True"
                        for key in EXECUTION_CONSTRAINT_DAILY_BOOLEANS
                    }
                )
                if (
                    any(
                        float(execution_values[key]) < 0
                        for key in EXECUTION_CONSTRAINT_DAILY_FLOATS
                    )
                    or execution_values[
                        "executed_constraint_maximum_error"
                    ]
                    > 1e-10
                    or (
                        execution_values[
                            "constraint_rebalance_override"
                        ]
                        and (
                            execution_boolean["ordinary_rebalance"]
                            or raw["execution_reason"]
                            not in {
                                "mandate_constraint_override",
                                "mandate_and_risk_override",
                            }
                            or raw["rebalanced"] != "True"
                        )
                    )
                    or (
                        raw["execution_reason"]
                        == "mandate_and_risk_override"
                        and not execution_boolean[
                            "risk_rebalance_override"
                        ]
                    )
                ):
                    _fail(
                        f"{path}:{index}",
                        "portfolio.execution-constraint-value",
                        "Executed-book constraint evidence is invalid",
                    )
            else:
                execution_values.update(
                    {
                        key: 0.0
                        for key in EXECUTION_CONSTRAINT_DAILY_FLOATS
                    }
                )
                execution_values.update(
                    {
                        key: False
                        for key in EXECUTION_CONSTRAINT_DAILY_BOOLEANS
                    }
                )
            if (
                not (raw["decision_eligible"] == "True")
                and (
                    execution_boolean["ordinary_rebalance"]
                    or (
                        raw["rebalanced"] == "True"
                        and not execution_boolean[
                            "risk_rebalance_override"
                        ]
                        and not execution_values[
                            "constraint_rebalance_override"
                        ]
                    )
                    or raw["execution_reason"]
                    not in {
                        "decision_schedule_hold",
                        "risk_ceiling_override",
                        "mandate_constraint_override",
                        "mandate_and_risk_override",
                    }
                )
            ):
                _fail(
                    f"{path}:{index}",
                    "portfolio.decision-schedule-hold",
                    "An ineligible bar contains an ordinary rebalance",
                )
        else:
            execution_values = {
                **{
                    key: 0.0
                    for key in EXECUTION_RISK_DAILY_FLOATS
                },
                **{
                    key: False
                    for key in EXECUTION_RISK_DAILY_BOOLEANS
                },
                **{
                    key: 0.0
                    for key in EXECUTION_CONSTRAINT_DAILY_FLOATS
                },
                **{
                    key: False
                    for key in EXECUTION_CONSTRAINT_DAILY_BOOLEANS
                },
                "execution_reason": "legacy_unavailable",
                "execution_risk_status": "legacy_unavailable",
            }
        rows.append(
            {
                "timestamp": timestamp,
                **values,
                "cash_weight": cash_weight,
                "rebalanced": raw["rebalanced"] == "True",
                "decision_eligible": (
                    raw["decision_eligible"] == "True"
                ),
                "decision_schedule": decision_schedule,
                "decision_schedule_kind": decision_schedule["kind"],
                "decision_every_bars": decision_every_bars,
                "decision_anchor": decision_anchor,
                "decision_session": decision_session,
                **execution_values,
            }
        )
    return ParsedDaily(dates, rows)


def _parse_weight_panel(
    path: Path,
    universe: list[str],
) -> tuple[list[str], dict[str, dict[str, float]]]:
    fields, raw_rows = _read_csv(
        path,
        required={"timestamp", *universe},
        maximum_rows=MAX_DAILY_ROWS + 1,
    )
    if fields != ["timestamp", *universe]:
        _fail(
            path,
            "portfolio.weight-universe",
            "Weight columns must exactly match Study universe order",
        )
    dates = _strict_dates(raw_rows, path)
    panel: dict[str, dict[str, float]] = {}
    for row_number, (timestamp, raw) in enumerate(
        zip(dates, raw_rows),
        start=2,
    ):
        weights = {
            asset: _finite(raw[asset], f"{path}:{row_number}/{asset}")
            for asset in universe
        }
        if any(abs(value) > 1.0 + 1e-12 for value in weights.values()):
            _fail(
                f"{path}:{row_number}",
                "portfolio.weight-bound",
                "Research weight magnitude cannot exceed 1",
            )
        panel[timestamp] = weights
    return dates, panel


def _parse_decisions(
    path: Path,
    daily: ParsedDaily,
    universe: list[str],
    targets: dict[str, dict[str, float]],
    weights: dict[str, dict[str, float]],
    reference_nav: float,
    mandate: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[tuple[str, str], dict[str, Any]]]:
    fields, raw_rows = _read_csv(
        path,
        required={
            *DECISION_REQUIRED_COLUMNS,
            "tradable",
            "permitted_direction",
            "mandate_id",
            *RISK_DECISION_COLUMNS,
            *LIQUIDITY_DECISION_COLUMNS,
            *EXECUTION_RISK_DECISION_COLUMNS,
            *EXECUTION_CONSTRAINT_DAILY_COLUMNS,
        },
        maximum_rows=MAX_DECISION_ROWS,
    )
    expected = {
        (timestamp, asset)
        for timestamp in daily.dates
        for asset in universe
    }
    decisions: dict[tuple[str, str], dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []
    mandate_columns = {"tradable", "permitted_direction", "mandate_id"}
    has_mandate_columns = mandate_columns.issubset(fields)
    if mandate_columns & set(fields) and not has_mandate_columns:
        _fail(
            path,
            "portfolio.mandate-columns",
            "Decision ledger must contain the complete mandate column set",
        )
    has_risk_columns = RISK_DECISION_COLUMNS.issubset(fields)
    if RISK_DECISION_COLUMNS & set(fields) and not has_risk_columns:
        _fail(
            path,
            "portfolio.risk-governor-columns",
            "Decision ledger must contain the complete risk-governor column set",
        )
    has_liquidity_columns = LIQUIDITY_DECISION_COLUMNS.issubset(fields)
    if LIQUIDITY_DECISION_COLUMNS & set(fields) and not has_liquidity_columns:
        _fail(
            path,
            "portfolio.liquidity-columns",
            "Decision ledger must contain the complete liquidity-capacity column set",
        )
    has_execution_risk_columns = EXECUTION_RISK_DECISION_COLUMNS.issubset(
        fields
    )
    if (
        EXECUTION_RISK_DECISION_COLUMNS & set(fields)
        and not has_execution_risk_columns
    ):
        _fail(
            path,
            "portfolio.execution-risk-columns",
            "Decision ledger must contain the complete execution-risk column set",
        )
    has_execution_constraint_columns = (
        EXECUTION_CONSTRAINT_DAILY_COLUMNS.issubset(fields)
    )
    if (
        EXECUTION_CONSTRAINT_DAILY_COLUMNS & set(fields)
        and not has_execution_constraint_columns
    ):
        _fail(
            path,
            "portfolio.execution-constraint-columns",
            "Decision ledger must contain the complete executed-constraint column set",
        )
    for row_number, raw in enumerate(raw_rows, start=2):
        row_path = f"{path}:{row_number}"
        timestamp = _session_date(raw["timestamp"], f"{row_path}/timestamp")
        asset = raw["asset"]
        key = (timestamp, asset)
        if key not in expected:
            _fail(
                row_path,
                "portfolio.decision-identity",
                "Decision timestamp/asset is outside the daily Study panel",
            )
        if key in decisions:
            _fail(
                row_path,
                "portfolio.duplicate-decision",
                "Decision timestamp/asset must be unique",
            )
        states: dict[str, int] = {}
        for field in ("prior_signal_state", "signal_state", "executed_state"):
            try:
                state = int(raw[field])
            except ValueError:
                _fail(
                    f"{row_path}/{field}",
                    "portfolio.signal-state",
                    "Signal states must be -1, 0, or 1",
                )
            if str(state) != raw[field] or state not in {-1, 0, 1}:
                _fail(
                    f"{row_path}/{field}",
                    "portfolio.signal-state",
                    "Signal states must be -1, 0, or 1",
                )
            states[field] = state
        if raw["decision_eligible"] not in {"True", "False"}:
            _fail(
                f"{row_path}/decision_eligible",
                "portfolio.boolean",
                "decision_eligible must be True or False",
            )
        decision_eligible = raw["decision_eligible"] == "True"
        decision_schedule, decision_every_bars, decision_anchor = (
            _parse_flat_decision_schedule(raw, row_path)
        )
        decision_session = raw["decision_session"]
        if (
            not decision_session
            or (
                decision_anchor == "dataset-start"
                and decision_session != "dataset"
            )
        ):
            _fail(
                f"{row_path}/decision_session",
                "portfolio.decision-session",
                "decision_session is inconsistent with the anchor",
            )
        position_role = raw["position_role"]
        if (
            position_role
            != mandate["assetPositionRoles"].get(asset)
        ):
            _fail(
                f"{row_path}/position_role",
                "portfolio.asset-position-role",
                "Decision position role differs from the Portfolio Mandate",
            )
        long_gross_limit = _finite(
            raw["long_gross_limit"],
            f"{row_path}/long_gross_limit",
        )
        short_gross_limit = _finite(
            raw["short_gross_limit"],
            f"{row_path}/short_gross_limit",
        )
        if (
            not math.isclose(
                long_gross_limit,
                float(mandate["longGrossLimit"]),
                rel_tol=0.0,
                abs_tol=1e-12,
            )
            or not math.isclose(
                short_gross_limit,
                float(mandate["shortGrossLimit"]),
                rel_tol=0.0,
                abs_tol=1e-12,
            )
        ):
            _fail(
                row_path,
                "portfolio.asset-position-side-limit",
                "Decision side limits differ from the Portfolio Mandate",
            )
        optional = {
            field: _optional_finite(raw[field], f"{row_path}/{field}")
            for field in DECISION_OPTIONAL_FLOATS
        }
        try:
            translation_observations = int(raw["translation_observations"])
        except ValueError:
            _fail(
                f"{row_path}/translation_observations",
                "portfolio.translation-observations",
                "translation_observations must be a non-negative integer",
            )
        if (
            str(translation_observations) != raw["translation_observations"]
            or translation_observations < 0
        ):
            _fail(
                f"{row_path}/translation_observations",
                "portfolio.translation-observations",
                "translation_observations must be a non-negative integer",
            )
        translation_method = raw["translation_method"]
        evaluation_mode = raw["evaluation_mode"]
        if (
            translation_method != SIGNAL_TRANSLATION_METHOD
            or evaluation_mode
            not in {
                "cross-sectional",
                "single-asset-temporal",
                "two-asset-relative-value",
            }
        ):
            _fail(
                row_path,
                "portfolio.translation-semantics",
                "Decision translation method or evaluation mode is invalid",
            )
        numeric = {
            field: _finite(raw[field], f"{row_path}/{field}")
            for field in DECISION_FLOATS
        }
        risk_numeric = (
            {
                field: _finite(raw[field], f"{row_path}/{field}")
                for field in RISK_DECISION_FLOATS
            }
            if has_risk_columns
            else {
                "pre_governor_target_weight": numeric[
                    "proposed_target_weight"
                ],
                "risk_estimation_observations": 0.0,
                "risk_forecast_pre_annualized": 0.0,
                "risk_forecast_post_annualized": 0.0,
                "risk_volatility_ceiling_annualized": 0.0,
                "risk_governor_scale": 1.0,
            }
        )
        liquidity_numeric = (
            {
                field: _finite(raw[field], f"{row_path}/{field}")
                for field in LIQUIDITY_DECISION_FLOATS
            }
            if has_liquidity_columns
            else {
                "liquidity_adv_observations": 0.0,
                "causal_adv_dollar_volume": 0.0,
                "reference_nav_adv_participation": 0.0,
                "asset_capacity_nav_1pct": 0.0,
                "asset_capacity_nav_5pct": 0.0,
                "portfolio_capacity_nav_1pct": 0.0,
                "portfolio_capacity_nav_5pct": 0.0,
            }
        )
        execution_risk_numeric = (
            {
                field: _finite(raw[field], f"{row_path}/{field}")
                for field in EXECUTION_RISK_DECISION_FLOATS
            }
            if has_execution_risk_columns
            else {
                field: 0.0 for field in EXECUTION_RISK_DECISION_FLOATS
            }
        )
        execution_risk_booleans: dict[str, bool] = {}
        if has_execution_risk_columns:
            for field in EXECUTION_RISK_DAILY_BOOLEANS:
                if raw[field] not in {"True", "False"}:
                    _fail(
                        f"{row_path}/{field}",
                        "portfolio.boolean",
                        f"{field} must be True or False",
                    )
                execution_risk_booleans[field] = raw[field] == "True"
            if not raw["execution_risk_status"]:
                _fail(
                    f"{row_path}/execution_risk_status",
                    "portfolio.execution-risk-status",
                    "Execution-risk status must be non-empty",
                )
        else:
            execution_risk_booleans = {
                field: False
                for field in EXECUTION_RISK_DAILY_BOOLEANS
            }
        execution_constraint_numeric = (
            {
                field: _finite(raw[field], f"{row_path}/{field}")
                for field in EXECUTION_CONSTRAINT_DAILY_FLOATS
            }
            if has_execution_constraint_columns
            else {
                field: 0.0
                for field in EXECUTION_CONSTRAINT_DAILY_FLOATS
            }
        )
        execution_constraint_booleans = (
            {
                field: raw[field] == "True"
                for field in EXECUTION_CONSTRAINT_DAILY_BOOLEANS
            }
            if has_execution_constraint_columns
            else {
                field: False
                for field in EXECUTION_CONSTRAINT_DAILY_BOOLEANS
            }
        )
        if has_execution_constraint_columns and any(
            raw[field] not in {"True", "False"}
            for field in EXECUTION_CONSTRAINT_DAILY_BOOLEANS
        ):
            _fail(
                row_path,
                "portfolio.boolean",
                "Executed-constraint flags must be True or False",
            )
        for field in (
            "signal_event",
            "allocation_status",
            "target_action",
            "regime",
            "execution_action",
            "execution_reason",
        ):
            if not raw[field]:
                _fail(
                    f"{row_path}/{field}",
                    "portfolio.decision-string",
                    f"{field} must be non-empty",
                )
        if has_risk_columns and not raw["risk_governor_status"]:
            _fail(
                f"{row_path}/risk_governor_status",
                "portfolio.risk-governor-status",
                "Risk-governor status must be non-empty",
            )
        if has_liquidity_columns and (
            raw["liquidity_capacity_status"]
            not in {
                "available",
                "no_trade",
                "insufficient_adv_history",
            }
            or raw["capacity_binding_asset"] not in {"True", "False"}
        ):
            _fail(
                row_path,
                "portfolio.liquidity-status",
                "Liquidity status or binding flag is invalid",
            )
        if has_execution_risk_columns and (
            any(value < 0 for value in execution_risk_numeric.values())
            or not 0
            <= execution_risk_numeric["proposed_runtime_risk_scale"]
            <= 1
            or not 0
            <= execution_risk_numeric["execution_risk_repair_scale"]
            <= 1
            or not math.isclose(
                execution_risk_numeric["execution_risk_observations"],
                round(
                    execution_risk_numeric[
                        "execution_risk_observations"
                    ]
                ),
                rel_tol=0.0,
                abs_tol=1e-12,
            )
            or (
                execution_risk_booleans[
                    "execution_risk_forecast_available"
                ]
                and execution_risk_numeric[
                    "executed_risk_forecast_annualized"
                ]
                > execution_risk_numeric[
                    "execution_risk_ceiling_annualized"
                ]
                + 1e-10
            )
            or (
                execution_risk_booleans["risk_rebalance_override"]
                and (
                    execution_risk_booleans["ordinary_rebalance"]
                    or raw["execution_reason"]
                    not in {
                        "risk_ceiling_override",
                        "mandate_and_risk_override",
                    }
                )
            )
            or any(
                value < 0
                for value in execution_constraint_numeric.values()
            )
            or execution_constraint_numeric[
                "executed_constraint_maximum_error"
            ]
            > 1e-10
            or (
                execution_constraint_booleans[
                    "constraint_rebalance_override"
                ]
                and (
                    execution_risk_booleans["ordinary_rebalance"]
                    or raw["execution_reason"]
                    not in {
                        "mandate_constraint_override",
                        "mandate_and_risk_override",
                    }
                )
            )
            or (
                raw["execution_reason"] == "mandate_and_risk_override"
                and (
                    not execution_risk_booleans[
                        "risk_rebalance_override"
                    ]
                    or not execution_constraint_booleans[
                        "constraint_rebalance_override"
                    ]
                )
            )
        ):
            _fail(
                row_path,
                "portfolio.execution-risk-value",
                "Executed-book risk decision evidence is invalid",
            )
        if (
            not 0.0 <= risk_numeric["risk_governor_scale"] <= 1.0
            or risk_numeric["risk_estimation_observations"] < 0
            or not math.isclose(
                risk_numeric["risk_estimation_observations"],
                round(risk_numeric["risk_estimation_observations"]),
                rel_tol=0.0,
                abs_tol=1e-12,
            )
        ):
            _fail(
                row_path,
                "portfolio.risk-governor-value",
                "Risk scale and estimation observations are invalid",
            )
        if has_risk_columns and (
            not math.isclose(
                numeric["proposed_target_weight"],
                risk_numeric["pre_governor_target_weight"]
                * risk_numeric["risk_governor_scale"],
                rel_tol=0.0,
                abs_tol=1e-10,
            )
            or not math.isclose(
                risk_numeric["risk_forecast_post_annualized"],
                risk_numeric["risk_forecast_pre_annualized"]
                * risk_numeric["risk_governor_scale"],
                rel_tol=0.0,
                abs_tol=1e-10,
            )
            or (
                raw["risk_governor_status"] != "diagnostic_disabled"
                and
                risk_numeric["risk_volatility_ceiling_annualized"] > 0
                and risk_numeric["risk_forecast_post_annualized"]
                > risk_numeric["risk_volatility_ceiling_annualized"] + 1e-10
            )
        ):
            _fail(
                row_path,
                "portfolio.risk-governor-reconciliation",
                "Risk-governor weights or volatility forecasts do not reconcile",
            )
        if (
            any(value < 0 for value in liquidity_numeric.values())
            or not math.isclose(
                liquidity_numeric["liquidity_adv_observations"],
                round(liquidity_numeric["liquidity_adv_observations"]),
                rel_tol=0.0,
                abs_tol=1e-12,
            )
        ):
            _fail(
                row_path,
                "portfolio.liquidity-value",
                "Liquidity-capacity numeric evidence is invalid",
            )
        if has_liquidity_columns:
            status = raw["liquidity_capacity_status"]
            trade = abs(numeric["trade_weight"])
            adv = liquidity_numeric["causal_adv_dollar_volume"]
            if status == "available" and trade > 1e-12:
                expected_participation = (
                    trade * reference_nav / adv
                    if adv > 0
                    else math.inf
                )
                expected_1pct = 0.01 * adv / trade
                if (
                    adv <= 0
                    or not math.isclose(
                        liquidity_numeric[
                            "reference_nav_adv_participation"
                        ],
                        expected_participation,
                        rel_tol=1e-10,
                        abs_tol=1e-8,
                    )
                    or not math.isclose(
                        liquidity_numeric["asset_capacity_nav_1pct"],
                        expected_1pct,
                        rel_tol=1e-10,
                        abs_tol=1e-6,
                    )
                    or not math.isclose(
                        liquidity_numeric["asset_capacity_nav_5pct"],
                        expected_1pct * 5.0,
                        rel_tol=1e-10,
                        abs_tol=1e-6,
                    )
                ):
                    _fail(
                        row_path,
                        "portfolio.liquidity-reconciliation",
                        "Asset liquidity-capacity evidence does not reconcile",
                    )
            elif any(
                liquidity_numeric[field] > 1e-12
                for field in (
                    "reference_nav_adv_participation",
                    "asset_capacity_nav_1pct",
                    "asset_capacity_nav_5pct",
                )
            ):
                _fail(
                    row_path,
                    "portfolio.liquidity-inactive",
                    "Unavailable or inactive asset capacity must be zero",
                )
        if has_mandate_columns:
            if raw["tradable"] not in {"True", "False"}:
                _fail(
                    f"{row_path}/tradable",
                    "portfolio.boolean",
                    "tradable must be True or False",
                )
            if not raw["permitted_direction"] or not raw["mandate_id"]:
                _fail(
                    row_path,
                    "portfolio.mandate-decision",
                    "Mandate decision fields must be non-empty",
                )
        if not math.isclose(
            numeric["proposed_target_weight"],
            targets[timestamp][asset],
            rel_tol=0.0,
            abs_tol=1e-10,
        ):
            _fail(
                row_path,
                "portfolio.target-alignment",
                "Decision target differs from target-weight artifact",
            )
        if not math.isclose(
            numeric["executed_weight"],
            weights[timestamp][asset],
            rel_tol=0.0,
            abs_tol=1e-10,
        ):
            _fail(
                row_path,
                "portfolio.weight-alignment",
                "Decision executed weight differs from weight artifact",
            )
        parsed = {
            "timestamp": timestamp,
            "asset": asset,
            **states,
            **optional,
            **numeric,
            **risk_numeric,
            **liquidity_numeric,
            **execution_risk_numeric,
            **execution_risk_booleans,
            **execution_constraint_numeric,
            **execution_constraint_booleans,
            "decision_eligible": decision_eligible,
            "decision_schedule": decision_schedule,
            "decision_schedule_kind": decision_schedule["kind"],
            "decision_every_bars": decision_every_bars,
            "decision_anchor": decision_anchor,
            "decision_session": decision_session,
            "position_role": position_role,
            "translation_observations": translation_observations,
            "translation_method": translation_method,
            "evaluation_mode": evaluation_mode,
            "long_gross_limit": long_gross_limit,
            "short_gross_limit": short_gross_limit,
            "signal_event": raw["signal_event"],
            "allocation_status": raw["allocation_status"],
            "target_action": raw["target_action"],
            "regime": raw["regime"],
            "execution_action": raw["execution_action"],
            "execution_reason": raw["execution_reason"],
            "risk_governor_status": (
                raw["risk_governor_status"]
                if has_risk_columns
                else "legacy_none"
            ),
            "execution_risk_status": (
                raw["execution_risk_status"]
                if has_execution_risk_columns
                else "legacy_unavailable"
            ),
            "liquidity_capacity_status": (
                raw["liquidity_capacity_status"]
                if has_liquidity_columns
                else "legacy_unavailable"
            ),
            "capacity_binding_asset": (
                raw["capacity_binding_asset"] == "True"
                if has_liquidity_columns
                else False
            ),
            "tradable": (
                raw["tradable"] == "True"
                if has_mandate_columns
                else True
            ),
            "permitted_direction": (
                raw["permitted_direction"]
                if has_mandate_columns
                else "dollar-neutral"
            ),
            "mandate_id": (
                raw["mandate_id"]
                if has_mandate_columns
                else "legacy-dollar-neutral"
            ),
        }
        if not decision_eligible:
            scheduled_signal = (
                parsed["signal_event"] == "decision_schedule_hold"
                and parsed["allocation_status"]
                == "decision_schedule_hold"
                if parsed["tradable"]
                else parsed["signal_event"] == "context_only"
                and parsed["allocation_status"] == "context_only"
            )
            if (
                parsed["prior_signal_state"]
                != parsed["signal_state"]
                or abs(parsed["target_delta"]) > 1e-12
                or not scheduled_signal
                or parsed["ordinary_rebalance"]
                or (
                    abs(parsed["trade_weight"]) > 1e-12
                    and not parsed["risk_rebalance_override"]
                    and not parsed["constraint_rebalance_override"]
                )
            ):
                _fail(
                    row_path,
                    "portfolio.decision-schedule-hold",
                    "An ineligible decision row changed signal, target, or ordinary book",
                )
        decisions[key] = parsed
        ordered.append(parsed)
    missing = expected - decisions.keys()
    if missing:
        timestamp, asset = min(missing)
        _fail(
            path,
            "portfolio.decision-panel",
            f"Missing decision row for {timestamp}/{asset}",
        )
    if len(decisions) != len(expected):
        _fail(
            path,
            "portfolio.decision-panel",
            "Decision ledger must contain exactly one row per date and asset",
        )

    daily_by_date = {row["timestamp"]: row for row in daily.rows}
    for timestamp in daily.dates:
        rows = [decisions[(timestamp, asset)] for asset in universe]
        expected_daily = daily_by_date[timestamp]
        risk_signatures = {
            (
                item["risk_governor_status"],
                item["risk_estimation_observations"],
                item["risk_forecast_pre_annualized"],
                item["risk_forecast_post_annualized"],
                item["risk_volatility_ceiling_annualized"],
                item["risk_governor_scale"],
            )
            for item in rows
        }
        if len(risk_signatures) != 1:
            _fail(
                f"{path}/{timestamp}",
                "portfolio.risk-governor-panel",
                "Risk-governor evidence must be identical across one decision date",
            )
        liquidity_signatures = {
            (
                item["liquidity_capacity_status"],
                item["portfolio_capacity_nav_1pct"],
                item["portfolio_capacity_nav_5pct"],
            )
            for item in rows
        }
        if len(liquidity_signatures) != 1:
            _fail(
                f"{path}/{timestamp}",
                "portfolio.liquidity-panel",
                "Liquidity-capacity evidence must be identical across one date",
            )
        execution_risk_signatures = {
            (
                item["execution_risk_status"],
                item["execution_risk_forecast_available"],
                item["execution_risk_observations"],
                item["pretrade_risk_forecast_annualized"],
                item["proposed_risk_forecast_pre_annualized"],
                item["proposed_risk_forecast_post_annualized"],
                item["executed_risk_forecast_annualized"],
                item["execution_risk_ceiling_annualized"],
                item["proposed_runtime_risk_scale"],
                item["execution_risk_repair_scale"],
                item["proposed_one_way_turnover"],
                item["ordinary_rebalance"],
                item["risk_rebalance_override"],
                item["constraint_rebalance_override"],
                item["constraint_repair_one_way"],
                item["executed_constraint_maximum_error"],
                item["execution_reason"],
                item["decision_eligible"],
                item["decision_schedule_kind"],
                item["decision_every_bars"],
                item["decision_anchor"],
                item["decision_session"],
            )
            for item in rows
        }
        if len(execution_risk_signatures) != 1:
            _fail(
                f"{path}/{timestamp}",
                "portfolio.execution-risk-panel",
                "Execution-risk evidence must be identical across one date",
            )
        execution_signature = next(iter(execution_risk_signatures))
        expected_execution_signature = (
            expected_daily["execution_risk_status"],
            expected_daily["execution_risk_forecast_available"],
            expected_daily["execution_risk_observations"],
            expected_daily["pretrade_risk_forecast_annualized"],
            expected_daily["proposed_risk_forecast_pre_annualized"],
            expected_daily["proposed_risk_forecast_post_annualized"],
            expected_daily["executed_risk_forecast_annualized"],
            expected_daily["execution_risk_ceiling_annualized"],
            expected_daily["proposed_runtime_risk_scale"],
            expected_daily["execution_risk_repair_scale"],
            expected_daily["proposed_one_way_turnover"],
            expected_daily["ordinary_rebalance"],
            expected_daily["risk_rebalance_override"],
            expected_daily["constraint_rebalance_override"],
            expected_daily["constraint_repair_one_way"],
            expected_daily["executed_constraint_maximum_error"],
            expected_daily["execution_reason"],
            expected_daily["decision_eligible"],
            expected_daily["decision_schedule_kind"],
            expected_daily["decision_every_bars"],
            expected_daily["decision_anchor"],
            expected_daily["decision_session"],
        )
        if execution_signature[0] != "legacy_unavailable":
            for actual, expected_value in zip(
                execution_signature,
                expected_execution_signature,
            ):
                if isinstance(actual, float):
                    matches = math.isclose(
                        actual,
                        float(expected_value),
                        rel_tol=1e-10,
                        abs_tol=1e-10,
                    )
                else:
                    matches = actual == expected_value
                if not matches:
                    _fail(
                        f"{path}/{timestamp}",
                        "portfolio.execution-risk-daily",
                        "Decision execution-risk evidence differs from daily evidence",
                    )
        status, capacity_1pct, capacity_5pct = next(
            iter(liquidity_signatures)
        )
        active_rows = [
            item for item in rows if abs(item["trade_weight"]) > 1e-12
        ]
        binding_rows = [
            item for item in rows if item["capacity_binding_asset"]
        ]
        if status == "available":
            if (
                not active_rows
                or len(binding_rows) != 1
                or capacity_1pct <= 0
                or not math.isclose(
                    capacity_5pct,
                    capacity_1pct * 5.0,
                    rel_tol=1e-10,
                    abs_tol=1e-6,
                )
                or not math.isclose(
                    binding_rows[0]["asset_capacity_nav_1pct"],
                    capacity_1pct,
                    rel_tol=1e-10,
                    abs_tol=1e-6,
                )
            ):
                _fail(
                    f"{path}/{timestamp}",
                    "portfolio.liquidity-binding",
                    "Available capacity must reconcile one binding active asset",
                )
        elif status == "no_trade":
            if active_rows or binding_rows or capacity_1pct or capacity_5pct:
                _fail(
                    f"{path}/{timestamp}",
                    "portfolio.liquidity-no-trade",
                    "No-trade capacity evidence is inconsistent",
                )
        elif status == "insufficient_adv_history":
            if (
                not active_rows
                or binding_rows
                or capacity_1pct
                or capacity_5pct
                or all(
                    item["causal_adv_dollar_volume"] > 0
                    for item in active_rows
                )
            ):
                _fail(
                    f"{path}/{timestamp}",
                    "portfolio.liquidity-unavailable",
                    "Incomplete active ADV must not publish capacity",
                )
        reconciliations = (
            (
                sum(item["gross_return_contribution"] for item in rows),
                expected_daily["gross_return"],
                "gross return",
            ),
            (
                sum(item["cost_contribution"] for item in rows),
                expected_daily["cost"],
                "cost",
            ),
            (
                sum(item["net_return_contribution"] for item in rows),
                expected_daily["net_return"],
                "net return",
            ),
            (
                sum(abs(item["trade_weight"]) for item in rows),
                expected_daily["traded_notional"],
                "traded notional",
            ),
        )
        for actual, expected_value, label in reconciliations:
            if not math.isclose(
                actual,
                expected_value,
                rel_tol=0.0,
                abs_tol=1e-9,
            ):
                _fail(
                    f"{path}/{timestamp}",
                    "portfolio.reconciliation",
                    f"Decision ledger does not reconcile daily {label}",
                )
        has_trade = (
            sum(abs(item["trade_weight"]) for item in rows) > 1e-12
        )
        if has_trade != bool(expected_daily["rebalanced"]):
            _fail(
                f"{path}/{timestamp}",
                "portfolio.rebalance-reconciliation",
                "Daily rebalance flag differs from the exact trade vector",
            )
    return ordered, decisions


def _split_contract(result: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    metrics = result.get("metrics", {})
    protocol = metrics.get("split_protocol")
    if not isinstance(protocol, dict):
        _fail(
            "RunResult/metrics/split_protocol",
            "portfolio.split-protocol",
            "Portfolio Run is missing fixed split protocol",
        )
    splits = protocol.get("splits")
    if not isinstance(splits, dict) or set(splits) != {
        "train",
        "validation",
        "test",
    }:
        _fail(
            "RunResult/metrics/split_protocol/splits",
            "portfolio.split-protocol",
            "Expected train, validation, and test splits",
        )
    normalized: dict[str, Any] = {}
    ordered_names = ["train", "validation", "test"]
    prior_end: str | None = None
    for name in ordered_names:
        split = splits[name]
        if not isinstance(split, dict):
            _fail(
                f"RunResult/metrics/split_protocol/splits/{name}",
                "portfolio.split-protocol",
                "Split must be an object",
            )
        start = _session_date(
            split.get("start"),
            f"RunResult/metrics/split_protocol/splits/{name}/start",
        )
        end = _session_date(
            split.get("end"),
            f"RunResult/metrics/split_protocol/splits/{name}/end",
        )
        signal_end = _session_date(
            split.get("signalEnd"),
            f"RunResult/metrics/split_protocol/splits/{name}/signalEnd",
        )
        if not start <= signal_end <= end or (
            prior_end is not None and start <= prior_end
        ):
            _fail(
                f"RunResult/metrics/split_protocol/splits/{name}",
                "portfolio.split-order",
                "Splits must be chronological and signalEnd must be bounded",
            )
        normalized[name] = {
            "start": start,
            "end": end,
            "signalEnd": signal_end,
            "role": "selection" if name == "validation" else (
                "visible-audit" if name == "test" else "training"
            ),
        }
        prior_end = end
    return normalized, ordered_names


def _split_for(timestamp: str, splits: dict[str, Any], names: list[str]) -> str:
    for name in names:
        if splits[name]["start"] <= timestamp <= splits[name]["end"]:
            return name
    _fail(
        timestamp,
        "portfolio.split-membership",
        "Daily timestamp does not belong to exactly one fixed split",
    )


def _sample_indices(
    total: int,
    limit: int,
    anchors: set[int],
) -> list[int]:
    if total <= limit:
        return list(range(total))
    fixed = sorted(index for index in anchors if 0 <= index < total)
    if len(fixed) > limit:
        _fail(
            "portfolio sampling",
            "portfolio.sample-limit",
            "Point limit is smaller than required accounting anchors",
        )
    candidates = [index for index in range(total) if index not in anchors]
    slots = limit - len(fixed)
    selected: set[int] = set(fixed)
    if slots >= len(candidates):
        selected.update(candidates)
    elif slots == 1:
        selected.add(candidates[len(candidates) // 2])
    elif slots > 1:
        positions = {
            round(position * (len(candidates) - 1) / (slots - 1))
            for position in range(slots)
        }
        selected.update(candidates[position] for position in positions)
        if len(selected) < limit:
            selected.update(
                candidate
                for candidate in candidates
                if candidate not in selected
                for _ in [None]
                if len(selected) < limit
            )
    return sorted(selected)


def _parameter_configuration_id(profile_id: str, band: float) -> str:
    return f"{profile_id}__band-{int(round(band * 100)):03d}"


def _compare_parameter_value(
    actual: Any,
    expected: Any,
    path: str,
) -> None:
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            _fail(
                path,
                "portfolio.parameter-neighborhood-metric",
                "Parameter-neighborhood metric keys do not reconcile",
            )
        for key, expected_value in expected.items():
            _compare_parameter_value(
                actual[key],
                expected_value,
                f"{path}/{key}",
            )
        return
    if isinstance(expected, bool):
        if actual is not expected:
            _fail(
                path,
                "portfolio.parameter-neighborhood-metric",
                "Parameter-neighborhood boolean does not reconcile",
            )
        return
    if isinstance(expected, (int, float)):
        if (
            not isinstance(actual, (int, float))
            or isinstance(actual, bool)
            or not math.isclose(
                float(actual),
                float(expected),
                rel_tol=1e-9,
                abs_tol=1e-11,
            )
        ):
            _fail(
                path,
                "portfolio.parameter-neighborhood-metric",
                "Parameter-neighborhood numeric value does not reconcile",
            )
        return
    if actual != expected:
        _fail(
            path,
            "portfolio.parameter-neighborhood-metric",
            "Parameter-neighborhood value does not reconcile",
        )


def _parameter_neighborhood_projection(
    result: dict[str, Any],
    artifact_path: Path | None,
    daily: ParsedDaily,
    splits: dict[str, Any],
) -> dict[str, Any]:
    metric = result["metrics"].get("parameter_neighborhood")
    if metric is None and artifact_path is None:
        return {
            "available": False,
            "policy": None,
            "validation": None,
            "test": None,
        }
    if not isinstance(metric, dict) or artifact_path is None:
        _fail(
            "RunResult/metrics/parameter_neighborhood",
            "portfolio.parameter-neighborhood-availability",
            "Parameter-neighborhood metric and artifact must appear together",
        )
    signal_parameters = result["metrics"].get("signal_policy", {}).get(
        "parameters",
        {},
    )
    base_band = _finite(
        signal_parameters.get("no_trade_one_way"),
        "RunResult/metrics/signal_policy/parameters/no_trade_one_way",
    )
    adverse_band = min(1.0, max(0.10, 2.0 * base_band))
    no_trade_bands = tuple(
        dict.fromkeys((0.0, base_band, adverse_band))
    )
    base_configuration_id = _parameter_configuration_id(
        "base",
        base_band,
    )
    try:
        payload = json.loads(artifact_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        _fail(
            artifact_path,
            "portfolio.parameter-neighborhood-json",
            "Parameter-neighborhood artifact must be UTF-8 JSON",
        )
    if not isinstance(payload, dict) or set(payload) != {
        "schemaVersion",
        "inputHash",
        "method",
        "baseConfigurationId",
        "signalProfiles",
        "noTradeBands",
        "rows",
    }:
        _fail(
            artifact_path,
            "portfolio.parameter-neighborhood-shape",
            "Parameter-neighborhood artifact has an unexpected root shape",
        )
    if (
        payload["schemaVersion"] != 1
        or payload["inputHash"] != result["inputHash"]
        or payload["method"] != PARAMETER_NEIGHBORHOOD_METHOD
        or payload["baseConfigurationId"]
        != base_configuration_id
        or payload["signalProfiles"] != list(PARAMETER_SIGNAL_PROFILES)
        or payload["noTradeBands"] != list(no_trade_bands)
    ):
        _fail(
            artifact_path,
            "portfolio.parameter-neighborhood-contract",
            "Parameter-neighborhood fixed contract does not reconcile",
        )
    raw_rows = payload["rows"]
    if (
        not isinstance(raw_rows, list)
        or len(raw_rows) > MAX_NEIGHBORHOOD_ROWS
    ):
        _fail(
            artifact_path,
            "portfolio.parameter-neighborhood-rows",
            "Parameter-neighborhood rows exceed the bounded JSON contract",
        )
    row_fields = {
        "configurationId",
        "signalProfile",
        "noTradeOneWay",
        "split",
        "role",
        "timestamp",
        "netReturn",
        "benchmarkReturn",
        "oneWayTurnover",
        "cost",
        "rebalanced",
        "signalDecisionRows",
        "signalTransitions",
        "entries",
        "exits",
        "reversals",
    }
    configuration_ids = [
        _parameter_configuration_id(profile["id"], band)
        for profile in PARAMETER_SIGNAL_PROFILES
        for band in no_trade_bands
    ]
    profile_by_configuration = {
        _parameter_configuration_id(profile["id"], band): (
            profile["id"],
            band,
        )
        for profile in PARAMETER_SIGNAL_PROFILES
        for band in no_trade_bands
    }
    daily_dates = set(daily.dates)
    expected_dates = {
        split: [
            timestamp
            for timestamp in daily.dates
            if (
                splits[split]["start"]
                <= timestamp
                <= splits[split]["signalEnd"]
            )
        ]
        for split in ("validation", "test")
    }
    expected_order = [
        (configuration_id, split, timestamp)
        for configuration_id in configuration_ids
        for split in ("validation", "test")
        for timestamp in expected_dates[split]
    ]
    if len(raw_rows) != len(expected_order):
        _fail(
            artifact_path,
            "portfolio.parameter-neighborhood-coverage",
            "Parameter-neighborhood rows do not cover every fixed cell/date",
        )
    parsed: dict[tuple[str, str], list[dict[str, Any]]] = {
        (configuration_id, split): []
        for configuration_id in configuration_ids
        for split in ("validation", "test")
    }
    observed_order: list[tuple[str, str, str]] = []
    for index, row in enumerate(raw_rows):
        path = f"{artifact_path}/rows/{index}"
        if not isinstance(row, dict) or set(row) != row_fields:
            _fail(
                path,
                "portfolio.parameter-neighborhood-row",
                "Parameter-neighborhood row has an unexpected shape",
            )
        configuration_id = row["configurationId"]
        split = row["split"]
        timestamp = _session_date(row["timestamp"], f"{path}/timestamp")
        if (
            configuration_id not in profile_by_configuration
            or split not in {"validation", "test"}
            or timestamp not in daily_dates
        ):
            _fail(
                path,
                "portfolio.parameter-neighborhood-identity",
                "Parameter-neighborhood row identity is outside the fixed panel",
            )
        profile_id, band = profile_by_configuration[configuration_id]
        expected_role = (
            "selection-context"
            if split == "validation"
            else "visible-audit"
        )
        if (
            row["signalProfile"] != profile_id
            or not isinstance(row["noTradeOneWay"], (int, float))
            or isinstance(row["noTradeOneWay"], bool)
            or not math.isclose(
                float(row["noTradeOneWay"]),
                float(band),
                rel_tol=0.0,
                abs_tol=1e-12,
            )
            or row["role"] != expected_role
        ):
            _fail(
                path,
                "portfolio.parameter-neighborhood-identity",
                "Parameter-neighborhood row parameters do not reconcile",
            )
        numeric = {
            key: _finite(row[key], f"{path}/{key}")
            for key in (
                "netReturn",
                "benchmarkReturn",
                "oneWayTurnover",
                "cost",
            )
        }
        if numeric["oneWayTurnover"] < 0 or numeric["cost"] < 0:
            _fail(
                path,
                "portfolio.parameter-neighborhood-accounting",
                "Turnover and cost must be non-negative",
            )
        if type(row["rebalanced"]) is not bool:
            _fail(
                f"{path}/rebalanced",
                "portfolio.parameter-neighborhood-accounting",
                "Rebalanced must be boolean",
            )
        counts: dict[str, int] = {}
        for key in (
            "signalDecisionRows",
            "signalTransitions",
            "entries",
            "exits",
            "reversals",
        ):
            value = row[key]
            if (
                not isinstance(value, int)
                or isinstance(value, bool)
                or value < 0
            ):
                _fail(
                    f"{path}/{key}",
                    "portfolio.parameter-neighborhood-signal",
                    "Signal counts must be non-negative integers",
                )
            counts[key] = value
        if (
            counts["signalTransitions"]
            > counts["signalDecisionRows"]
            or counts["entries"]
            + counts["exits"]
            + counts["reversals"]
            > counts["signalTransitions"]
        ):
            _fail(
                path,
                "portfolio.parameter-neighborhood-signal",
                "Signal transition counts are internally inconsistent",
            )
        observed_order.append((configuration_id, split, timestamp))
        parsed[(configuration_id, split)].append(
            {
                "timestamp": timestamp,
                **numeric,
                "rebalanced": row["rebalanced"],
                **counts,
            }
        )
    if observed_order != expected_order:
        _fail(
            artifact_path,
            "portfolio.parameter-neighborhood-order",
            "Parameter-neighborhood rows must follow the fixed deterministic order",
        )

    reconstructed: dict[str, dict[str, Any]] = {
        "validation": {},
        "test": {},
    }
    for configuration_id in configuration_ids:
        for split in ("validation", "test"):
            rows = parsed[(configuration_id, split)]
            frame = pd.DataFrame(rows).set_index("timestamp")
            performance = performance_metrics(
                frame["netReturn"],
                frame["benchmarkReturn"],
            )
            decision_rows = int(frame["signalDecisionRows"].sum())
            transitions = int(frame["signalTransitions"].sum())
            implementation = {
                "mean_one_way_turnover": float(
                    frame["oneWayTurnover"].mean()
                ),
                "annualized_one_way_turnover": float(
                    frame["oneWayTurnover"].mean()
                    * annualization_periods(frame.index)
                ),
                "total_cost_drag": float(frame["cost"].sum()),
                "rebalance_rate": float(frame["rebalanced"].mean()),
                "no_trade_rate": float((~frame["rebalanced"]).mean()),
            }
            signal = {
                "decision_rows": decision_rows,
                "timestamps": int(len(frame)),
                "signal_transitions": transitions,
                "state_change_rate": (
                    float(transitions / decision_rows)
                    if decision_rows
                    else 0.0
                ),
                "entries": int(frame["entries"].sum()),
                "exits": int(frame["exits"].sum()),
                "reversals": int(frame["reversals"].sum()),
            }
            reconstructed[split][configuration_id] = {
                "performance": performance,
                "implementation": implementation,
                "signal": signal,
            }

    expected_metric: dict[str, Any] = {}
    for split in ("validation", "test"):
        base = reconstructed[split][base_configuration_id]
        for configuration_id in configuration_ids:
            current = reconstructed[split][configuration_id]
            current["delta_vs_base"] = {
                "net_sharpe": (
                    current["performance"]["sharpe"]
                    - base["performance"]["sharpe"]
                ),
                "total_return": (
                    current["performance"]["total_return"]
                    - base["performance"]["total_return"]
                ),
                "annualized_one_way_turnover": (
                    current["implementation"][
                        "annualized_one_way_turnover"
                    ]
                    - base["implementation"][
                        "annualized_one_way_turnover"
                    ]
                ),
                "total_cost_drag": (
                    current["implementation"]["total_cost_drag"]
                    - base["implementation"]["total_cost_drag"]
                ),
                "signal_transitions": (
                    current["signal"]["signal_transitions"]
                    - base["signal"]["signal_transitions"]
                ),
            }
        sharpes = [
            reconstructed[split][configuration_id]["performance"]["sharpe"]
            for configuration_id in configuration_ids
        ]
        base_sharpe = base["performance"]["sharpe"]
        turnovers = [
            reconstructed[split][configuration_id]["implementation"][
                "annualized_one_way_turnover"
            ]
            for configuration_id in configuration_ids
        ]
        costs = [
            reconstructed[split][configuration_id]["implementation"][
                "total_cost_drag"
            ]
            for configuration_id in configuration_ids
        ]
        transitions = [
            reconstructed[split][configuration_id]["signal"][
                "signal_transitions"
            ]
            for configuration_id in configuration_ids
        ]
        base_sign = 1 if base_sharpe > 0 else -1 if base_sharpe < 0 else 0
        expected_metric[split] = {
            "configurations": reconstructed[split],
            "aggregate": {
                "configuration_count": len(configuration_ids),
                "base_net_sharpe": base_sharpe,
                "positive_net_sharpe_rate": float(
                    sum(value > 0 for value in sharpes) / len(sharpes)
                ),
                "sign_agreement_with_base_rate": float(
                    sum(
                        (
                            1
                            if value > 0
                            else -1
                            if value < 0
                            else 0
                        )
                        == base_sign
                        for value in sharpes
                    )
                    / len(sharpes)
                ),
                "minimum_net_sharpe": min(sharpes),
                "median_net_sharpe": float(pd.Series(sharpes).median()),
                "maximum_net_sharpe": max(sharpes),
                "net_sharpe_std": float(
                    pd.Series(sharpes).std(ddof=0)
                ),
                "worst_net_sharpe_delta": min(
                    value - base_sharpe for value in sharpes
                ),
                "best_net_sharpe_delta": max(
                    value - base_sharpe for value in sharpes
                ),
                "minimum_annualized_one_way_turnover": min(turnovers),
                "maximum_annualized_one_way_turnover": max(turnovers),
                "minimum_total_cost_drag": min(costs),
                "maximum_total_cost_drag": max(costs),
                "minimum_signal_transitions": min(transitions),
                "maximum_signal_transitions": max(transitions),
            },
        }
    expected_policy = {
        "method": PARAMETER_NEIGHBORHOOD_METHOD,
        "base_configuration_id": base_configuration_id,
        "role": "robustness-only",
        "selection_authority": "context-only",
        "trading_authority": "none",
        "configuration_count": len(configuration_ids),
        "signal_profiles": [
            {
                "id": profile["id"],
                "label": profile["label"],
                "long_entry": profile["longEntry"],
                "long_exit": profile["longExit"],
                "short_exit": profile["shortExit"],
                "short_entry": profile["shortEntry"],
            }
            for profile in PARAMETER_SIGNAL_PROFILES
        ],
        "no_trade_bands": list(no_trade_bands),
    }
    _compare_parameter_value(
        metric,
        {
            "policy": expected_policy,
            "validation": expected_metric["validation"],
            "test": expected_metric["test"],
        },
        "RunResult/metrics/parameter_neighborhood",
    )
    for split in ("validation", "test"):
        base_reconciliation = {
            "performance": result["metrics"]["portfolio"][split]["net"],
            "implementation": {
                key: result["metrics"]["implementation"][split][key]
                for key in (
                    "mean_one_way_turnover",
                    "annualized_one_way_turnover",
                    "total_cost_drag",
                    "rebalance_rate",
                    "no_trade_rate",
                )
            },
            "signal": {
                key: result["metrics"]["signal_policy"][split][key]
                for key in (
                    "decision_rows",
                    "timestamps",
                    "signal_transitions",
                    "state_change_rate",
                    "entries",
                    "exits",
                    "reversals",
                )
            },
        }
        _compare_parameter_value(
            reconstructed[split][base_configuration_id],
            {
                **base_reconciliation,
                "delta_vs_base": {
                    "net_sharpe": 0.0,
                    "total_return": 0.0,
                    "annualized_one_way_turnover": 0.0,
                    "total_cost_drag": 0.0,
                    "signal_transitions": 0,
                },
            },
            f"RunResult/metrics/parameter_neighborhood/base/{split}",
        )

    def split_projection(split: str) -> dict[str, Any]:
        aggregate = expected_metric[split]["aggregate"]
        return {
            "aggregate": {
                "configurationCount": aggregate["configuration_count"],
                "baseNetSharpe": aggregate["base_net_sharpe"],
                "positiveNetSharpeRate": aggregate[
                    "positive_net_sharpe_rate"
                ],
                "signAgreementWithBaseRate": aggregate[
                    "sign_agreement_with_base_rate"
                ],
                "minimumNetSharpe": aggregate["minimum_net_sharpe"],
                "medianNetSharpe": aggregate["median_net_sharpe"],
                "maximumNetSharpe": aggregate["maximum_net_sharpe"],
                "netSharpeStd": aggregate["net_sharpe_std"],
                "worstNetSharpeDelta": aggregate[
                    "worst_net_sharpe_delta"
                ],
                "bestNetSharpeDelta": aggregate[
                    "best_net_sharpe_delta"
                ],
                "minimumAnnualizedOneWayTurnover": aggregate[
                    "minimum_annualized_one_way_turnover"
                ],
                "maximumAnnualizedOneWayTurnover": aggregate[
                    "maximum_annualized_one_way_turnover"
                ],
                "minimumTotalCostDrag": aggregate[
                    "minimum_total_cost_drag"
                ],
                "maximumTotalCostDrag": aggregate[
                    "maximum_total_cost_drag"
                ],
                "minimumSignalTransitions": aggregate[
                    "minimum_signal_transitions"
                ],
                "maximumSignalTransitions": aggregate[
                    "maximum_signal_transitions"
                ],
            },
            "configurations": [
                {
                    "id": configuration_id,
                    "signalProfile": profile_by_configuration[
                        configuration_id
                    ][0],
                    "noTradeOneWay": profile_by_configuration[
                        configuration_id
                    ][1],
                    "isBase": (
                        configuration_id
                        == base_configuration_id
                    ),
                    "netSharpe": reconstructed[split][configuration_id][
                        "performance"
                    ]["sharpe"],
                    "totalReturn": reconstructed[split][configuration_id][
                        "performance"
                    ]["total_return"],
                    "annualizedOneWayTurnover": reconstructed[split][
                        configuration_id
                    ]["implementation"]["annualized_one_way_turnover"],
                    "totalCostDrag": reconstructed[split][configuration_id][
                        "implementation"
                    ]["total_cost_drag"],
                    "rebalanceRate": reconstructed[split][configuration_id][
                        "implementation"
                    ]["rebalance_rate"],
                    "signalTransitions": reconstructed[split][
                        configuration_id
                    ]["signal"]["signal_transitions"],
                    "netSharpeDeltaVsBase": reconstructed[split][
                        configuration_id
                    ]["delta_vs_base"]["net_sharpe"],
                }
                for configuration_id in configuration_ids
            ],
        }

    return {
        "available": True,
        "policy": {
            "method": PARAMETER_NEIGHBORHOOD_METHOD,
            "baseConfigurationId": base_configuration_id,
            "role": "robustness-only",
            "selectionAuthority": "context-only",
            "tradingAuthority": "none",
            "configurationCount": len(configuration_ids),
            "signalProfiles": list(PARAMETER_SIGNAL_PROFILES),
            "noTradeBands": list(no_trade_bands),
        },
        "validation": split_projection("validation"),
        "test": split_projection("test"),
    }


def _translation_robustness_projection(
    result: dict[str, Any],
    artifact_path: Path | None,
    ordered_decisions: list[dict[str, Any]],
    daily: ParsedDaily,
    splits: dict[str, Any],
    prediction_population: dict[str, Any],
    mandate: dict[str, Any],
) -> dict[str, Any]:
    metric = result["metrics"].get("translation_robustness")
    if metric is None and artifact_path is None:
        return {
            "applicable": False,
            "reason": "legacy-run-evidence-unavailable",
            "policy": None,
            "diagnosis": None,
            "validation": None,
            "test": None,
            "current": None,
        }
    if not isinstance(metric, dict):
        _fail(
            "RunResult/metrics/translation_robustness",
            "portfolio.translation-robustness-availability",
            "Portfolio Run must disclose target-translation robustness",
        )
    mode = str(prediction_population["evaluation_mode"])
    policy = {
        "method": TRANSLATION_ROBUSTNESS_METHOD,
        "evaluation_mode": mode,
        "role": "robustness-only",
        "selection_authority": "context-only",
        "test_enters_diagnosis": False,
        "trading_authority": "none",
        "base_profile_id": "base",
        "profiles": [dict(profile) for profile in TRANSLATION_ROBUSTNESS_PROFILES],
        "stability_thresholds": {
            "minimum_active_state_agreement_rate": (
                TRANSLATION_ACTIVE_AGREEMENT_FLOOR
            ),
            "maximum_mean_absolute_target_delta": (
                TRANSLATION_TARGET_MAE_CEILING
            ),
        },
    }
    if mode not in TEMPORAL_EVALUATION_MODES:
        if artifact_path is not None:
            _fail(
                artifact_path,
                "portfolio.translation-robustness-applicability",
                "Cross-sectional Runs must not publish temporal-window paths",
            )
        expected = {
            "applicable": False,
            "reason": "cross-sectional-mode-has-no-temporal-window",
            "policy": policy,
            "diagnosis": {
                "selection_split": "validation",
                "status": "not-applicable",
                "explanation": (
                    "Cross-sectional decision scores use the same-timestamp "
                    "prediction population and have no temporal history window."
                ),
            },
            "validation": None,
            "test": None,
            "current": None,
        }
        _compare_parameter_value(
            metric,
            expected,
            "RunResult/metrics/translation_robustness",
        )
        return {
            "applicable": False,
            "reason": expected["reason"],
            "policy": {
                "method": policy["method"],
                "evaluationMode": mode,
                "role": policy["role"],
                "selectionAuthority": policy["selection_authority"],
                "testEntersDiagnosis": False,
                "tradingAuthority": "none",
                "profiles": policy["profiles"],
                "stabilityThresholds": policy["stability_thresholds"],
            },
            "diagnosis": expected["diagnosis"],
            "validation": None,
            "test": None,
            "current": None,
        }
    if artifact_path is None:
        _fail(
            "RunResult/metrics/translation_robustness",
            "portfolio.translation-robustness-availability",
            "Temporal translation robustness requires its immutable artifact",
        )
    try:
        payload = json.loads(artifact_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        _fail(
            artifact_path,
            "portfolio.translation-robustness-json",
            "Translation-robustness artifact must be UTF-8 JSON",
        )
    root_fields = {
        "schemaVersion",
        "inputHash",
        "method",
        "evaluationMode",
        "predictionAssets",
        "profiles",
        "assetRows",
        "dailyRows",
    }
    prediction_assets = list(prediction_population["prediction_assets"])
    if (
        not isinstance(payload, dict)
        or set(payload) != root_fields
        or payload["schemaVersion"] != 1
        or payload["inputHash"] != result["inputHash"]
        or payload["method"] != TRANSLATION_ROBUSTNESS_METHOD
        or payload["evaluationMode"] != mode
        or payload["predictionAssets"] != prediction_assets
        or payload["profiles"]
        != [dict(profile) for profile in TRANSLATION_ROBUSTNESS_PROFILES]
    ):
        _fail(
            artifact_path,
            "portfolio.translation-robustness-contract",
            "Translation-robustness fixed contract does not reconcile",
        )
    asset_rows = payload["assetRows"]
    daily_rows = payload["dailyRows"]
    if (
        not isinstance(asset_rows, list)
        or not isinstance(daily_rows, list)
        or len(asset_rows) + len(daily_rows)
        > MAX_TRANSLATION_ROBUSTNESS_ROWS
    ):
        _fail(
            artifact_path,
            "portfolio.translation-robustness-rows",
            "Translation-robustness rows exceed the bounded contract",
        )

    dates = list(dict.fromkeys(row["timestamp"] for row in ordered_decisions))
    decisions = {
        (row["timestamp"], row["asset"]): row for row in ordered_decisions
    }
    factor_panel = pd.DataFrame(
        math.nan,
        index=dates,
        columns=list(prediction_population["research_assets"]),
        dtype=float,
    )
    for row in ordered_decisions:
        factor_panel.loc[row["timestamp"], row["asset"]] = (
            math.nan if row["factor"] is None else float(row["factor"])
        )
    expected_asset_order = [
        (str(profile["id"]), timestamp, asset)
        for profile in TRANSLATION_ROBUSTNESS_PROFILES
        for timestamp in dates
        for asset in prediction_assets
    ]
    if len(asset_rows) != len(expected_asset_order):
        _fail(
            artifact_path,
            "portfolio.translation-robustness-coverage",
            "Translation-robustness asset rows do not cover every profile/date/asset",
        )
    asset_fields = {
        "profileId",
        "timestamp",
        "asset",
        "score",
        "observations",
        "signalState",
        "targetWeight",
    }
    parsed_assets: dict[str, dict[str, dict[str, dict[str, Any]]]] = {
        str(profile["id"]): {} for profile in TRANSLATION_ROBUSTNESS_PROFILES
    }
    observed_asset_order: list[tuple[str, str, str]] = []
    roles = mandate["assetPositionRoles"]
    caps = mandate["assetMaxAbsWeights"]
    pair = prediction_population.get("relative_value_pair")
    for profile in TRANSLATION_ROBUSTNESS_PROFILES:
        profile_id = str(profile["id"])
        scores, _, observations, semantics = translate_factor_scores(
            factor_panel,
            prediction_population,
            temporal_window=int(profile["window"]),
            temporal_minimum=int(profile["minimum"]),
        )
        if (
            semantics["window_observations"] != profile["window"]
            or semantics["minimum_observations"] != profile["minimum"]
        ):
            _fail(
                artifact_path,
                "portfolio.translation-robustness-semantics",
                "Translation profile does not use its fixed causal window",
            )
        prior_states = {asset: 0 for asset in prediction_assets}
        for timestamp in dates:
            parsed_assets[profile_id][timestamp] = {}
            decision_eligible = bool(
                decisions[(timestamp, prediction_assets[0])]["decision_eligible"]
            )
            for asset in prediction_assets:
                row_index = len(observed_asset_order)
                row = asset_rows[row_index]
                path = f"{artifact_path}/assetRows/{row_index}"
                if not isinstance(row, dict) or set(row) != asset_fields:
                    _fail(
                        path,
                        "portfolio.translation-robustness-row",
                        "Translation asset row has an unexpected shape",
                    )
                observed_asset_order.append(
                    (row["profileId"], row["timestamp"], row["asset"])
                )
                expected_score = scores.loc[timestamp, asset]
                actual_score = row["score"]
                score_matches = (
                    actual_score is None and pd.isna(expected_score)
                ) or (
                    actual_score is not None
                    and math.isclose(
                        _finite(actual_score, f"{path}/score"),
                        float(expected_score),
                        rel_tol=1e-10,
                        abs_tol=1e-12,
                    )
                )
                if (
                    not score_matches
                    or row["observations"]
                    != int(observations.loc[timestamp, asset])
                ):
                    _fail(
                        path,
                        "portfolio.translation-robustness-score",
                        "Translation score does not reconcile from causal Factor history",
                    )
                decision = decisions[(timestamp, asset)]
                usable_score = (
                    None
                    if pd.isna(expected_score)
                    or decision["trailing_volatility"] is None
                    else float(expected_score)
                )
                if decision_eligible:
                    expected_state, _ = _position_role_signal_transition(
                        prior_states[asset],
                        usable_score,
                        role=str(roles[asset]),
                        long_entry=LONG_ENTRY_PERCENTILE,
                        long_exit=LONG_EXIT_PERCENTILE,
                        short_exit=SHORT_EXIT_PERCENTILE,
                        short_entry=SHORT_ENTRY_PERCENTILE,
                    )
                else:
                    expected_state = prior_states[asset]
                if (
                    not isinstance(row["signalState"], int)
                    or isinstance(row["signalState"], bool)
                    or row["signalState"] != expected_state
                ):
                    _fail(
                        path,
                        "portfolio.translation-robustness-state",
                        "Translation signal state does not reconcile",
                    )
                target = _finite(row["targetWeight"], f"{path}/targetWeight")
                if (
                    abs(target) > float(caps[asset]) + 1e-9
                    or target * expected_state < -1e-12
                    or (expected_state == 0 and abs(target) > 1e-12)
                    or (
                        profile_id == "base"
                        and not math.isclose(
                            target,
                            float(decision["proposed_target_weight"]),
                            rel_tol=1e-9,
                            abs_tol=1e-11,
                        )
                    )
                ):
                    _fail(
                        path,
                        "portfolio.translation-robustness-target",
                        "Translation target violates state, cap, or base reconciliation",
                    )
                parsed_assets[profile_id][timestamp][asset] = {
                    "score": None if actual_score is None else float(actual_score),
                    "observations": int(row["observations"]),
                    "signal_state": expected_state,
                    "target_weight": target,
                }
                prior_states[asset] = expected_state
            if isinstance(pair, dict):
                left = str(pair["left_asset"])
                right = str(pair["right_asset"])
                left_target = parsed_assets[profile_id][timestamp][left][
                    "target_weight"
                ]
                right_target = parsed_assets[profile_id][timestamp][right][
                    "target_weight"
                ]
                if not math.isclose(
                    left_target,
                    -right_target,
                    rel_tol=1e-9,
                    abs_tol=1e-11,
                ):
                    _fail(
                        artifact_path,
                        "portfolio.translation-robustness-pair",
                        "Relative-value translation targets must remain exact opposites",
                    )
    if observed_asset_order != expected_asset_order:
        _fail(
            artifact_path,
            "portfolio.translation-robustness-order",
            "Translation asset rows must follow fixed deterministic order",
        )

    expected_daily_order = [
        (str(profile["id"]), split, timestamp)
        for profile in TRANSLATION_ROBUSTNESS_PROFILES
        for split in ("validation", "test")
        for timestamp in dates
        if splits[split]["start"] <= timestamp <= splits[split]["signalEnd"]
    ]
    if len(daily_rows) != len(expected_daily_order):
        _fail(
            artifact_path,
            "portfolio.translation-robustness-daily-coverage",
            "Translation daily rows do not cover every fixed profile/split/date",
        )
    daily_fields = {
        "profileId",
        "split",
        "timestamp",
        "netReturn",
        "benchmarkReturn",
        "oneWayTurnover",
        "cost",
        "rebalanced",
    }
    parsed_daily: dict[tuple[str, str], list[dict[str, Any]]] = {
        (str(profile["id"]), split): []
        for profile in TRANSLATION_ROBUSTNESS_PROFILES
        for split in ("validation", "test")
    }
    observed_daily_order: list[tuple[str, str, str]] = []
    base_daily = {row["timestamp"]: row for row in daily.rows}
    for index, row in enumerate(daily_rows):
        path = f"{artifact_path}/dailyRows/{index}"
        if not isinstance(row, dict) or set(row) != daily_fields:
            _fail(
                path,
                "portfolio.translation-robustness-daily-row",
                "Translation daily row has an unexpected shape",
            )
        identity = (row["profileId"], row["split"], row["timestamp"])
        observed_daily_order.append(identity)
        numeric = {
            key: _finite(row[key], f"{path}/{key}")
            for key in (
                "netReturn",
                "benchmarkReturn",
                "oneWayTurnover",
                "cost",
            )
        }
        if (
            numeric["oneWayTurnover"] < 0
            or numeric["cost"] < 0
            or type(row["rebalanced"]) is not bool
        ):
            _fail(
                path,
                "portfolio.translation-robustness-accounting",
                "Translation daily accounting values are invalid",
            )
        if identity[0] == "base":
            expected_base = base_daily.get(identity[2])
            if expected_base is None or any(
                not math.isclose(
                    numeric[key],
                    float(expected_base[expected_key]),
                    rel_tol=1e-9,
                    abs_tol=1e-11,
                )
                for key, expected_key in (
                    ("netReturn", "net_return"),
                    ("benchmarkReturn", "benchmark_return"),
                    ("oneWayTurnover", "one_way_turnover"),
                    ("cost", "cost"),
                )
            ) or row["rebalanced"] != bool(expected_base["rebalanced"]):
                _fail(
                    path,
                    "portfolio.translation-robustness-base-accounting",
                    "Base translation profile does not reconcile ordinary Portfolio accounting",
                )
        parsed_daily[(identity[0], identity[1])].append(
            {"timestamp": identity[2], **numeric, "rebalanced": row["rebalanced"]}
        )
    if observed_daily_order != expected_daily_order:
        _fail(
            artifact_path,
            "portfolio.translation-robustness-daily-order",
            "Translation daily rows must follow fixed deterministic order",
        )

    split_output: dict[str, Any] = {}
    for split in ("validation", "test"):
        base_rows = parsed_assets["base"]
        profiles: dict[str, Any] = {}
        split_dates = [
            timestamp
            for timestamp in dates
            if splits[split]["start"] <= timestamp <= splits[split]["signalEnd"]
        ]
        for profile in TRANSLATION_ROBUSTNESS_PROFILES:
            profile_id = str(profile["id"])
            state_equal: list[bool] = []
            direction_equal: list[bool] = []
            target_deltas: list[float] = []
            score_available = 0
            total = 0
            for timestamp in split_dates:
                for asset in prediction_assets:
                    current = parsed_assets[profile_id][timestamp][asset]
                    base = base_rows[timestamp][asset]
                    total += 1
                    score_available += int(current["score"] is not None)
                    target_deltas.append(
                        abs(current["target_weight"] - base["target_weight"])
                    )
                    if current["signal_state"] != 0 or base["signal_state"] != 0:
                        state_equal.append(
                            current["signal_state"] == base["signal_state"]
                        )
                        current_sign = (
                            1 if current["target_weight"] > 0 else -1
                            if current["target_weight"] < 0 else 0
                        )
                        base_sign = (
                            1 if base["target_weight"] > 0 else -1
                            if base["target_weight"] < 0 else 0
                        )
                        direction_equal.append(current_sign == base_sign)
            frame = pd.DataFrame(parsed_daily[(profile_id, split)]).set_index(
                "timestamp"
            )
            profiles[profile_id] = {
                "window_observations": int(profile["window"]),
                "minimum_observations": int(profile["minimum"]),
                "is_base": bool(profile["is_base"]),
                "score_availability_rate": score_available / total,
                "active_union_observations": len(state_equal),
                "active_state_agreement_with_base_rate": (
                    sum(state_equal) / len(state_equal) if state_equal else None
                ),
                "active_target_direction_agreement_with_base_rate": (
                    sum(direction_equal) / len(direction_equal)
                    if direction_equal
                    else None
                ),
                "mean_absolute_target_delta_vs_base": sum(target_deltas) / total,
                "performance": performance_metrics(
                    frame["netReturn"], frame["benchmarkReturn"]
                ),
                "implementation": {
                    "annualized_one_way_turnover": float(
                        frame["oneWayTurnover"].mean()
                        * annualization_periods(frame.index)
                    ),
                    "total_cost_drag": float(frame["cost"].sum()),
                    "rebalance_rate": float(frame["rebalanced"].mean()),
                },
            }
        split_output[split] = {"profiles": profiles}

    validation_profiles = split_output["validation"]["profiles"]
    non_base = [
        validation_profiles[str(profile["id"])]
        for profile in TRANSLATION_ROBUSTNESS_PROFILES
        if not profile["is_base"]
    ]
    agreements = [
        float(profile["active_state_agreement_with_base_rate"])
        for profile in non_base
        if profile["active_state_agreement_with_base_rate"] is not None
    ]
    maximum_target_delta = max(
        float(profile["mean_absolute_target_delta_vs_base"])
        for profile in non_base
    )
    if not agreements:
        status = "insufficient-active-targets"
        explanation = (
            "No validation target was active under the base or adjacent causal "
            "translation windows, so active-path stability is unavailable."
        )
    elif (
        min(agreements) >= TRANSLATION_ACTIVE_AGREEMENT_FLOOR
        and maximum_target_delta <= TRANSLATION_TARGET_MAE_CEILING
    ):
        status = "stable-target-path"
        explanation = (
            "Validation signal states and target weights remain locally stable "
            "across the predeclared causal history windows."
        )
    else:
        status = "translation-sensitive-target-path"
        explanation = (
            "Validation signal states or target weights change materially across "
            "the predeclared causal history windows; do not treat one 60-bar "
            "target path as structurally robust."
        )
    sharpes = [
        float(profile["performance"]["sharpe"])
        for profile in validation_profiles.values()
    ]
    base_sharpe = float(validation_profiles["base"]["performance"]["sharpe"])
    base_sign = 1 if base_sharpe > 0 else -1 if base_sharpe < 0 else 0
    diagnosis = {
        "selection_split": "validation",
        "test_enters_diagnosis": False,
        "status": status,
        "minimum_active_state_agreement_rate": min(agreements) if agreements else None,
        "maximum_mean_absolute_target_delta": maximum_target_delta,
        "net_sharpe_range": [min(sharpes), max(sharpes)],
        "net_sharpe_sign_agreement_with_base": all(
            (1 if value > 0 else -1 if value < 0 else 0) == base_sign
            for value in sharpes
        ),
        "explanation": explanation,
    }
    latest = dates[-1]
    current = {
        "timestamp": latest,
        "profiles": {
            str(profile["id"]): [
                {
                    "asset": asset,
                    "score": parsed_assets[str(profile["id"])][latest][asset]["score"],
                    "signal_state": parsed_assets[str(profile["id"])][latest][asset]["signal_state"],
                    "target_weight": parsed_assets[str(profile["id"])][latest][asset]["target_weight"],
                }
                for asset in prediction_assets
            ]
            for profile in TRANSLATION_ROBUSTNESS_PROFILES
        },
    }
    expected_metric = {
        "applicable": True,
        "reason": None,
        "policy": policy,
        "diagnosis": diagnosis,
        "validation": split_output["validation"],
        "test": split_output["test"],
        "current": current,
    }
    _compare_parameter_value(
        metric,
        expected_metric,
        "RunResult/metrics/translation_robustness",
    )

    def project_split(split: str) -> dict[str, Any]:
        return {
            "profiles": [
                {
                    "id": str(profile["id"]),
                    "label": str(profile["label"]),
                    "windowObservations": int(profile["window"]),
                    "minimumObservations": int(profile["minimum"]),
                    "isBase": bool(profile["is_base"]),
                    "scoreAvailabilityRate": split_output[split]["profiles"][
                        str(profile["id"])
                    ]["score_availability_rate"],
                    "activeUnionObservations": split_output[split]["profiles"][
                        str(profile["id"])
                    ]["active_union_observations"],
                    "activeStateAgreementWithBaseRate": split_output[split]["profiles"][
                        str(profile["id"])
                    ]["active_state_agreement_with_base_rate"],
                    "activeTargetDirectionAgreementWithBaseRate": split_output[split]["profiles"][
                        str(profile["id"])
                    ]["active_target_direction_agreement_with_base_rate"],
                    "meanAbsoluteTargetDeltaVsBase": split_output[split]["profiles"][
                        str(profile["id"])
                    ]["mean_absolute_target_delta_vs_base"],
                    "netSharpe": split_output[split]["profiles"][str(profile["id"])][
                        "performance"
                    ]["sharpe"],
                    "totalReturn": split_output[split]["profiles"][str(profile["id"])][
                        "performance"
                    ]["total_return"],
                    "annualizedOneWayTurnover": split_output[split]["profiles"][
                        str(profile["id"])
                    ]["implementation"]["annualized_one_way_turnover"],
                    "totalCostDrag": split_output[split]["profiles"][str(profile["id"])][
                        "implementation"
                    ]["total_cost_drag"],
                }
                for profile in TRANSLATION_ROBUSTNESS_PROFILES
            ]
        }

    return {
        "applicable": True,
        "reason": None,
        "policy": {
            "method": policy["method"],
            "evaluationMode": mode,
            "role": policy["role"],
            "selectionAuthority": policy["selection_authority"],
            "testEntersDiagnosis": False,
            "tradingAuthority": "none",
            "profiles": policy["profiles"],
            "stabilityThresholds": policy["stability_thresholds"],
        },
        "diagnosis": {
            "selectionSplit": "validation",
            "testEntersDiagnosis": False,
            "status": diagnosis["status"],
            "minimumActiveStateAgreementRate": diagnosis[
                "minimum_active_state_agreement_rate"
            ],
            "maximumMeanAbsoluteTargetDelta": diagnosis[
                "maximum_mean_absolute_target_delta"
            ],
            "netSharpeRange": diagnosis["net_sharpe_range"],
            "netSharpeSignAgreementWithBase": diagnosis[
                "net_sharpe_sign_agreement_with_base"
            ],
            "explanation": diagnosis["explanation"],
        },
        "validation": project_split("validation"),
        "test": project_split("test"),
        "current": {
            "timestamp": current["timestamp"],
            "profiles": {
                profile_id: [
                    {
                        "asset": item["asset"],
                        "score": item["score"],
                        "signalState": item["signal_state"],
                        "targetWeight": item["target_weight"],
                    }
                    for item in items
                ]
                for profile_id, items in current["profiles"].items()
            },
        },
    }


def _reconcile_performance_metrics(
    observed: dict[str, Any],
    expected: dict[str, Any],
    path: str,
) -> None:
    reconciliation_fields = {
        "observations",
        "total_return",
        "annual_return",
        "annual_volatility",
        "sharpe",
        "sortino",
        "maximum_drawdown",
        "calmar",
        "expected_shortfall_95",
        "positive_rate",
        "benchmark_beta",
        "active_annual_return",
        "tracking_error",
        "information_ratio",
    }
    if not reconciliation_fields.issubset(observed):
        _fail(
            path,
            "portfolio.viability-performance",
            "Performance metrics omit fields required for ledger reconciliation",
        )
    for key in reconciliation_fields:
        expected_value = expected[key]
        observed_value = _finite(observed.get(key), f"{path}/{key}")
        if not math.isclose(
            observed_value,
            float(expected_value),
            rel_tol=0.0,
            abs_tol=1e-9,
        ):
            _fail(
                f"{path}/{key}",
                "portfolio.viability-performance",
                "Performance metric differs from the reconstructed ledger",
            )


def _project_performance(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "observations": int(value["observations"]),
        "totalReturn": float(value["total_return"]),
        "annualReturn": float(value["annual_return"]),
        "annualVolatility": float(value["annual_volatility"]),
        "sharpe": float(value["sharpe"]),
        "sortino": float(value["sortino"]),
        "maximumDrawdown": float(value["maximum_drawdown"]),
        "expectedShortfall95": float(value["expected_shortfall_95"]),
        "positiveRate": float(value["positive_rate"]),
        "activeAnnualReturn": float(value["active_annual_return"]),
        "informationRatio": float(value["information_ratio"]),
    }


def _break_even_cost(
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    gross_total_return = math.prod(
        1.0 + row["gross_return"] for row in rows
    ) - 1.0
    traded = sum(row["traded_notional"] for row in rows)
    if gross_total_return <= 0.0:
        return {
            "status": "gross-non-positive",
            "bps": None,
            "searchMaximumBps": BREAK_EVEN_COST_SEARCH_MAX_BPS,
        }
    if traded <= 1e-12:
        return {
            "status": "no-turnover",
            "bps": None,
            "searchMaximumBps": BREAK_EVEN_COST_SEARCH_MAX_BPS,
        }

    def compounded(cost_bps: float) -> float | None:
        growth = 1.0
        for row in rows:
            net_return = (
                row["gross_return"]
                - row["traded_notional"] * cost_bps / 10_000.0
            )
            if net_return <= -1.0:
                return None
            growth *= 1.0 + net_return
        return growth - 1.0

    upper_return = compounded(BREAK_EVEN_COST_SEARCH_MAX_BPS)
    if upper_return is not None and upper_return > 0.0:
        return {
            "status": "above-search-bound",
            "bps": None,
            "searchMaximumBps": BREAK_EVEN_COST_SEARCH_MAX_BPS,
        }
    lower = 0.0
    upper = BREAK_EVEN_COST_SEARCH_MAX_BPS
    for _ in range(80):
        middle = (lower + upper) / 2.0
        value = compounded(middle)
        if value is None or value <= 0.0:
            upper = middle
        else:
            lower = middle
    return {
        "status": "available",
        "bps": (lower + upper) / 2.0,
        "searchMaximumBps": BREAK_EVEN_COST_SEARCH_MAX_BPS,
    }


def _temporal_viability(rows: list[dict[str, Any]]) -> dict[str, Any]:
    monthly: dict[str, float] = {}
    for row in rows:
        month = row["timestamp"][:7]
        monthly[month] = (
            (1.0 + monthly.get(month, 0.0))
            * (1.0 + row["net_return"])
            - 1.0
        )
    ordered_months = sorted(monthly.items())
    best_month = max(ordered_months, key=lambda item: (item[1], item[0]))
    worst_month = min(ordered_months, key=lambda item: (item[1], item[0]))

    growth = 1.0
    peak = 1.0
    underwater_start: str | None = None
    current_bars = 0
    maximum_bars = 0
    maximum_start: str | None = None
    maximum_end: str | None = None
    for row in rows:
        growth *= 1.0 + row["net_return"]
        if growth >= peak - 1e-12:
            peak = max(peak, growth)
            underwater_start = None
            current_bars = 0
            continue
        if underwater_start is None:
            underwater_start = row["timestamp"]
        current_bars += 1
        if current_bars > maximum_bars:
            maximum_bars = current_bars
            maximum_start = underwater_start
            maximum_end = row["timestamp"]

    best_day_count = min(5, len(rows))
    best_days = sorted(
        rows,
        key=lambda row: (row["net_return"], row["timestamp"]),
        reverse=True,
    )[:best_day_count]
    best_dates = {row["timestamp"] for row in best_days}
    total_absolute = sum(abs(row["net_return"]) for row in rows)
    best_absolute = sum(abs(row["net_return"]) for row in best_days)
    without_best = math.prod(
        1.0 + row["net_return"]
        for row in rows
        if row["timestamp"] not in best_dates
    ) - 1.0
    return {
        "months": len(ordered_months),
        "positiveNetMonthRate": (
            sum(value > 0.0 for _, value in ordered_months)
            / len(ordered_months)
        ),
        "bestNetMonth": {
            "month": best_month[0],
            "return": best_month[1],
        },
        "worstNetMonth": {
            "month": worst_month[0],
            "return": worst_month[1],
        },
        "maximumUnderwaterBars": maximum_bars,
        "maximumUnderwaterStart": maximum_start,
        "maximumUnderwaterEnd": maximum_end,
        "currentUnderwaterBars": current_bars,
        "bestDayCount": best_day_count,
        "bestDaysAbsoluteReturnShare": (
            best_absolute / total_absolute
            if total_absolute > 1e-12
            else 0.0
        ),
        "netTotalReturnWithoutBestDays": without_best,
    }


def _strategy_viability_projection(
    result: dict[str, Any],
    daily: ParsedDaily,
    splits: dict[str, Any],
) -> dict[str, Any]:
    metrics = result["metrics"]
    portfolio = metrics.get("portfolio")
    implementation = metrics.get("implementation")
    factor = metrics.get("factor")
    robustness = metrics.get("robustness")
    if not all(
        isinstance(value, dict)
        for value in (portfolio, implementation, factor, robustness)
    ):
        _fail(
            "RunResult/metrics",
            "portfolio.viability",
            "Strategy viability requires factor, portfolio, implementation, and robustness metrics",
        )
    cost_stress = robustness.get("cost_stress")
    extra_delay = robustness.get("extra_delay")
    if not isinstance(cost_stress, dict) or not isinstance(extra_delay, dict):
        _fail(
            "RunResult/metrics/robustness",
            "portfolio.viability",
            "Strategy viability requires fixed cost and delay stress evidence",
        )

    active_cost_bps: list[float] = []
    for index, row in enumerate(daily.rows):
        traded = row["traded_notional"]
        cost = row["cost"]
        if traded <= 1e-12:
            if cost > 1e-12:
                _fail(
                    f"portfolio-daily:{index + 2}/cost",
                    "portfolio.viability-cost",
                    "A zero-trade row cannot carry implementation cost",
                )
            continue
        active_cost_bps.append(cost / traded * 10_000.0)
    if not active_cost_bps or any(
        not math.isclose(
            value,
            active_cost_bps[0],
            rel_tol=0.0,
            abs_tol=1e-9,
        )
        for value in active_cost_bps
    ):
        _fail(
            "portfolio-daily/cost",
            "portfolio.viability-cost",
            "Daily implementation cost must use one fixed per-notional bps rate",
        )
    base_cost_bps = active_cost_bps[0]
    mandate = metrics.get("portfolio_mandate")
    implementation_policy = (
        mandate.get("implementationPolicy")
        if isinstance(mandate, dict)
        else None
    )
    declared_base_cost = (
        implementation_policy.get("baseCostBps")
        if isinstance(implementation_policy, dict)
        else None
    )
    if (
        not isinstance(declared_base_cost, (int, float))
        or isinstance(declared_base_cost, bool)
        or not math.isclose(
            base_cost_bps,
            float(declared_base_cost),
            rel_tol=0.0,
            abs_tol=1e-9,
        )
    ):
        _fail(
            "portfolio-daily/cost",
            "portfolio.viability-cost",
            "Daily implementation cost differs from the Portfolio Mandate",
        )

    split_output: dict[str, Any] = {}
    for split_name in ("validation", "test"):
        split = splits[split_name]
        rows = [
            row
            for row in daily.rows
            if split["start"] <= row["timestamp"] <= split["signalEnd"]
        ]
        if not rows:
            _fail(
                f"portfolio-daily/{split_name}",
                "portfolio.viability",
                "Strategy viability split contains no daily rows",
            )
        benchmark_returns = pd.Series(
            [row["benchmark_return"] for row in rows],
            index=pd.to_datetime([row["timestamp"] for row in rows]),
            dtype=float,
        )
        reconstructed = {
            "gross": performance_metrics(
                pd.Series(
                    [row["gross_return"] for row in rows],
                    index=benchmark_returns.index,
                    dtype=float,
                ),
                benchmark_returns,
            ),
            "net": performance_metrics(
                pd.Series(
                    [row["net_return"] for row in rows],
                    index=benchmark_returns.index,
                    dtype=float,
                ),
                benchmark_returns,
            ),
            "benchmark": performance_metrics(
                benchmark_returns,
                benchmark_returns,
            ),
        }
        for layer in ("gross", "net"):
            raw_layer = portfolio.get(split_name, {}).get(layer)
            if not isinstance(raw_layer, dict):
                _fail(
                    f"RunResult/metrics/portfolio/{split_name}/{layer}",
                    "portfolio.viability",
                    "Portfolio performance layer must be an object",
                )
            _reconcile_performance_metrics(
                raw_layer,
                reconstructed[layer],
                f"RunResult/metrics/portfolio/{split_name}/{layer}",
            )

        raw_implementation = implementation.get(split_name)
        if not isinstance(raw_implementation, dict):
            _fail(
                f"RunResult/metrics/implementation/{split_name}",
                "portfolio.viability",
                "Implementation split must be an object",
            )
        expected_implementation = {
            "annualized_one_way_turnover": (
                sum(row["one_way_turnover"] for row in rows)
                / len(rows)
                * annualization_periods(
                    [row["timestamp"] for row in rows]
                )
            ),
            "total_cost_drag": sum(row["cost"] for row in rows),
            "rebalance_rate": (
                sum(row["rebalanced"] for row in rows) / len(rows)
            ),
            "no_trade_rate": (
                sum(not row["rebalanced"] for row in rows) / len(rows)
            ),
        }
        for key, expected_value in expected_implementation.items():
            if not math.isclose(
                _finite(
                    raw_implementation.get(key),
                    f"RunResult/metrics/implementation/{split_name}/{key}",
                ),
                expected_value,
                rel_tol=0.0,
                abs_tol=1e-9,
            ):
                _fail(
                    f"RunResult/metrics/implementation/{split_name}/{key}",
                    "portfolio.viability-implementation",
                    "Implementation metric differs from the reconstructed ledger",
                )

        raw_factor = factor.get(split_name)
        if not isinstance(raw_factor, dict):
            _fail(
                f"RunResult/metrics/factor/{split_name}",
                "portfolio.viability",
                "Factor split must be an object",
            )
        projected_stress: list[dict[str, Any]] = []
        for cost_bps in dict.fromkeys(
            (0.0, base_cost_bps, max(25.0, 2.0 * base_cost_bps))
        ):
            key = f"{cost_bps:g}bps"
            raw_stress = cost_stress.get(key, {}).get(split_name)
            if not isinstance(raw_stress, dict):
                _fail(
                    f"RunResult/metrics/robustness/cost_stress/{key}/{split_name}",
                    "portfolio.viability-cost-stress",
                    "Fixed cost stress layer must be an object",
                )
            reconstructed_stress = performance_metrics(
                pd.Series(
                    [
                        row["gross_return"]
                        - row["traded_notional"] * cost_bps / 10_000.0
                        for row in rows
                    ],
                    index=benchmark_returns.index,
                    dtype=float,
                ),
                benchmark_returns,
            )
            _reconcile_performance_metrics(
                raw_stress,
                reconstructed_stress,
                "RunResult/metrics/robustness/cost_stress/"
                f"{key}/{split_name}",
            )
            projected_stress.append(
                {
                    "costBps": cost_bps,
                    "totalReturn": reconstructed_stress["total_return"],
                    "annualReturn": reconstructed_stress["annual_return"],
                    "netSharpe": reconstructed_stress["sharpe"],
                }
            )

        raw_delay = extra_delay.get(split_name)
        if not isinstance(raw_delay, dict):
            _fail(
                f"RunResult/metrics/robustness/extra_delay/{split_name}",
                "portfolio.viability-delay",
                "Extra-delay stress layer must be an object",
            )
        delay_projection = {
            "totalReturn": _finite(
                raw_delay.get("total_return"),
                f"RunResult/metrics/robustness/extra_delay/{split_name}/total_return",
            ),
            "annualReturn": _finite(
                raw_delay.get("annual_return"),
                f"RunResult/metrics/robustness/extra_delay/{split_name}/annual_return",
            ),
            "netSharpe": _finite(
                raw_delay.get("sharpe"),
                f"RunResult/metrics/robustness/extra_delay/{split_name}/sharpe",
            ),
        }
        total_one_way_turnover = sum(
            row["one_way_turnover"] for row in rows
        )
        gross_arithmetic = sum(row["gross_return"] for row in rows)
        net_arithmetic = sum(row["net_return"] for row in rows)
        split_output[split_name] = {
            "role": splits[split_name]["role"],
            "factorRankIc": _finite(
                raw_factor.get("mean_rank_ic"),
                f"RunResult/metrics/factor/{split_name}/mean_rank_ic",
            ),
            "gross": _project_performance(reconstructed["gross"]),
            "net": _project_performance(reconstructed["net"]),
            "benchmark": _project_performance(
                reconstructed["benchmark"]
            ),
            "friction": {
                "baseCostBps": base_cost_bps,
                "totalCostDrag": expected_implementation[
                    "total_cost_drag"
                ],
                "annualizedOneWayTurnover": expected_implementation[
                    "annualized_one_way_turnover"
                ],
                "grossToNetTotalReturnWedge": (
                    reconstructed["gross"]["total_return"]
                    - reconstructed["net"]["total_return"]
                ),
                "grossToNetAnnualReturnWedge": (
                    reconstructed["gross"]["annual_return"]
                    - reconstructed["net"]["annual_return"]
                ),
                "grossToNetSharpeDelta": (
                    reconstructed["net"]["sharpe"]
                    - reconstructed["gross"]["sharpe"]
                ),
                "grossReturnPerOneWayTurnoverBps": (
                    gross_arithmetic / total_one_way_turnover * 10_000.0
                    if total_one_way_turnover > 1e-12
                    else None
                ),
                "netReturnPerOneWayTurnoverBps": (
                    net_arithmetic / total_one_way_turnover * 10_000.0
                    if total_one_way_turnover > 1e-12
                    else None
                ),
                "breakEvenCost": _break_even_cost(rows),
            },
            "costStress": projected_stress,
            "extraDelay": {
                **delay_projection,
                "netSharpeDelta": (
                    delay_projection["netSharpe"]
                    - reconstructed["net"]["sharpe"]
                ),
            },
            "temporal": _temporal_viability(rows),
        }

    validation = split_output["validation"]
    if validation["factorRankIc"] <= 0.0:
        stage = "factor-edge-absent"
        focus = "factor-signal"
        explanation = (
            "Validation rank IC is non-positive; revisit causal features, "
            "sign, and forecast horizon before portfolio tuning."
        )
    elif validation["gross"]["sharpe"] <= 0.0:
        stage = "factor-not-monetized"
        focus = "signal-to-portfolio"
        explanation = (
            "Validation rank IC is positive but gross portfolio Sharpe is "
            "non-positive; inspect state thresholds, breadth, sizing, and "
            "constraint interaction before cost tuning."
        )
    elif validation["net"]["sharpe"] <= 0.0:
        stage = "cost-fragile"
        focus = "turnover-and-execution"
        explanation = (
            "Gross validation Sharpe is positive but post-cost Sharpe is "
            "non-positive; investigate holding persistence, no-trade bands, "
            "and turnover efficiency."
        )
    else:
        stage = "post-cost-edge-positive"
        focus = "robustness-capacity-and-external-holdout"
        explanation = (
            "Validation post-cost Sharpe is positive; prioritize temporal, "
            "parameter, capacity, and fresh external-holdout robustness."
        )
    return {
        "method": STRATEGY_VIABILITY_METHOD,
        "authority": "research-prioritization-only",
        "tradingAuthority": "none",
        "diagnosis": {
            "selectionSplit": "validation",
            "testEntersDiagnosis": False,
            "stage": stage,
            "iterationFocus": focus,
            "explanation": explanation,
        },
        "validation": validation,
        "test": split_output["test"],
    }


def _signal_monetization_projection(
    ordered_decisions: list[dict[str, Any]],
    daily: ParsedDaily,
    splits: dict[str, Any],
    mandate: dict[str, Any],
    universe: list[str],
    prediction_population: dict[str, Any],
) -> dict[str, Any]:
    """Explain additive signal-to-net-return transmission from fixed evidence."""

    family = mandate["family"]
    evaluation_mode = str(prediction_population["evaluation_mode"])
    relative_value_pair = prediction_population["relative_value_pair"]
    relative_value_intent = (
        family == "dollar-neutral"
        and evaluation_mode == TWO_ASSET_RELATIVE_VALUE_MODE
    )
    if relative_value_intent and not isinstance(relative_value_pair, dict):
        _fail(
            "predictionUniverse/relativeValuePair",
            "portfolio.monetization-prediction-mode",
            "Relative-value monetization requires the verified pair contract",
        )
    intent_construction = (
        "capped-complementary-relative-value-pair"
        if relative_value_intent
        else "mandate-equal-active-side-budget"
    )
    gross_limit = float(mandate["grossLimit"])
    asset_caps = {
        asset: float(mandate["assetMaxAbsWeights"][asset])
        for asset in universe
    }
    daily_by_date = {row["timestamp"]: row for row in daily.rows}
    by_date: dict[str, list[dict[str, Any]]] = {}
    for item in ordered_decisions:
        by_date.setdefault(item["timestamp"], []).append(item)

    def equal_intent_weights(
        rows: list[dict[str, Any]],
    ) -> dict[str, float]:
        weights = {asset: 0.0 for asset in universe}

        def capped_equal_side(
            assets: list[str],
            budget: float,
            sign: float,
        ) -> bool:
            capacity = sum(asset_caps[asset] for asset in assets)
            if not assets or capacity + 1e-12 < budget:
                return False
            remaining = list(assets)
            remaining_budget = budget
            while remaining:
                equal_weight = remaining_budget / len(remaining)
                capped = [
                    asset
                    for asset in remaining
                    if asset_caps[asset] < equal_weight - 1e-12
                ]
                if not capped:
                    for asset in remaining:
                        weights[asset] = sign * equal_weight
                    return True
                for asset in capped:
                    weights[asset] = sign * asset_caps[asset]
                    remaining.remove(asset)
                    remaining_budget -= asset_caps[asset]
            return abs(remaining_budget) <= 1e-9

        longs = [
            item["asset"]
            for item in rows
            if item["tradable"] and item["signal_state"] == 1
        ]
        shorts = [
            item["asset"]
            for item in rows
            if item["tradable"] and item["signal_state"] == -1
        ]
        if relative_value_intent:
            assert isinstance(relative_value_pair, dict)
            left = str(relative_value_pair["left_asset"])
            right = str(relative_value_pair["right_asset"])
            rows_by_asset = {item["asset"]: item for item in rows}
            left_state = int(rows_by_asset[left]["signal_state"])
            right_state = int(rows_by_asset[right]["signal_state"])
            paired = abs(left_state) == 1 and right_state == -left_state
            if paired:
                pair_budget = min(
                    gross_limit / 2.0,
                    asset_caps[left],
                    asset_caps[right],
                )
                weights[left] = left_state * pair_budget
                weights[right] = right_state * pair_budget
        elif family == "dollar-neutral":
            side_budget = gross_limit / 2.0
            if (
                not capped_equal_side(longs, side_budget, 1.0)
                or not capped_equal_side(shorts, side_budget, -1.0)
            ):
                return {asset: 0.0 for asset in universe}
        elif family == "long-cash" and longs:
            budget = min(
                gross_limit,
                sum(asset_caps[asset] for asset in longs),
            )
            capped_equal_side(longs, budget, 1.0)
        elif family == "short-cash" and shorts:
            budget = min(
                gross_limit,
                sum(asset_caps[asset] for asset in shorts),
            )
            capped_equal_side(shorts, budget, -1.0)
        elif family == "asset-role":
            long_budget = min(
                float(mandate["longGrossLimit"]),
                sum(asset_caps[asset] for asset in longs),
            )
            short_budget = min(
                float(mandate["shortGrossLimit"]),
                sum(asset_caps[asset] for asset in shorts),
            )
            if long_budget > 1e-12:
                capped_equal_side(longs, long_budget, 1.0)
            if short_budget > 1e-12:
                capped_equal_side(shorts, short_budget, -1.0)
        return weights

    stage_ids = (
        "equalIntent",
        "preGovernorSizing",
        "governedTarget",
        "executedGross",
        "executedNet",
    )
    stage_labels = {
        "equalIntent": "Normalized equal intent",
        "preGovernorSizing": "Fixed sizing and caps",
        "governedTarget": "Covariance-governed target",
        "executedGross": "Historical executed gross",
        "executedNet": "Historical executed net",
    }
    delta_contract = (
        (
            "sizingAndCaps",
            "equalIntent",
            "preGovernorSizing",
            "Sizing and caps",
        ),
        (
            "riskGovernor",
            "preGovernorSizing",
            "governedTarget",
            "Risk governor",
        ),
        (
            "executionRetention",
            "governedTarget",
            "executedGross",
            "Execution and no-trade retention",
        ),
        (
            "tradingCost",
            "executedGross",
            "executedNet",
            "Trading cost",
        ),
    )
    split_outputs: dict[str, Any] = {}
    for split_name in ("validation", "test"):
        split = splits[split_name]
        selected_dates = [
            timestamp
            for timestamp in daily.dates
            if split["start"] <= timestamp <= split["signalEnd"]
        ]
        if not selected_dates:
            _fail(
                f"signalMonetization/{split_name}",
                "portfolio.monetization-population",
                "Signal monetization split has no realized decision dates",
            )
        totals = {stage_id: 0.0 for stage_id in stage_ids}
        asset_totals = {
            asset: {
                stage_id: 0.0 for stage_id in stage_ids
            }
            for asset in universe
        }
        asset_costs = {asset: 0.0 for asset in universe}
        coverage = {
            "decisionDates": len(selected_dates),
            "assetObservations": 0,
            "scoreAvailableObservations": 0,
            "directionalIntentObservations": 0,
            "flatIntentObservations": 0,
            "contextOnlyObservations": 0,
            "equalIntentActiveDates": 0,
            "rawTargetActiveDates": 0,
            "riskLimitedDates": 0,
            "targetExecutionMismatchDates": 0,
            "noTradeRetentionDates": 0,
            "rebalancedDates": 0,
        }
        errors = {
            "maximumGrossFormulaError": 0.0,
            "maximumNetFormulaError": 0.0,
            "maximumDailyGrossError": 0.0,
            "maximumDailyCostError": 0.0,
            "maximumDailyNetError": 0.0,
            "maximumEqualIntentGrossLimitExcess": 0.0,
            "maximumEqualIntentCapExcess": 0.0,
            "maximumContextIntentExposure": 0.0,
            "maximumRelativeValueIntentTargetError": 0.0,
        }
        for timestamp in selected_dates:
            rows = by_date.get(timestamp, [])
            if len(rows) != len(universe):
                _fail(
                    f"signalMonetization/{split_name}/{timestamp}",
                    "portfolio.monetization-panel",
                    "Signal monetization requires one row per universe asset",
                )
            rows_by_asset = {item["asset"]: item for item in rows}
            intent_weights = equal_intent_weights(rows)
            intent_gross = sum(abs(value) for value in intent_weights.values())
            coverage["equalIntentActiveDates"] += int(intent_gross > 1e-12)
            errors["maximumEqualIntentGrossLimitExcess"] = max(
                errors["maximumEqualIntentGrossLimitExcess"],
                max(0.0, intent_gross - gross_limit),
            )
            errors["maximumEqualIntentCapExcess"] = max(
                errors["maximumEqualIntentCapExcess"],
                max(
                    (
                        max(0.0, abs(value) - asset_caps[asset])
                        for asset, value in intent_weights.items()
                    ),
                    default=0.0,
                ),
            )
            errors["maximumContextIntentExposure"] = max(
                errors["maximumContextIntentExposure"],
                max(
                    (
                        abs(intent_weights[item["asset"]])
                        for item in rows
                        if not item["tradable"]
                    ),
                    default=0.0,
                ),
            )
            raw_gross = sum(
                abs(item["pre_governor_target_weight"])
                for item in rows
            )
            coverage["rawTargetActiveDates"] += int(raw_gross > 1e-12)
            coverage["riskLimitedDates"] += int(
                rows[0]["risk_governor_scale"] < 1.0 - 1e-12
            )
            target_mismatch = any(
                not math.isclose(
                    item["proposed_target_weight"],
                    item["executed_weight"],
                    rel_tol=0.0,
                    abs_tol=1e-12,
                )
                for item in rows
            )
            traded = any(abs(item["trade_weight"]) > 1e-12 for item in rows)
            coverage["targetExecutionMismatchDates"] += int(target_mismatch)
            coverage["noTradeRetentionDates"] += int(
                target_mismatch and not traded
            )
            coverage["rebalancedDates"] += int(traded)
            daily_stage = {stage_id: 0.0 for stage_id in stage_ids}
            daily_cost = 0.0
            for asset in universe:
                item = rows_by_asset[asset]
                coverage["assetObservations"] += 1
                coverage["scoreAvailableObservations"] += int(
                    item["percentile_score"] is not None
                )
                coverage["contextOnlyObservations"] += int(
                    not item["tradable"]
                )
                coverage["directionalIntentObservations"] += int(
                    item["tradable"] and item["signal_state"] != 0
                )
                coverage["flatIntentObservations"] += int(
                    item["tradable"] and item["signal_state"] == 0
                )
                forward_return = item["asset_forward_return"]
                contribution = {
                    "equalIntent": (
                        intent_weights[asset] * forward_return
                    ),
                    "preGovernorSizing": (
                        item["pre_governor_target_weight"]
                        * forward_return
                    ),
                    "governedTarget": (
                        item["proposed_target_weight"] * forward_return
                    ),
                    "executedGross": (
                        item["executed_weight"] * forward_return
                    ),
                    "executedNet": item["net_return_contribution"],
                }
                if relative_value_intent:
                    errors["maximumRelativeValueIntentTargetError"] = max(
                        errors["maximumRelativeValueIntentTargetError"],
                        abs(
                            intent_weights[asset]
                            - item["pre_governor_target_weight"]
                        ),
                    )
                errors["maximumGrossFormulaError"] = max(
                    errors["maximumGrossFormulaError"],
                    abs(
                        contribution["executedGross"]
                        - item["gross_return_contribution"]
                    ),
                )
                errors["maximumNetFormulaError"] = max(
                    errors["maximumNetFormulaError"],
                    abs(
                        item["gross_return_contribution"]
                        - item["cost_contribution"]
                        - item["net_return_contribution"]
                    ),
                )
                daily_cost += item["cost_contribution"]
                asset_costs[asset] += item["cost_contribution"]
                for stage_id, value in contribution.items():
                    totals[stage_id] += value
                    daily_stage[stage_id] += value
                    asset_totals[asset][stage_id] += value
            expected = daily_by_date[timestamp]
            errors["maximumDailyGrossError"] = max(
                errors["maximumDailyGrossError"],
                abs(daily_stage["executedGross"] - expected["gross_return"]),
            )
            errors["maximumDailyCostError"] = max(
                errors["maximumDailyCostError"],
                abs(daily_cost - expected["cost"]),
            )
            errors["maximumDailyNetError"] = max(
                errors["maximumDailyNetError"],
                abs(daily_stage["executedNet"] - expected["net_return"]),
            )

        dates = coverage["decisionDates"]
        periods = annualization_periods(selected_dates)
        annualize = lambda value: value / dates * periods
        stages = [
            {
                "id": stage_id,
                "label": stage_labels[stage_id],
                "totalContribution": totals[stage_id],
                "meanDailyContribution": totals[stage_id] / dates,
                "annualizedContribution": annualize(totals[stage_id]),
            }
            for stage_id in stage_ids
        ]
        deltas = [
            {
                "id": delta_id,
                "label": label,
                "fromStage": from_stage,
                "toStage": to_stage,
                "totalContributionDelta": (
                    totals[to_stage] - totals[from_stage]
                ),
                "annualizedContributionDelta": annualize(
                    totals[to_stage] - totals[from_stage]
                ),
            }
            for delta_id, from_stage, to_stage, label in delta_contract
        ]
        tolerance = 1e-9
        reconciliation = {
            "passed": all(value <= tolerance for value in errors.values()),
            "tolerance": tolerance,
            "relativeValueIntentTargetParityApplicable": (
                relative_value_intent
            ),
            **errors,
        }
        if not reconciliation["passed"]:
            _fail(
                f"signalMonetization/{split_name}/reconciliation",
                "portfolio.monetization-reconciliation",
                "Signal monetization evidence does not reconcile",
            )
        split_outputs[split_name] = {
            "role": split["role"],
            "coverage": coverage,
            "stages": stages,
            "deltas": deltas,
            "byAsset": [
                {
                    "asset": asset,
                    **{
                        stage_id: asset_totals[asset][stage_id]
                        for stage_id in stage_ids
                    },
                    "costContribution": asset_costs[asset],
                }
                for asset in universe
            ],
            "reconciliation": reconciliation,
        }

    validation = split_outputs["validation"]
    validation_totals = {
        item["id"]: item["totalContribution"]
        for item in validation["stages"]
    }
    worst_delta = min(
        validation["deltas"],
        key=lambda item: (
            item["annualizedContributionDelta"],
            item["id"],
        ),
    )
    if validation_totals["equalIntent"] <= 0.0:
        outcome = "signal-intent-negative"
        focus = "signal-direction-and-thresholds"
        explanation = (
            "The normalized validation signal-intent book is non-positive; "
            "inspect factor sign, state thresholds, and directional breadth "
            "before tuning portfolio transformations."
        )
    elif validation_totals["executedNet"] <= 0.0:
        outcome = "transmission-destroyed-edge"
        focus_by_delta = {
            "sizingAndCaps": "sizing-and-caps",
            "riskGovernor": "risk-governor",
            "executionRetention": "execution-and-no-trade",
            "tradingCost": "turnover-and-cost",
        }
        focus = focus_by_delta[worst_delta["id"]]
        explanation = (
            "Normalized validation signal intent is positive but historical "
            "executed net contribution is non-positive; the most adverse "
            f"additive transformation is {worst_delta['label'].lower()}."
        )
    else:
        outcome = "monetized-positive"
        focus = "robustness-and-external-holdout"
        explanation = (
            "The normalized validation signal intent remains positive after "
            "sizing, governance, execution, and cost; prioritize robustness "
            "and fresh external holdout evidence."
        )
    return {
        "method": SIGNAL_MONETIZATION_METHOD,
        "authority": "research-prioritization-only",
        "tradingAuthority": "none",
        "semantics": {
            "contribution": "additive-weight-times-next-bar-return",
            "evaluationMode": evaluation_mode,
            "intentConstruction": intent_construction,
            "equalIntent": (
                "prediction-mode-aware-mandate-constrained-"
                "signal-state-diagnostic"
            ),
            "counterfactualCompounding": False,
            "entersSelection": False,
        },
        "diagnosis": {
            "selectionSplit": "validation",
            "testEntersDiagnosis": False,
            "outcome": outcome,
            "iterationFocus": focus,
            "largestAdverseStage": worst_delta["id"],
            "largestAdverseAnnualizedDelta": worst_delta[
                "annualizedContributionDelta"
            ],
            "explanation": explanation,
        },
        "validation": validation,
        "test": split_outputs["test"],
    }


def _path_projection(
    daily: ParsedDaily,
    weights: dict[str, dict[str, float]],
    splits: dict[str, Any],
    split_names: list[str],
    point_limit: int,
) -> dict[str, Any]:
    net_growth = 1.0
    gross_growth = 1.0
    benchmark_growth = 1.0
    peak = 1.0
    full: list[dict[str, Any]] = []
    maximum_drawdown = 0.0
    maximum_drawdown_index = 0
    maximum_turnover_index = 0
    total_cost = 0.0
    total_turnover = 0.0
    rebalances = 0
    for index, row in enumerate(daily.rows):
        gross_growth *= 1.0 + row["gross_return"]
        net_growth *= 1.0 + row["net_return"]
        benchmark_growth *= 1.0 + row["benchmark_return"]
        peak = max(peak, net_growth)
        drawdown = net_growth / peak - 1.0
        total_cost += row["cost"]
        total_turnover += row["one_way_turnover"]
        rebalances += int(row["rebalanced"])
        if drawdown < maximum_drawdown:
            maximum_drawdown = drawdown
            maximum_drawdown_index = index
        if (
            row["one_way_turnover"]
            > daily.rows[maximum_turnover_index]["one_way_turnover"]
        ):
            maximum_turnover_index = index
        full.append(
            {
                "timestamp": row["timestamp"],
                "split": _split_for(row["timestamp"], splits, split_names),
                "netGrowth": net_growth,
                "grossGrowth": gross_growth,
                "benchmarkGrowth": benchmark_growth,
                "drawdown": drawdown,
                "grossExposure": row["gross_exposure"],
                "netExposure": row["net_exposure"],
                "cashWeight": row["cash_weight"],
                "oneWayTurnover": row["one_way_turnover"],
                "cost": row["cost"],
                "rebalanced": row["rebalanced"],
                "executedRiskForecastAnnualized": row[
                    "executed_risk_forecast_annualized"
                ],
                "executionRiskCeilingAnnualized": row[
                    "execution_risk_ceiling_annualized"
                ],
                "riskRebalanceOverride": row[
                    "risk_rebalance_override"
                ],
                "weights": weights[row["timestamp"]],
            }
        )
    anchors = {
        0,
        len(full) - 1,
        maximum_drawdown_index,
        maximum_turnover_index,
    }
    for split in splits.values():
        for boundary in ("start", "signalEnd", "end"):
            position = bisect_right(daily.dates, split[boundary]) - 1
            if position >= 0:
                anchors.add(position)
            next_position = position + 1
            if next_position < len(daily.dates):
                anchors.add(next_position)
    selected = _sample_indices(len(full), point_limit, anchors)
    return {
        "totalRows": len(full),
        "sampledRows": len(selected),
        "pointLimit": point_limit,
        "sampling": "deterministic-even-with-accounting-anchors",
        "summary": {
            "netTotalReturn": net_growth - 1.0,
            "grossTotalReturn": gross_growth - 1.0,
            "benchmarkTotalReturn": benchmark_growth - 1.0,
            "maximumDrawdown": maximum_drawdown,
            "maximumDrawdownAt": full[maximum_drawdown_index]["timestamp"],
            "maximumOneWayTurnover": daily.rows[maximum_turnover_index][
                "one_way_turnover"
            ],
            "maximumOneWayTurnoverAt": full[maximum_turnover_index]["timestamp"],
            "totalOneWayTurnover": total_turnover,
            "totalCost": total_cost,
            "rebalanceDays": rebalances,
        },
        "points": [full[index] for index in selected],
    }


def _attribution_projection(
    result: dict[str, Any],
    universe: list[str],
) -> dict[str, list[dict[str, Any]]]:
    attribution = result["metrics"].get("attribution")
    if not isinstance(attribution, dict):
        _fail(
            "RunResult/metrics/attribution",
            "portfolio.attribution",
            "Portfolio Run is missing attribution evidence",
        )
    output: dict[str, list[dict[str, Any]]] = {}
    fields = {
        "annualizedNetContribution": "annualized_net_contribution",
        "averageAbsoluteWeight": "average_absolute_executed_weight",
        "meanVarianceContributionShare": "mean_variance_contribution_share",
        "totalCostContribution": "total_cost_contribution",
        "totalOneWayTurnoverContribution": (
            "total_one_way_turnover_contribution"
        ),
    }
    for split_name in ("validation", "test"):
        split = attribution.get(split_name)
        by_asset = split.get("by_asset") if isinstance(split, dict) else None
        if not isinstance(by_asset, dict) or set(by_asset) != set(universe):
            _fail(
                f"RunResult/metrics/attribution/{split_name}/by_asset",
                "portfolio.attribution-universe",
                "Attribution assets must exactly match Study universe",
            )
        projected: list[dict[str, Any]] = []
        for asset in universe:
            values = by_asset[asset]
            if not isinstance(values, dict):
                _fail(
                    f"RunResult/metrics/attribution/{split_name}/by_asset/{asset}",
                    "portfolio.attribution",
                    "Per-asset attribution must be an object",
                )
            projected.append(
                {
                    "asset": asset,
                    **{
                        output_name: _finite(
                            values.get(source_name),
                            "RunResult/metrics/attribution/"
                            f"{split_name}/by_asset/{asset}/{source_name}",
                        )
                        for output_name, source_name in fields.items()
                    },
                }
            )
        output[split_name] = projected
    return output


def _trigger_candidate(
    event: str,
    comparator: str,
    threshold: float,
    score: float | None,
) -> dict[str, Any]:
    if comparator not in {">=", ">", "<=", "<"}:
        raise ValueError("Unknown trigger comparator")
    if score is None:
        distance = None
    elif comparator in {">=", ">"}:
        distance = max(0.0, threshold - score)
    else:
        distance = max(0.0, score - threshold)
    return {
        "event": event,
        "comparator": comparator,
        "threshold": threshold,
        "distance": distance,
    }


def _next_signal_triggers(
    *,
    family: str,
    position_role: str | None = None,
    signal_state: int,
    score: float | None,
    parameters: dict[str, Any],
) -> list[dict[str, Any]]:
    long_entry = parameters["long_entry_percentile"]
    long_exit = parameters["long_exit_percentile"]
    short_exit = parameters["short_exit_percentile"]
    short_entry = parameters["short_entry_percentile"]
    effective_family = (
        {
            "long-only": "long-cash",
            "short-only": "short-cash",
            "two-sided": "dollar-neutral",
        }.get(position_role)
        if family == "asset-role"
        else family
    )
    if effective_family == "long-cash":
        if signal_state not in {0, 1}:
            _fail(
                "mechanicalDecision/signalState",
                "portfolio.mechanical-state",
                "Long/cash evidence cannot carry short signal intent",
            )
        return [
            _trigger_candidate(
                "exit_long" if signal_state == 1 else "enter_long",
                "<" if signal_state == 1 else ">=",
                long_exit if signal_state == 1 else long_entry,
                score,
            )
        ]
    if effective_family == "short-cash":
        if signal_state not in {-1, 0}:
            _fail(
                "mechanicalDecision/signalState",
                "portfolio.mechanical-state",
                "Short/cash evidence cannot carry long signal intent",
            )
        return [
            _trigger_candidate(
                "exit_short" if signal_state == -1 else "enter_short",
                ">" if signal_state == -1 else "<=",
                short_exit if signal_state == -1 else short_entry,
                score,
            )
        ]
    if effective_family != "dollar-neutral":
        _fail(
            "mechanicalDecision/family",
            "portfolio.mechanical-family",
            "Unknown mechanical construction family",
        )
    if signal_state == 1:
        return [
            _trigger_candidate("exit_long", "<", long_exit, score),
            _trigger_candidate(
                "reverse_long_to_short",
                "<=",
                short_entry,
                score,
            ),
        ]
    if signal_state == -1:
        return [
            _trigger_candidate("exit_short", ">", short_exit, score),
            _trigger_candidate(
                "reverse_short_to_long",
                ">=",
                long_entry,
                score,
            ),
        ]
    if signal_state == 0:
        return [
            _trigger_candidate("enter_long", ">=", long_entry, score),
            _trigger_candidate("enter_short", "<=", short_entry, score),
        ]
    _fail(
        "mechanicalDecision/signalState",
        "portfolio.mechanical-state",
        "Signal state must be -1, 0, or 1",
    )


def _mechanical_decision_projection(
    daily: ParsedDaily,
    universe: list[str],
    decisions: dict[tuple[str, str], dict[str, Any]],
    signal_policy: dict[str, Any],
    mandate: dict[str, Any],
) -> dict[str, Any]:
    """Build one research-only current decision chain from verified evidence."""

    parameters = signal_policy["parameters"]
    timestamp = daily.dates[-1]
    daily_row = daily.rows[-1]
    family = mandate["family"]
    positions: list[dict[str, Any]] = []
    pre_governor_gross = 0.0
    governed_target_gross = 0.0
    pretrade_gross = 0.0
    executed_gross = 0.0
    computed_proposed_one_way = 0.0
    state_changes = 0
    unavailable_scores = 0
    context_assets = 0
    position_execution_reasons: set[str] = set()
    inactive_events = {
        "hold_long",
        "hold_short",
        "stay_flat",
        "unavailable_flat",
        "unavailable_reset",
        "context_only",
    }
    for asset in universe:
        item = decisions[(timestamp, asset)]
        score = item["percentile_score"]
        if score is not None and not 0.0 <= score <= 1.0:
            _fail(
                f"mechanicalDecision/positions/{asset}/score",
                "portfolio.mechanical-score",
                "Current percentile score must be within [0, 1]",
            )
        if not item["tradable"]:
            context_assets += 1
            if item["signal_state"] != 0:
                _fail(
                    f"mechanicalDecision/positions/{asset}/signalState",
                    "portfolio.mechanical-context-state",
                    "Context-only assets must remain flat",
                )
            trigger_candidates: list[dict[str, Any]] = []
        else:
            trigger_candidates = _next_signal_triggers(
                family=family,
                position_role=mandate["assetPositionRoles"][asset],
                signal_state=item["signal_state"],
                score=score,
                parameters=parameters,
            )
        available_candidates = [
            candidate
            for candidate in trigger_candidates
            if candidate["distance"] is not None
        ]
        nearest = (
            min(
                available_candidates,
                key=lambda candidate: (
                    candidate["distance"],
                    trigger_candidates.index(candidate),
                ),
            )
            if available_candidates
            else None
        )
        proposed_trade = (
            item["proposed_target_weight"] - item["pretrade_weight"]
        )
        pre_governor_gross += abs(item["pre_governor_target_weight"])
        governed_target_gross += abs(item["proposed_target_weight"])
        pretrade_gross += abs(item["pretrade_weight"])
        executed_gross += abs(item["executed_weight"])
        computed_proposed_one_way += 0.5 * abs(proposed_trade)
        position_execution_reasons.add(item["execution_reason"])
        state_changes += int(item["signal_event"] not in inactive_events)
        unavailable_scores += int(item["tradable"] and score is None)
        positions.append(
            {
                "asset": asset,
                "positionRole": item["position_role"],
                "tradable": item["tradable"],
                "allocationStatus": item["allocation_status"],
                "score": score,
                "scoreAvailable": score is not None,
                "signalState": item["signal_state"],
                "signalEvent": item["signal_event"],
                "nextTriggers": trigger_candidates,
                "nearestTrigger": nearest,
                "preGovernorTargetWeight": item[
                    "pre_governor_target_weight"
                ],
                "targetWeight": item["proposed_target_weight"],
                "pretradeWeight": item["pretrade_weight"],
                "proposedTradeWeight": proposed_trade,
                "executedWeight": item["executed_weight"],
                "tradeWeight": item["trade_weight"],
                "executionAction": item["execution_action"],
                "executionReason": item["execution_reason"],
            }
        )
    execution_available = (
        daily_row["execution_risk_status"] != "legacy_unavailable"
    )
    if len(position_execution_reasons) != 1:
        _fail(
            "mechanicalDecision/executionGate/reason",
            "portfolio.mechanical-execution-reason",
            "Current asset execution reasons must agree",
        )
    position_execution_reason = next(iter(position_execution_reasons))
    if (
        execution_available
        and position_execution_reason != daily_row["execution_reason"]
    ):
        _fail(
            "mechanicalDecision/executionGate/reason",
            "portfolio.mechanical-execution-reason",
            "Current asset and portfolio execution reasons differ",
        )
    recorded_proposed_one_way = daily_row["proposed_one_way_turnover"]
    if execution_available and not math.isclose(
        computed_proposed_one_way,
        recorded_proposed_one_way,
        rel_tol=0.0,
        abs_tol=1e-9,
    ):
        _fail(
            "mechanicalDecision/executionGate/proposedOneWayTurnover",
            "portfolio.mechanical-turnover",
            "Current target-to-pretrade turnover does not reconcile",
        )
    no_trade_one_way = parameters["no_trade_one_way"]
    proposed_one_way = (
        recorded_proposed_one_way
        if execution_available
        else computed_proposed_one_way
    )
    return {
        "method": MECHANICAL_DECISION_METHOD,
        "timestamp": timestamp,
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
        "distanceSemantics": PERCENTILE_DISTANCE_SEMANTICS,
        "signalGate": {
            "family": family,
            "stateChanges": state_changes,
            "unavailableScores": unavailable_scores,
            "contextAssets": context_assets,
            "longEntryPercentile": parameters[
                "long_entry_percentile"
            ],
            "longExitPercentile": parameters[
                "long_exit_percentile"
            ],
            "shortExitPercentile": parameters[
                "short_exit_percentile"
            ],
            "shortEntryPercentile": parameters[
                "short_entry_percentile"
            ],
        },
        "targetGate": {
            "preGovernorGross": pre_governor_gross,
            "governedTargetGross": governed_target_gross,
            "pretradeGross": pretrade_gross,
            "riskGovernorStatus": decisions[
                (timestamp, universe[0])
            ]["risk_governor_status"],
            "riskGovernorScale": decisions[
                (timestamp, universe[0])
            ]["risk_governor_scale"],
            "riskLimited": decisions[
                (timestamp, universe[0])
            ]["risk_governor_scale"]
            < 1.0 - 1e-12,
        },
        "executionGate": {
            "available": execution_available,
            "decisionEligible": daily_row["decision_eligible"],
            "decisionSchedule": daily_row["decision_schedule"],
            "decisionSession": daily_row["decision_session"],
            "decisionSource": mandate["implementationPolicy"][
                "decisionPolicy"
            ]["source"],
            "noTradeOneWay": no_trade_one_way,
            "proposedOneWayTurnover": proposed_one_way,
            "bandShortfall": max(0.0, no_trade_one_way - proposed_one_way),
            "bandExcess": max(0.0, proposed_one_way - no_trade_one_way),
            "ordinaryRebalance": (
                daily_row["ordinary_rebalance"]
                if execution_available
                else None
            ),
            "riskOverride": (
                daily_row["risk_rebalance_override"]
                if execution_available
                else None
            ),
            "rebalanced": daily_row["rebalanced"],
            "finalOneWayTurnover": daily_row["one_way_turnover"],
            "executedGross": executed_gross,
            "reason": (
                daily_row["execution_reason"]
                if execution_available
                else position_execution_reason
            ),
            "status": daily_row["execution_risk_status"],
        },
        "positions": positions,
    }


def _sizing_anatomy_projection(
    daily: ParsedDaily,
    universe: list[str],
    decisions: dict[tuple[str, str], dict[str, Any]],
    mandate: dict[str, Any],
    mechanical_decision: dict[str, Any],
) -> dict[str, Any]:
    """Explain the fixed current weight allocator from immutable ledger rows."""

    timestamp = daily.dates[-1]
    family = mandate["family"]
    gross_limit = float(mandate["grossLimit"])
    cap = float(mandate["maxAbsWeight"])
    asset_caps = {
        asset: float(mandate["assetMaxAbsWeights"][asset])
        for asset in universe
    }
    risk_scale = mechanical_decision["targetGate"]["riskGovernorScale"]
    side_budgets = {
        "long": (
            float(mandate["longGrossLimit"])
            if family == "asset-role"
            else
            gross_limit / 2.0
            if family == "dollar-neutral"
            else gross_limit
            if family == "long-cash"
            else 0.0
        ),
        "short": (
            float(mandate["shortGrossLimit"])
            if family == "asset-role"
            else
            gross_limit / 2.0
            if family == "dollar-neutral"
            else gross_limit
            if family == "short-cash"
            else 0.0
        ),
    }
    raw_by_asset = {
        asset: decisions[(timestamp, asset)][
            "pre_governor_target_weight"
        ]
        for asset in universe
    }
    side_rows: dict[str, dict[str, Any]] = {}
    side_strengths: dict[str, float] = {}
    proportional_budgets: dict[str, float] = {}
    for side, state in (("long", 1), ("short", -1)):
        active = [
            asset
            for asset in universe
            if (
                decisions[(timestamp, asset)]["tradable"]
                and decisions[(timestamp, asset)]["signal_state"] == state
                and decisions[(timestamp, asset)]["risk_strength"] > 0.0
            )
        ]
        strength_total = sum(
            decisions[(timestamp, asset)]["risk_strength"]
            for asset in active
        )
        configured_budget = side_budgets[side]
        cap_capacity = sum(asset_caps[asset] for asset in active)
        proportional_budget = (
            min(configured_budget, cap_capacity)
            if family != "dollar-neutral"
            else configured_budget
        )
        funded_raw_budget = sum(
            abs(raw_by_asset[asset])
            for asset in universe
            if (
                raw_by_asset[asset] > 0.0
                if side == "long"
                else raw_by_asset[asset] < 0.0
            )
        )
        at_cap_assets = [
            asset
            for asset in active
            if abs(raw_by_asset[asset]) >= asset_caps[asset] - 1e-9
        ]
        side_strengths[side] = strength_total
        proportional_budgets[side] = proportional_budget
        side_rows[side] = {
            "side": side,
            "permitted": configured_budget > 0.0,
            "configuredBudget": configured_budget,
            "proportionalBudget": proportional_budget,
            "fundedRawBudget": funded_raw_budget,
            "unfundedBudget": max(
                0.0,
                configured_budget - funded_raw_budget,
            ),
            "activeAssets": len(active),
            "activeAssetIds": active,
            "strengthTotal": strength_total,
            "capCapacity": cap_capacity,
            "atCapAssets": at_cap_assets,
            "allocationFeasible": (
                math.isclose(
                    funded_raw_budget,
                    configured_budget,
                    rel_tol=0.0,
                    abs_tol=1e-9,
                )
                if family == "dollar-neutral"
                else math.isclose(
                    funded_raw_budget,
                    proportional_budget,
                    rel_tol=0.0,
                    abs_tol=1e-9,
                )
            ),
        }

    positions: list[dict[str, Any]] = []
    component_risk_available = any(
        decisions[(timestamp, asset)]["portfolio_variance"] > 1e-18
        for asset in universe
    )
    component_shares: dict[str, float] = {}
    for asset in universe:
        item = decisions[(timestamp, asset)]
        state = item["signal_state"]
        side = (
            "context"
            if not item["tradable"]
            else "long"
            if state == 1
            else "short"
            if state == -1
            else "flat"
        )
        score = item["percentile_score"]
        conviction = item["conviction"]
        trailing_volatility = item["trailing_volatility"]
        strength = item["risk_strength"]
        if state == 0 or not item["tradable"]:
            expected_conviction = 0.0
        elif score is None:
            expected_conviction = 0.0
        else:
            expected_conviction = 2.0 * abs(score - 0.5)
        if not math.isclose(
            conviction,
            expected_conviction,
            rel_tol=0.0,
            abs_tol=1e-9,
        ):
            _fail(
                f"sizingAnatomy/positions/{asset}/conviction",
                "portfolio.sizing-conviction",
                "Sizing conviction differs from the fixed percentile rule",
            )
        expected_strength = (
            conviction / trailing_volatility
            if (
                conviction > 0.0
                and trailing_volatility is not None
                and trailing_volatility > 0.0
            )
            else 0.0
        )
        if not math.isclose(
            strength,
            expected_strength,
            rel_tol=1e-9,
            abs_tol=1e-9,
        ):
            _fail(
                f"sizingAnatomy/positions/{asset}/riskStrength",
                "portfolio.sizing-strength",
                "Risk strength differs from conviction / trailing volatility",
            )
        active_side = side if side in {"long", "short"} else None
        strength_total = (
            side_strengths[active_side]
            if active_side is not None
            else 0.0
        )
        strength_share = (
            strength / strength_total
            if strength_total > 1e-18
            else 0.0
        )
        sign = 1.0 if active_side == "long" else -1.0
        proportional_weight = (
            sign
            * proportional_budgets[active_side]
            * strength_share
            if active_side is not None
            else 0.0
        )
        raw_weight = raw_by_asset[asset]
        asset_cap = asset_caps[asset]
        governed_weight = item["proposed_target_weight"]
        if not math.isclose(
            governed_weight,
            raw_weight * risk_scale,
            rel_tol=0.0,
            abs_tol=1e-9,
        ):
            _fail(
                f"sizingAnatomy/positions/{asset}/governedWeight",
                "portfolio.sizing-governor",
                "Governed target does not equal raw weight times risk scale",
            )
        component_share = (
            item["variance_contribution_share"]
            if component_risk_available
            else 0.0
        )
        component_shares[asset] = component_share
        positions.append(
            {
                "asset": asset,
                "tradable": item["tradable"],
                "side": side,
                "signalState": state,
                "score": score,
                "conviction": conviction,
                "trailingVolatility": trailing_volatility,
                "riskStrength": strength,
                "sameSideStrengthShare": strength_share,
                "proportionalWeightBeforeCap": proportional_weight,
                "maxAbsWeight": asset_cap,
                "proportionalWeightExceedsCap": (
                    abs(proportional_weight) > asset_cap + 1e-9
                ),
                "rawWeight": raw_weight,
                "atCap": (
                    abs(raw_weight) > 1e-12
                    and abs(raw_weight) >= asset_cap - 1e-9
                ),
                "allocationDeltaFromProportional": (
                    raw_weight - proportional_weight
                ),
                "riskGovernorScale": risk_scale,
                "governedWeight": governed_weight,
                "executedWeight": item["executed_weight"],
                "diagonalRiskBudgetShare": item[
                    "diagonal_risk_budget_share"
                ],
                "componentRiskAvailable": component_risk_available,
                "componentRiskShare": component_share,
            }
        )

    raw_gross = sum(abs(item["rawWeight"]) for item in positions)
    governed_gross = sum(
        abs(item["governedWeight"]) for item in positions
    )
    executed_gross = sum(
        abs(item["executedWeight"]) for item in positions
    )
    if not math.isclose(
        raw_gross,
        mechanical_decision["targetGate"]["preGovernorGross"],
        rel_tol=0.0,
        abs_tol=1e-9,
    ) or not math.isclose(
        governed_gross,
        mechanical_decision["targetGate"]["governedTargetGross"],
        rel_tol=0.0,
        abs_tol=1e-9,
    ):
        _fail(
            "sizingAnatomy/construction",
            "portfolio.sizing-reconciliation",
            "Sizing anatomy does not reconcile the mechanical target gate",
        )
    component_sum = sum(component_shares.values())
    if component_risk_available and not math.isclose(
        component_sum,
        1.0,
        rel_tol=0.0,
        abs_tol=1e-9,
    ):
        _fail(
            "sizingAnatomy/componentRiskShare",
            "portfolio.sizing-component-risk",
            "Executed component-risk shares do not sum to one",
        )
    absolute_component_total = sum(
        abs(value) for value in component_shares.values()
    )
    normalized_absolute_component = {
        asset: (
            abs(value) / absolute_component_total
            if absolute_component_total > 1e-18
            else 0.0
        )
        for asset, value in component_shares.items()
    }
    largest_component_asset = (
        max(
            universe,
            key=lambda asset: (
                normalized_absolute_component[asset],
                -universe.index(asset),
            ),
        )
        if component_risk_available
        else None
    )
    return {
        "method": SIZING_ANATOMY_METHOD,
        "timestamp": timestamp,
        "historicalResearchWeights": True,
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
        "construction": {
            "family": family,
            "rule": "percentile-conviction-divided-by-trailing-volatility",
            "grossLimit": gross_limit,
            "maxAbsWeight": cap,
            "assetMaxAbsWeights": asset_caps,
            "assetPositionRoles": mandate["assetPositionRoles"],
            "longGrossLimit": float(mandate["longGrossLimit"]),
            "shortGrossLimit": float(mandate["shortGrossLimit"]),
            "riskGovernorScale": risk_scale,
            "rawGross": raw_gross,
            "governedGross": governed_gross,
            "executedGross": executed_gross,
            "unfundedGross": max(0.0, gross_limit - raw_gross),
        },
        "sides": [side_rows["long"], side_rows["short"]],
        "componentRisk": {
            "available": component_risk_available,
            "shareSum": component_sum if component_risk_available else 0.0,
            "absoluteConcentrationHhi": sum(
                value * value
                for value in normalized_absolute_component.values()
            ),
            "largestAbsoluteContributor": largest_component_asset,
        },
        "positions": positions,
    }


def _current_book(
    daily: ParsedDaily,
    universe: list[str],
    decisions: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    timestamp = daily.dates[-1]
    positions = []
    for asset in universe:
        item = decisions[(timestamp, asset)]
        positions.append(
            {
                "asset": asset,
                "signalState": item["signal_state"],
                "signalEvent": item["signal_event"],
                "tradable": item["tradable"],
                "permittedDirection": item["permitted_direction"],
                "allocationStatus": item["allocation_status"],
                "conviction": item["conviction"],
                "riskStrength": item["risk_strength"],
                "preGovernorTargetWeight": item[
                    "pre_governor_target_weight"
                ],
                "targetWeight": item["proposed_target_weight"],
                "pretradeWeight": item["pretrade_weight"],
                "executedWeight": item["executed_weight"],
                "tradeWeight": item["trade_weight"],
                "targetAction": item["target_action"],
                "executionAction": item["execution_action"],
                "executionReason": item["execution_reason"],
                "regime": item["regime"],
                "netReturnContribution": item["net_return_contribution"],
                "varianceContributionShare": item[
                    "variance_contribution_share"
                ],
            }
        )
    daily_row = daily.rows[-1]
    return {
        "timestamp": timestamp,
        "historicalResearchWeights": True,
        "grossExposure": daily_row["gross_exposure"],
        "netExposure": daily_row["net_exposure"],
        "cashWeight": daily_row["cash_weight"],
        "oneWayTurnover": daily_row["one_way_turnover"],
        "cost": daily_row["cost"],
        "rebalanced": daily_row["rebalanced"],
        "executionRiskStatus": daily_row["execution_risk_status"],
        "executionRiskForecastAvailable": daily_row[
            "execution_risk_forecast_available"
        ],
        "pretradeRiskForecastAnnualized": daily_row[
            "pretrade_risk_forecast_annualized"
        ],
        "executedRiskForecastAnnualized": daily_row[
            "executed_risk_forecast_annualized"
        ],
        "executionRiskCeilingAnnualized": daily_row[
            "execution_risk_ceiling_annualized"
        ],
        "riskRebalanceOverride": daily_row[
            "risk_rebalance_override"
        ],
        "executionReason": daily_row["execution_reason"],
        "riskGovernorStatus": decisions[
            (timestamp, universe[0])
        ]["risk_governor_status"],
        "riskGovernorScale": decisions[
            (timestamp, universe[0])
        ]["risk_governor_scale"],
        "riskForecastPreAnnualized": decisions[
            (timestamp, universe[0])
        ]["risk_forecast_pre_annualized"],
        "riskForecastPostAnnualized": decisions[
            (timestamp, universe[0])
        ]["risk_forecast_post_annualized"],
        "riskVolatilityCeilingAnnualized": decisions[
            (timestamp, universe[0])
        ]["risk_volatility_ceiling_annualized"],
        "riskEstimationObservations": int(
            decisions[(timestamp, universe[0])][
                "risk_estimation_observations"
            ]
        ),
        "positions": positions,
    }


def _recent_transitions(
    ordered: list[dict[str, Any]],
    universe: list[str],
) -> list[dict[str, Any]]:
    universe_order = {asset: index for index, asset in enumerate(universe)}
    transitions = [
        item
        for item in ordered
        if item["signal_event"]
        not in {
            "hold_long",
            "hold_short",
            "stay_flat",
            "unavailable_flat",
            "context_only",
        }
        or item["execution_action"]
        in {
            "open_long",
            "open_short",
            "close_long",
            "close_short",
            "reverse_long_to_short",
            "reverse_short_to_long",
        }
    ]
    transitions.sort(
        key=lambda item: (item["timestamp"], universe_order[item["asset"]])
    )
    return [
        {
            "timestamp": item["timestamp"],
            "asset": item["asset"],
            "signalEvent": item["signal_event"],
            "tradable": item["tradable"],
            "permittedDirection": item["permitted_direction"],
            "allocationStatus": item["allocation_status"],
            "riskGovernorStatus": item["risk_governor_status"],
            "riskGovernorScale": item["risk_governor_scale"],
            "preGovernorTargetWeight": item[
                "pre_governor_target_weight"
            ],
            "priorSignalState": item["prior_signal_state"],
            "signalState": item["signal_state"],
            "targetWeight": item["proposed_target_weight"],
            "executedWeight": item["executed_weight"],
            "tradeWeight": item["trade_weight"],
            "executionAction": item["execution_action"],
            "executionReason": item["execution_reason"],
            "regime": item["regime"],
        }
        for item in transitions[-MAX_RECENT_TRANSITIONS:]
    ]


def _signal_policy_projection(
    result: dict[str, Any],
    mandate: dict[str, Any],
    prediction_population: dict[str, Any],
    report: dict[str, Any],
) -> dict[str, Any]:
    policy = result["metrics"].get("signal_policy")
    if not isinstance(policy, dict):
        _fail(
            "RunResult/metrics/signal_policy",
            "portfolio.signal-policy",
            "Portfolio Run is missing mechanical signal-policy evidence",
        )
    translation = policy.get("translation")
    expected_translation = signal_translation_contract(prediction_population)
    if (
        translation != expected_translation
        or report.get("signalTranslation") != expected_translation
    ):
        _fail(
            "RunResult/metrics/signal_policy/translation",
            "portfolio.signal-translation",
            "Signal translation differs from fixed prediction-mode semantics",
        )
    parameters = policy.get("parameters")
    if not isinstance(parameters, dict):
        _fail(
            "RunResult/metrics/signal_policy/parameters",
            "portfolio.signal-policy",
            "Signal-policy parameters must be an object",
        )
    required_parameters = set(EXPECTED_SIGNAL_PARAMETERS) | {
        "decision_schedule"
    }
    if set(parameters) != required_parameters:
        _fail(
            "RunResult/metrics/signal_policy/parameters",
            "portfolio.signal-policy-parameters",
            "Signal-policy parameters differ from the fixed contract",
        )
    normalized_parameters = {
        key: _finite(
            parameters[key],
            f"RunResult/metrics/signal_policy/parameters/{key}",
        )
        for key in EXPECTED_SIGNAL_PARAMETERS
    }
    decision_schedule = parameters["decision_schedule"]
    if (
        not isinstance(decision_schedule, dict)
        or decision_schedule
        != mandate["implementationPolicy"]["decisionPolicy"]
    ):
        _fail(
            "RunResult/metrics/signal_policy/parameters/decision_schedule",
            "portfolio.signal-policy-parameters",
            "Decision schedule differs from the Portfolio Mandate",
        )
    normalized_parameters["decision_schedule"] = decision_schedule
    if (
        not 0.0
        <= normalized_parameters["short_entry_percentile"]
        <= normalized_parameters["short_exit_percentile"]
        < normalized_parameters["long_exit_percentile"]
        <= normalized_parameters["long_entry_percentile"]
        <= 1.0
        or normalized_parameters["volatility_window"] < 2
        or not math.isclose(
            normalized_parameters["volatility_window"],
            round(normalized_parameters["volatility_window"]),
            rel_tol=0.0,
            abs_tol=1e-12,
        )
        or not 0.0 < normalized_parameters["gross_target"] <= 2.0
        or not 0.0
        < normalized_parameters["max_abs_weight"]
        <= normalized_parameters["gross_target"]
        or not 0.0 <= normalized_parameters["no_trade_one_way"] <= 1.0
    ):
        _fail(
            "RunResult/metrics/signal_policy/parameters",
            "portfolio.signal-policy-parameters",
            "Signal-policy parameters are invalid",
        )
    normalized_parameters["volatility_window"] = int(
        normalized_parameters["volatility_window"]
    )
    expected_parameters = {
        **EXPECTED_SIGNAL_PARAMETERS,
        "gross_target": mandate["grossLimit"],
        "max_abs_weight": mandate["maxAbsWeight"],
        "no_trade_one_way": mandate["implementationPolicy"][
            "noTradeOneWay"
        ],
        "decision_schedule": mandate["implementationPolicy"][
            "decisionPolicy"
        ],
    }
    if normalized_parameters != expected_parameters:
        _fail(
            "RunResult/metrics/signal_policy/parameters",
            "portfolio.signal-policy-parameters",
            "Signal-policy parameters differ from the fixed contract",
        )
    output: dict[str, Any] = {
        "translation": {
            "method": translation["method"],
            "evaluationMode": translation["evaluation_mode"],
            "predictionAssets": translation["prediction_assets"],
            "contextAssets": translation["context_assets"],
            "authority": translation["authority"],
            "scoreBasis": translation["score_basis"],
            "windowObservations": translation["window_observations"],
            "minimumObservations": translation["minimum_observations"],
            "relativeValuePair": translation["relative_value_pair"],
            "contextScore": translation["context_score"],
            "selectionAuthority": translation["selection_authority"],
            "tradingAuthority": translation["trading_authority"],
        },
        "parameters": normalized_parameters,
    }
    for split_name in ("validation", "test"):
        split = policy.get(split_name)
        if not isinstance(split, dict):
            _fail(
                f"RunResult/metrics/signal_policy/{split_name}",
                "portfolio.signal-policy",
                "Signal-policy split evidence must be an object",
            )
        output[split_name] = {
            "entries": split.get("entries"),
            "exits": split.get("exits"),
            "reversals": split.get("reversals"),
            "stateChangeRate": split.get("state_change_rate"),
            "annualizedTargetOneWayTurnover": split.get(
                "annualized_target_one_way_turnover"
            ),
            "signalEventCounts": split.get("signal_event_counts"),
            "targetActionCounts": split.get("target_action_counts"),
            "riskGovernorStatusCounts": split.get(
                "risk_governor_status_counts"
            ),
            "riskLimitedDates": split.get("risk_limited_dates"),
            "riskLimitedRate": split.get("risk_limited_rate"),
            "riskUnavailableDates": split.get("risk_unavailable_dates"),
            "averageActiveRiskScale": split.get(
                "average_active_risk_scale"
            ),
            "maximumPreGovernorAnnualizedVolatility": split.get(
                "maximum_pre_governor_annualized_volatility"
            ),
            "maximumPostGovernorAnnualizedVolatility": split.get(
                "maximum_post_governor_annualized_volatility"
            ),
        }
    return output


def _prediction_population_projection(
    run: RunContext,
    report: dict[str, Any],
    universe: list[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    raw_claim = run.result["metrics"].get("factor_claim")
    raw_mandate = run.result["metrics"].get("portfolio_mandate")
    raw_population = run.result["metrics"].get("prediction_universe")
    if (
        not isinstance(raw_claim, dict)
        or report.get("factorClaim") != raw_claim
        or not isinstance(raw_mandate, dict)
    ):
        _fail(
            "RunResult/metrics/factor_claim",
            "portfolio.factor-claim",
            "Portfolio Run and report must bind one identical Factor claim",
        )
    claim = validate_factor_claim(
        raw_claim,
        "RunResult/metrics/factor_claim",
    )
    try:
        expected = validate_prediction_population_metrics(
            raw_population,
            universe,
            claim,
        )
        validate_population_mandate_compatibility(expected, raw_mandate)
    except PredictionModeError as error:
        _fail(
            "RunResult/metrics/prediction_universe",
            error.code,
            str(error),
        )
    if raw_population != expected or report.get("predictionUniverse") != expected:
        _fail(
            "RunResult/metrics/prediction_universe",
            "portfolio.prediction-universe",
            "Portfolio prediction population differs from fixed request authority",
        )
    dependencies = run.result.get("dependencies")
    if (
        not isinstance(dependencies, dict)
        or FACTOR_CLAIM not in dependencies.get("paths", [])
        or FACTOR_CLAIM not in dependencies.get("sourceHashes", {})
        or FACTOR_POPULATION not in dependencies.get("paths", [])
        or FACTOR_POPULATION not in dependencies.get("sourceHashes", {})
    ):
        _fail(
            "RunResult/dependencies",
            "portfolio.factor-claim-dependency",
            "Portfolio Run does not bind its fixed Factor claim",
        )
    return expected, {
        "id": expected["id"],
        "claim": expected["claim"],
        "outcome": expected["outcome"],
        "authority": expected["authority"],
        "evaluationMode": expected["evaluation_mode"],
        "researchAssets": expected["research_assets"],
        "predictionAssets": expected["prediction_assets"],
        "contextAssets": expected["context_assets"],
        "assetPredictionRoles": expected["asset_prediction_roles"],
        "evaluationAuthority": expected["evaluation_authority"],
        "portfolioAuthority": expected["portfolio_authority"],
        "relativeValuePair": expected["relative_value_pair"],
        "tradingAuthority": expected["trading_authority"],
    }


def _verify_signal_translation(
    ordered_decisions: list[dict[str, Any]],
    dates: list[str],
    universe: list[str],
    prediction_population: dict[str, Any],
) -> dict[str, Any]:
    factors = pd.DataFrame(
        math.nan,
        index=dates,
        columns=universe,
        dtype=float,
    )
    for row in ordered_decisions:
        factor = row["factor"]
        factors.loc[row["timestamp"], row["asset"]] = (
            math.nan if factor is None else float(factor)
        )
    try:
        scores, values, observations, semantics = translate_factor_scores(
            factors,
            prediction_population,
        )
    except PortfolioFailure as error:
        _fail(
            "portfolio-decisions.csv",
            error.code,
            str(error),
        )

    def matches(actual: float | None, expected: object) -> bool:
        if expected is None or pd.isna(expected):
            return actual is None
        return actual is not None and math.isclose(
            float(actual),
            float(expected),
            rel_tol=1e-10,
            abs_tol=1e-12,
        )

    for row in ordered_decisions:
        timestamp = row["timestamp"]
        asset = row["asset"]
        translated_score = scores.loc[timestamp, asset]
        translation_value = values.loc[timestamp, asset]
        expected_decision_score = (
            translated_score
            if row["trailing_volatility"] is not None
            else math.nan
        )
        if (
            not matches(row["translation_score"], translated_score)
            or not matches(row["translation_value"], translation_value)
            or row["translation_observations"]
            != int(observations.loc[timestamp, asset])
            or row["translation_method"] != semantics["method"]
            or row["evaluation_mode"] != semantics["evaluation_mode"]
            or not matches(row["percentile_score"], expected_decision_score)
        ):
            _fail(
                f"portfolio-decisions.csv/{timestamp}/{asset}",
                "portfolio.signal-translation-reconciliation",
                "Decision score does not reconcile from the fixed Factor translation",
            )
    return semantics


def _mandate_projection(
    run: RunContext,
    report: dict[str, Any],
    universe: list[str],
) -> dict[str, Any]:
    raw = run.result["metrics"].get("portfolio_mandate")
    report_raw = report.get("portfolioMandate")
    if raw is None and report_raw is None:
        return {
            "available": False,
            "id": None,
            "sha256": None,
            "sourceKind": "legacy-implicit",
            "requestHash": None,
            "direction": "research-only",
            "family": "dollar-neutral",
            "positionRolesSource": "legacy-implicit",
            "researchUniverse": universe,
            "tradableAssets": universe,
            "contextAssets": [],
            "grossLimit": 1.0,
            "maxAbsWeight": 0.30,
            "assetMaxAbsWeights": {
                asset: 0.30 for asset in universe
            },
            "assetPositionRoles": {
                asset: "two-sided" for asset in universe
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
                    asset: 1.0 / len(universe)
                    for asset in universe
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
    if not isinstance(raw, dict) or not isinstance(report_raw, dict):
        _fail(
            "RunResult/metrics/portfolio_mandate",
            "portfolio.mandate",
            "Portfolio Mandate must exist in both Run metrics and report",
        )
    try:
        mandate = validate_portfolio_mandate(
            raw,
            "RunResult/metrics/portfolio_mandate",
        )
    except AutoQuantValidationError as error:
        raise error
    if report_raw != mandate:
        _fail(
            "portfolio-report.json/portfolioMandate",
            "portfolio.mandate-report",
            "Portfolio report Mandate differs from Run metrics",
        )
    if mandate["researchUniverse"] != universe:
        _fail(
            "RunResult/metrics/portfolio_mandate/researchUniverse",
            "portfolio.mandate-universe",
            "Portfolio Mandate differs from the Run universe",
        )
    dependencies = run.result.get("dependencies")
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
            "portfolio.mandate-dependency",
            "Portfolio Mandate is absent from fixed Run dependencies",
        )
    source = mandate["source"]
    construction = mandate["construction"]
    return {
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
        "implementationPolicy": mandate["implementationPolicy"],
    }


def _research_horizon_projection(
    run: RunContext,
    report: dict[str, Any],
) -> dict[str, Any]:
    raw = run.result["metrics"].get("research_horizon")
    if not isinstance(raw, dict) or report.get("researchHorizon") != raw:
        _fail(
            "RunResult/metrics/research_horizon",
            "portfolio.research-horizon",
            "Portfolio Run and report must contain one identical Horizon Mandate",
        )
    horizon = validate_research_horizon(
        raw,
        "RunResult/metrics/research_horizon",
    )
    dependencies = run.result.get("dependencies")
    if (
        not isinstance(dependencies, dict)
        or RESEARCH_HORIZON not in dependencies.get("paths", [])
        or RESEARCH_HORIZON
        not in dependencies.get("sourceHashes", {})
    ):
        _fail(
            "RunResult/dependencies",
            "portfolio.research-horizon-dependency",
            "Portfolio Run does not bind its fixed Horizon Mandate",
        )
    return horizon


def _risk_governor_projection(
    result: dict[str, Any],
    mandate: dict[str, Any],
) -> dict[str, Any]:
    raw = result["metrics"].get("robustness", {}).get("risk_governor")
    if raw is None and mandate["riskPolicy"] is None:
        return {
            "available": False,
            "policy": None,
            "selectionAuthority": "diagnostic-only",
            "validation": None,
            "test": None,
        }
    if (
        not isinstance(raw, dict)
        or raw.get("policy") != mandate["riskPolicy"]
        or raw.get("selectionAuthority") != "diagnostic-only"
    ):
        _fail(
            "RunResult/metrics/robustness/risk_governor",
            "portfolio.risk-governor",
            "Risk-governor robustness evidence differs from the fixed Mandate",
        )
    projected: dict[str, Any] = {
        "available": True,
        "policy": raw["policy"],
        "selectionAuthority": "diagnostic-only",
    }
    for split_name in ("validation", "test"):
        split = raw.get(split_name)
        governed = split.get("governed") if isinstance(split, dict) else None
        ungoverned = (
            split.get("ungoverned_diagnostic")
            if isinstance(split, dict)
            else None
        )
        if not isinstance(governed, dict) or not isinstance(ungoverned, dict):
            _fail(
                f"RunResult/metrics/robustness/risk_governor/{split_name}",
                "portfolio.risk-governor",
                "Risk-governor split must contain governed and diagnostic evidence",
            )
        projected[split_name] = {
            "governed": {
                key: _finite(
                    governed.get(source),
                    "RunResult/metrics/robustness/risk_governor/"
                    f"{split_name}/governed/{source}",
                )
                for key, source in {
                    "netSharpe": "net_sharpe",
                    "annualVolatility": "annual_volatility",
                    "maximumDrawdown": "maximum_drawdown",
                    "averageGrossExposure": "average_gross_exposure",
                    "riskLimitedDates": "risk_limited_dates",
                    "riskLimitedRate": "risk_limited_rate",
                    "averageActiveRiskScale": "average_active_risk_scale",
                    "maximumPreGovernorAnnualizedVolatility": (
                        "maximum_pre_governor_annualized_volatility"
                    ),
                    "maximumPostGovernorAnnualizedVolatility": (
                        "maximum_post_governor_annualized_volatility"
                    ),
                }.items()
            },
            "ungovernedDiagnostic": {
                key: _finite(
                    ungoverned.get(source),
                    "RunResult/metrics/robustness/risk_governor/"
                    f"{split_name}/ungoverned_diagnostic/{source}",
                )
                for key, source in {
                    "netSharpe": "net_sharpe",
                    "annualVolatility": "annual_volatility",
                    "maximumDrawdown": "maximum_drawdown",
                    "averageGrossExposure": "average_gross_exposure",
                }.items()
            },
            "netSharpeDelta": _finite(
                split.get("net_sharpe_delta"),
                "RunResult/metrics/robustness/risk_governor/"
                f"{split_name}/net_sharpe_delta",
            ),
            "annualVolatilityDelta": _finite(
                split.get("annual_volatility_delta"),
                "RunResult/metrics/robustness/risk_governor/"
                f"{split_name}/annual_volatility_delta",
            ),
        }
    return projected


def _executed_book_risk_projection(
    result: dict[str, Any],
    daily: ParsedDaily,
    splits: dict[str, Any],
    mandate: dict[str, Any],
) -> dict[str, Any]:
    raw = result["metrics"].get("execution_risk")
    has_daily = any(
        row["execution_risk_status"] != "legacy_unavailable"
        for row in daily.rows
    )
    if raw is None and not has_daily:
        return {
            "available": False,
            "policy": None,
            "selectionAuthority": "context-only",
            "validation": None,
            "test": None,
            "latest": None,
        }
    if not isinstance(raw, dict) or not has_daily:
        _fail(
            "RunResult/metrics/execution_risk",
            "portfolio.execution-risk",
            "Execution-risk metrics and daily evidence must exist together",
        )
    policy = raw.get("policy")
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
    if policy != expected_policy:
        _fail(
            "RunResult/metrics/execution_risk/policy",
            "portfolio.execution-risk-policy",
            "Executed-book risk policy differs from the fixed contract",
        )

    def derive(split_name: str) -> dict[str, Any]:
        split = splits[split_name]
        dated = [
            row
            for row in daily.rows
            if split["start"]
            <= row["timestamp"]
            <= split["signalEnd"]
        ]
        active = [
            row
            for row in dated
            if (
                abs(row["gross_exposure"]) > 1e-12
                or abs(row["proposed_one_way_turnover"]) > 1e-12
                or row["risk_rebalance_override"]
                or row["constraint_rebalance_override"]
            )
        ]
        available = [
            row
            for row in active
            if row["execution_risk_forecast_available"]
        ]
        unavailable = [
            row
            for row in active
            if not row["execution_risk_forecast_available"]
        ]
        pretrade_breach = [
            row
            for row in available
            if row["pretrade_risk_forecast_annualized"]
            > row["execution_risk_ceiling_annualized"] + 1e-10
        ]
        executed_breach = [
            row
            for row in available
            if row["executed_risk_forecast_annualized"]
            > row["execution_risk_ceiling_annualized"] + 1e-10
        ]
        overrides = [
            row for row in active if row["risk_rebalance_override"]
        ]
        constraint_overrides = [
            row for row in active if row["constraint_rebalance_override"]
        ]
        errors = [
            max(
                0.0,
                row["executed_risk_forecast_annualized"]
                - row["execution_risk_ceiling_annualized"],
            )
            for row in available
        ]
        status_counts: dict[str, int] = {}
        reason_counts: dict[str, int] = {}
        for row in dated:
            status = row["execution_risk_status"]
            reason = row["execution_reason"]
            status_counts[status] = status_counts.get(status, 0) + 1
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
        return {
            "status": (
                "available"
                if available
                else "no_active_dates"
                if not active
                else "forecast_unavailable"
            ),
            "dates": len(dated),
            "active_dates": len(active),
            "forecast_available_dates": len(available),
            "forecast_unavailable_dates": len(unavailable),
            "forecast_coverage": (
                len(available) / len(active) if active else 0.0
            ),
            "pretrade_breach_dates": len(pretrade_breach),
            "pretrade_breach_rate": (
                len(pretrade_breach) / len(available)
                if available
                else 0.0
            ),
            "risk_rebalance_override_dates": len(overrides),
            "risk_rebalance_override_rate": (
                len(overrides) / len(active) if active else 0.0
            ),
            "executed_breach_dates": len(executed_breach),
            "executed_breach_rate": (
                len(executed_breach) / len(available)
                if available
                else 0.0
            ),
            "mean_executed_forecast_annualized": (
                sum(
                    row["executed_risk_forecast_annualized"]
                    for row in available
                )
                / len(available)
                if available
                else 0.0
            ),
            "maximum_executed_forecast_annualized": (
                max(
                    row["executed_risk_forecast_annualized"]
                    for row in available
                )
                if available
                else 0.0
            ),
            "maximum_ceiling_error": max(errors) if errors else 0.0,
            "status_counts": status_counts,
            "execution_reason_counts": reason_counts,
            "constraint_rebalance_override_dates": len(
                constraint_overrides
            ),
            "constraint_only_override_dates": sum(
                row["constraint_rebalance_override"]
                and not row["risk_rebalance_override"]
                for row in active
            ),
            "joint_constraint_risk_override_dates": sum(
                row["constraint_rebalance_override"]
                and row["risk_rebalance_override"]
                for row in active
            ),
            "constraint_repair_one_way": sum(
                row["constraint_repair_one_way"] for row in dated
            ),
            "executed_constraint_breach_dates": sum(
                row["executed_constraint_maximum_error"] > 1e-10
                for row in dated
            ),
            "maximum_executed_constraint_error": max(
                (
                    row["executed_constraint_maximum_error"]
                    for row in dated
                ),
                default=0.0,
            ),
        }

    def compare(expected: Any, actual: Any, path: str) -> None:
        if isinstance(actual, dict):
            if not isinstance(expected, dict) or set(expected) != set(actual):
                _fail(
                    path,
                    "portfolio.execution-risk-metrics",
                    "Execution-risk metric shape differs from daily evidence",
                )
            for key, value in actual.items():
                compare(expected[key], value, f"{path}/{key}")
        elif isinstance(actual, float):
            if not math.isclose(
                _finite(expected, path),
                actual,
                rel_tol=1e-10,
                abs_tol=1e-10,
            ):
                _fail(
                    path,
                    "portfolio.execution-risk-metrics",
                    "Execution-risk metric differs from daily evidence",
                )
        elif expected != actual:
            _fail(
                path,
                "portfolio.execution-risk-metrics",
                "Execution-risk metric differs from daily evidence",
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
    fields = {
        "status": "status",
        "dates": "dates",
        "activeDates": "active_dates",
        "forecastAvailableDates": "forecast_available_dates",
        "forecastUnavailableDates": "forecast_unavailable_dates",
        "forecastCoverage": "forecast_coverage",
        "pretradeBreachDates": "pretrade_breach_dates",
        "pretradeBreachRate": "pretrade_breach_rate",
        "riskRebalanceOverrideDates": (
            "risk_rebalance_override_dates"
        ),
        "riskRebalanceOverrideRate": (
            "risk_rebalance_override_rate"
        ),
        "executedBreachDates": "executed_breach_dates",
        "executedBreachRate": "executed_breach_rate",
        "meanExecutedForecastAnnualized": (
            "mean_executed_forecast_annualized"
        ),
        "maximumExecutedForecastAnnualized": (
            "maximum_executed_forecast_annualized"
        ),
        "maximumCeilingError": "maximum_ceiling_error",
        "statusCounts": "status_counts",
        "executionReasonCounts": "execution_reason_counts",
    }
    for split_name in ("validation", "test"):
        derived = derive(split_name)
        compare(
            raw.get(split_name),
            {
                source: derived[source]
                for source in fields.values()
            },
            f"RunResult/metrics/execution_risk/{split_name}",
        )
        projection[split_name] = {
            output: derived[source]
            for output, source in fields.items()
        }
        projection[split_name].update(
            {
                "constraintRebalanceOverrideDates": derived[
                    "constraint_rebalance_override_dates"
                ],
                "constraintOnlyOverrideDates": derived[
                    "constraint_only_override_dates"
                ],
                "jointConstraintRiskOverrideDates": derived[
                    "joint_constraint_risk_override_dates"
                ],
                "constraintRepairOneWay": derived[
                    "constraint_repair_one_way"
                ],
                "executedConstraintBreachDates": derived[
                    "executed_constraint_breach_dates"
                ],
                "maximumExecutedConstraintError": derived[
                    "maximum_executed_constraint_error"
                ],
            }
        )
    latest = daily.rows[-1]
    projection["latest"] = {
        "timestamp": latest["timestamp"],
        "status": latest["execution_risk_status"],
        "forecastAvailable": latest[
            "execution_risk_forecast_available"
        ],
        "pretradeForecastAnnualized": latest[
            "pretrade_risk_forecast_annualized"
        ],
        "executedForecastAnnualized": latest[
            "executed_risk_forecast_annualized"
        ],
        "ceilingAnnualized": latest[
            "execution_risk_ceiling_annualized"
        ],
        "riskRebalanceOverride": latest[
            "risk_rebalance_override"
        ],
        "constraintRebalanceOverride": latest[
            "constraint_rebalance_override"
        ],
        "constraintRepairOneWay": latest[
            "constraint_repair_one_way"
        ],
        "executedConstraintMaximumError": latest[
            "executed_constraint_maximum_error"
        ],
        "executionReason": latest["execution_reason"],
    }
    return projection


def _quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def _diversification_stress_projection(
    daily: ParsedDaily,
    universe: list[str],
    decisions: dict[tuple[str, str], dict[str, Any]],
    splits: dict[str, Any],
    mandate: dict[str, Any],
) -> dict[str, Any]:
    """Reconstruct correlation-crowding stress from the immutable ledger."""

    risk_policy = mandate.get("riskPolicy")
    annualization = (
        int(risk_policy["annualizationPeriods"])
        if isinstance(risk_policy, dict)
        else 252
    )
    ceiling = (
        float(risk_policy["annualizedVolatilityCeiling"])
        if isinstance(risk_policy, dict)
        else None
    )
    covariance_window = (
        int(risk_policy["covarianceWindow"])
        if isinstance(risk_policy, dict)
        else 60
    )
    minimum_observations = (
        int(risk_policy["minimumObservations"])
        if isinstance(risk_policy, dict)
        else 20
    )
    root_annualization = math.sqrt(annualization)
    reconstructed_returns = pd.DataFrame(
        index=pd.to_datetime(daily.dates, format="ISO8601"),
        columns=universe,
        dtype=float,
    )
    for index in range(1, len(daily.dates)):
        prior = daily.dates[index - 1]
        timestamp = daily.dates[index]
        reconstructed_returns.loc[pd.Timestamp(timestamp)] = [
            decisions[(prior, asset)]["asset_forward_return"]
            for asset in universe
        ]
    covariance_by_date: dict[str, tuple[int, pd.DataFrame | None]] = {}
    for timestamp in daily.dates:
        history = (
            reconstructed_returns.loc[:pd.Timestamp(timestamp)]
            .tail(covariance_window)
            .dropna(how="any")
        )
        observations = len(history)
        covariance = (
            history.cov(ddof=0).reindex(
                index=universe,
                columns=universe,
            )
            if observations >= minimum_observations
            else None
        )
        if (
            covariance is not None
            and (
                covariance.isna().any().any()
                or not all(
                    math.isfinite(float(value))
                    for value in covariance.to_numpy().flat
                )
            )
        ):
            covariance = None
        covariance_by_date[timestamp] = (observations, covariance)

    def book(timestamp: str, *, include_positions: bool) -> dict[str, Any]:
        rows = [decisions[(timestamp, asset)] for asset in universe]
        active = [
            item
            for item in rows
            if abs(item["executed_weight"]) > 1e-12
        ]
        variances = {item["portfolio_variance"] for item in rows}
        if len(variances) != 1:
            _fail(
                f"diversificationStress/{timestamp}/portfolioVariance",
                "portfolio.diversification-variance-panel",
                "Portfolio variance must be identical across one decision date",
            )
        portfolio_variance = next(iter(variances))
        component_sum = sum(item["component_variance"] for item in rows)
        if not math.isclose(
            component_sum,
            portfolio_variance,
            rel_tol=0.0,
            abs_tol=1e-10,
        ):
            _fail(
                f"diversificationStress/{timestamp}/componentVariance",
                "portfolio.diversification-component-sum",
                "Component variance must reconcile frozen portfolio variance",
            )
        observations, covariance = covariance_by_date[timestamp]
        covariance_own_volatility = {
            asset: (
                math.sqrt(max(float(covariance.loc[asset, asset]), 0.0))
                if covariance is not None
                else None
            )
            for asset in universe
        }
        if covariance is not None:
            weight_vector = pd.Series(
                {
                    item["asset"]: item["executed_weight"]
                    for item in rows
                },
                index=universe,
                dtype=float,
            )
            marginal = covariance.dot(weight_vector)
            expected_components = weight_vector * marginal
            expected_variance = float(expected_components.sum())
            if not math.isclose(
                expected_variance,
                portfolio_variance,
                rel_tol=1e-9,
                abs_tol=1e-10,
            ):
                _fail(
                    f"diversificationStress/{timestamp}/covarianceVariance",
                    "portfolio.diversification-covariance",
                    "Reconstructed causal covariance differs from frozen variance",
                )
            for item in rows:
                if not math.isclose(
                    float(expected_components[item["asset"]]),
                    item["component_variance"],
                    rel_tol=1e-9,
                    abs_tol=1e-10,
                ):
                    _fail(
                        "diversificationStress/"
                        f"{timestamp}/{item['asset']}/componentVariance",
                        "portfolio.diversification-covariance-component",
                        "Reconstructed covariance component differs from ledger",
                    )
        for item in rows:
            expected_share = (
                item["component_variance"] / portfolio_variance
                if portfolio_variance > 1e-18
                else 0.0
            )
            if not math.isclose(
                item["variance_contribution_share"],
                expected_share,
                rel_tol=0.0,
                abs_tol=1e-9,
            ):
                _fail(
                    "diversificationStress/"
                    f"{timestamp}/{item['asset']}/componentRiskShare",
                    "portfolio.diversification-component-share",
                    "Component-risk share differs from component variance",
                )

        if not active:
            state = "flat"
        elif (
            portfolio_variance <= 1e-18
            or covariance is None
            or any(
                covariance_own_volatility[item["asset"]] is None
                or covariance_own_volatility[item["asset"]] <= 0
                for item in active
            )
        ):
            state = "risk-history-unavailable"
        else:
            state = "available"

        sample_forecast = (
            math.sqrt(portfolio_variance) * root_annualization
            if state == "available"
            else 0.0
        )
        standalone_daily = {
            item["asset"]: (
                abs(item["executed_weight"])
                * float(covariance_own_volatility[item["asset"]])
                if covariance_own_volatility[item["asset"]] is not None
                else 0.0
            )
            for item in rows
        }
        stress_daily = (
            sum(standalone_daily[item["asset"]] for item in active)
            if state == "available"
            else 0.0
        )
        stress_forecast = stress_daily * root_annualization
        stress_multiplier = (
            stress_forecast / sample_forecast
            if state == "available" and sample_forecast > 1e-18
            else None
        )
        component_absolute_total = (
            sum(
                abs(item["variance_contribution_share"])
                for item in rows
            )
            if state == "available"
            else 0.0
        )
        absolute_component_shares = {
            item["asset"]: (
                abs(item["variance_contribution_share"])
                / component_absolute_total
                if component_absolute_total > 1e-18
                else 0.0
            )
            for item in rows
        }
        risk_hhi = (
            sum(value * value for value in absolute_component_shares.values())
            if state == "available"
            else None
        )
        effective_risk_bets = (
            1.0 / risk_hhi
            if risk_hhi is not None and risk_hhi > 1e-18
            else None
        )
        largest_component = (
            max(
                universe,
                key=lambda asset: (
                    absolute_component_shares[asset],
                    -universe.index(asset),
                ),
            )
            if state == "available"
            else None
        )
        stress_breach = (
            stress_forecast > ceiling + 1e-10
            if state == "available" and ceiling is not None
            else None
        )
        perfect_variance = stress_daily * stress_daily
        scenario_rows = []
        for scenario in DIVERSIFICATION_STRESS_SCENARIOS:
            blend = float(scenario["blendToPerfectCorrelation"])
            blended_variance = (
                (1.0 - blend) * portfolio_variance
                + blend * perfect_variance
                if state == "available"
                else 0.0
            )
            scenario_forecast = (
                math.sqrt(max(blended_variance, 0.0))
                * root_annualization
            )
            scenario_rows.append(
                {
                    "id": scenario["id"],
                    "blendToPerfectCorrelation": blend,
                    "forecastAnnualized": scenario_forecast,
                    "multiplier": (
                        scenario_forecast / sample_forecast
                        if state == "available"
                        and sample_forecast > 1e-18
                        else None
                    ),
                    "breachesCeiling": (
                        scenario_forecast > ceiling + 1e-10
                        if state == "available" and ceiling is not None
                        else None
                    ),
                }
            )
        projection = {
            "timestamp": timestamp,
            "state": state,
            "activeAssets": len(active),
            "covarianceObservations": observations,
            "sampleForecastAnnualized": sample_forecast,
            "perfectCorrelationForecastAnnualized": stress_forecast,
            "stressMultiplier": stress_multiplier,
            "ceilingAnnualized": ceiling,
            "stressBreachesCeiling": stress_breach,
            "absoluteComponentRiskHhi": risk_hhi,
            "effectiveRiskBets": effective_risk_bets,
            "largestAbsoluteComponentRiskContributor": largest_component,
            "scenarios": scenario_rows,
        }
        if include_positions:
            projection["positions"] = [
                {
                    "asset": item["asset"],
                    "active": item in active,
                    "executedWeight": item["executed_weight"],
                    "causalOwnVolatility": (
                        covariance_own_volatility[item["asset"]]
                    ),
                    "componentVariance": item["component_variance"],
                    "componentRiskShare": item[
                        "variance_contribution_share"
                    ],
                    "absoluteComponentRiskShare": (
                        absolute_component_shares[item["asset"]]
                    ),
                    "standaloneRiskLoadAnnualized": (
                        standalone_daily[item["asset"]]
                        * root_annualization
                    ),
                    "stressRiskShare": (
                        standalone_daily[item["asset"]] / stress_daily
                        if stress_daily > 1e-18
                        else 0.0
                    ),
                }
                for item in rows
            ]
            if state == "available":
                stress_share_sum = sum(
                    item["stressRiskShare"]
                    for item in projection["positions"]
                )
                if not math.isclose(
                    stress_share_sum,
                    1.0,
                    rel_tol=0.0,
                    abs_tol=1e-9,
                ):
                    _fail(
                        f"diversificationStress/{timestamp}/stressRiskShare",
                        "portfolio.diversification-stress-share",
                        "Per-asset stress-risk shares must sum to one",
                    )
        return projection

    dated = {
        timestamp: book(timestamp, include_positions=False)
        for timestamp in daily.dates
    }

    def split_projection(split_name: str) -> dict[str, Any]:
        split = splits[split_name]
        rows = [
            dated[timestamp]
            for timestamp in daily.dates
            if split["start"] <= timestamp <= split["signalEnd"]
        ]
        available = [item for item in rows if item["state"] == "available"]
        flat = [item for item in rows if item["state"] == "flat"]
        unavailable = [
            item
            for item in rows
            if item["state"] == "risk-history-unavailable"
        ]
        multipliers = [
            float(item["stressMultiplier"]) for item in available
        ]
        effective_bets = [
            float(item["effectiveRiskBets"]) for item in available
        ]
        breach_count = (
            sum(item["stressBreachesCeiling"] is True for item in available)
            if ceiling is not None
            else None
        )
        weakest = (
            max(
                available,
                key=lambda item: (
                    float(item["stressMultiplier"]),
                    item["timestamp"],
                ),
            )
            if available
            else None
        )
        scenario_summaries = []
        for scenario in DIVERSIFICATION_STRESS_SCENARIOS:
            scenario_id = scenario["id"]
            scenario_rows = [
                next(
                    item
                    for item in row["scenarios"]
                    if item["id"] == scenario_id
                )
                for row in available
            ]
            scenario_multipliers = [
                float(item["multiplier"]) for item in scenario_rows
            ]
            scenario_breaches = (
                sum(
                    item["breachesCeiling"] is True
                    for item in scenario_rows
                )
                if ceiling is not None
                else None
            )
            scenario_summaries.append(
                {
                    "id": scenario_id,
                    "blendToPerfectCorrelation": scenario[
                        "blendToPerfectCorrelation"
                    ],
                    "stressBreachDates": scenario_breaches,
                    "stressBreachRate": (
                        scenario_breaches / len(scenario_rows)
                        if scenario_breaches is not None
                        and scenario_rows
                        else None
                    ),
                    "medianMultiplier": (
                        _quantile(scenario_multipliers, 0.50)
                        if scenario_multipliers
                        else None
                    ),
                    "p95Multiplier": (
                        _quantile(scenario_multipliers, 0.95)
                        if scenario_multipliers
                        else None
                    ),
                    "maximumMultiplier": (
                        max(scenario_multipliers)
                        if scenario_multipliers
                        else None
                    ),
                }
            )
        return {
            "role": split["role"],
            "totalDates": len(rows),
            "activeDates": len(available) + len(unavailable),
            "availableDates": len(available),
            "flatDates": len(flat),
            "unavailableDates": len(unavailable),
            "stressBreachDates": breach_count,
            "stressBreachRate": (
                breach_count / len(available)
                if breach_count is not None and available
                else None
            ),
            "medianStressMultiplier": (
                _quantile(multipliers, 0.50) if multipliers else None
            ),
            "p95StressMultiplier": (
                _quantile(multipliers, 0.95) if multipliers else None
            ),
            "maximumStressMultiplier": (
                max(multipliers) if multipliers else None
            ),
            "medianEffectiveRiskBets": (
                _quantile(effective_bets, 0.50)
                if effective_bets
                else None
            ),
            "minimumEffectiveRiskBets": (
                min(effective_bets) if effective_bets else None
            ),
            "maximumStressBook": (
                {
                    key: weakest[key]
                    for key in (
                        "timestamp",
                        "activeAssets",
                        "covarianceObservations",
                        "sampleForecastAnnualized",
                        "perfectCorrelationForecastAnnualized",
                        "stressMultiplier",
                        "ceilingAnnualized",
                        "stressBreachesCeiling",
                        "absoluteComponentRiskHhi",
                        "effectiveRiskBets",
                        "largestAbsoluteComponentRiskContributor",
                    )
                }
                if weakest is not None
                else None
            ),
            "scenarios": scenario_summaries,
        }

    return {
        "method": DIVERSIFICATION_STRESS_METHOD,
        "available": any(
            item["state"] == "available" for item in dated.values()
        ),
        "authority": "context-only",
        "selectionAuthority": "none",
        "testEntersSelection": False,
        "tradingAuthority": "none",
        "shock": {
            "method": DIVERSIFICATION_SHOCK_METHOD,
            "pairwiseCorrelationMagnitude": 1.0,
            "positionSignsAlignRisk": True,
            "annualizationPeriods": annualization,
            "covarianceWindow": covariance_window,
            "minimumObservations": minimum_observations,
            "ceilingAnnualized": ceiling,
            "probabilityAssigned": False,
            "scenarios": [
                dict(scenario)
                for scenario in DIVERSIFICATION_STRESS_SCENARIOS
            ],
        },
        "current": book(daily.dates[-1], include_positions=True),
        "validation": split_projection("validation"),
        "test": split_projection("test"),
    }


def _liquidity_capacity_projection(
    result: dict[str, Any],
    ordered_decisions: list[dict[str, Any]],
    splits: dict[str, Any],
    reference_nav: float = LIQUIDITY_REFERENCE_NAV,
) -> dict[str, Any]:
    raw = result["metrics"].get("liquidity_capacity")
    has_ledger = any(
        item["liquidity_capacity_status"] != "legacy_unavailable"
        for item in ordered_decisions
    )
    if raw is None and not has_ledger:
        return {
            "available": False,
            "policy": None,
            "selectionAuthority": "context-only",
            "validation": None,
            "test": None,
            "latestTrade": None,
        }
    if not isinstance(raw, dict) or not has_ledger:
        _fail(
            "RunResult/metrics/liquidity_capacity",
            "portfolio.liquidity-capacity",
            "Capacity metrics and ledger evidence must exist together",
        )
    policy = raw.get("policy")
    expected_policy = {
        "method": "trailing-average-dollar-volume-capacity-v1",
        "adv_window": 20,
        "participation_limits": [0.01, 0.05],
        "reference_nav": reference_nav,
        "selection_authority": "context-only",
        "trading_authority": "none",
    }
    if policy != expected_policy:
        _fail(
            "RunResult/metrics/liquidity_capacity/policy",
            "portfolio.liquidity-policy",
            "Liquidity-capacity policy differs from the fixed contract",
        )

    by_date: dict[str, list[dict[str, Any]]] = {}
    for item in ordered_decisions:
        by_date.setdefault(item["timestamp"], []).append(item)

    def derive(split_name: str) -> dict[str, Any]:
        split = splits[split_name]
        dated = [
            (timestamp, rows)
            for timestamp, rows in sorted(by_date.items())
            if split["start"] <= timestamp <= split["signalEnd"]
        ]
        trade_dates = [
            (timestamp, rows)
            for timestamp, rows in dated
            if rows[0]["liquidity_capacity_status"] != "no_trade"
        ]
        available = [
            (timestamp, rows)
            for timestamp, rows in trade_dates
            if rows[0]["liquidity_capacity_status"] == "available"
        ]
        unavailable = [
            (timestamp, rows)
            for timestamp, rows in trade_dates
            if rows[0]["liquidity_capacity_status"]
            == "insufficient_adv_history"
        ]
        capacities = {
            "capacity_1pct": [
                rows[0]["portfolio_capacity_nav_1pct"]
                for _, rows in available
            ],
            "capacity_5pct": [
                rows[0]["portfolio_capacity_nav_5pct"]
                for _, rows in available
            ],
        }
        binding_counts: dict[str, int] = {}
        for _, rows in available:
            binding = next(
                row["asset"]
                for row in rows
                if row["capacity_binding_asset"]
            )
            binding_counts[binding] = binding_counts.get(binding, 0) + 1

        def summary(key: str) -> dict[str, Any]:
            values = capacities[key]
            return {
                "status": "available" if values else "unavailable",
                "observations": len(values),
                "minimum_nav": min(values) if values else 0.0,
                "tenth_percentile_nav": _quantile(values, 0.10),
                "median_nav": _quantile(values, 0.50),
                "reference_nav_breach_rate": (
                    sum(
                        value + 1e-12 < reference_nav
                        for value in values
                    )
                    / len(values)
                    if values
                    else 0.0
                ),
            }

        return {
            "status": (
                "available"
                if available
                else "no_trades"
                if not trade_dates
                else "insufficient_adv_history"
            ),
            "trade_dates": len(trade_dates),
            "available_trade_dates": len(available),
            "unavailable_trade_dates": len(unavailable),
            "trade_date_coverage": (
                len(available) / len(trade_dates)
                if trade_dates
                else 0.0
            ),
            "binding_asset_counts_1pct": binding_counts,
            "capacity_1pct": summary("capacity_1pct"),
            "capacity_5pct": summary("capacity_5pct"),
        }

    def compare(expected: Any, actual: Any, path: str) -> None:
        if isinstance(actual, dict):
            if not isinstance(expected, dict) or set(expected) != set(actual):
                _fail(
                    path,
                    "portfolio.liquidity-metrics",
                    "Capacity metric shape differs from the ledger",
                )
            for key, value in actual.items():
                compare(expected[key], value, f"{path}/{key}")
        elif isinstance(actual, float):
            if not math.isclose(
                _finite(expected, path),
                actual,
                rel_tol=1e-10,
                abs_tol=1e-6,
            ):
                _fail(
                    path,
                    "portfolio.liquidity-metrics",
                    "Capacity metric differs from the ledger",
                )
        elif expected != actual:
            _fail(
                path,
                "portfolio.liquidity-metrics",
                "Capacity metric differs from the ledger",
            )

    projection: dict[str, Any] = {
        "available": True,
        "policy": {
            "method": policy["method"],
            "advWindow": policy["adv_window"],
            "participationLimits": policy["participation_limits"],
            "referenceNav": policy["reference_nav"],
            "selectionAuthority": policy["selection_authority"],
            "tradingAuthority": policy["trading_authority"],
        },
        "selectionAuthority": "context-only",
    }
    for split_name in ("validation", "test"):
        derived = derive(split_name)
        compare(
            raw.get(split_name),
            derived,
            f"RunResult/metrics/liquidity_capacity/{split_name}",
        )
        projection[split_name] = {
            "status": derived["status"],
            "tradeDates": derived["trade_dates"],
            "availableTradeDates": derived["available_trade_dates"],
            "unavailableTradeDates": derived[
                "unavailable_trade_dates"
            ],
            "tradeDateCoverage": derived["trade_date_coverage"],
            "bindingAssetCounts1Pct": derived[
                "binding_asset_counts_1pct"
            ],
            "capacity1Pct": {
                "status": derived["capacity_1pct"]["status"],
                "observations": derived["capacity_1pct"]["observations"],
                "minimumNav": derived["capacity_1pct"]["minimum_nav"],
                "tenthPercentileNav": derived["capacity_1pct"][
                    "tenth_percentile_nav"
                ],
                "medianNav": derived["capacity_1pct"]["median_nav"],
                "referenceNavBreachRate": derived["capacity_1pct"][
                    "reference_nav_breach_rate"
                ],
            },
            "capacity5Pct": {
                "status": derived["capacity_5pct"]["status"],
                "observations": derived["capacity_5pct"]["observations"],
                "minimumNav": derived["capacity_5pct"]["minimum_nav"],
                "tenthPercentileNav": derived["capacity_5pct"][
                    "tenth_percentile_nav"
                ],
                "medianNav": derived["capacity_5pct"]["median_nav"],
                "referenceNavBreachRate": derived["capacity_5pct"][
                    "reference_nav_breach_rate"
                ],
            },
        }
    trades = [
        (timestamp, rows)
        for timestamp, rows in sorted(by_date.items())
        if rows[0]["liquidity_capacity_status"]
        in {"available", "insufficient_adv_history"}
    ]
    if not trades:
        projection["latestTrade"] = None
    else:
        timestamp, rows = trades[-1]
        available = rows[0]["liquidity_capacity_status"] == "available"
        binding = next(
            (
                row["asset"]
                for row in rows
                if row["capacity_binding_asset"]
            ),
            None,
        )
        projection["latestTrade"] = {
            "timestamp": timestamp,
            "status": rows[0]["liquidity_capacity_status"],
            "capacity1Pct": (
                rows[0]["portfolio_capacity_nav_1pct"]
                if available
                else None
            ),
            "capacity5Pct": (
                rows[0]["portfolio_capacity_nav_5pct"]
                if available
                else None
            ),
            "bindingAsset": binding,
            "maximumReferenceNavParticipation": (
                max(
                    row["reference_nav_adv_participation"]
                    for row in rows
                )
                if available
                else None
            ),
        }
    return projection


EPISODE_BOOLEAN_COLUMNS = {
    "left_censored",
    "right_censored",
    "complete",
}
EPISODE_INTEGER_COLUMNS = {
    "episode_number",
    "decision_bars",
    "intent_mismatch_bars",
    "no_trade_bars",
    "risk_override_bars",
}
EPISODE_DATE_COLUMNS = {
    "entry_timestamp",
    "last_earning_timestamp",
    "exit_timestamp",
}
EPISODE_STRING_COLUMNS = {
    "episode_id",
    "split",
    "role",
    "asset",
    "side",
    "entry_action",
    "exit_action",
}
EPISODE_FLOAT_COLUMNS = (
    set(POSITION_EPISODE_COLUMNS)
    - EPISODE_BOOLEAN_COLUMNS
    - EPISODE_INTEGER_COLUMNS
    - EPISODE_DATE_COLUMNS
    - EPISODE_STRING_COLUMNS
)


def _parse_position_episodes(path: Path) -> pd.DataFrame:
    fields, raw_rows = _read_csv(
        path,
        required=set(POSITION_EPISODE_COLUMNS),
        maximum_rows=MAX_EPISODE_ROWS,
    )
    if fields != list(POSITION_EPISODE_COLUMNS):
        _fail(
            path,
            "portfolio.position-episode-columns",
            "Position-episode columns differ from the fixed contract",
        )
    parsed: list[dict[str, Any]] = []
    for row_number, raw in enumerate(raw_rows, start=2):
        row_path = f"{path}:{row_number}"
        row: dict[str, Any] = {}
        for field in EPISODE_STRING_COLUMNS:
            if not raw[field]:
                _fail(
                    f"{row_path}/{field}",
                    "portfolio.position-episode-string",
                    f"{field} must be non-empty",
                )
            row[field] = raw[field]
        for field in EPISODE_DATE_COLUMNS:
            row[field] = (
                pd.NaT
                if raw[field] == ""
                else pd.Timestamp(
                    _session_date(raw[field], f"{row_path}/{field}")
                )
            )
        for field in EPISODE_BOOLEAN_COLUMNS:
            if raw[field] not in {"True", "False"}:
                _fail(
                    f"{row_path}/{field}",
                    "portfolio.boolean",
                    f"{field} must be True or False",
                )
            row[field] = raw[field] == "True"
        for field in EPISODE_INTEGER_COLUMNS:
            try:
                value = int(raw[field])
            except ValueError:
                _fail(
                    f"{row_path}/{field}",
                    "portfolio.integer",
                    f"{field} must be a non-negative integer",
                )
            if str(value) != raw[field] or value < 0:
                _fail(
                    f"{row_path}/{field}",
                    "portfolio.integer",
                    f"{field} must be a non-negative integer",
                )
            row[field] = value
        for field in EPISODE_FLOAT_COLUMNS:
            row[field] = _finite(raw[field], f"{row_path}/{field}")
        if (
            row["split"] not in {"train", "validation", "test"}
            or row["role"]
            not in {"training", "selection", "visible-audit"}
            or row["side"] not in {"long", "short"}
            or row["episode_id"]
            != (
                f"{row['split']}:{row['asset']}:"
                f"{row['episode_number']:04d}"
            )
            or row["complete"]
            != (not (row["left_censored"] or row["right_censored"]))
            or (
                row["decision_bars"] == 0
                and not pd.isna(row["last_earning_timestamp"])
            )
            or (
                row["decision_bars"] > 0
                and pd.isna(row["last_earning_timestamp"])
            )
            or (
                row["right_censored"]
                != pd.isna(row["exit_timestamp"])
            )
            or row["intent_mismatch_bars"] > row["decision_bars"]
            or row["no_trade_bars"] > row["decision_bars"]
            or row["risk_override_bars"] > row["decision_bars"]
            or min(
                row["peak_abs_weight"],
                row["average_abs_weight"],
                row["entry_cost"],
                row["holding_cost"],
                row["exit_cost"],
                row["total_cost"],
                row["maximum_favorable_excursion"],
            )
            < -1e-12
            or row["maximum_adverse_excursion"] > 1e-12
            or not math.isclose(
                row["total_cost"],
                row["entry_cost"]
                + row["holding_cost"]
                + row["exit_cost"],
                rel_tol=0.0,
                abs_tol=1e-10,
            )
            or not math.isclose(
                row["net_contribution"],
                row["gross_contribution"] - row["total_cost"],
                rel_tol=0.0,
                abs_tol=1e-10,
            )
            or (
                row["side"] == "long"
                and row["entry_weight"] < -1e-12
            )
            or (
                row["side"] == "short"
                and row["entry_weight"] > 1e-12
            )
        ):
            _fail(
                row_path,
                "portfolio.position-episode-value",
                "Position-episode evidence is invalid",
            )
        parsed.append(row)
    if not parsed:
        return pd.DataFrame(columns=POSITION_EPISODE_COLUMNS)
    result = pd.DataFrame(parsed)
    return result.loc[:, POSITION_EPISODE_COLUMNS]


def _compare_position_episode_frames(
    actual: pd.DataFrame,
    expected: pd.DataFrame,
    path: Path,
) -> None:
    if len(actual) != len(expected):
        _fail(
            path,
            "portfolio.position-episode-coverage",
            "Position-episode artifact does not match reconstructed coverage",
        )
    for row_number, (actual_row, expected_row) in enumerate(
        zip(actual.to_dict("records"), expected.to_dict("records")),
        start=2,
    ):
        for field in POSITION_EPISODE_COLUMNS:
            actual_value = actual_row[field]
            expected_value = expected_row[field]
            if field in EPISODE_FLOAT_COLUMNS:
                matches = math.isclose(
                    float(actual_value),
                    float(expected_value),
                    rel_tol=1e-10,
                    abs_tol=1e-10,
                )
            elif field in EPISODE_DATE_COLUMNS:
                matches = (
                    pd.isna(actual_value) and pd.isna(expected_value)
                ) or (
                    not pd.isna(actual_value)
                    and not pd.isna(expected_value)
                    and pd.Timestamp(actual_value)
                    == pd.Timestamp(expected_value)
                )
            else:
                matches = actual_value == expected_value
            if not matches:
                _fail(
                    f"{path}:{row_number}/{field}",
                    "portfolio.position-episode-reconciliation",
                    "Position-episode artifact differs from the decision ledger",
                )


def _compare_position_metrics(
    actual: Any,
    expected: Any,
    path: str,
) -> None:
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            _fail(
                path,
                "portfolio.position-lifecycle-metrics",
                "Position-lifecycle metric shape differs from reconstructed evidence",
            )
        for key, value in expected.items():
            _compare_position_metrics(
                actual[key],
                value,
                f"{path}/{key}",
            )
    elif isinstance(expected, bool):
        if actual is not expected:
            _fail(
                path,
                "portfolio.position-lifecycle-metrics",
                "Position-lifecycle metric differs from reconstructed evidence",
            )
    elif isinstance(expected, float):
        if not math.isclose(
            _finite(actual, path),
            expected,
            rel_tol=1e-10,
            abs_tol=1e-10,
        ):
            _fail(
                path,
                "portfolio.position-lifecycle-metrics",
                "Position-lifecycle metric differs from reconstructed evidence",
            )
    elif actual != expected:
        _fail(
            path,
            "portfolio.position-lifecycle-metrics",
            "Position-lifecycle metric differs from reconstructed evidence",
        )


def _position_lifecycle_projection(
    result: dict[str, Any],
    episode_path: Path | None,
    ordered_decisions: list[dict[str, Any]],
    daily: ParsedDaily,
    splits: dict[str, Any],
) -> dict[str, Any]:
    raw = result["metrics"].get("position_lifecycle")
    if raw is None and episode_path is None:
        return {
            "available": False,
            "policy": None,
            "selectionAuthority": "context-only",
            "validation": None,
            "test": None,
            "recentEpisodes": [],
        }
    if not isinstance(raw, dict) or episode_path is None:
        _fail(
            "RunResult/metrics/position_lifecycle",
            "portfolio.position-lifecycle",
            "Position-lifecycle metrics and artifact must exist together",
        )
    policy = {
        "method": "split-bounded-executed-position-episodes-v1",
        "state": "sign-of-executed-weight",
        "boundary": "split-clipped-left-right-censored",
        "pnl": (
            "additive-portfolio-return-contribution-after-"
            "proportional-trade-cost"
        ),
        "excursion": (
            "cumulative-net-contribution-from-split-segment-start"
        ),
        "selection_authority": "context-only",
        "trading_authority": "none",
    }
    if raw.get("policy") != policy or set(raw) != {
        "policy",
        "train",
        "validation",
        "test",
    }:
        _fail(
            "RunResult/metrics/position_lifecycle/policy",
            "portfolio.position-lifecycle-policy",
            "Position-lifecycle policy differs from the fixed contract",
        )
    ledger = pd.DataFrame(ordered_decisions)
    ledger["timestamp"] = pd.to_datetime(
        ledger["timestamp"],
        format="ISO8601",
    )
    roles = {
        "train": "training",
        "validation": "selection",
        "test": "visible-audit",
    }
    expected_frames: dict[str, pd.DataFrame] = {}
    expected_metrics: dict[str, dict[str, object]] = {}
    for split_name in ("train", "validation", "test"):
        split = splits[split_name]
        index = pd.DatetimeIndex(
            [
                timestamp
                for timestamp in pd.to_datetime(
                    daily.dates,
                    format="ISO8601",
                )
                if pd.Timestamp(split["start"])
                <= timestamp
                <= pd.Timestamp(split["signalEnd"])
            ]
        )
        try:
            frame = build_position_episodes(
                ledger,
                index,
                split=split_name,
                role=roles[split_name],
            )
            metrics = position_episode_metrics(
                frame,
                ledger,
                index,
            )
        except PortfolioFailure as error:
            _fail(
                episode_path,
                getattr(error, "code", "portfolio.position-lifecycle"),
                str(error),
            )
        expected_frames[split_name] = frame
        expected_metrics[split_name] = metrics
        _compare_position_metrics(
            raw[split_name],
            metrics,
            f"RunResult/metrics/position_lifecycle/{split_name}",
        )
    expected = pd.concat(
        expected_frames.values(),
        ignore_index=True,
    )
    actual = _parse_position_episodes(episode_path)
    _compare_position_episode_frames(actual, expected, episode_path)

    def split_projection(name: str) -> dict[str, Any]:
        value = expected_metrics[name]
        return {
            "status": value["status"],
            "segments": value["segments"],
            "activeSegments": value["active_segments"],
            "completeEpisodes": value["complete_episodes"],
            "leftCensoredSegments": value["left_censored_segments"],
            "rightCensoredSegments": value["right_censored_segments"],
            "longSegments": value["long_segments"],
            "shortSegments": value["short_segments"],
            "decisionBars": value["decision_bars"],
            "segmentPositiveRate": value["segment_positive_rate"],
            "completeEpisodeWinRate": value[
                "complete_episode_win_rate"
            ],
            "averageCompleteHoldingBars": value[
                "average_complete_holding_bars"
            ],
            "medianCompleteHoldingBars": value[
                "median_complete_holding_bars"
            ],
            "averageCompleteWinContribution": value[
                "average_complete_win_contribution"
            ],
            "averageCompleteLossContribution": value[
                "average_complete_loss_contribution"
            ],
            "completePayoffRatio": value["complete_payoff_ratio"],
            "completeProfitFactor": value["complete_profit_factor"],
            "averageSegmentMfe": value["average_segment_mfe"],
            "averageSegmentMae": value["average_segment_mae"],
            "intentMismatchBars": value["intent_mismatch_bars"],
            "intentMismatchRate": value["intent_mismatch_rate"],
            "noTradeBars": value["no_trade_bars"],
            "noTradeBarRate": value["no_trade_bar_rate"],
            "riskOverrideBars": value["risk_override_bars"],
            "totalGrossContribution": value[
                "total_gross_contribution"
            ],
            "totalCost": value["total_cost"],
            "totalNetContribution": value[
                "total_net_contribution"
            ],
            "byAsset": [
                {
                    "asset": asset,
                    "segments": metrics["segments"],
                    "activeSegments": metrics["active_segments"],
                    "completeEpisodes": metrics["complete_episodes"],
                    "decisionBars": metrics["decision_bars"],
                    "totalNetContribution": metrics[
                        "total_net_contribution"
                    ],
                    "totalCost": metrics["total_cost"],
                    "completeEpisodeWinRate": metrics[
                        "complete_episode_win_rate"
                    ],
                }
                for asset, metrics in value["by_asset"].items()
            ],
            "reconciliation": value["reconciliation"],
        }

    active_recent = expected[
        expected["split"].isin(["validation", "test"])
        & (expected["decision_bars"].astype(int) > 0)
    ]
    recent = pd.concat(
        [
            active_recent[active_recent["split"].eq(name)]
            .sort_values(
                ["entry_timestamp", "asset", "episode_number"],
            )
            .tail(12)
            for name in ("validation", "test")
        ],
        ignore_index=True,
    )
    return {
        "available": True,
        "policy": {
            "method": policy["method"],
            "state": policy["state"],
            "boundary": policy["boundary"],
            "pnl": policy["pnl"],
            "excursion": policy["excursion"],
            "selectionAuthority": policy["selection_authority"],
            "tradingAuthority": policy["trading_authority"],
        },
        "selectionAuthority": "context-only",
        "validation": split_projection("validation"),
        "test": split_projection("test"),
        "recentEpisodes": [
            {
                "id": row["episode_id"],
                "split": row["split"],
                "role": row["role"],
                "asset": row["asset"],
                "side": row["side"],
                "entryTimestamp": timestamp_label(row["entry_timestamp"]),
                "lastEarningTimestamp": (
                    None
                    if pd.isna(row["last_earning_timestamp"])
                    else timestamp_label(row["last_earning_timestamp"])
                ),
                "exitTimestamp": (
                    None
                    if pd.isna(row["exit_timestamp"])
                    else timestamp_label(row["exit_timestamp"])
                ),
                "entryAction": row["entry_action"],
                "exitAction": row["exit_action"],
                "leftCensored": bool(row["left_censored"]),
                "rightCensored": bool(row["right_censored"]),
                "complete": bool(row["complete"]),
                "decisionBars": int(row["decision_bars"]),
                "netContribution": float(row["net_contribution"]),
                "totalCost": float(row["total_cost"]),
                "maximumFavorableExcursion": float(
                    row["maximum_favorable_excursion"]
                ),
                "maximumAdverseExcursion": float(
                    row["maximum_adverse_excursion"]
                ),
                "intentMismatchBars": int(
                    row["intent_mismatch_bars"]
                ),
            }
            for row in recent.to_dict("records")
        ],
    }


def load_portfolio_diagnostics(
    project: ProjectContext,
    run_id: str,
    *,
    point_limit: int = DEFAULT_PORTFOLIO_POINTS,
) -> dict[str, Any]:
    """Verify and project one immutable Portfolio Run into a bounded read model."""

    if (
        not isinstance(point_limit, int)
        or isinstance(point_limit, bool)
        or not MIN_PORTFOLIO_POINTS <= point_limit <= MAX_PORTFOLIO_POINTS
    ):
        _fail(
            point_limit,
            "portfolio.point-limit",
            f"point_limit must be {MIN_PORTFOLIO_POINTS}..{MAX_PORTFOLIO_POINTS}",
        )
    run = load_run(project, run_id)
    if run.result["objective"]["metric"] != "validation_net_sharpe":
        _fail(
            run.root_dir,
            "portfolio.run-kind",
            "Run is not a fixed Portfolio Lab evaluation",
        )
    universe = run.result["dataset"].get("universe")
    if (
        not isinstance(universe, list)
        or not universe
        or len(universe) > MAX_UNIVERSE
        or not all(isinstance(asset, str) and asset for asset in universe)
        or len(universe) != len(set(universe))
    ):
        _fail(
            run.root_dir,
            "portfolio.universe",
            f"Portfolio universe must contain 1..{MAX_UNIVERSE} unique assets",
        )
    paths, artifact_identities = _artifact_paths(run)
    try:
        report = json.loads(paths["portfolio-report"].read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        _fail(
            paths["portfolio-report"],
            "portfolio.report-json",
            "Portfolio report must be a UTF-8 JSON object",
        )
    if not isinstance(report, dict):
        _fail(
            paths["portfolio-report"],
            "portfolio.report-json",
            "Portfolio report must be a UTF-8 JSON object",
        )
    prediction_population, prediction_population_projection = (
        _prediction_population_projection(run, report, universe)
    )
    mandate = _mandate_projection(run, report, universe)
    research_horizon = _research_horizon_projection(run, report)
    reference_nav = float(
        mandate["implementationPolicy"]["referenceNav"]
    )

    daily = _parse_daily(paths["portfolio-daily"])
    locked_decision_policy = mandate["implementationPolicy"][
        "decisionPolicy"
    ]
    flat_decision_policy = {
        key: value
        for key, value in locked_decision_policy.items()
        if key != "source"
    }
    if any(
        row["decision_schedule"] != flat_decision_policy
        for row in daily.rows
    ):
        _fail(
            paths["portfolio-daily"],
            "portfolio.decision-policy",
            "Daily decision policy differs from the Portfolio Mandate",
        )
    expected_mask = decision_schedule_mask(
        pd.DatetimeIndex(daily.dates),
        locked_decision_policy,
    )
    for position, row in enumerate(daily.rows):
        expected_session = (
            str(row["timestamp"])[:7]
            if locked_decision_policy["kind"] == "calendar-month-end"
            else (
                "dataset"
                if locked_decision_policy["anchor"] == "dataset-start"
                else str(row["timestamp"])[:10]
            )
        )
        expected_eligible = bool(expected_mask.iloc[position])
        if (
            row["decision_session"] != expected_session
            or row["decision_eligible"] != expected_eligible
        ):
            _fail(
                paths["portfolio-daily"],
                "portfolio.decision-schedule",
                "Daily decision schedule differs from its locked anchor",
            )
    target_dates, targets = _parse_weight_panel(
        paths["portfolio-targets"],
        universe,
    )
    weight_dates, weights = _parse_weight_panel(
        paths["portfolio-weights"],
        universe,
    )
    if weight_dates != daily.dates:
        _fail(
            paths["portfolio-weights"],
            "portfolio.weight-panel",
            "Executed weights must exactly match daily timestamp panel",
        )
    if (
        target_dates[: len(daily.dates)] != daily.dates
        or len(target_dates) not in {len(daily.dates), len(daily.dates) + 1}
    ):
        _fail(
            paths["portfolio-targets"],
            "portfolio.target-panel",
            "Targets must cover the daily panel with at most one pending row",
        )
    ordered_decisions, decisions = _parse_decisions(
        paths["portfolio-decisions"],
        daily,
        universe,
        targets,
        weights,
        reference_nav,
        mandate,
    )
    _verify_signal_translation(
        ordered_decisions,
        daily.dates,
        universe,
        prediction_population,
    )
    splits, split_names = _split_contract(run.result)
    research_integrity = run.result["metrics"].get("research_integrity")
    if not isinstance(research_integrity, dict):
        _fail(
            "RunResult/metrics/research_integrity",
            "portfolio.selection",
            "Portfolio Run must disclose selection integrity",
        )
    signal_policy = _signal_policy_projection(
        run.result,
        mandate,
        prediction_population,
        report,
    )
    mechanical_decision = _mechanical_decision_projection(
        daily,
        universe,
        decisions,
        signal_policy,
        mandate,
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": PORTFOLIO_DIAGNOSTICS_KIND,
        "run": {
            "id": run.result["id"],
            "studyId": run.result["study"]["id"],
            "status": run.result["status"],
            "startedAt": run.result["startedAt"],
            "inputHash": run.result["inputHash"],
            "datasetHash": run.result["dataset"]["hash"],
            "primaryMetric": run.result["objective"]["metric"],
            "primaryValue": run.result["metrics"][
                run.result["objective"]["metric"]
            ],
        },
        "universe": universe,
        "predictionUniverse": prediction_population_projection,
        "mandate": mandate,
        "researchHorizon": research_horizon,
        "decisionCadence": {
            **mandate["implementationPolicy"]["decisionPolicy"],
            "observations": len(daily.rows),
            "scheduleGroups": len(
                {row["decision_session"] for row in daily.rows}
            ),
            "eligibleBars": sum(
                row["decision_eligible"] for row in daily.rows
            ),
            "eligibleRate": (
                sum(row["decision_eligible"] for row in daily.rows)
                / len(daily.rows)
            ),
            "scheduledHoldBars": sum(
                not row["decision_eligible"]
                and not row["risk_rebalance_override"]
                and not row["constraint_rebalance_override"]
                for row in daily.rows
            ),
            "riskOnlyOverrideBars": sum(
                not row["decision_eligible"]
                and row["risk_rebalance_override"]
                and not row["constraint_rebalance_override"]
                for row in daily.rows
            ),
            "constraintOnlyOverrideBars": sum(
                not row["decision_eligible"]
                and row["constraint_rebalance_override"]
                and not row["risk_rebalance_override"]
                for row in daily.rows
            ),
            "jointConstraintRiskOverrideBars": sum(
                not row["decision_eligible"]
                and row["constraint_rebalance_override"]
                and row["risk_rebalance_override"]
                for row in daily.rows
            ),
        },
        "selection": {
            "selectionSplit": research_integrity.get("selection_split"),
            "testRole": research_integrity.get("test_role"),
            "testEntersSelection": research_integrity.get(
                "test_enters_selection"
            ),
            "externalHoldoutRule": research_integrity.get(
                "external_holdout_rule"
            ),
            "splits": splits,
        },
        "artifacts": artifact_identities,
        "path": _path_projection(
            daily,
            weights,
            splits,
            split_names,
            point_limit,
        ),
        "currentBook": _current_book(
            daily,
            universe,
            decisions,
        ),
        "mechanicalDecision": mechanical_decision,
        "sizingAnatomy": _sizing_anatomy_projection(
            daily,
            universe,
            decisions,
            mandate,
            mechanical_decision,
        ),
        "diversificationStress": _diversification_stress_projection(
            daily,
            universe,
            decisions,
            splits,
            mandate,
        ),
        "strategyViability": _strategy_viability_projection(
            run.result,
            daily,
            splits,
        ),
        "signalMonetization": _signal_monetization_projection(
            ordered_decisions,
            daily,
            splits,
            mandate,
            universe,
            prediction_population,
        ),
        "translationRobustness": _translation_robustness_projection(
            run.result,
            paths.get(TRANSLATION_ROBUSTNESS_ARTIFACT_KIND),
            ordered_decisions,
            daily,
            splits,
            prediction_population,
            mandate,
        ),
        "recentTransitions": _recent_transitions(
            ordered_decisions,
            universe,
        ),
        "signalPolicy": signal_policy,
        "riskGovernor": _risk_governor_projection(run.result, mandate),
        "executedBookRisk": _executed_book_risk_projection(
            run.result,
            daily,
            splits,
            mandate,
        ),
        "liquidityCapacity": _liquidity_capacity_projection(
            run.result,
            ordered_decisions,
            splits,
            reference_nav,
        ),
        "positionLifecycle": _position_lifecycle_projection(
            run.result,
            paths.get(POSITION_EPISODE_ARTIFACT_KIND),
            ordered_decisions,
            daily,
            splits,
        ),
        "parameterNeighborhood": _parameter_neighborhood_projection(
            run.result,
            paths.get(PARAMETER_NEIGHBORHOOD_ARTIFACT_KIND),
            daily,
            splits,
        ),
        "attribution": _attribution_projection(run.result, universe),
    }


PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant bounded Portfolio Run diagnostics",
    "$defs": {
        "artifact": {
            "type": "object",
            "additionalProperties": False,
            "required": ["path", "sha256"],
            "properties": {
                "path": {"type": "string", "minLength": 1},
                "sha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
            },
        },
        "split": {
            "type": "object",
            "additionalProperties": False,
            "required": ["start", "end", "signalEnd", "role"],
            "properties": {
                "start": TIMESTAMP_JSON_SCHEMA,
                "end": TIMESTAMP_JSON_SCHEMA,
                "signalEnd": TIMESTAMP_JSON_SCHEMA,
                "role": {"type": "string", "minLength": 1},
            },
        },
        "pathPoint": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "timestamp",
                "split",
                "netGrowth",
                "grossGrowth",
                "benchmarkGrowth",
                "drawdown",
                "grossExposure",
                "netExposure",
                "cashWeight",
                "oneWayTurnover",
                "cost",
                "rebalanced",
                "executedRiskForecastAnnualized",
                "executionRiskCeilingAnnualized",
                "riskRebalanceOverride",
                "weights",
            ],
            "properties": {
                "timestamp": TIMESTAMP_JSON_SCHEMA,
                "split": {"enum": ["train", "validation", "test"]},
                "netGrowth": {"type": "number"},
                "grossGrowth": {"type": "number"},
                "benchmarkGrowth": {"type": "number"},
                "drawdown": {"type": "number"},
                "grossExposure": {"type": "number"},
                "netExposure": {"type": "number"},
                "cashWeight": {"type": "number"},
                "oneWayTurnover": {"type": "number", "minimum": 0},
                "cost": {"type": "number", "minimum": 0},
                "rebalanced": {"type": "boolean"},
                "executedRiskForecastAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "executionRiskCeilingAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "riskRebalanceOverride": {"type": "boolean"},
                "weights": {
                    "type": "object",
                    "additionalProperties": {"type": "number"},
                },
            },
        },
        "position": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "asset",
                "signalState",
                "signalEvent",
                "tradable",
                "permittedDirection",
                "allocationStatus",
                "conviction",
                "preGovernorTargetWeight",
                "targetWeight",
                "targetAction",
                "pretradeWeight",
                "executedWeight",
                "tradeWeight",
                "executionAction",
                "executionReason",
                "netReturnContribution",
                "regime",
                "riskStrength",
                "varianceContributionShare",
            ],
            "properties": {
                "asset": {"type": "string", "minLength": 1},
                "signalState": {"enum": [-1, 0, 1]},
                "signalEvent": {"type": "string", "minLength": 1},
                "tradable": {"type": "boolean"},
                "permittedDirection": {
                    "enum": [
                        "dollar-neutral",
                        "long-cash",
                        "short-cash",
                        "asset-role",
                    ]
                },
                "allocationStatus": {"type": "string", "minLength": 1},
                "conviction": {"type": "number"},
                "preGovernorTargetWeight": {"type": "number"},
                "targetWeight": {"type": "number"},
                "targetAction": {"type": "string", "minLength": 1},
                "pretradeWeight": {"type": "number"},
                "executedWeight": {"type": "number"},
                "tradeWeight": {"type": "number"},
                "executionAction": {"type": "string", "minLength": 1},
                "executionReason": {"type": "string", "minLength": 1},
                "netReturnContribution": {"type": "number"},
                "regime": {"type": "string", "minLength": 1},
                "riskStrength": {"type": "number"},
                "varianceContributionShare": {"type": "number"},
            },
        },
        "mechanicalTrigger": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "event",
                "comparator",
                "threshold",
                "distance",
            ],
            "properties": {
                "event": {"type": "string", "minLength": 1},
                "comparator": {"enum": [">=", ">", "<=", "<"]},
                "threshold": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "distance": {
                    "anyOf": [
                        {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        {"type": "null"},
                    ]
                },
            },
        },
        "mechanicalPosition": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "asset",
                "positionRole",
                "tradable",
                "allocationStatus",
                "score",
                "scoreAvailable",
                "signalState",
                "signalEvent",
                "nextTriggers",
                "nearestTrigger",
                "preGovernorTargetWeight",
                "targetWeight",
                "pretradeWeight",
                "proposedTradeWeight",
                "executedWeight",
                "tradeWeight",
                "executionAction",
                "executionReason",
            ],
            "properties": {
                "asset": {"type": "string", "minLength": 1},
                "positionRole": {
                    "enum": [
                        "long-only",
                        "short-only",
                        "two-sided",
                        "context-only",
                    ]
                },
                "tradable": {"type": "boolean"},
                "allocationStatus": {"type": "string", "minLength": 1},
                "score": {
                    "anyOf": [
                        {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        {"type": "null"},
                    ]
                },
                "scoreAvailable": {"type": "boolean"},
                "signalState": {"enum": [-1, 0, 1]},
                "signalEvent": {"type": "string", "minLength": 1},
                "nextTriggers": {
                    "type": "array",
                    "maxItems": 2,
                    "items": {"$ref": "#/$defs/mechanicalTrigger"},
                },
                "nearestTrigger": {
                    "anyOf": [
                        {"$ref": "#/$defs/mechanicalTrigger"},
                        {"type": "null"},
                    ]
                },
                "preGovernorTargetWeight": {"type": "number"},
                "targetWeight": {"type": "number"},
                "pretradeWeight": {"type": "number"},
                "proposedTradeWeight": {"type": "number"},
                "executedWeight": {"type": "number"},
                "tradeWeight": {"type": "number"},
                "executionAction": {"type": "string", "minLength": 1},
                "executionReason": {"type": "string", "minLength": 1},
            },
        },
        "transition": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "timestamp",
                "asset",
                "priorSignalState",
                "signalState",
                "signalEvent",
                "tradable",
                "permittedDirection",
                "allocationStatus",
                "riskGovernorStatus",
                "riskGovernorScale",
                "preGovernorTargetWeight",
                "targetWeight",
                "executedWeight",
                "tradeWeight",
                "executionAction",
                "executionReason",
                "regime",
            ],
            "properties": {
                "timestamp": TIMESTAMP_JSON_SCHEMA,
                "asset": {"type": "string", "minLength": 1},
                "priorSignalState": {"enum": [-1, 0, 1]},
                "signalState": {"enum": [-1, 0, 1]},
                "signalEvent": {"type": "string", "minLength": 1},
                "tradable": {"type": "boolean"},
                "permittedDirection": {
                    "enum": [
                        "dollar-neutral",
                        "long-cash",
                        "short-cash",
                        "asset-role",
                    ]
                },
                "allocationStatus": {"type": "string", "minLength": 1},
                "riskGovernorStatus": {"type": "string", "minLength": 1},
                "riskGovernorScale": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "preGovernorTargetWeight": {"type": "number"},
                "targetWeight": {"type": "number"},
                "executedWeight": {"type": "number"},
                "tradeWeight": {"type": "number"},
                "executionAction": {"type": "string", "minLength": 1},
                "executionReason": {"type": "string", "minLength": 1},
                "regime": {"type": "string", "minLength": 1},
            },
        },
        "attributionRow": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "asset",
                "annualizedNetContribution",
                "averageAbsoluteWeight",
                "meanVarianceContributionShare",
                "totalCostContribution",
                "totalOneWayTurnoverContribution",
            ],
            "properties": {
                "asset": {"type": "string", "minLength": 1},
                "annualizedNetContribution": {"type": "number"},
                "averageAbsoluteWeight": {"type": "number", "minimum": 0},
                "meanVarianceContributionShare": {"type": "number"},
                "totalCostContribution": {"type": "number", "minimum": 0},
                "totalOneWayTurnoverContribution": {
                    "type": "number",
                    "minimum": 0,
                },
            },
        },
        "diversificationPosition": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "asset",
                "active",
                "executedWeight",
                "causalOwnVolatility",
                "componentVariance",
                "componentRiskShare",
                "absoluteComponentRiskShare",
                "standaloneRiskLoadAnnualized",
                "stressRiskShare",
            ],
            "properties": {
                "asset": {"type": "string", "minLength": 1},
                "active": {"type": "boolean"},
                "executedWeight": {"type": "number"},
                "causalOwnVolatility": {
                    "type": ["number", "null"],
                    "exclusiveMinimum": 0,
                },
                "componentVariance": {"type": "number"},
                "componentRiskShare": {"type": "number"},
                "absoluteComponentRiskShare": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "standaloneRiskLoadAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "stressRiskShare": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
            },
        },
        "diversificationScenarioDefinition": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "label",
                "blendToPerfectCorrelation",
            ],
            "properties": {
                "id": {
                    "enum": [
                        "quarter-breakdown",
                        "half-breakdown",
                        "perfect-aligned",
                    ]
                },
                "label": {"type": "string", "minLength": 1},
                "blendToPerfectCorrelation": {
                    "enum": [0.25, 0.5, 1.0]
                },
            },
        },
        "diversificationScenarioEvidence": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "blendToPerfectCorrelation",
                "forecastAnnualized",
                "multiplier",
                "breachesCeiling",
            ],
            "properties": {
                "id": {
                    "enum": [
                        "quarter-breakdown",
                        "half-breakdown",
                        "perfect-aligned",
                    ]
                },
                "blendToPerfectCorrelation": {
                    "enum": [0.25, 0.5, 1.0]
                },
                "forecastAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "multiplier": {
                    "type": ["number", "null"],
                    "minimum": 1,
                },
                "breachesCeiling": {
                    "type": ["boolean", "null"]
                },
            },
        },
        "diversificationScenarioSummary": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "blendToPerfectCorrelation",
                "stressBreachDates",
                "stressBreachRate",
                "medianMultiplier",
                "p95Multiplier",
                "maximumMultiplier",
            ],
            "properties": {
                "id": {
                    "enum": [
                        "quarter-breakdown",
                        "half-breakdown",
                        "perfect-aligned",
                    ]
                },
                "blendToPerfectCorrelation": {
                    "enum": [0.25, 0.5, 1.0]
                },
                "stressBreachDates": {
                    "type": ["integer", "null"],
                    "minimum": 0,
                },
                "stressBreachRate": {
                    "type": ["number", "null"],
                    "minimum": 0,
                    "maximum": 1,
                },
                "medianMultiplier": {
                    "type": ["number", "null"],
                    "minimum": 1,
                },
                "p95Multiplier": {
                    "type": ["number", "null"],
                    "minimum": 1,
                },
                "maximumMultiplier": {
                    "type": ["number", "null"],
                    "minimum": 1,
                },
            },
        },
        "diversificationStressBook": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "timestamp",
                "activeAssets",
                "covarianceObservations",
                "sampleForecastAnnualized",
                "perfectCorrelationForecastAnnualized",
                "stressMultiplier",
                "ceilingAnnualized",
                "stressBreachesCeiling",
                "absoluteComponentRiskHhi",
                "effectiveRiskBets",
                "largestAbsoluteComponentRiskContributor",
            ],
            "properties": {
                "timestamp": TIMESTAMP_JSON_SCHEMA,
                "activeAssets": {"type": "integer", "minimum": 1},
                "covarianceObservations": {
                    "type": "integer",
                    "minimum": 0,
                },
                "sampleForecastAnnualized": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                },
                "perfectCorrelationForecastAnnualized": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                },
                "stressMultiplier": {
                    "type": "number",
                    "minimum": 1,
                },
                "ceilingAnnualized": {
                    "type": ["number", "null"],
                    "exclusiveMinimum": 0,
                },
                "stressBreachesCeiling": {
                    "type": ["boolean", "null"]
                },
                "absoluteComponentRiskHhi": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 1,
                },
                "effectiveRiskBets": {
                    "type": "number",
                    "minimum": 1,
                    "maximum": MAX_UNIVERSE,
                },
                "largestAbsoluteComponentRiskContributor": {
                    "type": "string",
                    "minLength": 1,
                },
            },
        },
        "diversificationSplit": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "role",
                "totalDates",
                "activeDates",
                "availableDates",
                "flatDates",
                "unavailableDates",
                "stressBreachDates",
                "stressBreachRate",
                "medianStressMultiplier",
                "p95StressMultiplier",
                "maximumStressMultiplier",
                "medianEffectiveRiskBets",
                "minimumEffectiveRiskBets",
                "maximumStressBook",
                "scenarios",
            ],
            "properties": {
                "role": {"type": "string", "minLength": 1},
                "totalDates": {"type": "integer", "minimum": 0},
                "activeDates": {"type": "integer", "minimum": 0},
                "availableDates": {"type": "integer", "minimum": 0},
                "flatDates": {"type": "integer", "minimum": 0},
                "unavailableDates": {
                    "type": "integer",
                    "minimum": 0,
                },
                "stressBreachDates": {
                    "type": ["integer", "null"],
                    "minimum": 0,
                },
                "stressBreachRate": {
                    "type": ["number", "null"],
                    "minimum": 0,
                    "maximum": 1,
                },
                "medianStressMultiplier": {
                    "type": ["number", "null"],
                    "minimum": 1,
                },
                "p95StressMultiplier": {
                    "type": ["number", "null"],
                    "minimum": 1,
                },
                "maximumStressMultiplier": {
                    "type": ["number", "null"],
                    "minimum": 1,
                },
                "medianEffectiveRiskBets": {
                    "type": ["number", "null"],
                    "minimum": 1,
                    "maximum": MAX_UNIVERSE,
                },
                "minimumEffectiveRiskBets": {
                    "type": ["number", "null"],
                    "minimum": 1,
                    "maximum": MAX_UNIVERSE,
                },
                "maximumStressBook": {
                    "anyOf": [
                        {
                            "$ref": "#/$defs/diversificationStressBook"
                        },
                        {"type": "null"},
                    ]
                },
                "scenarios": {
                    "type": "array",
                    "minItems": 3,
                    "maxItems": 3,
                    "items": {
                        "$ref": "#/$defs/diversificationScenarioSummary"
                    },
                },
            },
        },
        "sizingSide": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "side",
                "permitted",
                "configuredBudget",
                "proportionalBudget",
                "fundedRawBudget",
                "unfundedBudget",
                "activeAssets",
                "activeAssetIds",
                "strengthTotal",
                "capCapacity",
                "atCapAssets",
                "allocationFeasible",
            ],
            "properties": {
                "side": {"enum": ["long", "short"]},
                "permitted": {"type": "boolean"},
                "configuredBudget": {"type": "number", "minimum": 0},
                "proportionalBudget": {"type": "number", "minimum": 0},
                "fundedRawBudget": {"type": "number", "minimum": 0},
                "unfundedBudget": {"type": "number", "minimum": 0},
                "activeAssets": {"type": "integer", "minimum": 0},
                "activeAssetIds": {
                    "type": "array",
                    "maxItems": MAX_UNIVERSE,
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                },
                "strengthTotal": {"type": "number", "minimum": 0},
                "capCapacity": {"type": "number", "minimum": 0},
                "atCapAssets": {
                    "type": "array",
                    "maxItems": MAX_UNIVERSE,
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                },
                "allocationFeasible": {"type": "boolean"},
            },
        },
        "sizingPosition": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "asset",
                "tradable",
                "side",
                "signalState",
                "score",
                "conviction",
                "trailingVolatility",
                "riskStrength",
                "sameSideStrengthShare",
                "proportionalWeightBeforeCap",
                "maxAbsWeight",
                "proportionalWeightExceedsCap",
                "rawWeight",
                "atCap",
                "allocationDeltaFromProportional",
                "riskGovernorScale",
                "governedWeight",
                "executedWeight",
                "diagonalRiskBudgetShare",
                "componentRiskAvailable",
                "componentRiskShare",
            ],
            "properties": {
                "asset": {"type": "string", "minLength": 1},
                "tradable": {"type": "boolean"},
                "side": {
                    "enum": ["long", "short", "flat", "context"]
                },
                "signalState": {"enum": [-1, 0, 1]},
                "score": {
                    "anyOf": [
                        {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        {"type": "null"},
                    ]
                },
                "conviction": {"type": "number", "minimum": 0},
                "trailingVolatility": {
                    "anyOf": [
                        {"type": "number", "exclusiveMinimum": 0},
                        {"type": "null"},
                    ]
                },
                "riskStrength": {"type": "number", "minimum": 0},
                "sameSideStrengthShare": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "proportionalWeightBeforeCap": {"type": "number"},
                "maxAbsWeight": {
                    "type": "number",
                    "minimum": 0,
                },
                "proportionalWeightExceedsCap": {"type": "boolean"},
                "rawWeight": {"type": "number"},
                "atCap": {"type": "boolean"},
                "allocationDeltaFromProportional": {"type": "number"},
                "riskGovernorScale": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "governedWeight": {"type": "number"},
                "executedWeight": {"type": "number"},
                "diagonalRiskBudgetShare": {"type": "number"},
                "componentRiskAvailable": {"type": "boolean"},
                "componentRiskShare": {"type": "number"},
            },
        },
        "viabilityPerformance": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "observations",
                "totalReturn",
                "annualReturn",
                "annualVolatility",
                "sharpe",
                "sortino",
                "maximumDrawdown",
                "expectedShortfall95",
                "positiveRate",
                "activeAnnualReturn",
                "informationRatio",
            ],
            "properties": {
                "observations": {"type": "integer", "minimum": 20},
                "totalReturn": {"type": "number"},
                "annualReturn": {"type": "number"},
                "annualVolatility": {"type": "number", "minimum": 0},
                "sharpe": {"type": "number"},
                "sortino": {"type": "number"},
                "maximumDrawdown": {"type": "number", "maximum": 0},
                "expectedShortfall95": {"type": "number"},
                "positiveRate": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "activeAnnualReturn": {"type": "number"},
                "informationRatio": {"type": "number"},
            },
        },
        "viabilitySplit": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "role",
                "factorRankIc",
                "gross",
                "net",
                "benchmark",
                "friction",
                "costStress",
                "extraDelay",
                "temporal",
            ],
            "properties": {
                "role": {"enum": ["selection", "visible-audit"]},
                "factorRankIc": {"type": "number"},
                "gross": {"$ref": "#/$defs/viabilityPerformance"},
                "net": {"$ref": "#/$defs/viabilityPerformance"},
                "benchmark": {"$ref": "#/$defs/viabilityPerformance"},
                "friction": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "baseCostBps",
                        "totalCostDrag",
                        "annualizedOneWayTurnover",
                        "grossToNetTotalReturnWedge",
                        "grossToNetAnnualReturnWedge",
                        "grossToNetSharpeDelta",
                        "grossReturnPerOneWayTurnoverBps",
                        "netReturnPerOneWayTurnoverBps",
                        "breakEvenCost",
                    ],
                    "properties": {
                        "baseCostBps": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "totalCostDrag": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "annualizedOneWayTurnover": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "grossToNetTotalReturnWedge": {
                            "type": "number"
                        },
                        "grossToNetAnnualReturnWedge": {
                            "type": "number"
                        },
                        "grossToNetSharpeDelta": {"type": "number"},
                        "grossReturnPerOneWayTurnoverBps": {
                            "type": ["number", "null"]
                        },
                        "netReturnPerOneWayTurnoverBps": {
                            "type": ["number", "null"]
                        },
                        "breakEvenCost": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "status",
                                "bps",
                                "searchMaximumBps",
                            ],
                            "properties": {
                                "status": {
                                    "enum": [
                                        "available",
                                        "gross-non-positive",
                                        "no-turnover",
                                        "above-search-bound",
                                    ]
                                },
                                "bps": {
                                    "type": ["number", "null"],
                                    "minimum": 0,
                                },
                                "searchMaximumBps": {
                                    "const": BREAK_EVEN_COST_SEARCH_MAX_BPS
                                },
                            },
                        },
                    },
                },
                "costStress": {
                    "type": "array",
                    "minItems": 3,
                    "maxItems": 3,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": [
                            "costBps",
                            "totalReturn",
                            "annualReturn",
                            "netSharpe",
                        ],
                        "properties": {
                            "costBps": {
                                "type": "number",
                                "minimum": 0,
                            },
                            "totalReturn": {"type": "number"},
                            "annualReturn": {"type": "number"},
                            "netSharpe": {"type": "number"},
                        },
                    },
                },
                "extraDelay": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "totalReturn",
                        "annualReturn",
                        "netSharpe",
                        "netSharpeDelta",
                    ],
                    "properties": {
                        "totalReturn": {"type": "number"},
                        "annualReturn": {"type": "number"},
                        "netSharpe": {"type": "number"},
                        "netSharpeDelta": {"type": "number"},
                    },
                },
                "temporal": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "months",
                        "positiveNetMonthRate",
                        "bestNetMonth",
                        "worstNetMonth",
                        "maximumUnderwaterBars",
                        "maximumUnderwaterStart",
                        "maximumUnderwaterEnd",
                        "currentUnderwaterBars",
                        "bestDayCount",
                        "bestDaysAbsoluteReturnShare",
                        "netTotalReturnWithoutBestDays",
                    ],
                    "properties": {
                        "months": {"type": "integer", "minimum": 1},
                        "positiveNetMonthRate": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "bestNetMonth": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["month", "return"],
                            "properties": {
                                "month": {
                                    "type": "string",
                                    "pattern": "^[0-9]{4}-[0-9]{2}$",
                                },
                                "return": {"type": "number"},
                            },
                        },
                        "worstNetMonth": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["month", "return"],
                            "properties": {
                                "month": {
                                    "type": "string",
                                    "pattern": "^[0-9]{4}-[0-9]{2}$",
                                },
                                "return": {"type": "number"},
                            },
                        },
                        "maximumUnderwaterBars": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "maximumUnderwaterStart": (
                            NULLABLE_TIMESTAMP_JSON_SCHEMA
                        ),
                        "maximumUnderwaterEnd": (
                            NULLABLE_TIMESTAMP_JSON_SCHEMA
                        ),
                        "currentUnderwaterBars": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "bestDayCount": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 5,
                        },
                        "bestDaysAbsoluteReturnShare": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "netTotalReturnWithoutBestDays": {
                            "type": "number"
                        },
                    },
                },
            },
        },
        "monetizationStage": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "label",
                "totalContribution",
                "meanDailyContribution",
                "annualizedContribution",
            ],
            "properties": {
                "id": {
                    "enum": [
                        "equalIntent",
                        "preGovernorSizing",
                        "governedTarget",
                        "executedGross",
                        "executedNet",
                    ]
                },
                "label": {"type": "string", "minLength": 1},
                "totalContribution": {"type": "number"},
                "meanDailyContribution": {"type": "number"},
                "annualizedContribution": {"type": "number"},
            },
        },
        "monetizationDelta": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "label",
                "fromStage",
                "toStage",
                "totalContributionDelta",
                "annualizedContributionDelta",
            ],
            "properties": {
                "id": {
                    "enum": [
                        "sizingAndCaps",
                        "riskGovernor",
                        "executionRetention",
                        "tradingCost",
                    ]
                },
                "label": {"type": "string", "minLength": 1},
                "fromStage": {
                    "enum": [
                        "equalIntent",
                        "preGovernorSizing",
                        "governedTarget",
                        "executedGross",
                    ]
                },
                "toStage": {
                    "enum": [
                        "preGovernorSizing",
                        "governedTarget",
                        "executedGross",
                        "executedNet",
                    ]
                },
                "totalContributionDelta": {"type": "number"},
                "annualizedContributionDelta": {"type": "number"},
            },
        },
        "monetizationAsset": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "asset",
                "equalIntent",
                "preGovernorSizing",
                "governedTarget",
                "executedGross",
                "executedNet",
                "costContribution",
            ],
            "properties": {
                "asset": {"type": "string", "minLength": 1},
                "equalIntent": {"type": "number"},
                "preGovernorSizing": {"type": "number"},
                "governedTarget": {"type": "number"},
                "executedGross": {"type": "number"},
                "executedNet": {"type": "number"},
                "costContribution": {"type": "number", "minimum": 0},
            },
        },
        "monetizationSplit": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "role",
                "coverage",
                "stages",
                "deltas",
                "byAsset",
                "reconciliation",
            ],
            "properties": {
                "role": {"enum": ["selection", "visible-audit"]},
                "coverage": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "decisionDates",
                        "assetObservations",
                        "scoreAvailableObservations",
                        "directionalIntentObservations",
                        "flatIntentObservations",
                        "contextOnlyObservations",
                        "equalIntentActiveDates",
                        "rawTargetActiveDates",
                        "riskLimitedDates",
                        "targetExecutionMismatchDates",
                        "noTradeRetentionDates",
                        "rebalancedDates",
                    ],
                    "properties": {
                        "decisionDates": {"type": "integer", "minimum": 1},
                        "assetObservations": {
                            "type": "integer",
                            "minimum": 1,
                        },
                        "scoreAvailableObservations": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "directionalIntentObservations": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "flatIntentObservations": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "contextOnlyObservations": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "equalIntentActiveDates": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "rawTargetActiveDates": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "riskLimitedDates": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "targetExecutionMismatchDates": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "noTradeRetentionDates": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "rebalancedDates": {
                            "type": "integer",
                            "minimum": 0,
                        },
                    },
                },
                "stages": {
                    "type": "array",
                    "minItems": 5,
                    "maxItems": 5,
                    "items": {"$ref": "#/$defs/monetizationStage"},
                },
                "deltas": {
                    "type": "array",
                    "minItems": 4,
                    "maxItems": 4,
                    "items": {"$ref": "#/$defs/monetizationDelta"},
                },
                "byAsset": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_UNIVERSE,
                    "items": {"$ref": "#/$defs/monetizationAsset"},
                },
                "reconciliation": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "passed",
                        "tolerance",
                        "relativeValueIntentTargetParityApplicable",
                        "maximumGrossFormulaError",
                        "maximumNetFormulaError",
                        "maximumDailyGrossError",
                        "maximumDailyCostError",
                        "maximumDailyNetError",
                        "maximumEqualIntentGrossLimitExcess",
                        "maximumEqualIntentCapExcess",
                        "maximumContextIntentExposure",
                        "maximumRelativeValueIntentTargetError",
                    ],
                    "properties": {
                        "passed": {"const": True},
                        "tolerance": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                        },
                        "relativeValueIntentTargetParityApplicable": {
                            "type": "boolean"
                        },
                        "maximumGrossFormulaError": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumNetFormulaError": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumDailyGrossError": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumDailyCostError": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumDailyNetError": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumEqualIntentGrossLimitExcess": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumEqualIntentCapExcess": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumContextIntentExposure": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumRelativeValueIntentTargetError": {
                            "type": "number",
                            "minimum": 0,
                        },
                    },
                },
            },
        },
    },
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "run",
        "universe",
        "predictionUniverse",
        "mandate",
        "researchHorizon",
        "decisionCadence",
        "selection",
        "artifacts",
        "path",
        "currentBook",
        "mechanicalDecision",
        "sizingAnatomy",
        "diversificationStress",
        "strategyViability",
        "signalMonetization",
        "translationRobustness",
        "recentTransitions",
        "signalPolicy",
        "riskGovernor",
        "executedBookRisk",
        "liquidityCapacity",
        "positionLifecycle",
        "parameterNeighborhood",
        "attribution",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": PORTFOLIO_DIAGNOSTICS_KIND},
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
        "run": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "studyId",
                "status",
                "startedAt",
                "inputHash",
                "datasetHash",
                "primaryMetric",
                "primaryValue",
            ],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "studyId": {"type": "string", "minLength": 1},
                "status": {"const": "succeeded"},
                "startedAt": {"type": "string", "format": "date-time"},
                "inputHash": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
                "datasetHash": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
                "primaryMetric": {"type": "string", "minLength": 1},
                "primaryValue": {"type": "number"},
            },
        },
        "universe": {
            "type": "array",
            "minItems": 1,
            "maxItems": MAX_UNIVERSE,
            "items": {"type": "string", "minLength": 1},
            "uniqueItems": True,
        },
        "predictionUniverse": {
            "type": "object",
            "additionalProperties": False,
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
            "properties": {
                "id": {
                    "type": "string",
                    "pattern": "^factor-population-[0-9a-f]{16}$",
                },
                "claim": {
                    "enum": [
                        "decision-signal",
                        "novel-factor",
                        "known-style-validation",
                    ]
                },
                "outcome": {
                    "enum": [
                        "forward-return",
                        "forward-realized-volatility",
                    ]
                },
                "authority": {
                    "enum": [
                        "caller-factor-policy-prediction-assets",
                        "factor-claim-complete-research-universe",
                    ]
                },
                "evaluationMode": {
                    "enum": [
                        "cross-sectional",
                        "single-asset-temporal",
                        "two-asset-relative-value",
                    ]
                },
                "researchAssets": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_UNIVERSE,
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                },
                "predictionAssets": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_UNIVERSE,
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                },
                "contextAssets": {
                    "type": "array",
                    "maxItems": MAX_UNIVERSE,
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                },
                "assetPredictionRoles": {
                    "type": "object",
                    "additionalProperties": {
                        "enum": [
                            "prediction",
                            "context-only",
                        ]
                    },
                },
                "relativeValuePair": {
                    "oneOf": [
                        {"type": "null"},
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "left_asset",
                                "right_asset",
                                "factor_contrast",
                                "target_contrast",
                                "portfolio_construction_authority",
                            ],
                            "properties": {
                                "left_asset": {
                                    "type": "string",
                                    "minLength": 1,
                                },
                                "right_asset": {
                                    "type": "string",
                                    "minLength": 1,
                                },
                                "factor_contrast": {
                                    "const": "factor(left_asset)-factor(right_asset)"
                                },
                                "target_contrast": {
                                    "const": "forward_return(left_asset)-forward_return(right_asset)"
                                },
                                "portfolio_construction_authority": {
                                    "const": "none"
                                },
                            },
                        },
                    ]
                },
                "evaluationAuthority": {
                    "const": "factor-evaluation-only"
                },
                "portfolioAuthority": {"const": "none"},
                "tradingAuthority": {"const": "none"},
            },
        },
        "mandate": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "available",
                "id",
                "sha256",
                "sourceKind",
                "policySource",
                "requestHash",
                "direction",
                "family",
                "positionRolesSource",
                "researchUniverse",
                "tradableAssets",
                "contextAssets",
                "grossLimit",
                "maxAbsWeight",
                "assetMaxAbsWeights",
                "assetPositionRoles",
                "longGrossLimit",
                "shortGrossLimit",
                "cashAllowed",
                "shortAllowed",
                "benchmark",
                "riskPolicy",
                "implementationPolicy",
            ],
            "properties": {
                "available": {"type": "boolean"},
                "id": {
                    "anyOf": [
                        {"type": "null"},
                        {
                            "type": "string",
                            "pattern": "^mandate-[0-9a-f]{16}$",
                        },
                    ]
                },
                "sha256": {
                    "anyOf": [
                        {"type": "null"},
                        {
                            "type": "string",
                            "pattern": "^[0-9a-f]{64}$",
                        },
                    ]
                },
                "sourceKind": {
                    "enum": [
                        "legacy-implicit",
                        "research-request",
                        "template-default",
                    ]
                },
                "policySource": {
                    "enum": [
                        "legacy-implicit",
                        "caller-supplied",
                        "reference-default",
                    ]
                },
                "requestHash": {
                    "anyOf": [
                        {"type": "null"},
                        {
                            "type": "string",
                            "pattern": "^[0-9a-f]{64}$",
                        },
                    ]
                },
                "direction": {
                    "enum": [
                        "long",
                        "short",
                        "long-short",
                        "relative-value",
                        "research-only",
                    ]
                },
                "family": {
                    "enum": [
                        "dollar-neutral",
                        "long-cash",
                        "short-cash",
                        "asset-role",
                    ]
                },
                "positionRolesSource": {
                    "enum": [
                        "legacy-implicit",
                        "caller-supplied",
                        "direction-derived",
                    ]
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
                "grossLimit": {"type": "number", "exclusiveMinimum": 0},
                "maxAbsWeight": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                },
                "assetMaxAbsWeights": {
                    "type": "object",
                    "minProperties": 1,
                    "maxProperties": MAX_UNIVERSE,
                    "additionalProperties": {
                        "type": "number",
                        "minimum": 0,
                    },
                },
                "assetPositionRoles": {
                    "type": "object",
                    "minProperties": 1,
                    "maxProperties": MAX_UNIVERSE,
                    "additionalProperties": {
                        "enum": [
                            "long-only",
                            "short-only",
                            "two-sided",
                            "context-only",
                        ]
                    },
                },
                "longGrossLimit": {"type": "number", "minimum": 0},
                "shortGrossLimit": {"type": "number", "minimum": 0},
                "cashAllowed": {"type": "boolean"},
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
                        "kind": {
                            "enum": [
                                "cash",
                                "equal-weight-long-research-universe",
                                "equal-weight-long-tradable",
                                "equal-weight-short-tradable",
                                "equal-weight-long-capable",
                                "equal-weight-short-capable",
                                "single-asset-long",
                            ]
                        },
                        "asset": {
                            "anyOf": [
                                {"type": "null"},
                                {"type": "string", "minLength": 1},
                            ]
                        },
                        "weights": {
                            "type": "object",
                            "minProperties": 1,
                            "maxProperties": MAX_UNIVERSE,
                            "additionalProperties": {
                                "type": "number",
                                "minimum": -1,
                                "maximum": 1,
                            },
                        },
                    },
                },
                "riskPolicy": {
                    "anyOf": [
                        {"type": "null"},
                        {
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
                                "method": {"type": "string", "minLength": 1},
                                "annualizedVolatilityCeiling": {
                                    "type": "number",
                                    "exclusiveMinimum": 0,
                                },
                                "covarianceWindow": {
                                    "type": "integer",
                                    "minimum": 2,
                                },
                                "minimumObservations": {
                                    "type": "integer",
                                    "minimum": 2,
                                },
                                "annualizationPeriods": {
                                    "type": "integer",
                                    "minimum": 1,
                                },
                                "scaleUp": {"const": False},
                            },
                        },
                    ]
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
                        },
                        "noTradeOneWay": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "referenceNav": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                        },
                        "decisionPolicy": {
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
                        "costModel": {
                            "const": "linear-traded-notional-v1"
                        },
                        "capacityModel": {
                            "const": (
                                "trailing-dollar-volume-participation-v1"
                            )
                        },
                    },
                },
            },
        },
        "selection": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "selectionSplit",
                "testRole",
                "testEntersSelection",
                "externalHoldoutRule",
                "splits",
            ],
            "properties": {
                "selectionSplit": {"const": "validation"},
                "testRole": {"type": "string", "minLength": 1},
                "testEntersSelection": {"const": False},
                "externalHoldoutRule": {"type": "string", "minLength": 1},
                "splits": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["train", "validation", "test"],
                    "properties": {
                        "train": {"$ref": "#/$defs/split"},
                        "validation": {"$ref": "#/$defs/split"},
                        "test": {"$ref": "#/$defs/split"},
                    },
                },
            },
        },
        "artifacts": {
            "type": "object",
            "additionalProperties": False,
            "required": sorted(BASE_ARTIFACT_KINDS),
            "properties": {
                kind: {"$ref": "#/$defs/artifact"}
                for kind in sorted(EXPECTED_ARTIFACT_KINDS)
            },
        },
        "path": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "totalRows",
                "sampledRows",
                "pointLimit",
                "sampling",
                "summary",
                "points",
            ],
            "properties": {
                "totalRows": {"type": "integer", "minimum": 1},
                "sampledRows": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_PORTFOLIO_POINTS,
                },
                "pointLimit": {
                    "type": "integer",
                    "minimum": MIN_PORTFOLIO_POINTS,
                    "maximum": MAX_PORTFOLIO_POINTS,
                },
                "sampling": {
                    "const": "deterministic-even-with-accounting-anchors"
                },
                "summary": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "netTotalReturn",
                        "grossTotalReturn",
                        "benchmarkTotalReturn",
                        "maximumDrawdown",
                        "maximumDrawdownAt",
                        "totalOneWayTurnover",
                        "maximumOneWayTurnover",
                        "maximumOneWayTurnoverAt",
                        "totalCost",
                        "rebalanceDays",
                    ],
                    "properties": {
                        "netTotalReturn": {"type": "number"},
                        "grossTotalReturn": {"type": "number"},
                        "benchmarkTotalReturn": {"type": "number"},
                        "maximumDrawdown": {"type": "number"},
                        "maximumDrawdownAt": TIMESTAMP_JSON_SCHEMA,
                        "totalOneWayTurnover": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumOneWayTurnover": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "maximumOneWayTurnoverAt": TIMESTAMP_JSON_SCHEMA,
                        "totalCost": {"type": "number", "minimum": 0},
                        "rebalanceDays": {"type": "integer", "minimum": 0},
                    },
                },
                "points": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_PORTFOLIO_POINTS,
                    "items": {"$ref": "#/$defs/pathPoint"},
                },
            },
        },
        "currentBook": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "timestamp",
                "historicalResearchWeights",
                "grossExposure",
                "netExposure",
                "cashWeight",
                "oneWayTurnover",
                "cost",
                "rebalanced",
                "executionRiskStatus",
                "executionRiskForecastAvailable",
                "pretradeRiskForecastAnnualized",
                "executedRiskForecastAnnualized",
                "executionRiskCeilingAnnualized",
                "riskRebalanceOverride",
                "executionReason",
                "riskGovernorStatus",
                "riskGovernorScale",
                "riskForecastPreAnnualized",
                "riskForecastPostAnnualized",
                "riskVolatilityCeilingAnnualized",
                "riskEstimationObservations",
                "positions",
            ],
            "properties": {
                "timestamp": TIMESTAMP_JSON_SCHEMA,
                "historicalResearchWeights": {"const": True},
                "grossExposure": {"type": "number", "minimum": 0},
                "netExposure": {"type": "number"},
                "cashWeight": {"type": "number"},
                "oneWayTurnover": {"type": "number", "minimum": 0},
                "cost": {"type": "number", "minimum": 0},
                "rebalanced": {"type": "boolean"},
                "executionRiskStatus": {
                    "type": "string",
                    "minLength": 1,
                },
                "executionRiskForecastAvailable": {
                    "type": "boolean"
                },
                "pretradeRiskForecastAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "executedRiskForecastAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "executionRiskCeilingAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "riskRebalanceOverride": {"type": "boolean"},
                "executionReason": {
                    "type": "string",
                    "minLength": 1,
                },
                "riskGovernorStatus": {
                    "type": "string",
                    "minLength": 1,
                },
                "riskGovernorScale": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "riskForecastPreAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "riskForecastPostAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "riskVolatilityCeilingAnnualized": {
                    "type": "number",
                    "minimum": 0,
                },
                "riskEstimationObservations": {
                    "type": "integer",
                    "minimum": 0,
                },
                "positions": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_UNIVERSE,
                    "items": {"$ref": "#/$defs/position"},
                },
            },
        },
        "mechanicalDecision": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "timestamp",
                "authority",
                "tradingAuthority",
                "distanceSemantics",
                "signalGate",
                "targetGate",
                "executionGate",
                "positions",
            ],
            "properties": {
                "method": {"const": MECHANICAL_DECISION_METHOD},
                "timestamp": TIMESTAMP_JSON_SCHEMA,
                "authority": {
                    "const": "quantitative-decision-support"
                },
                "tradingAuthority": {"const": "none"},
                "distanceSemantics": {
                    "const": PERCENTILE_DISTANCE_SEMANTICS
                },
                "signalGate": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "family",
                        "stateChanges",
                        "unavailableScores",
                        "contextAssets",
                        "longEntryPercentile",
                        "longExitPercentile",
                        "shortExitPercentile",
                        "shortEntryPercentile",
                    ],
                    "properties": {
                        "family": {
                            "enum": [
                                "dollar-neutral",
                                "long-cash",
                                "short-cash",
                                "asset-role",
                            ]
                        },
                        "stateChanges": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "unavailableScores": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "contextAssets": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "longEntryPercentile": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "longExitPercentile": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "shortExitPercentile": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "shortEntryPercentile": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                    },
                },
                "targetGate": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "preGovernorGross",
                        "governedTargetGross",
                        "pretradeGross",
                        "riskGovernorStatus",
                        "riskGovernorScale",
                        "riskLimited",
                    ],
                    "properties": {
                        "preGovernorGross": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "governedTargetGross": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "pretradeGross": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "riskGovernorStatus": {
                            "type": "string",
                            "minLength": 1,
                        },
                        "riskGovernorScale": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "riskLimited": {"type": "boolean"},
                    },
                },
                "executionGate": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "available",
                        "decisionEligible",
                        "decisionSchedule",
                        "decisionSession",
                        "decisionSource",
                        "noTradeOneWay",
                        "proposedOneWayTurnover",
                        "bandShortfall",
                        "bandExcess",
                        "ordinaryRebalance",
                        "riskOverride",
                        "rebalanced",
                        "finalOneWayTurnover",
                        "executedGross",
                        "reason",
                        "status",
                    ],
                    "properties": {
                        "available": {"type": "boolean"},
                        "decisionEligible": {"type": "boolean"},
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
                                    "required": ["kind"],
                                    "properties": {
                                        "kind": {
                                            "const": "calendar-month-end"
                                        }
                                    },
                                },
                            ]
                        },
                        "decisionSession": {
                            "type": "string",
                            "minLength": 1,
                        },
                        "decisionSource": {
                            "enum": [
                                "caller-supplied",
                                "reference-default",
                            ]
                        },
                        "noTradeOneWay": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "proposedOneWayTurnover": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "bandShortfall": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "bandExcess": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "ordinaryRebalance": {
                            "type": ["boolean", "null"]
                        },
                        "riskOverride": {
                            "type": ["boolean", "null"]
                        },
                        "rebalanced": {"type": "boolean"},
                        "finalOneWayTurnover": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "executedGross": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "reason": {
                            "type": "string",
                            "minLength": 1,
                        },
                        "status": {
                            "type": "string",
                            "minLength": 1,
                        },
                    },
                },
                "positions": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_UNIVERSE,
                    "items": {"$ref": "#/$defs/mechanicalPosition"},
                },
            },
        },
        "sizingAnatomy": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "timestamp",
                "historicalResearchWeights",
                "authority",
                "tradingAuthority",
                "construction",
                "sides",
                "componentRisk",
                "positions",
            ],
            "properties": {
                "method": {"const": SIZING_ANATOMY_METHOD},
                "timestamp": TIMESTAMP_JSON_SCHEMA,
                "historicalResearchWeights": {"const": True},
                "authority": {
                    "const": "quantitative-decision-support"
                },
                "tradingAuthority": {"const": "none"},
                "construction": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "family",
                        "rule",
                        "grossLimit",
                        "maxAbsWeight",
                        "assetMaxAbsWeights",
                        "assetPositionRoles",
                        "longGrossLimit",
                        "shortGrossLimit",
                        "riskGovernorScale",
                        "rawGross",
                        "governedGross",
                        "executedGross",
                        "unfundedGross",
                    ],
                    "properties": {
                        "family": {
                            "enum": [
                                "dollar-neutral",
                                "long-cash",
                                "short-cash",
                                "asset-role",
                            ]
                        },
                        "rule": {
                            "const": (
                                "percentile-conviction-divided-by-"
                                "trailing-volatility"
                            )
                        },
                        "grossLimit": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                        },
                        "maxAbsWeight": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                        },
                        "assetMaxAbsWeights": {
                            "type": "object",
                            "minProperties": 1,
                            "maxProperties": MAX_UNIVERSE,
                            "additionalProperties": {
                                "type": "number",
                                "minimum": 0,
                            },
                        },
                        "assetPositionRoles": {
                            "type": "object",
                            "minProperties": 1,
                            "maxProperties": MAX_UNIVERSE,
                            "additionalProperties": {
                                "enum": [
                                    "long-only",
                                    "short-only",
                                    "two-sided",
                                    "context-only",
                                ]
                            },
                        },
                        "longGrossLimit": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "shortGrossLimit": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "riskGovernorScale": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "rawGross": {"type": "number", "minimum": 0},
                        "governedGross": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "executedGross": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "unfundedGross": {
                            "type": "number",
                            "minimum": 0,
                        },
                    },
                },
                "sides": {
                    "type": "array",
                    "minItems": 2,
                    "maxItems": 2,
                    "prefixItems": [
                        {"$ref": "#/$defs/sizingSide"},
                        {"$ref": "#/$defs/sizingSide"},
                    ],
                    "items": False,
                },
                "componentRisk": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "available",
                        "shareSum",
                        "absoluteConcentrationHhi",
                        "largestAbsoluteContributor",
                    ],
                    "properties": {
                        "available": {"type": "boolean"},
                        "shareSum": {"type": "number"},
                        "absoluteConcentrationHhi": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "largestAbsoluteContributor": {
                            "type": ["string", "null"]
                        },
                    },
                },
                "positions": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_UNIVERSE,
                    "items": {"$ref": "#/$defs/sizingPosition"},
                },
            },
        },
        "diversificationStress": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "available",
                "authority",
                "selectionAuthority",
                "testEntersSelection",
                "tradingAuthority",
                "shock",
                "current",
                "validation",
                "test",
            ],
            "properties": {
                "method": {"const": DIVERSIFICATION_STRESS_METHOD},
                "available": {"type": "boolean"},
                "authority": {"const": "context-only"},
                "selectionAuthority": {"const": "none"},
                "testEntersSelection": {"const": False},
                "tradingAuthority": {"const": "none"},
                "shock": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "method",
                        "pairwiseCorrelationMagnitude",
                        "positionSignsAlignRisk",
                        "annualizationPeriods",
                        "covarianceWindow",
                        "minimumObservations",
                        "ceilingAnnualized",
                        "probabilityAssigned",
                        "scenarios",
                    ],
                    "properties": {
                        "method": {
                            "const": DIVERSIFICATION_SHOCK_METHOD
                        },
                        "pairwiseCorrelationMagnitude": {
                            "const": 1.0
                        },
                        "positionSignsAlignRisk": {"const": True},
                        "annualizationPeriods": {
                            "type": "integer",
                            "minimum": 1,
                        },
                        "covarianceWindow": {
                            "type": "integer",
                            "minimum": 2,
                        },
                        "minimumObservations": {
                            "type": "integer",
                            "minimum": 2,
                        },
                        "ceilingAnnualized": {
                            "type": ["number", "null"],
                            "exclusiveMinimum": 0,
                        },
                        "probabilityAssigned": {"const": False},
                        "scenarios": {
                            "type": "array",
                            "minItems": 3,
                            "maxItems": 3,
                            "items": {
                                "$ref": (
                                    "#/$defs/"
                                    "diversificationScenarioDefinition"
                                )
                            },
                        },
                    },
                },
                "current": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "timestamp",
                        "state",
                        "activeAssets",
                        "covarianceObservations",
                        "sampleForecastAnnualized",
                        "perfectCorrelationForecastAnnualized",
                        "stressMultiplier",
                        "ceilingAnnualized",
                        "stressBreachesCeiling",
                        "absoluteComponentRiskHhi",
                        "effectiveRiskBets",
                        "largestAbsoluteComponentRiskContributor",
                        "scenarios",
                        "positions",
                    ],
                    "properties": {
                        "timestamp": TIMESTAMP_JSON_SCHEMA,
                        "state": {
                            "enum": [
                                "available",
                                "flat",
                                "risk-history-unavailable",
                            ]
                        },
                        "activeAssets": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "covarianceObservations": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "sampleForecastAnnualized": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "perfectCorrelationForecastAnnualized": {
                            "type": "number",
                            "minimum": 0,
                        },
                        "stressMultiplier": {
                            "type": ["number", "null"],
                            "minimum": 1,
                        },
                        "ceilingAnnualized": {
                            "type": ["number", "null"],
                            "exclusiveMinimum": 0,
                        },
                        "stressBreachesCeiling": {
                            "type": ["boolean", "null"]
                        },
                        "absoluteComponentRiskHhi": {
                            "type": ["number", "null"],
                            "exclusiveMinimum": 0,
                            "maximum": 1,
                        },
                        "effectiveRiskBets": {
                            "type": ["number", "null"],
                            "minimum": 1,
                            "maximum": MAX_UNIVERSE,
                        },
                        "largestAbsoluteComponentRiskContributor": {
                            "type": ["string", "null"]
                        },
                        "scenarios": {
                            "type": "array",
                            "minItems": 3,
                            "maxItems": 3,
                            "items": {
                                "$ref": (
                                    "#/$defs/"
                                    "diversificationScenarioEvidence"
                                )
                            },
                        },
                        "positions": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": MAX_UNIVERSE,
                            "items": {
                                "$ref": "#/$defs/diversificationPosition"
                            },
                        },
                    },
                },
                "validation": {
                    "$ref": "#/$defs/diversificationSplit"
                },
                "test": {"$ref": "#/$defs/diversificationSplit"},
            },
        },
        "strategyViability": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "authority",
                "tradingAuthority",
                "diagnosis",
                "validation",
                "test",
            ],
            "properties": {
                "method": {"const": STRATEGY_VIABILITY_METHOD},
                "authority": {
                    "const": "research-prioritization-only"
                },
                "tradingAuthority": {"const": "none"},
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
                                "factor-edge-absent",
                                "factor-not-monetized",
                                "cost-fragile",
                                "post-cost-edge-positive",
                            ]
                        },
                        "iterationFocus": {
                            "enum": [
                                "factor-signal",
                                "signal-to-portfolio",
                                "turnover-and-execution",
                                "robustness-capacity-and-external-holdout",
                            ]
                        },
                        "explanation": {
                            "type": "string",
                            "minLength": 1,
                        },
                    },
                },
                "validation": {"$ref": "#/$defs/viabilitySplit"},
                "test": {"$ref": "#/$defs/viabilitySplit"},
            },
        },
        "signalMonetization": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "authority",
                "tradingAuthority",
                "semantics",
                "diagnosis",
                "validation",
                "test",
            ],
            "properties": {
                "method": {"const": SIGNAL_MONETIZATION_METHOD},
                "authority": {
                    "const": "research-prioritization-only"
                },
                "tradingAuthority": {"const": "none"},
                "semantics": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "contribution",
                        "evaluationMode",
                        "intentConstruction",
                        "equalIntent",
                        "counterfactualCompounding",
                        "entersSelection",
                    ],
                    "properties": {
                        "contribution": {
                            "const": (
                                "additive-weight-times-next-bar-return"
                            )
                        },
                        "evaluationMode": {
                            "enum": [
                                "cross-sectional",
                                "single-asset-temporal",
                                "two-asset-relative-value",
                            ]
                        },
                        "intentConstruction": {
                            "enum": [
                                "mandate-equal-active-side-budget",
                                "capped-complementary-relative-value-pair",
                            ]
                        },
                        "equalIntent": {
                            "const": (
                                "prediction-mode-aware-mandate-constrained-"
                                "signal-state-diagnostic"
                            )
                        },
                        "counterfactualCompounding": {"const": False},
                        "entersSelection": {"const": False},
                    },
                },
                "diagnosis": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "selectionSplit",
                        "testEntersDiagnosis",
                        "outcome",
                        "iterationFocus",
                        "largestAdverseStage",
                        "largestAdverseAnnualizedDelta",
                        "explanation",
                    ],
                    "properties": {
                        "selectionSplit": {"const": "validation"},
                        "testEntersDiagnosis": {"const": False},
                        "outcome": {
                            "enum": [
                                "signal-intent-negative",
                                "transmission-destroyed-edge",
                                "monetized-positive",
                            ]
                        },
                        "iterationFocus": {
                            "enum": [
                                "signal-direction-and-thresholds",
                                "sizing-and-caps",
                                "risk-governor",
                                "execution-and-no-trade",
                                "turnover-and-cost",
                                "robustness-and-external-holdout",
                            ]
                        },
                        "largestAdverseStage": {
                            "enum": [
                                "sizingAndCaps",
                                "riskGovernor",
                                "executionRetention",
                                "tradingCost",
                            ]
                        },
                        "largestAdverseAnnualizedDelta": {
                            "type": "number"
                        },
                        "explanation": {
                            "type": "string",
                            "minLength": 1,
                        },
                    },
                },
                "validation": {"$ref": "#/$defs/monetizationSplit"},
                "test": {"$ref": "#/$defs/monetizationSplit"},
            },
        },
        "translationRobustness": {"type": "object"},
        "recentTransitions": {
            "type": "array",
            "maxItems": MAX_RECENT_TRANSITIONS,
            "items": {"$ref": "#/$defs/transition"},
        },
        "signalPolicy": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "translation",
                "parameters",
                "validation",
                "test",
            ],
            "properties": {
                "translation": {
                    "type": "object",
                    "additionalProperties": False,
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
                    "properties": {
                        "method": {"const": SIGNAL_TRANSLATION_METHOD},
                        "evaluationMode": {
                            "enum": [
                                "cross-sectional",
                                "single-asset-temporal",
                                "two-asset-relative-value",
                            ]
                        },
                        "predictionAssets": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": MAX_UNIVERSE,
                            "items": {"type": "string", "minLength": 1},
                            "uniqueItems": True,
                        },
                        "contextAssets": {
                            "type": "array",
                            "maxItems": MAX_UNIVERSE,
                            "items": {"type": "string", "minLength": 1},
                            "uniqueItems": True,
                        },
                        "authority": {
                            "enum": [
                                "factor-claim-complete-research-universe",
                                "caller-factor-policy-prediction-assets",
                            ]
                        },
                        "scoreBasis": {
                            "enum": [
                                "same-timestamp-prediction-population",
                                "causal-own-factor-history",
                                "causal-ordered-factor-spread-history",
                            ]
                        },
                        "windowObservations": {
                            "oneOf": [
                                {"type": "null"},
                                {"type": "integer", "minimum": 1},
                            ]
                        },
                        "minimumObservations": {
                            "type": "integer",
                            "minimum": 1,
                        },
                        "relativeValuePair": {
                            "oneOf": [
                                {"type": "null"},
                                {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": [
                                        "left_asset",
                                        "right_asset",
                                        "factor_contrast",
                                        "target_contrast",
                                        "portfolio_construction_authority",
                                    ],
                                    "properties": {
                                        "left_asset": {
                                            "type": "string",
                                            "minLength": 1,
                                        },
                                        "right_asset": {
                                            "type": "string",
                                            "minLength": 1,
                                        },
                                        "factor_contrast": {
                                            "type": "string",
                                            "minLength": 1,
                                        },
                                        "target_contrast": {
                                            "type": "string",
                                            "minLength": 1,
                                        },
                                        "portfolio_construction_authority": {
                                            "const": "none"
                                        },
                                    },
                                },
                            ]
                        },
                        "contextScore": {
                            "const": "unavailable-never-ranked"
                        },
                        "selectionAuthority": {
                            "const": "fixed-mechanical-translation"
                        },
                        "tradingAuthority": {"const": "none"},
                    },
                },
                "parameters": {"type": "object"},
                "validation": {"type": "object"},
                "test": {"type": "object"},
            },
        },
        "riskGovernor": {"type": "object"},
        "executedBookRisk": {"type": "object"},
        "liquidityCapacity": {"type": "object"},
        "positionLifecycle": {"type": "object"},
        "parameterNeighborhood": {"type": "object"},
        "attribution": {
            "type": "object",
            "additionalProperties": False,
            "required": ["validation", "test"],
            "properties": {
                "validation": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_UNIVERSE,
                    "items": {"$ref": "#/$defs/attributionRow"},
                },
                "test": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_UNIVERSE,
                    "items": {"$ref": "#/$defs/attributionRow"},
                },
            },
        },
    },
}
