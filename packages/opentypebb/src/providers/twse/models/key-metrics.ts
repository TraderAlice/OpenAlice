/**
 * TWSE Key Metrics Fetcher.
 *
 * Daily valuation-ratio snapshot (P/E, dividend yield, P/B) for Taiwan
 * securities from the free official open-data APIs (no API key). The
 * official exchange figures are more reliable for TW tickers than what
 * yfinance derives. Board-wide snapshots — extractData fetches only the
 * board(s) the queried symbols need.
 *
 * Sources (shapes verified live 2026-06-08):
 * - https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL
 *   TWSE listed (.TW) — { Date, Code, Name, PEratio, DividendYield, PBratio }
 * - https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis
 *   TPEx OTC (.TWO) — { Date, SecuritiesCompanyCode, CompanyName,
 *   PriceEarningRatio, DividendPerShare, YieldRatio, PriceBookRatio }
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { KeyMetricsQueryParamsSchema, KeyMetricsDataSchema } from '../../../standard-models/key-metrics.js'
import {
  TW_HEADERS, twseFetch, rocToIso, toNum, toYahooSymbol, parseSymbolList, boardsNeeded,
  type ParsedTwSymbol,
} from './common.js'

// ==================== Provider-specific schemas ====================

export const TwseKeyMetricsQueryParamsSchema = KeyMetricsQueryParamsSchema
export type TwseKeyMetricsQueryParams = z.infer<typeof TwseKeyMetricsQueryParamsSchema>

export const TwseKeyMetricsDataSchema = KeyMetricsDataSchema.extend({
  name: z.string().nullable().default(null).describe('Name of the security.'),
  price_to_earnings: z.number().nullable().default(null).describe('Price-to-earnings ratio. Null for loss-making companies.'),
  dividend_yield: z.number().nullable().default(null).describe('Trailing dividend yield, in percent (3.28 = 3.28%).'),
  price_to_book: z.number().nullable().default(null).describe('Price-to-book ratio.'),
  dividend_per_share: z.number().nullable().default(null).describe('Dividend per share, in TWD (TPEx only).'),
}).strip()
export type TwseKeyMetricsData = z.infer<typeof TwseKeyMetricsDataSchema>

// ==================== Raw API shapes ====================

export interface TwseBwibbuRow {
  Date: string
  Code: string
  Name: string
  PEratio: string
  DividendYield: string
  PBratio: string
  [key: string]: unknown
}

export interface TpexPeratioRow {
  Date: string
  SecuritiesCompanyCode: string
  CompanyName: string
  PriceEarningRatio: string
  DividendPerShare: string
  YieldRatio: string
  PriceBookRatio: string
  [key: string]: unknown
}

/** Board-wide snapshots — boards not needed by the query stay empty. */
export interface TwseKeyMetricsRaw {
  twse: TwseBwibbuRow[]
  tpex: TpexPeratioRow[]
}

// ==================== Endpoints ====================

const TWSE_BWIBBU_ALL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'
const TPEX_PERATIO_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis'

// ==================== Row mapping ====================

function mapTwseRow(row: TwseBwibbuRow): TwseKeyMetricsData {
  return TwseKeyMetricsDataSchema.parse({
    symbol: toYahooSymbol(row.Code, 'TWSE'),
    name: row.Name,
    period_ending: rocToIso(row.Date),
    currency: 'TWD',
    price_to_earnings: toNum(row.PEratio),
    dividend_yield: toNum(row.DividendYield),
    price_to_book: toNum(row.PBratio),
  })
}

function mapTpexRow(row: TpexPeratioRow): TwseKeyMetricsData {
  return TwseKeyMetricsDataSchema.parse({
    symbol: toYahooSymbol(row.SecuritiesCompanyCode, 'TPEX'),
    name: row.CompanyName,
    period_ending: rocToIso(row.Date),
    currency: 'TWD',
    price_to_earnings: toNum(row.PriceEarningRatio),
    dividend_yield: toNum(row.YieldRatio),
    price_to_book: toNum(row.PriceBookRatio),
    dividend_per_share: toNum(row.DividendPerShare),
  })
}

/** Resolve one queried symbol against the fetched boards — TWSE wins for bare codes. */
function resolveSymbol(parsed: ParsedTwSymbol, raw: TwseKeyMetricsRaw): TwseKeyMetricsData | null {
  if (parsed.board !== 'TPEX') {
    const hit = raw.twse.find((r) => r.Code === parsed.code)
    if (hit) return mapTwseRow(hit)
  }
  if (parsed.board !== 'TWSE') {
    const hit = raw.tpex.find((r) => r.SecuritiesCompanyCode === parsed.code)
    if (hit) return mapTpexRow(hit)
  }
  return null
}

// ==================== Fetcher ====================

export class TwseKeyMetricsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TwseKeyMetricsQueryParams {
    return TwseKeyMetricsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TwseKeyMetricsQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<TwseKeyMetricsRaw> {
    const needed = boardsNeeded(parseSymbolList(query.symbol))
    const [twse, tpex] = await Promise.all([
      needed.twse
        ? twseFetch<TwseBwibbuRow[]>(TWSE_BWIBBU_ALL_URL, { headers: TW_HEADERS })
        : Promise.resolve([] as TwseBwibbuRow[]),
      needed.tpex
        ? twseFetch<TpexPeratioRow[]>(TPEX_PERATIO_URL, { headers: TW_HEADERS })
        : Promise.resolve([] as TpexPeratioRow[]),
    ])
    return { twse, tpex }
  }

  static override transformData(
    query: TwseKeyMetricsQueryParams,
    data: TwseKeyMetricsRaw,
  ): TwseKeyMetricsData[] {
    const results = parseSymbolList(query.symbol)
      .map((parsed) => resolveSymbol(parsed, data))
      .filter((m): m is TwseKeyMetricsData => m !== null)
    if (results.length === 0) {
      throw new EmptyDataError(`No Taiwan valuation metrics found for: ${query.symbol}`)
    }
    return results
  }
}
