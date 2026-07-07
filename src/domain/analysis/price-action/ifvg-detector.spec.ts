import { describe, expect, it } from 'vitest'
import { detectInverseFVG } from './ifvg-detector.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type { BreakerZone } from './types.js'

describe('detectInverseFVG', () => {
  it('空 FVG 列表返回空数组', () => {
    const ifvgs = detectInverseFVG({
      bars: makeFlatBars(20),
      breakers: [],
    })

    expect(ifvgs).toEqual([])
  })

  it('数据少于指标周期时返回空数组', () => {
    const ifvgs = detectInverseFVG({
      bars: makeFlatBars(10),
      breakers: [makeBreaker({ formedAtIndex: 5, confirmedAtIndex: 5 })],
    })

    expect(ifvgs).toEqual([])
  })

  it('忽略非 FVG breaker', () => {
    const ifvgs = detectInverseFVG({
      bars: makeBullishReversalBars(),
      breakers: [makeBreaker({ kind: 'order_block_breaker' })],
    })

    expect(ifvgs).toEqual([])
  })

  it('检测看涨 iFVG（FVG breaker 出现同方向吞没和冲动确认）', () => {
    const breaker = makeBreaker({ id: 'brk-bull', direction: 'bullish', top: 114, bottom: 102, formedAtIndex: 20 })

    const ifvgs = detectInverseFVG({
      bars: makeBullishReversalBars(),
      breakers: [breaker],
    })

    expect(ifvgs).toHaveLength(1)
    expect(ifvgs[0]).toMatchObject({
      type: 'bullish_ifvg',
      variant: 'FVG',
      top: 114,
      bottom: 102,
      breakerId: 'brk-bull',
      source: {
        kind: 'fvg_breaker',
        id: 'brk-bull',
        index: 20,
      },
      reversalIndex: 20,
    })
    expect(ifvgs[0].impulseRatio).toBeGreaterThanOrEqual(1.5)
    expect(ifvgs[0].engulfingStrength).toBeGreaterThan(0)
  })

  it('检测看跌 iFVG（填补后出现同方向吞没和冲动反转）', () => {
    const breaker = makeBreaker({ id: 'brk-bear', direction: 'bearish', top: 115, bottom: 105, formedAtIndex: 20 })

    const ifvgs = detectInverseFVG({
      bars: makeBearishReversalBars(),
      breakers: [breaker],
    })

    expect(ifvgs).toHaveLength(1)
    expect(ifvgs[0]).toMatchObject({
      type: 'bearish_ifvg',
      variant: 'FVG',
      top: 115,
      bottom: 105,
      breakerId: 'brk-bear',
      source: {
        kind: 'fvg_breaker',
        id: 'brk-bear',
        index: 20,
      },
      reversalIndex: 20,
    })
    expect(ifvgs[0].impulseRatio).toBeGreaterThanOrEqual(1.5)
    expect(ifvgs[0].engulfingStrength).toBeGreaterThan(0)
  })

  it('吞没方向与原 FVG 方向不一致时不产生 iFVG', () => {
    const ifvgs = detectInverseFVG({
      bars: makeBearishReversalBars(),
      breakers: [makeBreaker({ direction: 'bullish', formedAtIndex: 20 })],
    })

    expect(ifvgs).toEqual([])
  })

  it('默认可检测填补后 10 根以外但仍靠近 gap 的反转', () => {
    const breaker = makeBreaker({ direction: 'bullish', top: 114, bottom: 102, formedAtIndex: 20 })

    const ifvgs = detectInverseFVG({
      bars: makeDelayedBullishReversalBars(),
      breakers: [breaker],
    })

    expect(ifvgs).toHaveLength(1)
    expect(ifvgs[0]).toMatchObject({
      type: 'bullish_ifvg',
      reversalIndex: 33,
    })
  })

  it('价格远离 FVG 区域后不继续搜索 iFVG', () => {
    const ifvgs = detectInverseFVG({
      bars: makeFarFromGapBars(),
      breakers: [makeBreaker({ direction: 'bullish', top: 114, bottom: 102, formedAtIndex: 20 })],
    })

    expect(ifvgs).toEqual([])
  })

  it('does not search for iFVG confirmation after the breaker has invalidated', () => {
    const ifvgs = detectInverseFVG({
      bars: makeDelayedBullishReversalBars(),
      breakers: [makeBreaker({
        direction: 'bullish',
        top: 114,
        bottom: 102,
        formedAtIndex: 20,
        lifecycle: { formedAtIndex: 20, confirmedAtIndex: 20, invalidatedAtIndex: 25 },
      })],
    })

    expect(ifvgs).toEqual([])
  })

  it('preserves the original gap variant for VI/OG inverse zones', () => {
    const breaker = makeBreaker({ source: { kind: 'vi', index: 1 }, direction: 'bullish', top: 114, bottom: 102, formedAtIndex: 20 })

    const ifvgs = detectInverseFVG({
      bars: makeBullishReversalBars(),
      breakers: [breaker],
    })

    expect(ifvgs[0]).toMatchObject({
      type: 'bullish_ifvg',
      variant: 'VI',
      source: expect.objectContaining({ kind: 'fvg_breaker' }),
    })
  })

  it('attaches reversal intrabar volume confirmation', () => {
    const breaker = makeBreaker({ direction: 'bullish', top: 114, bottom: 102, formedAtIndex: 20 })
    const volumeConfirmations = new Map([
      [20, {
        delta: 2500,
        deltaRatio: 0.75,
        coverage: 0.96,
        confidence: 'usable' as const,
        intrabarInterval: '1m',
        intrabarCount: 60,
      }],
    ])

    const ifvgs = detectInverseFVG({
      bars: makeBullishReversalBars(),
      breakers: [breaker],
      volumeConfirmations,
    })

    expect(ifvgs[0]).toEqual(expect.objectContaining({
      reversalVolumeConfirmation: expect.objectContaining({
        delta: 2500,
        deltaRatio: 0.75,
        alignedWithPattern: true,
      }),
    }))
  })
})

function makeBreaker(overrides: Partial<BreakerZone> = {}): BreakerZone {
  return {
    id: 'brk-1',
    kind: 'fvg_breaker',
    direction: 'bullish',
    top: 114,
    bottom: 102,
    midpoint: 108,
    size: 12,
    sizeAtr: 2,
    formedAtIndex: 20,
    confirmedAtIndex: 20,
    state: 'active',
    lifecycle: { formedAtIndex: 20, confirmedAtIndex: 20 },
    source: { kind: 'fvg', index: 1 },
    sourceDirection: 'bearish',
    sourceBrokenAtIndex: 20,
    ...overrides,
  }
}

function makeFlatBars(count: number): OhlcvBar[] {
  return Array.from({ length: count }, (_, index) => makeBar(index, 100, 101, 99, 100))
}

function makeBullishReversalBars(): OhlcvBar[] {
  const bars = makeFlatBars(22)

  bars[19] = makeBar(19, 105, 106, 100, 101)
  bars[20] = makeBar(20, 99, 112, 98, 111)

  return bars
}

function makeBearishReversalBars(): OhlcvBar[] {
  const bars = makeFlatBars(22)

  bars[19] = makeBar(19, 106, 110, 105, 109)
  bars[20] = makeBar(20, 111, 112, 98, 99)

  return bars
}

function makeDelayedBullishReversalBars(): OhlcvBar[] {
  const bars = makeFlatBars(35)

  bars[32] = makeBar(32, 105, 106, 100, 101)
  bars[33] = makeBar(33, 99, 112, 98, 111)

  return bars
}

function makeFarFromGapBars(): OhlcvBar[] {
  const bars = makeFlatBars(24)

  bars[20] = makeBar(20, 149, 152, 148, 150)
  bars[21] = makeBar(21, 99, 112, 98, 111)

  return bars
}

function makeBar(index: number, open: number, high: number, low: number, close: number): OhlcvBar {
  return {
    date: `2024-01-${String(index + 1).padStart(2, '0')}`,
    open,
    high,
    low,
    close,
    volume: 1000,
  }
}
