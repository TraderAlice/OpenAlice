import { describe, expect, it, vi } from 'vitest'
import type { BarService, BarsResult, OhlcvBar } from '@/domain/market-data/bars/index.js'
import { analyzeOrderFlowContext } from './context.js'

const BAR_COUNT = 20

function timestamp(index: number, minuteOffset = 0): string {
  return new Date(Date.UTC(2024, 0, 1, 0, index * 15 + minuteOffset))
    .toISOString()
    .replace('T', ' ')
    .replace('.000Z', '')
}

function targetBars(progressByIndex: Record<number, number> = {}): OhlcvBar[] {
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const open = 100
    const close = open + (progressByIndex[index] ?? 0)
    return {
      date: timestamp(index),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 100,
    }
  })
}

function intrabars(ratios: number[], coverageByIndex: Record<number, number> = {}): OhlcvBar[] {
  return ratios.flatMap((ratio, index) => {
    const coveredVolume = 100 * (coverageByIndex[index] ?? 1)
    const positiveVolume = coveredVolume * (1 + ratio) / 2
    const negativeVolume = coveredVolume - positiveVolume
    return [
      {
        date: timestamp(index),
        open: 100,
        high: 101,
        low: 99,
        close: 101,
        volume: positiveVolume,
      },
      {
        date: timestamp(index, 1),
        open: 100,
        high: 101,
        low: 99,
        close: 99,
        volume: negativeVolume,
      },
    ]
  })
}

async function analyze(params: {
  ratios: number[]
  progressByIndex?: Record<number, number>
  coverageByIndex?: Record<number, number>
  count?: number
}) {
  const bars = targetBars(params.progressByIndex)
  const getBars = vi.fn(async () => ({
    bars: intrabars(params.ratios, params.coverageByIndex),
    meta: { symbol: 'TEST', from: bars[0]!.date, to: bars.at(-1)!.date, bars: params.ratios.length },
  } as BarsResult))
  const barService = { searchBarSources: vi.fn(), getBars } as unknown as BarService

  return analyzeOrderFlowContext(barService, {
    barId: 'test|ABSORPTION',
    interval: '15m',
    count: params.count ?? BAR_COUNT,
    mode: 'summary',
    targetBars: bars.slice(0, params.ratios.length),
  })
}

describe('analyzeOrderFlowContext absorption candidates', () => {
  it('reports symmetric positive- and negative-delta candidates with explainable evidence', async () => {
    const ratios = Array(BAR_COUNT).fill(0.1)
    ratios[17] = 0.9
    ratios[18] = -0.95
    const result = await analyze({
      ratios,
      progressByIndex: { 17: 0.1, 18: -0.1 },
    })

    expect(result.summary?.absorption).toMatchObject({
      status: 'available',
      sampleCount: BAR_COUNT,
      totalDetected: 2,
      truncated: false,
      method: {
        deltaExtreme: 'absolute_delta_ratio_window_percentile',
        percentile: 0.9,
        percentileThreshold: expect.any(Number),
        priceResponse: 'directional_open_to_close_over_atr',
        maximumDirectionalProgress: 0.25,
        atrPeriod: 14,
        minimumCoverage: 0.9,
      },
      candidates: [
        {
          kind: 'absorption',
          direction: 'negative',
          index: 18,
          sourceIndex: 18,
          timestamp: timestamp(18),
          deltaRatio: -0.95,
          absoluteDeltaRatio: 0.95,
          percentileThreshold: expect.any(Number),
          directionalPriceProgress: expect.any(Number),
          atr: expect.any(Number),
          coverage: 1,
          confidence: 'high',
          provisional: false,
        },
        {
          direction: 'positive',
          index: 17,
          sourceIndex: 17,
          deltaRatio: 0.9,
          provisional: false,
        },
      ],
    })
  })

  it('includes opposing progress but excludes extreme delta with adequate progress', async () => {
    const ratios = Array(BAR_COUNT).fill(0.1)
    ratios[17] = 1
    ratios[18] = -1
    ratios[19] = 1
    const result = await analyze({
      ratios,
      progressByIndex: {
        17: -0.5,
        18: -2,
        19: 0.1,
      },
    })

    expect(result.summary?.absorption).toMatchObject({
      status: 'available',
      totalDetected: 2,
      candidates: [
        { index: 19, directionalPriceProgress: expect.any(Number), provisional: true },
        { index: 17, directionalPriceProgress: expect.any(Number), provisional: false },
      ],
    })
    const available = result.summary?.absorption
    if (available?.status !== 'available') throw new Error('expected available absorption analysis')
    expect(available.candidates[1]!.directionalPriceProgress).toBeLessThan(0)
    expect(available.candidates.some(candidate => candidate.index === 18)).toBe(false)
  })

  it('includes an absolute delta ratio exactly at the applied percentile threshold', async () => {
    const ratios = Array(BAR_COUNT).fill(0.1)
    ratios[17] = 0.8
    ratios[18] = 0.8
    ratios[19] = 0.8
    const result = await analyze({ ratios, progressByIndex: { 17: 0.1, 18: 0.1, 19: 0.1 } })

    const absorption = result.summary?.absorption
    expect(absorption).toMatchObject({ status: 'available', totalDetected: 3 })
    if (absorption?.status !== 'available') throw new Error('expected available absorption analysis')
    expect(absorption.method.percentileThreshold).toBeCloseTo(0.8)
    expect(absorption.candidates.every(candidate => candidate.absoluteDeltaRatio === 0.8)).toBe(true)
  })

  it('distinguishes insufficient samples, insufficient coverage, and unavailable ATR', async () => {
    const tooShort = await analyze({ ratios: Array(13).fill(0.9), count: 13 })
    expect(tooShort.summary?.absorption).toEqual({
      status: 'unavailable',
      reason: 'insufficient_samples',
      sampleCount: 13,
      requiredSamples: 14,
      method: {
        deltaExtreme: 'absolute_delta_ratio_window_percentile',
        percentile: 0.9,
        priceResponse: 'directional_open_to_close_over_atr',
        maximumDirectionalProgress: 0.25,
        atrPeriod: 14,
        minimumCoverage: 0.9,
      },
    })

    const lowCoverage = await analyze({
      ratios: Array(BAR_COUNT).fill(0.9),
      coverageByIndex: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index, 0.5])),
    })
    expect(lowCoverage.summary?.absorption).toEqual({
      status: 'unavailable',
      reason: 'insufficient_coverage',
      sampleCount: 12,
      requiredSamples: 14,
      method: expect.any(Object),
    })

    const zeroRangeBars = targetBars()
      .map(bar => ({ ...bar, high: 100, low: 100 }))
    const getBars = vi.fn(async () => ({
      bars: intrabars(Array(BAR_COUNT).fill(0.9)),
      meta: { symbol: 'TEST', from: zeroRangeBars[0]!.date, to: zeroRangeBars.at(-1)!.date, bars: BAR_COUNT },
    } as BarsResult))
    const barService = { searchBarSources: vi.fn(), getBars } as unknown as BarService
    const noAtr = await analyzeOrderFlowContext(barService, {
      barId: 'test|ABSORPTION', interval: '15m', count: BAR_COUNT, mode: 'summary', targetBars: zeroRangeBars,
    })
    expect(noAtr.summary?.absorption).toEqual({
      status: 'unavailable',
      reason: 'missing_atr',
      sampleCount: BAR_COUNT,
      requiredSamples: 14,
      method: expect.any(Object),
    })
  })

  it('returns an available empty collection when no extreme has weak price response', async () => {
    const ratios = Array(BAR_COUNT).fill(0.1)
    ratios[18] = 0.9
    ratios[19] = -0.95
    const result = await analyze({ ratios, progressByIndex: { 18: 2, 19: -2 } })

    expect(result.summary?.absorption).toMatchObject({
      status: 'available',
      candidates: [],
      totalDetected: 0,
      truncated: false,
    })

    const flatDistribution = await analyze({ ratios: Array(BAR_COUNT).fill(0.5) })
    expect(flatDistribution.summary?.absorption).toMatchObject({
      status: 'available',
      candidates: [],
      totalDetected: 0,
    })
  })

  it('suppresses candidates when intrabar selection is degraded', async () => {
    const bars = targetBars()
    const getBars = vi.fn(async () => ({
      bars: intrabars(Array(BAR_COUNT).fill(0.9)),
      meta: { symbol: 'TEST', from: bars[0]!.date, to: bars.at(-1)!.date, bars: BAR_COUNT },
    } as BarsResult))
    const barService = { searchBarSources: vi.fn(), getBars } as unknown as BarService
    const result = await analyzeOrderFlowContext(barService, {
      barId: 'test|ABSORPTION', interval: '1000h', count: BAR_COUNT, mode: 'summary', targetBars: bars,
    })

    expect(result.meta.degradationReason).toEqual(expect.any(String))
    expect(result.summary?.absorption).toEqual({
      status: 'unavailable',
      reason: 'degraded_data',
      sampleCount: BAR_COUNT,
      requiredSamples: 14,
      method: expect.any(Object),
    })
  })

  it('orders newest first, caps results at three, and preserves the supplied-window offset', async () => {
    const ratios = Array(BAR_COUNT).fill(0.1)
    for (const index of [15, 16, 17, 18, 19]) ratios[index] = 0.9
    const allBars = targetBars()
    const prefix = Array.from({ length: 5 }, (_, index) => ({
      ...allBars[0]!,
      date: new Date(Date.UTC(2023, 11, 31, 22, 45 + index * 15)).toISOString().replace('T', ' ').replace('.000Z', ''),
    }))
    const getBars = vi.fn(async () => ({
      bars: intrabars(ratios),
      meta: { symbol: 'TEST', from: allBars[0]!.date, to: allBars.at(-1)!.date, bars: BAR_COUNT },
    } as BarsResult))
    const barService = { searchBarSources: vi.fn(), getBars } as unknown as BarService
    const result = await analyzeOrderFlowContext(barService, {
      barId: 'test|ABSORPTION', interval: '15m', count: BAR_COUNT, mode: 'summary', targetBars: [...prefix, ...allBars],
    })

    expect(result.summary?.window.targetIndexOffset).toBe(5)
    expect(result.summary?.absorption).toMatchObject({
      status: 'available',
      totalDetected: 5,
      truncated: true,
      candidates: [
        { index: 19, sourceIndex: 24, provisional: true },
        { index: 18, sourceIndex: 23, provisional: false },
        { index: 17, sourceIndex: 22, provisional: false },
      ],
    })
  })
})
