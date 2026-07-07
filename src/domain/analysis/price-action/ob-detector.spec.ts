import { describe, expect, it } from 'vitest'
import { detectOrderBlocks, detectOrderBlocksWithMeta } from './ob-detector.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type { BreakOfStructure, ChangeOfCharacter } from './types.js'

describe('detectOrderBlocks', () => {
  it('detects a bullish order block from the lowest candle before a bullish structure break', () => {
    const bars = makeBars([
      [100, 103, 98, 101, 1000],
      [101, 104, 99, 102, 1100],
      [102, 105, 100, 104, 1200],
      [104, 106, 95, 96, 5000], // lowest low in the pre-break range
      [96, 100, 94, 99, 3000],
      [99, 108, 98, 107, 2500],
      [107, 116, 106, 115, 4500], // breaks swing high
    ])
    const bos: BreakOfStructure[] = [{
      type: 'bullish',
      index: 6,
      price: 115,
      level: 'internal',
      brokenSwing: { index: 2, price: 105, type: 'high' },
    }]

    const obs = detectOrderBlocks({ bars, bos, choch: [], positionMode: 'full' })

    expect(obs).toEqual([
      expect.objectContaining({
        type: 'bullish',
        trigger: 'BOS',
        level: 'internal',
        index: 4,
        breakoutIndex: 6,
        top: 106,
        bottom: 94,
        middle: 100,
        volume: 3000,
        candleDirection: 'bullish',
        mitigated: false,
        volumeSharePct: 100,
      }),
    ])
  })

  it('detects a bearish order block from the highest candle before a bearish CHoCH', () => {
    const bars = makeBars([
      [120, 122, 118, 119, 1000],
      [119, 121, 117, 118, 1000],
      [118, 120, 116, 117, 1000],
      [117, 124, 116, 123, 4000], // highest high in the pre-break range
      [123, 125, 120, 121, 5000],
      [121, 122, 110, 111, 2000],
      [111, 112, 104, 105, 3000], // breaks swing low
    ])
    const choch: ChangeOfCharacter[] = [{
      type: 'bearish',
      index: 6,
      price: 105,
      level: 'swing',
      brokenSwing: { index: 2, price: 116, type: 'low' },
      trendBefore: 'bullish',
      isPlus: false,
    }]

    const obs = detectOrderBlocks({ bars, bos: [], choch, positionMode: 'full' })

    expect(obs).toEqual([
      expect.objectContaining({
        type: 'bearish',
        trigger: 'CHoCH',
        level: 'swing',
        index: 4,
        breakoutIndex: 6,
        top: 125,
        bottom: 116,
        middle: 120.5,
        volume: 5000,
        candleDirection: 'bearish',
        mitigated: false,
      }),
    ])
  })

  it('filters mitigated order blocks unless includeMitigated is enabled', () => {
    const bars = makeBars([
      [100, 103, 98, 101, 1000],
      [101, 104, 99, 102, 1000],
      [102, 105, 100, 104, 1000],
      [104, 106, 95, 96, 1000],
      [96, 100, 94, 99, 1000],
      [99, 108, 98, 107, 1000],
      [107, 116, 106, 115, 1000],
      [115, 116, 90, 91, 1000], // closes below bullish bottom
    ])
    const bos: BreakOfStructure[] = [{
      type: 'bullish',
      index: 6,
      price: 115,
      level: 'internal',
      brokenSwing: { index: 2, price: 105, type: 'high' },
    }]

    expect(detectOrderBlocks({ bars, bos, choch: [], positionMode: 'full' })).toEqual([])
    expect(detectOrderBlocks({ bars, bos, choch: [], positionMode: 'full', includeMitigated: true })).toEqual([
      expect.objectContaining({ mitigated: true, mitigatedAtIndex: 7 }),
    ])
  })

  it('uses the adverse body edge for body zone mitigation', () => {
    const bars = makeBars([
      [100, 103, 98, 101, 1000],
      [101, 104, 99, 102, 1000],
      [102, 105, 100, 104, 1000],
      [104, 106, 95, 96, 1000],
      [96, 100, 94, 99, 1000],
      [99, 108, 98, 107, 1000],
      [107, 116, 106, 115, 1000],
      [96, 97, 90, 101, 1000], // wick crosses bottom, body stays above it
    ])
    const bos: BreakOfStructure[] = [{
      type: 'bullish',
      index: 6,
      price: 115,
      level: 'internal',
      brokenSwing: { index: 2, price: 105, type: 'high' },
    }]

    expect(detectOrderBlocks({
      bars,
      bos,
      choch: [],
      positionMode: 'full',
      includeMitigated: true,
      zoneMitigationSource: 'body',
    })[0]).toEqual(expect.objectContaining({ mitigated: false }))
    expect(detectOrderBlocks({
      bars,
      bos,
      choch: [],
      positionMode: 'full',
      includeMitigated: true,
      zoneMitigationSource: 'wick',
    })[0]).toEqual(expect.objectContaining({ mitigated: true, mitigatedAtIndex: 7 }))
  })

  it('uses body price to trigger midpoint zone mitigation', () => {
    const bars = makeBars([
      [100, 103, 98, 101, 1000],
      [101, 104, 99, 102, 1000],
      [102, 105, 100, 104, 1000],
      [104, 106, 95, 96, 1000],
      [96, 100, 94, 99, 1000],
      [99, 108, 98, 107, 1000],
      [107, 116, 106, 115, 1000],
      [99, 118, 96, 103, 1000], // close above middle, body low below middle
    ])
    const bos: BreakOfStructure[] = [{
      type: 'bullish',
      index: 6,
      price: 115,
      level: 'internal',
      brokenSwing: { index: 2, price: 105, type: 'high' },
    }]

    expect(detectOrderBlocks({
      bars,
      bos,
      choch: [],
      positionMode: 'full',
      includeMitigated: true,
      zoneMitigationSource: 'body',
    })[0]).toEqual(expect.objectContaining({ mitigated: false }))
    expect(detectOrderBlocks({
      bars,
      bos,
      choch: [],
      positionMode: 'full',
      includeMitigated: true,
      zoneMitigationSource: 'midpoint',
    })[0]).toEqual(expect.objectContaining({ mitigated: true, mitigatedAtIndex: 7 }))
  })

  it('applies trigger filters', () => {
    const bars = makeBars([
      [100, 103, 98, 101, 1000],
      [101, 104, 99, 102, 1000],
      [102, 105, 100, 104, 1000],
      [104, 106, 95, 96, 1000],
      [96, 100, 94, 99, 1000],
      [99, 108, 98, 107, 1000],
      [107, 116, 106, 115, 1000],
    ])
    const bos: BreakOfStructure[] = [{
      type: 'bullish',
      index: 6,
      price: 115,
      level: 'internal',
      brokenSwing: { index: 2, price: 105, type: 'high' },
    }]

    expect(detectOrderBlocks({ bars, bos, choch: [], triggerFilter: 'CHoCH' })).toEqual([])
    expect(detectOrderBlocks({ bars, bos, choch: [], triggerFilter: 'BOS' })).toHaveLength(1)
  })

  it('attaches anchor and breakout intrabar volume confirmations', () => {
    const bars = makeBars([
      [100, 103, 98, 101, 1000],
      [101, 104, 99, 102, 1100],
      [102, 105, 100, 104, 1200],
      [104, 106, 95, 96, 5000],
      [96, 100, 94, 99, 3000],
      [99, 108, 98, 107, 2500],
      [107, 116, 106, 115, 4500],
    ])
    const bos: BreakOfStructure[] = [{
      type: 'bullish',
      index: 6,
      price: 115,
      level: 'internal',
      brokenSwing: { index: 2, price: 105, type: 'high' },
    }]
    const volumeConfirmations = new Map([
      [4, {
        delta: -600,
        deltaRatio: -0.2,
        coverage: 0.98,
        confidence: 'high' as const,
        intrabarInterval: '1m',
        intrabarCount: 100,
      }],
      [6, {
        delta: 3600,
        deltaRatio: 0.8,
        coverage: 0.95,
        confidence: 'usable' as const,
        intrabarInterval: '1m',
        intrabarCount: 100,
      }],
    ])

    const obs = detectOrderBlocks({ bars, bos, choch: [], positionMode: 'full', volumeConfirmations })

    expect(obs[0]).toEqual(expect.objectContaining({
      anchorVolumeConfirmation: expect.objectContaining({
        delta: -600,
        alignedWithBlock: false,
      }),
      internalBuyVolume: 1200,
      internalSellVolume: 1800,
      internalBuyVolumePct: 40,
      internalSellVolumePct: 60,
      breakoutVolumeConfirmation: expect.objectContaining({
        delta: 3600,
        alignedWithBlock: true,
      }),
    }))
  })

  it('uses full-bars absolute indices for anchor and breakout volume confirmation lookup', () => {
    const bars = makeBars([
      [90, 92, 89, 91, 1000],
      [91, 93, 90, 92, 1000],
      [100, 103, 98, 101, 1000],
      [101, 104, 99, 102, 1100],
      [102, 105, 100, 104, 1200],
      [104, 106, 95, 96, 5000],
      [96, 100, 94, 99, 3000],
      [99, 108, 98, 107, 2500],
      [107, 116, 106, 115, 4500],
    ])
    const bos: BreakOfStructure[] = [{
      type: 'bullish',
      index: 8,
      price: 115,
      level: 'internal',
      brokenSwing: { index: 4, price: 105, type: 'high' },
    }]
    const volumeConfirmations = new Map([
      [6, {
        delta: -600,
        deltaRatio: -0.2,
        coverage: 0.98,
        confidence: 'high' as const,
        intrabarInterval: '1m',
        intrabarCount: 100,
      }],
      [8, {
        delta: 3600,
        deltaRatio: 0.8,
        coverage: 0.95,
        confidence: 'usable' as const,
        intrabarInterval: '1m',
        intrabarCount: 100,
      }],
    ])

    const obs = detectOrderBlocks({ bars, bos, choch: [], positionMode: 'full', volumeConfirmations })

    expect(obs[0]).toEqual(expect.objectContaining({
      index: 6,
      breakoutIndex: 8,
      anchorVolumeConfirmation: expect.objectContaining({ delta: -600 }),
      breakoutVolumeConfirmation: expect.objectContaining({ delta: 3600 }),
    }))
  })

  it('uses ranked overlap filtering by default and keeps legacy older/newer/none policies explicit', () => {
    const bars = makeBars([
      [100, 102, 99, 101, 1000],
      [101, 104, 99, 103, 1000],
      [103, 106, 100, 105, 1000],
      [105, 107, 94, 96, 3000],
      [96, 120, 95, 102, 2000],
      [102, 108, 90, 107, 2000],
      [107, 112, 106, 111, 2000],
      [111, 115, 110, 114, 2000],
    ])
    const bos: BreakOfStructure[] = [
      {
        type: 'bullish',
        index: 5,
        price: 107,
        level: 'internal',
        brokenSwing: { index: 2, price: 106, type: 'high' },
      },
      {
        type: 'bullish',
        index: 7,
        price: 114,
        level: 'internal',
        brokenSwing: { index: 5, price: 108, type: 'high' },
      },
    ]

    expect(detectOrderBlocks({ bars, bos, choch: [], positionMode: 'full' })).toEqual([
      expect.objectContaining({ breakoutIndex: 7, index: 5, size: 30 }),
    ])
    expect(detectOrderBlocks({
      bars,
      bos,
      choch: [],
      positionMode: 'full',
      overlapPolicy: 'older',
    })).toEqual([
      expect.objectContaining({ breakoutIndex: 5, index: 3 }),
    ])
    expect(detectOrderBlocks({
      bars,
      bos,
      choch: [],
      positionMode: 'full',
      overlapPolicy: 'newer',
    })).toEqual([
      expect.objectContaining({ breakoutIndex: 7, index: 5 }),
    ])
    expect(detectOrderBlocks({
      bars,
      bos,
      choch: [],
      positionMode: 'full',
      hideOverlap: false,
    })).toHaveLength(2)
  })

  it('reports detected, lifecycle-filtered, overlap-filtered, and returned order-block counts', () => {
    const bars = makeBars([
      [100, 102, 99, 101, 1000],
      [101, 104, 99, 103, 1000],
      [103, 106, 100, 105, 1000],
      [105, 107, 94, 96, 3000],
      [96, 120, 95, 102, 2000],
      [102, 108, 90, 107, 2000],
      [107, 112, 106, 111, 2000],
      [111, 115, 110, 114, 2000],
      [92, 93, 88, 92, 2000],
    ])
    const bos: BreakOfStructure[] = [
      {
        type: 'bullish',
        index: 5,
        price: 107,
        level: 'internal',
        brokenSwing: { index: 2, price: 106, type: 'high' },
      },
      {
        type: 'bullish',
        index: 7,
        price: 114,
        level: 'internal',
        brokenSwing: { index: 5, price: 108, type: 'high' },
      },
    ]

    const result = detectOrderBlocksWithMeta({
      bars,
      bos,
      choch: [],
      positionMode: 'full',
      zoneMitigationSource: 'body',
    })

    expect(result.meta).toEqual({
      detectedCount: 2,
      lifecycleFilteredCount: 1,
      overlapFilteredCount: 0,
      returnedCount: 1,
    })
  })
})

function makeBars(rows: Array<[number, number, number, number, number]>): OhlcvBar[] {
  return rows.map(([open, high, low, close, volume], index) => ({
    date: `2024-01-${String(index + 1).padStart(2, '0')}`,
    open,
    high,
    low,
    close,
    volume,
  }))
}
