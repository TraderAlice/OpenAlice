import { describe, it, expect } from 'vitest'
import { analyzeMarketStructure } from './market-structure.js'
import { detectSwingPoints } from './swing-detector.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types'

describe('analyzeMarketStructure', () => {
  it('只使用已确认的 swing 点判断趋势（避免前视偏差）', () => {
    const bars = makeBars([90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 121, 118, 119, 122])
    const targetSwingHigh = { index: 8, price: 120, type: 'high' as const }
    const swingPoints = {
      internal: {
        highs: [
          { index: 0, price: 100, type: 'high' as const },
          { index: 1, price: 105, type: 'high' as const },
          targetSwingHigh,
        ],
        lows: [
          { index: 0, price: 80, type: 'low' as const },
          { index: 1, price: 85, type: 'low' as const },
        ],
      },
      swing: { highs: [], lows: [] },
      external: { highs: [], lows: [] },
    }

    const result = analyzeMarketStructure({ bars, swingPoints, internalLookback: 5 })
    const breaksOfTarget = result.bos.filter(
      (b) => b.level === 'internal' && b.brokenSwing.index === targetSwingHigh.index && b.brokenSwing.type === 'high'
    )

    expect(breaksOfTarget).toHaveLength(1)
    expect(breaksOfTarget[0].index).toBe(13)
  })

  it('验证去重：同一 swing 点同一层级不会重复突破', () => {
    const bars = makeBars([90, 92, 94, 96, 98, 100, 102, 112, 118])
    const targetSwingHigh = { index: 2, price: 110, type: 'high' as const }
    const swingPoints = {
      internal: {
        highs: [
          { index: 0, price: 100, type: 'high' as const },
          { index: 1, price: 105, type: 'high' as const },
          targetSwingHigh,
        ],
        lows: [
          { index: 0, price: 80, type: 'low' as const },
          { index: 1, price: 85, type: 'low' as const },
        ],
      },
      swing: { highs: [], lows: [] },
      external: { highs: [], lows: [] },
    }

    const result = analyzeMarketStructure({ bars, swingPoints, internalLookback: 5 })
    const breaksOfTarget = result.bos.filter(
      (b) => b.level === 'internal' && b.brokenSwing.index === targetSwingHigh.index && b.brokenSwing.type === 'high'
    )

    expect(breaksOfTarget).toHaveLength(1)
    expect(breaksOfTarget[0].index).toBe(7)
  })

  it('返回完整的三层级结构', () => {
    const bars: OhlcvBar[] = Array.from({ length: 50 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: 100 + Math.sin(i / 3) * 20,
      high: 110 + Math.sin(i / 3) * 20,
      low: 90 + Math.sin(i / 3) * 20,
      close: 100 + Math.sin(i / 3) * 20,
      volume: 1000,
    }))

    const swingPoints = detectSwingPoints({ bars })
    const result = analyzeMarketStructure({ bars, swingPoints, internalLookback: 5 })

    // 验证返回结构完整性
    expect(result.swingPoints).toHaveProperty('internal')
    expect(result.swingPoints).toHaveProperty('swing')
    expect(result.swingPoints).toHaveProperty('external')
    expect(result.swingPoints.internal).toHaveProperty('highs')
    expect(result.swingPoints.internal).toHaveProperty('lows')
    expect(result.stateByLevel).toHaveProperty('internal')
    expect(result.stateByLevel).toHaveProperty('swing')
    expect(result.stateByLevel).toHaveProperty('external')
    expect(Array.isArray(result.bos)).toBe(true)
    expect(Array.isArray(result.choch)).toBe(true)

    // 验证每个突破都有层级标记
    for (const b of result.bos) {
      expect(['internal', 'swing', 'external']).toContain(b.level)
    }
    for (const c of result.choch) {
      expect(['internal', 'swing', 'external']).toContain(c.level)
    }
  })

  it('空数据返回空数组', () => {
    const swingPoints = {
      internal: { highs: [], lows: [] },
      swing: { highs: [], lows: [] },
      external: { highs: [], lows: [] },
    }

    const result = analyzeMarketStructure({ bars: [], swingPoints })

    expect(result.bos).toEqual([])
    expect(result.choch).toEqual([])
    expect(result.swingPoints).toEqual(swingPoints)
    expect(result.stateByLevel.internal).toEqual({ trend: 'unknown', trendValue: 0 })
  })

  it('验证 P3 修复：去重 key 包含 level 和 type', () => {
    const bars = makeBars([100, 102, 104, 106, 108, 109, 110, 112, 88])
    const swingPoints = {
      internal: {
        highs: [
          { index: 0, price: 100, type: 'high' as const },
          { index: 1, price: 105, type: 'high' as const },
          { index: 2, price: 110, type: 'high' as const },
        ],
        lows: [
          { index: 0, price: 80, type: 'low' as const },
          { index: 1, price: 85, type: 'low' as const },
          { index: 2, price: 90, type: 'low' as const },
        ],
      },
      swing: { highs: [], lows: [] },
      external: { highs: [], lows: [] },
    }

    const result = analyzeMarketStructure({ bars, swingPoints })
    const breaksOfIndexTwo = [...result.bos, ...result.choch].filter(
      (b) => b.level === 'internal' && b.brokenSwing.index === 2
    )

    expect(breaksOfIndexTwo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'bullish', index: 7, brokenSwing: expect.objectContaining({ type: 'high' }) }),
        expect.objectContaining({ type: 'bearish', index: 8, brokenSwing: expect.objectContaining({ type: 'low' }) }),
      ])
    )
    expect(breaksOfIndexTwo).toHaveLength(2)
  })

  it('neutral 状态下首次向上突破生成 bullish BOS 并切换为 bullish', () => {
    const result = analyzeMarketStructure({
      bars: makeBars([99, 100, 101, 106]),
      swingPoints: makeSwingPoints({
        highs: [{ index: 1, price: 105, type: 'high' }],
        lows: [],
      }),
      internalLookback: 1,
    })

    expect(result.bos).toEqual([
      expect.objectContaining({
        type: 'bullish',
        index: 3,
        level: 'internal',
        brokenSwing: expect.objectContaining({ index: 1, price: 105 }),
      }),
    ])
    expect(result.choch).toEqual([])
    expect(result.stateByLevel.internal.trend).toBe('bullish')
    expect(result.stateByLevel.internal.lastBos).toEqual(result.bos[0])
  })

  it('bullish 状态下跌破最新 low 生成 bearish CHoCH 并切换为 bearish', () => {
    const result = analyzeMarketStructure({
      bars: makeBars([99, 100, 101, 106, 104, 103, 94]),
      swingPoints: makeSwingPoints({
        highs: [{ index: 1, price: 105, type: 'high' }],
        lows: [{ index: 4, price: 95, type: 'low' }],
      }),
      internalLookback: 1,
    })

    expect(result.bos).toEqual([expect.objectContaining({ type: 'bullish', index: 3 })])
    expect(result.choch).toEqual([
      expect.objectContaining({
        type: 'bearish',
        index: 6,
        trendBefore: 'bullish',
        isPlus: false,
      }),
    ])
    expect(result.stateByLevel.internal.trend).toBe('bearish')
    expect(result.stateByLevel.internal.lastChoch).toEqual(result.choch[0])
  })

  it('bearish 状态下突破 high 生成 bullish CHoCH+', () => {
    const result = analyzeMarketStructure({
      bars: makeBars([100, 99, 98, 94, 93, 96, 97, 100, 101, 106]),
      swingPoints: makeSwingPoints({
        highs: [{ index: 7, price: 105, type: 'high' }],
        lows: [
          { index: 1, price: 95, type: 'low' },
          { index: 4, price: 90, type: 'low' },
          { index: 6, price: 95, type: 'low' },
        ],
      }),
      internalLookback: 1,
    })

    expect(result.bos).toEqual([expect.objectContaining({ type: 'bearish', index: 3 })])
    expect(result.choch).toEqual([
      expect.objectContaining({
        type: 'bullish',
        index: 9,
        trendBefore: 'bearish',
        isPlus: true,
      }),
    ])
    expect(result.stateByLevel.internal.trend).toBe('bullish')
  })

  it('bullish 状态下跌破 low 生成 bearish CHoCH+', () => {
    const result = analyzeMarketStructure({
      bars: makeBars([100, 101, 102, 106, 107, 105, 104, 100, 99, 94]),
      swingPoints: makeSwingPoints({
        highs: [
          { index: 1, price: 105, type: 'high' },
          { index: 4, price: 110, type: 'high' },
          { index: 6, price: 104, type: 'high' },
        ],
        lows: [{ index: 7, price: 95, type: 'low' }],
      }),
      internalLookback: 1,
    })

    expect(result.bos).toEqual([expect.objectContaining({ type: 'bullish', index: 3 })])
    expect(result.choch).toEqual([
      expect.objectContaining({
        type: 'bearish',
        index: 9,
        trendBefore: 'bullish',
        isPlus: true,
      }),
    ])
    expect(result.stateByLevel.internal.trend).toBe('bearish')
  })

})

function makeSwingPoints(points: {
  highs: Array<{ index: number; price: number; type: 'high' }>
  lows: Array<{ index: number; price: number; type: 'low' }>
}) {
  return {
    internal: points,
    swing: { highs: [], lows: [] },
    external: { highs: [], lows: [] },
  }
}

function makeBars(closes: number[]): OhlcvBar[] {
  return closes.map((close, index) => ({
    date: `2024-01-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  }))
}
