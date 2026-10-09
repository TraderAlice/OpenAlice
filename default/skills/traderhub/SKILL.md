---
name: traderhub
description: >
  How to pull LOW-FREQUENCY market data from the `traderhub` CLI: finished
  market boards (macro, movers, calendars, global macro, Fed, shipping,
  term structure, sector rotation), equity fundamentals (profile, financials,
  ratios, estimates, insiders, short interest), ETF drilldowns, FRED/BLS/EIA
  macro series, OECD cross-country indicators, IMF PortWatch shipping, and
  Deribit crypto curves. Also owns the daily cross-asset / market-brief
  workflow (今日宏观、跨资产、focus markets, A-shares + selected markets) with
  a compiler-first evidence stack (CSI/CNI, NBS, FRED/OECD; exchange day-end
  connect disclosure — not scrape-first), fact provenance fields
  (`data_type`/`quality`/`domain`/proxy — see brief-data-sources), and the
  `alice brief` structural pipeline (facts → analysis signals/certainty →
  render-analysis → editorial-check).
  Use whenever you need a macro number, a fundamental, a calendar, a
  ready-made board, or today's three cross-asset signals: "what's CPI",
  "AAPL ratios", "earnings this week", "which sectors are rotating in",
  "Suez canal traffic", "Fed balance sheet", "market brief", "今日宏观".
  Data is served hub-first (hosted TraderHub) with local fallback — no API
  keys needed. Discover flags live with `traderhub <group> <verb> --help`;
  do NOT guess flags.
---

# `traderhub` — low-frequency market data

One binary for everything that updates on hours-to-quarters cadence. Output is
JSON on stdout (pipe to `jq`); a non-zero exit = failure with the reason on
stderr.

```
traderhub <group> <verb> [--flag value]
traderhub --help                  # all groups
traderhub <group> <verb> --help   # a verb's flags
```

**Not here:** K-lines/quotes (realtime — see `alice analysis` + the
`alice-analysis` skill), collected-RSS articles (`alice rss`), trading (use
`alice-uta` — see the `alice-uta` skill).

## Reach for a BOARD before assembling primitives

Boards are the finished product — pre-aggregated, cached, one call:

```bash
traderhub board get --board macro          # 14 US macro cards (rates, CPI YoY, labor, oil, M2…)
traderhub board get --board movers         # gainers/losers/active + 4 screener lists
traderhub board get --board calendar       # earnings + IPOs + ex-dividends, 14d window
traderhub board get --board calendar --days 30
traderhub board get --board valuation      # S&P 500 PE / CAPE / yields
traderhub board get --board term-structure # BTC/ETH futures curve + annualized basis
traderhub board get --board global-macro   # 7 countries × CPI/rates/CLI/house/equity
traderhub board get --board shipping       # 6 maritime chokepoints, daily transit
traderhub board get --board fed            # balance sheet + dealer positioning + FOMC docs
traderhub board get --board cn-ashare      # CSI/CNI indexes + Stock Connect day-end (local-only)
traderhub board rotation                   # GICS sector rotation table (capital flow lens)
```

Every payload carries `meta`: `origin` ("hub" = hosted TraderHub, "local" =
this instance's own keys), `stale: true` = upstream refresh failed, you're
seeing the last good snapshot — say so if it matters to the conclusion.

## Equity fundamentals

```bash
traderhub equity profile --symbol AAPL
traderhub equity financials --symbol AAPL --type income --period annual --limit 5
traderhub equity ratios --symbol AAPL --period annual --limit 5   # ttm=include by default
traderhub equity estimates --symbol NVDA                          # analyst consensus + price targets
traderhub equity insiders --symbol NVDA --limit 20                # Form-4 transactions
traderhub equity short-interest --symbol GME                      # short shares/ratio/float %
traderhub equity earnings --start-date 2026-06-15 --end-date 2026-06-30
traderhub equity discover --list gainers                          # or: losers, active,
                                   # undervalued_growth, growth_tech, small_caps, undervalued_large
```

## ETF drilldown (the theme workflow)

Broad sectors come from `board rotation`; for a specific theme go one level
deeper:

```bash
traderhub etf search --query uranium
traderhub etf info --symbol URA
traderhub etf holdings --symbol URA       # top constituents
traderhub etf sectors --symbol XLK        # sector weights (decimal fractions)
```

## US macro series (FRED / BLS / EIA)

Workflow: **search for the series id first**, then pull observations.

```bash
traderhub economy fred-search --query "core pce"
traderhub economy fred-series --symbol PCEPILFE --limit 24    # limit = latest N
traderhub economy fred-series --symbol "GDP,UNRATE" --start-date 2020-01-01
traderhub economy fred-regional --symbol WIPCPI               # state-level cross-section
traderhub economy bls-search --query "average hourly earnings"
traderhub economy bls-series --symbol CES0500000003
traderhub economy petroleum --category crude_oil_stocks       # EIA weekly
traderhub economy energy --category retail_gasoline           # EIA short-term outlook
traderhub economy euro-bop --report-type main                 # ECB euro-area balance of payments
```

## Cross-country (OECD)

Country flag takes slugs, comma-separable:
`united_states, china, japan, germany, united_kingdom, india, brazil, france,
italy, canada, australia, south_korea`.

```bash
traderhub global cpi --country china,japan --transform yoy
traderhub global rates --country united_states --duration short
traderhub global leading --country germany          # CLI: 100 = trend, above & rising = expansion
traderhub global house --country canada             # real house price index, 2015=100
traderhub global share --country japan              # equity index, 2015=100
traderhub global retail --country united_kingdom
```

## Shipping (IMF PortWatch) / Fed / crypto curves

```bash
traderhub shipping port-search --query shanghai
traderhub shipping port-volume --port-id <id-from-search>
traderhub shipping chokepoint --name suez           # daily vessels + tonnage
traderhub fed documents                             # FOMC statements/minutes/projections links
traderhub fed balance-sheet                         # WALCL/TREAST/MBS series
traderhub fed dealers                               # primary dealer net positions (NY Fed)
traderhub crypto options --symbol BTC               # Deribit chains (BTC/ETH/PAXG)
traderhub crypto futures --symbol ETH
traderhub index search --query "S&P"                # CBOE index directory
```

## Daily market brief (cross-asset, incl. A-shares)

Use this when the user wants today's macro / sector / unusual-move signals
across markets (Chat starter「今日宏观 · 跨资产」and equivalents).

### 1. Resolve focus markets

1. Read `.alice/focus-markets.json` if it exists (Workspace-owned preference).
2. If missing, default to `cn-ashare`, `us-equity`, `hk-equity`, and `macro`.
3. Always cover `cn-ashare` for market briefs even when the file omits it.
4. Do **not** treat the browser watchlist or `.alice/settings.json` as focus
   markets.
5. Format and ids: see `references/focus-markets.md`. Offer to create
   `.alice/focus-markets.json` from that template when the user wants a
   durable selection.

### 2. Pull evidence by market (cite each origin / as-of)

Full source table and HTTP shapes: `references/brief-evidence-stack.md`.
Provenance fields (`data_type` / `quality` / `domain` / proxy):
`references/brief-data-sources.md`. **Accuracy and provenance beat coverage.**
Do not scrape Eastmoney/THS boards as primary when a compiler or agency series
exists.

**Tushare hard gate (every `cn-ashare` brief):**

1. Hit **CSI `index-perf` + CNI daily** first (see evidence stack URLs).
2. Do **not** open with Tushare `index_daily` / all-stock breadth as the tape.
3. Use any Tushare verb only after it returns real data (not `40203`). On
   无权限/限频: abandon that verb for this run, keep CSI/CNI/ETF/FRED, list the gap.
4. Cite Tushare as `via Tushare (<api>)`, never as 中证/国证/统计局/交易所官网.

| Focus id | Minimum pulls | Do not pretend |
|---|---|---|
| `macro` | `board get --board macro` (FRED rates/oil/dollar), `board get --board global-macro` (OECD; China row ≠ A-share tape), optional `board get --board fed`. CN PMI: **NBS** first; Tushare `cn_pmi` only if permitted. Prefer FRED `DTWEXBGS` over broken Yahoo DXY. | Invented release dates; near-month futures roll as “oil crash” |
| `us-equity` | `board get --board movers`, `board rotation`, optional `board get --board valuation`. US retail headlines: prefer Alice news feeds already enabled (MarketWatch/CNBC/…); if Yahoo RSS is needed from mainland China, use offshore `satellites/market-data-gateway` → `Gateway US Markets` feed / `GET /api/v1/news/headlines` (cite `yahoo-finance` or `via gateway`, quality `B`). | Direct Yahoo RSS on CN hosts (often 403) |
| `cn-ashare` | **Required:** `board get --board cn-ashare` (CSI/CNI index strip + Connect day-end). On board failure: CSI/CNI HTTP per evidence stack, then Eastmoney/Yahoo bars `count` ≥ 5. Sector proxy: industry **ETF** bars — label ETF. Optional `alice rss` if configured. | US `movers` as A-share; Tushare-first; single-candle change %; unlabeled self-computed breadth as “官方” |
| `cn-ashare` connect / flow | Prefer `board get --board cn-ashare` → `connect.sse` / `connect.szse` / `connect.hkex.*` (HKEX Historical Daily; turnover/trade count/ETF/top10). Cite as HKEX day-end — **not** 北向净流入. | `moneyflow_hsgt` as exchange official; 北向净流入 without a net-buy field |
| `cn-ashare` optional depth | Tushare only if gated probe passes: `sw_daily`, `limit_list_*`, `daily_info`, `moneyflow_*`, `cn_pmi`. | Filling flows/limit boards from memory or ±10% heuristics labeled as official |
| `hk-equity` | **Required when selected.** Index/tape via `market-data` (`alice market search-bars` / `bars`, e.g. HSI / `.HK` names, `count` ≥ 5). **Trading calendar:** prefer `alice-uta market calendar --market HK` (Longbridge `tradingDays`) or `scripts/daily-brief` `HK CALENDAR` line from `hk_calendar.py`; if `MISSING`, cite the gap and only then use HSI bar presence as post-hoc side evidence. If a Longbridge UTA is connected: optional live marks via `alice-uta contract search` → `contract quote` (cite as Longbridge quote + observation time). | Inventing HSI holiday/open from `market clock` alone; Longbridge historical K-lines (not exposed as bars in OpenAlice today); inventing HSI change % from one candle |
| `fx` / `crypto` / `commodity` | Matching bars + board cells that actually cover them | Thin coverage → name the gap |

### 3. Structured brief pipeline (`alice brief`)

Do **not** invent bp / % / spreads in prose. Persist Analysis Layer JSON, derive
in code, render a two-layer draft, then Editorial polish **without changing
semantics**. Gate with `editorial-check`.

```text
alice brief assemble … --output …/facts.json
alice brief derive … --output …/facts.derived.json
alice brief build-analysis --asof YYYY-MM-DD \
  --facts-json-file …/facts.derived.json \
  --judgments-json-file …/judgments.json \
  --data-limitations-json '["南北向资金未获得"]' \
  --output …/analysis.json
alice brief render-analysis --analysis-json-file …/analysis.json \
  --output …/report.draft.md
# Editorial Pass: rewrite presentation only — see references/editorial-style.md
#   alice brief style   # compact rules reminder
alice brief editorial-check --analysis-json-file …/analysis.json \
  --edited-file …/report.md
# publish report.md only when editorial-check ok=true
```

Legacy `alice brief render` (facts+judgments) still works; prefer
`build-analysis` + `render-analysis` for new briefs.

Rules:

1. Path under `research/briefs/<asofDate>/<runId>/` — include `analysis.json`,
   `report.draft.md`, `report.md`.
2. CLI `--output` is write-once (`wx`); on collision bump `runId`.
3. Prefer `assemble` / `derive` for numbers. Signal `certainty` grades:
   fact | derived_fact | interpretation | hypothesis | forecast | data_limitation.
4. On every observed fact set provenance when known: `data_type`, `quality`,
   `domain`; proxies need `is_proxy` + `proxy_for` (+ `source_symbol`). See
   `references/brief-data-sources.md`. Never cite concept-board flow as 北向.
5. Editorial Layer **must not upgrade certainty** or drop `data_limitations`.
6. Two-layer reading: exec「今天最重要的三个变化」+ 详细分析.
7. Named origin on every number. CSI/CNI over Yahoo/Eastmoney/Tushare when they disagree.
8. Style guide: `references/editorial-style.md` + `alice brief style`.

K-lines and chart references: `market-data`. Trading: `alice-uta`.

## Units — read before comparing numbers

- `percent_change` on movers/discover rows is a **fraction** (0.052 = +5.2%).
- `dividend_yield`, ETF `weight` are **decimal fractions** (0.012 = 1.2%).
- OECD `cpi --transform yoy` and `rates` are **percent units** (3.72 = 3.72%).
- FRED series come in the unit FRED publishes (check the series title).
- `dollar_volume` is price × volume — the only volume number comparable
  ACROSS tickers; `rvol` (volume vs its own 20d average) is the
  unusual-for-itself signal.
