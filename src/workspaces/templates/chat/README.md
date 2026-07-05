---
version: 1.2.0
---

# Chat

A general-purpose Alice workspace. The agent boots with Alice's full tool
surface — market/research data plus trading, through the `alice*` / `traderhub`
CLIs on its PATH — and Alice's persona pre-loaded as CLAUDE.md / AGENTS.md.

## What this workspace does

This is the closest equivalent to "talk to Alice about anything
trading-related," but it is still a workspace, not a stateless chat room. The
agent can quote tickers, pull boards and fundamentals, search the collected-RSS
archive, run indicators, write research files, track entities with `[[name]]`,
and turn follow-up into `.alice/issues/<id>.md` work items. The bundled
`opencli-reader` skill additionally teaches it to reach long-tail sources
(social sentiment, options flow, global news frontpages) through the optional
community `opencli` CLI — it will ask before assuming you have it.

Trading runs through the `alice-uta` CLI against your UTA accounts — orders go
through the trading-as-git approval flow. Recurring/headless work runs through
scheduled issues: add a `when` field to an issue and the launcher fires it as a
headless workspace run.

## When to spawn this

- You want a long-running thread with Alice that isn't tied to a specific research artifact or autoresearch loop.
- You're exploring an idea and don't yet know which workspace the job needs — Chat is the no-commitment starting point.
- You want quick access to Alice's full data surface without setting up Auto-Quant clones or finance-skill trees.
- You want to turn a loose market concern into a durable issue, tracked entity, Inbox report, or scheduled check.

## What you'll see in Inbox

(v1: Inbox is one-way — the agent posts; you don't reply through it.)

Things Alice will route here:
- Research notes, thesis updates, and market snapshots worth re-reading later.
- Reports produced by scheduled issues or headless runs.
- Trade execution summaries or staged-operation notes when trading work happens.

## Parameters

When spawning, you'll configure:
- **Tag** — short identifier for this workspace (lowercase, dashes ok).

All available CLI runtimes (Claude, Codex, opencode, Pi, shell) are enabled by default; the template's first listed adapter is what the `+` "new session" button defaults to.
