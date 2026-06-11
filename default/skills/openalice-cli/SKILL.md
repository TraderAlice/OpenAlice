---
name: openalice-cli
description: >
  How to reach OpenAlice from your shell via the `alice*` CLIs. Three binaries:
  `alice` for THIS WORKBENCH's research surfaces (the collected-RSS archive,
  cross-asset symbol search, K-line quant analysis, calculator),
  `alice-workspace` for AGENT COLLABORATION (push finished work to the user's
  inbox, track entities), and `alice-uta` for TRADING (accounts, portfolio,
  orders, the trading-as-git approval flow). All print JSON and are
  discoverable with `--help`. Use for: "grep the collected feeds for the Fed",
  "find the barId for AAPL", "compute RSI", "push my findings to the inbox",
  "track this ticker", "what's my position", "place the order".
  (LOW-FREQUENCY market data — fundamentals, macro series, calendars, boards —
  lives on the separate `traderhub` CLI; see the `traderhub` skill. Technical
  analysis manual: `openalice-quant`.) Discover everything live with `--help`
  — do NOT guess flags.
---

# Using the `alice*` CLIs

OpenAlice exposes three CLIs on your shell PATH, split by what they touch. All
talk to the same backend the `openalice` MCP tools do — they're the CLI
front-ends, handy for piping, grepping, and quick scripted use. **Prefer them in
this workspace** (especially if the MCP tools aren't reliably available to you).

| Binary | For | Groups |
|---|---|---|
| `alice` | **Workbench research** (read) | `rss`, `market`, `analysis`, `think` |
| `alice-workspace` | **Agent collaboration** | `inbox`, `track` |
| `alice-uta` | **Trading** (mutating!) | `account`, `contract`, `order`, `position`, `git`, `market`, `sim` |
| `traderhub` | **Low-frequency market data** — see the `traderhub` skill | `board`, `equity`, `etf`, `economy`, `global`, `shipping`, `fed`, `crypto`, `index` |

## Discover, don't guess

The command tree and every flag are served live, per binary. Always start here:

```bash
alice --help                       # market-data groups
alice <group> <verb> --help        # a verb's flags (which are required)
alice-workspace --help             # collaboration groups
alice-workspace <group> <verb> --help
```

## Shape

```
alice <group> <verb> [--flag value] [--flag=value]
alice-workspace <group> <verb> [--flag value]
```

- **Output is JSON on stdout.** Pipe it: `alice market search --query AAPL | jq '.results[0]'`.
- **A non-zero exit means it failed**; the error goes to stderr. Check it.

## Workbench research — `alice`

**Find a symbol** (returns barIds — the operational handle for charts/quant):

```bash
alice market search --query "apple"
```

(Fundamentals, ratios, calendars and macro series live on `traderhub` —
e.g. `traderhub equity profile --symbol AAPL`.)

**Search the collected-RSS archive, then read one article by its stable id**
(the `id` is stable — you do **not** need to repeat `--lookback` to read it):

```bash
alice rss grep --pattern "interest rate" --lookback 2d
alice rss read --id <id-from-the-results>
```

**Metadata filters** (`--meta` is repeatable):

```bash
alice rss grep --pattern BTC --meta source=coindesk --meta category=crypto
```

Know what `rss` is: an archive of articles Alice's collector pulled from the
user's **subscribed feeds** — coverage is exactly the feed list, nothing more.
It is NOT a general news search. Empty results mean "not in the subscribed
feeds", not "nothing happened". For news beyond the feeds (frontpages,
breaking, a specific outlet), say what's missing — and if the workspace has
the `opencli-reader` skill, that's the route to wider sources.

**Technical / quantitative analysis** lives in its own surface — `alice analysis
search-bars` (find a K-line barId) then `alice analysis quant` (compute). It's a
small scripting language with a full function catalog, multi-timeframe panels,
and source selection. **See the `openalice-quant` skill** for the manual; don't
hand-roll indicators here.

## Collaboration — `alice-workspace`

**Hand finished work back to the user** — this is the outbound channel. It posts
to the user's Inbox tab:

```bash
alice-workspace inbox push --comments "Done — TSLA looks extended; details below."
```

(CLI `inbox push` is comment-only; to attach a rendered doc file, use the
`inbox_push` MCP tool's `docs` param instead.)

**Track entities** — the durable cross-workspace tracked index (`[[name]]`):

```bash
alice-workspace track search --query "uranium"
alice-workspace track add --name uranium-ccj --description "Cameco — uranium miner"
```

## Trading — `alice-uta`

Accounts, portfolio, orders, and the trading-as-git approval flow. **These
mutate real broker state** — discover before you act, and act only on what
the user's instructions actually cover:

```bash
alice-uta account list                 # registered trading accounts + capabilities
alice-uta account portfolio --help     # then query positions
alice-uta contract search --help       # find the broker-native contract first
alice-uta order place --help           # check EVERY flag before placing
alice-uta git status                   # trading-as-git: see pending state
alice-uta git log --help               # ...and the approval/history verbs
```

- **Resolve the contract before any order** (`contract search` →
  `contract details`) — never guess a symbol's broker-native identity.
- **Report every order result to the user** — order id, status, and what
  you did. Surprises in a brokerage account are never acceptable.
- The `git` group is OpenAlice's trade-approval flow (status / log / show /
  commit / push / sync) — mirror of git verbs, run `--help` per verb.

## What the CLIs are NOT for

- **Scheduling is not on any CLI** — cron stays on the OpenAlice MCP tools by
  design. If you need it and it isn't available here, say so rather than
  improvising.
