---
version: 0.1.1
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

The exact upstream source is recorded in `.alice/harness-source.json`. Until
Auto Prediction publishes releases, OpenAlice labels the approved commit as an
experimental snapshot rather than inventing release semantics.

The current approved release is `v0.1.1` at commit
`db49d9dde1386fe3f0f8e7b7c78aa3810b7438b9`. It retains the Node.js 22
qualification and implements the generic v1 managed Studio capability. The
earlier qualified snapshots remain selectable for source-history work.

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
