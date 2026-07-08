import { describe, it, expect } from 'vitest'
import { detectFairValueGaps, detectFairValueGapsWithMeta } from './fvg-detector.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'

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
    expect(fvgs[0].state).toBe('mitigated')
    expect(fvgs[0].isFilled).toBe(false)
    expect(fvgs[0].filledAtIndex).toBeUndefined()
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

  it('filters gaps smaller than the ATR multiplier threshold', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 104, low: 96, close: 102, volume: 1000 },
      { date: '2024-01-01 09:05', open: 102, high: 108, low: 100, close: 108, volume: 2000 },
      { date: '2024-01-01 09:10', open: 108, high: 112, low: 108, close: 110, volume: 1000 },
    ]

    const fvgs = detectFairValueGaps({
      bars,
      minGapAtrMultiplier: 0.51,
    })

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

  it('wick zone mitigation can mark a gap filled even when the body stays outside', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 120, low: 100, close: 120, volume: 2000 },
      { date: '2024-01-01 09:10', open: 120, high: 125, low: 114, close: 125, volume: 1000 },
      { date: '2024-01-01 09:15', open: 125, high: 126, low: 99, close: 121, volume: 1000 },
    ]

    expect(detectFairValueGaps({ bars })[0].isFilled).toBe(false)
    expect(detectFairValueGaps({ bars, zoneMitigationSource: 'wick' })[0]).toMatchObject({
      isFilled: true,
      completelyFilled: true,
      filledAtIndex: 3,
    })
  })

  it('body zone mitigation uses the adverse body edge', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 120, low: 100, close: 120, volume: 2000 },
      { date: '2024-01-01 09:10', open: 120, high: 125, low: 114, close: 125, volume: 1000 },
      { date: '2024-01-01 09:15', open: 112, high: 126, low: 108, close: 121, volume: 1000 },
    ]

    const fvg = detectFairValueGaps({ bars, zoneMitigationSource: 'body' })[0]

    expect(fvg).toMatchObject({
      isFilled: false,
      filledAtIndex: undefined,
      completelyFilled: false,
    })
    expect(fvg.fillPercentage).toBeCloseTo((114 - 112) / 12, 2)
  })

  it('midpoint zone mitigation is reached by body price rather than close only', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01 09:00', open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2024-01-01 09:05', open: 100, high: 120, low: 100, close: 120, volume: 2000 },
      { date: '2024-01-01 09:10', open: 120, high: 125, low: 114, close: 125, volume: 1000 },
      { date: '2024-01-01 09:15', open: 107, high: 126, low: 106, close: 121, volume: 1000 },
    ]

    expect(detectFairValueGaps({ bars, zoneMitigationSource: 'body' })[0].completelyFilled).toBe(false)
    expect(detectFairValueGaps({ bars, zoneMitigationSource: 'midpoint' })[0]).toMatchObject({
      state: 'mitigated',
      isFilled: false,
      completelyFilled: false,
      filledAtIndex: undefined,
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

  it('returns envelope fields plus raw and ATR-normalized size for FVG, VI, and OG', () => {
    expect(detectFairValueGaps({ bars: atrThresholdFixture('FVG'), gapMode: 'FVG' })[0]).toEqual(expect.objectContaining({
      kind: 'fvg',
      direction: 'bullish',
      midpoint: 106,
      formedAtIndex: 1,
      confirmedAtIndex: 2,
      state: 'active',
      size: 4,
      sizeAtr: 0.5,
      lifecycle: expect.objectContaining({
        formedAtIndex: 1,
        confirmedAtIndex: 2,
        fillPercentage: 0,
      }),
    }))

    expect(detectFairValueGaps({ bars: atrThresholdFixture('VI'), gapMode: 'VI' })[0]).toEqual(expect.objectContaining({
      kind: 'vi',
      direction: 'bullish',
      top: 106,
      bottom: 102,
      midpoint: 104,
      size: 4,
      sizeAtr: expect.any(Number),
    }))

    expect(detectFairValueGaps({ bars: atrThresholdFixture('OG'), gapMode: 'OG' })[0]).toEqual(expect.objectContaining({
      kind: 'og',
      direction: 'bullish',
      top: 108,
      bottom: 104,
      midpoint: 106,
      size: 4,
      sizeAtr: expect.any(Number),
    }))
  })

  it('applies minGapAtrMultiplier after each gap family computes its natural bounds', () => {
    expect(detectFairValueGaps({ bars: atrThresholdFixture('FVG'), gapMode: 'FVG', minGapAtrMultiplier: 0.5 })).toHaveLength(1)
    expect(detectFairValueGaps({ bars: atrThresholdFixture('FVG'), gapMode: 'FVG', minGapAtrMultiplier: 0.51 })).toHaveLength(0)

    expect(detectFairValueGaps({ bars: atrThresholdFixture('VI'), gapMode: 'VI', minGapAtrMultiplier: 0.5 })).toHaveLength(1)
    expect(detectFairValueGaps({ bars: atrThresholdFixture('VI'), gapMode: 'VI', minGapAtrMultiplier: 0.51 })).toHaveLength(0)

    expect(detectFairValueGaps({ bars: atrThresholdFixture('OG'), gapMode: 'OG', minGapAtrMultiplier: 0.5 })).toHaveLength(1)
    expect(detectFairValueGaps({ bars: atrThresholdFixture('OG'), gapMode: 'OG', minGapAtrMultiplier: 0.51 })).toHaveLength(0)
  })

  it('tracks touched lifecycle when wick enters the zone but body does not mitigate', () => {
    const fvgs = detectFairValueGaps({ bars: zoneSourceFixture('wick-touch'), zoneMitigationSource: 'body' })

    expect(fvgs[0]).toEqual(expect.objectContaining({
      state: 'touched',
      isFilled: false,
      fillPercentage: 0,
      lifecycle: expect.objectContaining({
        firstTouchedAtIndex: 3,
        lastTouchedAtIndex: 3,
        currentlyInside: true,
        mitigatedAtIndex: undefined,
      }),
    }))
  })

  it('uses body adverse edge for body mitigation', () => {
    const fvgs = detectFairValueGaps({ bars: zoneSourceFixture('body-mitigated'), zoneMitigationSource: 'body' })

    expect(fvgs[0]).toEqual(expect.objectContaining({
      state: 'mitigated',
      isFilled: false,
      filledAtIndex: undefined,
      fillPercentage: 1 / 3,
      completelyFilled: false,
      lifecycle: expect.objectContaining({
        firstTouchedAtIndex: 3,
        mitigatedAtIndex: 3,
        fillPercentage: 1 / 3,
      }),
    }))
  })

  it('uses wick extreme for wick mitigation', () => {
    const fvgs = detectFairValueGaps({ bars: zoneSourceFixture('wick-touch'), zoneMitigationSource: 'wick' })

    expect(fvgs[0]).toEqual(expect.objectContaining({
      state: 'mitigated',
      isFilled: false,
      fillPercentage: 1 / 3,
      filledAtIndex: undefined,
      lifecycle: expect.objectContaining({
        firstTouchedAtIndex: 3,
        mitigatedAtIndex: 3,
      }),
    }))
  })

  it('uses zone midpoint reached by body price for midpoint mitigation', () => {
    const fvgs = detectFairValueGaps({ bars: zoneSourceFixture('midpoint-mitigated'), zoneMitigationSource: 'midpoint' })

    expect(fvgs[0]).toEqual(expect.objectContaining({
      state: 'mitigated',
      midpoint: 108,
      fillPercentage: 7 / 12,
      completelyFilled: false,
      lifecycle: expect.objectContaining({
        mitigatedAtIndex: 3,
      }),
    }))
  })

  it('filters filled zones by default and can include them for diagnostics', () => {
    expect(detectFairValueGaps({ bars: lifecycleFixture('filled'), zoneMitigationSource: 'body' })).toHaveLength(0)

    expect(detectFairValueGaps({ bars: lifecycleFixture('filled'), zoneMitigationSource: 'body', includeResolved: true })[0]).toEqual(expect.objectContaining({
      state: 'filled',
      completelyFilled: true,
      lifecycle: expect.objectContaining({
        filledAtIndex: 3,
        fullyFilledAtIndex: 3,
      }),
    }))
  })

  it('marks a zone broken when the selected source crosses the far edge', () => {
    const fvgs = detectFairValueGaps({ bars: lifecycleFixture('broken'), zoneMitigationSource: 'body' })

    expect(fvgs[0]).toEqual(expect.objectContaining({
      state: 'broken',
      completelyFilled: true,
      lifecycle: expect.objectContaining({
        brokenAtIndex: 3,
      }),
    }))
  })

  it('filters same-bucket overlapping FVGs with ranked policy by default and reports staged meta', () => {
    const result = detectFairValueGapsWithMeta({
      bars: overlapFixture(),
      zoneMitigationSource: 'body',
    })

    expect(result.fvgs).toEqual([
      expect.objectContaining({
        kind: 'fvg',
        direction: 'bullish',
        top: 110,
        bottom: 100,
        state: 'touched',
      }),
    ])
    expect(result.meta).toEqual({
      detectedCount: 2,
      lifecycleFilteredCount: 0,
      overlapFilteredCount: 1,
      returnedCount: 1,
    })

    expect(detectFairValueGaps({
      bars: overlapFixture(),
      zoneMitigationSource: 'body',
      overlapPolicy: 'none',
    })).toHaveLength(2)
  })

  it('keeps cross-family and opposite-direction overlaps in separate groups', () => {
    const fvgs = detectFairValueGaps({
      bars: crossGroupOverlapFixture(),
      gapMode: 'all',
      zoneMitigationSource: 'body',
    })

    expect(fvgs.map((fvg) => `${fvg.variant}:${fvg.type}`)).toContain('FVG:bullish')
    expect(fvgs.map((fvg) => `${fvg.variant}:${fvg.type}`)).toContain('OG:bullish')
    expect(fvgs.map((fvg) => `${fvg.variant}:${fvg.type}`)).toContain('FVG:bearish')
  })
})

function atrThresholdFixture(variant: 'FVG' | 'VI' | 'OG'): OhlcvBar[] {
  if (variant === 'FVG') {
    return [
      bar(100, 104, 96, 102, 0),
      bar(102, 108, 100, 108, 1),
      bar(108, 112, 108, 110, 2),
    ]
  }

  if (variant === 'VI') {
    return [
      bar(98, 101, 97, 100, 0),
      bar(100, 104, 96, 102, 1),
      bar(106, 114, 103, 110, 2),
    ]
  }

  return [
    bar(98, 101, 97, 100, 0),
    bar(100, 104, 96, 102, 1),
    bar(110, 114, 108, 111, 2),
  ]
}

function zoneSourceFixture(kind: 'wick-touch' | 'body-mitigated' | 'midpoint-mitigated'): OhlcvBar[] {
  const tail = {
    'wick-touch': bar(118, 119, 110, 118, 3),
    'body-mitigated': bar(118, 119, 109, 110, 3),
    'midpoint-mitigated': bar(118, 119, 106, 107, 3),
  }[kind]

  return [
    bar(100, 102, 98, 100, 0),
    bar(100, 120, 100, 120, 1),
    bar(120, 125, 114, 124, 2),
    tail,
  ]
}

function lifecycleFixture(kind: 'filled' | 'broken'): OhlcvBar[] {
  return [
    bar(100, 102, 98, 100, 0),
    bar(100, 120, 100, 120, 1),
    bar(120, 125, 114, 124, 2),
    kind === 'filled' ? bar(114, 115, 102, 102, 3) : bar(114, 115, 101, 101, 3),
  ]
}

function overlapFixture(): OhlcvBar[] {
  return [
    bar(95, 100, 90, 98, 0),
    bar(98, 105, 97, 104, 1),
    bar(104, 112, 110, 111, 2),
    bar(111, 115, 106, 114, 3),
    bar(111, 112, 105.5, 112, 4),
  ]
}

function crossGroupOverlapFixture(): OhlcvBar[] {
  return [
    bar(95, 100, 90, 98, 0),
    bar(98, 105, 97, 104, 1),
    bar(108, 112, 108, 111, 2),
    bar(111, 113, 106, 112, 3),
    bar(112, 114, 107, 113, 4),
    bar(113, 116, 95, 96, 5),
    bar(96, 97, 92, 93, 6),
    bar(93, 95, 90, 91, 7),
  ]
}

function bar(open: number, high: number, low: number, close: number, index: number): OhlcvBar {
  return {
    date: `2024-01-01 09:${String(index).padStart(2, '0')}`,
    open,
    high,
    low,
    close,
    volume: 1000,
  }
}
