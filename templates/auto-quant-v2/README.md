---
version: 0.9.34
---

# AutoQuant

An Agent-native quantitative research workbench shipped directly inside
OpenAlice's first-class `templates/auto-quant-v2` template.

## What this Workspace does

The Workspace root is a self-contained quantitative research desk materialized
from OpenAlice's embedded AutoQuant V2 workbench (`v0.9.34`), including
`autoquant/` framework code, Studio assets, project templates, and canonical
OHLCV acquisition skills so the Coding Agent can inspect, run, and evolve the
workbench directly inside its own local Git repository.

Its Coding Agent creates or continues sibling Projects under `projects/`, uses
`aq orient` to recover the exact next action, runs governed Studies and Research
Sessions, commits research or local workbench changes, and returns
evidence-bound Reports or Dossiers through ordinary Agent communication.

OpenAlice supplies the native Agent Session, collaboration log, peer
conversation, Inbox, market-data tools, managed Studio surface, and optional UTA
access around the desk. It does not reproduce AutoQuant's Project, Study,
Session, Run, Report, or Dossier lifecycle.

## Starting work

The Coding Agent should:

1. read the Workspace's `AGENTS.md`;
2. prepare the declared Python 3.11 environment with `uv sync --frozen` when it
   is missing;
3. run `uv run aq project list .`, `uv run aq validate .`, and
   `uv run aq orient . --json`;
4. clarify caller-owned ambiguity through ordinary conversation;
5. create or continue the appropriate Project and maintain its research brief;
6. return useful positive or negative evidence through the delegating Agent or
   OpenAlice Inbox.

AutoQuant's own `AGENTS.md` remains authoritative inside the desk. OpenAlice
injects discoverable collaboration, market-data, Inbox, and UTA skills without
replacing that instruction file.

## Boundaries

- The Coding Agent owns dependency installation and quantitative iteration.
- AutoQuant owns historical research truth and durable evidence.
- OpenAlice owns Workspace/Agent lifecycle and authenticated collaboration.
- UTA alone owns live accounts, approvals, and trading writes.
- Existing Auto-Quant Classic Workspaces are not migrated or reinterpreted.
