"""Train/Val/Holdout split isolation and audited Holdout unlock guardrails."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

import pandas as pd

from .backtest import BacktestResult, compute_equity_metrics
from .data import read_dataset_panel
from .factor import FactorResult
from .ledger import _HOLDOUT_CAPTURE, record_run, sanitize_metrics
from .panel import coerce_utc_timestamps, format_timestamps
from .workspace import (
    AutoQuantValidationError,
    HoldoutLockedError,
    ProjectContext,
    parse_split_end,
    record_holdout_unlock,
    resolve_project,
)


def _dataset_slice_summary(entry: Mapping[str, Any], sliced_panel: pd.DataFrame) -> dict[str, Any]:
    ts_fmt = format_timestamps(pd.DatetimeIndex(sliced_panel["timestamp"]))
    return {
        "id": entry.get("id"),
        "sha256": entry.get("sha256"),
        "interval": entry.get("interval"),
        "symbols": sorted(sliced_panel["asset"].unique().tolist()),
        "start": ts_fmt[0] if ts_fmt else entry.get("start"),
        "end": ts_fmt[-1] if ts_fmt else entry.get("end"),
        "rows": int(len(sliced_panel)),
    }


def load_panel(
    project: str | Path | ProjectContext,
    dataset_id: str | None = None,
    *,
    split: str = "val",
    calendar: str | Mapping[str, str] | None = None,
    project_id: str | None = None,
) -> pd.DataFrame:
    """Load an ingested OHLCV panel physically excluding Holdout bars by default.

    - `split="val"` (default): slices `timestamp <= val_end` when configured.
    - `split="train"`: slices `timestamp <= train_end`.
    - If no splits are configured on the project, returns the full panel tagged
      with `split="in_sample"`.
    - `split="holdout"` is strictly forbidden here; use `evaluate_holdout(...)`
      so every Holdout access is audited in `project.json`.
    """

    if split == "holdout":
        raise HoldoutLockedError(
            "Direct load_panel(..., split='holdout') is forbidden to prevent silent "
            "holdout snooping; call aq.evaluate_holdout(...) instead"
        )
    if split not in {"train", "val", "in_sample"}:
        raise AutoQuantValidationError(
            f"Unsupported split {split!r}; expected 'train', 'val', or 'in_sample'"
        )

    ctx = resolve_project(project, project_id=project_id)
    panel, entry = read_dataset_panel(ctx, dataset_id=dataset_id, calendar=calendar)

    splits = ctx.splits
    has_splits = any(splits.get(k) is not None for k in ("train_end", "val_end", "holdout_end"))

    if not has_splits:
        if split == "train":
            raise AutoQuantValidationError(
                f"Project {ctx.id!r} has no train_end configured; call set_project_splits first"
            )
        effective_split = "in_sample"
        sliced = panel.copy().reset_index(drop=True)
    elif split == "train":
        if splits.get("train_end") is None:
            raise AutoQuantValidationError(
                f"Project {ctx.id!r} has no train_end configured; call set_project_splits first"
            )
        bound = parse_split_end(splits["train_end"])  # type: ignore[arg-type]
        sliced = panel.loc[panel["timestamp"] <= bound].reset_index(drop=True)
        effective_split = "train"
    else:
        # Both 'val' and 'in_sample' remain strictly <= val_end whenever val_end is set!
        if splits.get("val_end") is not None:
            bound = parse_split_end(splits["val_end"])  # type: ignore[arg-type]
            sliced = panel.loc[panel["timestamp"] <= bound].reset_index(drop=True)
            effective_split = "val"
        elif splits.get("train_end") is not None and splits.get("holdout_end") is None:
            bound = parse_split_end(splits["train_end"])  # type: ignore[arg-type]
            sliced = panel.loc[panel["timestamp"] <= bound].reset_index(drop=True)
            effective_split = "train"
        else:
            raise AutoQuantValidationError(
                f"Project {ctx.id!r} must configure val_end before loading development data "
                "when holdout_end is set"
            )

    if sliced.empty:
        raise AutoQuantValidationError(
            f"Split {effective_split!r} contains 0 rows in dataset {entry['id']!r} "
            f"(dataset spans {entry.get('start')} .. {entry.get('end')})"
        )

    sliced.attrs["split"] = effective_split
    sliced.attrs["project_id"] = ctx.id
    sliced.attrs["project_dir"] = str(ctx.root_dir)
    sliced.attrs["dataset"] = _dataset_slice_summary(entry, sliced)
    return sliced


def _filter_holdout_equity(
    eq_df: pd.DataFrame | None,
    val_bound: pd.Timestamp,
) -> tuple[pd.DataFrame | None, bool]:
    """Ensure `equity_df` contains ONLY timestamps strictly `> val_bound`."""

    if eq_df is None or eq_df.empty:
        return eq_df, False
    ts = coerce_utc_timestamps(eq_df["timestamp"])
    if bool((ts <= val_bound).any()):
        filtered = eq_df.loc[(ts > val_bound).to_numpy()].copy().reset_index(drop=True)
        if filtered.empty:
            raise AutoQuantValidationError("Holdout equity series has 0 rows after val_end")
        rets = pd.to_numeric(filtered["returns"], errors="coerce").fillna(0.0).to_numpy(dtype="float64")
        rebased_eq = (1.0 + rets).cumprod()
        filtered["equity"] = rebased_eq
        filtered["drawdown"] = rebased_eq / pd.Series(rebased_eq).cummax().to_numpy() - 1.0
        if "benchmark_equity" in filtered.columns:
            b_eq = pd.to_numeric(filtered["benchmark_equity"], errors="coerce")
            if not b_eq.isna().all() and float(b_eq.iloc[0]) > 0:
                filtered["benchmark_equity"] = (b_eq / float(b_eq.iloc[0])).to_numpy(dtype="float64")
        return filtered, True
    return eq_df, False


def _filter_holdout_ic(
    ic_df: pd.DataFrame | None,
    val_bound: pd.Timestamp,
) -> pd.DataFrame | None:
    if ic_df is None or ic_df.empty:
        return ic_df
    ts = coerce_utc_timestamps(ic_df["timestamp"])
    if bool((ts <= val_bound).any()):
        return ic_df.loc[(ts > val_bound).to_numpy()].copy().reset_index(drop=True)
    return ic_df


def evaluate_holdout(
    project: str | Path | ProjectContext,
    evaluator_fn: Callable[[pd.DataFrame], Any],
    *,
    dataset_id: str | None = None,
    warmup_bars: int = 0,
    calendar: str | Mapping[str, str] | None = None,
    code_paths: str | Path | Iterable[str | Path] | None = None,
    name: str | None = None,
    hypothesis: str = "",
    parameters: Mapping[str, Any] | None = None,
    artifacts: Sequence[Any] | Mapping[str, Any] | None = None,
    notes: str = "",
    project_id: str | None = None,
) -> dict[str, Any]:
    """Audited Holdout unlock: runs `evaluator_fn`, logs unlock in `project.json`, and records a `holdout` Run.

    When `warmup_bars > 0`, up to `warmup_bars` trailing bars per asset `<= val_end`
    are prepended so rolling indicators warm up causally, while all metrics and
    series are scored strictly on timestamps `> val_end`.
    """

    if not callable(evaluator_fn):
        raise AutoQuantValidationError("evaluator_fn must be callable: evaluator_fn(holdout_panel)")
    if warmup_bars < 0:
        raise AutoQuantValidationError("warmup_bars must be >= 0")

    ctx = resolve_project(project, project_id=project_id)
    val_end_str = ctx.splits.get("val_end")
    if val_end_str is None:
        raise AutoQuantValidationError(
            f"Project {ctx.id!r} cannot unlock holdout because splits.val_end is not configured"
        )
    val_bound = parse_split_end(val_end_str)

    full_panel, entry = read_dataset_panel(ctx, dataset_id=dataset_id, calendar=calendar)
    holdout_end_str = ctx.splits.get("holdout_end")
    if holdout_end_str is not None:
        holdout_bound = parse_split_end(holdout_end_str)
        full_panel = full_panel.loc[full_panel["timestamp"] <= holdout_bound].reset_index(drop=True)

    strict_holdout = full_panel.loc[full_panel["timestamp"] > val_bound].reset_index(drop=True)
    if strict_holdout.empty:
        raise AutoQuantValidationError(
            f"Dataset {entry['id']!r} has 0 holdout bars strictly after val_end={val_end_str!r}"
        )

    holdout_start_ts: pd.Timestamp = strict_holdout["timestamp"].min()

    if warmup_bars > 0:
        prior = full_panel.loc[full_panel["timestamp"] <= val_bound]
        if not prior.empty:
            warmup_slice = (
                prior.groupby("asset", sort=False, group_keys=False)
                .tail(int(warmup_bars))
            )
            eval_panel = (
                pd.concat([warmup_slice, strict_holdout], ignore_index=True)
                .sort_values(["timestamp", "asset"], kind="mergesort")
                .reset_index(drop=True)
            )
        else:
            eval_panel = strict_holdout.copy()
    else:
        eval_panel = strict_holdout.copy()

    dataset_summary = _dataset_slice_summary(entry, strict_holdout)
    eval_panel.attrs["split"] = "holdout"
    eval_panel.attrs["eval_start"] = holdout_start_ts
    eval_panel.attrs["val_bound"] = val_bound
    eval_panel.attrs["project_id"] = ctx.id
    eval_panel.attrs["project_dir"] = str(ctx.root_dir)
    eval_panel.attrs["dataset"] = dataset_summary

    _HOLDOUT_CAPTURE.active = True
    _HOLDOUT_CAPTURE.captured_kwargs = None
    try:
        raw_out = evaluator_fn(eval_panel)
    finally:
        captured = _HOLDOUT_CAPTURE.captured_kwargs
        _HOLDOUT_CAPTURE.active = False
        _HOLDOUT_CAPTURE.captured_kwargs = None

    run_kind = "custom"
    inferred_name = "holdout-evaluation"
    metrics_dict: dict[str, float] = {}
    eq_df: pd.DataFrame | None = None
    ic_df: pd.DataFrame | None = None
    quantiles_payload: Mapping[str, Any] | None = None
    inner_params: dict[str, Any] = {}
    inner_hyp = ""
    inner_notes = ""
    inner_artifacts: Any = None
    inner_code_paths: Any = None

    if isinstance(raw_out, BacktestResult):
        run_kind = "backtest"
        inferred_name = raw_out.name
        metrics_dict = dict(raw_out.metrics)
        eq_df = raw_out.equity
        inner_params = dict(raw_out.parameters)
    elif isinstance(raw_out, FactorResult):
        run_kind = "factor"
        inferred_name = raw_out.name
        metrics_dict = dict(raw_out.metrics)
        eq_df = raw_out.equity
        ic_df = raw_out.ic
        quantiles_payload = raw_out.quantiles
        inner_params = dict(raw_out.parameters)
    elif captured is not None:
        run_kind = str(captured.get("kind", "custom"))
        inferred_name = str(captured.get("name", inferred_name))
        metrics_dict = dict(captured.get("metrics") or {})
        eq_df = captured.get("equity_df")
        ic_df = captured.get("ic_df")
        quantiles_payload = captured.get("quantiles_payload")
        inner_params = dict(captured.get("parameters") or {})
        inner_hyp = str(captured.get("hypothesis") or "")
        inner_notes = str(captured.get("notes") or "")
        inner_artifacts = captured.get("artifacts")
        inner_code_paths = captured.get("code_paths")
    elif isinstance(raw_out, Mapping):
        if isinstance(raw_out.get("kind"), str) and raw_out["kind"] in {"factor", "backtest", "custom"}:
            run_kind = raw_out["kind"]
        if isinstance(raw_out.get("name"), str) and raw_out["name"].strip():
            inferred_name = raw_out["name"].strip()
        if isinstance(raw_out.get("metrics"), Mapping):
            metrics_dict = sanitize_metrics(raw_out["metrics"])
        else:
            metrics_dict = sanitize_metrics(raw_out)
        if isinstance(raw_out.get("equity"), pd.DataFrame):
            eq_df = raw_out["equity"]
        elif isinstance(raw_out.get("equity_df"), pd.DataFrame):
            eq_df = raw_out["equity_df"]
        if isinstance(raw_out.get("ic"), pd.DataFrame):
            ic_df = raw_out["ic"]
        elif isinstance(raw_out.get("ic_df"), pd.DataFrame):
            ic_df = raw_out["ic_df"]
        if isinstance(raw_out.get("quantiles"), Mapping):
            quantiles_payload = raw_out["quantiles"]
        if isinstance(raw_out.get("parameters"), Mapping):
            inner_params = dict(raw_out["parameters"])
    else:
        raise AutoQuantValidationError(
            "evaluator_fn must return a BacktestResult, FactorResult, or metrics dict"
        )

    # Enforce strict > val_end filtering on any returned series
    eq_df, eq_was_trimmed = _filter_holdout_equity(eq_df, val_bound)
    ic_df = _filter_holdout_ic(ic_df, val_bound)
    if eq_was_trimmed and eq_df is not None and run_kind == "backtest":
        ppy = int(inner_params.get("periods_per_year") or 252)
        recomputed = compute_equity_metrics(eq_df, periods_per_year=ppy, skip_initial_anchor=False)
        metrics_dict.update(recomputed)

    final_params = dict(inner_params)
    if warmup_bars > 0:
        final_params["warmup_bars"] = int(warmup_bars)
    if parameters:
        final_params.update(parameters)

    final_name = (name.strip() if isinstance(name, str) and name.strip() else inferred_name)
    final_hyp = hypothesis or inner_hyp
    final_notes = notes or inner_notes
    final_artifacts = artifacts if artifacts is not None else inner_artifacts
    final_code_paths = code_paths if code_paths is not None else inner_code_paths

    recorded = record_run(
        ctx,
        kind=run_kind,
        name=final_name,
        split="holdout",
        metrics=metrics_dict,
        hypothesis=final_hyp,
        parameters=final_params,
        dataset=dataset_summary,
        code_paths=final_code_paths,
        equity_df=eq_df,
        ic_df=ic_df,
        quantiles_payload=quantiles_payload,
        artifacts=final_artifacts,
        notes=final_notes,
    )

    prov = recorded["provenance"]
    audit = record_holdout_unlock(
        ctx,
        run_id=recorded["id"],
        code_sha256=str(prov["code_sha256"]),
        git_commit=str(prov["git_commit"]),
        git_dirty=bool(prov["git_dirty"]),
    )

    result = dict(recorded)
    result["holdout_audit"] = audit
    return result
