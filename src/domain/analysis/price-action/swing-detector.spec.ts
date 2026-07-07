import { describe, it, expect } from 'vitest'
import { detectSwingPoints } from './swing-detector.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'

describe('detectSwingPoints', () => {
  it('检测 Swing High（中心高点大于左右邻近高点）', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 104, low: 99, close: 102, volume: 1000 },
      { date: '2024-01-03', open: 102, high: 110, low: 101, close: 108, volume: 1000 }, // Swing High
      { date: '2024-01-04', open: 108, high: 107, low: 105, close: 106, volume: 1000 },
      { date: '2024-01-05', open: 106, high: 105, low: 103, close: 104, volume: 1000 },
    ]

    const result = detectSwingPoints({ bars, internalLookback: 2 })

    expect(result.internal.highs).toHaveLength(1)
    expect(result.internal.highs[0].index).toBe(2)
    expect(result.internal.highs[0].price).toBe(110)
    expect(result.internal.highs[0].type).toBe('high')
  })

  it('检测 Swing Low（中心低点小于左右邻近低点）', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 99, low: 96, close: 97, volume: 1000 },
      { date: '2024-01-03', open: 97, high: 98, low: 90, close: 92, volume: 1000 }, // Swing Low
      { date: '2024-01-04', open: 92, high: 95, low: 91, close: 94, volume: 1000 },
      { date: '2024-01-05', open: 94, high: 96, low: 93, close: 95, volume: 1000 },
    ]

    const result = detectSwingPoints({ bars, internalLookback: 2 })

    expect(result.internal.lows).toHaveLength(1)
    expect(result.internal.lows[0].index).toBe(2)
    expect(result.internal.lows[0].price).toBe(90)
    expect(result.internal.lows[0].type).toBe('low')
  })

  it('返回三个层级的 Swing 点', () => {
    const bars: OhlcvBar[] = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: 100 + Math.sin(i / 3) * 20,
      high: 110 + Math.sin(i / 3) * 20,
      low: 90 + Math.sin(i / 3) * 20,
      close: 100 + Math.sin(i / 3) * 20,
      volume: 1000,
    }))

    const result = detectSwingPoints({ bars })

    expect(result).toHaveProperty('internal')
    expect(result).toHaveProperty('swing')
    expect(result).toHaveProperty('external')
    // 至少检查结构正确
    expect(Array.isArray(result.internal.highs)).toBe(true)
    expect(Array.isArray(result.swing.highs)).toBe(true)
    expect(Array.isArray(result.external.highs)).toBe(true)
  })

  it('空数据返回空数组', () => {
    const result = detectSwingPoints({ bars: [] })

    expect(result.internal.highs).toEqual([])
    expect(result.internal.lows).toEqual([])
  })

  it('数据不足返回空数组（需要左右各 lookback 根）', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 104, low: 99, close: 102, volume: 1000 },
    ]

    const result = detectSwingPoints({ bars, internalLookback: 5 })

    // 需要至少 5 + 1 + 5 = 11 根K线
    expect(result.internal.highs).toEqual([])
    expect(result.internal.lows).toEqual([])
  })

  it('保留等高和等低窗口的原有 swing 语义', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { date: '2024-01-03', open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { date: '2024-01-04', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    ]

    const result = detectSwingPoints({ bars, internalLookback: 1 })

    expect(result.internal.highs.map((point) => point.index)).toEqual([1, 2])
    expect(result.internal.lows.map((point) => point.index)).toEqual([1, 2])
  })
})
