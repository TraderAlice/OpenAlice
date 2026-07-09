import { describe, expect, it } from 'vitest'
import { YFinanceKeyMetricsFetcher } from './key-metrics.js'

describe('YFinanceKeyMetricsFetcher.transformData', () => {
  it('normalizes Yahoo debtToEquity from percent-scale to a true ratio', () => {
    const rows = YFinanceKeyMetricsFetcher.transformData(
      { symbol: 'AAPL' } as never,
      [{ symbol: 'AAPL', debtToEquity: 79.548, marketCap: 1, trailingPE: 30 }],
    )
    expect(rows[0].debt_to_equity).toBeCloseTo(0.79548)
  })
})
