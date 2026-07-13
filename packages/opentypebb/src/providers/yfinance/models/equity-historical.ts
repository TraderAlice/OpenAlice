/**
 * Yahoo Finance Equity Historical Price Model.
 * Maps to: openbb_yfinance/models/equity_historical.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityHistoricalQueryParamsSchema, EquityHistoricalDataSchema } from '../../../standard-models/equity-historical.js'
import { getHistoricalData, emptyHistoricalError } from '../utils/helpers.js'
import { INTERVALS_DICT } from '../utils/references.js'

export const YFinanceEquityHistoricalQueryParamsSchema = EquityHistoricalQueryParamsSchema.extend({
  interval: z.enum(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1W', '1M', '1Q']).default('1d').describe('Data granularity.'),
  extended_hours: z.boolean().default(false).describe('Include Pre and Post market data.'),
  include_actions: z.boolean().default(true).describe('Include dividends and stock splits in results.'),
  adjustment: z.enum(['splits_only', 'splits_and_dividends']).default('splits_only').describe('The adjustment factor to apply.'),
})
export type YFinanceEquityHistoricalQueryParams = z.infer<typeof YFinanceEquityHistoricalQueryParamsSchema>

export const YFinanceEquityHistoricalDataSchema = EquityHistoricalDataSchema.extend({
  split_ratio: z.number().nullable().default(null).describe('Ratio of the equity split, if a split occurred.'),
  dividend: z.number().nullable().default(null).describe('Dividend amount (split-adjusted), if a dividend was paid.'),
}).passthrough()
export type YFinanceEquityHistoricalData = z.infer<typeof YFinanceEquityHistoricalDataSchema>

export class YFinanceEquityHistoricalFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceEquityHistoricalQueryParams {
    const now = new Date()
    if (!params.start_date) {
      const oneYearAgo = new Date(now)
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      params.start_date = oneYearAgo.toISOString().slice(0, 10)
    }
    if (!params.end_date) {
      params.end_date = now.toISOString().slice(0, 10)
    }
    return YFinanceEquityHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceEquityHistoricalQueryParams,
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

    if (!allData.length) throw emptyHistoricalError(results, 'No historical data returned')
    return allData
  }

  static override transformData(
    query: YFinanceEquityHistoricalQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceEquityHistoricalData[] {
    return data.map(d => YFinanceEquityHistoricalDataSchema.parse(d))
  }
}
