---
version: 1.0.0
---

# AutoQuant

AutoQuant (`v1.0.0`) is an agent-native quantitative research workbench. It pairs a thin, composable Python toolkit (`import autoquant as aq`) and `aq` CLI with an immutable file-backed Run ledger and a zero-CDN Quant Studio—operable standalone or as OpenAlice's specialist Quant desk.

```text
Workspace Root
├── autoquant-workspace.json  # Workspace configuration & project discovery
├── autoquant/                # Causal panel, splits, factor, backtest, CLI & Studio
├── projects/<project-id>/    # Self-contained research Projects
│   ├── project.json          # Splits (train/val/holdout) & holdout_audit log
│   ├── research.md           # Hypothesis, constraints, assumptions & findings
│   ├── data/                 # Normalized OHLCV snapshots + manifest.json
│   └── runs/<run-id>/        # Immutable run.json, series/* & custom artifacts/*
├── docs/                     # Practical API, CLI, schema & Studio guides
├── scripts/                  # Doc link & Workspace skill utilities
└── tests/                    # Fast deterministic unit & Studio tests
```

## Quick Start

Requires Python 3.11 and [uv](https://docs.astral.sh/uv/):

```bash
uv sync --frozen
uv run aq version
uv run aq status .

# Create a Project with explicit anti-overfitting splits
uv run aq project create . us-momentum \
  --name "US Momentum" \
  --train-end 2022-12-31 \
  --val-end 2024-06-30 \
  --holdout-end 2025-12-31

# Launch Quant Studio locally (http://127.0.0.1:8765)
uv run aq studio serve .
```

## Minimal Python Workflow

```python
import autoquant as aq

project = "projects/us-momentum"
aq.ingest_ohlcv(project, "./bars.csv", dataset_id="etfs", source="local")

# Holdout dates (> val_end) are physically excluded during development
panel = aq.load_panel(project, dataset_id="etfs", split="val")
close = panel.pivot(index="timestamp", columns="asset", values="close")
signal = close.pct_change(20)

# Causal factor IC / quantiles & cost-aware portfolio backtest
aq.evaluate_factor(signal, panel, project=project, name="mom-20d", split="val")
weights = signal.gt(0).astype(float).div(signal.gt(0).sum(axis=1).replace(0, 1), axis=0)
aq.backtest_weights(weights, panel, cost_bps=5.0, project=project, name="mom-long", split="val")
```

When a candidate is finalized on Validation, run `aq.evaluate_holdout(project, evaluator_fn, ...)` to score `(val_end, holdout_end]` once and log the unlock in `project.json`.

## Core Capabilities

- **Causal Panel & Calendar Alignment**: Long-form `pandas` OHLCV panels validated for price/volume integrity and `exchange_calendars` sessions, completed-bar resampling, and explicit `causal_asof_fill` (never silent forward-filling).
- **Anti-Overfitting Split Guardrails**: `load_panel(split="val")` hides Holdout bars during iteration; `evaluate_holdout` audits every Holdout unlock with code and Git provenance.
- **Factor & Portfolio Engines**: Cross-sectional Pearson/Rank IC, horizon decay, quantile curves, causal `t -> t+1` weight execution, turnover/slippage costs, volatility targeting, and `inverse_vol_weights` / `equal_risk_contribution_weights` helpers.
- **Hackable Quant Studio**: Multi-run equity/drawdown comparison, factor tear-sheets, Holdout audit badge, and automatic rendering of custom `artifacts/*.json` (`line`, `bar`, `table`), `.svg`, and `.md` files.
- **Market Data Bridges**: Native `alice market bars` integration (`aq data fetch` / `fetch_alice_bars`) plus 14 bundled regional OHLCV fetcher skills (`aq-python`).

## Documentation

| Topic | Guide |
| --- | --- |
| Agent operating rules & research discipline | [[AGENTS]] |
| End-to-end Python API & `aq` CLI workflow | [[docs/GUIDE]] |
| Ledger schemas, custom Run artifacts & Studio | [[docs/STUDIO_AND_ARTIFACTS]] |

## Verification

```bash
python3 scripts/check_doc_links.py
uv run python -m unittest discover -s tests -v
```

## License

MIT.
