# Chat workspace

OpenAlice's market/data tools are available here — reachable through the
OpenAlice MCP server and/or the CLIs on your shell PATH, depending on how
this workspace was launched. Check what's actually wired before you start:

- `/mcp` — shows the connected OpenAlice MCP server(s)
- `traderhub --help` / `alice --help` — the CLI command groups (when on PATH)

Use whichever is available; if a data tool isn't where you expect, check the
other. Scheduling (cron) stays on MCP by design.

## OpenAlice CLIs (`traderhub`, `alice`, `alice-workspace`, `alice-uta`)

Four CLIs on your shell PATH, split by what they touch — handy for a quick
lookup, a pipe, or a grep without a tool round-trip:

```bash
traderhub --help                   # LOW-FREQUENCY MARKET DATA: boards, fundamentals,
                                   #   macro series, calendars, ETF, shipping, Fed
traderhub board get --board macro  # a finished board in one call
traderhub equity profile --symbol AAPL

alice --help                       # WORKBENCH: rss-archive/market-search/analysis/think
alice market search --query AAPL   # find a symbol (barIds for charts/quant)
alice rss grep --pattern BTC       # search the collected-RSS archive, then…
alice rss read --id <id>           # …read one article by its stable id

alice-workspace --help             # COLLABORATION: inbox push + entity tracking

alice-uta --help                   # TRADING: accounts, portfolio, orders,
                                   #   trading-as-git approval flow (MUTATING —
                                   #   resolve contracts first, report results)
```

All hit the same backend the MCP tools do. Output is JSON on stdout; a non-zero
exit means it failed. (If this workspace has no `openalice` MCP tool server, the
CLIs are how you reach OpenAlice — the bundled `traderhub` and `openalice-cli`
skills are the full playbooks.)

## Beyond Alice's data — `opencli` (optional, read-only)

For data Alice doesn't ship — social sentiment, options flow, CN money-flow,
global news frontpages, research papers — the bundled `opencli-reader` skill
teaches a community CLI with ~160 site adapters. It is NOT pre-installed:
if a task would benefit and it's missing, say what's missing and ask the
user whether to install it — never install silently, never silently work
with thinner data. Numbers Alice ships (quotes, fundamentals, macro) stay on
`traderhub`/`alice`; opencli data never directly drives a trading decision.

## Handing work back to the user

This workspace has an outbound channel to the user's Inbox (`inbox_push`).
When you finish something the user should see — a shortlist, a thesis, a
rotation snapshot, a decision you reached — push it to their inbox: the
file(s) you produced plus a short note on what it is and why it matters.
Don't make them come looking in the workspace; surface the result. (One-way
for now — they read the inbox; they don't reply through it.)

If you don't have the `inbox_push` MCP tool, use the CLI: `alice-workspace
inbox push --comments "…"` (comment-only; for a doc attachment use the MCP tool).

## Tracking assets & topics worth following

When you surface something the user will want to keep an eye on over time — a
ticker you're watching, a theme that ties several together — register it with
`entity_upsert`. Make the name **self-describing** — a bare ticker like `ccj`
means nothing to a non-trader (or to you, weeks later). For an `asset`, prefix
the symbol with its instrument kind: `stock-vst`, `stock-ccj`, `crypto-btc`,
`etf-smh`. For a `topic`, a short phrase: `ai-data-center-power`. Then link to it
in your notes with `[[name]]` — e.g. `[[stock-vst]]`, `[[ai-data-center-power]]`.

Those links are the index: the user's Tracked tab gathers every note that
references `[[name]]`, so a week later they can open `[[stock-vst]]` and see its
whole story across your files without re-reading them. Before creating one, call
`entity_search` to reuse an existing name instead of fragmenting it. (No MCP
tools? Same thing via the CLI: `alice-workspace track search --query …` then
`alice-workspace track add --name … --type asset|topic --description "…"`.)

Otherwise, use this workspace however you like. The CWD is its own git
repo (commits stay local), and any files you create or edit are scoped
to this workspace.
