/**
 * YFinance Equity Quote Model.
 * Maps to: openbb_yfinance/models/equity_quote.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityQuoteQueryParamsSchema, EquityQuoteDataSchema } from '../../../standard-models/equity-quote.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getQuoteSummary } from '../utils/helpers.js'

// yahoo-finance2 returns regularMarket* field names (already flattened)
// NOTE: 'exchange' is NOT aliased — the flattened data already has `exchange: "NMS"` (short code).
// Aliasing from `exchangeName` would overwrite it with the long name ("NasdaqGS").
const ALIAS_DICT: Record<string, string> = {
  name: 'longName',
  asset_type: 'quoteType',
  last_price: 'regularMarketPrice',
  high: 'regularMarketDayHigh',
  low: 'regularMarketDayLow',
  open: 'regularMarketOpen',
  volume: 'regularMarketVolume',
  prev_close: 'regularMarketPreviousClose',
  change: 'regularMarketChange',
  change_percent: 'regularMarketChangePercent',
  last_timestamp: 'regularMarketTime',
  year_high: 'fiftyTwoWeekHigh',
  year_low: 'fiftyTwoWeekLow',
  // ma50 / ma200 match the canonical names used by FMP; keeps cross-provider
  // consumers free of per-provider key guessing.
  ma50: 'fiftyDayAverage',
  ma200: 'twoHundredDayAverage',
  market_cap: 'marketCap',
  volume_average: 'averageVolume',
  volume_average_10d: 'averageDailyVolume10Day',
  bid_size: 'bidSize',
  ask_size: 'askSize',
  currency: 'currency',
}

export const YFinanceEquityQuoteQueryParamsSchema = EquityQuoteQueryParamsSchema
export type YFinanceEquityQuoteQueryParams = z.infer<typeof YFinanceEquityQuoteQueryParamsSchema>

export const YFinanceEquityQuoteDataSchema = EquityQuoteDataSchema.extend({
  ma50: z.number().nullable().default(null).describe('50-day moving average price.'),
  ma200: z.number().nullable().default(null).describe('200-day moving average price.'),
  market_cap: z.number().nullable().default(null).describe('Market capitalization of the company.'),
  volume_average: z.number().nullable().default(null).describe('Average daily trading volume.'),
  volume_average_10d: z.number().nullable().default(null).describe('Average daily trading volume in the last 10 days.'),
  currency: z.string().nullable().default(null).describe('Currency of the price.'),
}).strip()
export type YFinanceEquityQuoteData = z.infer<typeof YFinanceEquityQuoteDataSchema>

export class YFinanceEquityQuoteFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceEquityQuoteQueryParams {
    return YFinanceEquityQuoteQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceEquityQuoteQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    const results = await Promise.allSettled(
      symbols.map(s => getQuoteSummary(s, ['price', 'summaryDetail', 'defaultKeyStatistics']))
    )
    const data: Record<string, unknown>[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        data.push(r.value)
      } else if (r.status === 'rejected') {
        console.error(`[equity-quote] Failed for symbol: ${r.reason?.message ?? r.reason}`)
      }
    }
    return data
  }

  static override transformData(
    query: YFinanceEquityQuoteQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceEquityQuoteData[] {
    if (!data.length) throw new EmptyDataError('No quote data returned')
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      // yahoo-finance2 returns bidSize/askSize in lots (hundreds), normalize to board lots
      if (typeof aliased.bid_size === 'number') aliased.bid_size = Math.round(aliased.bid_size / 100)
      if (typeof aliased.ask_size === 'number') aliased.ask_size = Math.round(aliased.ask_size / 100)
      return YFinanceEquityQuoteDataSchema.parse(aliased)
    })
  }
}
