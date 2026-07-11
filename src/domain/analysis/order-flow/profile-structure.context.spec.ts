import { describe, expect, it, vi } from 'vitest'
import type { BarService, BarsResult, OhlcvBar } from '@/domain/market-data/bars/index.js'
import { analyzeOrderFlowContext } from './context.js'

const TARGET_DATE = '2024-01-01 00:00:00'

function intrabarsForBinVolumes(volumes: number[]): OhlcvBar[] {
  const bars = volumes.map((volume, index) => ({
    date: `2024-01-01 00:${String(index).padStart(2, '0')}:00`,
    open: index + 0.5,
    high: index + 0.5,
    low: index + 0.5,
    close: index + 0.5,
    volume,
  }))

  return [
    { date: '2024-01-01 00:30:00', open: 0, high: 0, low: 0, close: 0, volume: 0 },
    ...bars,
    {
      date: '2024-01-01 00:31:00',
      open: volumes.length,
      high: volumes.length,
      low: volumes.length,
      close: volumes.length,
      volume: 0,
    },
  ]
}

async function analyzeProfile(volumes: number[], close = volumes.length / 2) {
  const intrabars = intrabarsForBinVolumes(volumes)
  const totalVolume = volumes.reduce((sum, volume) => sum + volume, 0)
  const targetBars: OhlcvBar[] = [{
    date: TARGET_DATE,
    open: 0,
    high: volumes.length,
    low: 0,
    close,
    volume: totalVolume,
  }]
  const barService = {
    searchBarSources: vi.fn(),
    getBars: vi.fn(async () => ({
      bars: intrabars,
      meta: {
        symbol: 'PROFILE',
        from: '2024-01-01',
        to: '2024-01-01',
        bars: intrabars.length,
      },
    } as BarsResult)),
  } as unknown as BarService

  return analyzeOrderFlowContext(barService, {
    barId: 'fixture|PROFILE',
    interval: '1d',
    count: 1,
    mode: 'summary',
    numBins: volumes.length,
    targetBars,
  })
}

describe('analyzeOrderFlowContext profile structure', () => {
  it('reports significant local Profile Nodes with auditable method metadata', async () => {
    const result = await analyzeProfile([10, 20, 100, 20, 5, 20, 10, 20, 90, 20, 5, 20])

    expect(result.summary?.profileStructure).toMatchObject({
      status: 'available',
      sampleCount: 12,
      method: {
        smoothing: 'weighted_moving_average_3',
        smoothingWeights: [0.25, 0.5, 0.25],
        hvnSignificancePercentile: 0.75,
        lvnSignificancePercentile: 0.25,
      },
      nodes: [
        {
          kind: 'hvn',
          startIndex: 2,
          endIndex: 2,
          priceLow: 2,
          priceHigh: 3,
          totalVolume: 100,
        },
        {
          kind: 'lvn',
          startIndex: 4,
          endIndex: 4,
          priceLow: 4,
          priceHigh: 5,
          totalVolume: 5,
        },
        {
          kind: 'hvn',
          startIndex: 8,
          endIndex: 8,
          priceLow: 8,
          priceHigh: 9,
          totalVolume: 90,
        },
        {
          kind: 'lvn',
          startIndex: 10,
          endIndex: 10,
          priceLow: 10,
          priceHigh: 11,
          totalVolume: 5,
        },
      ],
    })
  })

  it('merges adjacent qualifying bins into one contiguous Profile Node', async () => {
    const result = await analyzeProfile([10, 20, 100, 100, 20, 10, 20, 10])

    expect(result.summary?.profileStructure).toMatchObject({
      status: 'available',
      nodes: expect.arrayContaining([
        expect.objectContaining({
          kind: 'hvn',
          startIndex: 2,
          endIndex: 3,
          priceLow: 2,
          priceHigh: 4,
          totalVolume: 200,
          averageVolume: 100,
          averageSmoothedVolume: 80,
        }),
      ]),
    })
  })

  it('reports only internally bounded negligible regions as Volume Gaps', async () => {
    const result = await analyzeProfile([0, 20, 80, 0, 0, 70, 20, 0])

    expect(result.summary?.profileStructure).toMatchObject({
      status: 'available',
      method: { volumeGapRelativeFloor: 0.01 },
      volumeGaps: [
        {
          startIndex: 3,
          endIndex: 4,
          priceLow: 3,
          priceHigh: 5,
          totalVolume: 0,
          maxBinVolume: 0,
          relativeToWindowMax: 0,
        },
      ],
    })
  })

  it('does not relabel an ordinary LVN as a Volume Gap', async () => {
    const result = await analyzeProfile([40, 50, 100, 10, 10, 90, 50, 40])

    expect(result.summary?.profileStructure).toMatchObject({
      status: 'available',
      nodes: expect.arrayContaining([
        expect.objectContaining({ kind: 'lvn', startIndex: 4, endIndex: 4 }),
      ]),
      volumeGaps: [],
    })
  })

  it('filters local extrema that do not clear the window-relative significance gate', async () => {
    const result = await analyzeProfile([10, 100, 10, 10, 10, 30, 10, 10, 10, 90, 10, 10, 10, 80, 10, 10])
    const structure = result.summary?.profileStructure

    expect(structure?.status).toBe('available')
    if (structure?.status !== 'available') return
    expect(structure.nodes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'hvn', startIndex: 5 }),
    ]))
    expect(structure.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'hvn', startIndex: 1 }),
      expect.objectContaining({ kind: 'hvn', startIndex: 9 }),
      expect.objectContaining({ kind: 'hvn', startIndex: 13 }),
    ]))
  })

  it.each([
    { name: 'flat', volumes: [10, 10, 10, 10, 10, 10, 10, 10] },
    { name: 'zero-volume', volumes: [0, 0, 0, 0, 0, 0, 0, 0] },
  ])('returns an available empty result for a $name distribution', async ({ volumes }) => {
    const result = await analyzeProfile(volumes)

    expect(result.summary?.profileStructure).toMatchObject({
      status: 'available',
      sampleCount: 8,
      nodes: [],
      volumeGaps: [],
    })
  })

  it('reports too-small distributions as unavailable', async () => {
    const result = await analyzeProfile([10, 80, 20, 10])

    expect(result.summary?.profileStructure).toEqual({
      status: 'unavailable',
      reason: 'insufficient_samples',
      sampleCount: 4,
      method: {
        smoothing: 'weighted_moving_average_3',
        smoothingWeights: [0.25, 0.5, 0.25],
        hvnSignificancePercentile: 0.75,
        lvnSignificancePercentile: 0.25,
        volumeGapRelativeFloor: 0.01,
        minimumBins: 5,
      },
    })
  })

  it('reports missing intrabars as unavailable instead of an empty evaluated distribution', async () => {
    const targetBars: OhlcvBar[] = [{
      date: TARGET_DATE,
      open: 0,
      high: 8,
      low: 0,
      close: 4,
      volume: 100,
    }]
    const barService = {
      searchBarSources: vi.fn(),
      getBars: vi.fn(async () => ({
        bars: [],
        meta: { symbol: 'PROFILE', from: '', to: '', bars: 0 },
      } as BarsResult)),
    } as unknown as BarService

    const result = await analyzeOrderFlowContext(barService, {
      barId: 'fixture|PROFILE',
      interval: '1d',
      mode: 'summary',
      targetBars,
    })

    expect(result.summary?.profileStructure).toEqual({
      status: 'unavailable',
      reason: 'missing_intrabars',
      sampleCount: 0,
      method: expect.any(Object),
    })
  })

  it.each([0, 6])('keeps a close exactly on value-area boundary %s inside the value area', async (close) => {
    const result = await analyzeProfile([10, 10, 10, 10, 10, 10, 10, 10], close)

    expect(result.summary?.currentState.profile).toMatchObject({
      status: 'available',
      valueArea: {
        low: 0,
        high: 6,
        location: 'inside',
        distanceToValueArea: 0,
      },
    })
  })
})
