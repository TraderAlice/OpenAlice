/**
 * TWSE Equity Quote Fetcher.
 *
 * Latest-trading-day quote for Taiwan securities from the free official
 * open-data APIs (no API key). Both endpoints are board-wide snapshots —
 * extractData fetches only the board(s) the queried symbols need, then
 * transformData filters down to the requested codes.
 *
 * Sources (shapes verified live 2026-06-08):
 * - https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL
 *   TWSE listed (.TW) — { Date, Code, Name, TradeVolume, TradeValue,
 *   OpeningPrice, HighestPrice, LowestPrice, ClosingPrice, Change, Transaction }
 * - https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes
 *   TPEx OTC (.TWO) — { Date, SecuritiesCompanyCode, CompanyName, Close,
 *   Change, Open, High, Low, TradingShares, TransactionAmount,
 *   TransactionNumber, LatestBidPrice, LatesAskPrice, ... }
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { EquityQuoteQueryParamsSchema, EquityQuoteDataSchema } from '../../../standard-models/equity-quote.js'
import {
  TW_HEADERS, twseFetch, rocToIso, toNum, toYahooSymbol, parseSymbolList, boardsNeeded,
  type ParsedTwSymbol,
} from './common.js'

// ==================== Provider-specific schemas ====================

export const TwseEquityQuoteQueryParamsSchema = EquityQuoteQueryParamsSchema
export type TwseEquityQuoteQueryParams = z.infer<typeof TwseEquityQuoteQueryParamsSchema>

export const TwseEquityQuoteDataSchema = EquityQuoteDataSchema.extend({
  currency: z.string().nullable().default(null).describe('Currency of the price (always TWD).'),
  trade_value: z.number().nullable().default(null).describe('Total traded value for the day, in TWD.'),
  transactions: z.number().int().nullable().default(null).describe('Number of transactions for the day.'),
}).strip()
export type TwseEquityQuoteData = z.infer<typeof TwseEquityQuoteDataSchema>

// ==================== Raw API shapes ====================

export interface TwseStockDayAllRow {
  Date: string
  Code: string
  Name: string
  TradeVolume: string
  TradeValue: string
  OpeningPrice: string
  HighestPrice: string
  LowestPrice: string
  ClosingPrice: string
  Change: string
  Transaction: string
  [key: string]: unknown
}

export interface TpexMainboardQuoteRow {
  Date: string
  SecuritiesCompanyCode: string
  CompanyName: string
  Close: string
  Change: string
  Open: string
  High: string
  Low: string
  TradingShares: string
  TransactionAmount: string
  TransactionNumber: string
  LatestBidPrice: string
  /** Field name typo is the API's own — kept verbatim. */
  LatesAskPrice: string
  [key: string]: unknown
}

/** Board-wide snapshots — boards not needed by the query stay empty. */
export interface TwseQuoteRaw {
  twse: TwseStockDayAllRow[]
  tpex: TpexMainboardQuoteRow[]
}

// ==================== Endpoints ====================

const TWSE_STOCK_DAY_ALL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_MAINBOARD_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

// ==================== Row mapping ====================

/** Round away float noise from `close - change` (TW prices have ≤ 2 decimals). */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

function mapTwseRow(row: TwseStockDayAllRow): TwseEquityQuoteData {
  const close = toNum(row.ClosingPrice)
  const change = toNum(row.Change)
  const prevClose = close !== null && change !== null ? round4(close - change) : null
  return TwseEquityQuoteDataSchema.parse({
    symbol: toYahooSymbol(row.Code, 'TWSE'),
    name: row.Name,
    exchange: 'TWSE',
    open: toNum(row.OpeningPrice),
    high: toNum(row.HighestPrice),
    low: toNum(row.LowestPrice),
    close,
    last_price: close,
    volume: toNum(row.TradeVolume),
    change,
    prev_close: prevClose,
    change_percent: prevClose ? round4(change! / prevClose * 1e4) / 1e4 : null,
    last_timestamp: rocToIso(row.Date),
    currency: 'TWD',
    trade_value: toNum(row.TradeValue),
    transactions: toNum(row.Transaction),
  })
}

function mapTpexRow(row: TpexMainboardQuoteRow): TwseEquityQuoteData {
  const close = toNum(row.Close)
  const change = toNum(row.Change)
  const prevClose = close !== null && change !== null ? round4(close - change) : null
  return TwseEquityQuoteDataSchema.parse({
    symbol: toYahooSymbol(row.SecuritiesCompanyCode, 'TPEX'),
    name: row.CompanyName,
    exchange: 'TPEX',
    open: toNum(row.Open),
    high: toNum(row.High),
    low: toNum(row.Low),
    close,
    last_price: close,
    volume: toNum(row.TradingShares),
    change,
    prev_close: prevClose,
    change_percent: prevClose ? round4(change! / prevClose * 1e4) / 1e4 : null,
    bid: toNum(row.LatestBidPrice),
    ask: toNum(row.LatesAskPrice),
    last_timestamp: rocToIso(row.Date),
    currency: 'TWD',
    trade_value: toNum(row.TransactionAmount),
    transactions: toNum(row.TransactionNumber),
  })
}

/** Resolve one queried symbol against the fetched boards — TWSE wins for bare codes. */
function resolveSymbol(parsed: ParsedTwSymbol, raw: TwseQuoteRaw): TwseEquityQuoteData | null {
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

export class TwseEquityQuoteFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TwseEquityQuoteQueryParams {
    return TwseEquityQuoteQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TwseEquityQuoteQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<TwseQuoteRaw> {
    const needed = boardsNeeded(parseSymbolList(query.symbol))
    const [twse, tpex] = await Promise.all([
      needed.twse
        ? twseFetch<TwseStockDayAllRow[]>(TWSE_STOCK_DAY_ALL_URL, { headers: TW_HEADERS })
        : Promise.resolve([] as TwseStockDayAllRow[]),
      needed.tpex
        ? twseFetch<TpexMainboardQuoteRow[]>(TPEX_MAINBOARD_URL, { headers: TW_HEADERS })
        : Promise.resolve([] as TpexMainboardQuoteRow[]),
    ])
    return { twse, tpex }
  }

  static override transformData(
    query: TwseEquityQuoteQueryParams,
    data: TwseQuoteRaw,
  ): TwseEquityQuoteData[] {
    const results = parseSymbolList(query.symbol)
      .map((parsed) => resolveSymbol(parsed, data))
      .filter((q): q is TwseEquityQuoteData => q !== null)
    if (results.length === 0) {
      throw new EmptyDataError(`No Taiwan quotes found for: ${query.symbol}`)
    }
    return results
  }
}
