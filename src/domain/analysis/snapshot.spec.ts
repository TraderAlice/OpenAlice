import { describe, it, expect } from 'vitest'
import { getSnapshot } from './snapshot.js'
import type { BarService } from '@/domain/market-data/bars/index'
import type { OhlcvBar, BarMeta } from '@/domain/market-data/bars/types'

/** Build N ascending daily bars from a close path; high/low straddle close. */
function makeBars(closes: number[]): OhlcvBar[] {
  return closes.map((c, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 1000 + i,
  }))
}

function mockService(bars: OhlcvBar[], metaOver: Partial<BarMeta> = {}): BarService {
  return {
    searchBarSources: async () => [],
    getBars: async () => ({
      bars,
      meta: {
        symbol: 'XLE', from: bars[0]?.date ?? '', to: bars[bars.length - 1]?.date ?? '',
        bars: bars.length, source: 'uta', barId: 'alpaca|XLE', barCapability: 'realtime',
        asOf: bars[bars.length - 1]?.date ?? '', isLatestActual: true, staleTradingDays: 0,
        ...metaOver,
      },
    }),
  } as unknown as BarService
}

describe('getSnapshot', () => {
  it('summary by default (no bars dumped), latest print + levels computed over the window', async () => {
    const closes = Array.from({ length: 25 }, (_, i) => 50 + i) // 50..74
    const svc = mockService(makeBars(closes))
    const snap = await getSnapshot(svc, { barId: 'alpaca|XLE' } as never, { count: 25 })
    // bars are opt-in — empty by default, but the window size is reported
    expect(snap.bars).toHaveLength(0)
    expect(snap.windowBars).toBe(25)
    // latest print: close 74, prevClose 73, +1.37%
    expect(snap.latest).toMatchObject({ date: '2026-04-25', close: 74, prevClose: 73 })
    expect(snap.latest!.changePct).toBeCloseTo(1.37, 1)
    // levels computed over the full window even though no bars were returned
    expect(snap.levels!.sma20).not.toBeNull()
    expect(snap.levels!.periodHigh).toBe(75) // last high = 74+1
    expect(snap.levels!.distFromHighPct).toBeLessThanOrEqual(0)
  })

  it('returns the last `barsOut` dated bars when the path is requested', async () => {
    const closes = Array.from({ length: 25 }, (_, i) => 50 + i)
    const svc = mockService(makeBars(closes))
    const snap = await getSnapshot(svc, { barId: 'alpaca|XLE' } as never, { count: 25, barsOut: 5 })
    expect(snap.bars).toHaveLength(5)
    expect(snap.bars.map((b) => b.close)).toEqual([70, 71, 72, 73, 74]) // last 5
    expect(snap.windowBars).toBe(25) // still computed over all 25
  })

  it('surfaces a LOUD freshness warning when data does not reach the anchor', async () => {
    const svc = mockService(makeBars([50, 51, 52]), { isLatestActual: false, staleTradingDays: 2, asOf: '2026-04-07' })
    const snap = await getSnapshot(svc, { barId: 'alpaca|XLE' } as never, { asOf: '2026-04-07' })
    expect(snap.isLatestActual).toBe(false)
    expect(snap.staleTradingDays).toBe(2)
    expect(snap.freshnessWarning).toMatch(/NOT seeing the latest/)
  })

  it('handles an empty window honestly', async () => {
    const svc = mockService([])
    const snap = await getSnapshot(svc, { barId: 'alpaca|XLE' } as never, {})
    expect(snap.bars).toHaveLength(0)
    expect(snap.latest).toBeNull()
    expect(snap.levels).toBeNull()
  })
})
