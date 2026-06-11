---
version: 1.1.0
---

# Chat

A general-purpose Alice workspace. The agent boots with Alice's full tool
surface — market/research data plus trading, by default through the
`alice*` / `traderhub` CLIs on its PATH (or through the OpenAlice MCP server
if you pick MCP at creation) — and Alice's persona pre-loaded as
CLAUDE.md / AGENTS.md.

## What this workspace does

This is the closest equivalent to "talk to Alice about anything
trading-related." There's no pre-baked task, no specific data layout. The
agent can quote tickers, pull boards and fundamentals, search the
collected-RSS archive, and run indicators. The bundled `opencli-reader`
skill additionally teaches it to reach long-tail sources (social sentiment,
options flow, global news frontpages) through the optional community
`opencli` CLI — it will ask before assuming you have it.

Trading runs through the `alice-uta` CLI (or the MCP trading tools in MCP
mode) against your UTA accounts — orders go through the trading-as-git
approval flow. Scheduling (cron) stays MCP-only.

## When to spawn this

- You want a long-running thread with Alice that isn't tied to a specific research artifact or autoresearch loop.
- You're exploring an idea and don't yet know which workspace the job needs — Chat is the no-commitment starting point.
- You want quick access to Alice's full data surface without setting up Auto-Quant clones or finance-skill trees.

## What you'll see in Inbox

(v1: Inbox is one-way — the agent posts; you don't reply through it.)

Things Alice will route here:
- Trade execution confirmations (when she places orders on your behalf).
- Market alerts she's been watching for you.
- Anything she flags as worth re-reading later.

## Parameters

When spawning, you'll configure:
- **Tag** — short identifier for this workspace (lowercase, dashes ok).
- **Tools** — how the agent reaches Alice's tools: CLI (default) or MCP.

All available CLI runtimes (Claude, Codex, opencode, Pi, shell) are enabled by default; the template's first listed adapter is what the `+` "new session" button defaults to.
