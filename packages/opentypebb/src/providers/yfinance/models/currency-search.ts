/**
 * Yahoo Finance Currency Search Model.
 * Maps to: openbb_yfinance/models/currency_search.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CurrencyPairsQueryParamsSchema, CurrencyPairsDataSchema } from '../../../standard-models/currency-pairs.js'
import { searchYahooFinance } from '../utils/helpers.js'

export const YFinanceCurrencySearchQueryParamsSchema = CurrencyPairsQueryParamsSchema
export type YFinanceCurrencySearchQueryParams = z.infer<typeof YFinanceCurrencySearchQueryParamsSchema>

export const YFinanceCurrencySearchDataSchema = CurrencyPairsDataSchema.extend({
  exchange: z.string().nullable().default(null).describe('The exchange the currency pair trades on.'),
  quote_type: z.string().nullable().default(null).describe('The quote type of the asset.'),
}).passthrough()
export type YFinanceCurrencySearchData = z.infer<typeof YFinanceCurrencySearchDataSchema>

export class YFinanceCurrencySearchFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceCurrencySearchQueryParams {
    return YFinanceCurrencySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceCurrencySearchQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    if (!query.query) return []

    const quotes = await searchYahooFinance(query.query)
    return quotes
      .filter((q: any) => q.quoteType === 'CURRENCY')
      .map((q: any) => ({
        // Yahoo abbreviates USD-base pairs, e.g. JPY=X means USD/JPY.
        symbol: (q.symbol ?? '').replace('=X', '').replace(/^([A-Z]{3})$/, 'USD$1'),
        name: q.longname ?? q.shortname ?? null,
        exchange: q.exchDisp ?? null,
        quote_type: q.quoteType ?? null,
      }))
  }

  static override transformData(
    query: YFinanceCurrencySearchQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceCurrencySearchData[] {
    return data.map(d => YFinanceCurrencySearchDataSchema.parse(d))
  }
}
