"""Causal cross-sectional factor evaluation (IC, Rank IC, quantile buckets, decay)."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .backtest import _parse_eval_start, compute_equity_metrics
from .ledger import record_run
from .panel import coerce_utc_timestamps, format_timestamps, panel_to_wide, validate_panel
from .workspace import AutoQuantValidationError, ProjectContext


@dataclass(frozen=True)
class FactorResult(Mapping[str, Any]):
    """Cross-sectional factor evaluation output with attribute and dict access."""

    kind: str
    name: str
    split: str
    metrics: dict[str, float]
    ic: pd.DataFrame
    quantiles: dict[str, Any]
    equity: pd.DataFrame
    parameters: dict[str, Any]
    run: dict[str, Any] | None = None

    @property
    def run_id(self) -> str | None:
        return self.run["id"] if isinstance(self.run, Mapping) and "id" in self.run else None

    @property
    def id(self) -> str | None:
        return self.run_id

    @property
    def decay(self) -> list[dict[str, Any]]:
        return list(self.quantiles.get("decay", []))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "kind": self.kind,
            "name": self.name,
            "split": self.split,
            "metrics": dict(self.metrics),
            "quantiles": dict(self.quantiles),
            "parameters": dict(self.parameters),
        }
        if self.run is not None:
            payload["id"] = self.run.get("id")
            payload["run_id"] = self.run.get("id")
            payload["run"] = dict(self.run)
        return payload

    def __getitem__(self, key: str) -> Any:
        if key == "ic_df":
            return self.ic
        if key == "equity_df":
            return self.equity
        if key == "quantiles_payload":
            return self.quantiles
        data = self.to_dict()
        if key in data:
            return data[key]
        if self.run is not None and key in self.run:
            return self.run[key]
        raise KeyError(key)

    def __iter__(self) -> Iterator[str]:
        keys = list(self.to_dict().keys())
        if self.run is not None:
            for k in self.run:
                if k not in keys:
                    keys.append(k)
        return iter(keys)

    def __len__(self) -> int:
        return len(list(iter(self)))


def _coerce_factor_wide(
    factor_series_or_df: pd.DataFrame | pd.Series,
    panel: pd.DataFrame,
    close_wide: pd.DataFrame,
) -> pd.DataFrame:
    """Normalize factor input (wide DataFrame, MultiIndex Series, long DataFrame, or aligned Series)."""

    if isinstance(factor_series_or_df, pd.Series):
        if isinstance(factor_series_or_df.index, pd.MultiIndex) and factor_series_or_df.index.nlevels == 2:
            lvl0 = factor_series_or_df.index.get_level_values(0)
            try:
                ts_vals = coerce_utc_timestamps(lvl0)
                mi = pd.MultiIndex.from_arrays(
                    [ts_vals, factor_series_or_df.index.get_level_values(1).astype(str).str.strip()],
                    names=["timestamp", "asset"],
                )
                s = pd.Series(factor_series_or_df.to_numpy(), index=mi)
                wide = s.unstack("asset")
            except AutoQuantValidationError:
                ts_vals = coerce_utc_timestamps(factor_series_or_df.index.get_level_values(1))
                mi = pd.MultiIndex.from_arrays(
                    [ts_vals, lvl0.astype(str).str.strip()],
                    names=["timestamp", "asset"],
                )
                s = pd.Series(factor_series_or_df.to_numpy(), index=mi)
                wide = s.unstack("asset")
        elif len(factor_series_or_df) == len(panel):
            tmp = pd.DataFrame(
                {
                    "timestamp": panel["timestamp"].array,
                    "asset": panel["asset"].to_numpy(),
                    "factor": pd.to_numeric(factor_series_or_df, errors="raise").to_numpy(),
                }
            )
            wide = tmp.pivot(index="timestamp", columns="asset", values="factor")
        else:
            raise AutoQuantValidationError(
                "Factor Series must either have a (timestamp, asset) MultiIndex or match len(panel)"
            )
    elif isinstance(factor_series_or_df, pd.DataFrame):
        lower_cols = {str(c).strip().lower(): c for c in factor_series_or_df.columns}
        ts_col = next((lower_cols[a] for a in ("timestamp", "date", "datetime", "time") if a in lower_cols), None)
        asset_col = next((lower_cols[a] for a in ("asset", "symbol", "ticker") if a in lower_cols), None)
        if ts_col is not None and asset_col is not None:
            candidates = [c for c in factor_series_or_df.columns if c not in {ts_col, asset_col}]
            val_col = next(
                (lower_cols[a] for a in ("factor", "score", "signal", "value") if a in lower_cols),
                candidates[0] if len(candidates) == 1 else None,
            )
            if val_col is None:
                raise AutoQuantValidationError(
                    "Long factor DataFrame must contain a 'factor'/'score'/'value' column or single value column"
                )
            tmp = factor_series_or_df[[ts_col, asset_col, val_col]].copy()
            tmp[ts_col] = coerce_utc_timestamps(tmp[ts_col]).array
            tmp[asset_col] = tmp[asset_col].astype(str).str.strip()
            if tmp.duplicated(subset=[ts_col, asset_col]).any():
                raise AutoQuantValidationError("Duplicate (timestamp, asset) entries in factor DataFrame")
            wide = tmp.pivot(index=ts_col, columns=asset_col, values=val_col)
        else:
            wide = factor_series_or_df.copy()
            wide.index = pd.DatetimeIndex(coerce_utc_timestamps(wide.index))
            if wide.index.duplicated().any():
                raise AutoQuantValidationError("Duplicate timestamps in wide factor DataFrame")
            wide.columns = [str(c).strip() for c in wide.columns]
    else:
        raise AutoQuantValidationError("factor_series_or_df must be a pandas Series or DataFrame")

    wide = wide.sort_index().apply(pd.to_numeric, errors="raise").astype("float64")
    wide = wide.replace([np.inf, -np.inf], np.nan)
    aligned = wide.reindex(index=close_wide.index, columns=close_wide.columns)
    # Never evaluate factor where price itself is missing
    return aligned.where(close_wide.notna())


def _cross_sectional_ic(
    factor_wide: pd.DataFrame,
    fwd_ret_wide: pd.DataFrame,
    *,
    min_assets: int = 3,
) -> tuple[pd.Series, pd.Series]:
    """Vectorized per-timestamp Pearson IC and Spearman Rank IC."""

    valid = factor_wide.notna() & fwd_ret_wide.notna()
    counts = valid.sum(axis=1)
    x = factor_wide.where(valid)
    y = fwd_ret_wide.where(valid)

    dx = x.sub(x.mean(axis=1), axis=0)
    dy = y.sub(y.mean(axis=1), axis=0)
    ssx = (dx * dx).sum(axis=1)
    ssy = (dy * dy).sum(axis=1)
    denom = np.sqrt(ssx * ssy)
    pearson = (dx * dy).sum(axis=1) / denom.where((counts >= min_assets) & (denom > 1e-15))

    rx = x.rank(axis=1, method="average")
    ry = y.rank(axis=1, method="average")
    drx = rx.sub(rx.mean(axis=1), axis=0)
    dry = ry.sub(ry.mean(axis=1), axis=0)
    rssx = (drx * drx).sum(axis=1)
    rssy = (dry * dry).sum(axis=1)
    rdenom = np.sqrt(rssx * rssy)
    spearman = (drx * dry).sum(axis=1) / rdenom.where((counts >= min_assets) & (rdenom > 1e-15))
    return pearson, spearman


def evaluate_factor(
    factor_series_or_df: pd.DataFrame | pd.Series,
    panel: pd.DataFrame,
    *,
    horizons: Sequence[int] = (1, 5, 10, 20),
    quantiles: int = 5,
    periods_per_year: int = 252,
    eval_start: str | pd.Timestamp | None = None,
    project: str | Path | ProjectContext | None = None,
    name: str = "factor-evaluation",
    split: str | None = None,
    hypothesis: str = "",
    parameters: Mapping[str, Any] | None = None,
    artifacts: Sequence[Any] | Mapping[str, Any] | None = None,
    notes: str = "",
    code_paths: str | Path | Iterable[str | Path] | None = None,
    record: bool = True,
) -> FactorResult:
    """Evaluate cross-sectional predictive power, quantile spread, and horizon decay causally."""

    if quantiles < 2:
        raise AutoQuantValidationError("quantiles must be >= 2")
    clean_horizons = sorted({int(h) for h in horizons})
    if not clean_horizons or clean_horizons[0] < 1:
        raise AutoQuantValidationError("horizons must contain positive integers >= 1")
    if periods_per_year <= 0:
        raise AutoQuantValidationError("periods_per_year must be > 0")

    validated_panel = validate_panel(panel)
    close_wide = panel_to_wide(validated_panel, "close")
    if close_wide.shape[1] < max(2, quantiles):
        raise AutoQuantValidationError(
            f"Factor evaluation with quantiles={quantiles} requires at least {quantiles} assets "
            f"(panel has {close_wide.shape[1]})"
        )
    if len(close_wide) < 3:
        raise AutoQuantValidationError("Factor evaluation requires at least 3 timestamps")

    factor_wide = _coerce_factor_wide(factor_series_or_df, validated_panel, close_wide)

    effective_eval_start = _parse_eval_start(
        eval_start if eval_start is not None else validated_panel.attrs.get("eval_start")
    )
    eval_mask = (
        close_wide.index >= effective_eval_start
        if effective_eval_start is not None
        else pd.Series(True, index=close_wide.index).to_numpy()
    )

    # Compute horizon IC decay strictly causally: factor[t] vs close[t+h]/close[t] - 1
    decay_rows: list[dict[str, Any]] = []
    primary_h = clean_horizons[0]
    primary_ic_series = pd.Series(dtype="float64")
    primary_rank_ic_series = pd.Series(dtype="float64")

    for h in clean_horizons:
        if h >= len(close_wide):
            continue
        fwd_h = close_wide.shift(-h) / close_wide - 1.0
        ic_s, ric_s = _cross_sectional_ic(
            factor_wide.loc[eval_mask],
            fwd_h.loc[eval_mask],
            min_assets=max(3, min(quantiles, close_wide.shape[1])),
        )
        if h == primary_h:
            primary_ic_series = ic_s
            primary_rank_ic_series = ric_s
        ic_valid = ic_s.dropna()
        ric_valid = ric_s.dropna()
        decay_rows.append(
            {
                "horizon": int(h),
                "ic_mean": float(ic_valid.mean()) if not ic_valid.empty else 0.0,
                "rank_ic_mean": float(ric_valid.mean()) if not ric_valid.empty else 0.0,
            }
        )

    ic_df = pd.DataFrame(
        {
            "timestamp": primary_ic_series.index,
            "ic": primary_ic_series.to_numpy(dtype="float64"),
            "rank_ic": primary_rank_ic_series.to_numpy(dtype="float64"),
        }
    ).dropna(subset=["ic", "rank_ic"], how="all").reset_index(drop=True)

    # Causal 1-bar quantile bucketing & long-short portfolio:
    # Signal at bar t-1 close earns realized 1-bar return at bar t (`close[t]/close[t-1] - 1`)
    realized_1bar = close_wide / close_wide.shift(1) - 1.0
    lagged_factor = factor_wide.shift(1)

    scored_idx = close_wide.index[eval_mask]
    has_prior_warmup = (
        bool((close_wide.index < effective_eval_start).any())
        if effective_eval_start is not None
        else False
    )

    f_lag = lagged_factor.loc[scored_idx]
    r_now = realized_1bar.loc[scored_idx]
    n_dates, n_assets = f_lag.shape

    bucket_rets = np.zeros((n_dates, quantiles), dtype="float64")
    ls_weights = np.zeros((n_dates, n_assets), dtype="float64")

    f_arr = f_lag.to_numpy()
    r_arr = r_now.to_numpy()

    for t in range(n_dates):
        if t == 0 and not has_prior_warmup:
            continue
        valid_t = np.isfinite(f_arr[t]) & np.isfinite(r_arr[t])
        m = int(valid_t.sum())
        if m < quantiles:
            continue
        vals = f_arr[t, valid_t]
        if float(np.std(vals)) <= 1e-12:
            continue
        valid_indices = np.flatnonzero(valid_t)
        # Stable sort so bucket sizes are balanced across 1..quantiles
        order = np.argsort(vals, kind="mergesort")
        ranks_zero = np.empty(m, dtype="int64")
        ranks_zero[order] = np.arange(m, dtype="int64")
        buckets = np.minimum((ranks_zero * quantiles) // m, quantiles - 1)  # 0 .. quantiles-1

        for b in range(quantiles):
            in_b = buckets == b
            cnt_b = int(in_b.sum())
            if cnt_b > 0:
                bucket_rets[t, b] = float(np.mean(r_arr[t, valid_indices[in_b]]))
                if b == quantiles - 1:
                    ls_weights[t, valid_indices[in_b]] = 0.5 / float(cnt_b)
                elif b == 0:
                    ls_weights[t, valid_indices[in_b]] = -0.5 / float(cnt_b)

    ls_rets = (ls_weights * np.nan_to_num(r_arr, nan=0.0)).sum(axis=1)
    prev_ls_w = np.vstack([np.zeros((1, n_assets), dtype="float64"), ls_weights[:-1]])
    ls_turnover = np.abs(ls_weights - prev_ls_w).sum(axis=1)
    if not has_prior_warmup and n_dates > 0:
        ls_turnover[0] = 0.0

    ls_equity = np.cumprod(1.0 + ls_rets)
    ls_peak = np.maximum.accumulate(ls_equity)
    ls_dd = ls_equity / ls_peak - 1.0
    ls_gross = np.abs(ls_weights).sum(axis=1)
    ls_net = ls_weights.sum(axis=1)

    eq_df = pd.DataFrame(
        {
            "timestamp": scored_idx,
            "equity": ls_equity,
            "returns": ls_rets,
            "drawdown": ls_dd,
            "turnover": ls_turnover,
            "gross_exposure": ls_gross,
            "net_exposure": ls_net,
        }
    )

    start_bar = 0 if has_prior_warmup else (1 if n_dates > 1 else 0)
    quantile_summaries: list[dict[str, Any]] = []
    cum_buckets: dict[str, list[float]] = {}
    for b in range(quantiles):
        b_series = bucket_rets[:, b]
        b_scored = b_series[start_bar:]
        b_mean_ann = float(np.mean(b_scored) * periods_per_year) if len(b_scored) > 0 else 0.0
        b_std = float(np.std(b_scored, ddof=1)) if len(b_scored) >= 2 else 0.0
        b_sharpe = (
            (float(np.mean(b_scored)) / b_std) * math.sqrt(periods_per_year)
            if b_std > 1e-15
            else 0.0
        )
        quantile_summaries.append(
            {
                "bucket": b + 1,
                "mean_return": b_mean_ann,
                "sharpe": b_sharpe,
            }
        )
        cum_curve = np.cumprod(1.0 + b_series)
        cum_buckets[str(b + 1)] = [float(v) for v in cum_curve]

    quantiles_payload: dict[str, Any] = {
        "quantiles": quantile_summaries,
        "decay": decay_rows,
        "cumulative": {
            "timestamps": format_timestamps(scored_idx),
            "buckets": cum_buckets,
        },
    }

    # IC summary statistics
    ic_clean = ic_df["ic"].dropna().to_numpy(dtype="float64")
    ric_clean = ic_df["rank_ic"].dropna().to_numpy(dtype="float64")

    def _ic_stats(vals: np.ndarray) -> tuple[float, float, float, float]:
        if len(vals) == 0:
            return 0.0, 0.0, 0.0, 0.0
        mean_v = float(np.mean(vals))
        if len(vals) < 2:
            return mean_v, 0.0, 0.0, 0.0
        std_v = float(np.std(vals, ddof=1))
        if std_v <= 1e-15:
            return mean_v, 0.0, 0.0, 0.0
        ir_v = mean_v / std_v
        tstat_v = mean_v / (std_v / math.sqrt(len(vals)))
        return mean_v, std_v, tstat_v, ir_v

    ic_mean, ic_std, ic_tstat, ic_ir = _ic_stats(ic_clean)
    ric_mean, ric_std, ric_tstat, ric_ir = _ic_stats(ric_clean)

    port_metrics = compute_equity_metrics(
        eq_df,
        periods_per_year=int(periods_per_year),
        skip_initial_anchor=not has_prior_warmup,
    )
    ls_sharpe = port_metrics.get("sharpe", 0.0)
    spread_ann = (
        quantile_summaries[-1]["mean_return"] - quantile_summaries[0]["mean_return"]
        if len(quantile_summaries) >= 2
        else 0.0
    )

    metrics: dict[str, float] = {
        "ic_mean": ic_mean,
        "ic_std": ic_std,
        "ic_tstat": ic_tstat,
        "ic_ir": ic_ir,
        "rank_ic_mean": ric_mean,
        "rank_ic_std": ric_std,
        "rank_ic_tstat": ric_tstat,
        "rank_ic_ir": ric_ir,
        "long_short_sharpe": ls_sharpe,
        "sharpe": ls_sharpe,
        "top_bottom_spread": spread_ann,
        "annual_return": port_metrics.get("annual_return", 0.0),
        "annual_volatility": port_metrics.get("annual_volatility", 0.0),
        "max_drawdown": port_metrics.get("max_drawdown", 0.0),
        "calmar": port_metrics.get("calmar", 0.0),
        "turnover": port_metrics.get("turnover", 0.0),
    }

    effective_split = split or str(validated_panel.attrs.get("split") or "in_sample")
    merged_params: dict[str, Any] = {
        "horizons": [int(h) for h in clean_horizons],
        "quantiles": int(quantiles),
        "periods_per_year": int(periods_per_year),
    }
    if parameters:
        merged_params.update(parameters)

    recorded_run: dict[str, Any] | None = None
    if record and project is not None:
        recorded_run = record_run(
            project,
            kind="factor",
            name=name,
            split=effective_split,
            metrics=metrics,
            hypothesis=hypothesis,
            parameters=merged_params,
            dataset=validated_panel.attrs.get("dataset"),
            code_paths=code_paths,
            equity_df=eq_df,
            ic_df=ic_df,
            quantiles_payload=quantiles_payload,
            artifacts=artifacts,
            notes=notes,
        )

    return FactorResult(
        kind="factor",
        name=name,
        split=effective_split,
        metrics=metrics,
        ic=ic_df,
        quantiles=quantiles_payload,
        equity=eq_df,
        parameters=merged_params,
        run=recorded_run,
    )
