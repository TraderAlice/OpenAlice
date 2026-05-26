---
version: 1.0.0
---

# Chat

A general-purpose Alice workspace. The agent boots with OpenAlice's full MCP tool surface — trading actions, market data, news, technical analysis, brain memory — and Alice's persona pre-loaded as CLAUDE.md / AGENTS.md.

## What this workspace does

This is the closest equivalent to "talk to Alice about anything trading-related." There's no pre-baked task, no specific data layout. The agent can quote tickers, place trades against your UTA accounts, pull news, run indicators, and remember conversations across sessions through the brain memory tools.

## When to spawn this

- You want a long-running thread with Alice that isn't tied to a specific research artifact or autoresearch loop.
- You're exploring an idea and don't yet know which Harness fits — Chat is the no-commitment starting point.
- You want quick access to the full MCP tool surface without setting up Auto-Quant clones or finance-skill trees.

## What you'll see in Inbox

(v1: Inbox is one-way — the agent posts; you don't reply through it.)

Things Alice will route here:
- Trade execution confirmations (when she places orders on your behalf).
- Market alerts she's been watching for you.
- Anything she flags as worth re-reading later.

## Parameters

When spawning, you'll configure:
- **Tag** — short identifier for this workspace (lowercase, dashes ok).

That's it. All available CLI runtimes (Claude, Codex, shell) are enabled by default; the template's first listed adapter is what the `+` "new session" button defaults to.
