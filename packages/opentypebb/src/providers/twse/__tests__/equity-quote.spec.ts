/**
 * Unit tests for the TWSE EquityQuote fetcher's pure transform logic.
 *
 * Raw API fixtures mirror the live shapes (verified 2026-06-08):
 * - TWSE STOCK_DAY_ALL: { Date, Code, Name, TradeVolume, TradeValue,
 *   OpeningPrice, HighestPrice, LowestPrice, ClosingPrice, Change, Transaction }
 * - TPEx tpex_mainboard_quotes: { Date, SecuritiesCompanyCode, CompanyName,
 *   Close, Change, Open, High, Low, TradingShares, TransactionAmount,
 *   TransactionNumber, LatestBidPrice, LatesAskPrice, ... }
 */

import { describe, it, expect } from 'vitest'
import { TwseEquityQuoteFetcher, type TwseQuoteRaw } from '../models/equity-quote.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

const RAW: TwseQuoteRaw = {
  twse: [
    {
      Date: '1150605', Code: '2330', Name: '台積電',
      TradeVolume: '21882762', TradeValue: '21002472302',
      OpeningPrice: '960.00', HighestPrice: '965.00', LowestPrice: '955.00',
      ClosingPrice: '960.00', Change: '-5.0000', Transaction: '28491',
    },
    {
      // Halted / no-trade row — prices arrive as empty strings.
      Date: '1150605', Code: '9999', Name: '停牌股',
      TradeVolume: '0', TradeValue: '0',
      OpeningPrice: '', HighestPrice: '', LowestPrice: '',
      ClosingPrice: '', Change: '', Transaction: '0',
    },
  ],
  tpex: [
    {
      Date: '1150605', SecuritiesCompanyCode: '6488', CompanyName: '環球晶',
      Close: '380.00', Change: '+2.50', Open: '378.00', High: '382.00', Low: '376.50',
      TradingShares: '1234567', TransactionAmount: '469135460', TransactionNumber: '2345',
      LatestBidPrice: '379.50', LatesAskPrice: '380.00',
    },
  ],
}

const fetchQuotes = (symbol: string) =>
  TwseEquityQuoteFetcher.transformData(
    TwseEquityQuoteFetcher.transformQuery({ symbol }),
    RAW,
  )

describe('TwseEquityQuoteFetcher.transformData', () => {
  it('maps a TWSE-listed row to the standard quote shape', () => {
    const [q] = fetchQuotes('2330.TW')
    expect(q).toMatchObject({
      symbol: '2330.TW',
      name: '台積電',
      exchange: 'TWSE',
      open: 960, high: 965, low: 955, close: 960,
      last_price: 960,
      volume: 21882762,
      change: -5,
      prev_close: 965,
      last_timestamp: '2026-06-05',
      currency: 'TWD',
      transactions: 28491,
      trade_value: 21002472302,
    })
    expect(q.change_percent).toBeCloseTo(-5 / 965, 6)
    expect(q.bid).toBeNull()
    expect(q.ask).toBeNull()
  })

  it('maps a TPEx row including bid/ask and signed change', () => {
    const [q] = fetchQuotes('6488.TWO')
    expect(q).toMatchObject({
      symbol: '6488.TWO',
      name: '環球晶',
      exchange: 'TPEX',
      open: 378, high: 382, low: 376.5, close: 380,
      change: 2.5,
      prev_close: 377.5,
      volume: 1234567,
      bid: 379.5,
      ask: 380,
      last_timestamp: '2026-06-05',
    })
  })

  it('resolves a bare code on TWSE first, falling back to TPEx', () => {
    expect(fetchQuotes('2330')[0]?.symbol).toBe('2330.TW')
    expect(fetchQuotes('6488')[0]?.symbol).toBe('6488.TWO')
  })

  it('supports comma-separated multi-symbol queries', () => {
    const quotes = fetchQuotes('2330.TW,6488.TWO')
    expect(quotes.map((q) => q.symbol)).toEqual(['2330.TW', '6488.TWO'])
  })

  it('nulls out empty-string prices (no-trade rows)', () => {
    const [q] = fetchQuotes('9999.TW')
    expect(q.open).toBeNull()
    expect(q.close).toBeNull()
    expect(q.change).toBeNull()
    expect(q.prev_close).toBeNull()
    expect(q.change_percent).toBeNull()
  })

  it('throws EmptyDataError when no symbol matches', () => {
    expect(() => fetchQuotes('0000.TW')).toThrow(EmptyDataError)
  })
})
