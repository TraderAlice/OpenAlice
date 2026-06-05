/**
 * Yahoo Finance ETF Search Model.
 *
 * No OpenBB Python counterpart (openbb_yfinance has no etf_search). Added so
 * theme/keyword ETF lookup works keyless: FMP's etf_search hits company-screener
 * which filters by financials, not name, so "robotics" returns junk. Yahoo's
 * fuzzy search name-matches and tags ETFs via quoteType, which is exactly what
 * thematic discovery needs.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EtfSearchQueryParamsSchema, EtfSearchDataSchema } from '../../../standard-models/etf-search.js'
import { searchYahooFinance } from '../utils/helpers.js'

export const YFinanceEtfSearchQueryParamsSchema = EtfSearchQueryParamsSchema
export type YFinanceEtfSearchQueryParams = z.infer<typeof YFinanceEtfSearchQueryParamsSchema>

export const YFinanceEtfSearchDataSchema = EtfSearchDataSchema.extend({
  exchange: z.string().nullable().default(null).describe('The exchange the ETF trades on.'),
  quote_type: z.string().nullable().default(null).describe('The quote type of the asset.'),
}).passthrough()
export type YFinanceEtfSearchData = z.infer<typeof YFinanceEtfSearchDataSchema>

export class YFinanceEtfSearchFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceEtfSearchQueryParams {
    return YFinanceEtfSearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceEtfSearchQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    if (!query.query) return []

    const quotes = await searchYahooFinance(query.query)
    return quotes
      .filter((q: any) => String(q.quoteType ?? '').toUpperCase() === 'ETF')
      .map((q: any) => ({
        symbol: q.symbol ?? '',
        name: q.longname ?? q.shortname ?? null,
        exchange: q.exchDisp ?? null,
        quote_type: q.quoteType ?? null,
      }))
  }

  static override transformData(
    query: YFinanceEtfSearchQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceEtfSearchData[] {
    return data.map(d => YFinanceEtfSearchDataSchema.parse(d))
  }
}
