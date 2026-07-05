/**
 * TWSE / TPEx Equity Quote — latest end-of-day OHLCV from the official
 * whole-market daily snapshot, indexed by stock code. Listed (.TW) comes from
 * TWSE STOCK_DAY_ALL; OTC (.TWO) from TPEx daily close quotes. ROC dates and
 * empty/spaced numerics are normalized at the boundary.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityQuoteQueryParamsSchema, EquityQuoteDataSchema } from '../../../standard-models/equity-quote.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { parseTwSymbol, listedQuotes, otcQuotes, cleanNum, cleanStr, rocToISO, type Board } from '../common.js'

export const TWSEEquityQuoteQueryParamsSchema = EquityQuoteQueryParamsSchema
export type TWSEEquityQuoteQueryParams = z.infer<typeof TWSEEquityQuoteQueryParamsSchema>

export const TWSEEquityQuoteDataSchema = EquityQuoteDataSchema.passthrough()
export type TWSEEquityQuoteData = z.infer<typeof TWSEEquityQuoteDataSchema>

interface QuoteHit {
  row: Record<string, unknown>
  symbol: string
  board: Board
}

export class TWSEEquityQuoteFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TWSEEquityQuoteQueryParams {
    return TWSEEquityQuoteQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TWSEEquityQuoteQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<QuoteHit[]> {
    const symbols = query.symbol.split(',').map((s) => s.trim()).filter(Boolean)
    const out: QuoteHit[] = []
    for (const sym of symbols) {
      const p = parseTwSymbol(sym)
      if (!p) continue
      const map = p.board === 'TW' ? await listedQuotes() : await otcQuotes()
      const row = map.get(p.code)
      if (row) out.push({ row, symbol: sym, board: p.board })
    }
    if (!out.length) throw new EmptyDataError('No TWSE/TPEx quote for the given symbol(s).')
    return out
  }

  static override transformData(
    _query: TWSEEquityQuoteQueryParams,
    data: QuoteHit[],
  ): TWSEEquityQuoteData[] {
    return data.map(({ row, symbol, board }) => {
      const tw = board === 'TW'
      const close = cleanNum(tw ? row['ClosingPrice'] : row['Close'])
      return TWSEEquityQuoteDataSchema.parse({
        symbol,
        name: cleanStr(tw ? row['Name'] : row['CompanyName']),
        exchange: tw ? 'TWSE' : 'TPEx',
        open: cleanNum(tw ? row['OpeningPrice'] : row['Open']),
        high: cleanNum(tw ? row['HighestPrice'] : row['High']),
        low: cleanNum(tw ? row['LowestPrice'] : row['Low']),
        close,
        last_price: close,
        volume: cleanNum(tw ? row['TradeVolume'] : row['TradingShares']),
        change: cleanNum(row['Change']),
        last_timestamp: rocToISO(row['Date']),
      })
    })
  }
}
