import { describe, expect, it, vi } from 'vitest'
import type { BarService, BarsResult, OhlcvBar } from '@/domain/market-data/bars/index.js'
import { analyzeOrderFlowContext } from './context.js'

function timestamp(index: number): string {
  return new Date(Date.UTC(2024, 0, 1, 0, index * 15)).toISOString()
}

function intrabarTimestamp(index: number, minuteOffset: number): string {
  return new Date(Date.UTC(2024, 0, 1, 0, index * 15 + minuteOffset)).toISOString()
}

function divergenceFixture(params: {
  highs: number[]
  lows?: number[]
  deltas: number[]
  targetVolume?: number
}): { targetBars: OhlcvBar[]; intrabars: OhlcvBar[] } {
  const targetVolume = params.targetVolume ?? 10
  const targetBars = params.highs.map((high, index) => {
    const low = params.lows?.[index] ?? high - 10
    const midpoint = (high + low) / 2
    return {
      date: timestamp(index),
      open: midpoint,
      high,
      low,
      close: midpoint,
      volume: targetVolume,
    }
  })
  const intrabars = params.deltas.flatMap((delta, index) => {
    const positiveVolume = (targetVolume + delta) / 2
    const negativeVolume = (targetVolume - delta) / 2
    return [
      {
        date: intrabarTimestamp(index, 0),
        open: 0,
        high: 1,
        low: 0,
        close: 1,
        volume: positiveVolume,
      },
      {
        date: intrabarTimestamp(index, 1),
        open: 1,
        high: 1,
        low: 0,
        close: 0,
        volume: negativeVolume,
      },
    ]
  })
  return { targetBars, intrabars }
}

function barServiceFor(intrabars: OhlcvBar[]): BarService {
  return {
    searchBarSources: vi.fn(),
    getBars: vi.fn(async () => ({
      bars: intrabars,
      meta: { symbol: 'TEST', from: intrabars[0]?.date ?? '', to: intrabars.at(-1)?.date ?? '', bars: intrabars.length },
    } as BarsResult)),
  } as unknown as BarService
}

function twoPeakHighs(first = 110, second = 112): number[] {
  return Array.from({ length: 23 }, (_, index) => Math.max(
    first - Math.abs(index - 5),
    second - Math.abs(index - 16),
  ))
}

function twoTroughLows(first = 90, second = 88): number[] {
  return Array.from({ length: 23 }, (_, index) => Math.min(
    first + Math.abs(index - 5),
    second + Math.abs(index - 16),
  ))
}

function repeatedHigherHighs(): number[] {
  const peaks = [5, 16, 27, 38, 49].map((index, sequence) => ({ index, price: 110 + sequence * 2 }))
  return Array.from({ length: 56 }, (_, index) => Math.max(
    ...peaks.map((peak) => peak.price - Math.abs(index - peak.index)),
  ))
}

describe('analyzeOrderFlowContext confirmed-pivot divergence candidates', () => {
  it('reports a bearish candidate when a confirmed higher high has non-confirming CVD', async () => {
    const fixture = divergenceFixture({
      highs: twoPeakHighs(),
      deltas: [...Array(6).fill(10), ...Array(11).fill(-10), ...Array(6).fill(10)],
    })

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'test|BEARISH',
      interval: '15m',
      count: fixture.targetBars.length,
      mode: 'summary',
      targetBars: fixture.targetBars,
    })

    expect(result.summary?.divergence).toEqual({
      status: 'available',
      sampleCount: 23,
      minimumCoverage: 1,
      candidates: [{
        kind: 'order_flow_divergence',
        method: 'confirmed_internal_pivot_cvd',
        direction: 'bearish',
        provisional: false,
        priorPivot: {
          index: 5,
          sourceIndex: 5,
          timestamp: timestamp(5),
          price: 110,
          cvd: 60,
        },
        currentPivot: {
          index: 16,
          sourceIndex: 16,
          timestamp: timestamp(16),
          price: 112,
          cvd: -50,
        },
        priceChange: 2,
        cvdChange: -110,
        reliability: { minimumCoverage: 1 },
      }],
      totalDetected: 1,
      truncated: false,
      method: {
        pivotLevel: 'internal',
        pivotLookback: 5,
        cvdComparison: 'at_confirmed_price_pivots',
        minimumCoverage: 0.9,
      },
    })
  })

  it('reports a bullish candidate when a confirmed lower low has non-confirming CVD', async () => {
    const lows = twoTroughLows()
    const fixture = divergenceFixture({
      highs: lows.map((low) => low + 10),
      lows,
      deltas: [...Array(6).fill(-10), ...Array(11).fill(10), ...Array(6).fill(-10)],
    })

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'test|BULLISH',
      interval: '15m',
      count: fixture.targetBars.length,
      mode: 'summary',
      targetBars: fixture.targetBars,
    })

    expect(result.summary?.divergence).toMatchObject({
      status: 'available',
      candidates: [{
        direction: 'bullish',
        provisional: false,
        priorPivot: { index: 5, sourceIndex: 5, price: 90, cvd: -60 },
        currentPivot: { index: 16, sourceIndex: 16, price: 88, cvd: 50 },
        priceChange: -2,
        cvdChange: 110,
        reliability: { minimumCoverage: 1 },
      }],
      totalDetected: 1,
      truncated: false,
    })
  })

  it('treats equal CVD as non-confirmation but requires a strict price extension', async () => {
    const equalCvd = divergenceFixture({
      highs: twoPeakHighs(),
      deltas: [...Array(6).fill(10), ...Array(11).fill(0), ...Array(6).fill(10)],
    })
    const equalPrice = divergenceFixture({
      highs: twoPeakHighs(110, 110),
      deltas: [...Array(6).fill(10), ...Array(11).fill(-10), ...Array(6).fill(10)],
    })

    const equalCvdResult = await analyzeOrderFlowContext(barServiceFor(equalCvd.intrabars), {
      barId: 'test|EQUAL-CVD', interval: '15m', count: 23, mode: 'summary', targetBars: equalCvd.targetBars,
    })
    const equalPriceResult = await analyzeOrderFlowContext(barServiceFor(equalPrice.intrabars), {
      barId: 'test|EQUAL-PRICE', interval: '15m', count: 23, mode: 'summary', targetBars: equalPrice.targetBars,
    })

    expect(equalCvdResult.summary?.divergence).toMatchObject({
      status: 'available',
      candidates: [{ direction: 'bearish', priceChange: 2, cvdChange: 0 }],
      totalDetected: 1,
    })
    expect(equalPriceResult.summary?.divergence).toMatchObject({
      status: 'available',
      candidates: [],
      totalDetected: 0,
      truncated: false,
    })
  })

  it('does not use a higher window endpoint as a confirmed pivot', async () => {
    const highs = Array.from({ length: 17 }, (_, index) => Math.max(
      110 - Math.abs(index - 5),
      112 - Math.abs(index - 16),
    ))
    const fixture = divergenceFixture({ highs, deltas: Array(17).fill(-10) })

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'test|UNCONFIRMED-ENDPOINT',
      interval: '15m',
      count: fixture.targetBars.length,
      mode: 'summary',
      targetBars: fixture.targetBars,
    })

    expect(result.summary?.divergence).toEqual({
      status: 'available',
      sampleCount: 17,
      minimumCoverage: 1,
      candidates: [],
      totalDetected: 0,
      truncated: false,
      method: {
        pivotLevel: 'internal',
        pivotLookback: 5,
        cvdComparison: 'at_confirmed_price_pivots',
        minimumCoverage: 0.9,
      },
    })
  })

  it('is unavailable when neither direction has two confirmed internal pivots', async () => {
    const highs = Array.from({ length: 11 }, (_, index) => 110 - Math.abs(index - 5))
    const fixture = divergenceFixture({ highs, deltas: Array(11).fill(10) })

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'test|INSUFFICIENT-PIVOTS', interval: '15m', count: 11, mode: 'summary', targetBars: fixture.targetBars,
    })

    expect(result.summary?.divergence).toMatchObject({
      status: 'unavailable',
      reason: 'insufficient_confirmed_pivots',
      sampleCount: 11,
    })
  })

  it('suppresses candidates when cumulative CVD evidence has insufficient intrabar coverage', async () => {
    const fixture = divergenceFixture({
      highs: twoPeakHighs(),
      deltas: [...Array(6).fill(10), ...Array(11).fill(-10), ...Array(6).fill(10)],
    })
    fixture.targetBars[0]!.volume = 20

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'test|LOW-COVERAGE', interval: '15m', count: 23, mode: 'summary', targetBars: fixture.targetBars,
    })

    expect(result.summary?.divergence).toMatchObject({
      status: 'unavailable',
      reason: 'insufficient_coverage',
      sampleCount: 23,
    })
    expect(result.summary?.currentState.profile.status).toBe('available')
  })

  it('does not let an unrelated singleton pivot discard an earlier covered candidate', async () => {
    const highs = Array.from({ length: 34 }, (_, index) => Math.max(
      110 - Math.abs(index - 5),
      112 - Math.abs(index - 16),
    ))
    const lows = Array.from({ length: 34 }, (_, index) => 60 + Math.abs(index - 27))
    const fixture = divergenceFixture({
      highs,
      lows,
      deltas: [...Array(6).fill(10), ...Array(11).fill(-10), ...Array(17).fill(10)],
    })
    fixture.targetBars[20]!.volume = 20

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'test|UNRELATED-LOW-COVERAGE-PIVOT',
      interval: '15m',
      count: fixture.targetBars.length,
      mode: 'summary',
      targetBars: fixture.targetBars,
    })

    expect(result.summary?.divergence).toMatchObject({
      status: 'available',
      minimumCoverage: 1,
      candidates: [{
        direction: 'bearish',
        priorPivot: { index: 5 },
        currentPivot: { index: 16 },
      }],
      totalDetected: 1,
    })
  })

  it('returns an available empty result when a covered pair has no divergence and a later pair is uncovered', async () => {
    const peaks = [
      { index: 5, price: 110 },
      { index: 16, price: 112 },
      { index: 27, price: 114 },
    ]
    const highs = Array.from({ length: 34 }, (_, index) => Math.max(
      ...peaks.map((peak) => peak.price - Math.abs(index - peak.index)),
    ))
    const fixture = divergenceFixture({ highs, deltas: Array(34).fill(10) })
    fixture.targetBars[20]!.volume = 20

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'test|PARTIALLY-COVERED-NO-DIVERGENCE',
      interval: '15m',
      count: fixture.targetBars.length,
      mode: 'summary',
      targetBars: fixture.targetBars,
    })

    expect(result.summary?.divergence).toMatchObject({
      status: 'available',
      minimumCoverage: 1,
      candidates: [],
      totalDetected: 0,
      truncated: false,
    })
  })

  it('returns the three newest candidates and reports older detected events as truncated', async () => {
    const fixture = divergenceFixture({ highs: repeatedHigherHighs(), deltas: Array(56).fill(-10) })

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'test|ORDERING', interval: '15m', count: 56, mode: 'summary', targetBars: fixture.targetBars,
    })

    expect(result.summary?.divergence).toMatchObject({
      status: 'available',
      candidates: [
        { direction: 'bearish', currentPivot: { index: 49 } },
        { direction: 'bearish', currentPivot: { index: 38 } },
        { direction: 'bearish', currentPivot: { index: 27 } },
      ],
      totalDetected: 4,
      truncated: true,
    })
  })

  it('keeps returned-window indexes and source indexes reconcilable after target-window slicing', async () => {
    const fixture = divergenceFixture({
      highs: twoPeakHighs(),
      deltas: [...Array(6).fill(10), ...Array(11).fill(-10), ...Array(6).fill(10)],
    })
    const prefix: OhlcvBar[] = [-3, -2, -1].map((index) => ({
      date: timestamp(index), open: 100, high: 105, low: 95, close: 100, volume: 10,
    }))

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'test|OFFSET',
      interval: '15m',
      count: 23,
      mode: 'summary',
      targetBars: [...prefix, ...fixture.targetBars],
    })

    expect(result.summary?.window.targetIndexOffset).toBe(3)
    expect(result.summary?.divergence).toMatchObject({
      status: 'available',
      candidates: [{
        priorPivot: { index: 5, sourceIndex: 8 },
        currentPivot: { index: 16, sourceIndex: 19 },
      }],
    })
  })

  it('marks divergence unavailable when the intrabar plan is automatically degraded', async () => {
    const fixture = divergenceFixture({ highs: twoPeakHighs(), deltas: Array(23).fill(-10) })

    const result = await analyzeOrderFlowContext(barServiceFor(fixture.intrabars), {
      barId: 'tradingview|DEGRADED',
      interval: '1h',
      count: 100,
      mode: 'summary',
      targetBars: fixture.targetBars,
      targetMeta: {
        symbol: 'DEGRADED',
        from: fixture.targetBars[0]!.date,
        to: fixture.targetBars.at(-1)!.date,
        bars: fixture.targetBars.length,
        supportedIntervals: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
      },
    })

    expect(result.meta.degradationReason).toContain('Auto-selected 3m')
    expect(result.summary?.divergence).toMatchObject({
      status: 'unavailable',
      reason: 'degraded_data',
      sampleCount: 23,
    })
  })
})
