import { describe, expect, it } from 'vitest'
import {
  applyZoneOverlapFiltering,
  buildFamilyFilterMeta,
  rangesOverlap,
  type OverlapZoneView,
} from './overlap-filter.js'

describe('zone overlap filtering', () => {
  it('treats any positive price-range intersection as overlap', () => {
    expect(rangesOverlap(zone({ top: 110, bottom: 100 }), zone({ top: 120, bottom: 109.99 }))).toBe(true)
    expect(rangesOverlap(zone({ top: 110, bottom: 100 }), zone({ top: 120, bottom: 110 }))).toBe(false)
  })

  it('defaults to ranked filtering within kind, direction, timeframe, and state bucket only', () => {
    const zones = [
      zone({ id: 'same-lower-rank', top: 110, bottom: 100, rank: 1 }),
      zone({ id: 'same-higher-rank', top: 112, bottom: 108, rank: 3 }),
      zone({ id: 'cross-family', kind: 'vi', top: 112, bottom: 108, rank: 0 }),
      zone({ id: 'opposite-direction', direction: 'bearish', top: 112, bottom: 108, rank: 0 }),
      zone({ id: 'different-timeframe', timeframe: '1h', top: 112, bottom: 108, rank: 0 }),
      zone({ id: 'different-state', state: 'mitigated', top: 112, bottom: 108, rank: 0 }),
      zone({ id: 'source-vs-breaker-role', kind: 'fvg_breaker', direction: 'bearish', top: 112, bottom: 108, rank: 0 }),
    ]

    const result = applyZoneOverlapFiltering(zones, 'ranked', (item) => item)

    expect(result.overlapFilteredCount).toBe(1)
    expect(result.items.map((item) => item.id)).toEqual([
      'same-higher-rank',
      'cross-family',
      'opposite-direction',
      'different-timeframe',
      'different-state',
      'source-vs-breaker-role',
    ])
  })

  it('supports older, newer, and none policies', () => {
    const zones = [
      zone({ id: 'older', top: 110, bottom: 100, confirmedAtIndex: 2, rank: 1 }),
      zone({ id: 'newer', top: 112, bottom: 108, confirmedAtIndex: 4, rank: 0 }),
    ]

    expect(applyZoneOverlapFiltering(zones, 'older', (item) => item).items.map((item) => item.id)).toEqual(['older'])
    expect(applyZoneOverlapFiltering(zones, 'newer', (item) => item).items.map((item) => item.id)).toEqual(['newer'])
    expect(applyZoneOverlapFiltering(zones, 'none', (item) => item).items.map((item) => item.id)).toEqual(['older', 'newer'])
  })

  it('removes every lower-ranked zone overlapped by a later winner', () => {
    const zones = [
      zone({ id: 'left', top: 2, bottom: 0, rank: 1 }),
      zone({ id: 'right', top: 5, bottom: 3, rank: 1 }),
      zone({ id: 'bridge-winner', top: 4, bottom: 1, rank: 3 }),
    ]

    const result = applyZoneOverlapFiltering(zones, 'ranked', (item) => item)

    expect(result.overlapFilteredCount).toBe(2)
    expect(result.items.map((item) => item.id)).toEqual(['bridge-winner'])
  })

  it('builds staged family filter meta', () => {
    expect(buildFamilyFilterMeta({
      detectedCount: 5,
      afterLifecycleCount: 3,
      overlapFilteredCount: 1,
      returnedCount: 2,
    })).toEqual({
      detectedCount: 5,
      lifecycleFilteredCount: 2,
      overlapFilteredCount: 1,
      returnedCount: 2,
    })
  })
})

function zone(overrides: Partial<OverlapZoneView> & { id?: string }): OverlapZoneView & { id?: string } {
  return {
    kind: 'fvg',
    direction: 'bullish',
    top: 110,
    bottom: 100,
    state: 'active',
    ...overrides,
  }
}
