/**
 * Unit tests for the TWSE KeyMetrics fetcher's pure transform logic.
 *
 * Raw API fixtures mirror the live shapes (verified 2026-06-08):
 * - TWSE BWIBBU_ALL: { Date, Code, Name, PEratio, DividendYield, PBratio }
 *   (PEratio is "" for loss-making companies — e.g. 台泥 on 2026-06-05)
 * - TPEx tpex_mainboard_peratio_analysis: { Date, SecuritiesCompanyCode,
 *   CompanyName, PriceEarningRatio, DividendPerShare, YieldRatio, PriceBookRatio }
 */

import { describe, it, expect } from 'vitest'
import { TwseKeyMetricsFetcher, type TwseKeyMetricsRaw } from '../models/key-metrics.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

const RAW: TwseKeyMetricsRaw = {
  twse: [
    { Date: '1150605', Code: '1101', Name: '台泥', PEratio: '', DividendYield: '3.28', PBratio: '0.78' },
    { Date: '1150605', Code: '2330', Name: '台積電', PEratio: '23.50', DividendYield: '1.85', PBratio: '6.10' },
  ],
  tpex: [
    {
      Date: '1150605', SecuritiesCompanyCode: '6488', CompanyName: '環球晶',
      PriceEarningRatio: '18.75', DividendPerShare: '16.00000000',
      YieldRatio: '4.21', PriceBookRatio: '2.35',
    },
  ],
}

const fetchMetrics = (symbol: string) =>
  TwseKeyMetricsFetcher.transformData(
    TwseKeyMetricsFetcher.transformQuery({ symbol }),
    RAW,
  )

describe('TwseKeyMetricsFetcher.transformData', () => {
  it('maps TWSE valuation ratios with ISO snapshot date', () => {
    const [m] = fetchMetrics('2330.TW')
    expect(m).toMatchObject({
      symbol: '2330.TW',
      name: '台積電',
      price_to_earnings: 23.5,
      dividend_yield: 1.85,
      price_to_book: 6.1,
      period_ending: '2026-06-05',
      currency: 'TWD',
    })
  })

  it('nulls an empty PEratio (loss-making company)', () => {
    const [m] = fetchMetrics('1101.TW')
    expect(m.price_to_earnings).toBeNull()
    expect(m.dividend_yield).toBe(3.28)
    expect(m.price_to_book).toBe(0.78)
  })

  it('maps TPEx ratios including dividend per share', () => {
    const [m] = fetchMetrics('6488.TWO')
    expect(m).toMatchObject({
      symbol: '6488.TWO',
      price_to_earnings: 18.75,
      dividend_yield: 4.21,
      price_to_book: 2.35,
      dividend_per_share: 16,
    })
  })

  it('resolves bare codes across both boards', () => {
    expect(fetchMetrics('2330')[0]?.symbol).toBe('2330.TW')
    expect(fetchMetrics('6488')[0]?.symbol).toBe('6488.TWO')
  })

  it('supports comma-separated multi-symbol queries', () => {
    const all = fetchMetrics('2330.TW,6488.TWO')
    expect(all.map((m) => m.symbol)).toEqual(['2330.TW', '6488.TWO'])
  })

  it('throws EmptyDataError when no symbol matches', () => {
    expect(() => fetchMetrics('0000.TW')).toThrow(EmptyDataError)
  })
})
