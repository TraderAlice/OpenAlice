import { describe, expect, it } from 'vitest'
import { analyzePriceActionBars } from './analyze.js'

describe('analyzePriceActionBars', () => {
  it('returns the v2 empty detail result for an empty bar window', () => {
    const result = analyzePriceActionBars({
      bars: [],
      interval: '15m',
      meta: {
        symbol: 'PA',
        from: '',
        to: '',
        bars: 0,
      },
    })

    expect(Object.keys(result)).toEqual([
      'marketStructure',
      'premiumDiscount',
      'liquidityPools',
      'liquiditySweeps',
      'fvgs',
      'ifvgs',
      'orderBlocks',
      'breakers',
      'error',
      'meta',
    ])
    expect(result.marketStructure).toMatchObject({
      marketStructureMode: 'pivot',
      stateByLevel: {
        internal: { trend: 'unknown', trendValue: 0 },
        swing: { trend: 'unknown', trendValue: 0 },
        external: { trend: 'unknown', trendValue: 0 },
      },
      bos: [],
      choch: [],
      swingStrength: [],
    })
    expect(result.premiumDiscount).toEqual({ status: 'unavailable', reason: 'missing_range' })
    expect(result.meta).toMatchObject({
      schemaVersion: 2,
      totalFvgCount: 0,
      returnedFvgCount: 0,
      totalIfvgCount: 0,
      returnedIfvgCount: 0,
      totalBreakerCount: 0,
      returnedBreakerCount: 0,
      totalOrderBlockCount: 0,
      returnedOrderBlockCount: 0,
      mitigatedOrderBlockCount: 0,
      bosCount: 0,
      chochCount: 0,
    })
  })
})
