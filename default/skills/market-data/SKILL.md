---
name: market-data
description: >
  Use for price history, OHLCV/K-lines, market-data source discovery, China
  A-share index/name bars, or showing a candlestick chart in a conversation.
  Fetch data for local analysis or share a chart using OpenAlice market
  references. Pair with the `traderhub` market-brief workflow when covering
  A-share tape alongside macro boards.
---

# Market data and charts

OpenAlice's Market UI and `alice market` share the same K-line service.
Workspace shells already select their Alice Project. Outside a Workspace, use
`openalice exec --project <key> alice market ...`.

## Find and read a series

```bash
alice market search-bars --query AAPL
alice market bars --bar-id 'yfinance|AAPL' --interval 1d --count 300 --output bars.json
```

Copy an exact `barId` from search results. It identifies a source as well as an
instrument: two feeds for the same symbol are different series. Do not rewrite
native symbols or guess broker account IDs. If source discovery is empty,
`alice market vendors` shows configured vendor availability.

The result contains `bars` (OHLCV) and `meta`. Use the file in local Python,
JavaScript or shell analysis; omit `--output` for stdout. Existing output files
are not overwritten. `alice market bars --help` lists window options and an
explicit `--asset-class` hint for vendor lookups that cannot resolve the class.
The `alice-analysis` skill covers optional formula and snapshot shortcuts.

### China A-shares (indexes and names)

For **daily market briefs**, prefer compiler endpoints (CSI / CNI) documented in
the `traderhub` skill `references/brief-evidence-stack.md` — they carry official
change %. Use `alice market` bars as **fallback or ETF/name tape**, not as a
silent override of CSI/CNI.

When using bars, discover then copy the exact `barId` (do not hard-code a vendor
if search returns another live source). Always request **enough history** to
compute change % (`--count` ≥ 5, usually 20):

```bash
alice market search-bars --query "000001.SS"    # SSE Composite (Yahoo-style)
alice market search-bars --query "000300.SS"    # CSI 300
alice market search-bars --query 沪深300
alice market search-bars --query 600519         # example single name
alice market vendors                            # eastmoney / yfinance must be on
alice market bars --bar-id '<from-search>' --interval 1d --count 20
```

Prefer an enabled Eastmoney or Yahoo equity source for CN bar history when
CSI/CNI is unreachable. Realtime Level-1 on the Market page may use the keyless
Tencent quote path — watching latency, not exchange matching. Sector money-flow
and limit-up lists are **not** in this CLI; see `traderhub` market-brief +
evidence stack for exchange day-end disclosure vs optional Tushare gaps.

Check the returned coverage and freshness metadata, especially the earliest
and latest records, fetch time and possible delay. The age of the last bar is
not measured feed latency; market closures and bar boundaries matter. Do not
present a delayed or historical observation as a live quote.

## Show a chart in a reply

Write a market reference directly in reply prose when a chart helps:

[[market/yfinance|AAPL/1d]]

The syntax is `[[market/{barId}/{interval}]]`. Copy the discovered barId intact,
including any slash in its symbol; the final slash separates the interval.
Intervals are `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w` (availability
varies by source). The reference requests the latest 300 bars, not a saved
snapshot of an earlier analysis.

GUI chat displays a card and opens the interactive chart in the right panel.
Supported Connectors such as Telegram send a chart image at that position in
the reply, preserving surrounding text order. Put the reference outside code
when you want it rendered; code examples remain literal. Failed references do
not silently switch feeds. There is no need to generate or attach a chart file.

For broker quotes, contracts, positions or orders, use `alice-uta` instead.
A market reference only displays data; it does not place a trade.
