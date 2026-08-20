---
version: 0.1.0
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
tools, and Workspace lifecycle around the desk. This first Beta integration
does not start, proxy, embed, or supervise Auto Prediction Studio.

The exact upstream source is recorded in `.alice/harness-source.json`. Until
Auto Prediction publishes releases, OpenAlice labels the approved commit as an
experimental snapshot rather than inventing release semantics.

The current approved snapshot is `snapshot-26f3ae2` at commit
`26f3ae2d617e115850cff6fe047f6fb54c979d20`, the merge that qualifies Auto
Prediction on Node.js 22.

## Starting work

The Coding Agent should read the repository's `AGENTS.md`, prepare its declared
Node/pnpm dependencies when missing, run the repository checks appropriate to
the requested work, and retain positive or negative research evidence in the
formats owned by Auto Prediction.

## Boundaries

- Auto Prediction owns prediction-market research truth and application state.
- The Coding Agent owns dependency installation and repository iteration.
- OpenAlice owns Workspace, Session, source receipt, and collaboration state.
- No Studio process or web-surface contract is implied by this template.
- Harness upgrades are never automatic; create-time source selection is exact.
