import { describe, it, expect } from 'vitest'
import { TWSEKeyMetricsFetcher } from './key-metrics.js'
const q = {} as never

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
