# Brief data-source provenance (contract)

This file is the **field contract** for observed facts in market briefs.
Fetch order and HTTP endpoints stay in `brief-evidence-stack.md`. Alice does
**not** grow a parallel fetch engine — agents still pull via CSI/CNI/`alice
market`/`traderhub`/Tushare (gated), then lock provenance on each fact.

## Fact provenance fields

| Field | Required when | Meaning |
|---|---|---|
| `data_type` | Prefer always | Session / timing semantics (see enum below) |
| `quality` | Prefer always | `A` official agency/exchange · `B` free/vendor · `C` paid pro |
| `domain` | Prefer always | `market` \| `flow` \| `macro` \| `event` \| `calendar` \| `derived` |
| `is_proxy` | Proxy substitutes | Must be `true` when value stands in for another series |
| `proxy_for` | `is_proxy` | Canonical series id (e.g. `ICE:DXY`) |
| `source_symbol` | Proxy / vendor ticker | What was actually fetched (e.g. `UUP`, `DX-Y.NYB`) |

`caliber` remains the measurement definition string (e.g. `exchange_day_end`,
`fred_daily`, `csi_index_perf`). `source` is the named origin shown in prose.

### `data_type` enum

| Value | Use for |
|---|---|
| `official_close` | Exchange/compiler official close |
| `exchange_day_end` | Day-end disclosure (connect stats, turnover tables) |
| `intraday` | Live quote / partial session — **never** call it 收盘 in prose |
| `settlement` | Futures/options settlement |
| `session_close_utc` | UTC session close when venue close ≠ calendar local |
| `release` | Macro statistical release |
| `event` | Discrete event (earnings, policy meeting) — not a bar |
| `calendar` | Scheduled date only |
| `proxy` | Stand-in series (`is_proxy` required) |
| `derived` | Code-derived from parents |
| `unknown` | Temporary; prefer to resolve before publish |

## Hard bans (validated)

1. **Stock Connect ≠ concept board flow.** Claiming 北向/南向/沪股通/深股通/港股通
   while citing 概念/板块资金/主力净流入 / Eastmoney sector flow / THS moneyflow
   → `forbidden_connect_flow_series` error. Prefer SSE/SZSE day-end + HKEX
   Historical Daily; cite `moneyflow_hsgt` only as vendor flow with that caliber.
2. **Proxy must be labeled.** `is_proxy` without `proxy_for`, or `proxy_for`
   without `is_proxy`, or `data_type=proxy` without the flag → error. UUP for
   DXY: `is_proxy=true`, `proxy_for=ICE:DXY` (or FRED broad USD),
   `source_symbol=UUP`, `data_type=proxy`, prose must say 代理/proxy.
3. **Event/calendar ≠ official_close.** Domain `event`/`calendar` with
   `data_type=official_close` → warning.
4. **Intraday ≠ 收盘.** `data_type=intraday` plus note language about closing →
   warning.

## Quality defaults (guidance)

| Origin | Typical `quality` |
|---|---|
| CSI / CNI / NBS / SSE / SZSE / HKEX / FRED / EIA / OECD / BIS | `A` |
| Yahoo / Eastmoney bars / Longbridge live quote / Tushare redistributor | `B` |
| Paid terminal / professional feed | `C` |

Tushare remains gated (see evidence stack). Cite `via Tushare (<api>)`; never
relabel as 中证/国证/统计局/交易所官网.

## Domain separation

- Bars and index levels → `domain=market`
- Connect / board / vendor money-flow → `domain=flow`
- PMI, rates, CPI → `domain=macro` (+ `data_type=release` when applicable)
- Earnings, FOMC, policy events → `domain=event` (do not stuff into OHLCV facts)
- Scheduled dates without a printed number → `domain=calendar`

## Assemble / CLI

Pass provenance on each observation to `alice brief assemble` (JSON fields on
the observation objects). `alice brief schema` lists the fact field names.
Validate with `alice brief validate` / render gate — provenance errors block
publish the same as orphan numbers.
