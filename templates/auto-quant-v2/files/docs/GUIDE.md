# AutoQuant Research Guide

AutoQuant (`v1.0.0`) is a thin, composable Python toolkit and `aq` CLI for agent-native quantitative research. Coding Agents write ordinary Python/pandas research code (`import autoquant as aq`), enforce strict causal alignment and Train/Validation/Holdout splits, and record immutable evidence into `projects/<project_id>/runs/` for human and Agent review in Studio.

For exact JSON/CSV schemas, custom Run artifacts, and Studio customization, see [[docs/STUDIO_AND_ARTIFACTS]]. For agent operating rules, see [[AGENTS]].

## 1. Desk Setup & Orientation

Prepare the pinned Python 3.11 environment once per Workspace:

```bash
uv sync --frozen
uv run aq version --json
uv run aq status . --json
```

`aq status` (aliased as `aq orient`) summarizes the Workspace root (`autoquant-workspace.json`), active Projects under `projects/`, ingested datasets, split configuration, Holdout audit count, and recent Runs. Every `aq` subcommand supports `--json`.

For a new standalone directory outside an OpenAlice template checkout, initialize a desk with:

```bash
uv run aq workspace init /path/to/desk --name "Quant Desk" --json
```

Pass `--adopt-existing` if caller files already exist in `/path/to/desk` and must be preserved.

## 2. Creating a Project & Configuring Splits

Each independent body of research lives under `projects/<project_id>/` (`project_id` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`):

```text
projects/<project_id>/
├── project.json      # Project metadata, Train/Val/Holdout splits, holdout_audit log
├── research.md       # Living English research brief, assumptions, and conclusions
├── data/             # Normalized OHLCV snapshots + manifest.json (git-ignored by default)
└── runs/             # Immutable run-<timestamp>-<8hex>/ directories
```

Create a Project and declare temporal splits up front so Holdout bars remain untouched during exploration:

```bash
uv run aq project create . us-momentum \
  --name "US Cross-Sectional Momentum" \
  --description "20-day vs 60-day momentum across liquid US sector ETFs" \
  --train-end 2022-12-31 \
  --val-end 2024-06-30 \
  --holdout-end 2025-12-31 \
  --json
```

Manage Projects from the CLI or Python:

```bash
uv run aq project list . --json
uv run aq project show . --project us-momentum --json
uv run aq project set-splits . --project us-momentum \
  --train-end 2022-12-31 --val-end 2024-06-30 --holdout-end 2025-12-31 --json
```

Update `projects/<project_id>/research.md` before running experiments so any human reviewer or resuming Agent can read the decision context, universe, horizon, transaction cost assumptions, constraints, and open questions.

## 3. Data Acquisition & Ingestion

AutoQuant separates provider network fetching from Project data normalization:

1. **OpenAlice native market data or caller files first**:
   - Inside an OpenAlice Workspace when `alice` is on `PATH`, discover instruments with `alice market search-bars` and pull bars via `uv run aq data fetch` or `aq.fetch_alice_bars(...)` (or use `traderhub` / caller-supplied CSV or Parquet files when they cover the required symbols, interval, and date span).
2. **Bundled venue fetcher skills (`$acquire-market-ohlcv` + `$fetch-*-ohlcv`)**:
   - When a task needs direct venue/regional coverage (Mainland China A-shares `XSHG`/`XSHE`/`XBSE`, Taiwan `TWSE`/FinMind, South Korea `XKRX` Naver/Daum, Japan `XTKS` Nikkei, Vietnam `HOSE`/`HNX`/`UPCoM` VNDIRECT, Euronext Paris `XPAR`, Binance Spot `1h`, or Nasdaq/Yahoo split/dividend-adjusted history), run the corresponding bundled skill script via `aq-python`.
3. **Inspect honestly, then ingest into `<project>/data/`**:
   - Check date coverage, missing bars or trading halts, `high >= low`, volume units, and raw vs split/dividend adjustment semantics. Never silently forward-fill missing observations across market closures.

### CLI Ingestion & Alice Market Bridge

```bash
# Fetch directly through the OpenAlice market bridge when `alice` is on PATH
uv run aq data fetch . --project us-momentum \
  --bar-id NASDAQ:QQQ --bar-id AMEX:SPY --bar-id AMEX:IWM \
  --interval 1d --count 1500 --dataset-id us-etfs --json

# Or ingest a local CSV, Parquet file, or directory of per-symbol CSVs
uv run aq data ingest . ./raw_bars/ --project us-momentum \
  --dataset-id us-etfs --source yahoo-split-adjusted --json

# Inspect datasets recorded in projects/us-momentum/data/manifest.json
uv run aq data list . --project us-momentum --json
```

### Python Ingestion

```python
import autoquant as aq

# Option A: Fetch from OpenAlice CLI bridge into a normalized long DataFrame
bars_df = aq.fetch_alice_bars(["NASDAQ:QQQ", "AMEX:SPY", "AMEX:IWM"], interval="1d", count=1500)
aq.ingest_ohlcv("projects/us-momentum", bars_df, dataset_id="us-etfs", source="alice-market")

# Option B: Ingest a multi-asset CSV/Parquet or directory of <SYMBOL>.csv files
aq.ingest_ohlcv("projects/us-momentum", "./downloads/us-etfs", dataset_id="us-etfs", source="yahoo")
```

`ingest_ohlcv` validates OHLCV invariants, writes a clean normalized snapshot under `<project>/data/<dataset_id>.csv` (or `.parquet` when `pyarrow` is installed), and records its SHA-256, symbol list, interval, date range, row count, and provenance in `<project>/data/manifest.json`.

## 4. Causal Panel Rules & Multi-Market Alignment

AutoQuant's canonical market representation is a tidy long-form `pandas.DataFrame` sorted by `(timestamp, asset)` with columns:

```text
timestamp, asset, open, high, low, close, volume
```

Core panel invariants enforced by `autoquant`:

- **Integrity checks**: Rejects duplicate `(timestamp, asset)` keys, negative prices or negative volumes, `high < low`, `open`/`close` outside `[low, high]`, and non-monotonic series.
- **Exchange calendar verification**: When an `exchange_calendars` calendar code (such as `"XNYS"`, `"XTKS"`, `"XSHG"`) is supplied, session dates/timestamps are checked against official exchange schedules.
- **Completed-bar resampling (`aggregate_completed_bars`)**: Higher-timeframe features are aggregated strictly from completed base bars and stamped at bar close so partial intraday bars never leak future highs, lows, or closes.
- **No silent forward-fill across ragged panels**: Cross-market or halted instruments keep missing observations absent by default. Only call `aq.causal_asof_fill(panel, max_staleness=...)` when a feature explicitly requires bounded causal carry-forward of prior completed closes.

## 5. Anti-Overfitting Guardrails: `load_panel` vs `evaluate_holdout`

Overfitting through repeated test-set peeking is the primary failure mode of automated quant loops. AutoQuant enforces physical split isolation by default:

- **`aq.load_panel(project, dataset_id=..., split="val")`** defaults to `split="val"`:
  - `split="train"` returns bars with `timestamp <= train_end`.
  - `split="val"` returns bars with `timestamp <= val_end`. Holdout bars `(val_end, holdout_end]` are **physically excluded** from the returned DataFrame so feature engineering, IC screening, model fitting, and hyperparameter selection cannot accidentally inspect Holdout dates.
  - When a Project has no `splits` configured, `load_panel` returns the full dataset labeled `"in_sample"`.
- **`aq.evaluate_holdout(project, evaluator_fn, ...)`** is the explicit, audited gate for out-of-sample verification:
  - Supplies the panel through `holdout_end` (allowing causal rolling warmup prior to `val_end`) while scoring Holdout metrics strictly on timestamps `> val_end` (up to `holdout_end`).
  - Increments `holdout_audit.unlock_count` in `project.json` and appends an immutable audit record (`unlocked_at`, `run_id`, `code_sha256`, `git_commit`, `git_dirty`).
  - Writes an immutable Run with `split="holdout"`. Studio surfaces `Holdout Untouched` (`unlock_count == 0`) vs `Holdout Unlocked N×` prominently in the top bar.

**Rule of thumb**: Iterate freely on `"train"` and select finalists on `"val"`. Unlock Holdout once at the end to verify your chosen specification—never tune parameters after seeing Holdout results.

## 6. Factor Evaluation (`evaluate_factor`)

`aq.evaluate_factor` scores any cross-sectional or time-series signal strictly causally (signal at bar `t` close predicts forward returns over `t -> t + h`):

```python
import autoquant as aq

project = "projects/us-momentum"
panel = aq.load_panel(project, dataset_id="us-etfs", split="val")

# Compute a strictly causal 20-bar return signal per asset
close_wide = panel.pivot(index="timestamp", columns="asset", values="close")
mom_20 = close_wide.pct_change(20)

factor_run = aq.evaluate_factor(
    mom_20,
    panel,
    horizons=(1, 5, 10, 20),
    quantiles=5,
    project=project,
    name="mom-20d-val",
    split="val",
    hypothesis="20-day close-to-close momentum ranks 5-to-20 day cross-sectional ETF returns",
    parameters={"lookback": 20, "quantiles": 5},
    record=True,
)
print(factor_run["id"], factor_run["metrics"])
```

`evaluate_factor` computes and records:

- Per-timestamp cross-sectional Pearson IC and Spearman Rank IC (`series/ic.csv`)
- IC mean, IC std, t-statistic, Information Ratio (`ic_ir`), and Rank IC mean
- Quantile bucket mean returns, bucket Sharpe ratios, cumulative bucket curves, and multi-horizon IC decay (`series/quantiles.json`)
- Factor rank turnover and a long-short top-minus-bottom equity curve (`series/equity.csv`)

## 7. Portfolio Backtesting & Risk Sizing (`backtest_weights`)

`aq.backtest_weights` simulates target portfolio weights with strict causal execution: **weights decided at bar `t` close earn the `t -> t+1` return** (never `t-1 -> t`), after deducting linear turnover costs and slippage:

```python
import autoquant as aq

project = "projects/us-momentum"
panel = aq.load_panel(project, dataset_id="us-etfs", split="val")
close_wide = panel.pivot(index="timestamp", columns="asset", values="close")
returns_wide = close_wide.pct_change()

# Rank cross-sectionally and scale by causal inverse-volatility weights
signal = close_wide.pct_change(20)
inv_vol = aq.inverse_vol_weights(returns_wide, lookback=20)
raw_weights = signal.gt(0.0).astype(float) * inv_vol
weights = raw_weights.div(raw_weights.abs().sum(axis=1).replace(0.0, 1.0), axis=0).fillna(0.0)

bt_run = aq.backtest_weights(
    weights,
    panel,
    cost_bps=5.0,
    slippage_bps=2.0,
    max_gross=1.0,
    max_weight=0.40,
    vol_target=0.12,
    vol_lookback=20,
    benchmark="AMEX:SPY",
    periods_per_year=252,
    project=project,
    name="long-mom-invvol-val",
    split="val",
    hypothesis="Positive 20d momentum sleeves weighted by inverse vol beat SPY net of 7 bps total cost",
    parameters={"lookback": 20, "vol_target": 0.12, "cost_bps": 5.0, "slippage_bps": 2.0},
    record=True,
)
print(bt_run["id"], bt_run["metrics"])
```

Built-in sizing and risk capabilities:

- Per-asset weight cap (`max_weight`) and gross leverage cap (`max_gross`)
- Causal realized-volatility targeting (`vol_target`, scale-down only using trailing `vol_lookback` bars)
- Allocation helpers: `aq.inverse_vol_weights(...)` and `aq.equal_risk_contribution_weights(returns_df, ...)`
- Full metrics suite: `sharpe`, `sortino`, `calmar`, `max_drawdown`, `annual_return`, `annual_volatility`, `turnover`, `total_cost`, plus benchmark `benchmark_return`, `active_return`, `information_ratio`, and `beta` when `benchmark` is supplied.

## 8. Final Holdout Evaluation & Run Comparison

Once your candidate logic and parameters are frozen on `"val"`, run the one-shot Holdout check:

```python
def run_frozen_strategy(holdout_panel, eval_start):
    close_wide = holdout_panel.pivot(index="timestamp", columns="asset", values="close")
    returns_wide = close_wide.pct_change()
    signal = close_wide.pct_change(20)
    inv_vol = aq.inverse_vol_weights(returns_wide, lookback=20)
    raw = signal.gt(0.0).astype(float) * inv_vol
    weights = raw.div(raw.abs().sum(axis=1).replace(0.0, 1.0), axis=0).fillna(0.0)
    return aq.backtest_weights(
        weights,
        holdout_panel,
        cost_bps=5.0,
        slippage_bps=2.0,
        max_gross=1.0,
        max_weight=0.40,
        vol_target=0.12,
        benchmark="AMEX:SPY",
        eval_start=eval_start,
        record=False,
    )

holdout_run = aq.evaluate_holdout(
    "projects/us-momentum",
    run_frozen_strategy,
    dataset_id="us-etfs",
    code_paths=["projects/us-momentum/strategy.py"],
    name="long-mom-invvol-holdout",
    hypothesis="Out-of-sample Holdout verification of frozen 20d inverse-vol momentum strategy",
    parameters={"lookback": 20, "vol_target": 0.12, "cost_bps": 5.0, "slippage_bps": 2.0},
)
```

Inspect and compare Runs across splits from the CLI, or launch Studio:

```bash
uv run aq run list . --project us-momentum --json
uv run aq run show . <run_id> --project us-momentum --json
uv run aq run compare . --project us-momentum --json
uv run aq studio serve .
```

For custom ML pipelines, regime studies, event studies, or bespoke visualizations, use `aq.record_run(...)` with custom `artifacts` as documented in [[docs/STUDIO_AND_ARTIFACTS]].
