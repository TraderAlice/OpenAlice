/**
 * Quant Calculator v2 — MCP tool.
 *
 * barId-keyed technical analysis. Unlike `calculateIndicator` (v1, plain ticker,
 * vendor-default), v2 takes a small Python/pandas-subset *script* whose `bars()`
 * calls name an explicit source by barId — so the AI can compute on a specific
 * broker's K-lines (matching a held position's symbology) or mix sources in one
 * expression. Get barIds from `searchContracts` / `marketSearchForResearch`.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { runScript, type CalcDeps } from '@/domain/analysis/calc-v2/index'

export function createQuantTools(deps: CalcDeps) {
  return {
    searchBars: tool({
      description: `Find K-line sources for a symbol — returns barIds to paste into calculateQuant's bars(...).

Federates connected brokers, user-enabled keyless data sources (binance-readonly, …), AND vendors (fmp, yfinance).
Candidates come back freshest-first. Each carries:
  - barId: use directly, e.g. bars("<barId>", "1d", count=250).
    · broker barIds ("accountId|symbol") need NO asset= in bars().
    · vendor barIds ("provider|symbol") need asset="equity|crypto|currency|commodity".
  - source: "uta" (broker) | "vendor"
  - barCapability: "realtime" | "delayed" | "iex" | "subscription".
Source preference: a broker you actually trade (realtime, and the chart matches your fills) >
a paid vendor (fmp, …) > yfinance. yfinance is a FREE FALLBACK only — its end-of-day bars can
lag a day or two, so don't use it for anything time-sensitive or to chart a live position when
a broker source exists. The same asset appears from multiple sources (redundancy is expected);
default to the freshest broker candidate.`,
      inputSchema: z.object({
        query: z.string().describe('Symbol or keyword, e.g. "AAPL", "BTC", "bitcoin"'),
        limit: z.number().int().positive().optional().describe('Max candidates (default 20)'),
      }).meta({ examples: [{ query: 'AAPL' }] }),
      execute: async ({ query, limit }) => {
        const candidates = await deps.barService.searchBarSources(query, limit != null ? { limit } : undefined)
        return { candidates, count: candidates.length }
      },
    }),

    calculateQuant: tool({
      description: `Run a technical-analysis script over K-lines from explicit sources (barId-keyed).
Get barIds from \`searchBars\` first (or \`searchContracts\` for broker-only).

A script is one or more \`name = bars(...)\` bindings followed by a final result expression:

  s = bars("alpaca-paper|AAPL", "1d", count=250)
  sma(s.close, 50) - sma(s.close, 200)

bars(barId, interval, count=, asOf=, start=, end=, asset=):
  - barId: "{source}|{symbol}" from searchBars (broker, e.g. "alpaca-paper|AAPL";
    opt-in keyless data source, e.g. "binance-readonly|BTC/USDT"; or vendor,
    e.g. "yfinance|AAPL", "fmp|AAPL"). Prefer a broker/keyless exchange barId
    for anything time-sensitive when available — yfinance is a delayed free
    fallback (EOD bars can lag a day or two).
  - interval: "1m" "5m" "15m" "30m" "1h" "4h" "1d" "1w".
  - count=N: number of most-recent bars (the natural window for indicators).
  - asset=: REQUIRED for vendor barIds — "equity" | "crypto" | "currency" | "commodity".
    (Broker barIds infer it.)
Series columns: s.open / s.high / s.low / s.close / s.volume
Functions: sma(series, n), ema(series, n), stdev(series), max/min/sum/average/median(series),
  rsi(series, n=14), bbands(series, n, std), macd(series, fast, slow, signal),
  atr(high, low, close, n), rvol(volume, n=20), obv(close, volume),
  mfi(high, low, close, volume, n=14), vwap(high, low, close, volume),
  roc(series, n) [% change over n], zscore(series, n?) [how extended vs trailing window],
  slope(series, n) [linreg trend, signed/rankable], correlation(seriesA, seriesB) [−1..1],
  highest(series, n), lowest(series, n).
Indicators return the LATEST value directly (a scalar) — do NOT index them.
Only raw columns are series: index them with s.close[-1] (latest), s.close[-n] (n-back).
Arithmetic: + - * /.

Panels — batch many computations in ONE call (avoids calling this tool N times).
The result can be a labeled dict { "label": expr, ... } or a list [ expr, ... ].
Each entry must still be a single value (a scalar/record), max 50 entries. Use
this for multi-timeframe / multi-symbol / multi-indicator at once, e.g.:
  h1  = bars("yfinance|BTC-USD", "1h",  count=250, asset="crypto")
  h4  = bars("yfinance|BTC-USD", "4h",  count=250, asset="crypto")
  d1  = bars("yfinance|BTC-USD", "1d",  count=250, asset="crypto")
  { "1h": rsi(h1.close, 14), "4h": rsi(h4.close, 14), "1d": rsi(d1.close, 14) }
→ { "1h": 53.2, "4h": 48.9, "1d": 61.4 }

Why v2 over calculateIndicator: target a specific source ("chart what I trade"),
or compare sources in one script, e.g. basis check:
  a = bars("ibkr|265598", "1d", count=5)
  b = bars("yfinance|AAPL", "1d", count=5, asset="equity")
  a.close[-1] - b.close[-1]

Returns { value, dataRange } on success, or { error: { kind, message, suggestion } }
on failure. Most kinds are script problems — read the error and fix the script (it
pinpoints the problem). The exception is kind:"data-source": the K-line fetch itself
failed (vendor rate-limited/blocked this client, network down, or a bad barId) — that
is NOT a script bug. Do not rewrite the expression; follow the suggestion (retry later,
switch source, or fix the barId), and tell the user if data is simply unavailable.`,

      inputSchema: z.object({
        script: z.string().describe('The quant script (let-bindings + a final result expression).'),
        precision: z.number().int().min(0).max(10).optional().describe('Decimal places (default 4).'),
        dates: z.stringbool().optional().describe('Opt-in: also return each source\'s date axis (dates[barId] = ["YYYY-MM-DD", …]) so a dumped series can be mapped to dates. Off by default. For a full dated snapshot, prefer marketSnapshot.'),
      }).meta({ examples: [{ script: 's = bars("yfinance|AAPL", "1d", count=250, asset="equity")\nsma(s.close, 50)' }] }),
      execute: async ({ script, precision, dates }) => {
        return runScript(script, deps, precision ?? 4, { withDates: dates ?? false })
      },
    }),
  }
}
