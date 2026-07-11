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

function targetBars(closesByIndex: Record<number, number> = {}): OhlcvBar[] {
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const close = closesByIndex[index] ?? 100
    return {
      date: timestamp(index),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100,
    }
  })
}

function intrabars(ratios: number[], lowCoverageIndexes: number[] = []): OhlcvBar[] {
  return ratios.flatMap((ratio, index) => {
    const coveredVolume = lowCoverageIndexes.includes(index) ? 50 : 100
    const positiveVolume = coveredVolume * (1 + ratio) / 2
    return [
      { date: timestamp(index), open: 100, high: 101, low: 99, close: 101, volume: positiveVolume },
      { date: timestamp(index, 1), open: 100, high: 101, low: 99, close: 99, volume: coveredVolume - positiveVolume },
    ]
  })
}

async function analyze(params: {
  ratios: number[]
  closesByIndex?: Record<number, number>
  lowCoverageIndexes?: number[]
  barsOverride?: OhlcvBar[]
}) {
  const bars = params.barsOverride ?? targetBars(params.closesByIndex)
  const getBars = vi.fn(async () => ({
    bars: intrabars(params.ratios, params.lowCoverageIndexes),
    meta: { symbol: 'TEST', from: bars[0]!.date, to: bars.at(-1)!.date, bars: params.ratios.length },
  } as BarsResult))
  const barService = { searchBarSources: vi.fn(), getBars } as unknown as BarService

  return analyzeOrderFlowContext(barService, {
    barId: 'test|EXHAUSTION',
    interval: '15m',
    count: params.ratios.length,
    mode: 'summary',
    targetBars: bars.slice(0, params.ratios.length),
  })
}

describe('analyzeOrderFlowContext exhaustion candidates', () => {
  it('reports symmetric upward and downward fading-participation sequences', async () => {
    const ratios = Array(BAR_COUNT).fill(0.1)
    Object.assign(ratios, { 14: 0.9, 15: 0.6, 16: 0.3, 17: -0.9, 18: -0.6, 19: -0.3 })
    const result = await analyze({
      ratios,
      closesByIndex: { 14: 101, 15: 102, 16: 103, 17: 102, 18: 101, 19: 100 },
    })

    expect(result.summary).toMatchObject({
      fidelity: 'bar_proxy',
      isApproximation: true,
      exhaustion: {
        status: 'available',
        sampleCount: BAR_COUNT,
        totalDetected: 2,
        truncated: false,
        method: {
          sequenceLength: 3,
          priceProgress: 'strict_directional_close_progress_over_atr',
          deltaStrength: 'strictly_fading_same_direction_absolute_delta_ratio',
          atrPeriod: 14,
          minimumCoverage: 0.9,
        },
        candidates: [
          {
            kind: 'exhaustion',
            direction: 'downward',
            start: { index: 17, sourceIndex: 17, timestamp: timestamp(17) },
            end: { index: 19, sourceIndex: 19, timestamp: timestamp(19) },
            normalizedPriceProgression: [expect.any(Number), expect.any(Number)],
            deltaStrengthProgression: [0.9, 0.6, 0.3],
            atrProgression: [expect.any(Number), expect.any(Number)],
            coverage: [1, 1, 1],
            minimumObservedCoverage: 1,
            provisional: true,
          },
          {
            direction: 'upward',
            start: { index: 14, sourceIndex: 14 },
            end: { index: 16, sourceIndex: 16 },
            deltaStrengthProgression: [0.9, 0.6, 0.3],
            provisional: false,
          },
        ],
      },
    })
    const exhaustion = result.summary?.exhaustion
    if (exhaustion?.status !== 'available') throw new Error('expected available exhaustion analysis')
    expect(exhaustion.candidates.flatMap(candidate => candidate.normalizedPriceProgression)
      .every(progress => progress > 0)).toBe(true)
  })

  it('does not treat steady participation, one quiet bar, or broken price direction as exhaustion', async () => {
    const steady = Array(BAR_COUNT).fill(0.1)
    Object.assign(steady, { 17: 0.8, 18: 0.8, 19: 0.8 })
    const steadyResult = await analyze({ ratios: steady, closesByIndex: { 17: 101, 18: 102, 19: 103 } })
    expect(steadyResult.summary?.exhaustion).toMatchObject({ status: 'available', candidates: [], totalDetected: 0 })

    const isolated = Array(BAR_COUNT).fill(0.1)
    Object.assign(isolated, { 17: 0.8, 18: 0.8, 19: 0.1 })
    const isolatedResult = await analyze({ ratios: isolated, closesByIndex: { 17: 101, 18: 102, 19: 103 } })
    expect(isolatedResult.summary?.exhaustion).toMatchObject({ status: 'available', candidates: [], totalDetected: 0 })

    const broken = Array(BAR_COUNT).fill(0.1)
    Object.assign(broken, { 17: 0.9, 18: 0.6, 19: 0.3 })
    const brokenResult = await analyze({ ratios: broken, closesByIndex: { 17: 101, 18: 100.5, 19: 102 } })
    expect(brokenResult.summary?.exhaustion).toMatchObject({ status: 'available', candidates: [], totalDetected: 0 })
  })

  it('ignores low coverage outside the ATR-ready sequence when deciding availability', async () => {
    const result = await analyze({
      ratios: Array(15).fill(0.5),
      lowCoverageIndexes: [0],
    })

    expect(result.summary?.exhaustion).toMatchObject({
      status: 'available',
      sampleCount: 15,
      candidates: [],
      totalDetected: 0,
      truncated: false,
    })
  })

  it('reports stable unavailable reasons for short, uncovered, missing-ATR, and degraded inputs', async () => {
    const tooShort = await analyze({ ratios: Array(13).fill(0.5) })
    expect(tooShort.summary?.exhaustion).toEqual({
      status: 'unavailable', reason: 'insufficient_samples', sampleCount: 13, requiredSamples: 15,
      method: {
        sequenceLength: 3,
        priceProgress: 'strict_directional_close_progress_over_atr',
        deltaStrength: 'strictly_fading_same_direction_absolute_delta_ratio',
        atrPeriod: 14,
        minimumCoverage: 0.9,
      },
    })

    const noCompleteAtrSequence = await analyze({ ratios: Array(14).fill(0.5) })
    expect(noCompleteAtrSequence.summary?.exhaustion).toEqual({
      status: 'unavailable', reason: 'insufficient_samples', sampleCount: 14, requiredSamples: 15,
      method: {
        sequenceLength: 3,
        priceProgress: 'strict_directional_close_progress_over_atr',
        deltaStrength: 'strictly_fading_same_direction_absolute_delta_ratio',
        atrPeriod: 14,
        minimumCoverage: 0.9,
      },
    })

    const ratios = Array(BAR_COUNT).fill(0.1)
    const uncovered = await analyze({ ratios, lowCoverageIndexes: [13, 14, 15, 16, 17, 18, 19] })
    expect(uncovered.summary?.exhaustion).toEqual({
      status: 'unavailable', reason: 'insufficient_coverage', sampleCount: 13, requiredSamples: 15,
      method: expect.any(Object),
    })

    const noCoveredAtrReadySequence = await analyze({
      ratios,
      lowCoverageIndexes: [14, 17],
    })
    expect(noCoveredAtrReadySequence.summary?.exhaustion).toMatchObject({
      status: 'unavailable',
      reason: 'insufficient_coverage',
      sampleCount: 18,
      requiredSamples: 15,
    })

    const oneUncoveredSequence = Array(BAR_COUNT).fill(0.1)
    Object.assign(oneUncoveredSequence, { 17: 0.9, 18: 0.6, 19: 0.3 })
    const suppressed = await analyze({
      ratios: oneUncoveredSequence,
      closesByIndex: { 17: 101, 18: 102, 19: 103 },
      lowCoverageIndexes: [18],
    })
    expect(suppressed.summary?.exhaustion).toMatchObject({
      status: 'available', candidates: [], totalDetected: 0,
    })

    const zeroRange = targetBars().map(bar => ({ ...bar, high: bar.close, low: bar.close }))
    const noAtr = await analyze({ ratios, barsOverride: zeroRange })
    expect(noAtr.summary?.exhaustion).toEqual({
      status: 'unavailable', reason: 'missing_atr', sampleCount: BAR_COUNT, requiredSamples: 15,
      method: expect.any(Object),
    })

    const bars = targetBars()
    const getBars = vi.fn(async () => ({
      bars: intrabars(ratios),
      meta: { symbol: 'TEST', from: bars[0]!.date, to: bars.at(-1)!.date, bars: BAR_COUNT },
    } as BarsResult))
    const degraded = await analyzeOrderFlowContext(
      { searchBarSources: vi.fn(), getBars } as unknown as BarService,
      { barId: 'test|EXHAUSTION', interval: '1000h', count: BAR_COUNT, mode: 'summary', targetBars: bars },
    )
    expect(degraded.summary?.exhaustion).toEqual({
      status: 'unavailable', reason: 'degraded_data', sampleCount: BAR_COUNT, requiredSamples: 15,
      method: expect.any(Object),
    })
  })

  it('orders newest first, caps at three, and preserves source offsets', async () => {
    const ratios = Array(BAR_COUNT).fill(0.1)
    Object.assign(ratios, { 14: 0.9, 15: 0.8, 16: 0.7, 17: 0.6, 18: 0.5, 19: 0.4 })
    const bars = targetBars({ 14: 101, 15: 102, 16: 103, 17: 104, 18: 105, 19: 106 })
    const prefix = Array.from({ length: 4 }, (_, index) => ({
      ...bars[0]!,
      date: new Date(Date.UTC(2023, 11, 31, 23, index * 15)).toISOString().replace('T', ' ').replace('.000Z', ''),
    }))
    const getBars = vi.fn(async () => ({
      bars: intrabars(ratios),
      meta: { symbol: 'TEST', from: bars[0]!.date, to: bars.at(-1)!.date, bars: BAR_COUNT },
    } as BarsResult))
    const result = await analyzeOrderFlowContext(
      { searchBarSources: vi.fn(), getBars } as unknown as BarService,
      { barId: 'test|EXHAUSTION', interval: '15m', count: BAR_COUNT, mode: 'summary', targetBars: [...prefix, ...bars] },
    )

    expect(result.summary?.window.targetIndexOffset).toBe(4)
    expect(result.summary?.exhaustion).toMatchObject({
      status: 'available',
      totalDetected: 4,
      truncated: true,
      candidates: [
        { start: { index: 17, sourceIndex: 21 }, end: { index: 19, sourceIndex: 23 }, provisional: true },
        { start: { index: 16, sourceIndex: 20 }, end: { index: 18, sourceIndex: 22 }, provisional: false },
        { start: { index: 15, sourceIndex: 19 }, end: { index: 17, sourceIndex: 21 }, provisional: false },
      ],
    })
  })
})
