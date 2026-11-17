"""Causal portfolio backtesting, transaction cost modeling, and risk-weight helpers."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .ledger import record_run
from .panel import coerce_utc_timestamps, panel_to_wide, validate_panel
from .workspace import AutoQuantValidationError, ProjectContext


@dataclass(frozen=True)
class BacktestResult(Mapping[str, Any]):
    """Portfolio backtest output supporting both attribute and dict-style access."""

    kind: str
    name: str
    split: str
    metrics: dict[str, float]
    equity: pd.DataFrame
    weights: pd.DataFrame
    parameters: dict[str, Any]
    run: dict[str, Any] | None = None

    @property
    def run_id(self) -> str | None:
        return self.run["id"] if isinstance(self.run, Mapping) and "id" in self.run else None

    @property
    def id(self) -> str | None:
        return self.run_id

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "kind": self.kind,
            "name": self.name,
            "split": self.split,
            "metrics": dict(self.metrics),
            "parameters": dict(self.parameters),
        }
        if self.run is not None:
            payload["id"] = self.run.get("id")
            payload["run_id"] = self.run.get("id")
            payload["run"] = dict(self.run)
        return payload

    def __getitem__(self, key: str) -> Any:
        if key == "equity_df":
            return self.equity
        if key == "weights_df":
            return self.weights
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


def _parse_eval_start(value: str | pd.Timestamp | None) -> pd.Timestamp | None:
    if value is None:
        return None
    ts = pd.Timestamp(value)
    if pd.isna(ts):
        raise AutoQuantValidationError(f"Invalid eval_start timestamp: {value!r}")
    if ts.tzinfo is None:
        return ts.tz_localize("UTC")
    return ts.tz_convert("UTC")


def _coerce_weights_wide(
    weights_df: pd.DataFrame | pd.Series,
    close_wide: pd.DataFrame,
) -> pd.DataFrame:
    """Normalize wide DataFrame, MultiIndex Series, or long DataFrame to `timestamp x asset`."""

    if isinstance(weights_df, pd.Series):
        if isinstance(weights_df.index, pd.MultiIndex) and weights_df.index.nlevels == 2:
            unstacked = weights_df.unstack()
            unstacked.index = pd.DatetimeIndex(coerce_utc_timestamps(unstacked.index))
            wide = unstacked.sort_index()
        else:
            raise AutoQuantValidationError(
                "Series weights must have a 2-level (timestamp, asset) MultiIndex"
            )
    elif isinstance(weights_df, pd.DataFrame):
        lower_cols = {str(c).strip().lower(): c for c in weights_df.columns}
        ts_col = next((lower_cols[a] for a in ("timestamp", "date", "datetime", "time") if a in lower_cols), None)
        asset_col = next((lower_cols[a] for a in ("asset", "symbol", "ticker") if a in lower_cols), None)
        if ts_col is not None and asset_col is not None:
            val_candidates = [
                c for c in weights_df.columns if c not in {ts_col, asset_col}
            ]
            weight_col = lower_cols.get("weight") or (val_candidates[0] if len(val_candidates) == 1 else None)
            if weight_col is None:
                raise AutoQuantValidationError(
                    "Long weights_df must have a 'weight' column or a single value column"
                )
            tmp = weights_df[[ts_col, asset_col, weight_col]].copy()
            tmp[ts_col] = coerce_utc_timestamps(tmp[ts_col]).array
            tmp[asset_col] = tmp[asset_col].astype(str).str.strip()
            if tmp.duplicated(subset=[ts_col, asset_col]).any():
                raise AutoQuantValidationError("Duplicate (timestamp, asset) entries in weights_df")
            wide = tmp.pivot(index=ts_col, columns=asset_col, values=weight_col).sort_index()
        else:
            wide = weights_df.copy()
            wide.index = pd.DatetimeIndex(coerce_utc_timestamps(wide.index))
            if wide.index.duplicated().any():
                raise AutoQuantValidationError("Duplicate timestamp index entries in weights_df")
            wide = wide.sort_index()
            wide.columns = [str(c).strip() for c in wide.columns]
    else:
        raise AutoQuantValidationError("weights_df must be a DataFrame or MultiIndex Series")

    if wide.empty:
        raise AutoQuantValidationError("weights_df cannot be empty")

    numeric = wide.apply(pd.to_numeric, errors="raise").astype("float64")
    arr = numeric.to_numpy()
    if np.isinf(arr).any():
        raise AutoQuantValidationError("weights_df contains infinite values")

    unknown_assets = sorted(set(numeric.columns) - set(close_wide.columns))
    if unknown_assets:
        raise AutoQuantValidationError(
            f"weights_df references assets absent from panel: {unknown_assets}"
        )

    # On explicit rebalance timestamps, NaN means 0 weight; between sparse rebalance
    # dates, carry the prior rebalance portfolio forward causally.
    explicit_zeroed = numeric.fillna(0.0).reindex(columns=close_wide.columns, fill_value=0.0)
    combined_idx = close_wide.index.union(explicit_zeroed.index).sort_values()
    aligned = explicit_zeroed.reindex(combined_idx).ffill().reindex(close_wide.index).fillna(0.0)
    # Never allocate to an asset on a bar where its close price is unobserved
    aligned = aligned.where(close_wide.notna(), 0.0)
    return aligned


def _apply_vol_target(
    weights: pd.DataFrame,
    asset_returns: pd.DataFrame,
    *,
    vol_target: float,
    vol_lookback: int,
    periods_per_year: int,
) -> pd.DataFrame:
    """Causally scale down portfolio weights when trailing realized vol exceeds `vol_target`."""

    if vol_target <= 0:
        raise AutoQuantValidationError("vol_target must be > 0")
    if vol_lookback < 2:
        raise AutoQuantValidationError("vol_lookback must be >= 2")

    out = weights.copy()
    w_arr = out.to_numpy(copy=True)
    r_arr = np.nan_to_num(asset_returns.to_numpy(), nan=0.0)
    ann_factor = float(periods_per_year)

    for t in range(vol_lookback, len(w_arr)):
        w_t = w_arr[t]
        if np.all(w_t == 0.0):
            continue
        # At bar t close, returns up to and including index t (t-1 -> t) are known!
        window = r_arr[t - vol_lookback + 1 : t + 1]
        cov = np.cov(window, rowvar=False, ddof=1)
        if cov.ndim == 0:
            port_var = float(cov) * float(w_t[0] ** 2)
        else:
            port_var = float(w_t @ cov @ w_t)
        if port_var <= 0.0 or not math.isfinite(port_var):
            continue
        ex_ante_vol = math.sqrt(port_var * ann_factor)
        if ex_ante_vol > vol_target:
            w_arr[t] = w_t * (vol_target / ex_ante_vol)

    return pd.DataFrame(w_arr, index=weights.index, columns=weights.columns)


def _resolve_benchmark_returns(
    benchmark: str | pd.Series | None,
    close_wide: pd.DataFrame,
    asset_simple_ret: pd.DataFrame,
) -> pd.Series | None:
    if benchmark is None:
        return None
    if isinstance(benchmark, str):
        key = benchmark.strip()
        if key.lower() in {"equal_weight", "ew", "1/n"}:
            return asset_simple_ret.mean(axis=1).fillna(0.0)
        if key not in close_wide.columns:
            raise AutoQuantValidationError(
                f"Benchmark symbol {key!r} not found in panel assets {list(close_wide.columns)}"
            )
        return asset_simple_ret[key].fillna(0.0)
    if isinstance(benchmark, pd.Series):
        s = benchmark.copy()
        s.index = pd.DatetimeIndex(coerce_utc_timestamps(s.index))
        s = pd.to_numeric(s, errors="raise").astype("float64").sort_index()
        aligned = s.reindex(close_wide.index)
        # Heuristic: if strictly positive with median > 2.0, treat as price/level series
        valid = aligned.dropna()
        if not valid.empty and (valid > 0).all() and float(valid.median()) > 2.0:
            return (aligned / aligned.shift(1) - 1.0).fillna(0.0)
        return aligned.fillna(0.0)
    raise AutoQuantValidationError("benchmark must be an asset symbol, 'equal_weight', or a pd.Series")


def compute_equity_metrics(
    equity_df: pd.DataFrame,
    *,
    periods_per_year: int = 252,
    skip_initial_anchor: bool = False,
) -> dict[str, float]:
    """Compute portfolio performance and risk statistics from `equity_df`."""

    if equity_df.empty:
        return {}
    scored = equity_df.iloc[1:] if (skip_initial_anchor and len(equity_df) > 1) else equity_df
    rets = scored["returns"].to_numpy(dtype="float64")
    turnover = scored["turnover"].to_numpy(dtype="float64")
    n_periods = len(rets)

    final_eq = float(equity_df["equity"].iloc[-1])
    total_return = final_eq - 1.0
    if n_periods > 0 and final_eq > 0.0:
        annual_return = float(final_eq ** (periods_per_year / n_periods) - 1.0)
    elif final_eq <= 0.0:
        annual_return = -1.0
    else:
        annual_return = 0.0

    if n_periods >= 2:
        std = float(np.std(rets, ddof=1))
        ann_vol = std * math.sqrt(periods_per_year)
        mean_ret = float(np.mean(rets))
        sharpe = (mean_ret / std) * math.sqrt(periods_per_year) if std > 1e-15 else 0.0
        downside = np.minimum(rets, 0.0)
        downside_rms = float(np.sqrt(np.mean(downside * downside)))
        downside_vol = downside_rms * math.sqrt(periods_per_year)
        sortino = (mean_ret * periods_per_year / downside_vol) if downside_vol > 1e-15 else 0.0
    else:
        ann_vol = 0.0
        sharpe = 0.0
        sortino = 0.0

    max_dd = float(equity_df["drawdown"].min()) if not equity_df["drawdown"].empty else 0.0
    calmar = (annual_return / abs(max_dd)) if max_dd < -1e-12 else 0.0
    mean_turnover = float(np.mean(turnover)) if n_periods > 0 else 0.0

    metrics: dict[str, float] = {
        "sharpe": sharpe,
        "sortino": sortino,
        "calmar": calmar,
        "annual_return": annual_return,
        "total_return": total_return,
        "annual_volatility": ann_vol,
        "max_drawdown": max_dd,
        "turnover": mean_turnover,
    }

    if "cost" in scored.columns:
        metrics["total_cost"] = float(scored["cost"].sum())

    if "benchmark_returns" in scored.columns and "benchmark_equity" in equity_df.columns:
        b_rets = scored["benchmark_returns"].to_numpy(dtype="float64")
        b_final = float(equity_df["benchmark_equity"].iloc[-1])
        b_total = b_final - 1.0
        b_ann = (
            float(b_final ** (periods_per_year / n_periods) - 1.0)
            if (n_periods > 0 and b_final > 0.0)
            else 0.0
        )
        active_rets = rets - b_rets
        if n_periods >= 2:
            te_std = float(np.std(active_rets, ddof=1))
            tracking_error = te_std * math.sqrt(periods_per_year)
            info_ratio = (
                (float(np.mean(active_rets)) / te_std) * math.sqrt(periods_per_year)
                if te_std > 1e-15
                else 0.0
            )
            b_var = float(np.var(b_rets, ddof=1))
            beta = float(np.cov(rets, b_rets, ddof=1)[0, 1] / b_var) if b_var > 1e-15 else 0.0
        else:
            tracking_error = 0.0
            info_ratio = 0.0
            beta = 0.0

        metrics["benchmark_return"] = b_ann
        metrics["benchmark_total_return"] = b_total
        metrics["active_return"] = annual_return - b_ann
        metrics["tracking_error"] = tracking_error
        metrics["information_ratio"] = info_ratio
        metrics["beta"] = beta

    return metrics


def backtest_weights(
    weights_df: pd.DataFrame | pd.Series,
    panel: pd.DataFrame,
    *,
    cost_bps: float = 5.0,
    slippage_bps: float = 0.0,
    max_gross: float | None = 1.0,
    max_weight: float | None = None,
    vol_target: float | None = None,
    vol_lookback: int = 20,
    benchmark: str | pd.Series | None = None,
    periods_per_year: int = 252,
    eval_start: str | pd.Timestamp | None = None,
    project: str | Path | ProjectContext | None = None,
    name: str = "portfolio-backtest",
    split: str | None = None,
    hypothesis: str = "",
    parameters: Mapping[str, Any] | None = None,
    artifacts: Sequence[Any] | Mapping[str, Any] | None = None,
    notes: str = "",
    code_paths: str | Path | Iterable[str | Path] | None = None,
    record: bool = True,
) -> BacktestResult:
    """Run a strictly causal portfolio backtest (`w[t]` earns `close[t] -> close[t+1]`)."""

    if cost_bps < 0 or slippage_bps < 0:
        raise AutoQuantValidationError("cost_bps and slippage_bps must be >= 0")
    if periods_per_year <= 0:
        raise AutoQuantValidationError("periods_per_year must be > 0")
    if max_gross is not None and max_gross <= 0:
        raise AutoQuantValidationError("max_gross must be > 0 when specified")
    if max_weight is not None and max_weight <= 0:
        raise AutoQuantValidationError("max_weight must be > 0 when specified")

    validated_panel = validate_panel(panel)
    close_wide = panel_to_wide(validated_panel, "close")
    if len(close_wide) < 2:
        raise AutoQuantValidationError("Backtest requires at least 2 timestamps in panel")

    target_w = _coerce_weights_wide(weights_df, close_wide)

    if max_weight is not None:
        target_w = target_w.clip(lower=-float(max_weight), upper=float(max_weight))

    if max_gross is not None:
        gross = target_w.abs().sum(axis=1)
        scale = np.where(gross > float(max_gross), float(max_gross) / np.maximum(gross, 1e-15), 1.0)
        target_w = target_w.mul(scale, axis=0)

    # Asset return realized at bar t is close[t] / close[t-1] - 1.0 (no forward-fill!)
    asset_simple_ret = close_wide / close_wide.shift(1) - 1.0

    if vol_target is not None:
        target_w = _apply_vol_target(
            target_w,
            asset_simple_ret,
            vol_target=float(vol_target),
            vol_lookback=int(vol_lookback),
            periods_per_year=int(periods_per_year),
        )

    # Strictly causal execution: weights chosen at bar t-1 close earn bar t-1 -> t return!
    # Zero any held position whose realized return at t is missing so NaNs cannot poison equity.
    held_w = target_w.shift(1).fillna(0.0)
    tradable_ret = asset_simple_ret.notna()
    held_w_active = held_w.where(tradable_ret | (held_w == 0.0), 0.0)

    prev_held = held_w.shift(1).fillna(0.0)
    turnover_series = (held_w - prev_held).abs().sum(axis=1)
    # Initial bar t_0 precedes the first return interval
    turnover_series.iloc[0] = 0.0

    rate = (float(cost_bps) + float(slippage_bps)) * 1e-4
    cost_series = turnover_series * rate
    gross_ret = (held_w_active * asset_simple_ret.fillna(0.0)).sum(axis=1)
    gross_ret.iloc[0] = 0.0
    net_ret = gross_ret - cost_series

    bench_ret = _resolve_benchmark_returns(benchmark, close_wide, asset_simple_ret)
    if bench_ret is not None:
        bench_ret = bench_ret.copy()
        bench_ret.iloc[0] = 0.0

    effective_eval_start = _parse_eval_start(
        eval_start if eval_start is not None else validated_panel.attrs.get("eval_start")
    )
    skip_initial = True
    if effective_eval_start is not None:
        mask = close_wide.index >= effective_eval_start
        if not mask.any():
            raise AutoQuantValidationError(
                f"No timestamps in panel on or after eval_start={effective_eval_start}"
            )
        has_prior_warmup = bool((close_wide.index < effective_eval_start).any())
        skip_initial = not has_prior_warmup
        net_ret = net_ret.loc[mask]
        cost_series = cost_series.loc[mask]
        turnover_series = turnover_series.loc[mask]
        held_w = held_w.loc[mask]
        if bench_ret is not None:
            bench_ret = bench_ret.loc[mask]

    equity_curve = (1.0 + net_ret).cumprod()
    drawdown_curve = equity_curve / equity_curve.cummax() - 1.0
    gross_exp = held_w.abs().sum(axis=1)
    net_exp = held_w.sum(axis=1)

    eq_frame = pd.DataFrame(
        {
            "timestamp": equity_curve.index,
            "equity": equity_curve.to_numpy(dtype="float64"),
            "returns": net_ret.to_numpy(dtype="float64"),
            "drawdown": drawdown_curve.to_numpy(dtype="float64"),
            "turnover": turnover_series.to_numpy(dtype="float64"),
            "gross_exposure": gross_exp.to_numpy(dtype="float64"),
            "net_exposure": net_exp.to_numpy(dtype="float64"),
            "cost": cost_series.to_numpy(dtype="float64"),
        }
    )
    if bench_ret is not None:
        bench_eq = (1.0 + bench_ret).cumprod()
        eq_frame["benchmark_equity"] = bench_eq.to_numpy(dtype="float64")
        eq_frame["benchmark_returns"] = bench_ret.to_numpy(dtype="float64")

    metrics = compute_equity_metrics(
        eq_frame,
        periods_per_year=int(periods_per_year),
        skip_initial_anchor=skip_initial,
    )

    # Trim internal helper columns before persisting equity.csv
    keep_eq_cols = [
        "timestamp",
        "equity",
        "returns",
        "drawdown",
        "turnover",
        "gross_exposure",
        "net_exposure",
    ]
    if "benchmark_equity" in eq_frame.columns:
        keep_eq_cols.append("benchmark_equity")
    clean_eq_df = eq_frame.loc[:, keep_eq_cols].copy()

    effective_split = split or str(validated_panel.attrs.get("split") or "in_sample")
    merged_params: dict[str, Any] = {
        "cost_bps": float(cost_bps),
        "slippage_bps": float(slippage_bps),
        "max_gross": float(max_gross) if max_gross is not None else None,
        "max_weight": float(max_weight) if max_weight is not None else None,
        "vol_target": float(vol_target) if vol_target is not None else None,
        "vol_lookback": int(vol_lookback) if vol_target is not None else None,
        "periods_per_year": int(periods_per_year),
    }
    if isinstance(benchmark, str):
        merged_params["benchmark"] = benchmark
    if parameters:
        merged_params.update(parameters)

    recorded_run: dict[str, Any] | None = None
    if record and project is not None:
        recorded_run = record_run(
            project,
            kind="backtest",
            name=name,
            split=effective_split,
            metrics=metrics,
            hypothesis=hypothesis,
            parameters=merged_params,
            dataset=validated_panel.attrs.get("dataset"),
            code_paths=code_paths,
            equity_df=clean_eq_df,
            artifacts=artifacts,
            notes=notes,
        )

    return BacktestResult(
        kind="backtest",
        name=name,
        split=effective_split,
        metrics=metrics,
        equity=clean_eq_df,
        weights=target_w,
        parameters=merged_params,
        run=recorded_run,
    )


def inverse_vol_weights(
    returns_df: pd.DataFrame,
    *,
    lookback: int = 20,
    max_gross: float = 1.0,
    min_periods: int | None = None,
) -> pd.DataFrame:
    """Compute causal long-only inverse-volatility weights from wide `returns_df`."""

    if lookback < 2:
        raise AutoQuantValidationError("lookback must be >= 2")
    if max_gross <= 0:
        raise AutoQuantValidationError("max_gross must be > 0")
    min_p = lookback if min_periods is None else max(2, int(min_periods))
    vol = returns_df.rolling(lookback, min_periods=min_p).std(ddof=1)
    inv_vol = 1.0 / vol.where(vol > 1e-12)
    row_sum = inv_vol.sum(axis=1)
    weights = inv_vol.div(row_sum.where(row_sum > 0.0), axis=0).fillna(0.0) * float(max_gross)
    return weights


def _solve_erc_single(
    cov: np.ndarray,
    *,
    max_iter: int = 200,
    tol: float = 1e-7,
) -> np.ndarray:
    """Solve long-only Equal Risk Contribution via Spinu (2013) coordinate descent."""

    n = cov.shape[0]
    if n == 1:
        return np.array([1.0], dtype="float64")

    # Symmetrize and add tiny ridge for strict convexity on collinear windows
    sym = 0.5 * (cov + cov.T)
    avg_diag = float(np.mean(np.diag(sym)))
    ridge = max(1e-10, 1e-8 * avg_diag) if avg_diag > 0 else 1e-8
    sigma = sym + np.eye(n, dtype="float64") * ridge
    diag = np.diag(sigma)
    b = 1.0 / float(n)

    x = 1.0 / np.sqrt(np.maximum(diag, 1e-12))
    sigma_x = sigma @ x

    for _ in range(max_iter):
        max_delta = 0.0
        for i in range(n):
            a_i = diag[i]
            c_i = sigma_x[i] - a_i * x[i]
            disc = c_i * c_i + 4.0 * a_i * b
            x_new = (-c_i + math.sqrt(max(disc, 0.0))) / (2.0 * a_i)
            diff = x_new - x[i]
            if diff != 0.0:
                sigma_x = sigma_x + sigma[:, i] * diff
                x[i] = x_new
                if abs(diff) > max_delta:
                    max_delta = abs(diff)
        if max_delta <= tol:
            break

    total = float(np.sum(x))
    if total <= 0.0 or not math.isfinite(total):
        return np.full(n, 1.0 / float(n), dtype="float64")
    return x / total


def equal_risk_contribution_weights(
    returns_df: pd.DataFrame,
    *,
    lookback: int = 60,
    max_gross: float = 1.0,
    max_iter: int = 200,
    tol: float = 1e-7,
    min_periods: int | None = None,
) -> pd.DataFrame:
    """Compute causal Equal Risk Contribution (Risk Parity) weights from wide `returns_df`."""

    if lookback < 2:
        raise AutoQuantValidationError("lookback must be >= 2")
    if max_gross <= 0:
        raise AutoQuantValidationError("max_gross must be > 0")

    clean = returns_df.sort_index().apply(pd.to_numeric, errors="raise").astype("float64")
    min_p = lookback if min_periods is None else max(2, int(min_periods))
    arr = clean.to_numpy()
    n_rows, n_cols = arr.shape
    out = np.zeros((n_rows, n_cols), dtype="float64")

    for t in range(min_p - 1, n_rows):
        start_idx = max(0, t - lookback + 1)
        window = arr[start_idx : t + 1]
        # Include assets with full finite observations in the lookback window (or >= min_p)
        valid_counts = np.isfinite(window).sum(axis=0)
        active_mask = valid_counts >= min_p
        if not np.any(active_mask):
            continue
        sub = np.nan_to_num(window[:, active_mask], nan=0.0)
        stds = np.std(sub, axis=0, ddof=1)
        non_zero = stds > 1e-12
        if not np.any(non_zero):
            continue
        active_indices = np.flatnonzero(active_mask)[non_zero]
        sub_active = sub[:, non_zero]
        if sub_active.shape[1] == 1:
            out[t, active_indices[0]] = float(max_gross)
            continue
        cov = np.cov(sub_active, rowvar=False, ddof=1)
        w_active = _solve_erc_single(cov, max_iter=max_iter, tol=tol) * float(max_gross)
        out[t, active_indices] = w_active

    return pd.DataFrame(out, index=clean.index, columns=clean.columns)
