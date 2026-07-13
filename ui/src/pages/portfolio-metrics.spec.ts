import { describe, expect, it } from 'vitest'

import { computeTodayDelta } from './portfolio-metrics'

describe('computeTodayDelta', () => {
  it('computes delta and percent from a positive baseline', () => {
    expect(computeTodayDelta({ firstAtCutoff: 100, latest: 110 })).toEqual({
      delta: 10,
      pct: 10,
      sign: 'up',
    })
    expect(computeTodayDelta({ firstAtCutoff: 100, latest: 95 })).toEqual({
      delta: -5,
      pct: -5,
      sign: 'down',
    })
  })

  it('keeps a zero move visible when the baseline is valid', () => {
    expect(computeTodayDelta({ firstAtCutoff: 100, latest: 100 })).toEqual({
      delta: 0,
      pct: 0,
      sign: 'flat',
    })
  })

  it('suppresses missing, zero, negative and non-finite baselines', () => {
    expect(computeTodayDelta(null)).toBeNull()
    expect(computeTodayDelta({ firstAtCutoff: null, latest: 100 })).toBeNull()
    expect(computeTodayDelta({ firstAtCutoff: 0, latest: 100 })).toBeNull()
    expect(computeTodayDelta({ firstAtCutoff: -10, latest: 100 })).toBeNull()
    expect(computeTodayDelta({ firstAtCutoff: Number.NaN, latest: 100 })).toBeNull()
    expect(computeTodayDelta({ firstAtCutoff: 100, latest: Number.POSITIVE_INFINITY })).toBeNull()
  })
})
