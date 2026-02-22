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
 *   量化因子计算器，支持类 Excel 公式语法。数据按需从 OpenBB API 拉取日级别 OHLCV，
 *   不缓存。lookback 参数为交易日数，内部转换为日历日期调用 getHistorical。
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

Data access: CLOSE('AAPL', 252), HIGH, LOW, OPEN, VOLUME — first arg is symbol, second is lookback in trading days.
Statistics: SMA(data, period), EMA, STDEV, MAX, MIN, SUM, AVERAGE.
Technical: RSI(data, 14), BBANDS(data, 20, 2), MACD(data, 12, 26, 9), ATR(highs, lows, closes, 14).
Array access: CLOSE('AAPL', 10)[-1] for latest price. Supports +, -, *, / operators.

Examples:
  SMA(CLOSE('AAPL', 252), 50)  — 50-day moving average
  RSI(CLOSE('TSLA', 50), 14)   — 14-day RSI
  BBANDS(CLOSE('MSFT', 100), 20, 2) — Bollinger Bands
  (CLOSE('AAPL', 1)[0] - SMA(CLOSE('AAPL', 252), 50)) / SMA(CLOSE('AAPL', 252), 50) * 100 — % deviation from 50-MA

Use equitySearch first to resolve the correct symbol.`,
      inputSchema: z.object({
        formula: z.string().describe("Formula expression, e.g. SMA(CLOSE('AAPL', 252), 50)"),
        precision: z.number().int().min(0).max(10).optional().describe('Decimal places (default: 4)'),
      }),
      execute: async ({ formula, precision }) => {
        const context: EquityIndicatorContext = {
          getHistoricalData: async (symbol, lookback) => {
            // lookback = 交易日数，转换为日历日（×1.5 + buffer 覆盖周末和节假日）
            const calendarDays = Math.ceil(lookback * 1.5) + 10
            const startDate = new Date()
            startDate.setDate(startDate.getDate() - calendarDays)
            const start_date = startDate.toISOString().slice(0, 10)

            const results = await equityClient.getHistorical({ symbol, start_date }) as EquityHistoricalData[]
            // 按日期升序排列，取最后 lookback 条
            results.sort((a, b) => a.date.localeCompare(b.date))
            return results.slice(-lookback)
          },
        }

        const calculator = new EquityIndicatorCalculator(context)
        return await calculator.calculate(formula, precision)
      },
    }),
  }
}
