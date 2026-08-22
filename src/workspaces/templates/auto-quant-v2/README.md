---
version: 1.1.5
---

# AutoQuant

An Agent-native quantitative research workbench backed by a pinned release of
[AutoQuant V2](https://github.com/TraderAlice/Auto-Quant-V2).

## What this Workspace does

The repository root is the quantitative desk. Its Coding Agent creates or
continues sibling Projects, uses `aq orient` to recover the exact next action,
runs governed Studies and Research Sessions, commits research changes, and
returns evidence-bound Reports or Dossiers through ordinary Agent
communication.

OpenAlice supplies the native Agent Session, collaboration log, peer
conversation, Inbox, market-data tools, and optional UTA access around the
desk. It does not reproduce AutoQuant's Project, Study, Session, Run, Report,
or Dossier lifecycle.

The default supported source is AutoQuant V2 `v0.9.34` at commit
`52d63148d826e6c35d48c3167d95a4cc7a4eb6c4`, the first pinned release whose
generic v1 managed Studio command is directly runnable from a prepared source
Workspace under an ordinary supervisor PATH. The exact upstream source is
recorded in `.alice/harness-source.json`; the Workspace itself starts a fresh
research branch at that commit while retaining AutoQuant's upstream history and
`origin` remote for later Coding Agent-managed fetches and merges.

## Starting work

The Coding Agent should:

1. read the repository's `AGENTS.md`;
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
- Harness upgrades are never automatic; create-time source selection is exact.
