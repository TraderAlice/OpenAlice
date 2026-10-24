/**
 * FXMacroData Currency Historical Model.
 *
 * Daily official reference rates (central-bank fixings), not traded candles:
 * `close` is the day's reference rate and open/high/low/volume stay null.
 * Requires an API key.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import {
  CurrencyHistoricalQueryParamsSchema,
  CurrencyHistoricalDataSchema,
} from '../../../standard-models/currency-historical.js'
import { EmptyDataError, OpenBBError } from '../../../core/provider/utils/errors.js'
import { fxmdGetAllPages, getApiKey, FXMD_CURRENCIES } from '../utils/helpers.js'

export const FXMDCurrencyHistoricalQueryParamsSchema = CurrencyHistoricalQueryParamsSchema
export type FXMDCurrencyHistoricalQueryParams = z.infer<typeof FXMDCurrencyHistoricalQueryParamsSchema>

export const FXMDCurrencyHistoricalDataSchema = CurrencyHistoricalDataSchema.extend({
  close: z.number().describe('Official reference rate for the date.'),
  symbol: z.string().nullable().default(null).describe('Currency pair, e.g. EURUSD.'),
}).passthrough()
export type FXMDCurrencyHistoricalData = z.infer<typeof FXMDCurrencyHistoricalDataSchema>

interface ForexResponse {
  data?: Record<string, unknown>[]
  pagination?: { has_more?: boolean }
}

/** "EURUSD" / "EUR/USD" → ["EUR", "USD"]. */
export function parsePair(symbol: string): [string, string] {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, '')
  const base = s.slice(0, 3)
  const quote = s.slice(3)
  if (s.length !== 6 || !FXMD_CURRENCIES[base] || !FXMD_CURRENCIES[quote]) {
    throw new OpenBBError(`FXMacroData does not cover the pair '${symbol}'.`)
  }
  return [base, quote]
}

export class FXMDCurrencyHistoricalFetcher extends Fetcher {
  static override requireCredentials = true

  static override transformQuery(params: Record<string, unknown>): FXMDCurrencyHistoricalQueryParams {
    return FXMDCurrencyHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FXMDCurrencyHistoricalQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getApiKey(credentials)
    const results: Record<string, unknown>[] = []
    for (const symbol of query.symbol.split(',').map(s => s.trim()).filter(Boolean)) {
      const [base, quote] = parsePair(symbol)
      const { rows } = await fxmdGetAllPages<ForexResponse>(
        `/forex/${base.toLowerCase()}/${quote.toLowerCase()}`,
        { start_date: query.start_date, end_date: query.end_date },
        apiKey,
      )
      for (const row of rows) {
        if (typeof row.val !== 'number' || !row.date) continue
        results.push({ date: row.date, close: row.val, symbol: `${base}${quote}` })
      }
    }
    if (results.length === 0) throw new EmptyDataError('No FXMacroData reference rates found.')
    return results
  }

  static override transformData(
    _query: FXMDCurrencyHistoricalQueryParams,
    data: Record<string, unknown>[],
  ): FXMDCurrencyHistoricalData[] {
    return data
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.symbol).localeCompare(String(b.symbol)))
      .map(d => FXMDCurrencyHistoricalDataSchema.parse(d))
  }
}
