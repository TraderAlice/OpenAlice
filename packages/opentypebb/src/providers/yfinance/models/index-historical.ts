/**
 * Yahoo Finance Index Historical Model.
 * Maps to: openbb_yfinance/models/index_historical.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { IndexHistoricalQueryParamsSchema, IndexHistoricalDataSchema } from '../../../standard-models/index-historical.js'
import { getHistoricalData, emptyHistoricalError } from '../utils/helpers.js'
import { INTERVALS_DICT, INDICES } from '../utils/references.js'

export const YFinanceIndexHistoricalQueryParamsSchema = IndexHistoricalQueryParamsSchema.extend({
  interval: z.enum(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1W', '1M', '1Q']).default('1d').describe('Data granularity.'),
})
export type YFinanceIndexHistoricalQueryParams = z.infer<typeof YFinanceIndexHistoricalQueryParamsSchema>

export const YFinanceIndexHistoricalDataSchema = IndexHistoricalDataSchema
export type YFinanceIndexHistoricalData = z.infer<typeof YFinanceIndexHistoricalDataSchema>

/**
 * Resolve a user-supplied index code/name/symbol to a Yahoo Finance ticker.
 * Checks in order: code match, name match, ^SYMBOL match, raw SYMBOL match.
 */
function resolveIndexSymbol(input: string): string | null {
  const lower = input.toLowerCase()
  const upper = input.toUpperCase()

  // Check by code (e.g. "sp500" → "^GSPC")
  if (INDICES[lower]) {
    return INDICES[lower].ticker
  }

  // Check by name (title case, e.g. "S&P 500 Index")
  const titleCase = input.charAt(0).toUpperCase() + input.slice(1).toLowerCase()
  for (const entry of Object.values(INDICES)) {
    if (entry.name === titleCase) {
      return entry.ticker
    }
  }

  // Check if ^SYMBOL is a known ticker
  const caretSymbol = '^' + upper
  for (const entry of Object.values(INDICES)) {
    if (entry.ticker === caretSymbol) {
      return caretSymbol
    }
  }

  // Check if SYMBOL itself is a known ticker
  for (const entry of Object.values(INDICES)) {
    if (entry.ticker === upper) {
      return upper
    }
  }

  return null
}

export class YFinanceIndexHistoricalFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceIndexHistoricalQueryParams {
    const now = new Date()
    if (!params.start_date) {
      const oneYearAgo = new Date(now)
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      params.start_date = oneYearAgo.toISOString().slice(0, 10)
    }
    if (!params.end_date) {
      params.end_date = now.toISOString().slice(0, 10)
    }

    // Resolve index symbols
    const rawSymbols = String(params.symbol ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const resolvedSymbols: string[] = []
    for (const sym of rawSymbols) {
      const resolved = resolveIndexSymbol(sym)
      if (resolved) {
        resolvedSymbols.push(resolved)
      }
      // Skip unresolved symbols (matches Python's warn + skip behavior)
    }

    if (resolvedSymbols.length === 0) {
      // If none resolved, try using the raw symbols as-is (fallback)
      params.symbol = rawSymbols.join(',')
    } else {
      params.symbol = resolvedSymbols.join(',')
    }

    return YFinanceIndexHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceIndexHistoricalQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    const interval = INTERVALS_DICT[query.interval] ?? '1d'

    const allData: Record<string, unknown>[] = []
    const results = await Promise.allSettled(
      symbols.map(async (sym) => {
        const data = await getHistoricalData(sym, {
          startDate: query.start_date,
          endDate: query.end_date,
          interval,
        })
        return data.map(d => ({ ...d, symbol: sym }))
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') allData.push(...r.value)
    }

    if (!allData.length) throw emptyHistoricalError(results, 'No index historical data returned')
    return allData
  }

  static override transformData(
    query: YFinanceIndexHistoricalQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceIndexHistoricalData[] {
    return data.map(d => YFinanceIndexHistoricalDataSchema.parse(d))
  }
}
