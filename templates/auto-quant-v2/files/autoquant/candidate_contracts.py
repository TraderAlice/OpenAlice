"""Verified edit-time contracts for candidate Coding Agents."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any

from .factor_components import COMPONENT_ROLES
from .intervals import IntervalContractError, canonical_interval_surface
from .studies import StudyContext
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
)


FACTOR_CANDIDATE_CONTRACT_KIND = "autoquant-factor-candidate-contract"
FACTOR_PANEL_API = "panel-v2"
BASE_PANEL_COLUMNS = (
    "asset",
    "timestamp",
    "open",
    "high",
    "low",
    "close",
    "volume",
)
COMPONENT_METADATA_FIELDS = (
    "label",
    "role",
    "intervals",
    "hypothesis",
)
INTERVAL_AVAILABILITY_RULE = (
    "Only baseInterval and featureIntervals are available; candidate source "
    "branches and component declarations do not add panel inputs."
)
CAUSAL_CONTEXT_RULE = (
    "Candidate code may use only observations whose timestamp is at or before "
    "the evaluated row timestamp; absent context remains absent unless the "
    "candidate performs an explicit backward as-of operation."
)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _snapshot_surface(
    project: ProjectContext,
    study: StudyContext,
) -> tuple[str, dict[str, Any]] | None:
    relative = "ohlcv/snapshot.json"
    if relative not in study.dataset_hashes:
        return None
    path = (
        project.root_dir
        / project.manifest.directories["data"]
        / relative
    )
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "candidate-contract.dataset-snapshot",
                    f"Cannot read the locked dataset snapshot: {error}",
                )
            ]
        ) from error
    schema_version = value.get("schemaVersion")
    surface = value.get("intervalSurface")
    if schema_version == 1:
        return None
    if schema_version == 4:
        return (
            "content-locked-snapshot-v4",
            {
                "baseInterval": "1d",
                "featureIntervals": [],
            },
        )
    if schema_version not in {2, 3, 5, 6} or not isinstance(surface, dict):
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "candidate-contract.interval-surface",
                    "Locked OHLCV snapshot needs one V2, V3, V5, or V6 interval surface",
                )
            ]
        )
    try:
        canonical = canonical_interval_surface(
            surface,
            schema_version=schema_version,
        )
    except IntervalContractError as error:
        raise AutoQuantValidationError(
            [_issue(path, error.code, str(error))]
        ) from error
    return f"content-locked-snapshot-v{schema_version}", canonical


def _legacy_base_interval(
    project: ProjectContext,
    study: StudyContext,
) -> str | None:
    candidates = [
        relative
        for relative in sorted(study.dataset_hashes)
        if relative.startswith("ohlcv/")
        and relative.count("/") == 1
        and relative.endswith(".csv")
    ]
    if not candidates:
        return None
    path = (
        project.root_dir
        / project.manifest.directories["data"]
        / candidates[0]
    )
    try:
        with path.open(encoding="utf-8", newline="") as handle:
            row = next(csv.DictReader(handle), None)
    except (OSError, UnicodeError, csv.Error):
        return None
    timestamp = row.get("timestamp") if isinstance(row, dict) else None
    return "1d" if isinstance(timestamp, str) and _DATE.fullmatch(timestamp) else None


def _panel_columns(feature_intervals: list[str]) -> list[str]:
    result = list(BASE_PANEL_COLUMNS)
    for interval in feature_intervals:
        result.extend(
            [
                f"bar_close__{interval}",
                f"open__{interval}",
                f"high__{interval}",
                f"low__{interval}",
                f"close__{interval}",
                f"volume__{interval}",
                f"age_bars__{interval}",
            ]
        )
    return result


def _observation_semantics(surface_source: str) -> dict[str, str]:
    if surface_source in {
        "content-locked-snapshot-v5",
        "content-locked-snapshot-v6",
    }:
        return {
            "timestampMeaning": "completed-bar-close",
            "panelShape": "ragged-observed-only",
            "missingObservation": "absent-no-fill",
            "contextVisibility": CAUSAL_CONTEXT_RULE,
            "targetClock": "per-target-observed-bars",
        }
    if surface_source == "content-locked-snapshot-v4":
        return {
            "timestampMeaning": "session-date",
            "panelShape": "ragged-observed-only",
            "missingObservation": "absent-no-fill",
            "contextVisibility": CAUSAL_CONTEXT_RULE,
            "targetClock": "per-observed-timestamp",
        }
    return {
        "timestampMeaning": (
            "completed-bar-close"
            if surface_source in {
                "content-locked-snapshot-v2",
                "content-locked-snapshot-v3",
            }
            else "session-date"
        ),
        "panelShape": "rectangular",
        "missingObservation": "not-applicable-rectangular",
        "contextVisibility": CAUSAL_CONTEXT_RULE,
        "targetClock": "shared-base-bars",
    }


def build_candidate_contract(
    project: ProjectContext,
    study: StudyContext,
) -> dict[str, Any] | None:
    """Describe the exact factor edit surface without inventing data columns."""

    if not any(
        path == "factors"
        or path.startswith("factors/")
        for path in study.definition.editable["paths"]
    ):
        return None
    locked = _snapshot_surface(project, study)
    if locked is None:
        surface_source = "legacy-ohlcv-v1"
        base_interval = _legacy_base_interval(project, study)
        feature_intervals: list[str] = []
    else:
        surface_source, surface = locked
        base_interval = surface["baseInterval"]
        feature_intervals = list(surface["featureIntervals"])
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": FACTOR_CANDIDATE_CONTRACT_KIND,
        "api": {
            "kind": FACTOR_PANEL_API,
            "function": "compute_factor(panel) -> pandas.Series",
            "identityColumns": ["asset", "timestamp"],
        },
        "data": {
            "surfaceSource": surface_source,
            "baseInterval": base_interval,
            "featureIntervals": feature_intervals,
            "panelColumns": _panel_columns(feature_intervals),
            "availabilityRule": INTERVAL_AVAILABILITY_RULE,
            "observationSemantics": _observation_semantics(surface_source),
        },
        "components": {
            "optional": True,
            "metadataFields": list(COMPONENT_METADATA_FIELDS),
            "roles": sorted(COMPONENT_ROLES),
        },
    }


FACTOR_CANDIDATE_CONTRACT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant factor candidate edit-time contract",
    "type": "object",
    "additionalProperties": False,
    "required": ["schemaVersion", "kind", "api", "data", "components"],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": FACTOR_CANDIDATE_CONTRACT_KIND},
        "api": {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "function", "identityColumns"],
            "properties": {
                "kind": {"const": FACTOR_PANEL_API},
                "function": {
                    "const": "compute_factor(panel) -> pandas.Series"
                },
                "identityColumns": {
                    "const": ["asset", "timestamp"],
                },
            },
        },
        "data": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "surfaceSource",
                "baseInterval",
                "featureIntervals",
                "panelColumns",
                "availabilityRule",
                "observationSemantics",
            ],
            "properties": {
                "surfaceSource": {
                    "pattern": "^(legacy-ohlcv-v1|content-locked-snapshot-v[23456])$"
                },
                "baseInterval": {"type": ["string", "null"]},
                "featureIntervals": {
                    "type": "array",
                    "uniqueItems": True,
                    "items": {"type": "string", "minLength": 1},
                },
                "panelColumns": {
                    "type": "array",
                    "minItems": len(BASE_PANEL_COLUMNS),
                    "uniqueItems": True,
                    "items": {"type": "string", "minLength": 1},
                },
                "availabilityRule": {
                    "const": INTERVAL_AVAILABILITY_RULE,
                },
                "observationSemantics": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "timestampMeaning",
                        "panelShape",
                        "missingObservation",
                        "contextVisibility",
                        "targetClock",
                    ],
                    "properties": {
                        "timestampMeaning": {
                            "enum": ["session-date", "completed-bar-close"]
                        },
                        "panelShape": {
                            "enum": ["rectangular", "ragged-observed-only"]
                        },
                        "missingObservation": {
                            "enum": [
                                "not-applicable-rectangular",
                                "absent-no-fill",
                            ]
                        },
                        "contextVisibility": {"const": CAUSAL_CONTEXT_RULE},
                        "targetClock": {
                            "enum": [
                                "shared-base-bars",
                                "per-observed-timestamp",
                                "per-target-observed-bars",
                            ]
                        },
                    },
                },
            },
        },
        "components": {
            "type": "object",
            "additionalProperties": False,
            "required": ["optional", "metadataFields", "roles"],
            "properties": {
                "optional": {"const": True},
                "metadataFields": {
                    "const": list(COMPONENT_METADATA_FIELDS),
                },
                "roles": {"const": sorted(COMPONENT_ROLES)},
            },
        },
    },
}
