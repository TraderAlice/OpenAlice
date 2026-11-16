"""Shared panel-native candidate factor execution and validation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from .factor_components import (
    FactorComponentError,
    FactorComponents,
    compute_factor_components,
)


PANEL_ID_COLUMNS = ("asset", "timestamp")
FACTOR_API_KIND = "panel-v2"
MAX_PANEL_ASSETS = 256


class FactorRuntimeError(ValueError):
    """Stable factor-candidate contract failure."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class FactorEvaluation:
    """Verified candidate values over one canonical input panel."""

    panel: pd.DataFrame
    values: pd.Series
    components: FactorComponents | None
    causality_cuts: tuple[str, ...]


def factor_contract(evaluation: FactorEvaluation) -> dict[str, Any]:
    """Return structured evidence for the factor API used by one Run."""

    panel = evaluation.panel
    assets = int(panel["asset"].nunique())
    timestamps = int(panel["timestamp"].nunique())
    possible_rows = assets * timestamps
    observed_rows = int(len(panel))
    return {
        "kind": FACTOR_API_KIND,
        "input": "long-form-observed-universe",
        "shape": (
            "rectangular"
            if observed_rows == possible_rows
            else "ragged-observed-only"
        ),
        "rows": observed_rows,
        "possible_rows": possible_rows,
        "observation_coverage": (
            float(observed_rows / possible_rows)
            if possible_rows
            else 0.0
        ),
        "assets": assets,
        "timestamps": timestamps,
        "cross_asset_context": "same-or-prior-timestamp-explicit-candidate",
        "causality_audit": "whole-panel-timestamp-prefix",
        "causality_cuts": list(evaluation.causality_cuts),
    }


def build_factor_panel(
    frames: Mapping[str, pd.DataFrame],
    *,
    universe: Sequence[str] | None = None,
) -> pd.DataFrame:
    """Combine per-asset chronological frames into one stable long-form panel."""

    ordered_assets = list(universe) if universe is not None else list(frames)
    if not ordered_assets:
        raise FactorRuntimeError("factor.panel-empty", "Factor panel is empty")
    if len(ordered_assets) > MAX_PANEL_ASSETS:
        raise FactorRuntimeError(
            "factor.panel-universe",
            f"Factor panel supports at most {MAX_PANEL_ASSETS} assets",
        )
    if len(ordered_assets) != len(set(ordered_assets)):
        raise FactorRuntimeError(
            "factor.panel-universe",
            "Factor panel universe contains duplicate asset identifiers",
        )
    if set(frames) != set(ordered_assets):
        missing = [asset for asset in ordered_assets if asset not in frames]
        extra = [asset for asset in frames if asset not in ordered_assets]
        raise FactorRuntimeError(
            "factor.panel-universe",
            "Factor frames do not match the Study universe"
            + (f"; missing={missing}" if missing else "")
            + (f"; extra={extra}" if extra else ""),
        )

    expected_columns: list[str] | None = None
    parts: list[pd.DataFrame] = []
    for order, asset in enumerate(ordered_assets):
        if not isinstance(asset, str) or not asset:
            raise FactorRuntimeError(
                "factor.panel-asset",
                "Factor panel asset identifiers must be non-empty strings",
            )
        frame = frames[asset]
        if not isinstance(frame, pd.DataFrame):
            raise FactorRuntimeError(
                "factor.panel-frame",
                f"Factor input for {asset} must be a pandas DataFrame",
            )
        if "asset" in frame.columns or "timestamp" not in frame.columns:
            raise FactorRuntimeError(
                "factor.panel-columns",
                "Per-asset frames must contain timestamp and must not contain asset",
            )
        columns = list(frame.columns)
        if expected_columns is None:
            expected_columns = columns
        elif columns != expected_columns:
            raise FactorRuntimeError(
                "factor.panel-columns",
                f"Factor input columns differ for {asset}",
            )
        if frame.empty:
            raise FactorRuntimeError(
                "factor.panel-empty-asset",
                f"Factor input for {asset} is empty",
            )
        if frame["timestamp"].isna().any():
            raise FactorRuntimeError(
                "factor.panel-timestamp",
                f"Factor input for {asset} contains a missing timestamp",
            )
        if (
            frame["timestamp"].duplicated().any()
            or not frame["timestamp"].is_monotonic_increasing
        ):
            raise FactorRuntimeError(
                "factor.panel-timestamp",
                f"Factor input for {asset} must be uniquely chronological",
            )
        part = frame.copy(deep=True)
        part.insert(0, "asset", asset)
        part["__asset_order"] = order
        parts.append(part)

    panel = pd.concat(parts, ignore_index=True)
    panel = (
        panel.sort_values(
            ["timestamp", "__asset_order"],
            kind="stable",
        )
        .drop(columns="__asset_order")
        .reset_index(drop=True)
    )
    if panel.duplicated(list(PANEL_ID_COLUMNS)).any():
        raise FactorRuntimeError(
            "factor.panel-identity",
            "Factor panel contains duplicate asset/timestamp rows",
        )
    return panel


def _candidate_function(module: Any) -> Any:
    candidate = getattr(module, "compute_factor", None)
    if not callable(candidate):
        raise FactorRuntimeError(
            "factor.api",
            "factors.candidate must export callable compute_factor(panel)",
        )
    return candidate


def _run_factor_once(module: Any, panel: pd.DataFrame) -> pd.Series:
    candidate = _candidate_function(module)
    supplied = panel.copy(deep=True)
    before = supplied.copy(deep=True)
    try:
        result = candidate(supplied)
    except Exception as error:
        raise FactorRuntimeError(
            "factor.execution",
            f"compute_factor raised {type(error).__name__}: {error}",
        ) from error
    try:
        pd.testing.assert_frame_equal(supplied, before)
    except AssertionError as error:
        raise FactorRuntimeError(
            "factor.mutation",
            "compute_factor mutated the input panel",
        ) from error
    if not isinstance(result, pd.Series):
        raise FactorRuntimeError(
            "factor.type",
            "compute_factor must return a pandas Series",
        )
    if len(result) != len(panel) or not result.index.equals(panel.index):
        raise FactorRuntimeError(
            "factor.alignment",
            "Factor Series must preserve the exact panel length and index",
        )
    try:
        numeric = pd.to_numeric(result, errors="raise").astype(float)
    except (TypeError, ValueError) as error:
        raise FactorRuntimeError(
            "factor.numeric",
            f"Factor Series must be numeric: {error}",
        ) from error
    values = numeric.to_numpy(dtype=float)
    if np.isinf(values).any():
        raise FactorRuntimeError(
            "factor.non-finite",
            "Factor Series cannot contain infinity",
        )
    if not np.isfinite(values).any():
        raise FactorRuntimeError(
            "factor.empty",
            "Factor Series has no finite observation",
        )
    return numeric


def _run_components_once(
    module: Any,
    panel: pd.DataFrame,
) -> FactorComponents | None:
    try:
        return compute_factor_components(module, panel.copy(deep=True))
    except FactorComponentError as error:
        raise FactorRuntimeError(error.code, str(error)) from error


def _values_equal(left: pd.Series, right: pd.Series) -> bool:
    return bool(
        np.isclose(
            left.to_numpy(dtype=float),
            right.to_numpy(dtype=float),
            rtol=1e-10,
            atol=1e-12,
            equal_nan=True,
        ).all()
    )


def _component_values_equal(
    left: FactorComponents,
    right: FactorComponents,
) -> bool:
    if left.declaration() != right.declaration():
        return False
    try:
        pd.testing.assert_frame_equal(
            left.values,
            right.values,
            check_exact=False,
            rtol=1e-10,
            atol=1e-12,
        )
    except AssertionError:
        return False
    return True


def _timestamp_cuts(panel: pd.DataFrame) -> list[Any]:
    timestamps = panel["timestamp"].drop_duplicates().tolist()
    if len(timestamps) < 3:
        return [timestamps[-1]]
    positions = {
        max(0, len(timestamps) // 2),
        max(0, (len(timestamps) * 3) // 4),
        max(0, len(timestamps) - 2),
    }
    return [timestamps[position] for position in sorted(positions)]


def evaluate_factor(
    module: Any,
    panel: pd.DataFrame,
    *,
    audit_causality: bool = True,
) -> FactorEvaluation:
    """Execute one candidate under the shared panel contract."""

    if not isinstance(panel, pd.DataFrame):
        raise FactorRuntimeError(
            "factor.panel-type",
            "Factor panel must be a pandas DataFrame",
        )
    missing = [column for column in PANEL_ID_COLUMNS if column not in panel]
    if missing:
        raise FactorRuntimeError(
            "factor.panel-columns",
            "Factor panel lacks identity columns: " + ", ".join(missing),
        )
    if panel.empty:
        raise FactorRuntimeError("factor.panel-empty", "Factor panel is empty")
    if not panel.index.equals(pd.RangeIndex(len(panel))):
        raise FactorRuntimeError(
            "factor.panel-index",
            "Factor panel must use the canonical zero-based RangeIndex",
        )
    if panel.duplicated(list(PANEL_ID_COLUMNS)).any():
        raise FactorRuntimeError(
            "factor.panel-identity",
            "Factor panel contains duplicate asset/timestamp rows",
        )
    if (
        panel["asset"].isna().any()
        or not panel["asset"]
        .map(lambda value: isinstance(value, str) and bool(value))
        .all()
    ):
        raise FactorRuntimeError(
            "factor.panel-asset",
            "Factor panel asset identifiers must be non-empty strings",
        )
    if panel["asset"].nunique() > MAX_PANEL_ASSETS:
        raise FactorRuntimeError(
            "factor.panel-universe",
            f"Factor panel supports at most {MAX_PANEL_ASSETS} assets",
        )
    if panel["timestamp"].isna().any():
        raise FactorRuntimeError(
            "factor.panel-timestamp",
            "Factor panel contains a missing timestamp",
        )
    if not panel["timestamp"].is_monotonic_increasing:
        raise FactorRuntimeError(
            "factor.panel-order",
            "Factor panel must be sorted chronologically by timestamp",
        )
    chronological_assets = panel.groupby(
        "asset",
        sort=False,
    )["timestamp"].apply(
        lambda values: bool(
            values.is_monotonic_increasing and not values.duplicated().any()
        )
    )
    if not bool(chronological_assets.all()):
        raise FactorRuntimeError(
            "factor.panel-order",
            "Each asset in the factor panel must be uniquely chronological",
        )

    first = _run_factor_once(module, panel)
    second = _run_factor_once(module, panel)
    if not _values_equal(first, second):
        raise FactorRuntimeError(
            "factor.nondeterministic",
            "compute_factor returned different values for one fixed panel",
        )

    components = _run_components_once(module, panel)
    repeated_components = _run_components_once(module, panel)
    if (components is None) != (repeated_components is None):
        raise FactorRuntimeError(
            "factor.components-nondeterministic",
            "Component declaration availability changed for one fixed panel",
        )
    if (
        components is not None
        and repeated_components is not None
        and not _component_values_equal(components, repeated_components)
    ):
        raise FactorRuntimeError(
            "factor.components-nondeterministic",
            "compute_factor_components returned different values for one fixed panel",
        )

    cuts: list[str] = []
    if audit_causality:
        for cutoff in _timestamp_cuts(panel):
            prefix_panel = panel.loc[panel["timestamp"] <= cutoff].copy()
            prefix = _run_factor_once(module, prefix_panel)
            expected = first.loc[prefix_panel.index]
            if not _values_equal(expected, prefix):
                raise FactorRuntimeError(
                    "factor.lookahead",
                    "Past panel factor values change when future timestamps "
                    "are withheld",
                )
            prefix_components = _run_components_once(module, prefix_panel)
            if components is None and prefix_components is not None:
                raise FactorRuntimeError(
                    "factor.components-nondeterministic",
                    "Component declaration appeared only on a panel prefix",
                )
            if components is not None:
                if prefix_components is None:
                    raise FactorRuntimeError(
                        "factor.components-nondeterministic",
                        "Component declaration disappeared on a panel prefix",
                    )
                expected_components = FactorComponents(
                    values=components.values.loc[prefix_panel.index],
                    metadata=components.metadata,
                )
                if not _component_values_equal(
                    expected_components,
                    prefix_components,
                ):
                    raise FactorRuntimeError(
                        "factor.components-lookahead",
                        "Past component values or declarations change when "
                        "future timestamps are withheld",
                    )
            cuts.append(str(cutoff))

    return FactorEvaluation(
        panel=panel,
        values=first,
        components=components,
        causality_cuts=tuple(cuts),
    )


def values_to_wide(
    panel: pd.DataFrame,
    values: pd.Series,
    *,
    universe: Sequence[str] | None = None,
) -> pd.DataFrame:
    """Pivot one aligned panel Series into timestamp × asset form."""

    if len(values) != len(panel) or not values.index.equals(panel.index):
        raise FactorRuntimeError(
            "factor.alignment",
            "Values must preserve the exact panel length and index",
        )
    assets = (
        list(universe)
        if universe is not None
        else panel["asset"].drop_duplicates().tolist()
    )
    long = panel.loc[:, ["timestamp", "asset"]].copy()
    long["value"] = values.to_numpy(dtype=float)
    wide = long.pivot(index="timestamp", columns="asset", values="value")
    wide = wide.reindex(columns=assets)
    wide.columns.name = None
    return wide.sort_index()
