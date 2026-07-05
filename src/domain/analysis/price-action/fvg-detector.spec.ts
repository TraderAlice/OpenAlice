import { describe, it, expect } from 'vitest'
import { detectFairValueGaps } from './fvg-detector.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types'

describe('detectFairValueGaps', () => {
  it('检测看涨 FVG (bars[0].low > bars[2].high)', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },  // 第1根
      { date: '2024-01-01 09:05', open: 100, high: 115, low: 100, close: 115, volume: 2000 }, // 中间根（强势上涨）
      { date: '2024-01-01 09:10', open: 115, high: 120, low: 114, close: 118, volume: 1000 }, // 第3根
      // bars[0].low=98 < bars[2].high=120, 不符合
      // 应该是 bars[i].low > bars[i+2].high，即 bars[2].low > bars[0].high
      // bars[2].low=114 > bars[0].high=102 ✓
    ]

    const fvgs = detectFairValueGaps({ bars })

    expect(fvgs).toHaveLength(1)
    expect(fvgs[0].type).toBe('bullish')
    expect(fvgs[0].variant).toBe('FVG')
    expect(fvgs[0].top).toBe(114) // bars[2].low (第3根的低点)
    expect(fvgs[0].bottom).toBe(102) // bars[0].high (第1根的高点)
    expect(fvgs[0].formationIndex).toBe(1) // 中间 K 线索引
    expect(fvgs[0].confirmationIndex).toBe(2) // 第三根 K 线确认 signal 可用
    expect(fvgs[0].size).toBe(12)
  })

  it('检测看跌 FVG (bars[2].low > bars[0].high)', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 120, high: 120, low: 115, close: 118, volume: 1000 }, // 第1根
      { date: '2024-01-01 09:05', open: 118, high: 118, low: 100, close: 100, volume: 2000 }, // 中间根（强势下跌）
      { date: '2024-01-01 09:10', open: 100, high: 105, low: 95, close: 98, volume: 1000 },   // 第3根
      // bars[2].low=95 < bars[0].high=120，不符合
      // 应该是 bars[i+2].low > bars[i].high，即 bars[0].low > bars[2].high
      // bars[0].low=115 > bars[2].high=105 ✓
    ]

    const fvgs = detectFairValueGaps({ bars })

    expect(fvgs).toHaveLength(1)
    expect(fvgs[0].type).toBe('bearish')
    expect(fvgs[0].top).toBe(115) // bars[0].low (第1根的低点)
    expect(fvgs[0].bottom).toBe(105) // bars[2].high (第3根的高点)
    expect(fvgs[0].formationIndex).toBe(1)
    expect(fvgs[0].confirmationIndex).toBe(2)
    expect(fvgs[0].size).toBe(10)
  })

  it('FVG 未被填补时返回 isFilled=false', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 115, low: 100, close: 115, volume: 2000 },
      { date: '2024-01-01 09:10', open: 115, high: 120, low: 114, close: 118, volume: 1000 },
      // Gap: top=114, bottom=102 (看涨FVG)
      // 后续价格持续上涨，未回到 gap
      { date: '2024-01-01 09:15', open: 118, high: 125, low: 118, close: 125, volume: 1000 },
    ]

    const fvgs = detectFairValueGaps({ bars })

    expect(fvgs[0].isFilled).toBe(false)
    expect(fvgs[0].fillPercentage).toBe(0)
    expect(fvgs[0].filledAtIndex).toBeUndefined()
    expect(fvgs[0].completelyFilled).toBe(false)
  })

  it('看涨 FVG 部分填补（收盘价进入 gap 但未完全穿透）', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },  // 第1根
      { date: '2024-01-01 09:05', open: 100, high: 120, low: 100, close: 120, volume: 2000 }, // 中间根
      { date: '2024-01-01 09:10', open: 120, high: 125, low: 114, close: 125, volume: 1000 }, // 第3根
      // Gap: top=114, bottom=102
      // 回撤到 gap 内
      { date: '2024-01-01 09:15', open: 125, high: 125, low: 105, close: 107, volume: 1000 }, // 收盘 107，进入 gap
    ]

    const fvgs = detectFairValueGaps({ bars })

    expect(fvgs[0].type).toBe('bullish')
    expect(fvgs[0].top).toBe(114)
    expect(fvgs[0].bottom).toBe(102)
    expect(fvgs[0].isFilled).toBe(true)
    expect(fvgs[0].filledAtIndex).toBe(3)
    // fillPercentage = (114 - 107) / (114 - 102) = 7 / 12 ≈ 0.583
    expect(fvgs[0].fillPercentage).toBeCloseTo(0.583, 2)
    expect(fvgs[0].completelyFilled).toBe(false)
  })

  it('看涨 FVG 完全填补（收盘价穿透 gap 到达 bottom 以下）', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 120, low: 100, close: 120, volume: 2000 },
      { date: '2024-01-01 09:10', open: 120, high: 125, low: 114, close: 125, volume: 1000 },
      // Gap: top=114, bottom=102
      { date: '2024-01-01 09:15', open: 125, high: 125, low: 95, close: 98, volume: 1000 }, // 收盘 98 < bottom 102
    ]

    const fvgs = detectFairValueGaps({ bars })

    expect(fvgs[0].isFilled).toBe(true)
    expect(fvgs[0].fillPercentage).toBe(1.0)
    expect(fvgs[0].completelyFilled).toBe(true)
  })

  it('看跌 FVG 完全填补（收盘价穿透 gap 到达 top 以上）', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 120, high: 120, low: 115, close: 118, volume: 1000 },
      { date: '2024-01-01 09:05', open: 118, high: 118, low: 100, close: 100, volume: 2000 },
      { date: '2024-01-01 09:10', open: 100, high: 105, low: 95, close: 98, volume: 1000 },
      // Gap: top=115, bottom=105
      { date: '2024-01-01 09:15', open: 98, high: 122, low: 98, close: 120, volume: 1000 }, // 收盘 120 > top 115
    ]

    const fvgs = detectFairValueGaps({ bars })

    expect(fvgs).toHaveLength(1)
    expect(fvgs[0].type).toBe('bearish')
    expect(fvgs[0].isFilled).toBe(true)
    expect(fvgs[0].fillPercentage).toBe(1.0)
    expect(fvgs[0].completelyFilled).toBe(true)
  })

  it('过滤最小 gap 大小', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 100.5, low: 100.5, close: 100.2, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100.2, high: 101, low: 100.2, close: 101, volume: 2000 },
      { date: '2024-01-01 09:10', open: 101, high: 101.2, low: 100, close: 101.2, volume: 1000 },
      // Gap size = 0.5 - 0 = 0.5
    ]

    const fvgs = detectFairValueGaps({ bars, minGapSize: 1.0 })

    // 应该被过滤掉
    expect(fvgs).toHaveLength(0)
  })

  it('过滤中间 K 线实体占比不足', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      // 中间 K 线：open=100, close=105, high=125, low=100
      // 实体=5，总range=25，实体占比=20%
      { date: '2024-01-01 09:05', open: 100, high: 125, low: 100, close: 105, volume: 2000 },
      { date: '2024-01-01 09:10', open: 105, high: 130, low: 114, close: 130, volume: 1000 },
      // Gap: top=114, bottom=102, size=12 (符合条件)
    ]

    const fvgs = detectFairValueGaps({ bars, minBodyRatio: 0.7 })

    // 实体占比 20% < 70%，应该被过滤
    expect(fvgs).toHaveLength(0)
  })

  it('正确的看涨 FVG 示例', () => {
    const bars: OhlcvBar[] = [
      // 设置一个清晰的看涨 FVG
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },   // 第1根
      { date: '2024-01-01 09:05', open: 100, high: 115, low: 100, close: 115, volume: 2000 },  // 中间根（强势上涨）
      { date: '2024-01-01 09:10', open: 115, high: 120, low: 114, close: 118, volume: 1000 },  // 第3根
      // bars[2].low=114 > bars[0].high=102 → 成立！
    ]

    const fvgs = detectFairValueGaps({ bars })

    expect(fvgs).toHaveLength(1)
    expect(fvgs[0].type).toBe('bullish')
    expect(fvgs[0].bottom).toBe(102) // bars[0].high
    expect(fvgs[0].top).toBe(114)    // bars[2].low
    expect(fvgs[0].size).toBe(12)
  })

  it('空数据返回空数组', () => {
    const fvgs = detectFairValueGaps({ bars: [] })
    expect(fvgs).toEqual([])
  })

  it('少于 3 根 K 线返回空数组', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 105, low: 99, close: 104, volume: 1000 },
      { date: '2024-01-02', open: 104, high: 106, low: 103, close: 105, volume: 1000 },
    ]

    const fvgs = detectFairValueGaps({ bars })
    expect(fvgs).toEqual([])
  })

  it('wick mitigation can mark a gap filled even when close stays outside', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 120, low: 100, close: 120, volume: 2000 },
      { date: '2024-01-01 09:10', open: 120, high: 125, low: 114, close: 125, volume: 1000 },
      { date: '2024-01-01 09:15', open: 125, high: 126, low: 99, close: 121, volume: 1000 },
    ]

    expect(detectFairValueGaps({ bars })[0].isFilled).toBe(false)
    expect(detectFairValueGaps({ bars, mitigationSource: 'wick' })[0]).toMatchObject({
      isFilled: true,
      completelyFilled: true,
      filledAtIndex: 3,
    })
  })

  it('detects bullish VI body gap', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 98, high: 101, low: 97, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 104, low: 99, close: 102, volume: 1000 },
      { date: '2024-01-01 09:10', open: 106, high: 110, low: 103, close: 108, volume: 1000 },
    ]

    const fvgs = detectFairValueGaps({ bars, gapMode: 'VI' })

    expect(fvgs).toEqual([
      expect.objectContaining({
        type: 'bullish',
        variant: 'VI',
        top: 106,
        bottom: 102,
        formationIndex: 2,
        confirmationIndex: 2,
      }),
    ])
  })

  it('detects opening gaps', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 98, high: 101, low: 97, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 104, low: 99, close: 102, volume: 1000 },
      { date: '2024-01-01 09:10', open: 110, high: 112, low: 108, close: 111, volume: 1000 },
    ]

    const fvgs = detectFairValueGaps({ bars, gapMode: 'OG' })

    expect(fvgs).toEqual([
      expect.objectContaining({
        type: 'bullish',
        variant: 'OG',
        top: 108,
        bottom: 104,
        formationIndex: 2,
        confirmationIndex: 2,
      }),
    ])
  })

  it('attaches formation intrabar volume confirmation', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 115, low: 100, close: 115, volume: 2000 },
      { date: '2024-01-01 09:10', open: 115, high: 120, low: 114, close: 118, volume: 1000 },
    ]
    const volumeConfirmations = new Map([
      [2, {
        delta: 1800,
        deltaRatio: 0.9,
        coverage: 0.99,
        confidence: 'high' as const,
        intrabarInterval: '1m',
        intrabarCount: 15,
      }],
    ])

    const fvgs = detectFairValueGaps({ bars, volumeConfirmations })

    expect(fvgs[0]).toEqual(expect.objectContaining({
      formationVolumeConfirmation: expect.objectContaining({
        delta: 1800,
        deltaRatio: 0.9,
        alignedWithPattern: true,
      }),
      confirmationIndex: 2,
    }))
  })

  it('uses full-bars absolute indices for volume confirmation lookup', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { date: '2024-01-01 09:10', open: 101, high: 103, low: 100, close: 102, volume: 1000 },
      { date: '2024-01-01 09:15', open: 102, high: 112, low: 101, close: 111, volume: 2000 },
      { date: '2024-01-01 09:20', open: 111, high: 118, low: 114, close: 116, volume: 1000 },
    ]
    const volumeConfirmations = new Map([
      [4, {
        delta: 1200,
        deltaRatio: 0.6,
        coverage: 0.95,
        confidence: 'usable' as const,
        intrabarInterval: '1m',
        intrabarCount: 10,
      }],
    ])

    const fvgs = detectFairValueGaps({ bars, volumeConfirmations })

    expect(fvgs[0]).toEqual(expect.objectContaining({
      formationIndex: 3,
      confirmationIndex: 4,
      formationVolumeConfirmation: expect.objectContaining({ delta: 1200 }),
    }))
  })
})
