/**
 * Analysis Kit — 统一量化因子计算工具
 *
 * 通过 asset 参数区分资产类别（equity/crypto/currency），
 * 公式语法完全一样：CLOSE('AAPL', '1d')、SMA(...)、RSI(...) 等。
 * 数据按需从 OpenBB API 拉取 OHLCV，不缓存。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService } from '@/domain/market-data/bars/index'
import { IndicatorCalculator } from '@/domain/analysis/indicator/calculator'
import type { IndicatorContext, HistoricalDataResult } from '@/domain/analysis/indicator/types'

/**
 * Build the indicator context over the federated bar service. v1 keeps its
 * plain-symbol / vendor-default contract (the AI still writes `CLOSE('AAPL','1d')`
 * and passes `asset`); the federation resolves transparently and the returned
 * `meta` reports the actual source (UTA vs vendor). Window heuristics + null
 * filtering now live in the bar service.
 */
function buildContext(
  asset: 'equity' | 'crypto' | 'currency' | 'commodity',
  barService: BarService,
): IndicatorContext {
  return {
    getHistoricalData: async (symbol, interval): Promise<HistoricalDataResult> => {
      const { bars, meta } = await barService.getBars({ symbol, assetClass: asset }, { interval })
      return { data: bars, meta }
    },
  }
}

export function createAnalysisTools(barService: BarService) {
  return {
    calculateIndicator: tool({
      description: `Calculate technical indicators by ticker (vendor data, auto-selected — typically yfinance, whose end-of-day bars can lag a day or two). Quick path for "what's AAPL's RSI" when freshness doesn't matter.

For anything you trade, or anything time-sensitive, prefer **calculateQuant** — it's barId-keyed, so you can target a broker's realtime K-lines (matching a held position's symbology) or mix sources in one expression. This tool (calculateIndicator) is the simpler vendor-default path: plain ticker + asset class, no barId. Note the syntax differs: HERE functions are UPPERCASE in a formula string (SMA(CLOSE('AAPL','1d'),50)); calculateQuant uses a lowercase pandas-style script (sma(s.close, 50)).

Asset classes: "equity" for stocks, "crypto" for cryptocurrencies, "currency" for forex pairs, "commodity" for commodities (use canonical names: gold, crude_oil, copper, etc.).

Data access (returns array — use [-1] for latest value):
  CLOSE('AAPL', '1d'), HIGH, LOW, OPEN, VOLUME — args: symbol, interval (e.g. '1d', '1w', '1h').
  CLOSE('AAPL', '1d')[-1] → latest close price as a single number.

Statistics (returns a single number — do NOT use [-1]):
  SMA(data, period), EMA, STDEV, MAX, MIN, SUM, AVERAGE.

Technical — trend / momentum (returns a single number or object — do NOT use [-1]):
  RSI(data, 14) → number.  BBANDS(data, 20, 2) → {upper, middle, lower}.
  MACD(data, 12, 26, 9) → {macd, signal, histogram}.  ATR(highs, lows, closes, 14) → number.

Technical — volume / right-side confirmation (returns a single number):
  RVOL(VOLUME(...), 20) → relative volume: latest bar vs its 20-bar average. >1 = heavier than usual; 2-3+ on a move = volume-confirmed. The right way to read volume — raw VOLUME is not comparable across tickers.
  OBV(CLOSE(...), VOLUME(...)) → on-balance volume (accumulation/distribution).
  MFI(HIGH(...), LOW(...), CLOSE(...), VOLUME(...), 14) → money-flow index, 0-100 (volume-weighted RSI).
  VWAP(HIGH(...), LOW(...), CLOSE(...), VOLUME(...)) → volume-weighted average price; price above it = buyers in control.

Arithmetic: +, -, *, / operators between numbers. E.g. CLOSE(...)[-1] - SMA(..., 50).
Note: arithmetic needs scalars on both sides, so reduce a series with [-1] or a function first — e.g. RVOL via formula is VOLUME(...)[-1] / SMA(VOLUME(...), 20), or just call RVOL(VOLUME(...), 20).

Examples:
  SMA(CLOSE('AAPL', '1d'), 50)              → equity 50-day moving average
  RSI(CLOSE('BTCUSD', '1d'), 14)            → crypto RSI (single number, no [-1])
  RVOL(VOLUME('AAPL', '1d'), 20)            → is AAPL trading on unusual volume today?
  VWAP(HIGH('TSLA','1d'), LOW('TSLA','1d'), CLOSE('TSLA','1d'), VOLUME('TSLA','1d'))
  CLOSE('gold', '1d')[-1]                   → latest gold price (canonical name)

Returns { value, dataRange } where dataRange shows the actual date span of the data used.
Use marketSearchForResearch to find the correct symbol first.`,
      inputSchema: z.object({
        asset: z.enum(['equity', 'crypto', 'currency', 'commodity']).describe('Asset class'),
        formula: z.string().describe("Formula expression, e.g. SMA(CLOSE('AAPL', '1d'), 50)"),
        precision: z.number().int().min(0).max(10).optional().describe('Decimal places (default: 4)'),
      }).meta({ examples: [{ asset: 'equity', formula: "SMA(CLOSE('AAPL', '1d'), 50)" }] }),
      execute: async ({ asset, formula, precision }) => {
        const context = buildContext(asset, barService)
        const calculator = new IndicatorCalculator(context)
        return await calculator.calculate(formula, precision)
      },
    }),
  }
}
