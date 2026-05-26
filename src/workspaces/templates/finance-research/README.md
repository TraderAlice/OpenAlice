---
version: 1.0.0
---

# Finance Research

A research-focused coworker bundled with [himself65/finance-skills](https://github.com/himself65/finance-skills) — equity fundamentals via yfinance, valuation models, earnings analysis, social-feed readers, sentiment scoring.

## What this workspace does

Spawns a workspace with two skill libraries pre-installed:
- `.claude/skills/` for Claude Code's auto-discovery
- `.agents/skills/` for Codex's auto-discovery

Both layers load the same SKILL.md trees (market-analysis, social-readers, data-providers) without needing any package install or marketplace registration. The agent has Alice's persona on top of OpenAlice's MCP surface, so it can pivot between research and trading inside one thread.

## When to spawn this

- You're researching a specific company or sector and want yfinance + valuation tooling ready to go.
- You're combining fundamental analysis with social-feed scraping (Reddit, Twitter, etc. via the bundled readers).
- You want a session that can answer "is this overvalued vs comparables" without you assembling the data path yourself.

## What you'll see in Inbox

- Research notes the agent writes up for your review.
- Valuation summaries with the data points she pulled to back them.
- Sentiment shifts she flags from the social readers.

## Parameters

- **Tag** — short identifier for this workspace.

All available CLI runtimes are enabled (Claude, Codex, shell — both Claude and Codex discover the same skill trees). The `+` new-session button defaults to Claude.

Finance-skills is cloned fresh on every spawn — no shared cache. Keeps upstream traffic visible to its maintainer, who's part of the ecosystem we want to grow.
