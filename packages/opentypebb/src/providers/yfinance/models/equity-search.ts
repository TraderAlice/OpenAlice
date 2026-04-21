/**
 * Yahoo Finance Equity Search Model.
 *
 * Uses Yahoo Finance's search endpoint and optionally filters results toward a
 * market/exchange. This fills the gap where yfinance had quote/historical
 * support for symbols like GGAL.BA, but no equity discovery path.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquitySearchQueryParamsSchema, EquitySearchDataSchema } from '../../../standard-models/equity-search.js'
import { searchYahooFinance } from '../utils/helpers.js'

export const YFinanceEquitySearchQueryParamsSchema = EquitySearchQueryParamsSchema.extend({
  market: z.string().optional().describe('Optional market hint, e.g. "argentina", "merval", "byma".'),
  country: z.string().optional().describe('Optional country hint, e.g. "AR" or "argentina".'),
  exchange: z.string().optional().describe('Optional exchange hint, e.g. "BYMA" or "Buenos Aires".'),
  limit: z.number().int().positive().optional().describe('Maximum number of results to return.'),
}).passthrough()
export type YFinanceEquitySearchQueryParams = z.infer<typeof YFinanceEquitySearchQueryParamsSchema>

export const YFinanceEquitySearchDataSchema = EquitySearchDataSchema.extend({
  exchange: z.string().nullable().default(null).describe('Exchange code.'),
  exchange_name: z.string().nullable().default(null).describe('Exchange display name.'),
  quote_type: z.string().nullable().default(null).describe('Yahoo Finance quote type.'),
  type_disp: z.string().nullable().default(null).describe('Yahoo Finance display type.'),
  native_symbol: z.string().nullable().default(null).describe('Native exchange ticker without Yahoo suffix.'),
  market: z.string().nullable().default(null).describe('Inferred market.'),
}).passthrough()
export type YFinanceEquitySearchData = z.infer<typeof YFinanceEquitySearchDataSchema>

export class YFinanceEquitySearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFinanceEquitySearchQueryParams {
    return YFinanceEquitySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceEquitySearchQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    if (!query.query) return []

    const quotes = await searchYahooFinance(query.query)
    const filtered = quotes
      .filter((q) => isEquityQuote(q))
      .filter((q) => matchesMarket(q, query))
      .map((q) => mapQuote(q))

    return query.limit ? filtered.slice(0, query.limit) : filtered
  }

  static override transformData(
    query: YFinanceEquitySearchQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceEquitySearchData[] {
    return data.map(d => YFinanceEquitySearchDataSchema.parse(d))
  }
}

function isEquityQuote(q: Record<string, unknown>): boolean {
  const quoteType = String(q.quoteType ?? '').toUpperCase()
  return quoteType === 'EQUITY' || quoteType === 'ETF'
}

function matchesMarket(q: Record<string, unknown>, query: YFinanceEquitySearchQueryParams): boolean {
  const hints = [query.market, query.country, query.exchange]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.toLowerCase())

  if (hints.length === 0 || hints.some((h) => h === 'all' || h === 'global')) return true

  const symbol = String(q.symbol ?? '').toUpperCase()
  const exchange = String(q.exchange ?? '').toLowerCase()
  const exchangeName = String(q.exchDisp ?? '').toLowerCase()
  const haystack = `${symbol.toLowerCase()} ${exchange} ${exchangeName}`

  return hints.some((hint) => {
    if (['ar', 'argentina', 'merval', 'byma', 'bcba', 'bcba/bym', 'buenos aires'].includes(hint)) {
      return symbol.endsWith('.BA') || /buenos|byma|bcba|\bbue\b/.test(haystack)
    }
    return haystack.includes(hint)
  })
}

function mapQuote(q: Record<string, unknown>): Record<string, unknown> {
  const symbol = String(q.symbol ?? '')
  const isBuenosAires = symbol.toUpperCase().endsWith('.BA')

  return {
    symbol,
    name: q.longname ?? q.shortname ?? null,
    exchange: q.exchange ?? null,
    exchange_name: q.exchDisp ?? null,
    quote_type: q.quoteType ?? null,
    type_disp: q.typeDisp ?? null,
    native_symbol: isBuenosAires ? symbol.slice(0, -3) : symbol,
    market: isBuenosAires ? 'argentina' : null,
  }
}
