/**
 * OANDA v20 Currency Price Model.
 * Maps to: openbb_oanda/models/currency_historical.py
 *
 * Realtime/broker-fresh candles for FX pairs (EUR_GBP, EUR_USD, …) and
 * metals from the practice (paper) host. Data-only — research use
 * (Maven is MT5-only and prohibits automation).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CurrencyHistoricalQueryParamsSchema, CurrencyHistoricalDataSchema } from '../../../standard-models/currency-historical.js'
import {
  INTERVAL_GRANULARITY,
  candleToHistorical,
  estimateCandleCount,
  getOandaCandles,
  normalizeOandaSymbol,
} from '../utils/helpers.js'

export const OandaCurrencyHistoricalQueryParamsSchema = CurrencyHistoricalQueryParamsSchema.extend({
  interval: z.enum(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '4h', '1d', '5d', '1W', '1M', '1Q']).default('1d').describe('Data granularity.'),
})
export type OandaCurrencyHistoricalQueryParams = z.infer<typeof OandaCurrencyHistoricalQueryParamsSchema> & {
  /** OANDA v20 granularity mapped from the OpenAlice interval (kept on the
   *  parsed query so extractData reads one canonical value). */
  granularity?: string
}

export const OandaCurrencyHistoricalDataSchema = CurrencyHistoricalDataSchema
export type OandaCurrencyHistoricalData = z.infer<typeof OandaCurrencyHistoricalDataSchema>

export class OandaCurrencyHistoricalFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): OandaCurrencyHistoricalQueryParams {
    const now = new Date()
    if (typeof params.symbol === 'string') {
      params.symbol = normalizeOandaSymbol(params.symbol)
    }
    if (!params.start_date) {
      const oneYearAgo = new Date(now)
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      params.start_date = oneYearAgo.toISOString().slice(0, 10)
    }
    if (!params.end_date) {
      params.end_date = now.toISOString().slice(0, 10)
    }
    const parsed = OandaCurrencyHistoricalQueryParamsSchema.parse(params)
    return { ...parsed, granularity: INTERVAL_GRANULARITY[parsed.interval] ?? 'D' }
  }

  static override async extractData(
    query: OandaCurrencyHistoricalQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const granularity = query.granularity ?? INTERVAL_GRANULARITY[query.interval] ?? 'D'
    const count = estimateCandleCount(granularity, query.start_date, query.end_date)
    const candles = await getOandaCandles(credentials, query.symbol, granularity, count)

    const start = query.start_date
    const end = query.end_date
    return candles
      .filter((c) => {
        if (!c.time) return false
        const day = c.time.slice(0, 10)
        if (start && day < start) return false
        if (end && day > end) return false
        return true
      })
      .map(candleToHistorical)
  }

  static override transformData(
    query: OandaCurrencyHistoricalQueryParams,
    data: Record<string, unknown>[],
  ): OandaCurrencyHistoricalData[] {
    return data.map(d => OandaCurrencyHistoricalDataSchema.parse(d))
  }
}
