"""Bounded, verified diagnostics for immutable Factor Runs."""

from __future__ import annotations

import csv
import json
import math
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .factor_claims import (
    FACTOR_CLAIM_JSON_SCHEMA,
    FORWARD_RETURN_OUTCOME,
    factor_outcome,
    factor_outcome_contract,
    validate_factor_claim,
)
from .horizons import (
    RESEARCH_HORIZON,
    RESEARCH_HORIZON_JSON_SCHEMA,
    validate_research_horizon,
)
from .intervals import timestamp_label
from .prediction_modes import (
    PredictionModeError,
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


FACTOR_DIAGNOSTICS_KIND = "autoquant-factor-diagnostics"
DEFAULT_FACTOR_POINTS = 180
MIN_FACTOR_POINTS = 40
MAX_FACTOR_POINTS = 400
MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
MAX_COMPONENT_ARTIFACT_BYTES = 8 * 1024 * 1024
MAX_DAILY_ROWS = 100_000
MAX_QUANTILE_ROWS = 300_000
MAX_UNIVERSE = 256
HORIZONS = (1, 5, 10)
PRIMARY_HORIZON = 1
SPLITS = ("train", "validation", "test")
SPLIT_ROLES = {
    "train": "training",
    "validation": "selection",
    "test": "visible-audit",
}
REGIMES = {
    "up-calm",
    "up-stressed",
    "down-calm",
    "down-stressed",
    "unavailable",
}
STYLES = {
    "momentum_20",
    "reversal_5",
    "realized_volatility_20",
    "relative_volume_20",
}
BASE_ARTIFACT_KINDS = {
    "factor-report",
    "factor-daily",
    "factor-quantiles",
}
QUALIFICATION_ARTIFACT_KIND = "factor-qualification"
COMPONENT_ARTIFACT_KIND = "factor-components"
EXPECTED_ARTIFACT_KINDS = {
    *BASE_ARTIFACT_KINDS,
    QUALIFICATION_ARTIFACT_KIND,
    COMPONENT_ARTIFACT_KIND,
    "factor-availability",
}
AVAILABILITY_ARTIFACT_KIND = "factor-availability"
QUALIFICATION_METHOD = "request-claim-aware-one-style-rank-neutralization-v2"
TEMPORAL_QUALIFICATION_METHOD = (
    "request-claim-aware-one-style-temporal-neutralization-v1"
)
QUALIFICATION_METHODS = {
    QUALIFICATION_METHOD,
    TEMPORAL_QUALIFICATION_METHOD,
}
CROSS_SECTIONAL_MODE = "cross-sectional"
SINGLE_ASSET_TEMPORAL_MODE = "single-asset-temporal"
TWO_ASSET_RELATIVE_VALUE_MODE = "two-asset-relative-value"
TEMPORAL_EVALUATION_MODES = {
    SINGLE_ASSET_TEMPORAL_MODE,
    TWO_ASSET_RELATIVE_VALUE_MODE,
}
COMPONENT_METHOD = "candidate-declared-components-v3"
MAX_COMPONENTS = 12
QUALIFICATION_MIN_POSITIVE_HAC_T = 1.96
QUALIFICATION_SIGNALS = (
    "candidate",
    "dominant_style",
    "style_neutral_candidate",
    "equal_rank_blend",
)
DAILY_COLUMNS = [
    "timestamp",
    "split",
    "regime",
    *[
        f"{measure}_ic_h{horizon}"
        for horizon in HORIZONS
        for measure in ("rank", "pearson")
    ],
]
QUANTILE_COLUMNS = [
    "timestamp",
    "split",
    "horizon",
    "low",
    "middle",
    "high",
    "high_minus_low",
]
QUALIFICATION_COLUMNS = [
    "timestamp",
    "split",
    "dominant_style",
    *[
        f"{signal}_rank_ic_h{horizon}"
        for horizon in HORIZONS
        for signal in QUALIFICATION_SIGNALS
    ],
]
AVAILABILITY_COLUMNS = [
    "timestamp",
    "input_assets",
    "factor_assets",
    *[f"paired_assets_h{horizon}" for horizon in HORIZONS],
]
_HORIZON_CONFIGURATION_LOCK = threading.RLock()


def _configure_horizons(
    run: RunContext,
    report: dict[str, Any],
) -> dict[str, Any]:
    """Bind module-local artifact parsers to this immutable Run policy."""

    global HORIZONS, PRIMARY_HORIZON, DAILY_COLUMNS
    global QUALIFICATION_COLUMNS, AVAILABILITY_COLUMNS
    raw = run.result["metrics"].get("research_horizon")
    report_raw = report.get("researchHorizon")
    if not isinstance(raw, dict) or report_raw != raw:
        _fail(
            "RunResult/metrics/research_horizon",
            "factor.research-horizon",
            "Factor Run and report must contain one identical Horizon Mandate",
        )
    try:
        horizon = validate_research_horizon(
            raw,
            "RunResult/metrics/research_horizon",
        )
    except AutoQuantValidationError:
        raise
    dependencies = run.result.get("dependencies")
    if (
        not isinstance(dependencies, dict)
        or RESEARCH_HORIZON not in dependencies.get("paths", [])
        or RESEARCH_HORIZON
        not in dependencies.get("sourceHashes", {})
    ):
        _fail(
            "RunResult/dependencies",
            "factor.research-horizon-dependency",
            "Factor Run does not bind its fixed Horizon Mandate",
        )
    HORIZONS = tuple(horizon["diagnosticForwardBars"])
    PRIMARY_HORIZON = int(horizon["primaryForwardBars"])
    DAILY_COLUMNS = [
        "timestamp",
        "split",
        "regime",
        *[
            f"{measure}_ic_h{item}"
            for item in HORIZONS
            for measure in ("rank", "pearson")
        ],
    ]
    QUALIFICATION_COLUMNS = [
        "timestamp",
        "split",
        "dominant_style",
        *[
            f"{signal}_rank_ic_h{item}"
            for item in HORIZONS
            for signal in QUALIFICATION_SIGNALS
        ],
    ]
    AVAILABILITY_COLUMNS = [
        "timestamp",
        "input_assets",
        "factor_assets",
        *[f"paired_assets_h{item}" for item in HORIZONS],
    ]
    return horizon


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _fail(path: Path | str, code: str, message: str) -> None:
    raise AutoQuantValidationError([_issue(path, code, message)])


def _finite(value: Any, path: Path | str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        _fail(path, "factor.number", "Expected a finite numeric value")
    if not math.isfinite(number):
        _fail(path, "factor.number", "Expected a finite numeric value")
    return number


def _optional_finite(value: Any, path: Path | str) -> float | None:
    if value is None or value == "":
        return None
    return _finite(value, path)


def _bounded(
    value: Any,
    path: Path | str,
    *,
    minimum: float,
    maximum: float,
) -> float:
    number = _finite(value, path)
    if number < minimum - 1e-12 or number > maximum + 1e-12:
        _fail(
            path,
            "factor.bound",
            f"Expected a value from {minimum} through {maximum}",
        )
    return number


def _integer(value: Any, path: Path | str, *, minimum: int = 0) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < minimum
    ):
        _fail(path, "factor.integer", f"Expected an integer >= {minimum}")
    return value


def _session_date(value: Any, path: Path | str) -> str:
    if not isinstance(value, str):
        _fail(
            path,
            "factor.timestamp",
            "Timestamp must be an ISO date or UTC date-time",
        )
    try:
        normalized = timestamp_label(value)
    except (TypeError, ValueError):
        _fail(
            path,
            "factor.timestamp",
            "Timestamp must be an ISO date or UTC date-time",
        )
    if normalized != value:
        _fail(
            path,
            "factor.timestamp",
            "Timestamp must be a canonical ISO date or UTC date-time",
        )
    return value


def _close(
    actual: float | None,
    expected: Any,
    path: Path | str,
    label: str,
) -> None:
    if expected is None:
        if actual is not None:
            _fail(path, "factor.reconciliation", f"{label} must be null")
        return
    expected_number = _finite(expected, path)
    if actual is None or not math.isclose(
        actual,
        expected_number,
        rel_tol=1e-9,
        abs_tol=1e-10,
    ):
        _fail(
            path,
            "factor.reconciliation",
            f"Artifact does not reconcile {label}",
        )


def _artifact_paths(
    run: RunContext,
) -> tuple[dict[str, Path], dict[str, dict[str, str]]]:
    if run.result["status"] != "succeeded":
        _fail(
            run.root_dir,
            "factor.run-status",
            "Factor diagnostics require a successful immutable Run",
        )
    artifacts = run.result.get("artifacts")
    if not isinstance(artifacts, list):
        _fail(run.root_dir, "factor.artifacts", "Run artifacts must be an array")
    paths: dict[str, Path] = {}
    identities: dict[str, dict[str, str]] = {}
    for index, artifact in enumerate(artifacts):
        artifact_path = f"{run.root_dir}/result.json/artifacts/{index}"
        if not isinstance(artifact, dict):
            _fail(artifact_path, "factor.artifact", "Artifact must be an object")
        kind = artifact.get("kind")
        if kind not in EXPECTED_ARTIFACT_KINDS:
            continue
        if kind in paths:
            _fail(
                artifact_path,
                "factor.duplicate-artifact",
                f"Factor artifact kind must be unique: {kind}",
            )
        relative = artifact.get("path")
        if not isinstance(relative, str):
            _fail(
                artifact_path,
                "factor.artifact-path",
                "Factor artifact path must be a string",
            )
        path = confined_path(run.root_dir, relative, artifact_path)
        if not path.is_file():
            _fail(path, "factor.artifact-missing", f"Missing artifact: {kind}")
        if path.stat().st_size > MAX_ARTIFACT_BYTES:
            _fail(
                path,
                "factor.artifact-size",
                f"Factor artifact exceeds {MAX_ARTIFACT_BYTES} bytes",
            )
        if (
            kind == COMPONENT_ARTIFACT_KIND
            and path.stat().st_size > MAX_COMPONENT_ARTIFACT_BYTES
        ):
            _fail(
                path,
                "factor.component-artifact-size",
                "Factor component artifact exceeds "
                f"{MAX_COMPONENT_ARTIFACT_BYTES} bytes",
            )
        content_hash = run.manifest["files"].get(relative)
        if not isinstance(content_hash, str):
            _fail(
                path,
                "factor.artifact-identity",
                "Artifact is absent from immutable Run identity",
            )
        paths[kind] = path
        identities[kind] = {"path": relative, "sha256": content_hash}
    missing = BASE_ARTIFACT_KINDS - paths.keys()
    if missing:
        _fail(
            run.root_dir,
            "factor.artifacts",
            "Run does not declare the fixed Factor artifact set: "
            + ", ".join(sorted(missing)),
        )
    qualification_metrics = run.result.get("metrics", {}).get(
        "factor_qualification"
    )
    has_qualification_artifact = QUALIFICATION_ARTIFACT_KIND in paths
    if (qualification_metrics is not None) != has_qualification_artifact:
        _fail(
            run.root_dir,
            "factor.qualification-artifact",
            "Factor qualification metrics and artifact must appear together",
        )
    component_metrics = run.result.get("metrics", {}).get(
        "factor_components"
    )
    has_component_artifact = COMPONENT_ARTIFACT_KIND in paths
    if (component_metrics is not None) != has_component_artifact:
        _fail(
            run.root_dir,
            "factor.component-artifact",
            "Factor component metrics and artifact must appear together",
        )
    availability_metrics = run.result.get("metrics", {}).get(
        "input_availability"
    )
    has_availability_artifact = AVAILABILITY_ARTIFACT_KIND in paths
    if (availability_metrics is not None) != has_availability_artifact:
        _fail(
            run.root_dir,
            "factor.availability-artifact",
            "Factor input-availability metrics and artifact must appear "
            "together",
        )
    return paths, identities


def _read_csv(
    path: Path,
    *,
    columns: list[str],
    maximum_rows: int,
    allow_empty: bool = False,
) -> list[dict[str, str]]:
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != columns:
                _fail(
                    path,
                    "factor.csv-columns",
                    "CSV columns must exactly match the fixed Factor contract",
                )
            rows: list[dict[str, str]] = []
            for row_number, row in enumerate(reader, start=2):
                if None in row or any(value is None for value in row.values()):
                    _fail(
                        f"{path}:{row_number}",
                        "factor.csv-width",
                        "CSV row width must match its header",
                    )
                rows.append(row)
                if len(rows) > maximum_rows:
                    _fail(
                        path,
                        "factor.row-limit",
                        f"CSV exceeds the {maximum_rows}-row diagnostics limit",
                    )
    except UnicodeDecodeError:
        _fail(path, "factor.csv-encoding", "CSV must be UTF-8")
    if not rows and not allow_empty:
        _fail(path, "factor.csv-empty", "CSV must contain data rows")
    return rows


def _split_protocol(metrics: dict[str, Any]) -> dict[str, Any]:
    protocol = metrics.get("split_protocol")
    if not isinstance(protocol, dict):
        _fail(
            "RunResult/metrics/split_protocol",
            "factor.split-protocol",
            "Factor Run is missing its fixed split protocol",
        )
    splits = protocol.get("splits")
    horizons = protocol.get("horizons")
    if (
        not isinstance(splits, dict)
        or set(splits) != set(SPLITS)
        or not isinstance(horizons, dict)
        or set(horizons) != {str(item) for item in HORIZONS}
    ):
        _fail(
            "RunResult/metrics/split_protocol",
            "factor.split-protocol",
            "Expected the request-bound train/validation/test horizon protocol",
        )
    normalized_splits: dict[str, Any] = {}
    prior_end: str | None = None
    for split_name in SPLITS:
        raw = splits[split_name]
        if not isinstance(raw, dict):
            _fail(
                f"RunResult/metrics/split_protocol/splits/{split_name}",
                "factor.split-protocol",
                "Split protocol must be an object",
            )
        start = _session_date(raw.get("start"), f"{split_name}/start")
        end = _session_date(raw.get("end"), f"{split_name}/end")
        rows = _integer(raw.get("rows"), f"{split_name}/rows", minimum=1)
        if start > end or (prior_end is not None and start <= prior_end):
            _fail(
                f"RunResult/metrics/split_protocol/splits/{split_name}",
                "factor.split-order",
                "Factor splits must be strictly chronological",
            )
        normalized_splits[split_name] = {
            "start": start,
            "end": end,
            "rows": rows,
            "role": SPLIT_ROLES[split_name],
        }
        prior_end = end
    normalized_horizons: dict[str, Any] = {}
    for horizon in HORIZONS:
        raw_horizon = horizons[str(horizon)]
        if not isinstance(raw_horizon, dict) or set(raw_horizon) != set(SPLITS):
            _fail(
                f"RunResult/metrics/split_protocol/horizons/{horizon}",
                "factor.split-protocol",
                "Every horizon must declare all fixed splits",
            )
        normalized_horizons[str(horizon)] = {}
        for split_name in SPLITS:
            raw = raw_horizon[split_name]
            if not isinstance(raw, dict):
                _fail(
                    f"horizons/{horizon}/{split_name}",
                    "factor.split-protocol",
                    "Horizon split must be an object",
                )
            signal_start = _session_date(
                raw.get("signalStart"),
                f"horizons/{horizon}/{split_name}/signalStart",
            )
            signal_end = _session_date(
                raw.get("signalEnd"),
                f"horizons/{horizon}/{split_name}/signalEnd",
            )
            target_end = _session_date(
                raw.get("targetEnd"),
                f"horizons/{horizon}/{split_name}/targetEnd",
            )
            if not (
                normalized_splits[split_name]["start"]
                <= signal_start
                <= signal_end
                <= target_end
                <= normalized_splits[split_name]["end"]
            ):
                _fail(
                    f"horizons/{horizon}/{split_name}",
                    "factor.horizon-order",
                    "Purged horizon dates must stay inside their fixed split",
                )
            normalized_horizons[str(horizon)][split_name] = {
                "signalStart": signal_start,
                "signalEnd": signal_end,
                "targetEnd": target_end,
                "eligibleSignalRows": _integer(
                    raw.get("eligibleSignalRows"),
                    f"horizons/{horizon}/{split_name}/eligibleSignalRows",
                    minimum=1,
                ),
                "purgedBoundaryRows": _integer(
                    raw.get("purgedBoundaryRows"),
                    f"horizons/{horizon}/{split_name}/purgedBoundaryRows",
                    minimum=1,
                ),
                "role": SPLIT_ROLES[split_name],
            }
    return {
        "method": protocol.get("method"),
        "candidateDependent": protocol.get("candidateDependent"),
        "targetCrossesBoundary": protocol.get("targetCrossesBoundary"),
        "splits": normalized_splits,
        "horizons": normalized_horizons,
    }


@dataclass(frozen=True)
class ParsedDaily:
    dates: list[str]
    rows: list[dict[str, Any]]
    by_date: dict[str, dict[str, Any]]


def _csv_integer(
    value: str,
    path: Path | str,
    *,
    minimum: int = 0,
    maximum: int | None = None,
) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        _fail(path, "factor.integer", "Expected an integer")
    if str(parsed) != value or parsed < minimum or (
        maximum is not None and parsed > maximum
    ):
        _fail(path, "factor.integer", "Integer is outside the fixed bounds")
    return parsed


def _availability(
    path: Path,
    metrics: dict[str, Any],
    report: dict[str, Any],
    universe: list[str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    raw_metrics = metrics.get("input_availability")
    if raw_metrics is None:
        return {
            "available": False,
            "reason": "legacy-run",
        }, []
    if (
        not isinstance(raw_metrics, dict)
        or report.get("inputAvailability") != raw_metrics
    ):
        _fail(
            "RunResult/metrics/input_availability",
            "factor.availability",
            "Run and Factor report availability evidence must match",
        )
    raw_rows = _read_csv(
        path,
        columns=AVAILABILITY_COLUMNS,
        maximum_rows=MAX_DAILY_ROWS,
    )
    rows: list[dict[str, Any]] = []
    maximum_assets = len(universe)
    previous_timestamp: str | None = None
    for index, raw in enumerate(raw_rows):
        row_path = f"{path}:{index + 2}"
        timestamp = _session_date(
            raw["timestamp"],
            f"{row_path}/timestamp",
        )
        if previous_timestamp is not None and timestamp <= previous_timestamp:
            _fail(
                row_path,
                "factor.availability-order",
                "Availability timestamps must be unique and chronological",
            )
        previous_timestamp = timestamp
        input_assets = _csv_integer(
            raw["input_assets"],
            f"{row_path}/input_assets",
            maximum=maximum_assets,
        )
        factor_assets = _csv_integer(
            raw["factor_assets"],
            f"{row_path}/factor_assets",
            maximum=input_assets,
        )
        paired = {
            str(horizon): _csv_integer(
                raw[f"paired_assets_h{horizon}"],
                f"{row_path}/paired_assets_h{horizon}",
                maximum=factor_assets,
            )
            for horizon in HORIZONS
        }
        rows.append(
            {
                "timestamp": timestamp,
                "inputAssets": input_assets,
                "factorAssets": factor_assets,
                "pairedAssets": paired,
            }
        )

    def count_summary(
        values: list[int],
        raw: Any,
        label: str,
    ) -> dict[str, float | int]:
        if not isinstance(raw, dict):
            _fail(label, "factor.availability-summary", "Invalid count summary")
        ordered = sorted(values)
        midpoint = len(ordered) // 2
        median = (
            float(ordered[midpoint])
            if len(ordered) % 2
            else float(
                (ordered[midpoint - 1] + ordered[midpoint]) / 2
            )
        )
        expected = {
            "minimum": min(values),
            "median": median,
            "maximum": max(values),
        }
        if raw != expected:
            _fail(
                label,
                "factor.availability-reconciliation",
                "Availability count summary does not reconcile its artifact",
            )
        return {
            "minimum": expected["minimum"],
            "median": expected["median"],
            "maximum": expected["maximum"],
        }

    timestamps = _integer(
        raw_metrics.get("timestamps"),
        "input_availability/timestamps",
        minimum=1,
    )
    if timestamps != len(rows):
        _fail(
            "input_availability/timestamps",
            "factor.availability-reconciliation",
            "Availability timestamp count does not reconcile its artifact",
        )
    observed_rows = sum(row["inputAssets"] for row in rows)
    possible_rows = len(rows) * maximum_assets
    minimum_assets = raw_metrics.get(
        "minimum_assets_per_factor_timestamp"
    )
    if (
        raw_metrics.get("method") != "observed-only-no-fill-v1"
        or raw_metrics.get("missing_observation") != "absent-no-fill"
        or raw_metrics.get("observed_rows") != observed_rows
        or raw_metrics.get("possible_rows") != possible_rows
        or raw_metrics.get("complete_timestamps")
        != sum(row["inputAssets"] == maximum_assets for row in rows)
        or minimum_assets not in {1, 2, 4}
    ):
        _fail(
            "RunResult/metrics/input_availability",
            "factor.availability-reconciliation",
            "Availability summary does not reconcile its artifact",
        )
    _close(
        observed_rows / possible_rows,
        raw_metrics.get("observation_coverage"),
        "input_availability/observation_coverage",
        "input observation coverage",
    )
    raw_eligible = raw_metrics.get("eligible_factor_timestamps")
    if (
        not isinstance(raw_eligible, dict)
        or set(raw_eligible) != {str(item) for item in HORIZONS}
    ):
        _fail(
            "input_availability/eligible_factor_timestamps",
            "factor.availability",
            "Every request-bound horizon needs an eligibility count",
        )
    eligible = [
        {
            "horizon": horizon,
            "timestamps": sum(
                row["pairedAssets"][str(horizon)] >= minimum_assets
                for row in rows
            ),
        }
        for horizon in HORIZONS
    ]
    if {
        str(item["horizon"]): item["timestamps"]
        for item in eligible
    } != raw_eligible:
        _fail(
            "input_availability/eligible_factor_timestamps",
            "factor.availability-reconciliation",
            "Eligibility counts do not reconcile the availability artifact",
        )
    raw_counts = raw_metrics.get("assets_per_timestamp")
    if not isinstance(raw_counts, dict):
        _fail(
            "input_availability/assets_per_timestamp",
            "factor.availability",
            "Availability count summaries must be an object",
        )
    count_summaries = {
        "input": count_summary(
            [row["inputAssets"] for row in rows],
            raw_counts.get("input"),
            "input_availability/assets_per_timestamp/input",
        ),
        "factor": count_summary(
            [row["factorAssets"] for row in rows],
            raw_counts.get("factor"),
            "input_availability/assets_per_timestamp/factor",
        ),
        "primaryPair": count_summary(
            [
                row["pairedAssets"][str(PRIMARY_HORIZON)]
                for row in rows
            ],
            raw_counts.get("primary_pair"),
            "input_availability/assets_per_timestamp/primary_pair",
        ),
    }
    raw_by_asset = raw_metrics.get("by_asset")
    if (
        not isinstance(raw_by_asset, dict)
        or set(raw_by_asset) != set(universe)
    ):
        _fail(
            "input_availability/by_asset",
            "factor.availability-universe",
            "Per-asset availability must match the Run universe",
        )
    by_asset: list[dict[str, Any]] = []
    for asset in universe:
        raw = raw_by_asset[asset]
        if not isinstance(raw, dict):
            _fail(
                f"input_availability/by_asset/{asset}",
                "factor.availability",
                "Per-asset availability must be an object",
            )
        by_asset.append(
            {
                "asset": asset,
                "observations": _integer(
                    raw.get("observations"),
                    f"input_availability/by_asset/{asset}/observations",
                    minimum=1,
                ),
                "start": _session_date(
                    raw.get("start"),
                    f"input_availability/by_asset/{asset}/start",
                ),
                "end": _session_date(
                    raw.get("end"),
                    f"input_availability/by_asset/{asset}/end",
                ),
                "inputCoverage": _bounded(
                    raw.get("input_coverage"),
                    f"input_availability/by_asset/{asset}/input_coverage",
                    minimum=0.0,
                    maximum=1.0,
                ),
                "factorCoverage": _bounded(
                    raw.get("factor_coverage"),
                    f"input_availability/by_asset/{asset}/factor_coverage",
                    minimum=0.0,
                    maximum=1.0,
                ),
            }
        )
    if sum(item["observations"] for item in by_asset) != observed_rows:
        _fail(
            "input_availability/by_asset",
            "factor.availability-reconciliation",
            "Per-asset observations do not reconcile observed rows",
        )
    return {
        "available": True,
        "method": raw_metrics["method"],
        "missingObservation": raw_metrics["missing_observation"],
        "timestamps": timestamps,
        "observedRows": observed_rows,
        "possibleRows": possible_rows,
        "observationCoverage": float(observed_rows / possible_rows),
        "completeTimestamps": raw_metrics["complete_timestamps"],
        "minimumAssetsPerFactorTimestamp": minimum_assets,
        "eligibleFactorTimestamps": eligible,
        "assetsPerTimestamp": count_summaries,
        "byAsset": by_asset,
    }, rows


def _prediction_universe(
    metrics: dict[str, Any],
    universe: list[str],
    factor_claim: dict[str, Any],
) -> dict[str, Any]:
    raw = metrics.get("prediction_universe")
    if raw is None:
        return {
            "available": False,
            "reason": "legacy-run",
            "evaluationMode": CROSS_SECTIONAL_MODE,
            "researchAssets": list(universe),
            "predictionAssets": list(universe),
            "contextAssets": [],
        }
    if isinstance(raw, dict) and "asset_prediction_roles" in raw:
        try:
            population = validate_prediction_population_metrics(
                raw,
                universe,
                factor_claim,
            )
        except PredictionModeError as error:
            _fail(
                "RunResult/metrics/prediction_universe",
                error.code,
                str(error),
            )
        return {
            "available": True,
            "id": population["id"],
            "claim": population["claim"],
            "outcome": population["outcome"],
            "authority": population["authority"],
            "evaluationMode": population["evaluation_mode"],
            "researchAssets": population["research_assets"],
            "predictionAssets": population["prediction_assets"],
            "contextAssets": population["context_assets"],
            "assetPredictionRoles": population[
                "asset_prediction_roles"
            ],
            "evaluationAuthority": population["evaluation_authority"],
            "portfolioAuthority": population["portfolio_authority"],
            "relativeValuePair": population["relative_value_pair"],
            "tradingAuthority": population["trading_authority"],
        }
    required = {
        "authority",
        "research_assets",
        "prediction_assets",
        "context_assets",
        "asset_position_roles",
        "trading_authority",
    }
    if (
        not isinstance(raw, dict)
        or frozenset(raw)
        not in {
            frozenset(required),
            frozenset(required | {"evaluation_mode"}),
            frozenset(required | {"evaluation_mode", "relative_value_pair"}),
        }
    ):
        _fail(
            "RunResult/metrics/prediction_universe",
            "factor.prediction-universe",
            "Invalid fixed Factor prediction-universe evidence",
        )
    research_assets = raw["research_assets"]
    prediction_assets = raw["prediction_assets"]
    context_assets = raw["context_assets"]
    roles = raw["asset_position_roles"]
    evaluation_mode = raw.get("evaluation_mode", CROSS_SECTIONAL_MODE)
    relative_value_pair = raw.get("relative_value_pair")
    expected_relative_value_pair = (
        {
            "left_asset": prediction_assets[0],
            "right_asset": prediction_assets[1],
            "factor_contrast": "factor(left_asset)-factor(right_asset)",
            "target_contrast": (
                "forward_return(left_asset)-forward_return(right_asset)"
            ),
            "construction": "symmetric-dollar-neutral-equal-funded",
            "beta_neutral": False,
        }
        if (
            evaluation_mode == TWO_ASSET_RELATIVE_VALUE_MODE
            and isinstance(prediction_assets, list)
            and len(prediction_assets) == 2
        )
        else None
    )
    if (
        research_assets != universe
        or not isinstance(prediction_assets, list)
        or not prediction_assets
        or len(prediction_assets) != len(set(prediction_assets))
        or any(asset not in universe for asset in prediction_assets)
        or context_assets
        != [asset for asset in universe if asset not in prediction_assets]
        or not isinstance(roles, dict)
        or set(roles) != set(universe)
        or raw["authority"]
        not in {
            "portfolio-mandate-tradable-assets",
            "factor-claim-research-universe",
        }
        or raw["trading_authority"] != "none"
        or evaluation_mode
        not in {
            CROSS_SECTIONAL_MODE,
            SINGLE_ASSET_TEMPORAL_MODE,
            TWO_ASSET_RELATIVE_VALUE_MODE,
        }
        or (
            evaluation_mode == SINGLE_ASSET_TEMPORAL_MODE
            and len(prediction_assets) != 1
        )
        or (
            evaluation_mode == TWO_ASSET_RELATIVE_VALUE_MODE
            and len(prediction_assets) != 2
        )
        or (
            evaluation_mode == CROSS_SECTIONAL_MODE
            and len(prediction_assets) < 4
        )
        or relative_value_pair != expected_relative_value_pair
    ):
        _fail(
            "RunResult/metrics/prediction_universe",
            "factor.prediction-universe",
            "Factor prediction universe does not reconcile the Run universe",
        )
    return {
        "available": True,
        "authority": raw["authority"],
        "evaluationMode": evaluation_mode,
        "researchAssets": list(research_assets),
        "predictionAssets": list(prediction_assets),
        "contextAssets": list(context_assets),
        "assetPositionRoles": dict(roles),
        "relativeValuePair": relative_value_pair,
        "tradingAuthority": "none",
    }


def _parse_daily(
    path: Path,
    protocol: dict[str, Any],
    evaluation_mode: str = CROSS_SECTIONAL_MODE,
) -> ParsedDaily:
    raw_rows = _read_csv(
        path,
        columns=DAILY_COLUMNS,
        maximum_rows=MAX_DAILY_ROWS,
    )
    rows: list[dict[str, Any]] = []
    prior: str | None = None
    split_positions: list[int] = []
    for row_number, raw in enumerate(raw_rows, start=2):
        row_path = f"{path}:{row_number}"
        timestamp = _session_date(raw["timestamp"], f"{row_path}/timestamp")
        if prior is not None and timestamp <= prior:
            _fail(
                row_path,
                "factor.daily-order",
                "Daily Factor timestamps must be unique and increasing",
            )
        split = raw["split"]
        if split not in SPLIT_ROLES:
            _fail(row_path, "factor.split", "Unknown Factor split")
        contract = protocol["splits"][split]
        if not contract["start"] <= timestamp <= contract["end"]:
            _fail(
                row_path,
                "factor.split-membership",
                "Daily split label contradicts the fixed split protocol",
            )
        regime = raw["regime"]
        if regime not in REGIMES:
            _fail(row_path, "factor.regime", "Unknown causal regime label")
        values = {
            f"{measure}IcH{horizon}": (
                None
                if raw[f"{measure}_ic_h{horizon}"] == ""
                else (
                    _finite(
                        raw[f"{measure}_ic_h{horizon}"],
                        f"{row_path}/{measure}_ic_h{horizon}",
                    )
                    if evaluation_mode in TEMPORAL_EVALUATION_MODES
                    else _bounded(
                        raw[f"{measure}_ic_h{horizon}"],
                        f"{row_path}/{measure}_ic_h{horizon}",
                        minimum=-1.0,
                        maximum=1.0,
                    )
                )
            )
            for horizon in HORIZONS
            for measure in ("rank", "pearson")
        }
        rows.append(
            {
                "timestamp": timestamp,
                "split": split,
                "role": SPLIT_ROLES[split],
                "regime": regime,
                **values,
            }
        )
        split_positions.append(SPLITS.index(split))
        prior = timestamp
    if split_positions != sorted(split_positions):
        _fail(path, "factor.split-order", "Daily split labels must be chronological")
    for split_name in SPLITS:
        observed = sum(row["split"] == split_name for row in rows)
        if observed != protocol["splits"][split_name]["rows"]:
            _fail(
                path,
                "factor.split-rows",
                f"Daily rows do not reconcile {split_name} split size",
            )
    return ParsedDaily(
        dates=[row["timestamp"] for row in rows],
        rows=rows,
        by_date={row["timestamp"]: row for row in rows},
    )


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _reconcile_daily(
    daily: ParsedDaily,
    metrics: dict[str, Any],
) -> None:
    quality = metrics.get("horizon_quality")
    if not isinstance(quality, dict) or set(quality) != {
        str(item) for item in HORIZONS
    }:
        _fail(
            "RunResult/metrics/horizon_quality",
            "factor.horizon-quality",
            "Factor Run must declare every request-bound horizon",
        )
    for horizon in HORIZONS:
        raw_horizon = quality[str(horizon)]
        if not isinstance(raw_horizon, dict) or set(raw_horizon) != set(SPLITS):
            _fail(
                f"RunResult/metrics/horizon_quality/{horizon}",
                "factor.horizon-quality",
                "Every horizon must declare all fixed splits",
            )
        for split_name in SPLITS:
            expected = raw_horizon[split_name]
            if not isinstance(expected, dict):
                _fail(
                    f"RunResult/metrics/horizon_quality/{horizon}/{split_name}",
                    "factor.horizon-quality",
                    "Horizon evidence must be an object",
                )
            rank = [
                row[f"rankIcH{horizon}"]
                for row in daily.rows
                if row["split"] == split_name
                and row[f"rankIcH{horizon}"] is not None
            ]
            pearson = [
                row[f"pearsonIcH{horizon}"]
                for row in daily.rows
                if row["split"] == split_name
                and row[f"pearsonIcH{horizon}"] is not None
            ]
            if len(rank) != expected.get("observations"):
                _fail(
                    f"{split_name}/{horizon}/rank",
                    "factor.reconciliation",
                    "Daily rank-IC observations do not reconcile Run metrics",
                )
            _close(
                _mean(rank),
                expected.get("mean_ic"),
                f"{split_name}/{horizon}/rank",
                "mean rank IC",
            )
            expected_pearson = expected.get("pearson_ic")
            if (
                not isinstance(expected_pearson, dict)
                or len(pearson) != expected_pearson.get("observations")
            ):
                _fail(
                    f"{split_name}/{horizon}/pearson",
                    "factor.reconciliation",
                    "Daily Pearson-IC observations do not reconcile Run metrics",
                )
            _close(
                _mean(pearson),
                expected_pearson.get("mean_ic"),
                f"{split_name}/{horizon}/pearson",
                "mean Pearson IC",
            )
    primary = quality[str(PRIMARY_HORIZON)]
    for split_name in SPLITS:
        if metrics.get(split_name) != primary[split_name]:
            _fail(
                f"RunResult/metrics/{split_name}",
                "factor.primary-horizon",
                "Headline split evidence differs from the fixed primary horizon",
            )
    _close(
        metrics.get("validation_mean_ic"),
        primary["validation"].get("mean_ic"),
        "RunResult/metrics/validation_mean_ic",
        "primary validation mean rank IC",
    )


def _parse_quantiles(
    path: Path,
    daily: ParsedDaily,
) -> list[dict[str, Any]]:
    raw_rows = _read_csv(
        path,
        columns=QUANTILE_COLUMNS,
        maximum_rows=MAX_QUANTILE_ROWS,
        allow_empty=True,
    )
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()
    for row_number, raw in enumerate(raw_rows, start=2):
        row_path = f"{path}:{row_number}"
        timestamp = _session_date(raw["timestamp"], f"{row_path}/timestamp")
        daily_row = daily.by_date.get(timestamp)
        if daily_row is None:
            _fail(
                row_path,
                "factor.quantile-date",
                "Quantile timestamp is absent from daily Factor evidence",
            )
        split = raw["split"]
        if split != daily_row["split"]:
            _fail(
                row_path,
                "factor.quantile-split",
                "Quantile split contradicts daily Factor evidence",
            )
        try:
            horizon = int(raw["horizon"])
        except ValueError:
            _fail(row_path, "factor.quantile-horizon", "Invalid quantile horizon")
        if str(horizon) != raw["horizon"] or horizon not in HORIZONS:
            _fail(row_path, "factor.quantile-horizon", "Invalid quantile horizon")
        key = (timestamp, split, horizon)
        if key in seen:
            _fail(
                row_path,
                "factor.quantile-duplicate",
                "Quantile timestamp/split/horizon must be unique",
            )
        values = {
            label: _finite(raw[source], f"{row_path}/{source}")
            for label, source in (
                ("low", "low"),
                ("middle", "middle"),
                ("high", "high"),
                ("highMinusLow", "high_minus_low"),
            )
        }
        if not math.isclose(
            values["high"] - values["low"],
            values["highMinusLow"],
            rel_tol=1e-9,
            abs_tol=1e-10,
        ):
            _fail(
                row_path,
                "factor.quantile-spread",
                "Quantile high-minus-low does not reconcile group returns",
            )
        seen.add(key)
        rows.append(
            {
                "timestamp": timestamp,
                "split": split,
                "role": SPLIT_ROLES[split],
                "horizon": horizon,
                **values,
            }
        )
    return rows


def _average_ranks(values: list[float]) -> list[float]:
    result = [0.0] * len(values)
    order = sorted(range(len(values)), key=lambda index: values[index])
    position = 0
    while position < len(order):
        end = position + 1
        while end < len(order) and math.isclose(
            values[order[end]],
            values[order[position]],
            rel_tol=0.0,
            abs_tol=1e-15,
        ):
            end += 1
        rank = (position + end - 1) / 2.0
        for cursor in range(position, end):
            result[order[cursor]] = rank
        position = end
    return result


def _monotonicity(means: list[float]) -> float | None:
    ranks = _average_ranks(means)
    center_x = 1.0
    center_y = sum(ranks) / 3.0
    numerator = sum(
        (index - center_x) * (rank - center_y)
        for index, rank in enumerate(ranks)
    )
    left = sum((index - center_x) ** 2 for index in range(3))
    right = sum((rank - center_y) ** 2 for rank in ranks)
    denominator = math.sqrt(left * right)
    return numerator / denominator if denominator > 1e-15 else None


def _reconcile_quantiles(
    rows: list[dict[str, Any]],
    metrics: dict[str, Any],
    *,
    modern_outcome_contract: bool,
) -> None:
    analysis = metrics.get("quantile_analysis")
    if not isinstance(analysis, dict) or set(analysis) != {
        str(item) for item in HORIZONS
    }:
        _fail(
            "RunResult/metrics/quantile_analysis",
            "factor.quantiles",
            "Factor Run must declare fixed quantile analysis",
        )
    for horizon in HORIZONS:
        raw_horizon = analysis[str(horizon)]
        if not isinstance(raw_horizon, dict) or set(raw_horizon) != set(SPLITS):
            _fail(
                f"RunResult/metrics/quantile_analysis/{horizon}",
                "factor.quantiles",
                "Every quantile horizon must declare all fixed splits",
            )
        for split_name in SPLITS:
            selected = [
                row
                for row in rows
                if row["horizon"] == horizon and row["split"] == split_name
            ]
            expected = raw_horizon[split_name]
            if (
                not isinstance(expected, dict)
                or len(selected) != expected.get("observations")
            ):
                _fail(
                    f"quantiles/{horizon}/{split_name}",
                    "factor.reconciliation",
                    "Quantile observations do not reconcile Run metrics",
                )
            means = {
                label: _mean([row[label] for row in selected])
                for label in ("low", "middle", "high")
            }
            expected_means = expected.get(
                "mean_outcome_by_quantile"
                if modern_outcome_contract
                else "mean_return_by_quantile"
            )
            if not isinstance(expected_means, dict):
                _fail(
                    f"quantiles/{horizon}/{split_name}",
                    "factor.quantiles",
                    "Quantile means must be an object",
                )
            for label in means:
                _close(
                    means[label],
                    expected_means.get(label),
                    f"quantiles/{horizon}/{split_name}/{label}",
                    f"mean {label} quantile outcome",
                )
            spread = _mean([row["highMinusLow"] for row in selected])
            _close(
                spread,
                expected.get("high_minus_low"),
                f"quantiles/{horizon}/{split_name}/spread",
                "mean high-minus-low spread",
            )
            monotonicity = (
                _monotonicity([means["low"], means["middle"], means["high"]])
                if all(value is not None for value in means.values())
                else None
            )
            _close(
                monotonicity,
                expected.get("monotonicity"),
                f"quantiles/{horizon}/{split_name}/monotonicity",
                "quantile monotonicity",
            )


def _parse_factor_qualification(
    path: Path,
    daily: ParsedDaily,
    metrics: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    qualification = metrics.get("factor_qualification")
    if not isinstance(qualification, dict):
        _fail(
            "RunResult/metrics/factor_qualification",
            "factor.qualification",
            "Factor qualification metrics must be an object",
        )
    method = qualification.get("method")
    if method not in QUALIFICATION_METHODS:
        _fail(
            "RunResult/metrics/factor_qualification/method",
            "factor.qualification-method",
            "Unknown Factor qualification method",
        )
    claim = validate_factor_claim(
        qualification.get("claim"),
        "RunResult/metrics/factor_qualification/claim",
    )
    if metrics.get("factor_claim") != claim:
        _fail(
            "RunResult/metrics/factor_claim",
            "factor.qualification-claim",
            "Factor qualification claim differs from the fixed Run claim",
        )
    selection = qualification.get("selection")
    if not isinstance(selection, dict):
        _fail(
            "RunResult/metrics/factor_qualification/selection",
            "factor.qualification-selection",
            "Factor qualification selection must be an object",
        )
    dominant_style = selection.get("dominant_style")
    if (
        dominant_style not in STYLES
        or selection.get("split") != "train"
        or selection.get("criterion")
        != (
            "maximum-absolute-mean-temporal-rank-overlap"
            if method == TEMPORAL_QUALIFICATION_METHOD
            else (
                "request-predeclared-known-style"
                if claim["claim"] == "known-style-validation"
                else "maximum-absolute-mean-daily-rank-overlap"
            )
        )
        or selection.get("validation_enters_selection") is not False
        or selection.get("test_enters_selection") is not False
    ):
        _fail(
            "RunResult/metrics/factor_qualification/selection",
            "factor.qualification-selection",
            "Qualification style selection must be fixed and train-only",
        )
    candidates = selection.get("candidates")
    if not isinstance(candidates, dict) or set(candidates) != STYLES:
        _fail(
            "RunResult/metrics/factor_qualification/selection/candidates",
            "factor.qualification-selection",
            "Qualification must declare every fixed style candidate",
        )
    normalized_candidates: list[dict[str, Any]] = []
    for style in sorted(STYLES):
        value = candidates[style]
        if not isinstance(value, dict):
            _fail(
                f"factor_qualification/selection/candidates/{style}",
                "factor.qualification-selection",
                "Style selection evidence must be an object",
            )
        normalized_candidates.append(
            {
                "style": style,
                "meanRankCorrelation": _optional_finite(
                    value.get("mean_rank_correlation"),
                    f"qualification/candidates/{style}/mean_rank_correlation",
                ),
                "meanAbsoluteRankCorrelation": _optional_finite(
                    value.get("mean_absolute_rank_correlation"),
                    f"qualification/candidates/{style}/"
                    "mean_absolute_rank_correlation",
                ),
                "observations": _integer(
                    value.get("observations"),
                    f"qualification/candidates/{style}/observations",
                ),
            }
        )
    finite_candidates = [
        item
        for item in normalized_candidates
        if item["meanRankCorrelation"] is not None
    ]
    if not finite_candidates:
        _fail(
            "factor_qualification/selection/candidates",
            "factor.qualification-selection",
            "Qualification style selection has no finite train evidence",
        )
    reconstructed_style = (
        claim["knownStyle"]
        if claim["claim"] == "known-style-validation"
        else min(
            finite_candidates,
            key=lambda item: (
                -abs(item["meanRankCorrelation"]),
                item["style"],
            ),
        )["style"]
    )
    if reconstructed_style != dominant_style:
        _fail(
            "factor_qualification/selection/dominant_style",
            "factor.qualification-selection",
            "Dominant style does not match train-only overlap evidence",
        )

    raw_rows = _read_csv(
        path,
        columns=QUALIFICATION_COLUMNS,
        maximum_rows=MAX_DAILY_ROWS,
    )
    if len(raw_rows) != len(daily.rows):
        _fail(
            path,
            "factor.qualification-rows",
            "Qualification rows must match daily Factor evidence",
        )
    rows: list[dict[str, Any]] = []
    for row_number, (raw, daily_row) in enumerate(
        zip(raw_rows, daily.rows, strict=True),
        start=2,
    ):
        row_path = f"{path}:{row_number}"
        timestamp = _session_date(raw["timestamp"], f"{row_path}/timestamp")
        if (
            timestamp != daily_row["timestamp"]
            or raw["split"] != daily_row["split"]
        ):
            _fail(
                row_path,
                "factor.qualification-identity",
                "Qualification timestamp/split must match daily evidence",
            )
        if raw["dominant_style"] != dominant_style:
            _fail(
                row_path,
                "factor.qualification-style",
                "Qualification artifact changed the train-selected style",
            )
        values = {
            f"{signal}RankIcH{horizon}": (
                None
                if raw[f"{signal}_rank_ic_h{horizon}"] == ""
                else (
                    _finite(
                        raw[f"{signal}_rank_ic_h{horizon}"],
                        f"{row_path}/{signal}_rank_ic_h{horizon}",
                    )
                    if method == TEMPORAL_QUALIFICATION_METHOD
                    else _bounded(
                        raw[f"{signal}_rank_ic_h{horizon}"],
                        f"{row_path}/{signal}_rank_ic_h{horizon}",
                        minimum=-1.0,
                        maximum=1.0,
                    )
                )
            )
            for horizon in HORIZONS
            for signal in QUALIFICATION_SIGNALS
        }
        for horizon in HORIZONS:
            _close(
                values[f"candidateRankIcH{horizon}"],
                daily_row[f"rankIcH{horizon}"],
                f"{row_path}/candidate_rank_ic_h{horizon}",
                "candidate daily rank IC",
            )
        rows.append(
            {
                "timestamp": timestamp,
                "split": raw["split"],
                "role": SPLIT_ROLES[raw["split"]],
                "dominantStyle": dominant_style,
                **values,
            }
        )

    quality = qualification.get("horizon_quality")
    if not isinstance(quality, dict) or set(quality) != {
        str(item) for item in HORIZONS
    }:
        _fail(
            "factor_qualification/horizon_quality",
            "factor.qualification-quality",
            "Qualification must declare every fixed horizon",
        )
    for horizon in HORIZONS:
        horizon_value = quality[str(horizon)]
        if (
            not isinstance(horizon_value, dict)
            or set(horizon_value) != set(SPLITS)
        ):
            _fail(
                f"factor_qualification/horizon_quality/{horizon}",
                "factor.qualification-quality",
                "Qualification horizon must declare every split",
            )
        for split_name in SPLITS:
            split_value = horizon_value[split_name]
            if (
                not isinstance(split_value, dict)
                or set(split_value) != set(QUALIFICATION_SIGNALS)
            ):
                _fail(
                    f"factor_qualification/{horizon}/{split_name}",
                    "factor.qualification-quality",
                    "Qualification split must declare every signal",
                )
            for signal in QUALIFICATION_SIGNALS:
                expected = split_value[signal]
                observed = [
                    row[f"{signal}RankIcH{horizon}"]
                    for row in rows
                    if row["split"] == split_name
                    and row[f"{signal}RankIcH{horizon}"] is not None
                ]
                if (
                    not isinstance(expected, dict)
                    or len(observed) != expected.get("observations")
                ):
                    _fail(
                        f"factor_qualification/{horizon}/{split_name}/{signal}",
                        "factor.reconciliation",
                        "Qualification observations do not reconcile metrics",
                    )
                _close(
                    _mean(observed),
                    expected.get("mean_ic"),
                    f"factor_qualification/{horizon}/{split_name}/{signal}",
                    "qualification mean rank IC",
                )
    return rows, {
        "method": method,
        "claim": claim,
        "dominantStyle": dominant_style,
        "candidates": normalized_candidates,
        "metrics": qualification,
    }


def _rank_summary(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(path, "factor.ic-summary", "IC summary must be an object")
    hac = value.get("hac")
    if not isinstance(hac, dict):
        _fail(path, "factor.ic-summary", "IC summary is incomplete")
    return {
        "meanRankIc": _optional_finite(value.get("mean_ic"), f"{path}/mean_ic"),
        "rankIcStandardDeviation": _optional_finite(
            value.get("standard_deviation"),
            f"{path}/standard_deviation",
        ),
        "rankIcir": _optional_finite(value.get("icir"), f"{path}/icir"),
        "rankHitRate": _optional_finite(
            value.get("hit_rate"),
            f"{path}/hit_rate",
        ),
        "observations": _integer(
            value.get("observations"),
            f"{path}/observations",
        ),
        "minimumObservations": _integer(
            value.get("minimum_observations"),
            f"{path}/minimum_observations",
            minimum=1,
        ),
        "sufficient": value.get("sufficient") is True,
        "hacTStatistic": _optional_finite(
            hac.get("t_statistic"),
            f"{path}/hac/t_statistic",
        ),
        "hacNormalPValue": _optional_finite(
            hac.get("normal_approximation_p_value"),
            f"{path}/hac/normal_approximation_p_value",
        ),
    }


def _ic_summary(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(path, "factor.ic-summary", "IC summary must be an object")
    pearson = value.get("pearson_ic")
    if not isinstance(pearson, dict):
        _fail(path, "factor.ic-summary", "Pearson IC summary is incomplete")
    return {
        **_rank_summary(value, path),
        "meanPearsonIc": _optional_finite(
            pearson.get("mean_ic"),
            f"{path}/pearson_ic/mean_ic",
        ),
        "pearsonIcir": _optional_finite(
            pearson.get("icir"),
            f"{path}/pearson_ic/icir",
        ),
    }


def _factor_qualification_projection(
    parsed: dict[str, Any] | None,
) -> dict[str, Any]:
    method = (
        parsed["method"] if parsed is not None else QUALIFICATION_METHOD
    )
    base = {
        "method": method,
        "authority": "research-prioritization-only",
        "tradingAuthority": "none",
    }
    if parsed is None:
        return {
            **base,
            "available": False,
            "reason": "legacy-run-without-factor-qualification",
        }
    metrics = parsed["metrics"]
    claim = parsed["claim"]
    outcome_kind = factor_outcome(claim)
    semantics = metrics.get("semantics")
    expected_neutralization = (
        "within-split-temporal-centered-rank-ols"
        if method == TEMPORAL_QUALIFICATION_METHOD
        else "same-timestamp-cross-sectional-centered-rank-ols"
    )
    expected_blend = (
        "equal-weight-within-split-temporal-percentile-ranks"
        if method == TEMPORAL_QUALIFICATION_METHOD
        else "equal-weight-cross-sectional-percentile-ranks"
    )
    if (
        not isinstance(semantics, dict)
        or semantics.get("neutralization")
        != expected_neutralization
        or semantics.get("blend")
        != expected_blend
        or semantics.get("target_enters_neutralization") is not False
        or semantics.get("selection_authority")
        != "research-context-only"
        or semantics.get("trading_authority") != "none"
    ):
        _fail(
            "factor_qualification/semantics",
            "factor.qualification-semantics",
            "Factor qualification semantics are invalid",
        )
    quality = metrics["horizon_quality"]
    stability = metrics.get("stability", {})
    candidate_folds = (
        stability.get("candidate_chronological_folds")
        if isinstance(stability, dict)
        else None
    )
    residual_folds = (
        stability.get("style_neutral_chronological_folds")
        if isinstance(stability, dict)
        else None
    )
    expected_folds = {
        f"{split}_{number}"
        for split in SPLITS
        for number in (1, 2)
    }
    if (
        not isinstance(candidate_folds, dict)
        or set(candidate_folds) != expected_folds
        or not isinstance(residual_folds, dict)
        or set(residual_folds) != expected_folds
    ):
        _fail(
            "factor_qualification/stability",
            "factor.qualification-stability",
            "Qualification must declare two candidate and residual folds per split",
        )

    def split_projection(split: str) -> dict[str, Any]:
        primary = str(PRIMARY_HORIZON)
        signal_values = quality[primary][split]
        summaries = {
            "candidate": _rank_summary(
                signal_values["candidate"],
                f"factor_qualification/{primary}/{split}/candidate",
            ),
            "dominantStyle": _rank_summary(
                signal_values["dominant_style"],
                f"factor_qualification/{primary}/{split}/dominant_style",
            ),
            "styleNeutralCandidate": _rank_summary(
                signal_values["style_neutral_candidate"],
                f"factor_qualification/{primary}/{split}/style_neutral_candidate",
            ),
            "equalRankBlend": _rank_summary(
                signal_values["equal_rank_blend"],
                f"factor_qualification/{primary}/{split}/equal_rank_blend",
            ),
        }
        raw_ic = summaries["candidate"]["meanRankIc"]
        residual_ic = summaries["styleNeutralCandidate"]["meanRankIc"]
        style_ic = summaries["dominantStyle"]["meanRankIc"]
        blend_ic = summaries["equalRankBlend"]["meanRankIc"]
        if any(
            value is None
            for value in (raw_ic, residual_ic, style_ic, blend_ic)
        ):
            _fail(
                f"factor_qualification/{primary}/{split}",
                "factor.qualification-evidence",
                "Primary-horizon qualification evidence must be sufficient",
            )
        candidate_fold_rows = [
            {
                "id": name,
                "split": split,
                "role": SPLIT_ROLES[split],
                **_rank_summary(
                    candidate_folds[name],
                    f"factor_qualification/stability/{name}",
                ),
            }
            for name in sorted(candidate_folds)
            if name.startswith(f"{split}_")
        ]
        residual_fold_rows = [
            {
                "id": name,
                "split": split,
                "role": SPLIT_ROLES[split],
                **_rank_summary(
                    residual_folds[name],
                    f"factor_qualification/stability/{name}",
                ),
            }
            for name in sorted(residual_folds)
            if name.startswith(f"{split}_")
        ]
        finite_candidate_folds = [
            item
            for item in candidate_fold_rows
            if item["meanRankIc"] is not None
        ]
        finite_residual_folds = [
            item
            for item in residual_fold_rows
            if item["meanRankIc"] is not None
        ]
        worst_candidate_fold = (
            min(
                finite_candidate_folds,
                key=lambda item: (item["meanRankIc"], item["id"]),
            )
            if finite_candidate_folds
            else None
        )
        worst_residual_fold = (
            min(
                finite_residual_folds,
                key=lambda item: (item["meanRankIc"], item["id"]),
            )
            if finite_residual_folds
            else None
        )
        return {
            "role": SPLIT_ROLES[split],
            **summaries,
            "incremental": {
                "styleNeutralIcRetention": (
                    residual_ic / raw_ic
                    if abs(raw_ic) > 1e-12
                    else None
                ),
                "styleNeutralIcDelta": residual_ic - raw_ic,
                "blendUpliftVsStyle": blend_ic - style_ic,
                "blendUpliftVsCandidate": blend_ic - raw_ic,
            },
            "candidateChronologicalFolds": candidate_fold_rows,
            "weakestCandidateFold": worst_candidate_fold,
            "styleNeutralChronologicalFolds": residual_fold_rows,
            "weakestStyleNeutralFold": worst_residual_fold,
        }

    validation = split_projection("validation")
    test = split_projection("test")
    raw_ic = validation["candidate"]["meanRankIc"]
    raw_hac_t = validation["candidate"]["hacTStatistic"]
    residual_ic = validation["styleNeutralCandidate"]["meanRankIc"]
    residual_hac_t = validation["styleNeutralCandidate"]["hacTStatistic"]
    blend_uplift = validation["incremental"]["blendUpliftVsStyle"]
    worst_residual = validation["weakestStyleNeutralFold"]
    worst_residual_ic = (
        worst_residual["meanRankIc"]
        if worst_residual is not None
        else None
    )
    worst_candidate = validation["weakestCandidateFold"]
    worst_candidate_ic = (
        worst_candidate["meanRankIc"]
        if worst_candidate is not None
        else None
    )
    selected_candidate = next(
        item
        for item in parsed["candidates"]
        if item["style"] == parsed["dominantStyle"]
    )
    identity_correlation = selected_candidate["meanRankCorrelation"]
    if (
        claim["claim"] == "known-style-validation"
        and (
            identity_correlation is None
            or identity_correlation < 0.95
        )
    ):
        stage = "known-style-identity-mismatch"
        focus = "known-style-implementation-identity"
        explanation = (
            "The candidate does not match the request-predeclared known style "
            "with the fixed minimum 0.95 train mean rank correlation."
        )
    elif raw_ic <= 0.0:
        stage = "raw-predictive-edge-absent"
        focus = "candidate-hypothesis-and-timing"
        explanation = (
            "Validation raw candidate rank IC is non-positive; style "
            "neutralization and blending cannot rescue the first missing edge."
        )
    elif (
        raw_hac_t is None
        or raw_hac_t < QUALIFICATION_MIN_POSITIVE_HAC_T
    ):
        stage = "raw-statistical-evidence-weak"
        focus = "independent-sample-and-effect-size"
        explanation = (
            "Validation raw candidate rank IC is positive but its HAC "
            f"t-statistic is below the fixed diagnostic threshold "
            f"{QUALIFICATION_MIN_POSITIVE_HAC_T:.2f}; do not spend complexity "
            "on neutralization, Portfolio, or RL yet."
        )
    elif (
        claim["claim"] in {
            "decision-signal",
            "known-style-validation",
        }
        and (
            worst_candidate_ic is None
            or worst_candidate_ic <= 0.0
        )
    ):
        stage = (
            "decision-signal-temporal-instability"
            if claim["claim"] == "decision-signal"
            else "known-style-temporal-instability"
        )
        focus = "temporal-regime-robustness"
        explanation = (
            "Aggregate validation raw candidate IC is positive, but at least "
            "one fixed chronological candidate fold is non-positive."
        )
    elif (
        claim["claim"] == "decision-signal"
        and outcome_kind != FORWARD_RETURN_OUTCOME
    ):
        stage = "risk-forecast-positive"
        focus = "risk-model-report-and-external-holdout"
        explanation = (
            "The risk signal has positive statistically supported validation "
            "association in every fixed chronological candidate fold. It is "
            "a future-risk forecast, not an expected-return signal; freeze "
            "and report it without Portfolio or RL admission."
        )
    elif claim["claim"] == "decision-signal":
        stage = "decision-signal-positive"
        focus = "portfolio-monetization-and-rl-context"
        explanation = (
            "The decision signal has positive statistically supported "
            "validation IC in every fixed chronological candidate fold. "
            "Style overlap remains disclosed context rather than a novelty "
            "claim; proceed to bounded Portfolio monetization."
        )
    elif (
        claim["claim"] == "known-style-validation"
        and outcome_kind != FORWARD_RETURN_OUTCOME
    ):
        stage = "risk-forecast-positive"
        focus = "risk-model-report-and-external-holdout"
        explanation = (
            "The candidate matches the predeclared style and has positive "
            "statistically supported validation association with future "
            "risk in every fixed chronological fold. It has no expected-"
            "return, Portfolio, or RL authority."
        )
    elif claim["claim"] == "known-style-validation":
        stage = "known-style-validation-positive"
        focus = "portfolio-monetization-and-rl-context"
        explanation = (
            "The candidate matches the predeclared known style and has "
            "positive statistically supported validation IC in every fixed "
            "chronological fold; proceed to bounded Portfolio monetization."
        )
    elif residual_ic <= 0.0:
        stage = "style-neutral-edge-absent"
        focus = "distinct-factor-information"
        explanation = (
            "Validation raw rank IC is positive but becomes non-positive after "
            "removing the train-selected dominant style exposure."
        )
    elif (
        residual_hac_t is None
        or residual_hac_t < QUALIFICATION_MIN_POSITIVE_HAC_T
    ):
        stage = "style-neutral-statistical-evidence-weak"
        focus = "residual-sample-and-effect-size"
        explanation = (
            "Validation style-neutral rank IC is positive but its HAC "
            f"t-statistic is below the fixed diagnostic threshold "
            f"{QUALIFICATION_MIN_POSITIVE_HAC_T:.2f}; distinct edge remains "
            "too weak for the next research lane."
        )
    elif blend_uplift <= 0.0:
        stage = "blend-uplift-absent"
        focus = "factor-combination-and-weighting"
        explanation = (
            "The style-neutral candidate retains positive validation IC, but "
            "an equal rank blend does not improve the fixed style baseline."
        )
    elif worst_residual_ic is None or worst_residual_ic <= 0.0:
        stage = "residual-temporal-instability"
        focus = "temporal-regime-robustness"
        explanation = (
            "Aggregate validation style-neutral IC is positive, but at least "
            "one fixed chronological residual fold is non-positive."
        )
    else:
        if outcome_kind != FORWARD_RETURN_OUTCOME:
            stage = "risk-forecast-positive"
            focus = "risk-model-report-and-external-holdout"
            explanation = (
                "Validation raw, style-neutral, blend-uplift, and "
                "chronological residual evidence support a distinct future-"
                "risk forecast. Freeze and report it; the result does not "
                "authorize expected-return, Portfolio, or RL use."
            )
        else:
            stage = "factor-qualification-positive"
            focus = "portfolio-monetization-and-rl-context"
            explanation = (
                "Validation raw, style-neutral, blend-uplift, and "
                "chronological residual evidence are positive; proceed to "
                "bounded Portfolio monetization before interpreting "
                "governed-RL value."
            )
    horizon_profile = [
        {
            "horizon": horizon,
            **{
                split: {
                    "role": SPLIT_ROLES[split],
                    **{
                        {
                            "candidate": "candidate",
                            "dominant_style": "dominantStyle",
                            "style_neutral_candidate": (
                                "styleNeutralCandidate"
                            ),
                            "equal_rank_blend": "equalRankBlend",
                        }[signal]: _rank_summary(
                            quality[str(horizon)][split][signal],
                            f"factor_qualification/{horizon}/{split}/{signal}",
                        )
                        for signal in QUALIFICATION_SIGNALS
                    },
                }
                for split in SPLITS
            },
        }
        for horizon in HORIZONS
    ]
    return {
        **base,
        "available": True,
        "reason": None,
        "selection": {
            "split": "train",
            "role": "comparison-style-selection-only",
            "criterion": (
                "maximum-absolute-mean-temporal-rank-overlap"
                if method == TEMPORAL_QUALIFICATION_METHOD
                else (
                    "request-predeclared-known-style"
                    if claim["claim"] == "known-style-validation"
                    else "maximum-absolute-mean-daily-rank-overlap"
                )
            ),
            "dominantStyle": parsed["dominantStyle"],
            "candidates": parsed["candidates"],
            "validationEntersSelection": False,
            "testEntersSelection": False,
        },
        "semantics": {
            "neutralization": semantics["neutralization"],
            "blend": semantics["blend"],
            "targetEntersNeutralization": False,
            "diagnosisSplit": "validation",
            "testEntersDiagnosis": False,
            "factorPromotionAuthority": False,
            "rlAdmissionAuthority": False,
            "diagnosticThresholds": {
                "minimumPositiveHacTStatistic": (
                    QUALIFICATION_MIN_POSITIVE_HAC_T
                ),
                "minimumKnownStyleRankIdentity": 0.95,
                "selectionAdjustedSignificanceRequiredSeparately": True,
            },
        },
        "claim": claim,
        "diagnosis": {
            "selectionSplit": "validation",
            "testEntersDiagnosis": False,
            "stage": stage,
            "iterationFocus": focus,
            "explanation": explanation,
            "qualifiesForPortfolio": stage
            in {
                "decision-signal-positive",
                "factor-qualification-positive",
                "known-style-validation-positive",
            },
        },
        "validation": validation,
        "testAudit": test,
        "horizonProfile": horizon_profile,
    }


def _association_summary(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(
            path,
            "factor.component-association",
            "Component association summary must be an object",
        )
    return {
        "meanRankAssociation": (
            _bounded(
                value.get("mean_rank_correlation"),
                f"{path}/mean_rank_correlation",
                minimum=-1.0,
                maximum=1.0,
            )
            if value.get("mean_rank_correlation") is not None
            else None
        ),
        "meanAbsoluteRankAssociation": (
            _bounded(
                value.get("mean_absolute_rank_correlation"),
                f"{path}/mean_absolute_rank_correlation",
                minimum=0.0,
                maximum=1.0,
            )
            if value.get("mean_absolute_rank_correlation") is not None
            else None
        ),
        "observations": _integer(
            value.get("observations"),
            f"{path}/observations",
        ),
    }


def _component_horizon_quality(value: Any, path: str) -> list[dict[str, Any]]:
    if (
        not isinstance(value, dict)
        or set(value) != {str(item) for item in HORIZONS}
    ):
        _fail(
            path,
            "factor.component-horizons",
            "Component quality must use every request-bound horizon",
        )
    return [
        {
            "horizon": horizon,
            **{
                split: {
                    "role": SPLIT_ROLES[split],
                    **_rank_summary(
                        value[str(horizon)].get(split),
                        f"{path}/{horizon}/{split}",
                    ),
                }
                for split in SPLITS
            },
        }
        for horizon in HORIZONS
    ]


def _quality_split(
    profile: list[dict[str, Any]],
    split: str,
    horizon: int | None = None,
) -> dict[str, Any]:
    if horizon is None:
        horizon = PRIMARY_HORIZON
    return next(
        row[split] for row in profile if row["horizon"] == horizon
    )


def _context_distribution_projection(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "observations",
        "mean",
        "standard_deviation",
        "minimum",
        "quartile_25",
        "median",
        "quartile_75",
        "maximum",
    }:
        _fail(path, "factor.component-context", "Invalid context distribution")
    observations = _integer(value["observations"], f"{path}/observations")
    return {
        "observations": observations,
        **{
            {
                "mean": "mean",
                "standard_deviation": "standardDeviation",
                "minimum": "minimum",
                "quartile_25": "quartile25",
                "median": "median",
                "quartile_75": "quartile75",
                "maximum": "maximum",
            }[key]: (
                _optional_finite(value[key], f"{path}/{key}")
                if value[key] is not None
                else None
            )
            for key in (
                "mean",
                "standard_deviation",
                "minimum",
                "quartile_25",
                "median",
                "quartile_75",
                "maximum",
            )
        },
    }


def _timestamp_context_projection(
    value: Any,
    path: str,
    evaluation_mode: str,
) -> dict[str, Any]:
    temporal = evaluation_mode in TEMPORAL_EVALUATION_MODES
    expected_keys = {
        "method",
        "state_selection",
        "splits",
        "authority",
        "test_enters_diagnosis",
        "trading_authority",
    }
    if temporal:
        expected_keys.add("conditional_measure")
    if not isinstance(value, dict) or set(value) != expected_keys:
        _fail(path, "factor.component-context", "Invalid timestamp-context evidence")
    selection = value.get("state_selection")
    if (
        value.get("method")
        != (
            "train-tertile-temporal-context-v2"
            if temporal
            else "train-tertile-timestamp-context-v1"
        )
        or (
            temporal
            and value.get("conditional_measure")
            != "within-split-temporal-rank-correlation-contribution"
        )
        or value.get("authority") != "research-prioritization-only"
        or value.get("test_enters_diagnosis") is not False
        or value.get("trading_authority") != "none"
        or not isinstance(selection, dict)
        or set(selection)
        != {
            "split",
            "target_enters_thresholds",
            "lower",
            "upper",
            "labels",
        }
        or selection.get("split") != "train"
        or selection.get("target_enters_thresholds") is not False
        or selection.get("labels") != ["low", "middle", "high"]
    ):
        _fail(path, "factor.component-context", "Invalid context-state semantics")
    lower = _finite(selection.get("lower"), f"{path}/state_selection/lower")
    upper = _finite(selection.get("upper"), f"{path}/state_selection/upper")
    if lower > upper:
        _fail(path, "factor.component-context", "Context thresholds are unordered")
    raw_splits = value.get("splits")
    if not isinstance(raw_splits, dict) or set(raw_splits) != set(SPLITS):
        _fail(path, "factor.component-context", "Context evidence must cover every split")
    projected_splits: dict[str, Any] = {}
    for split in SPLITS:
        raw = raw_splits[split]
        split_path = f"{path}/splits/{split}"
        if not isinstance(raw, dict) or set(raw) != {
            "distribution",
            "state_occupancy",
            "transitions",
            "conditional_factor_horizon_quality",
        }:
            _fail(split_path, "factor.component-context", "Invalid context split evidence")
        distribution = _context_distribution_projection(
            raw["distribution"],
            f"{split_path}/distribution",
        )
        occupancy = raw["state_occupancy"]
        if not isinstance(occupancy, dict) or set(occupancy) != {
            "low",
            "middle",
            "high",
        }:
            _fail(split_path, "factor.component-context", "Invalid state occupancy")
        projected_occupancy: dict[str, Any] = {}
        total = 0
        for state in ("low", "middle", "high"):
            item = occupancy[state]
            if not isinstance(item, dict) or set(item) != {
                "observations",
                "rate",
            }:
                _fail(split_path, "factor.component-context", "Invalid occupancy row")
            count = _integer(
                item["observations"],
                f"{split_path}/state_occupancy/{state}/observations",
            )
            rate = (
                _bounded(
                    item["rate"],
                    f"{split_path}/state_occupancy/{state}/rate",
                    minimum=0.0,
                    maximum=1.0,
                )
                if item["rate"] is not None
                else None
            )
            total += count
            projected_occupancy[state] = {
                "observations": count,
                "rate": rate,
            }
        if total != distribution["observations"]:
            _fail(split_path, "factor.component-context", "Occupancy does not reconcile")
        transitions = raw["transitions"]
        if not isinstance(transitions, dict) or set(transitions) != {
            "observations",
            "changes",
            "rate",
        }:
            _fail(split_path, "factor.component-context", "Invalid transitions")
        transition_observations = _integer(
            transitions["observations"],
            f"{split_path}/transitions/observations",
        )
        changes = _integer(
            transitions["changes"],
            f"{split_path}/transitions/changes",
        )
        rate = (
            _bounded(
                transitions["rate"],
                f"{split_path}/transitions/rate",
                minimum=0.0,
                maximum=1.0,
            )
            if transitions["rate"] is not None
            else None
        )
        if changes > transition_observations:
            _fail(split_path, "factor.component-context", "Transition count is impossible")
        conditional = raw["conditional_factor_horizon_quality"]
        if (
            not isinstance(conditional, dict)
            or set(conditional) != {str(item) for item in HORIZONS}
        ):
            _fail(split_path, "factor.component-context", "Invalid conditional horizons")
        conditional_profile = [
            {
                "horizon": horizon,
                **{
                    state: _rank_summary(
                        conditional[str(horizon)][state],
                        f"{split_path}/conditional/{horizon}/{state}",
                    )
                    for state in ("low", "middle", "high")
                },
            }
            for horizon in HORIZONS
        ]
        projected_splits[split] = {
            "role": SPLIT_ROLES[split],
            "distribution": distribution,
            "stateOccupancy": projected_occupancy,
            "transitions": {
                "observations": transition_observations,
                "changes": changes,
                "rate": rate,
            },
            "conditionalFactorHorizonProfile": conditional_profile,
        }
    return {
        "method": value["method"],
        "conditionalMeasure": (
            value["conditional_measure"]
            if temporal
            else "per-date-cross-sectional-rank-ic"
        ),
        "stateSelection": {
            "split": "train",
            "targetEntersThresholds": False,
            "lower": lower,
            "upper": upper,
            "labels": ["low", "middle", "high"],
        },
        "splits": projected_splits,
        "authority": value["authority"],
        "testEntersDiagnosis": False,
        "tradingAuthority": "none",
    }


def _factor_components_projection(
    evidence: Any,
    universe: list[str],
    evaluation_mode: str,
    prediction_target: str,
) -> dict[str, Any]:
    base = {
        "method": COMPONENT_METHOD,
        "evaluationMode": evaluation_mode,
        "authority": "research-prioritization-only",
        "tradingAuthority": "none",
    }
    if evidence is None:
        return {
            **base,
            "available": False,
            "reason": "legacy-run-without-factor-components",
        }
    if not isinstance(evidence, dict) or set(evidence) != {
        "method",
        "declaration",
        "semantics",
        "trial_disclosure",
        "components",
        "pairwise",
        "fixed_blend",
        "validation_diagnosis",
    }:
        _fail(
            "factor_components",
            "factor.components-schema",
            "Factor component evidence has an invalid top-level contract",
        )
    if evidence.get("method") != COMPONENT_METHOD:
        _fail(
            "factor_components/method",
            "factor.components-method",
            f"Expected component method {COMPONENT_METHOD}",
        )
    declaration = evidence.get("declaration")
    if (
        not isinstance(declaration, dict)
        or set(declaration)
        != {
            "exhaustive_composition_claim",
            "source_inference",
            "components",
        }
        or declaration.get("exhaustive_composition_claim") is not False
        or declaration.get("source_inference") is not False
    ):
        _fail(
            "factor_components/declaration",
            "factor.components-declaration",
            "Component declaration must deny exhaustive composition and "
            "source inference",
        )
    declared = declaration.get("components")
    if (
        not isinstance(declared, list)
        or not 1 <= len(declared) <= MAX_COMPONENTS
    ):
        _fail(
            "factor_components/declaration/components",
            "factor.components-count",
            f"Expected 1..{MAX_COMPONENTS} materialized components",
        )
    declared_by_id: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(declared):
        path = f"factor_components/declaration/components/{index}"
        if not isinstance(item, dict) or set(item) != {
            "id",
            "label",
            "role",
            "intervals",
            "hypothesis",
        }:
            _fail(
                path,
                "factor.component-declaration",
                "Component declaration fields are invalid",
            )
        component_id = item.get("id")
        intervals = item.get("intervals")
        if (
            not isinstance(component_id, str)
            or not component_id
            or component_id in declared_by_id
            or not isinstance(item.get("label"), str)
            or not item["label"]
            or item.get("role")
            not in {"cross-sectional-score", "timestamp-context"}
            or not isinstance(item.get("hypothesis"), str)
            or not item["hypothesis"]
            or not isinstance(intervals, list)
            or not intervals
            or not all(isinstance(value, str) and value for value in intervals)
        ):
            _fail(
                path,
                "factor.component-declaration",
                "Component declaration identity or metadata is invalid",
            )
        declared_by_id[component_id] = item

    semantics = evidence.get("semantics")
    temporal = evaluation_mode in TEMPORAL_EVALUATION_MODES
    expected_semantics = {
        "evaluation_mode": evaluation_mode,
        "prediction_target": prediction_target,
        "score_measure": (
            "within-split-temporal-rank-correlation-contribution"
            if temporal
            else "per-date-cross-sectional-rank-ic"
        ),
        "nearest_peer_selection": "train-only-target-free",
        "residualization": (
            "within-split-temporal-centered-rank-ols"
            if temporal
            else "same-timestamp-cross-sectional-centered-rank-ols"
        ),
        "diagnostic_blend": (
            "equal-weight-within-split-temporal-percentile-ranks-with-"
            "common-component-availability"
            if temporal
            else "equal-weight-cross-sectional-percentile-ranks-with-"
            "common-component-availability"
        ),
        "ablation_target": "fixed-diagnostic-blend-not-candidate-factor",
        "component_roles": [
            "cross-sectional-score",
            "timestamp-context",
        ],
        "timestamp_context": (
            "train-tertile-occupancy-transition-and-conditional-temporal-"
            "rank-correlation-contribution"
            if temporal
            else "train-tertile-occupancy-transition-and-conditional-factor-ic"
        ),
        "selection_authority": "research-prioritization-only",
        "test_role": "visible-audit",
        "promotion_authority": "none",
        "portfolio_authority": "none",
        "rl_action_authority": "none",
        "trading_authority": "none",
    }
    if semantics != expected_semantics:
        _fail(
            "factor_components/semantics",
            "factor.components-semantics",
            "Factor component authority or timing semantics are invalid",
        )

    raw_components = evidence.get("components")
    if (
        not isinstance(raw_components, list)
        or len(raw_components) != len(declared_by_id)
    ):
        _fail(
            "factor_components/components",
            "factor.components-count",
            "Component evidence must match the declaration",
        )
    projected_components: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_components):
        path = f"factor_components/components/{index}"
        if not isinstance(raw, dict) or set(raw) != {
            "id",
            "label",
            "role",
            "intervals",
            "hypothesis",
            "coverage_by_asset",
            "mean_coverage",
            "raw_horizon_quality",
            "composite_association",
            "nearest_peer",
            "nearest_peer_residual",
            "fixed_blend_ablation",
            "timestamp_context",
            "validation_priority_inputs",
        }:
            _fail(
                path,
                "factor.component-schema",
                "Component evidence fields are invalid",
            )
        component_id = raw.get("id")
        if (
            component_id not in declared_by_id
            or component_id in seen
            or {
                key: raw.get(key)
                for key in (
                    "id",
                    "label",
                    "role",
                    "intervals",
                    "hypothesis",
                )
            }
            != declared_by_id.get(component_id)
        ):
            _fail(
                path,
                "factor.component-identity",
                "Component evidence differs from its declaration",
            )
        seen.add(component_id)
        coverage = raw.get("coverage_by_asset")
        if not isinstance(coverage, dict) or set(coverage) != set(universe):
            _fail(
                f"{path}/coverage_by_asset",
                "factor.component-coverage",
                "Component coverage must match the Run universe",
            )
        coverage_rows = [
            {
                "asset": asset,
                "coverage": _bounded(
                    coverage[asset],
                    f"{path}/coverage_by_asset/{asset}",
                    minimum=0.0,
                    maximum=1.0,
                ),
            }
            for asset in universe
        ]
        mean_coverage = _bounded(
            raw.get("mean_coverage"),
            f"{path}/mean_coverage",
            minimum=0.0,
            maximum=1.0,
        )
        _close(
            sum(item["coverage"] for item in coverage_rows)
            / len(coverage_rows),
            mean_coverage,
            f"{path}/mean_coverage",
            "mean component coverage",
        )
        role = declared_by_id[component_id]["role"]
        if role == "timestamp-context":
            nearest = raw.get("nearest_peer")
            residual = raw.get("nearest_peer_residual")
            ablation = raw.get("fixed_blend_ablation")
            priority = raw.get("validation_priority_inputs")
            if (
                raw.get("raw_horizon_quality") is not None
                or raw.get("composite_association") is not None
                or not isinstance(nearest, dict)
                or nearest
                != {
                    "id": None,
                    "train_mean_absolute_rank_association": None,
                }
                or not isinstance(residual, dict)
                or residual
                != {
                    "peer": None,
                    "selection": "not-applicable-timestamp-context",
                    "horizon_quality": None,
                }
                or not isinstance(ablation, dict)
                or ablation
                != {
                    "available": False,
                    "reason": "not-applicable-timestamp-context",
                    "horizon_quality": None,
                    "removal_delta_mean_ic": None,
                }
                or priority
                != {
                    "raw_mean_ic": None,
                    "nearest_peer_residual_mean_ic": None,
                    "removal_delta_mean_ic": None,
                }
            ):
                _fail(
                    path,
                    "factor.component-context",
                    "Timestamp context cannot contain score-only diagnostics",
                )
            context = _timestamp_context_projection(
                raw.get("timestamp_context"),
                f"{path}/timestamp_context",
                evaluation_mode,
            )
            projected_components.append(
                {
                    **declared_by_id[component_id],
                    "meanCoverage": mean_coverage,
                    "coverageByAsset": coverage_rows,
                    "rawHorizonProfile": None,
                    "compositeAssociation": None,
                    "nearestPeer": {
                        "id": None,
                        "trainMeanAbsoluteRankAssociation": None,
                        "selection": "not-applicable-timestamp-context",
                    },
                    "nearestPeerResidualHorizonProfile": None,
                    "fixedBlendAblation": {
                        "available": False,
                        "reason": "not-applicable-timestamp-context",
                        "horizonProfile": None,
                        "removalDeltaMeanIc": None,
                    },
                    "timestampContext": context,
                    "validation": {
                        "raw": None,
                        "compositeAssociation": None,
                        "nearestPeerResidual": None,
                        "fixedBlendRemovalDeltaMeanIc": None,
                        "context": context["splits"]["validation"],
                    },
                    "testAudit": {
                        "role": "visible-audit",
                        "raw": None,
                        "compositeAssociation": None,
                        "nearestPeerResidual": None,
                        "fixedBlendRemovalDeltaMeanIc": None,
                        "context": context["splits"]["test"],
                    },
                }
            )
            continue
        if raw.get("timestamp_context") is not None:
            _fail(
                f"{path}/timestamp_context",
                "factor.component-context",
                "Cross-sectional scores cannot contain context-state evidence",
            )
        raw_profile = _component_horizon_quality(
            raw.get("raw_horizon_quality"),
            f"{path}/raw_horizon_quality",
        )
        associations = raw.get("composite_association")
        if not isinstance(associations, dict) or set(associations) != set(
            SPLITS
        ):
            _fail(
                f"{path}/composite_association",
                "factor.component-association",
                "Final-factor association must cover every split",
            )
        projected_association = {
            split: {
                "role": SPLIT_ROLES[split],
                **_association_summary(
                    associations[split],
                    f"{path}/composite_association/{split}",
                ),
            }
            for split in SPLITS
        }
        nearest = raw.get("nearest_peer")
        if not isinstance(nearest, dict) or set(nearest) != {
            "id",
            "train_mean_absolute_rank_association",
        }:
            _fail(
                f"{path}/nearest_peer",
                "factor.component-peer",
                "Nearest-peer evidence is invalid",
            )
        peer = nearest.get("id")
        if peer is not None and (
            peer not in declared_by_id or peer == component_id
        ):
            _fail(
                f"{path}/nearest_peer/id",
                "factor.component-peer",
                "Nearest peer must be another declared component",
            )
        peer_association = (
            _bounded(
                nearest.get("train_mean_absolute_rank_association"),
                f"{path}/nearest_peer/train_mean_absolute_rank_association",
                minimum=0.0,
                maximum=1.0,
            )
            if nearest.get("train_mean_absolute_rank_association")
            is not None
            else None
        )
        residual = raw.get("nearest_peer_residual")
        if not isinstance(residual, dict) or set(residual) != {
            "peer",
            "selection",
            "horizon_quality",
        } or residual.get("peer") != peer:
            _fail(
                f"{path}/nearest_peer_residual",
                "factor.component-residual",
                "Nearest-peer residual evidence is invalid",
            )
        residual_profile = (
            _component_horizon_quality(
                residual.get("horizon_quality"),
                f"{path}/nearest_peer_residual/horizon_quality",
            )
            if peer is not None
            else None
        )
        ablation = raw.get("fixed_blend_ablation")
        if not isinstance(ablation, dict) or set(ablation) != {
            "available",
            "reason",
            "horizon_quality",
            "removal_delta_mean_ic",
        }:
            _fail(
                f"{path}/fixed_blend_ablation",
                "factor.component-ablation",
                "Fixed-blend ablation evidence is invalid",
            )
        ablation_profile = (
            _component_horizon_quality(
                ablation.get("horizon_quality"),
                f"{path}/fixed_blend_ablation/horizon_quality",
            )
            if ablation.get("available") is True
            else None
        )
        priority = raw.get("validation_priority_inputs")
        if not isinstance(priority, dict) or set(priority) != {
            "raw_mean_ic",
            "nearest_peer_residual_mean_ic",
            "removal_delta_mean_ic",
        }:
            _fail(
                f"{path}/validation_priority_inputs",
                "factor.component-priority",
                "Validation component priority inputs are invalid",
            )
        raw_validation = _quality_split(raw_profile, "validation")[
            "meanRankIc"
        ]
        _close(
            raw_validation,
            priority["raw_mean_ic"],
            f"{path}/validation_priority_inputs/raw_mean_ic",
            "validation raw component IC",
        )
        residual_validation = (
            _quality_split(residual_profile, "validation")["meanRankIc"]
            if residual_profile is not None
            else None
        )
        _close(
            residual_validation,
            priority["nearest_peer_residual_mean_ic"],
            f"{path}/validation_priority_inputs/"
            "nearest_peer_residual_mean_ic",
            "validation nearest-peer residual IC",
        )
        removal_deltas = ablation.get("removal_delta_mean_ic")
        if ablation.get("available") is True and (
            not isinstance(removal_deltas, dict)
            or set(removal_deltas) != set(SPLITS)
        ):
            _fail(
                f"{path}/fixed_blend_ablation/removal_delta_mean_ic",
                "factor.component-ablation",
                "Available ablation must disclose every split delta",
            )
        if ablation.get("available") is not True and (
            ablation_profile is not None or removal_deltas is not None
        ):
            _fail(
                f"{path}/fixed_blend_ablation",
                "factor.component-ablation",
                "Unavailable ablation cannot contain invented evidence",
            )
        projected_components.append(
            {
                **declared_by_id[component_id],
                "meanCoverage": mean_coverage,
                "coverageByAsset": coverage_rows,
                "rawHorizonProfile": raw_profile,
                "compositeAssociation": projected_association,
                "nearestPeer": {
                    "id": peer,
                    "trainMeanAbsoluteRankAssociation": peer_association,
                    "selection": residual.get("selection"),
                },
                "nearestPeerResidualHorizonProfile": residual_profile,
                "fixedBlendAblation": {
                    "available": ablation.get("available") is True,
                    "reason": ablation.get("reason"),
                    "horizonProfile": ablation_profile,
                    "removalDeltaMeanIc": (
                        {
                            split: _optional_finite(
                                ablation["removal_delta_mean_ic"][split],
                                f"{path}/fixed_blend_ablation/"
                                f"removal_delta_mean_ic/{split}",
                            )
                            for split in SPLITS
                        }
                        if ablation.get("available") is True
                        and isinstance(
                            ablation.get("removal_delta_mean_ic"), dict
                        )
                        else None
                    ),
                },
                "timestampContext": None,
                "validation": {
                    "raw": _quality_split(raw_profile, "validation"),
                    "compositeAssociation": projected_association[
                        "validation"
                    ],
                    "nearestPeerResidual": (
                        _quality_split(residual_profile, "validation")
                        if residual_profile is not None
                        else None
                    ),
                    "fixedBlendRemovalDeltaMeanIc": (
                        _finite(
                            priority[
                                "removal_delta_mean_ic"
                            ],
                            f"{path}/validation_priority_inputs/"
                            "removal_delta_mean_ic",
                        )
                        if priority[
                            "removal_delta_mean_ic"
                        ]
                        is not None
                        else None
                    ),
                    "context": None,
                },
                "testAudit": {
                    "role": "visible-audit",
                    "raw": _quality_split(raw_profile, "test"),
                    "compositeAssociation": projected_association["test"],
                    "nearestPeerResidual": (
                        _quality_split(residual_profile, "test")
                        if residual_profile is not None
                        else None
                    ),
                    "fixedBlendRemovalDeltaMeanIc": (
                        _finite(
                            ablation["removal_delta_mean_ic"]["test"],
                            f"{path}/fixed_blend_ablation/"
                            "removal_delta_mean_ic/test",
                        )
                        if ablation.get("available") is True
                        else None
                    ),
                    "context": None,
                },
            }
        )
    if seen != set(declared_by_id):
        _fail(
            "factor_components/components",
            "factor.component-identity",
            "Component evidence does not cover every declaration",
        )

    pairwise = evidence.get("pairwise")
    score_ids = {
        component_id
        for component_id, item in declared_by_id.items()
        if item["role"] == "cross-sectional-score"
    }
    context_ids = set(declared_by_id) - score_ids
    expected_pairs = len(score_ids) * (len(score_ids) - 1) // 2
    if not isinstance(pairwise, list) or len(pairwise) != expected_pairs:
        _fail(
            "factor_components/pairwise",
            "factor.component-pairs",
            "Pairwise evidence count does not reconcile components",
        )
    projected_pairs: list[dict[str, Any]] = []
    pair_ids: set[frozenset[str]] = set()
    for index, pair in enumerate(pairwise):
        path = f"factor_components/pairwise/{index}"
        if not isinstance(pair, dict) or set(pair) != {
            "left",
            "right",
            "splits",
        }:
            _fail(
                path,
                "factor.component-pair",
                "Pairwise component evidence is invalid",
            )
        left, right = pair.get("left"), pair.get("right")
        identity = frozenset((left, right))
        if (
            left not in score_ids
            or right not in score_ids
            or left == right
            or identity in pair_ids
        ):
            _fail(
                path,
                "factor.component-pair",
                "Pairwise identity must be unique declared components",
            )
        pair_ids.add(identity)
        splits = pair.get("splits")
        if not isinstance(splits, dict) or set(splits) != set(SPLITS):
            _fail(
                f"{path}/splits",
                "factor.component-pair",
                "Pairwise evidence must cover every split",
            )
        projected_pairs.append(
            {
                "left": left,
                "right": right,
                **{
                    split: {
                        "role": SPLIT_ROLES[split],
                        **_association_summary(
                            splits[split],
                            f"{path}/splits/{split}",
                        ),
                    }
                    for split in SPLITS
                },
            }
        )

    fixed_blend = evidence.get("fixed_blend")
    if not isinstance(fixed_blend, dict) or set(fixed_blend) != {
        "available",
        "reason",
        "horizon_quality"
    }:
        _fail(
            "factor_components/fixed_blend",
            "factor.component-blend",
            "Fixed component blend evidence is invalid",
        )
    blend_profile = (
        _component_horizon_quality(
            fixed_blend["horizon_quality"],
            "factor_components/fixed_blend/horizon_quality",
        )
        if fixed_blend.get("available") is True
        else None
    )
    if (
        (fixed_blend.get("available") is True)
        != bool(score_ids)
        or (
            score_ids
            and fixed_blend.get("reason") is not None
        )
        or (
            not score_ids
            and (
                fixed_blend.get("reason")
                != "no-cross-sectional-score-components"
                or fixed_blend.get("horizon_quality") is not None
            )
        )
    ):
        _fail(
            "factor_components/fixed_blend",
            "factor.component-blend",
            "Fixed blend availability does not reconcile score components",
        )
    for row in projected_components:
        ablation = row["fixedBlendAblation"]
        if not ablation["available"]:
            continue
        for split in SPLITS:
            leave_mean = _quality_split(
                ablation["horizonProfile"],
                split,
            )["meanRankIc"]
            full_mean = _quality_split(blend_profile, split)["meanRankIc"]
            expected_delta = (
                leave_mean - full_mean
                if leave_mean is not None and full_mean is not None
                else None
            )
            _close(
                ablation["removalDeltaMeanIc"][split],
                expected_delta,
                f"factor_components/{row['id']}/ablation/{split}",
                "fixed-blend removal delta",
            )

    disclosure = evidence.get("trial_disclosure")
    if disclosure != {
        "materialized_components": len(declared_by_id),
        "cross_sectional_score_components": len(score_ids),
        "timestamp_context_components": len(context_ids),
        "pairwise_comparisons": expected_pairs,
        "component_diagnostics_enter_promotion_score": False,
    }:
        _fail(
            "factor_components/trial_disclosure",
            "factor.component-trials",
            "Component trial disclosure does not reconcile",
        )
    diagnosis = evidence.get("validation_diagnosis")
    if not isinstance(diagnosis, dict) or set(diagnosis) != {
        "strongest_raw_component",
        "strongest_raw_mean_ic",
        "strongest_residual_component",
        "strongest_residual_mean_ic",
        "removal_most_improves_fixed_blend",
        "best_removal_delta_mean_ic",
        "most_redundant_pair",
        "authority",
        "test_enters_diagnosis",
    } or diagnosis.get("authority") != "research-prioritization-only" or (
        diagnosis.get("test_enters_diagnosis") is not False
    ):
        _fail(
            "factor_components/validation_diagnosis",
            "factor.component-diagnosis",
            "Validation component diagnosis is invalid",
        )
    raw_rows = [
        row
        for row in projected_components
        if row["role"] == "cross-sectional-score"
        and row["validation"]["raw"]["meanRankIc"] is not None
    ]
    strongest_raw = (
        max(
            raw_rows,
            key=lambda row: (
                float(row["validation"]["raw"]["meanRankIc"]),
                row["id"],
            ),
        )
        if raw_rows
        else None
    )
    expected_raw_id = strongest_raw["id"] if strongest_raw is not None else None
    expected_raw_ic = (
        strongest_raw["validation"]["raw"]["meanRankIc"]
        if strongest_raw is not None
        else None
    )
    if diagnosis["strongest_raw_component"] != expected_raw_id:
        _fail(
            "factor_components/validation_diagnosis/"
            "strongest_raw_component",
            "factor.component-diagnosis",
            "Strongest raw component does not reconcile validation evidence",
        )
    _close(
        expected_raw_ic,
        diagnosis["strongest_raw_mean_ic"],
        "factor_components/validation_diagnosis/strongest_raw_mean_ic",
        "strongest raw component IC",
    )
    residual_rows = [
        row
        for row in projected_components
        if row["validation"]["nearestPeerResidual"] is not None
    ]
    strongest_residual = (
        max(
            residual_rows,
            key=lambda row: (
                float(
                    row["validation"]["nearestPeerResidual"][
                        "meanRankIc"
                    ]
                ),
                row["id"],
            ),
        )
        if residual_rows
        else None
    )
    expected_residual_id = (
        strongest_residual["id"] if strongest_residual is not None else None
    )
    expected_residual_ic = (
        strongest_residual["validation"]["nearestPeerResidual"][
            "meanRankIc"
        ]
        if strongest_residual is not None
        else None
    )
    if diagnosis["strongest_residual_component"] != expected_residual_id:
        _fail(
            "factor_components/validation_diagnosis/"
            "strongest_residual_component",
            "factor.component-diagnosis",
            "Strongest residual component does not reconcile",
        )
    _close(
        expected_residual_ic,
        diagnosis["strongest_residual_mean_ic"],
        "factor_components/validation_diagnosis/"
        "strongest_residual_mean_ic",
        "strongest residual component IC",
    )
    removal_rows = [
        row
        for row in projected_components
        if row["validation"]["fixedBlendRemovalDeltaMeanIc"] is not None
    ]
    best_removal = (
        max(
            removal_rows,
            key=lambda row: (
                float(
                    row["validation"]["fixedBlendRemovalDeltaMeanIc"]
                ),
                row["id"],
            ),
        )
        if removal_rows
        else None
    )
    expected_removal_id = (
        best_removal["id"] if best_removal is not None else None
    )
    expected_removal_delta = (
        best_removal["validation"]["fixedBlendRemovalDeltaMeanIc"]
        if best_removal is not None
        else None
    )
    if diagnosis["removal_most_improves_fixed_blend"] != expected_removal_id:
        _fail(
            "factor_components/validation_diagnosis/"
            "removal_most_improves_fixed_blend",
            "factor.component-diagnosis",
            "Best fixed-blend removal does not reconcile",
        )
    _close(
        expected_removal_delta,
        diagnosis["best_removal_delta_mean_ic"],
        "factor_components/validation_diagnosis/"
        "best_removal_delta_mean_ic",
        "best fixed-blend removal delta",
    )
    finite_pair_rows = [
        row
        for row in projected_pairs
        if row["train"]["meanAbsoluteRankAssociation"] is not None
    ]
    redundant_pair = (
        max(
            finite_pair_rows,
            key=lambda row: (
                float(
                    row["train"]["meanAbsoluteRankAssociation"] or -1.0
                ),
                row["left"],
                row["right"],
            ),
        )
        if finite_pair_rows
        else None
    )
    raw_redundant = diagnosis["most_redundant_pair"]
    expected_redundant = (
        {
            "left": redundant_pair["left"],
            "right": redundant_pair["right"],
            "train_mean_absolute_rank_association": redundant_pair[
                "train"
            ]["meanAbsoluteRankAssociation"],
        }
        if redundant_pair is not None
        else None
    )
    if raw_redundant != expected_redundant:
        _fail(
            "factor_components/validation_diagnosis/most_redundant_pair",
            "factor.component-diagnosis",
            "Most redundant pair does not reconcile train evidence",
        )
    return {
        **base,
        "available": True,
        "reason": None,
        "declaration": {
            "sourceInference": False,
            "exhaustiveCompositionClaim": False,
            "components": declared,
        },
        "semantics": {
            "evaluationMode": semantics["evaluation_mode"],
            "predictionTarget": semantics["prediction_target"],
            "scoreMeasure": semantics["score_measure"],
            "nearestPeerSelection": semantics["nearest_peer_selection"],
            "residualization": semantics["residualization"],
            "diagnosticBlend": semantics["diagnostic_blend"],
            "ablationTarget": semantics["ablation_target"],
            "componentRoles": semantics["component_roles"],
            "timestampContext": semantics["timestamp_context"],
            "testRole": semantics["test_role"],
            "promotionAuthority": semantics["promotion_authority"],
            "portfolioAuthority": semantics["portfolio_authority"],
            "rlActionAuthority": semantics["rl_action_authority"],
        },
        "trialDisclosure": {
            "materializedComponents": len(declared_by_id),
            "crossSectionalScoreComponents": len(score_ids),
            "timestampContextComponents": len(context_ids),
            "pairwiseComparisons": expected_pairs,
            "entersPromotionScore": False,
        },
        "validationDiagnosis": {
            "strongestRawComponent": diagnosis[
                "strongest_raw_component"
            ],
            "strongestRawMeanIc": (
                _finite(
                    diagnosis["strongest_raw_mean_ic"],
                    "factor_components/diagnosis/strongest_raw_mean_ic",
                )
                if diagnosis["strongest_raw_mean_ic"] is not None
                else None
            ),
            "strongestResidualComponent": diagnosis[
                "strongest_residual_component"
            ],
            "strongestResidualMeanIc": (
                _finite(
                    diagnosis["strongest_residual_mean_ic"],
                    "factor_components/diagnosis/"
                    "strongest_residual_mean_ic",
                )
                if diagnosis["strongest_residual_mean_ic"] is not None
                else None
            ),
            "removalMostImprovesFixedBlend": diagnosis[
                "removal_most_improves_fixed_blend"
            ],
            "bestRemovalDeltaMeanIc": (
                _finite(
                    diagnosis["best_removal_delta_mean_ic"],
                    "factor_components/diagnosis/"
                    "best_removal_delta_mean_ic",
                )
                if diagnosis["best_removal_delta_mean_ic"] is not None
                else None
            ),
            "mostRedundantPair": (
                {
                    "left": raw_redundant["left"],
                    "right": raw_redundant["right"],
                    "trainMeanAbsoluteRankAssociation": raw_redundant[
                        "train_mean_absolute_rank_association"
                    ],
                }
                if raw_redundant is not None
                else None
            ),
            "authority": diagnosis["authority"],
            "testEntersDiagnosis": False,
        },
        "components": projected_components,
        "pairwise": projected_pairs,
        "fixedBlend": {
            "available": blend_profile is not None,
            "reason": fixed_blend["reason"],
            "horizonProfile": blend_profile,
        },
    }


def _summary(metrics: dict[str, Any]) -> dict[str, Any]:
    validation = _ic_summary(metrics.get("validation"), "metrics/validation")
    test = _ic_summary(metrics.get("test"), "metrics/test")
    folds = metrics.get("stability", {}).get("chronological_folds")
    styles = metrics.get("style_correlations", {}).get("validation")
    if not isinstance(folds, dict) or not isinstance(styles, dict):
        _fail(
            "RunResult/metrics",
            "factor.stability",
            "Factor Run is missing fold/style stability",
        )
    validation_folds = [
        (name, _optional_finite(value.get("mean_ic"), f"folds/{name}/mean_ic"))
        for name, value in folds.items()
        if name.startswith("validation_") and isinstance(value, dict)
    ]
    finite_folds = [
        (name, value) for name, value in validation_folds if value is not None
    ]
    worst_fold = min(finite_folds, key=lambda item: item[1]) if finite_folds else None
    style_values = [
        (
            name,
            _optional_finite(
                value.get("mean_rank_correlation"),
                f"styles/{name}/mean_rank_correlation",
            ),
        )
        for name, value in styles.items()
        if isinstance(value, dict)
    ]
    finite_styles = [
        (name, value) for name, value in style_values if value is not None
    ]
    maximum_style = (
        max(finite_styles, key=lambda item: abs(item[1]))
        if finite_styles
        else None
    )
    mean_coverage = _bounded(
        metrics.get("mean_coverage"),
        "metrics/mean_coverage",
        minimum=0.0,
        maximum=1.0,
    )
    mean_turnover = _bounded(
        metrics.get("mean_rank_turnover"),
        "metrics/mean_rank_turnover",
        minimum=0.0,
        maximum=1.0,
    )
    return {
        "validation": validation,
        "testAudit": test,
        "meanCoverage": mean_coverage,
        "meanRankTurnover": mean_turnover,
        "weakestValidationFold": (
            {"id": worst_fold[0], "meanRankIc": worst_fold[1]}
            if worst_fold
            else None
        ),
        "maximumValidationStyleOverlap": (
            {
                "style": maximum_style[0],
                "meanRankCorrelation": maximum_style[1],
                "absoluteMeanRankCorrelation": abs(maximum_style[1]),
            }
            if maximum_style
            else None
        ),
    }


def _horizon_profile(metrics: dict[str, Any]) -> list[dict[str, Any]]:
    quality = metrics["horizon_quality"]
    return [
        {
            "horizon": horizon,
            **{
                split_name: {
                    **_ic_summary(
                        quality[str(horizon)][split_name],
                        f"metrics/horizon_quality/{horizon}/{split_name}",
                    ),
                    "role": SPLIT_ROLES[split_name],
                }
                for split_name in SPLITS
            },
        }
        for horizon in HORIZONS
    ]


def _quantile_summary(
    metrics: dict[str, Any],
    *,
    modern_outcome_contract: bool,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    analysis = metrics["quantile_analysis"]
    for horizon in HORIZONS:
        for split_name in SPLITS:
            value = analysis[str(horizon)][split_name]
            means = value[
                "mean_outcome_by_quantile"
                if modern_outcome_contract
                else "mean_return_by_quantile"
            ]
            output.append(
                {
                    "horizon": horizon,
                    "split": split_name,
                    "role": SPLIT_ROLES[split_name],
                    "low": _optional_finite(
                        means.get("low"),
                        f"quantiles/{horizon}/{split_name}/low",
                    ),
                    "middle": _optional_finite(
                        means.get("middle"),
                        f"quantiles/{horizon}/{split_name}/middle",
                    ),
                    "high": _optional_finite(
                        means.get("high"),
                        f"quantiles/{horizon}/{split_name}/high",
                    ),
                    "highMinusLow": _optional_finite(
                        value.get("high_minus_low"),
                        f"quantiles/{horizon}/{split_name}/spread",
                    ),
                    "monotonicity": _optional_finite(
                        value.get("monotonicity"),
                        f"quantiles/{horizon}/{split_name}/monotonicity",
                    ),
                    "observations": _integer(
                        value.get("observations"),
                        f"quantiles/{horizon}/{split_name}/observations",
                    ),
                }
            )
    return output


def _quantile_evidence(
    semantics: dict[str, Any],
    evaluation_mode: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Project whether fixed tertile evidence applies to this evaluation mode."""

    method = semantics.get("quantiles")
    if evaluation_mode in {
        SINGLE_ASSET_TEMPORAL_MODE,
        TWO_ASSET_RELATIVE_VALUE_MODE,
    }:
        if method != "unavailable-for-temporal-evaluation-v1" or rows:
            _fail(
                "factor-report/semantics/quantiles",
                "factor.quantile-protocol",
                "Temporal Factor evidence must declare protocol-unavailable "
                "quantiles and publish an empty reconciled artifact",
            )
        return {
            "status": "protocol-unavailable",
            "evaluationMode": evaluation_mode,
            "method": method,
            "artifactKind": "factor-quantiles",
            "artifactRows": 0,
            "reasonCode": "temporal-tertiles-not-defined",
            "reason": (
                "Fixed low/middle/high groups require a cross-sectional "
                "prediction population at each timestamp; "
                f"{evaluation_mode} evaluates one temporal score path, so "
                "null tertiles are protocol-not-applicable rather than "
                "missing or failed evidence."
            ),
            "authority": "diagnostic-only",
        }
    if method != "fixed low/middle/high cross-sectional groups" or not rows:
        _fail(
            "factor-report/semantics/quantiles",
            "factor.quantile-protocol",
            "Cross-sectional Factor evidence must declare and publish fixed "
            "low/middle/high quantile groups",
        )
    return {
        "status": "available",
        "evaluationMode": evaluation_mode,
        "method": method,
        "artifactKind": "factor-quantiles",
        "artifactRows": len(rows),
        "reasonCode": None,
        "reason": None,
        "authority": "diagnostic-only",
    }


def _stability(metrics: dict[str, Any], universe: list[str]) -> dict[str, Any]:
    stability = metrics.get("stability")
    styles = metrics.get("style_correlations")
    if not isinstance(stability, dict) or not isinstance(styles, dict):
        _fail("RunResult/metrics", "factor.stability", "Missing stability evidence")
    folds = stability.get("chronological_folds")
    regimes = stability.get("causal_regimes")
    assets = stability.get("per_asset")
    if not all(isinstance(value, dict) for value in (folds, regimes, assets)):
        _fail("RunResult/metrics/stability", "factor.stability", "Invalid stability")
    expected_folds = {
        f"{split_name}_{number}"
        for split_name in SPLITS
        for number in (1, 2)
    }
    if set(folds) != expected_folds:
        _fail(
            "RunResult/metrics/stability/chronological_folds",
            "factor.stability-folds",
            "Expected exactly two chronological folds per split",
        )
    fold_rows = []
    for name, value in folds.items():
        if not isinstance(value, dict):
            _fail(f"stability/folds/{name}", "factor.stability", "Invalid fold")
        split_name = name.split("_", 1)[0]
        if split_name not in SPLIT_ROLES:
            _fail(f"stability/folds/{name}", "factor.stability", "Invalid fold split")
        fold_rows.append(
            {
                "id": name,
                "split": split_name,
                "role": SPLIT_ROLES[split_name],
                **_rank_summary(value, f"stability/folds/{name}"),
            }
        )
    regime_rows = []
    for split_name in SPLITS:
        split = regimes.get(split_name)
        if (
            not isinstance(split, dict)
            or set(split) != REGIMES - {"unavailable"}
        ):
            _fail(
                f"stability/regimes/{split_name}",
                "factor.stability",
                "Expected the complete fixed causal-regime dictionary",
            )
        for regime, value in split.items():
            if regime not in REGIMES - {"unavailable"} or not isinstance(value, dict):
                _fail(
                    f"stability/regimes/{split_name}/{regime}",
                    "factor.stability",
                    "Invalid regime evidence",
                )
            regime_rows.append(
                {
                    "split": split_name,
                    "role": SPLIT_ROLES[split_name],
                    "regime": regime,
                    **_rank_summary(
                        value,
                        f"stability/regimes/{split_name}/{regime}",
                    ),
                }
            )
    asset_rows = []
    for split_name in SPLITS:
        split = assets.get(split_name)
        if not isinstance(split, dict) or set(split) != set(universe):
            _fail(
                f"stability/assets/{split_name}",
                "factor.stability-universe",
                "Per-asset stability must match the Run universe",
            )
        for asset in universe:
            value = split[asset]
            if not isinstance(value, dict):
                _fail(
                    f"stability/assets/{split_name}/{asset}",
                    "factor.stability",
                    "Invalid per-asset evidence",
                )
            asset_rows.append(
                {
                    "split": split_name,
                    "role": SPLIT_ROLES[split_name],
                    "asset": asset,
                    "rankCorrelation": _optional_finite(
                        value.get("rank_correlation"),
                        f"stability/assets/{split_name}/{asset}/rank_correlation",
                    ),
                    "observations": _integer(
                        value.get("observations"),
                        f"stability/assets/{split_name}/{asset}/observations",
                    ),
                }
            )
    style_rows = []
    for split_name in SPLITS:
        split = styles.get(split_name)
        if not isinstance(split, dict) or set(split) != STYLES:
            _fail(
                f"styles/{split_name}",
                "factor.styles",
                "Expected the complete fixed style-overlap dictionary",
            )
        for style, value in split.items():
            if not isinstance(value, dict):
                _fail(f"styles/{split_name}/{style}", "factor.styles", "Invalid style")
            style_rows.append(
                {
                    "split": split_name,
                    "role": SPLIT_ROLES[split_name],
                    "style": style,
                    "meanRankCorrelation": _optional_finite(
                        value.get("mean_rank_correlation"),
                        f"styles/{split_name}/{style}/mean_rank_correlation",
                    ),
                    "meanAbsoluteRankCorrelation": _optional_finite(
                        value.get("mean_absolute_rank_correlation"),
                        f"styles/{split_name}/{style}/mean_absolute_rank_correlation",
                    ),
                    "observations": _integer(
                        value.get("observations"),
                        f"styles/{split_name}/{style}/observations",
                    ),
                }
            )
    return {
        "chronologicalFolds": fold_rows,
        "causalRegimes": regime_rows,
        "assets": asset_rows,
        "styles": style_rows,
    }


def _sample_indices(
    total: int,
    limit: int,
    required: set[int],
    preferred: set[int],
) -> list[int]:
    if total <= limit:
        return list(range(total))
    selected = {index for index in required if 0 <= index < total}
    if len(selected) > limit:
        _fail(
            "factor sampling",
            "factor.sample-limit",
            "Point limit is smaller than required Factor anchors",
        )
    preferred_candidates = sorted(
        index
        for index in preferred
        if 0 <= index < total and index not in selected
    )
    preferred_slots = min(limit - len(selected), len(preferred_candidates))
    if preferred_slots and preferred_slots < len(preferred_candidates):
        positions = {
            round(
                position
                * (len(preferred_candidates) - 1)
                / max(1, preferred_slots - 1)
            )
            for position in range(preferred_slots)
        }
        selected.update(preferred_candidates[position] for position in positions)
    else:
        selected.update(preferred_candidates[:preferred_slots])
    candidates = [index for index in range(total) if index not in selected]
    slots = limit - len(selected)
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
            selected.update(candidates[: limit - len(selected)])
    return sorted(selected)


def _paths(
    daily: ParsedDaily,
    quantiles: list[dict[str, Any]],
    point_limit: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    required = {0, len(daily.rows) - 1}
    preferred: set[int] = set()
    primary_rank_key = f"rankIcH{PRIMARY_HORIZON}"
    maximum = max(
        range(len(daily.rows)),
        key=lambda index: abs(
            daily.rows[index][primary_rank_key] or 0.0
        ),
    )
    required.add(maximum)
    for index in range(1, len(daily.rows)):
        before = daily.rows[index - 1]
        current = daily.rows[index]
        if before["split"] != current["split"]:
            required.update({index - 1, index})
        if before["regime"] != current["regime"]:
            preferred.update({index - 1, index})
    selected = _sample_indices(
        len(daily.rows),
        point_limit,
        required,
        preferred,
    )
    selected_dates = {daily.dates[index] for index in selected}
    ic_path = {
        "totalRows": len(daily.rows),
        "sampledRows": len(selected),
        "pointLimit": point_limit,
        "sampling": "deterministic-even-with-split-regime-extreme-anchors",
        "points": [daily.rows[index] for index in selected],
    }
    quantile_points = [
        row for row in quantiles if row["timestamp"] in selected_dates
    ]
    return ic_path, {
        "totalRows": len(quantiles),
        "sampledRows": len(quantile_points),
        "timestampAnchors": len(selected_dates),
        "sampling": "aligned-to-ic-path-timestamps",
        "points": quantile_points,
    }


def _coverage(report: dict[str, Any], universe: list[str]) -> list[dict[str, Any]]:
    coverage = report.get("coverageByAsset")
    if not isinstance(coverage, dict) or set(coverage) != set(universe):
        _fail(
            "factor-report/coverageByAsset",
            "factor.coverage-universe",
            "Factor coverage must exactly match the Run universe",
        )
    return [
        {
            "asset": asset,
            "coverage": _bounded(
                coverage[asset],
                f"factor-report/coverageByAsset/{asset}",
                minimum=0.0,
                maximum=1.0,
            ),
        }
        for asset in universe
    ]


def _load_factor_diagnostics_unlocked(
    project: ProjectContext,
    run_id: str,
    *,
    point_limit: int = DEFAULT_FACTOR_POINTS,
) -> dict[str, Any]:
    """Verify and project one immutable Factor Run into a bounded read model."""

    if (
        not isinstance(point_limit, int)
        or isinstance(point_limit, bool)
        or not MIN_FACTOR_POINTS <= point_limit <= MAX_FACTOR_POINTS
    ):
        _fail(
            point_limit,
            "factor.point-limit",
            f"point_limit must be {MIN_FACTOR_POINTS}..{MAX_FACTOR_POINTS}",
        )
    run = load_run(project, run_id)
    if run.result["objective"]["metric"] != "validation_mean_ic":
        _fail(
            run.root_dir,
            "factor.run-kind",
            "Run is not a fixed Factor Lab evaluation",
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
            "factor.universe",
            f"Factor universe must contain 1..{MAX_UNIVERSE} unique assets",
        )
    paths, artifacts = _artifact_paths(run)
    try:
        report = json.loads(paths["factor-report"].read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        _fail(
            paths["factor-report"],
            "factor.report-json",
            "Factor report must be one UTF-8 JSON object",
        )
    if not isinstance(report, dict):
        _fail(paths["factor-report"], "factor.report-json", "Report must be an object")
    if report.get("inputHash") != run.result["inputHash"]:
        _fail(
            paths["factor-report"],
            "factor.report-identity",
            "Factor report input identity differs from RunResult",
        )
    if report.get("metrics") != run.result["metrics"]:
        _fail(
            paths["factor-report"],
            "factor.report-metrics",
            "Factor report metrics differ from immutable RunResult",
        )
    research_horizon = _configure_horizons(run, report)
    report_dataset = report.get("dataset")
    if (
        not isinstance(report_dataset, dict)
        or report_dataset.get("universe") != universe
        or report_dataset.get("id") != run.result["dataset"].get("id")
        or report_dataset.get("version") != run.result["dataset"].get("version")
    ):
        _fail(
            paths["factor-report"],
            "factor.report-dataset",
            "Factor report dataset differs from immutable RunResult",
        )
    metrics = run.result["metrics"]
    outcome_claim = validate_factor_claim(
        metrics.get("factor_claim"),
        "RunResult/metrics/factor_claim",
    )
    outcome_contract = factor_outcome_contract(outcome_claim)
    modern_outcome_contract = "factor_outcome" in metrics
    if modern_outcome_contract:
        if metrics.get("factor_outcome") != outcome_contract:
            _fail(
                "RunResult/metrics/factor_outcome",
                "factor.outcome-contract",
                "Factor outcome does not reconcile the fixed claim",
            )
    elif "outcome" in outcome_claim:
        _fail(
            "RunResult/metrics/factor_outcome",
            "factor.outcome-contract",
            "An explicit Factor outcome requires an immutable outcome contract",
        )
    prediction_universe = _prediction_universe(
        metrics,
        universe,
        outcome_claim,
    )
    if prediction_universe["available"] and (
        report_dataset.get("predictionAssets")
        != prediction_universe["predictionAssets"]
        or report_dataset.get("contextAssets")
        != prediction_universe["contextAssets"]
    ):
        _fail(
            paths["factor-report"],
            "factor.prediction-universe",
            "Factor report prediction universe differs from immutable metrics",
        )
    protocol = _split_protocol(metrics)
    daily = _parse_daily(
        paths["factor-daily"],
        protocol,
        prediction_universe["evaluationMode"],
    )
    _reconcile_daily(daily, metrics)
    if AVAILABILITY_ARTIFACT_KIND in paths:
        input_availability, availability_rows = _availability(
            paths[AVAILABILITY_ARTIFACT_KIND],
            metrics,
            report,
            universe,
        )
    else:
        input_availability = {
            "available": False,
            "reason": "legacy-run",
        }
        availability_rows = []
    quantiles = _parse_quantiles(paths["factor-quantiles"], daily)
    _reconcile_quantiles(
        quantiles,
        metrics,
        modern_outcome_contract=modern_outcome_contract,
    )
    qualification_parsed = (
        _parse_factor_qualification(
            paths[QUALIFICATION_ARTIFACT_KIND],
            daily,
            metrics,
        )[1]
        if QUALIFICATION_ARTIFACT_KIND in paths
        else None
    )
    component_evidence = None
    if COMPONENT_ARTIFACT_KIND in paths:
        try:
            component_artifact = json.loads(
                paths[COMPONENT_ARTIFACT_KIND].read_text(encoding="utf-8")
            )
        except (UnicodeDecodeError, json.JSONDecodeError):
            _fail(
                paths[COMPONENT_ARTIFACT_KIND],
                "factor.component-json",
                "Factor component artifact must be one UTF-8 JSON object",
            )
        if (
            not isinstance(component_artifact, dict)
            or set(component_artifact)
            != {"schemaVersion", "inputHash", "evidence"}
            or component_artifact.get("schemaVersion") != SCHEMA_VERSION
            or component_artifact.get("inputHash")
            != run.result["inputHash"]
            or component_artifact.get("evidence")
            != metrics.get("factor_components")
        ):
            _fail(
                paths[COMPONENT_ARTIFACT_KIND],
                "factor.component-reconciliation",
                "Factor component artifact does not reconcile immutable Run "
                "identity and metrics",
            )
        component_evidence = component_artifact["evidence"]
    ic_path, quantile_path = _paths(daily, quantiles, point_limit)
    selected_dates = {
        row["timestamp"] for row in ic_path["points"]
    }
    availability_points = [
        row
        for row in availability_rows
        if row["timestamp"] in selected_dates
    ]
    availability_path = {
        "totalRows": len(availability_rows),
        "sampledRows": len(availability_points),
        "sampling": "source-panel-filtered-to-ic-path-timestamps",
        "points": availability_points,
    }
    semantics = report.get("semantics")
    declared_styles = (
        semantics.get("styles") if isinstance(semantics, dict) else None
    )
    if (
        not isinstance(semantics, dict)
        or semantics.get("horizons") != list(HORIZONS)
        or semantics.get("primaryHorizon") != PRIMARY_HORIZON
        or not isinstance(declared_styles, list)
        or set(declared_styles) != STYLES
    ):
        _fail(
            paths["factor-report"],
            "factor.report-semantics",
            "Factor report must declare the fixed horizon and style semantics",
        )
    if modern_outcome_contract and (
        semantics.get("outcome") != outcome_contract
        or semantics.get("target") != outcome_contract["targetSemantics"]
    ):
        _fail(
            paths["factor-report"],
            "factor.report-outcome",
            "Factor report outcome semantics differ from immutable metrics",
        )
    qualification_semantics = semantics.get("qualification")
    qualification_method = (
        qualification_parsed["method"]
        if qualification_parsed is not None
        else None
    )
    expected_neutralization = (
        "within-split-temporal-centered-rank-ols"
        if qualification_method == TEMPORAL_QUALIFICATION_METHOD
        else "same-timestamp-cross-sectional-centered-rank-ols"
    )
    expected_blend = (
        "equal-weight-within-split-temporal-percentile-ranks"
        if qualification_method == TEMPORAL_QUALIFICATION_METHOD
        else "equal-weight-cross-sectional-percentile-ranks"
    )
    if qualification_parsed is not None and (
        not isinstance(qualification_semantics, dict)
        or qualification_semantics.get("method") != qualification_method
        or qualification_semantics.get("claim")
        != qualification_parsed["claim"]
        or qualification_semantics.get("styleSelection")
        != (
            "request-predeclared"
            if qualification_parsed["claim"]["claim"]
            == "known-style-validation"
            else "train-only"
        )
        or qualification_semantics.get("neutralization")
        != expected_neutralization
        or qualification_semantics.get("blend")
        != expected_blend
        or qualification_semantics.get("testRole")
        != "visible audit only"
        or qualification_semantics.get("tradingAuthority") != "none"
    ):
        _fail(
            paths["factor-report"],
            "factor.qualification-semantics",
            "Factor report qualification semantics are invalid",
        )
    component_semantics = semantics.get("components")
    raw_component_semantics = (
        component_evidence.get("semantics")
        if isinstance(component_evidence, dict)
        else None
    )
    expected_component_semantics = (
        {
            "method": COMPONENT_METHOD,
            "evaluationMode": raw_component_semantics["evaluation_mode"],
            "scoreMeasure": raw_component_semantics["score_measure"],
            **(
                {
                    "predictionTarget": raw_component_semantics[
                        "prediction_target"
                    ]
                }
                if isinstance(component_semantics, dict)
                and "predictionTarget" in component_semantics
                else {}
            ),
            "declaration": "candidate-explicit-not-source-inferred",
            "roles": [
                "cross-sectional-score",
                "timestamp-context",
            ],
            "exhaustiveCompositionClaim": False,
            "nearestPeerSelection": "train-only-target-free",
            "ablationTarget": "fixed-diagnostic-blend-not-candidate-factor",
            "residualization": raw_component_semantics["residualization"],
            "diagnosticBlend": raw_component_semantics["diagnostic_blend"],
            "timestampContext": raw_component_semantics["timestamp_context"],
            "testRole": "visible audit only",
            "portfolioAuthority": "none",
            "rlActionAuthority": "none",
            "tradingAuthority": "none",
        }
        if isinstance(raw_component_semantics, dict)
        and {
            "evaluation_mode",
            "score_measure",
            "residualization",
            "diagnostic_blend",
            "timestamp_context",
        }.issubset(raw_component_semantics)
        else None
    )
    if component_evidence is not None and (
        expected_component_semantics is None
        or component_semantics != expected_component_semantics
    ):
        _fail(
            paths["factor-report"],
            "factor.component-semantics",
            "Factor report component semantics are invalid",
        )
    if component_evidence is None and component_semantics is not None:
        _fail(
            paths["factor-report"],
            "factor.component-semantics",
            "Legacy Factor report cannot declare unavailable component evidence",
        )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": FACTOR_DIAGNOSTICS_KIND,
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
            "universe": universe,
        },
        "harness": run.result["harness"],
        "researchHorizon": research_horizon,
        "factorOutcome": outcome_contract,
        "predictionUniverse": prediction_universe,
        "artifacts": artifacts,
        "protocol": {
            "selectionSplit": "validation",
            "testRole": "visible-diagnostic",
            "testEntersSelection": False,
            "horizons": list(HORIZONS),
            "primaryHorizon": PRIMARY_HORIZON,
            "semantics": semantics,
            "splits": protocol,
        },
        "summary": _summary(metrics),
        "inputAvailability": input_availability,
        "factorQualification": _factor_qualification_projection(
            qualification_parsed
        ),
        "factorComponents": _factor_components_projection(
            component_evidence,
            universe,
            prediction_universe["evaluationMode"],
            (
                outcome_contract["targetSemantics"]
                if modern_outcome_contract
                else "fixed-purged-forward-base-bar-return"
            ),
        ),
        "horizonProfile": _horizon_profile(metrics),
        "quantileEvidence": _quantile_evidence(
            semantics,
            prediction_universe["evaluationMode"],
            quantiles,
        ),
        "quantileSummary": _quantile_summary(
            metrics,
            modern_outcome_contract=modern_outcome_contract,
        ),
        "stability": _stability(
            metrics,
            prediction_universe["predictionAssets"],
        ),
        "coverage": _coverage(report, universe),
        "availabilityPath": availability_path,
        "icPath": ic_path,
        "quantilePath": quantile_path,
        "warning": (
            f"Validation {PRIMARY_HORIZON}-bar rank IC is the fixed selection "
            "objective. Test, non-primary-horizon, quantile, stability, and "
            "style evidence are diagnostic and do not change the immutable "
            "verdict."
        ),
    }


def load_factor_diagnostics(
    project: ProjectContext,
    run_id: str,
    *,
    point_limit: int = DEFAULT_FACTOR_POINTS,
) -> dict[str, Any]:
    """Verify and project one immutable Factor Run into a bounded read model."""

    # The artifact parsers use column names derived from the per-Run Horizon
    # Mandate. Keep each complete projection under one lock because Studio may
    # serve Runs with different horizon policies concurrently.
    with _HORIZON_CONFIGURATION_LOCK:
        return _load_factor_diagnostics_unlocked(
            project,
            run_id,
            point_limit=point_limit,
        )


_FACTOR_QUALIFICATION_SCHEMA: dict[str, Any] = {
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
                "method": {"enum": sorted(QUALIFICATION_METHODS)},
                "authority": {"const": "research-prioritization-only"},
                "tradingAuthority": {"const": "none"},
                "available": {"const": False},
                "reason": {
                    "const": "legacy-run-without-factor-qualification"
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
                "claim",
                "selection",
                "semantics",
                "diagnosis",
                "validation",
                "testAudit",
                "horizonProfile",
            ],
            "properties": {
                "method": {"enum": sorted(QUALIFICATION_METHODS)},
                "authority": {"const": "research-prioritization-only"},
                "tradingAuthority": {"const": "none"},
                "available": {"const": True},
                "reason": {"type": "null"},
                "claim": FACTOR_CLAIM_JSON_SCHEMA,
                "selection": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "split",
                        "role",
                        "criterion",
                        "dominantStyle",
                        "candidates",
                        "validationEntersSelection",
                        "testEntersSelection",
                    ],
                    "properties": {
                        "split": {"const": "train"},
                        "role": {
                            "const": "comparison-style-selection-only"
                        },
                        "criterion": {
                            "enum": [
                                "maximum-absolute-mean-daily-rank-overlap",
                                "maximum-absolute-mean-temporal-rank-overlap",
                                "request-predeclared-known-style",
                            ]
                        },
                        "dominantStyle": {"enum": sorted(STYLES)},
                        "candidates": {
                            "type": "array",
                            "minItems": len(STYLES),
                            "maxItems": len(STYLES),
                        },
                        "validationEntersSelection": {"const": False},
                        "testEntersSelection": {"const": False},
                    },
                },
                "semantics": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "neutralization",
                        "blend",
                        "targetEntersNeutralization",
                        "diagnosisSplit",
                        "testEntersDiagnosis",
                        "factorPromotionAuthority",
                        "rlAdmissionAuthority",
                        "diagnosticThresholds",
                    ],
                    "properties": {
                        "neutralization": {
                            "enum": [
                                "same-timestamp-cross-sectional-centered-rank-ols",
                                "within-split-temporal-centered-rank-ols",
                            ]
                        },
                        "blend": {
                            "enum": [
                                "equal-weight-cross-sectional-percentile-ranks",
                                "equal-weight-within-split-temporal-percentile-ranks",
                            ]
                        },
                        "targetEntersNeutralization": {"const": False},
                        "diagnosisSplit": {"const": "validation"},
                        "testEntersDiagnosis": {"const": False},
                        "factorPromotionAuthority": {"const": False},
                        "rlAdmissionAuthority": {"const": False},
                        "diagnosticThresholds": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "minimumPositiveHacTStatistic",
                                "minimumKnownStyleRankIdentity",
                                "selectionAdjustedSignificanceRequiredSeparately",
                            ],
                            "properties": {
                                "minimumPositiveHacTStatistic": {
                                    "const": (
                                        QUALIFICATION_MIN_POSITIVE_HAC_T
                                    )
                                },
                                "minimumKnownStyleRankIdentity": {
                                    "const": 0.95
                                },
                                "selectionAdjustedSignificanceRequiredSeparately": {
                                    "const": True
                                },
                            },
                        },
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
                        "qualifiesForPortfolio",
                    ],
                    "properties": {
                        "selectionSplit": {"const": "validation"},
                        "testEntersDiagnosis": {"const": False},
                        "stage": {
                            "enum": [
                                "raw-predictive-edge-absent",
                                "raw-statistical-evidence-weak",
                                "style-neutral-edge-absent",
                                "style-neutral-statistical-evidence-weak",
                                "blend-uplift-absent",
                                "residual-temporal-instability",
                                "factor-qualification-positive",
                                "decision-signal-temporal-instability",
                                "decision-signal-positive",
                                "known-style-identity-mismatch",
                                "known-style-temporal-instability",
                                "known-style-validation-positive",
                                "risk-forecast-positive",
                            ]
                        },
                        "iterationFocus": {
                            "enum": [
                                "candidate-hypothesis-and-timing",
                                "independent-sample-and-effect-size",
                                "distinct-factor-information",
                                "residual-sample-and-effect-size",
                                "factor-combination-and-weighting",
                                "temporal-regime-robustness",
                                "portfolio-monetization-and-rl-context",
                                "known-style-implementation-identity",
                                "risk-model-report-and-external-holdout",
                            ]
                        },
                        "explanation": {"type": "string", "minLength": 1},
                        "qualifiesForPortfolio": {"type": "boolean"},
                    },
                },
                "validation": {"$ref": "#/$defs/qualificationSplit"},
                "testAudit": {"$ref": "#/$defs/qualificationSplit"},
                "horizonProfile": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 5,
                },
            },
        },
    ]
}


_FACTOR_COMPONENTS_SCHEMA: dict[str, Any] = {
    "oneOf": [
        {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "evaluationMode",
                "authority",
                "tradingAuthority",
                "available",
                "reason",
            ],
            "properties": {
                "method": {"const": COMPONENT_METHOD},
                "evaluationMode": {
                    "enum": [
                        CROSS_SECTIONAL_MODE,
                        SINGLE_ASSET_TEMPORAL_MODE,
                        TWO_ASSET_RELATIVE_VALUE_MODE,
                    ]
                },
                "authority": {"const": "research-prioritization-only"},
                "tradingAuthority": {"const": "none"},
                "available": {"const": False},
                "reason": {
                    "const": "legacy-run-without-factor-components"
                },
            },
        },
        {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "evaluationMode",
                "authority",
                "tradingAuthority",
                "available",
                "reason",
                "declaration",
                "semantics",
                "trialDisclosure",
                "validationDiagnosis",
                "components",
                "pairwise",
                "fixedBlend",
            ],
            "properties": {
                "method": {"const": COMPONENT_METHOD},
                "evaluationMode": {
                    "enum": [
                        CROSS_SECTIONAL_MODE,
                        SINGLE_ASSET_TEMPORAL_MODE,
                        TWO_ASSET_RELATIVE_VALUE_MODE,
                    ]
                },
                "authority": {"const": "research-prioritization-only"},
                "tradingAuthority": {"const": "none"},
                "available": {"const": True},
                "reason": {"type": "null"},
                "declaration": {
                    "type": "object",
                    "required": [
                        "sourceInference",
                        "exhaustiveCompositionClaim",
                        "components",
                    ],
                },
                "semantics": {
                    "type": "object",
                    "required": [
                        "predictionTarget",
                        "evaluationMode",
                        "scoreMeasure",
                        "nearestPeerSelection",
                        "residualization",
                        "diagnosticBlend",
                        "ablationTarget",
                        "componentRoles",
                        "timestampContext",
                        "testRole",
                        "promotionAuthority",
                        "portfolioAuthority",
                        "rlActionAuthority",
                    ],
                },
                "trialDisclosure": {
                    "type": "object",
                    "required": [
                        "materializedComponents",
                        "crossSectionalScoreComponents",
                        "timestampContextComponents",
                        "pairwiseComparisons",
                        "entersPromotionScore",
                    ],
                },
                "validationDiagnosis": {"type": "object"},
                "components": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_COMPONENTS,
                    "items": {
                        "type": "object",
                        "required": [
                            "id",
                            "label",
                            "role",
                            "intervals",
                            "hypothesis",
                            "meanCoverage",
                            "coverageByAsset",
                            "rawHorizonProfile",
                            "compositeAssociation",
                            "nearestPeer",
                            "nearestPeerResidualHorizonProfile",
                            "fixedBlendAblation",
                            "timestampContext",
                            "validation",
                            "testAudit",
                        ],
                        "properties": {
                            "role": {
                                "enum": [
                                    "cross-sectional-score",
                                    "timestamp-context",
                                ]
                            }
                        },
                    },
                },
                "pairwise": {
                    "type": "array",
                    "maxItems": (
                        MAX_COMPONENTS * (MAX_COMPONENTS - 1) // 2
                    ),
                },
                "fixedBlend": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["available", "reason", "horizonProfile"],
                    "properties": {
                        "available": {"type": "boolean"},
                        "reason": {"type": ["string", "null"]},
                        "horizonProfile": {
                            "anyOf": [
                                {"type": "null"},
                                {
                                    "type": "array",
                                    "minItems": 1,
                                    "maxItems": 5,
                                },
                            ]
                        },
                    },
                },
            },
        },
    ]
}


FACTOR_DIAGNOSTICS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant bounded Factor diagnostics",
    "type": "object",
    "additionalProperties": False,
    "$defs": {
        "qualificationSplit": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "role",
                "candidate",
                "dominantStyle",
                "styleNeutralCandidate",
                "equalRankBlend",
                "incremental",
                "candidateChronologicalFolds",
                "weakestCandidateFold",
                "styleNeutralChronologicalFolds",
                "weakestStyleNeutralFold",
            ],
            "properties": {
                "role": {"enum": ["selection", "visible-audit"]},
                "candidate": {"type": "object"},
                "dominantStyle": {"type": "object"},
                "styleNeutralCandidate": {"type": "object"},
                "equalRankBlend": {"type": "object"},
                "incremental": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "styleNeutralIcRetention",
                        "styleNeutralIcDelta",
                        "blendUpliftVsStyle",
                        "blendUpliftVsCandidate",
                    ],
                    "properties": {
                        "styleNeutralIcRetention": {
                            "type": ["number", "null"]
                        },
                        "styleNeutralIcDelta": {"type": "number"},
                        "blendUpliftVsStyle": {"type": "number"},
                        "blendUpliftVsCandidate": {"type": "number"},
                    },
                },
                "styleNeutralChronologicalFolds": {
                    "type": "array",
                    "minItems": 2,
                    "maxItems": 2,
                },
                "candidateChronologicalFolds": {
                    "type": "array",
                    "minItems": 2,
                    "maxItems": 2,
                },
                "weakestCandidateFold": {"type": "object"},
                "weakestStyleNeutralFold": {"type": "object"},
            },
        }
    },
    "required": [
        "schemaVersion",
        "kind",
        "run",
        "dataset",
        "harness",
        "researchHorizon",
        "factorOutcome",
        "predictionUniverse",
        "artifacts",
        "protocol",
        "summary",
        "inputAvailability",
        "factorQualification",
        "factorComponents",
        "horizonProfile",
        "quantileEvidence",
        "quantileSummary",
        "stability",
        "coverage",
        "availabilityPath",
        "icPath",
        "quantilePath",
        "warning",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": FACTOR_DIAGNOSTICS_KIND},
        "run": {"type": "object"},
        "dataset": {
            "type": "object",
            "required": ["id", "version", "hash", "timeRange", "universe"],
        },
        "harness": {"type": "object"},
        "researchHorizon": RESEARCH_HORIZON_JSON_SCHEMA,
        "factorOutcome": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "explicit",
                "label",
                "targetSemantics",
                "scoreDirection",
                "annualization",
                "downstreamMeaning",
                "portfolioAuthority",
                "rlAuthority",
                "tradingAuthority",
            ],
            "properties": {
                "kind": {
                    "enum": [
                        "forward-return",
                        "forward-realized-volatility",
                    ]
                },
                "explicit": {"type": "boolean"},
                "label": {"type": "string"},
                "targetSemantics": {"type": "string"},
                "scoreDirection": {
                    "const": "higher-factor-predicts-higher-outcome"
                },
                "annualization": {
                    "enum": ["not-applicable", "none"]
                },
                "downstreamMeaning": {
                    "enum": [
                        "expected-return-research-only",
                        "risk-forecast-only-no-return-signal",
                    ]
                },
                "portfolioAuthority": {
                    "enum": ["qualification-gated", "none"]
                },
                "rlAuthority": {
                    "enum": ["portfolio-evidence-gated", "none"]
                },
                "tradingAuthority": {"const": "none"},
            },
        },
        "predictionUniverse": {"type": "object"},
        "artifacts": {
            "type": "object",
            "required": sorted(BASE_ARTIFACT_KINDS),
        },
        "protocol": {
            "type": "object",
            "required": [
                "selectionSplit",
                "testRole",
                "testEntersSelection",
                "horizons",
                "primaryHorizon",
                "semantics",
                "splits",
            ],
            "properties": {
                "selectionSplit": {"const": "validation"},
                "testRole": {"const": "visible-diagnostic"},
                "testEntersSelection": {"const": False},
                "horizons": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 5,
                    "uniqueItems": True,
                    "items": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 252,
                    },
                },
                "primaryHorizon": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 252,
                },
                "semantics": {"type": "object"},
                "splits": {"type": "object"},
            },
        },
        "summary": {"type": "object"},
        "inputAvailability": {
            "oneOf": [
                {
                    "type": "object",
                    "required": ["available", "reason"],
                    "properties": {
                        "available": {"const": False},
                        "reason": {"const": "legacy-run"},
                    },
                },
                {
                    "type": "object",
                    "required": [
                        "available",
                        "method",
                        "missingObservation",
                        "timestamps",
                        "observedRows",
                        "possibleRows",
                        "observationCoverage",
                        "completeTimestamps",
                        "minimumAssetsPerFactorTimestamp",
                        "eligibleFactorTimestamps",
                        "assetsPerTimestamp",
                        "byAsset",
                    ],
                    "properties": {
                        "available": {"const": True},
                        "method": {
                            "const": "observed-only-no-fill-v1"
                        },
                        "missingObservation": {
                            "const": "absent-no-fill"
                        },
                        "timestamps": {
                            "type": "integer",
                            "minimum": 1,
                        },
                        "observedRows": {
                            "type": "integer",
                            "minimum": 1,
                        },
                        "possibleRows": {
                            "type": "integer",
                            "minimum": 1,
                        },
                        "observationCoverage": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "completeTimestamps": {
                            "type": "integer",
                            "minimum": 0,
                        },
                        "minimumAssetsPerFactorTimestamp": {
                            "enum": [1, 2, 4]
                        },
                        "eligibleFactorTimestamps": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": 5,
                        },
                        "assetsPerTimestamp": {"type": "object"},
                        "byAsset": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": MAX_UNIVERSE,
                        },
                    },
                },
            ]
        },
        "factorQualification": _FACTOR_QUALIFICATION_SCHEMA,
        "factorComponents": _FACTOR_COMPONENTS_SCHEMA,
        "horizonProfile": {
            "type": "array",
            "minItems": 1,
            "maxItems": 5,
        },
        "quantileEvidence": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "status",
                "evaluationMode",
                "method",
                "artifactKind",
                "artifactRows",
                "reasonCode",
                "reason",
                "authority",
            ],
            "properties": {
                "status": {
                    "enum": ["available", "protocol-unavailable"]
                },
                "evaluationMode": {
                    "enum": [
                        CROSS_SECTIONAL_MODE,
                        SINGLE_ASSET_TEMPORAL_MODE,
                        TWO_ASSET_RELATIVE_VALUE_MODE,
                    ]
                },
                "method": {
                    "enum": [
                        "fixed low/middle/high cross-sectional groups",
                        "unavailable-for-temporal-evaluation-v1",
                    ]
                },
                "artifactKind": {"const": "factor-quantiles"},
                "artifactRows": {"type": "integer", "minimum": 0},
                "reasonCode": {
                    "enum": [None, "temporal-tertiles-not-defined"]
                },
                "reason": {"type": ["string", "null"]},
                "authority": {"const": "diagnostic-only"},
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "status": {"const": "protocol-unavailable"}
                        }
                    },
                    "then": {
                        "properties": {
                            "artifactRows": {"const": 0},
                            "reasonCode": {
                                "const": "temporal-tertiles-not-defined"
                            },
                            "reason": {"type": "string", "minLength": 1},
                        }
                    },
                    "else": {
                        "properties": {
                            "artifactRows": {"type": "integer", "minimum": 1},
                            "reasonCode": {"const": None},
                            "reason": {"const": None},
                        }
                    },
                }
            ],
        },
        "quantileSummary": {
            "type": "array",
            "minItems": len(SPLITS),
            "maxItems": 5 * len(SPLITS),
        },
        "stability": {"type": "object"},
        "coverage": {
            "type": "array",
            "minItems": 1,
            "maxItems": MAX_UNIVERSE,
        },
        "availabilityPath": {
            "type": "object",
            "required": [
                "totalRows",
                "sampledRows",
                "sampling",
                "points",
            ],
            "properties": {
                "totalRows": {"type": "integer", "minimum": 0},
                "sampledRows": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": MAX_FACTOR_POINTS,
                },
                "sampling": {
                    "const": (
                        "source-panel-filtered-to-ic-path-timestamps"
                    )
                },
                "points": {
                    "type": "array",
                    "maxItems": MAX_FACTOR_POINTS,
                },
            },
        },
        "icPath": {
            "type": "object",
            "required": [
                "totalRows",
                "sampledRows",
                "pointLimit",
                "sampling",
                "points",
            ],
            "properties": {
                "totalRows": {"type": "integer", "minimum": 1},
                "sampledRows": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_FACTOR_POINTS,
                },
                "pointLimit": {
                    "type": "integer",
                    "minimum": MIN_FACTOR_POINTS,
                    "maximum": MAX_FACTOR_POINTS,
                },
                "sampling": {"type": "string"},
                "points": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_FACTOR_POINTS,
                },
            },
        },
        "quantilePath": {
            "type": "object",
            "required": [
                "totalRows",
                "sampledRows",
                "timestampAnchors",
                "sampling",
                "points",
            ],
        },
        "warning": {"type": "string", "minLength": 1},
    },
}
