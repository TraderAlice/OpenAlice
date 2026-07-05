---
name: alice
description: >
  Research & data on your shell PATH via the `alice` CLI — THIS WORKBENCH's
  read surfaces: the collected-RSS archive (`alice rss`), cross-asset symbol
  search (`alice market search` → barIds), and K-line quant analysis
  (`alice analysis`). Use for: "grep the collected feeds for the Fed", "find
  the barId for AAPL", "compute RSI on this chart", "I can't find a Taiwan/CN
  stock — add a data vendor". Output is JSON; discover every flag with
  `alice --help` / `alice <group> <verb> --help` — do NOT guess.
  (Low-frequency market data — fundamentals, macro series, calendars, boards —
  is the separate `traderhub` CLI; the quant scripting manual is the
  `alice-analysis` skill.)
---

# Research & data — `alice`

`alice` is OpenAlice's read surface on your PATH. Output is JSON on stdout
(pipe it: `alice market search --query AAPL | jq '.results[0]'`); a non-zero
exit means it failed, with the reason on stderr.

## Discover, don't guess

```bash
alice --help                       # the groups: rss, market, analysis, think
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
feeds", not "nothing happened" — so don't stop at "nothing found." For news
beyond the feeds (frontpages, breaking, a specific outlet, social chatter),
that's what `opencli` reaches (the `opencli-reader` skill, when this workspace
has it — it'll ask to install if needed). Say what's missing rather than
quietly returning thin.

**Technical / quantitative analysis** lives in its own surface — `alice analysis
search-bars` (find a K-line barId) then `alice analysis quant` (compute). It's a
small scripting language with a full function catalog, multi-timeframe panels,
and source selection. **See the `alice-analysis` skill** for the manual; don't
hand-roll indicators here.
