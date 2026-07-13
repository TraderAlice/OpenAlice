/**
 * Yahoo Finance Equity Search Model.
 *
 * Online fuzzy symbol search via Yahoo's /v1/finance/search endpoint. Unlike the
 * SEC-backed local SymbolIndex (US-only), this reaches global exchanges — China
 * A-shares (600519.SS / 000001.SZ), Taiwan (2330.TW), Vietnam (VIC.VN), HK, etc.
 * The returned `symbol` is Yahoo's own ticker, so it feeds straight back into
 * EquityHistorical to pull bars — discovery and quote share one namespace.
 *
 * Yahoo only matches Latin/pinyin company names (a CJK query like "茅台" returns
 * nothing); we deliberately leave that to the AI caller, which knows
 * 茅台 = Kweichow Moutai = 600519.SS.
 *
 * Maps to: openbb_yfinance equity search (Yahoo search quotes, EQUITY only).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquitySearchQueryParamsSchema, EquitySearchDataSchema } from '../../../standard-models/equity-search.js'
import { searchYahooFinance } from '../utils/helpers.js'

export const YFinanceEquitySearchQueryParamsSchema = EquitySearchQueryParamsSchema
export type YFinanceEquitySearchQueryParams = z.infer<typeof YFinanceEquitySearchQueryParamsSchema>

export const YFinanceEquitySearchDataSchema = EquitySearchDataSchema.extend({
  exchange: z.string().nullable().default(null).describe('The exchange the security trades on.'),
  quote_type: z.string().nullable().default(null).describe('The quote type of the asset.'),
}).passthrough()
export type YFinanceEquitySearchData = z.infer<typeof YFinanceEquitySearchDataSchema>

export class YFinanceEquitySearchFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceEquitySearchQueryParams {
    return YFinanceEquitySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceEquitySearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    if (!query.query) return []

    const quotes = await searchYahooFinance(query.query)
    return quotes
      .filter((q: any) => q.quoteType === 'EQUITY')
      .map((q: any) => ({
        symbol: q.symbol ?? '',
        name: q.longname ?? q.shortname ?? null,
        exchange: q.exchDisp ?? null,
        quote_type: q.quoteType ?? null,
      }))
      .filter((q) => q.symbol)
  }

  static override transformData(
    query: YFinanceEquitySearchQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceEquitySearchData[] {
    return data.map(d => YFinanceEquitySearchDataSchema.parse(d))
  }
}
