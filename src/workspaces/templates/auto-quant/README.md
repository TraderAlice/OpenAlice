---
version: 1.0.0
---

# Auto-Quant

An autoresearch coworker that clones the public [Auto-Quant](https://github.com/TraderAlice/Auto-Quant) repo and iterates on quantitative trading strategies inside its own branch.

## What this workspace does

Spawns a workspace as a local Auto-Quant clone on its own `autoresearch/<tag>` branch. The agent runs the existing prepare / backtest / optimize pipeline, edits strategies under `user_data/strategies/`, logs results to `results.tsv`, and commits as it goes — so every iteration leaves an auditable git trail.

## When to spawn this

- You want to test a new strategy idea (mean-reversion, momentum, factor combinations) and let the agent iterate on parameters.
- You're exploring how to combine multiple indicators against Auto-Quant's existing data layout.
- You want a backtest loop that runs alongside other workspaces without sharing data directories.

Each workspace gets its own `user_data/data/`. First run, the agent runs `uv run prepare.py` to fetch OHLCV from Binance. This isolation is deliberate: different runs may want different timeframes or symbols, and a shared cache would silently mix incompatible files across workspace generations.

## What you'll see in Inbox

- Backtest result summaries (Sharpe, drawdown, key periods) as the agent finishes runs.
- Strategy diff notes when the agent commits a meaningful iteration.

## Parameters

- **Tag** — becomes the branch name (`autoresearch/<tag>`).

All available CLI runtimes are enabled (Claude, Codex, shell). The `+` new-session button defaults to Claude.

Power-user override: set `AQ_TEMPLATE_DIR` in the launcher env to point at a pre-existing Auto-Quant clone (e.g. one you've already populated with data).
