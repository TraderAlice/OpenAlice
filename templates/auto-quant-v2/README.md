---
version: 1.0.0
---

# AutoQuant

An Agent-native quantitative research workbench shipped directly inside
OpenAlice's first-class `templates/auto-quant-v2` template.

## What this Workspace does

The Workspace root is a self-contained quantitative research desk materialized
from OpenAlice's embedded AutoQuant workbench (`v1.0.0`), including the thin,
composable `autoquant/` Python toolkit, zero-CDN Quant Studio assets, and
bundled OHLCV acquisition skills so a native Coding Agent can inspect, run, and
evolve both research Projects and workbench code inside its own local Git
repository.

Its Coding Agent creates or continues sibling Projects under `projects/`, writes
ordinary Python/pandas research scripts (`import autoquant as aq`), enforces
strict causal alignment and Train/Validation/Holdout guardrails, records
immutable Runs (`projects/<id>/runs/<run_id>/`) with optional custom Studio
artifacts, and returns evidence-bound conclusions through ordinary Agent
communication.

OpenAlice supplies the native Agent Session, collaboration log, peer
conversation, Inbox, market-data tools (`alice market bars`), managed Studio
surface, and optional UTA access around the desk.

## Starting work

The Coding Agent should:

1. read the Workspace's `AGENTS.md`;
2. prepare the declared Python 3.11 environment with `uv sync --frozen` when it
   is missing;
3. run `uv run aq status . --json` and `uv run aq project list . --json`;
4. clarify caller-owned ambiguity through ordinary conversation before running
   experiments;
5. create or continue the appropriate Project (`projects/<id>/research.md`),
   develop on `split="val"`, unlock Holdout via `evaluate_holdout` only once a
   specification is finalized, and record immutable Runs;
6. return honest positive or negative evidence—naming the Project, immutable
   Run IDs, Validation vs Holdout metrics (`holdout_audit.unlock_count`), and
   deliverable path—through the delegating Agent or OpenAlice Inbox.

AutoQuant's own `AGENTS.md` remains authoritative inside the desk. OpenAlice
injects discoverable collaboration, market-data, Inbox, and UTA skills without
replacing that instruction file.

## Boundaries

- The Coding Agent owns dependency installation and quantitative iteration.
- AutoQuant owns historical research truth, anti-overfitting splits, and durable
  Run evidence.
- OpenAlice owns Workspace/Agent lifecycle and authenticated collaboration.
- UTA alone owns live accounts, approvals, and trading writes.
- Existing Auto-Quant Classic Workspaces are not migrated or reinterpreted.
