import { describe, it, expect } from 'vitest'
import { TWSEEquityQuoteFetcher } from './equity-quote.js'
const q = {} as never

describe('EquityQuote transformData', () => {
  it('listed (.TW) → OHLCV mapped from TWSE field names', () => {
    const [r] = TWSEEquityQuoteFetcher.transformData(q, [
      {
        row: {
          Code: '2330', Name: '台積電', OpeningPrice: '1000.00', HighestPrice: '1010.00',
          LowestPrice: '990.00', ClosingPrice: '1005.00', TradeVolume: '12345678',
          Change: '5.00', Date: '1150626',
        },
        symbol: '2330.TW', board: 'TW',
      },
    ])
    expect(r).toMatchObject({
      symbol: '2330.TW', name: '台積電', exchange: 'TWSE',
      open: 1000, high: 1010, low: 990, close: 1005, last_price: 1005,
      volume: 12345678, change: 5, last_timestamp: '2026-06-26',
    })
  })

  it('OTC (.TWO) → OHLCV from TPEx field names, trailing-space change', () => {
    const [r] = TWSEEquityQuoteFetcher.transformData(q, [
      {
        row: {
          SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Open: '500.00', High: '510.00',
          Low: '495.00', Close: '505.00', TradingShares: '234567', Change: '-2.88 ', Date: '1150626',
        },
        symbol: '6488.TWO', board: 'TWO',
      },
    ])
    expect(r).toMatchObject({ symbol: '6488.TWO', exchange: 'TPEx', open: 500, close: 505, change: -2.88 })
  })
})
