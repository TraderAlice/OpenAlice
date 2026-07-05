/**
 * TWSE / TPEx provider — offline unit tests over the pure transform + boundary
 * normalization logic. Fixtures mirror the live API field shapes (verified by
 * twse.live.spec.ts) so this stays stable in CI without network.
 */
import { describe, it, expect } from 'vitest'
import { rocToISO, cleanNum, cleanStr, parseTwSymbol } from '../common.js'
import { TWSEEquityQuoteFetcher } from '../models/equity-quote.js'
import { TWSEKeyMetricsFetcher } from '../models/key-metrics.js'
import { TWSEEquityInfoFetcher } from '../models/equity-info.js'
import { TWSEEquitySearchFetcher } from '../models/equity-search.js'

describe('common normalizers', () => {
  it('rocToISO — ROC + Gregorian + boundaries + junk', () => {
    expect(rocToISO('1150626')).toBe('2026-06-26') // 民國115 = 2026 (7-digit)
    expect(rocToISO('0760907')).toBe('1987-09-07') // 民國076 = 1987 (7-digit)
    expect(rocToISO('20180808')).toBe('2018-08-08') // 8-digit Gregorian
    expect(rocToISO('19110626')).toBe('1911-06-26') // 1911 boundary = Gregorian, not ROC
    expect(rocToISO('00010626')).toBe('1912-06-26') // 8-digit zero-padded ROC year 1 = 1912
    expect(rocToISO('20340645')).toBeNull() // invalid day 45 → null
    expect(rocToISO('20260026')).toBeNull() // month 00 → null
    expect(rocToISO('')).toBeNull()
    expect(rocToISO(null)).toBeNull()
    expect(rocToISO('abc')).toBeNull()
  })

  it('cleanNum — commas, trailing/full-width spaces, blanks, dashes', () => {
    expect(cleanNum('1,234.5')).toBe(1234.5)
    expect(cleanNum('-2.88 ')).toBe(-2.88) // trailing space
    expect(cleanNum('14.82')).toBe(14.82)
    expect(cleanNum('')).toBeNull()
    expect(cleanNum('－')).toBeNull()
    expect(cleanNum('  ')).toBeNull()
  })

  it('cleanStr — trims full-width (U+3000) space, dash-only → null', () => {
    expect(cleanStr('MORNSUN　')).toBe('MORNSUN')
    expect(cleanStr('  台積電 ')).toBe('台積電')
    expect(cleanStr('－ ')).toBeNull()
    expect(cleanStr(null)).toBeNull()
  })

  it('parseTwSymbol — board split, ETF letter codes, rejects non-TW', () => {
    expect(parseTwSymbol('2330.TW')).toEqual({ code: '2330', board: 'TW' })
    expect(parseTwSymbol('6488.TWO')).toEqual({ code: '6488', board: 'TWO' })
    expect(parseTwSymbol('00400A.TW')).toEqual({ code: '00400A', board: 'TW' })
    expect(parseTwSymbol('AAPL')).toBeNull()
    expect(parseTwSymbol('2330')).toBeNull()
  })
})

// transformData is pure; feed it the intermediate shape extractData returns.
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

describe('KeyMetrics transformData', () => {
  it('listed → P/E·yield·P/B; loss-making empty P/E → null', () => {
    const [tw] = TWSEKeyMetricsFetcher.transformData(q, [
      { row: { Code: '2330', PEratio: '18.50', DividendYield: '2.10', PBratio: '4.30', Date: '1150626' }, symbol: '2330.TW', board: 'TW' },
    ])
    expect(tw).toMatchObject({ symbol: '2330.TW', pe_ratio: 18.5, dividend_yield: 2.1, price_to_book: 4.3, currency: 'TWD', period_ending: '2026-06-26' })

    const [loss] = TWSEKeyMetricsFetcher.transformData(q, [
      { row: { SecuritiesCompanyCode: '1240', PriceEarningRatio: '', YieldRatio: '6.07', PriceBookRatio: '1.64', Date: '1150626' }, symbol: '1240.TWO', board: 'TWO' },
    ])
    expect(loss.pe_ratio).toBeNull()
    expect(loss.dividend_yield).toBe(6.07)
  })
})

describe('EquityInfo transformData', () => {
  it('listed → profile, ROC listing date, paid-in capital', () => {
    const [r] = TWSEEquityInfoFetcher.transformData(q, [
      {
        raw: {
          公司名稱: '台灣積體電路製造股份有限公司', 網址: 'https://www.tsmc.com', 住址: '新竹科學園區',
          總機電話: '03-5636688', 總經理: 'CC Wei', 產業別: '24', 上市日期: '0760907', 實收資本額: '259303804580',
        },
        symbol: '2330.TW', board: 'TW',
      },
    ])
    expect(r).toMatchObject({
      symbol: '2330.TW', name: '台灣積體電路製造股份有限公司', stock_exchange: 'TWSE',
      company_url: 'https://www.tsmc.com', listing_date: '1987-09-07', paid_in_capital: 259303804580,
    })
  })

  it('OTC → trailing full-width space in URL trimmed', () => {
    const [r] = TWSEEquityInfoFetcher.transformData(q, [
      {
        raw: {
          CompanyName: '環球晶圓股份有限公司', WebAddress: 'https://www.sas-globalwafers.com　',
          Address: '新竹', GeneralManager: 'Doris Hsu', SecuritiesIndustryCode: '33',
          DateOfListing: '20150428', 'Paidin.Capital.NTDollars': '4356000000',
        },
        symbol: '6488.TWO', board: 'TWO',
      },
    ])
    expect(r).toMatchObject({ stock_exchange: 'TPEx', company_url: 'https://www.sas-globalwafers.com', listing_date: '2015-04-28' })
  })
})

describe('EquitySearch transformData', () => {
  it('emits Yahoo-suffix symbol + prefers short-name', () => {
    const out = TWSEEquitySearchFetcher.transformData(q, [
      { code: '2330', name: '台灣積體電路製造股份有限公司', abbr: '台積電', enName: 'TSMC', industry: '24', board: 'TW', raw: {} },
      { code: '6488', name: '環球晶圓股份有限公司', abbr: '環球晶', enName: 'GWC', industry: '33', board: 'TWO', raw: {} },
    ])
    expect(out[0]).toMatchObject({ symbol: '2330.TW', name: '台積電', exchange: 'TWSE' })
    expect(out[1]).toMatchObject({ symbol: '6488.TWO', name: '環球晶', exchange: 'TPEx' })
  })
})
