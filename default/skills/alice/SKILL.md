---
name: alice
description: >
  Research data and Workspace collaboration through the `alice` CLI:
  symbol discovery, K-line analysis, optional subscribed-article lookup,
  peer conversations, Inbox and Issues. Use CLI help for command parameters.
  Also use alice for Workspace collaboration: peer discovery, Agent conversations,
  Inbox delivery, Issues, Session identity, tracked assets and template upgrades.
  Read references/collaboration.md for these workflows.
---

# Research & collaboration — `alice`

`alice` is OpenAlice's research and collaboration interface on your PATH. Output is JSON on stdout
(pipe it: `alice market search --query AAPL | jq '.results[0]'`); a non-zero
exit means it failed, with the reason on stderr.

## Discover, don't guess

```bash
alice --help                       # discover research and collaboration groups
alice <group> <verb> --help        # a verb's flags (which are required)
```

## Workbench research

**Find a symbol** (returns barIds — the operational handle for charts/quant):

```bash
alice market search --query "apple"
```

(Fundamentals, ratios, calendars and macro series live on `traderhub` —
e.g. `traderhub equity profile --symbol AAPL`.)

**Expand coverage with vendors.** Symbol search — and the K-line sources it
returns — comes from a set of data vendors; `yfinance` (global, always on) is the
default. For a name a global vendor misses, like a **CN A-share or a Taiwan stock
by its native name**, a local vendor closes the gap. List what's on and what each
covers, then enable one — **live on the next search, no restart**:

```bash
alice market vendors                                    # sources, on/off, and how to use each
alice market vendor-set --vendor twse --enabled true    # Taiwan (TWSE/TPEx); `eastmoney` for CN A-shares
```

If a search for a non-US name comes up empty, check `alice market vendors`
**before giving up** — the covering source may just be off. Each vendor's
`howToUse` flags its quirks (e.g. twse wants 繁体 `台積電`, not 简体 `台积电`).

`alice rss` is an optional quick scan of collected subscription articles,
with limited coverage. Command parameters are available in `alice rss --help`.

**Raw K-lines** use the same BarService as the Market chart:

```bash
alice market search-bars --query AAPL
alice market bars --bar-id 'yfinance|AAPL' --asset-class equity --interval 1d --count 250 --output bars.json
```

The JSON file contains `bars` and `meta`, suitable for local Python/JavaScript
or shell pipelines. Omit `--output` for stdout. Existing files are preserved.
Sources retain their own identity; inspect coverage and freshness metadata.
`alice analysis quant` and `snapshot` remain optional conveniences; see the
`alice-analysis` Skill for their formula syntax.

Workspace shells inherit their Alice Project automatically. Outside a Workspace,
use `openalice exec --project <key> alice <group> <verb> ...`; omitting the
selector uses the configured Project context/default. Explicit Project selection
clears inherited Workspace/Session scope. Workspace collaboration commands need
Workspace context.

## Collaboration and durable assets

The same `alice` CLI also owns `peer`, `conversation`, `inbox`, `issue`,
`provenance`, `signature`, `session`, `track`, and `template`. These are top-level
groups, not an `alice workspace` subcommand.

Read [the collaboration reference](references/collaboration.md) before sending
messages, delivering reports or managing durable work. Workspace and Session
identity are supplied by the launch context. Use live `alice --help` to discover
commands and flags.
