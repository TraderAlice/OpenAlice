/**
 * Yahoo Finance Futures Historical Price Model.
 * Maps to: openbb_yfinance/models/futures_historical.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { FuturesHistoricalQueryParamsSchema, FuturesHistoricalDataSchema } from '../../../standard-models/futures-historical.js'
import { getHistoricalData, emptyHistoricalError } from '../utils/helpers.js'
import { INTERVALS_DICT, MONTHS } from '../utils/references.js'

export const YFinanceFuturesHistoricalQueryParamsSchema = FuturesHistoricalQueryParamsSchema.extend({
  interval: z.enum(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1W', '1M', '1Q']).default('1d').describe('Data granularity.'),
})
export type YFinanceFuturesHistoricalQueryParams = z.infer<typeof YFinanceFuturesHistoricalQueryParamsSchema>

export const YFinanceFuturesHistoricalDataSchema = FuturesHistoricalDataSchema
export type YFinanceFuturesHistoricalData = z.infer<typeof YFinanceFuturesHistoricalDataSchema>

/**
 * Format futures symbols for Yahoo Finance.
 * - If expiration is given and no "." in symbol, append month code + year + ".CME" (default exchange)
 * - If no "." and no "=F", append "=F" suffix
 * - Uppercase everything
 */
function formatFuturesSymbols(
  symbols: string[],
  expiration: string | null,
): string[] {
  const newSymbols: string[] = []

  for (const symbol of symbols) {
    let sym = symbol
    if (expiration) {
      // Parse expiration "YYYY-MM"
      const parts = expiration.split('-')
      if (parts.length >= 2) {
        const month = parseInt(parts[1], 10)
        const year = parts[0].slice(-2)
        const monthCode = MONTHS[month] ?? ''
        if (monthCode && !sym.includes('.')) {
          // Append month code + year (no exchange lookup — simplified from Python)
          sym = `${sym}${monthCode}${year}=F`
        }
      }
    }

    // Ensure proper suffix
    const upper = sym.toUpperCase()
    if (!upper.includes('.') && !upper.includes('=F')) {
      newSymbols.push(`${upper}=F`)
    } else {
      newSymbols.push(upper)
    }
  }

  return newSymbols
}

export class YFinanceFuturesHistoricalFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceFuturesHistoricalQueryParams {
    const now = new Date()
    if (!params.start_date) {
      const oneYearAgo = new Date(now)
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      params.start_date = oneYearAgo.toISOString().slice(0, 10)
    }
    if (!params.end_date) {
      params.end_date = now.toISOString().slice(0, 10)
    }

    // Format symbols
    const rawSymbols = String(params.symbol ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const expiration = params.expiration ? String(params.expiration) : null
    const formatted = formatFuturesSymbols(rawSymbols, expiration)
    params.symbol = formatted.join(',')

    return YFinanceFuturesHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceFuturesHistoricalQueryParams,
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

    if (!allData.length) throw emptyHistoricalError(results, 'No futures historical data returned')
    return allData
  }

  static override transformData(
    query: YFinanceFuturesHistoricalQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceFuturesHistoricalData[] {
    return data.map(d => YFinanceFuturesHistoricalDataSchema.parse(d))
  }
}
