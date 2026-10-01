# Market-brief evidence stack (accuracy first)

Prefer **compiler / statistical agency / exchange** sources over aggregator
scrapes. One field → one primary origin. Cite as-of and series id every time.

After fetch, persist observed facts and derive bp/%/spreads with
`alice brief` (see `traderhub` skill § Structured brief pipeline). This file
is the **source order** for pulls; `alice brief` is the **structure** layer.
Field-level provenance (`data_type` / `quality` / `domain` / proxy labeling,
connect-flow bans): `brief-data-sources.md`.

Eastmoney / Yahoo / Tushare are **fallback or optional depth**, never a silent
replacement for the primary. If two sources disagree, name both and keep the
primary number.

## Hard rule: Tushare is gated

Tushare is a **convenience redistributor**, not CSI / CNI / NBS / exchange
provenance. For every A-share market brief:

1. **Always attempt CSI + CNI first** (HTTP below) for index close and change %.
2. **Never** start the brief by burning Tushare `index_daily` quota, or by
   deriving “the tape” only from all-stock `daily` breadth.
3. Call a Tushare tool **only after** a successful probe that the interface
   returns data (not `40203` 无权限 / 频率超限). On failure: **stop using that
   Tushare verb for this brief**, keep CSI/CNI/ETF/FRED evidence, and list the
   gap. Do not retry the same limited endpoint in a loop.
4. When a Tushare number is used, cite it as `via Tushare (<api>)` — never as
   “中证官网” / “统计局官网” / “交易所日终披露”.
5. `moneyflow_hsgt` is **not** SSE/SZSE/HKEX day-end disclosure. Prefer
   exchange/HKEX wording (成交额、前十大). Do not call it 北向净流入 unless the
   payload literally has net buy and you name the vendor.

Breadth from all-stock daily + home-made limit-up thresholds is an **approximation**;
label it as such. Prefer `limit_list_*` when Tushare permits, else gap.

## Primary stack (free, traceable)

| Need | Primary | How (today) | Do not call it |
|---|---|---|---|
| CSI broad / industry indexes (000300, 000905, 000688, …) | **CSI** `index-perf` | HTTP GET `https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=CODE&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — OHLCV, change %, amount, sample count, PE | “A-share movers board”; Tushare-first |
| SZ / ChiNext indexes (399001, 399006, …) | **CNI** daily | HTTP GET `http://hq.cnindex.com.cn/market/market/getIndexDailyDataWithDataFormat` with `indexCode`, `startDate`, `endDate`, `frequency=day` | Yahoo-only one-bar close |
| Sector / theme proxy (A-shares) | Listed **industry ETFs** via `alice market` bars | Discover `barId`, pull ≥5–20 daily bars, compute returns; label as ETF proxy | Shenwan / THS as official unless `sw_daily`/`ths_*` permitted and cited via Tushare |
| HK indexes / names (`hk-equity`) | Yahoo / vendor **`.HK` bars** (HSI, names); optional Longbridge **live quote** | `alice market` bars with `count` ≥ 5; if Longbridge UTA connected: `alice-uta contract quote` — cite LB + observation time | Treating Longbridge as historical K-line/`barId` source (not wired in OpenAlice today) |
| HK trading calendar (`hk-equity`) | **Longbridge** `tradingDays` | Prefer `alice-uta market calendar --market HK`, or daily-brief `HK CALENDAR` from `default/skills/traderhub/scripts/hk_calendar.py` / workspace `scripts/daily-brief/hk_calendar.py` (needs `LONGPORT_*` env). Cite Longbridge; quality `B`. | Inferring holidays only from `alice-uta market clock`; treating missing HSI bars as the primary calendar |
| Northbound / connect flow | **SSE / SZSE day-end disclosure** + HKEX Historical Daily | Exchange: turnover, trade count, ETF turnover, top-10 actives after close. HKEX: [Historical Daily](https://www.hkex.com.hk/Mutual-Market/Stock-Connect/Statistics/Historical-Daily) | “北向净流入”; treating `moneyflow_hsgt` as exchange official |
| China PMI / official CN macro | **NBS** first | `https://data.stats.gov.cn/dg/website/publicrelease/web/external` — search → `cid` / indicator → `POST getEsDataByCidAndDt`; record `dt` and fetch time. Tushare `cn_pmi` only if permitted → cite via Tushare | Jin10 scrape as primary |
| US rates, oil, broad USD, cross-country | **FRED / EIA / OECD** (already in `traderhub`) | `board macro`, `board global-macro`, FRED series, EIA oil | Fragile Yahoo DXY; near-month futures roll spikes |
| CN policy rate (optional) | **BIS SDMX** `WS_CBPOL` / China | `https://stats.bis.org/api/v1` — cite PBOC via BIS | Unsourced LPR blogs |

## Fallback order (A-share indexes)

1. **Required:** CSI / CNI compiler endpoint (above) via curl/`fetch`.
2. If (1) unreachable: `alice market` Eastmoney or Yahoo bars with **`count` ≥ 5**.
3. Tushare `index_daily` **only if** already permitted and not rate-capped; never
   as the first attempt of the session’s brief.

If CSI/CNI and bars disagree by a material amount, keep CSI/CNI and footnote the bar source.

## Tushare optional depth (permission checklist)

Use only after a non-40203 response. Typical verbs:

| Verb | Use for | Still not |
|---|---|---|
| `index_daily` | Extra history / cross-check vs CSI/CNI | Replacing CSI/CNI as origin label |
| `sw_daily` / `ths_daily` | Industry index levels | Calling them CSI |
| `limit_list_d` / `limit_list_ths` | Official-ish limit boards | Home-made ±10% counts as “官方涨跌停” |
| `daily_info` | Exchange-style turnover aggregates | Inventing a single “两市合计” without source |
| `moneyflow_hsgt` | Vendor connect flow series | Exchange day-end disclosure |
| `cn_pmi` | Convenience PMI | NBS primary when NBS is reachable |

## Explicit gaps (do not invent)

- Main-force / sector **money-flow**, limit-up /炸板 / hot lists without a permitted
  Tushare (or other named) API → gap.
- Full two-exchange aggregated turnover as one Eastmoney number → prefer **SSE
  published + SZSE published** separately.
- US `movers` / GICS `board rotation` → US only, never substitute for A-shares.

## Macro calendar

Prefer NBS / State Council release schedules or stated FRED observation dates.
Do not invent holiday / data-release dates without a dated source.

## Offshore Yahoo news (optional)

Mainland hosts often cannot fetch `finance.yahoo.com` RSS (HTTP 403). Prefer
already-enabled Alice feeds (Fed, MarketWatch, CNBC, …). When Yahoo headlines
are required, run
[`satellites/market-data-gateway`](../../../../satellites/market-data-gateway/README.md)
on a JP/US VPS and point the **Gateway US Markets** news feed at
`/feeds/us-markets.xml?token=…`, or call `GET /api/v1/news/headlines`. Cite as
`yahoo-finance` / `via gateway` with `quality=B`. Do not configure an open
Yahoo URL proxy.
