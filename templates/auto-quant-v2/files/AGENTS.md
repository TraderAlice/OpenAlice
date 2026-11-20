# AutoQuant Agent Guide

AutoQuant (`v1.0.0`) is an agent-native quantitative research workbench. You write ordinary Python/pandas code (`import autoquant as aq`) and use the `aq` CLI to frame hypotheses, ingest verified market data, test causal factors and portfolios across strict Train/Validation/Holdout splits, record immutable Runs under `projects/<id>/runs/`, and surface evidence in Quant Studio.

AutoQuant works identically standalone or as a specialist Quant Workspace inside OpenAlice. Live accounts, broker credentials, order approvals, and trading writes never live here—they belong exclusively to OpenAlice / UTA (`tradingAuthority: none`).

## Quick Orientation

Use Python 3.11 and `uv` for all research scripts and CLI invocations:

```bash
uv sync --frozen
uv run aq status . --json
uv run aq project list . --json
```

- **Bundled Skill Python bridge**: Always run bundled skill scripts under `.agents/skills/` or `autoquant/workspace_skills/` with `aq-python` (for example `uv run aq-python <script.py> ...` or `.venv/bin/aq-python`), never ambient system `python3`.
- **Workspace overrides**: Check `aq status . --json` before assuming active paths—an untracked `autoquant-workspace.local.json` may redirect `projects_directory`.
- **Working language**: Keep `research.md`, code comments, Run hypotheses, and artifact titles in clear English (preserving exact tickers, venue codes, and caller quotes) while replying to the user or delegating Agent in their preferred language.

## Core Research Workflow

### 1. Frame the Question & Clarify Ambiguity (`research.md`)

- **Reuse vs create**: Continue an existing Project under `projects/<project_id>/` when the assignment extends the same research question; create a new Project with `uv run aq project create . <project-id> --name "..." --train-end YYYY-MM-DD --val-end YYYY-MM-DD --holdout-end YYYY-MM-DD --json` when starting a distinct study.
- **Separate caller intent from researcher method**: You choose features, diagnostics, statistical estimators, and code structure. Never invent caller-owned constraints—the decision being supported, universe, direction (long-only vs long-short), horizon, benchmark, cost/leverage limits, or risk tolerance. If a missing caller fact would materially change the conclusion, ask first.
- **Keep `research.md` current**: Document the question, universe, data provenance, split dates, transaction cost assumptions, key Run IDs, and conclusions so any human or Agent can resume from disk alone.

### 2. Acquire & Ingest Market Data Pragmatically

Follow this priority order whenever market bars are needed:

1. **OpenAlice native market data or caller-provided files first**:
   - When `alice` CLI is available on `PATH`, search instruments with `alice market search-bars` and pull bars via `alice market bars` / `uv run aq data fetch` / `aq.fetch_alice_bars(...)` (or `traderhub`), or ingest caller-supplied CSV/Parquet files directly when they cover the required symbols, interval, and history.
2. **Bundled venue fetcher skills (`$acquire-market-ohlcv` & `$fetch-*-ohlcv`)**:
   - Use the bundled venue fetchers (via `aq-python`) whenever a specific venue (CN A-shares `XSHG`/`XSHE`/`XBSE`, Taiwan `TWSE`/FinMind, South Korea `XKRX`, Japan `XTKS`, Vietnam `HOSE`/`HNX`/`UPCoM`, Euronext `XPAR`, Binance Spot `1h`, or deeper Nasdaq/Yahoo split/dividend-adjusted history) requires direct retrieval.
3. **Honest quality inspection & direct ingestion**:
   - There is **no mandatory two-source scraping gate** and **no staging manifest bureaucracy**. Pick the best-fitting source, inspect the data honestly (date span, missing sessions/suspensions, `high >= low`, volume units, split/dividend adjustment semantics, staleness), and ingest directly into `<project>/data/` via `uv run aq data ingest` or `aq.ingest_ohlcv(...)`.
   - Cross-check a second source only when corporate-action adjustments, price jumps, or gaps look suspicious.
   - Do not commit large market datasets to Git unless the caller explicitly requests a small distributable fixture.

### 3. Enforce Strict Causality & Anti-Overfitting Guardrails

- **No lookahead**: Signals or weights computed at bar `t` close may use only observations completed at or before `t`, and portfolio weights decided at `t` close earn the `t -> t+1` return (`aq.backtest_weights` enforces this automatically). Never leak full-sample z-scores, future highs/lows from incomplete higher-timeframe bars, or unstated survivorship-biased constituent lists.
- **No silent forward-filling**: Keep trading halts and cross-market holiday gaps explicit; use `aq.causal_asof_fill(panel, max_staleness=...)` only when bounded carry-forward of prior completed bars is intentional.
- **Physical Holdout isolation**:
  - Develop features, screen factors, and select model/portfolio parameters using `aq.load_panel(project, split="train")` and `aq.load_panel(project, split="val")`. `split="val"` is the default and physically excludes Holdout bars `(val_end, holdout_end]`.
  - Run `aq.evaluate_holdout(project, evaluator_fn, ...)` **only after** freezing your chosen specification on Validation. Never re-tune parameters after unlocking Holdout, and always report `holdout_audit.unlock_count` honestly.

### 4. Record Immutable Runs & Rich Artifacts

- Every meaningful experiment should record an immutable Run under `projects/<project_id>/runs/<run_id>/` via `aq.evaluate_factor(...)`, `aq.backtest_weights(...)`, `aq.evaluate_holdout(...)`, or `aq.record_run(...)` (for custom ML, statistical, risk, or event studies).
- Never delete or overwrite negative or failed Runs—preserving what failed and why prevents hidden selection bias.
- Attach custom `artifacts/*.json` (`type: "line" | "bar" | "table"`), `.svg`, or `.md` files to Runs whenever bespoke charts or attribution tables sharpen the answer; Studio renders them automatically without frontend code changes.

### 5. Evidence-Bound Handoff

When reporting back to a user or delegating Agent (such as OpenAlice Chat):

- State the plain-language answer—positive, negative, or inconclusive—up front;
- Name the `project_id`, absolute Project directory, primary deliverable path (`research.md` or Run directory), and relevant immutable `run_id`s;
- Separate **Validation** metrics from **Holdout** metrics and state `holdout_audit.unlock_count`;
- Disclose transaction cost assumptions, data limitations, and `tradingAuthority: none`.

## Modifying the Workbench Locally

You own the local Git repository of this desk. When a research task benefits from reusable Python helpers or custom Studio panels:

- Read [[docs/GUIDE]] for the Python API and CLI surface, and [[docs/STUDIO_AND_ARTIFACTS]] for ledger schemas, custom artifacts, and Studio CSP rules (`default-src 'self'`, zero external CDNs).
- Verify workbench changes before committing:
  ```bash
  python3 scripts/check_doc_links.py
  uv run python -m unittest discover -s tests -v
  ```
- See [[README]] for Workspace layout and quickstart commands.
