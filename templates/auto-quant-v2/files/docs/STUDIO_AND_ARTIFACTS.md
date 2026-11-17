# Studio, Ledger Schemas & Custom Artifacts

AutoQuant's Quant Studio reads plain JSON, CSV, SVG, and Markdown files directly from the Workspace filesystem with zero database state and zero external CDN dependencies. Any Run recorded via `evaluate_factor`, `backtest_weights`, `evaluate_holdout`, or `record_run` appears immediately in Studio.

For end-to-end Python API and `aq` CLI workflows, see [[docs/GUIDE]].

## 1. On-Disk Schemas

### Workspace Manifest (`autoquant-workspace.json`)

Located at the Workspace root:

```json
{
  "schema_version": 1,
  "name": "AutoQuant Research Desk",
  "projects_directory": "projects",
  "default_project": null
}
```

An optional untracked `autoquant-workspace.local.json` may override `projects_directory` (relative or absolute path) or `default_project` for local developer workflows. Symlink escapes outside the configured root are rejected.

### Project Manifest (`<projects_dir>/<project_id>/project.json`)

`project_id` must be kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). Creating a Project initializes `project.json`, `research.md`, `data/`, and `runs/`:

```json
{
  "schema_version": 1,
  "id": "us-momentum",
  "name": "US Momentum",
  "description": "20-day cross-sectional momentum across liquid US ETFs",
  "created_at": "2026-11-17T00:00:00Z",
  "splits": {
    "train_end": "2022-12-31",
    "val_end": "2024-06-30",
    "holdout_end": "2025-12-31"
  },
  "holdout_audit": {
    "unlock_count": 1,
    "unlocks": [
      {
        "unlocked_at": "2026-11-17T06:15:00Z",
        "run_id": "run-20261117T061500000000Z-a1b2c3d4",
        "code_sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        "git_commit": "7298f53f",
        "git_dirty": false
      }
    ]
  }
}
```

### Dataset Manifest (`<projects_dir>/<project_id>/data/manifest.json`)

Updated automatically by `aq data ingest`, `aq data fetch`, or `aq.ingest_ohlcv(...)`:

```json
{
  "schema_version": 1,
  "datasets": {
    "us-etfs": {
      "id": "us-etfs",
      "path": "data/us-etfs.csv",
      "format": "csv",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "symbols": ["AMEX:IWM", "AMEX:SPY", "NASDAQ:QQQ"],
      "interval": "1d",
      "start": "2019-01-02",
      "end": "2025-12-31",
      "rows": 5280,
      "source": "alice-market",
      "ingested_at": "2026-11-17T06:05:00Z"
    }
  }
}
```

### Immutable Run Directory (`<projects_dir>/<project_id>/runs/<run_id>/`)

Each Run uses a collision-free UTC identifier `run-<YYYYMMDDTHHMMSSffffffZ>-<8hex>` and is never mutated after creation:

```text
runs/run-20261117T061000000000Z-3f9a12c8/
├── run.json
├── series/
│   ├── equity.csv        # Portfolio or long-short factor equity curve
│   ├── ic.csv            # Per-timestamp IC & Rank IC (factor runs)
│   └── quantiles.json    # Quantile returns, IC decay & cumulative curves (factor runs)
└── artifacts/            # Optional custom JSON charts/tables, SVGs, Markdown, CSVs
    ├── regime_sharpe.json
    └── attribution.md
```

`run.json` schema:

```json
{
  "schema_version": 1,
  "id": "run-20261117T061000000000Z-3f9a12c8",
  "project_id": "us-momentum",
  "kind": "backtest",
  "name": "long-mom-invvol-val",
  "split": "val",
  "created_at": "2026-11-17T06:10:00Z",
  "hypothesis": "Positive 20d momentum sleeves weighted by inverse vol beat SPY net of 7 bps cost",
  "parameters": {
    "lookback": 20,
    "vol_target": 0.12,
    "cost_bps": 5.0,
    "slippage_bps": 2.0
  },
  "dataset": {
    "id": "us-etfs",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  "provenance": {
    "harness_version": "1.0.0",
    "code_sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
    "git_commit": "7298f53f",
    "git_dirty": true
  },
  "metrics": {
    "sharpe": 1.34,
    "sortino": 1.88,
    "annual_return": 0.142,
    "annual_volatility": 0.106,
    "max_drawdown": -0.089,
    "calmar": 1.59,
    "turnover": 0.18,
    "total_cost": 0.021,
    "benchmark_return": 0.118,
    "active_return": 0.024
  },
  "series_files": {
    "equity": "series/equity.csv"
  },
  "artifacts": [
    {
      "name": "regime_sharpe",
      "path": "artifacts/regime_sharpe.json",
      "kind": "chart"
    },
    {
      "name": "attribution",
      "path": "artifacts/attribution.md",
      "kind": "markdown"
    }
  ],
  "notes": "Evaluated on validation window through 2024-06-30."
}
```

### Standard `series/` Formats

- **`series/equity.csv`**: CSV with header `timestamp,equity,returns,drawdown,turnover,gross_exposure,net_exposure` (plus optional `benchmark_equity` when a benchmark is configured).
- **`series/ic.csv`**: CSV with header `timestamp,ic,rank_ic`.
- **`series/quantiles.json`**:
  ```json
  {
    "quantiles": [
      { "bucket": 1, "mean_return": -0.0004, "sharpe": -0.45 },
      { "bucket": 5, "mean_return": 0.0009, "sharpe": 1.12 }
    ],
    "decay": [
      { "horizon": 1, "ic_mean": 0.031, "rank_ic_mean": 0.036 },
      { "horizon": 5, "ic_mean": 0.044, "rank_ic_mean": 0.049 }
    ],
    "cumulative": {
      "timestamps": ["2023-01-03", "2023-01-04"],
      "buckets": {
        "1": [1.0, 0.998],
        "5": [1.0, 1.003]
      }
    }
  }
  ```

## 2. Running Quant Studio (`aq studio serve`)

Studio runs either standalone in a local browser or embedded inside OpenAlice's managed Quant surface:

```bash
# Standalone local server (defaults to http://127.0.0.1:8765)
uv run aq studio serve .

# Machine-readable JSON snapshot without starting an HTTP server
uv run aq studio snapshot . --project us-momentum --json
```

### OpenAlice Managed Surface Protocol (`harness.json`)

When OpenAlice launches Studio (`HARNESS_CAPABILITY=studio`), `aq studio serve . --no-open`:

- Binds strictly to the loopback `HARNESS_HOST` (`127.0.0.1` or `localhost`) and exact port declared in `HARNESS_PORTS='{"http":<port>}'` (failing fast if occupied rather than auto-incrementing);
- Serves `GET /api/v1/health` (`200 OK` readiness probe), `GET /api/v1/snapshot` (Workspace/Project overview, `research.md`, datasets, splits, `holdout_audit`, and Runs sorted newest-first), and `GET /api/v1/runs/<project_id>/<run_id>` (or `/api/v1/run?project=<id>&run=<id>`) for detailed Run series and custom artifacts;
- Emits strict `Content-Security-Policy` headers (`default-src 'self'` with `frame-ancestors` restricted to OpenAlice loopback origins in managed mode and `'none'` in standalone mode).

## 3. Dropping Custom `artifacts/*` into Runs

Studio automatically renders custom artifacts attached to any Run under `runs/<run_id>/artifacts/*` without requiring frontend edits. Pass `artifacts` when calling `aq.record_run(...)` (or attach files to custom/factor/backtest runs):

### Structured JSON Charts & Tables (`artifacts/*.json`)

Studio recognizes three declarative JSON artifact shapes:

1. **Line chart (`"type": "line"`)**:
   ```json
   {
     "title": "Rolling 63-Day Information Ratio",
     "type": "line",
     "x": ["2023-06-01", "2023-07-01", "2023-08-01"],
     "series": [
       { "name": "Candidate", "values": [0.85, 1.12, 1.29] },
       { "name": "Equal-Weight Baseline", "values": [0.40, 0.55, 0.48] }
     ]
   }
   ```
2. **Bar chart (`"type": "bar"`)**:
   ```json
   {
     "title": "Sharpe by Volatility Regime",
     "type": "bar",
     "x": ["Low Vol", "Mid Vol", "High Vol"],
     "series": [
       { "name": "Sharpe", "values": [1.62, 1.18, 0.74] }
     ]
   }
   ```
3. **Table (`"type": "table"`)**:
   ```json
   {
     "title": "Per-Asset Attribution",
     "type": "table",
     "columns": ["Asset", "Avg Weight", "Return Contrib", "Turnover"],
     "rows": [
       ["NASDAQ:QQQ", "0.38", "+6.4%", "0.07"],
       ["AMEX:SPY", "0.35", "+4.9%", "0.05"],
       ["AMEX:IWM", "0.27", "+2.9%", "0.06"]
     ]
   }
   ```

### SVG, Markdown, and CSV Artifacts

- **`.svg`**: Self-contained vector figures (for example from `matplotlib` `savefig(..., format="svg")`) are sanitized and rendered inline as chart cards.
- **`.md`**: Rendered as formatted research notes alongside the Run metrics.
- **`.csv`**: Rendered as clean tabular cards.

### Recording a Custom Run from Python

```python
import autoquant as aq

run = aq.record_run(
    "projects/us-momentum",
    kind="custom",
    name="regime-event-study-val",
    split="val",
    hypothesis="Momentum drawdowns concentrate around VIX > 25 spike weeks",
    parameters={"vix_threshold": 25, "window_days": 10},
    metrics={"post_spike_5d_return": -0.014, "hit_rate": 0.36, "events": 19.0},
    artifacts={
        "regime_sharpe.json": {
            "title": "Sharpe by Volatility Regime",
            "type": "bar",
            "x": ["Calm", "Elevated", "Stress"],
            "series": [{"name": "Sharpe", "values": [1.58, 1.11, 0.32]}],
        },
        "event_notes.md": "## Key Finding\nReducing gross exposure above 20% realized vol halves stress drawdown.\n",
    },
)
```

All artifact paths inside a Run must remain relative descendants of `artifacts/` with no symlinks or `..` traversal.

## 4. Customizing Studio UI Inside a Workspace

Every AutoQuant Workspace owns a local copy of `autoquant/studio.py` and `autoquant/studio_assets/{index.html,studio.css,studio.js}` in its Git repository. When a research project genuinely needs a bespoke interactive panel beyond custom `artifacts/*`:

1. Keep **zero external CDN scripts, fonts, or stylesheets**—Studio enforces `Content-Security-Policy: default-src 'self'`, so all rendering must use local JS/CSS and inline SVG.
2. Preserve the managed Studio HTTP routes (`/api/v1/health`, `/api/v1/snapshot`, `/api/v1/runs/<project_id>/<run_id>`) and `HARNESS_*` launch behavior in `autoquant/studio.py`.
3. Verify syntax and HTTP/security invariants before committing:

```bash
node --check autoquant/studio_assets/studio.js
uv run python -m unittest discover -s tests -p 'test_studio.py' -v
```

See [[README]] for a high-level overview of the Workspace structure.
