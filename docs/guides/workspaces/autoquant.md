---
title: "AutoQuant"
description: "Use OpenAlice's first-class AutoQuant activity for Agent-native quantitative research in one pinned, durable Workspace."
---
# AutoQuant

**AutoQuant** (`v1.0.0`) is OpenAlice's Agent-native quantitative research
activity. It uses one durable [Workspace](/docs/workspaces/workspaces) backed by
OpenAlice's embedded AutoQuant workbench (`templates/auto-quant-v2`), pairing a
thin, composable Python toolkit (`import autoquant as aq`) and `aq` CLI with an
immutable `runs/` ledger and a zero-CDN Quant Studio, while OpenAlice supplies
the native Agent Session, collaboration, Inbox, market-data tools, and optional
UTA access around the desk.

OpenAlice does not embed a separate backtest state machine inside the host. The
Coding Agent works directly inside the AutoQuant repository, writes ordinary
Python/pandas research code, and follows the desk's own `AGENTS.md`.

<ProductDemo
  src="/pic/product-autoquant-demo-260824.mp4"
  poster="/pic/product-autoquant-demo-260824.jpg"
  title="Open an AutoQuant research desk in Studio"
>
  Move from the native Quant activity into the Workspace-owned Studio, where
  Projects, Train/Val/Holdout splits, Holdout audit status, Run leaderboards,
  and custom research artifacts remain visible together.
</ProductDemo>

## Initialize the desk

Open **Quant** from the main activity navigation.

Quant uses the same responsive navigation shell as **Ask Alice**: focused,
recent, and tree views behave consistently, while AutoQuant keeps its own copy,
readiness gate, and display preference. After the default Workspace exists,
**Studio** appears beside **New research** and opens AutoQuant's frontend through
OpenAlice's managed Surface route.

- On a fresh installation with no AutoQuant Workspace, initialize one durable
  desk before sending research.
- If compatible desks already exist, select the one that should become the
  default; OpenAlice does not guess.
- Later assignments create or continue Sessions inside that selected desk
  rather than creating another Workspace.
- The low-frequency Workspace control lets you change the default desk
  explicitly.
- Browsing an older Session does not silently make its Workspace the durable
  AutoQuant default. Only explicit Workspace selection or creation changes the
  default, and OpenAlice saves that choice before navigating.

New desks are materialized directly from OpenAlice's embedded AutoQuant template
(`templates/auto-quant-v2`, currently `v1.0.0`) without requiring an external Git
clone or network fetch.

## Research workflow (`aq` CLI & Python `autoquant`)

Inside the desk, each research effort lives under `projects/<project_id>/` with
`project.json`, `research.md`, `data/manifest.json`, and immutable
`runs/<run_id>/` directories:

```bash
uv sync --frozen
uv run aq status . --json
uv run aq project create . us-momentum \
  --name "US Momentum" \
  --train-end 2022-12-31 \
  --val-end 2024-06-30 \
  --holdout-end 2025-12-31
uv run aq data fetch . --project us-momentum \
  --bar-id AMEX:SPY --bar-id NASDAQ:QQQ --interval 1d --dataset-id etfs
uv run aq run compare . --project us-momentum --json
uv run aq studio serve .
```

Agents write free-form Python scripts against `import autoquant as aq`:

- **Causal panels & data ingestion**: `aq.fetch_alice_bars(...)` and
  `aq.ingest_ohlcv(...)` normalize bars from `alice market bars`, CSV/Parquet
  files, or the 14 bundled regional `fetch-*-ohlcv` venue skills (`aq-python`),
  checking exchange sessions (`exchange_calendars`) and preventing silent
  forward-filling across ragged multi-market panels.
- **Train / Validation / Holdout guardrails**: `aq.load_panel(project, split="val")`
  physically excludes Holdout dates `(val_end, holdout_end]` during feature and
  parameter iteration. Calling `aq.evaluate_holdout(...)` scores `(val_end, holdout_end]`
  and increments `holdout_audit.unlock_count` (with code SHA-256 and Git commit
  provenance) in `project.json`.
- **Factors, backtests & custom Runs**: `aq.evaluate_factor(...)`,
  `aq.backtest_weights(...)`, and `aq.record_run(...)` record immutable
  `run.json` metrics, `series/*` curves, and optional custom `artifacts/*.json`
  (`line`, `bar`, `table`), `.svg`, or `.md` cards that Studio renders
  automatically.

## Managed Studio

OpenAlice launches the source Workspace's declared Harness command with exact
loopback ports, supervises it, waits on its `/api/v1/health` readiness path, and
embeds the ready app through an opaque Surface URL. The page distinguishes
starting, failure, and ready states and exposes **Refresh**, **Restart**,
**Logs**, and **Open separately** controls.

The first `v1.0.0` Workspace setup remains agent-owned: the Coding Agent runs
the required `uv sync --frozen` preparation. If dependencies are missing,
choose **Set up with Agent** to open a prefilled Quick Start task, review its AI
configuration, and restart Studio after setup. OpenAlice never installs source
dependencies silently.

## Delegate from Ask Alice

New or explicitly template-upgraded Chat Workspaces receive a
`delegate-autoquant` skill that teaches the Chat Agent to hand a bounded
quantitative research assignment to the initialized default desk. The
underlying public route is:

```bash
alice conversation create --harness autoquant \
  --prompt "Research this hypothesis, preserve the stated constraints, and return the Project path and immutable Run IDs"
```

Delegation dispatches asynchronously by default and returns `taskId` and
`resumeId` immediately. Once dispatched, the calling Session ends its turn;
when AutoQuant finishes, OpenAlice automatically wakes the calling Session so it
can run `alice conversation check` (or `alice conversation read --task-id <taskId>`,
`await`, or `collect`) to consume the reply. Reserve `--await` for quick
follow-up questions on an existing Session
(`alice conversation ask --resume-id <resumeId> --await ...`), which waits up to
a bounded quick-reply window without stopping the background run. AutoQuant
delegation has no default execution deadline; use `--timeout-ms` only for a
caller-chosen hard stop.

The Harness target requires an explicitly initialized default AutoQuant
Workspace. It never creates or guesses a desk during delegation. The returned
Agent message names its `project_id` and immutable `runId`s under `runs/`, gives
the absolute Project root and primary deliverable path (such as `research.md` or
a Run artifact directory), distinguishes Validation metrics from Holdout metrics
(including `holdout_audit.unlock_count`), and states assumptions, limitations,
and `tradingAuthority: none`. Continue the returned `resumeId` with
`alice conversation ask --resume-id <resumeId>` for clarification instead of
recruiting another worker and losing its context.

AutoQuant does not automatically publish research artifacts to Inbox. Its
ordinary Agent reply is the handoff; request `alice inbox push` only when a
durable human-facing delivery or asynchronous notification is actually wanted.

## Source and provenance

Bootstrap copies the embedded AutoQuant workbench (`autoquant/`, Studio assets,
docs, and bundled OHLCV skills) directly into the new Workspace and initializes
a local `research/<tag>` Git branch so the Coding Agent can inspect, run, and
modify both Projects and workbench code locally.

The Workspace keeps AutoQuant's own `AGENTS.md`. OpenAlice does not replace it
with the Chat template's Alice instructions; it adds discoverable collaboration,
market-data, Inbox, and UTA skills alongside AutoQuant's instructions.

Python 3.11, `uv`, AutoQuant dependencies, Projects, and research iteration
remain the Coding Agent's responsibility inside the desk. A quick orientation
command is:

```bash
uv run aq status . --json
uv run aq project list . --json
```

## Boundaries

- AutoQuant owns quantitative research truth, split isolation, and immutable Run
  evidence.
- OpenAlice owns Workspace, Agent, Session, collaboration, and delivery
  lifecycle.
- UTA alone owns live accounts, approvals, and trading writes.
- Existing Auto-Quant Classic Workspaces are left intact and are not
  reinterpreted as AutoQuant desks.
- Existing desks are never rewritten automatically when OpenAlice updates its
  embedded template; local Git history inside each desk stays under your and
  your Agent's control.

## Next Steps

- [Workspaces](/docs/workspaces/workspaces) — Understand the durable desk and Session model.
- [Templates](/docs/workspaces/templates) — See how first-class templates materialize Workspaces.
- [Inbox](/docs/workspaces/inbox) — Publish evidence-bound reports back to the user.
- [AI Providers](/docs/integration/ai-providers) — Configure the coding Agent used by the desk.
