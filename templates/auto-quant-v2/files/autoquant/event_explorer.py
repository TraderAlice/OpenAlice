"""Strict read model for immutable OHLCV price-event Study Runs."""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from .event_studies import load_event_study_policy
from .runs import load_run
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
)


EVENT_STUDY_DIAGNOSTICS_KIND = "autoquant-event-study-diagnostics"
REPORT_KIND = "autoquant-event-study-report"
ARTIFACTS = {
    "event-study-report": "event-study-report.json",
    "event-study-events": "event-study-events.csv",
    "event-study-reference-distribution": (
        "event-study-reference-distribution.csv"
    ),
}
EVENT_COLUMNS = (
    "eventIndex",
    "eventTimestamp",
    "entryTimestamp",
    "exitTimestamp",
    "gapReturn",
    "outcomeStatus",
    "primaryEligible",
    "overlapReason",
    "assetReturn",
    "referenceReturn",
    "excessReturn",
)
REFERENCE_COLUMNS = (
    "entryTimestamp",
    "exitTimestamp",
    "assetReturn",
    "referenceReturn",
    "excessReturn",
)


def _issue(path: str | Path, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _fail(path: str | Path, code: str, message: str) -> None:
    raise AutoQuantValidationError([_issue(path, code, message)])


def _object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        _fail(path, "event-study.json", f"Cannot read JSON evidence: {error}")
    if not isinstance(value, dict):
        _fail(path, "event-study.type", "JSON evidence must be an object")
    return value


def _strict(
    value: Any,
    keys: set[str],
    path: str | Path,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        _fail(path, "event-study.schema", "Object fields differ from fixed contract")
    return value


def _finite(value: Any, path: str | Path) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(float(value))
    ):
        _fail(path, "event-study.number", "Expected one finite number")
    return float(value)


def _nullable_finite(value: Any, path: str | Path) -> float | None:
    if value is None:
        return None
    return _finite(value, path)


def _csv_finite(value: str, path: str | Path) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        _fail(path, "event-study.number", "Expected one finite CSV number")
    if not math.isfinite(number):
        _fail(path, "event-study.number", "Expected one finite CSV number")
    return number


def _close(left: float, right: float, path: str | Path) -> None:
    if not math.isclose(left, right, rel_tol=1e-9, abs_tol=1e-12):
        _fail(path, "event-study.reconcile", "Derived evidence does not reconcile")


def _rows(
    path: Path,
    columns: tuple[str, ...],
    *,
    allow_empty: bool = False,
) -> list[dict[str, str]]:
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            if tuple(reader.fieldnames or ()) != columns:
                _fail(
                    path,
                    "event-study.csv-columns",
                    "CSV columns differ from the fixed contract",
                )
            rows = list(reader)
    except OSError as error:
        _fail(path, "event-study.csv", f"Cannot read CSV evidence: {error}")
    if (not allow_empty and not rows) or any(
        None in row or any(value is None for value in row.values())
        for row in rows
    ):
        _fail(path, "event-study.csv-width", "CSV evidence is empty or malformed")
    return rows


def _distribution(values: list[float]) -> dict[str, Any]:
    array = np.asarray(values, dtype=float)
    count = len(array)
    if count == 0:
        return {
            "count": 0,
            "mean": None,
            "median": None,
            "sampleStandardDeviation": None,
            "minimum": None,
            "quartile25": None,
            "quartile75": None,
            "maximum": None,
            "positiveRate": None,
        }
    return {
        "count": count,
        "mean": float(array.mean()),
        "median": float(np.median(array)),
        "sampleStandardDeviation": (
            float(array.std(ddof=1)) if count > 1 else None
        ),
        "minimum": float(array.min()),
        "quartile25": float(np.quantile(array, 0.25)),
        "quartile75": float(np.quantile(array, 0.75)),
        "maximum": float(array.max()),
        "positiveRate": float((array > 0).mean()),
    }


def _uncertainty(values: list[float]) -> dict[str, Any]:
    count = len(values)
    if count < 2:
        return {
            "method": "normal-approximation-mean-v1",
            "count": count,
            "standardError": None,
            "confidenceLevel": 0.95,
            "lower": None,
            "upper": None,
        }
    array = np.asarray(values, dtype=float)
    standard_error = float(array.std(ddof=1) / math.sqrt(count))
    mean = float(array.mean())
    margin = 1.959963984540054 * standard_error
    return {
        "method": "normal-approximation-mean-v1",
        "count": count,
        "standardError": standard_error,
        "confidenceLevel": 0.95,
        "lower": mean - margin,
        "upper": mean + margin,
    }


def _reconcile_tree(actual: Any, expected: Any, path: str) -> None:
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            _fail(path, "event-study.reconcile", "Object does not reconcile")
        for key in expected:
            _reconcile_tree(actual[key], expected[key], f"{path}/{key}")
    elif isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            _fail(path, "event-study.reconcile", "Array does not reconcile")
        for index, value in enumerate(expected):
            _reconcile_tree(actual[index], value, f"{path}/{index}")
    elif isinstance(expected, float):
        _close(_finite(actual, path), expected, path)
    elif actual != expected:
        _fail(path, "event-study.reconcile", "Value does not reconcile")


def load_event_study_diagnostics(
    project: ProjectContext,
    run_id: str,
) -> dict[str, Any]:
    """Load, verify, and re-derive one immutable Event Study result."""

    run = load_run(project, run_id)
    if run.result["status"] != "succeeded":
        _fail(run.root_dir, "event-study.run-status", "Event Study Run did not succeed")
    if run.result["study"]["id"] != "ohlcv-price-event-reaction":
        _fail(run.root_dir, "event-study.study", "Run is not an Event Study")
    declared = {item["kind"]: item["path"] for item in run.result["artifacts"]}
    if set(declared) != set(ARTIFACTS):
        _fail(
            run.root_dir,
            "event-study.artifacts",
            "Event Study artifact inventory differs from fixed contract",
        )
    paths: dict[str, Path] = {}
    for kind, filename in ARTIFACTS.items():
        expected = f"artifacts/{filename}"
        if declared[kind] != expected:
            _fail(
                run.root_dir / declared[kind],
                "event-study.artifact-path",
                "Event Study artifact path differs from fixed contract",
            )
        paths[kind] = run.root_dir / expected
    frozen_policy_path = (
        run.root_dir
        / "inputs"
        / "dependency-sources"
        / "strategies"
        / "event-study.json"
    )
    policy = load_event_study_policy(frozen_policy_path)
    report = _strict(
        _object(paths["event-study-report"]),
        {
            "schemaVersion",
            "kind",
            "policy",
            "dataset",
            "populations",
            "distributions",
            "comparisons",
            "uncertainty",
            "conclusion",
        },
        paths["event-study-report"],
    )
    if (
        report["schemaVersion"] != SCHEMA_VERSION
        or report["kind"] != REPORT_KIND
        or report["policy"] != policy
    ):
        _fail(
            paths["event-study-report"],
            "event-study.report",
            "Report identity or frozen policy is invalid",
        )
    dataset = _strict(
        report["dataset"],
        {
            "id",
            "version",
            "asset",
            "referenceAsset",
            "timeRange",
            "alignedObservations",
        },
        f"{paths['event-study-report']}/dataset",
    )
    if (
        dataset["id"] != run.result["dataset"]["id"]
        or dataset["version"] != run.result["dataset"]["version"]
        or dataset["timeRange"] != run.result["dataset"]["time_range"]
        or dataset["asset"] != policy["event"]["asset"]
        or dataset["referenceAsset"] != policy["references"]["matchedAsset"]
        or not isinstance(dataset["alignedObservations"], int)
        or isinstance(dataset["alignedObservations"], bool)
        or dataset["alignedObservations"] < 1
    ):
        _fail(
            f"{paths['event-study-report']}/dataset",
            "event-study.dataset",
            "Report dataset does not reconcile with the immutable Run",
        )
    raw_event_rows = _rows(
        paths["event-study-events"],
        EVENT_COLUMNS,
        allow_empty=True,
    )
    raw_reference_rows = _rows(
        paths["event-study-reference-distribution"],
        REFERENCE_COLUMNS,
    )
    references: list[dict[str, Any]] = []
    for index, row in enumerate(raw_reference_rows):
        path = f"{paths['event-study-reference-distribution']}/{index + 2}"
        asset_return = _csv_finite(row["assetReturn"], path)
        reference_return = _csv_finite(row["referenceReturn"], path)
        excess = _csv_finite(row["excessReturn"], path)
        _close(excess, asset_return - reference_return, path)
        references.append(
            {
                "entryTimestamp": row["entryTimestamp"],
                "exitTimestamp": row["exitTimestamp"],
                "assetReturn": asset_return,
                "referenceReturn": reference_return,
                "excessReturn": excess,
            }
        )
    holding = int(policy["timing"]["holdingBars"])
    if len(references) != dataset["alignedObservations"] - holding:
        _fail(
            paths["event-study-reference-distribution"],
            "event-study.reference-count",
            "Reference distribution length does not match the fixed horizon",
        )
    timeline = [row["entryTimestamp"] for row in references]
    timeline.extend(
        row["exitTimestamp"] for row in references[-holding:]
    )
    if len(timeline) != len(set(timeline)) or timeline != sorted(timeline):
        _fail(
            paths["event-study-reference-distribution"],
            "event-study.timeline",
            "Reference rows do not define one chronological aligned timeline",
        )
    reference_by_entry = {
        row["entryTimestamp"]: row
        for row in references
    }
    events: list[dict[str, Any]] = []
    last_primary_exit: int | None = None
    for index, row in enumerate(raw_event_rows, start=1):
        path = f"{paths['event-study-events']}/{index + 1}"
        try:
            event_index = int(row["eventIndex"])
        except ValueError:
            _fail(path, "event-study.event-index", "Invalid eventIndex")
        if event_index != index:
            _fail(path, "event-study.event-index", "Event indices must be sequential")
        if row["eventTimestamp"] not in timeline:
            _fail(path, "event-study.event-time", "Event timestamp is outside timeline")
        event_position = timeline.index(row["eventTimestamp"])
        gap = _csv_finite(row["gapReturn"], path)
        if gap > float(policy["event"]["thresholdReturn"]) + 1e-12:
            _fail(path, "event-study.threshold", "Event does not satisfy threshold")
        complete = row["outcomeStatus"] == "complete"
        if row["outcomeStatus"] not in {"complete", "right-censored"}:
            _fail(path, "event-study.outcome-status", "Invalid outcomeStatus")
        expected_entry_position = event_position + int(policy["timing"]["waitBars"])
        expected_exit_position = expected_entry_position + holding
        expected_complete = expected_exit_position < len(timeline)
        if complete != expected_complete:
            _fail(path, "event-study.timing", "Outcome completion is misaligned")
        expected_entry = (
            timeline[expected_entry_position]
            if expected_entry_position < len(timeline)
            else ""
        )
        expected_exit = (
            timeline[expected_exit_position] if expected_complete else ""
        )
        if row["entryTimestamp"] != expected_entry or row["exitTimestamp"] != expected_exit:
            _fail(path, "event-study.timing", "Event entry or exit is misaligned")
        expected_primary = bool(
            complete
            and (
                last_primary_exit is None
                or expected_entry_position >= last_primary_exit
            )
        )
        if expected_primary:
            last_primary_exit = expected_exit_position
        expected_reason = (
            "right-censored"
            if not complete
            else "eligible"
            if expected_primary
            else "overlapping-prior-primary"
        )
        if (
            row["primaryEligible"] not in {"True", "False"}
            or (row["primaryEligible"] == "True") != expected_primary
            or row["overlapReason"] != expected_reason
        ):
            _fail(path, "event-study.overlap", "Primary overlap policy is misapplied")
        if complete:
            asset_return = _csv_finite(row["assetReturn"], path)
            reference_return = _csv_finite(row["referenceReturn"], path)
            excess = _csv_finite(row["excessReturn"], path)
            reference = reference_by_entry.get(expected_entry)
            if reference is None or reference["exitTimestamp"] != expected_exit:
                _fail(path, "event-study.reference", "Matched reference is absent")
            _close(asset_return, reference["assetReturn"], path)
            _close(reference_return, reference["referenceReturn"], path)
            _close(excess, asset_return - reference_return, path)
        else:
            if any(
                row[key]
                for key in ("assetReturn", "referenceReturn", "excessReturn")
            ):
                _fail(path, "event-study.censoring", "Censored returns must be empty")
            asset_return = reference_return = excess = None
        events.append(
            {
                "eventIndex": event_index,
                "eventTimestamp": row["eventTimestamp"],
                "entryTimestamp": row["entryTimestamp"] or None,
                "exitTimestamp": row["exitTimestamp"] or None,
                "gapReturn": gap,
                "outcomeStatus": row["outcomeStatus"],
                "primaryEligible": expected_primary,
                "overlapReason": expected_reason,
                "assetReturn": asset_return,
                "referenceReturn": reference_return,
                "excessReturn": excess,
            }
        )
    complete_events = [row for row in events if row["outcomeStatus"] == "complete"]
    primary_events = [row for row in events if row["primaryEligible"]]
    primary_asset = [float(row["assetReturn"]) for row in primary_events]
    primary_reference = [
        float(row["referenceReturn"]) for row in primary_events
    ]
    primary_excess = [float(row["excessReturn"]) for row in primary_events]
    raw_asset = [float(row["assetReturn"]) for row in complete_events]
    raw_excess = [float(row["excessReturn"]) for row in complete_events]
    unconditional_asset = [row["assetReturn"] for row in references]
    unconditional_reference = [row["referenceReturn"] for row in references]
    distributions = {
        "rawEventAsset": _distribution(raw_asset),
        "rawEventExcess": _distribution(raw_excess),
        "primaryEventAsset": _distribution(primary_asset),
        "primaryMatchedReference": _distribution(primary_reference),
        "primaryEventExcess": _distribution(primary_excess),
        "unconditionalAsset": _distribution(unconditional_asset),
        "unconditionalReference": _distribution(unconditional_reference),
    }
    primary_mean = distributions["primaryEventAsset"]["mean"]
    unconditional_mean = distributions["unconditionalAsset"]["mean"]
    excess_mean = distributions["primaryEventExcess"]["mean"]
    comparisons = {
        "primaryMeanMinusUnconditionalAssetMean": (
            float(primary_mean) - float(unconditional_mean)
            if primary_mean is not None
            else None
        ),
        "primaryMeanMatchedExcess": excess_mean,
    }
    uncertainty = {
        "primaryEventAssetMean": _uncertainty(primary_asset),
        "primaryEventExcessMean": _uncertainty(primary_excess),
    }
    minimum = int(policy["population"]["minimumEvents"])
    if len(primary_events) < minimum:
        status = "insufficient-events"
    elif (
        float(primary_mean) > float(unconditional_mean)
        and float(excess_mean) > 0.0
    ):
        status = "observed-advantage"
    else:
        status = "no-observed-advantage"
    populations = {
        "qualifyingEvents": len(events),
        "completeEvents": len(complete_events),
        "rightCensoredEvents": len(events) - len(complete_events),
        "primaryEvents": len(primary_events),
        "overlapExcludedEvents": len(complete_events) - len(primary_events),
        "unconditionalObservations": len(references),
    }
    conclusion = {
        "status": status,
        "minimumEvents": minimum,
        "observedPrimaryEvents": len(primary_events),
        "meaning": "descriptive-historical-association-only",
        "tradingAuthority": "none",
    }
    for name, expected in (
        ("populations", populations),
        ("distributions", distributions),
        ("comparisons", comparisons),
        ("uncertainty", uncertainty),
        ("conclusion", conclusion),
    ):
        _reconcile_tree(
            report[name],
            expected,
            f"{paths['event-study-report']}/{name}",
        )
    metrics = run.result["metrics"]
    expected_metrics = {
        "primary_eligible_event_count": len(primary_events),
        "complete_event_count": len(complete_events),
        "primary_event_mean_return": (
            float(primary_mean) if primary_mean is not None else 0.0
        ),
        "primary_event_mean_excess_return": (
            float(excess_mean) if excess_mean is not None else 0.0
        ),
    }
    if set(metrics) != set(expected_metrics):
        _fail(run.root_dir, "event-study.metrics", "Run metrics differ from contract")
    for key, expected in expected_metrics.items():
        _close(_finite(metrics[key], f"{run.root_dir}/metrics/{key}"), expected, key)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": EVENT_STUDY_DIAGNOSTICS_KIND,
        "run": {
            "id": run.result["id"],
            "status": run.result["status"],
            "harness": run.result["harness"],
            "durationMs": run.result["durationMs"],
        },
        "dataset": dataset,
        "policy": policy,
        "populations": populations,
        "distributions": distributions,
        "comparisons": comparisons,
        "uncertainty": uncertainty,
        "conclusion": conclusion,
        "events": events,
        "artifacts": {
            kind: {
                "path": declared[kind],
                "description": next(
                    item["description"]
                    for item in run.result["artifacts"]
                    if item["kind"] == kind
                ),
            }
            for kind in ARTIFACTS
        },
        "warning": (
            "Historical price-event association only; provider adjustment "
            "claims are unauthenticated and no trading authority is granted."
        ),
    }


EVENT_STUDY_DIAGNOSTICS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Event Study Explorer diagnostics",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "run",
        "dataset",
        "policy",
        "populations",
        "distributions",
        "comparisons",
        "uncertainty",
        "conclusion",
        "events",
        "artifacts",
        "warning",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": EVENT_STUDY_DIAGNOSTICS_KIND},
        "run": {"type": "object"},
        "dataset": {"type": "object"},
        "policy": {"type": "object"},
        "populations": {"type": "object"},
        "distributions": {"type": "object"},
        "comparisons": {"type": "object"},
        "uncertainty": {"type": "object"},
        "conclusion": {"type": "object"},
        "events": {"type": "array"},
        "artifacts": {"type": "object"},
        "warning": {"type": "string", "minLength": 1},
    },
}
