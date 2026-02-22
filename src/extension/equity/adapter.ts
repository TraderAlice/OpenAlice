/**
 * Equity AI Tools
 *
 * equitySearch:
 *   为了实现正则搜索，我们在启动时从 OpenBB API 拉取全量 symbol 列表并缓存到
 *   data/cache/equity/symbols.json。搜索在本地内存中进行，不依赖 API。
 *   当前缓存的数据源（免费，不需要 API key）：
 *   - SEC (sec): ~10,000 美股上市公司，来自 SEC EDGAR
 *   - TMX (tmx): ~3,600 加拿大上市公司，来自多伦多交易所
 *   扩展方法：在 SymbolIndex 的 SOURCES 数组中添加新的 provider 即可。
 *
 * equityCalculateIndicator:
 *   量化因子计算器，支持类 Excel 公式语法。数据按需从 OpenBB API 拉取 OHLCV，不缓存。
 *   数据访问函数签名：CLOSE('symbol', 'interval')，数据量由 adapter 按 interval 决定。
 *   内置 16 个函数：CLOSE/HIGH/LOW/OPEN/VOLUME + SMA/EMA/STDEV/MAX/MIN/SUM/AVERAGE
 *   + RSI/BBANDS/MACD/ATR。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { SymbolIndex } from '@/openbb/equity/SymbolIndex'
import type { OpenBBEquityClient } from '@/openbb/equity/client'
import { EquityIndicatorCalculator } from '@/openbb/equity/indicator/calculator'
import type { EquityIndicatorContext } from '@/openbb/equity/indicator/types'
import type { EquityHistoricalData } from '@/openbb/equity/types'

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

export function createEquityTools(symbolIndex: SymbolIndex, equityClient: OpenBBEquityClient) {
  return {
    equitySearch: tool({
      description: `Search for equity symbols by regex pattern or keyword.

Matches against both ticker symbol and company name (case-insensitive).
Supports full regex syntax: "^BRK\\." for BRK.A/BRK.B, "semiconductor" for all semiconductor companies, "^AA" for all tickers starting with AA.

If the regex is invalid, falls back to simple substring matching.

Use this FIRST to find the correct symbol before querying any equity data.`,
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern or keyword to match against symbol and company name'),
        limit: z.number().int().positive().optional().describe('Max results to return (default: 20)'),
      }),
      execute: ({ pattern, limit }) => {
        const results = symbolIndex.search(pattern, limit)
        if (results.length === 0) {
          return { results: [], message: `No symbols matching "${pattern}". Try a broader pattern.` }
        }
        return { results, count: results.length }
      },
    }),

    equityCalculateIndicator: tool({
      description: `Calculate technical indicators for equities using formula expressions.

Data access: CLOSE('AAPL', '1d'), HIGH, LOW, OPEN, VOLUME — args: symbol, interval (e.g. '1d', '1w', '1h').
Statistics: SMA(data, period), EMA, STDEV, MAX, MIN, SUM, AVERAGE.
Technical: RSI(data, 14), BBANDS(data, 20, 2), MACD(data, 12, 26, 9), ATR(highs, lows, closes, 14).
Array access: CLOSE('AAPL', '1d')[-1] for latest price. Supports +, -, *, / operators.

Examples:
  SMA(CLOSE('AAPL', '1d'), 50)  — 50-day moving average
  RSI(CLOSE('TSLA', '1d'), 14)  — 14-day RSI
  BBANDS(CLOSE('MSFT', '1d'), 20, 2) — Bollinger Bands
  CLOSE('AAPL', '1d')[-1]       — latest daily close price

Use equitySearch first to resolve the correct symbol.`,
      inputSchema: z.object({
        formula: z.string().describe("Formula expression, e.g. SMA(CLOSE('AAPL', '1d'), 50)"),
        precision: z.number().int().min(0).max(10).optional().describe('Decimal places (default: 4)'),
      }),
      execute: async ({ formula, precision }) => {
        const context: EquityIndicatorContext = {
          getHistoricalData: async (symbol, interval) => {
            const calendarDays = getCalendarDays(interval)
            const startDate = new Date()
            startDate.setDate(startDate.getDate() - calendarDays)
            const start_date = startDate.toISOString().slice(0, 10)

            const results = await equityClient.getHistorical({ symbol, start_date, interval }) as EquityHistoricalData[]
            results.sort((a, b) => a.date.localeCompare(b.date))
            return results
          },
        }

        const calculator = new EquityIndicatorCalculator(context)
        return await calculator.calculate(formula, precision)
      },
    }),
  }
}
