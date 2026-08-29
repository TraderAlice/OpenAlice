---
version: 0.1.2
---

# Auto Prediction

An Agent-native prediction-market research desk backed by an immutable source
snapshot of [Auto Prediction](https://github.com/TraderAlice/Auto-Prediction).

## What this Workspace does

The repository root is the research desk. Its Coding Agent inspects anonymous
venue evidence, develops semantic hypotheses, runs the repository's checks,
and maintains research artifacts and local Git history. Auto Prediction owns
its SQLite state, campaigns, evidence model, internal workers, and Studio.

OpenAlice supplies native Agent Sessions, collaboration, Inbox, market-data
tools, Workspace lifecycle, and the managed Studio route around the desk.
OpenAlice supervises only the command declared by `harness.json`; Auto
Prediction retains its complete Studio and control-plane ownership.

The exact upstream source is recorded in `.alice/harness-source.json`.
OpenAlice pins each approved release tag to its verified commit while retaining
earlier qualified versions for explicit selection and rollback.

The current approved release is `v0.1.2` at commit
`d6c9447cab29898a6eb5fa06be3598b8474cc02f`. It retains the Node.js 22
qualification and implements the generic v1 managed Studio capability with a
bounded startup path while the initial catalog refresh continues in the
background. Release `v0.1.1` and the earlier qualified snapshots remain
selectable for rollback and source-history work.

## Starting work

The Coding Agent should read the repository's `AGENTS.md`, prepare its declared
Node/pnpm dependencies when missing, run the repository checks appropriate to
the requested work, and retain positive or negative research evidence in the
formats owned by Auto Prediction.

## Boundaries

- Auto Prediction owns prediction-market research truth and application state.
- The Coding Agent owns dependency installation and repository iteration.
- OpenAlice owns Workspace, Session, source receipt, and collaboration state.
- Studio uses the shared managed web-surface contract; no AP-specific business
  API is implied by this template.
- Harness upgrades are never automatic; create-time source selection is exact.
