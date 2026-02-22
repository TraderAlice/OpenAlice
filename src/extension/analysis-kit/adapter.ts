/**
 * Analysis Kit — 统一量化因子计算工具
 *
 * 通过 asset 参数区分资产类别（equity/crypto/currency），
 * 公式语法完全一样：CLOSE('AAPL', '1d')、SMA(...)、RSI(...) 等。
 * 数据按需从 OpenBB API 拉取 OHLCV，不缓存。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { OpenBBEquityClient } from '@/openbb/equity/client'
import type { OpenBBCryptoClient } from '@/openbb/crypto/client'
import type { OpenBBCurrencyClient } from '@/openbb/currency/client'
import { IndicatorCalculator } from './indicator/calculator'
import type { IndicatorContext, OhlcvData } from './indicator/types'

/** 根据 interval 决定拉取的日历天数（约 1 倍冗余） */
function getCalendarDays(interval: string): number {
  const match = interval.match(/^(\d+)([dwhm])$/)
  if (!match) return 365 // fallback: 1 年

  const n = parseInt(match[1])
  const unit = match[2]

  switch (unit) {
    case 'd': return n * 730   // 日线：2 年
    case 'w': return n * 1825  // 周线：5 年
    case 'h': return n * 90    // 小时线：90 天
    case 'm': return n * 30    // 分钟线：30 天
    default:  return 365
  }
}

function buildStartDate(interval: string): string {
  const calendarDays = getCalendarDays(interval)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - calendarDays)
  return startDate.toISOString().slice(0, 10)
}

function buildContext(
  asset: 'equity' | 'crypto' | 'currency',
  equityClient: OpenBBEquityClient,
  cryptoClient: OpenBBCryptoClient,
  currencyClient: OpenBBCurrencyClient,
): IndicatorContext {
  return {
    getHistoricalData: async (symbol, interval) => {
      const start_date = buildStartDate(interval)

      let results: OhlcvData[]
      switch (asset) {
        case 'equity':
          results = await equityClient.getHistorical({ symbol, start_date, interval }) as OhlcvData[]
          break
        case 'crypto':
          results = await cryptoClient.getHistorical({ symbol, start_date, interval }) as OhlcvData[]
          break
        case 'currency':
          results = await currencyClient.getHistorical({ symbol, start_date, interval }) as OhlcvData[]
          break
      }

      results.sort((a, b) => a.date.localeCompare(b.date))
      return results
    },
  }
}

export function createAnalysisTools(
  equityClient: OpenBBEquityClient,
  cryptoClient: OpenBBCryptoClient,
  currencyClient: OpenBBCurrencyClient,
) {
  return {
    calculateIndicator: tool({
      description: `Calculate technical indicators for any asset (equity, crypto, currency) using formula expressions.

Asset classes: "equity" for stocks, "crypto" for cryptocurrencies, "currency" for forex pairs.

Data access: CLOSE('AAPL', '1d'), HIGH, LOW, OPEN, VOLUME — args: symbol, interval (e.g. '1d', '1w', '1h').
Statistics: SMA(data, period), EMA, STDEV, MAX, MIN, SUM, AVERAGE.
Technical: RSI(data, 14), BBANDS(data, 20, 2), MACD(data, 12, 26, 9), ATR(highs, lows, closes, 14).
Array access: CLOSE('AAPL', '1d')[-1] for latest price. Supports +, -, *, / operators.

Examples:
  asset="equity":   SMA(CLOSE('AAPL', '1d'), 50)
  asset="crypto":   RSI(CLOSE('BTCUSD', '1d'), 14)
  asset="currency": CLOSE('EURUSD', '1d')[-1]

Use the corresponding search tool first to resolve the correct symbol.`,
      inputSchema: z.object({
        asset: z.enum(['equity', 'crypto', 'currency']).describe('Asset class'),
        formula: z.string().describe("Formula expression, e.g. SMA(CLOSE('AAPL', '1d'), 50)"),
        precision: z.number().int().min(0).max(10).optional().describe('Decimal places (default: 4)'),
      }),
      execute: async ({ asset, formula, precision }) => {
        const context = buildContext(asset, equityClient, cryptoClient, currencyClient)
        const calculator = new IndicatorCalculator(context)
        return await calculator.calculate(formula, precision)
      },
    }),
  }
}
