"""Shared contract for optional candidate-declared factor components."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from .intervals import SUPPORTED_INTERVALS


COMPONENT_NAME = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
MAX_MATERIALIZED_COMPONENTS = 12
MAX_COMPONENT_METADATA = 24
MAX_INTERVAL_CLAIMS = 6
MAX_LABEL_LENGTH = 80
MAX_HYPOTHESIS_LENGTH = 240
BASE_INTERVAL_CLAIM = "base"
VALID_INTERVAL_CLAIMS = {
    BASE_INTERVAL_CLAIM,
    *SUPPORTED_INTERVALS,
}
COMPONENT_ROLES = {
    "cross-sectional-score",
    "timestamp-context",
}


class FactorComponentError(ValueError):
    """Stable candidate component-contract failure."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class FactorComponents:
    """Validated materialized components and their bounded declarations."""

    values: pd.DataFrame
    metadata: dict[str, dict[str, Any]]

    def declaration(self) -> list[dict[str, Any]]:
        return [
            {
                "id": name,
                "label": self.metadata[name]["label"],
                "role": self.metadata[name]["role"],
                "intervals": list(self.metadata[name]["intervals"]),
                "hypothesis": self.metadata[name]["hypothesis"],
            }
            for name in self.values.columns
        ]


def _metadata(module: Any) -> dict[str, dict[str, Any]] | None:
    raw = getattr(module, "FACTOR_COMPONENTS", None)
    function = getattr(module, "compute_factor_components", None)
    if raw is None and function is None:
        return None
    if raw is None or not callable(function):
        raise FactorComponentError(
            "factor.components-api",
            "FACTOR_COMPONENTS and callable compute_factor_components(panel) "
            "must be exported together",
        )
    if (
        not isinstance(raw, dict)
        or not raw
        or len(raw) > MAX_COMPONENT_METADATA
    ):
        raise FactorComponentError(
            "factor.components-metadata",
            "FACTOR_COMPONENTS must contain 1..24 component metadata entries",
        )
    normalized: dict[str, dict[str, Any]] = {}
    for name, value in raw.items():
        if not isinstance(name, str) or COMPONENT_NAME.fullmatch(name) is None:
            raise FactorComponentError(
                "factor.component-name",
                "Component metadata names must match "
                "^[a-z][a-z0-9_]{0,47}$",
            )
        if not isinstance(value, dict) or set(value) != {
            "label",
            "role",
            "intervals",
            "hypothesis",
        }:
            raise FactorComponentError(
                "factor.component-metadata",
                f"{name} metadata must contain exactly label, role, intervals, "
                "and hypothesis",
            )
        role = value["role"]
        if role not in COMPONENT_ROLES:
            raise FactorComponentError(
                "factor.component-role",
                f"{name} role must be one of "
                + ", ".join(sorted(COMPONENT_ROLES)),
            )
        label = value["label"]
        hypothesis = value["hypothesis"]
        intervals = value["intervals"]
        if (
            not isinstance(label, str)
            or not label.strip()
            or len(label) > MAX_LABEL_LENGTH
        ):
            raise FactorComponentError(
                "factor.component-label",
                f"{name} label must contain 1..{MAX_LABEL_LENGTH} characters",
            )
        if (
            not isinstance(hypothesis, str)
            or not hypothesis.strip()
            or len(hypothesis) > MAX_HYPOTHESIS_LENGTH
        ):
            raise FactorComponentError(
                "factor.component-hypothesis",
                f"{name} hypothesis must contain "
                f"1..{MAX_HYPOTHESIS_LENGTH} characters",
            )
        if (
            not isinstance(intervals, list)
            or not intervals
            or len(intervals) > MAX_INTERVAL_CLAIMS
            or not all(isinstance(item, str) for item in intervals)
            or len(intervals) != len(set(intervals))
            or any(item not in VALID_INTERVAL_CLAIMS for item in intervals)
        ):
            raise FactorComponentError(
                "factor.component-intervals",
                f"{name} intervals must contain 1..{MAX_INTERVAL_CLAIMS} "
                "unique values from base, "
                + ", ".join(SUPPORTED_INTERVALS),
            )
        normalized[name] = {
            "label": label.strip(),
            "role": role,
            "intervals": list(intervals),
            "hypothesis": hypothesis.strip(),
        }
    return normalized


def validate_factor_component_metadata(
    module: Any,
) -> dict[str, dict[str, Any]] | None:
    """Validate optional static component declarations before candidate execution."""

    return _metadata(module)


def compute_factor_components(
    module: Any,
    panel: pd.DataFrame,
) -> FactorComponents | None:
    """Execute and validate one optional component declaration."""

    metadata = _metadata(module)
    if metadata is None:
        return None
    function = getattr(module, "compute_factor_components")
    before = panel.copy(deep=True)
    try:
        result = function(panel)
    except Exception as error:
        raise FactorComponentError(
            "factor.components-execution",
            "compute_factor_components raised "
            f"{type(error).__name__}: {error}",
        ) from error
    if not panel.equals(before):
        raise FactorComponentError(
            "factor.components-mutation",
            "compute_factor_components mutated its input panel",
        )
    if not isinstance(result, pd.DataFrame):
        raise FactorComponentError(
            "factor.components-type",
            "compute_factor_components must return pandas.DataFrame",
        )
    if not result.index.equals(panel.index) or len(result) != len(panel):
        raise FactorComponentError(
            "factor.components-alignment",
            "Component DataFrame must preserve the exact panel length and index",
        )
    if (
        result.shape[1] < 1
        or result.shape[1] > MAX_MATERIALIZED_COMPONENTS
        or not result.columns.is_unique
    ):
        raise FactorComponentError(
            "factor.components-count",
            "Component DataFrame must contain 1..12 unique columns",
        )
    columns = list(result.columns)
    if any(
        not isinstance(name, str) or COMPONENT_NAME.fullmatch(name) is None
        for name in columns
    ):
        raise FactorComponentError(
            "factor.component-name",
            "Materialized component names must match "
            "^[a-z][a-z0-9_]{0,47}$",
        )
    undeclared = [name for name in columns if name not in metadata]
    if undeclared:
        raise FactorComponentError(
            "factor.component-undeclared",
            "Materialized components lack metadata: " + ", ".join(undeclared),
        )
    available_intervals = {
        interval
        for interval in SUPPORTED_INTERVALS
        if f"close__{interval}" in panel.columns
    }
    for name in columns:
        unavailable = [
            interval
            for interval in metadata[name]["intervals"]
            if interval != BASE_INTERVAL_CLAIM
            and interval not in available_intervals
        ]
        if unavailable:
            raise FactorComponentError(
                "factor.component-interval-unavailable",
                f"{name} claims intervals absent from the supplied panel: "
                + ", ".join(unavailable),
            )
    numeric = pd.DataFrame(index=result.index)
    for name in columns:
        try:
            values = pd.to_numeric(result[name], errors="raise").astype(float)
        except (TypeError, ValueError) as error:
            raise FactorComponentError(
                "factor.components-numeric",
                f"{name} must be numeric: {error}",
            ) from error
        array = values.to_numpy(dtype=float)
        if np.isinf(array).any():
            raise FactorComponentError(
                "factor.components-non-finite",
                f"{name} cannot contain infinity",
            )
        if not np.isfinite(array).any():
            raise FactorComponentError(
                "factor.component-empty",
                f"{name} has no finite observation",
            )
        numeric[name] = values
        if metadata[name]["role"] == "timestamp-context":
            observed = pd.DataFrame(
                {
                    "timestamp": panel["timestamp"].to_numpy(),
                    "value": values.to_numpy(),
                }
            ).dropna(subset=["value"])
            if (
                not observed.empty
                and observed.groupby(
                    "timestamp",
                    sort=False,
                )["value"].nunique(dropna=True).gt(1).any()
            ):
                raise FactorComponentError(
                    "factor.component-context-variation",
                    f"{name} declares timestamp-context but varies across "
                    "assets at one timestamp",
                )
    return FactorComponents(values=numeric, metadata=metadata)
