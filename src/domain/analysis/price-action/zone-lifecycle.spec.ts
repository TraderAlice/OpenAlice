import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import { evaluateZoneLifecycle } from './zone-lifecycle.js'

describe('evaluateZoneLifecycle', () => {
  it('tracks source-zone touch and mitigation without treating partial retrace as filled', () => {
    const result = evaluateZoneLifecycle({
      bars: [
        bar(100, 102, 98, 100, 0),
        bar(100, 120, 100, 120, 1),
        bar(120, 125, 114, 124, 2),
        bar(118, 119, 109, 110, 3),
      ],
      role: 'source_zone_retrace',
      direction: 'bullish',
      top: 114,
      bottom: 102,
      formedAtIndex: 1,
      confirmedAtIndex: 2,
      startIndex: 3,
      mitigationSource: 'body',
    })

    expect(result).toEqual(expect.objectContaining({
      state: 'mitigated',
      touched: true,
      mitigated: true,
      filled: false,
      fullyFilled: false,
      fillPercentage: 1 / 3,
      filledAtIndex: undefined,
    }))
    expect(result.lifecycle).toEqual(expect.objectContaining({
      firstTouchedAtIndex: 3,
      mitigatedAtIndex: 3,
      fillPercentage: 1 / 3,
      filledAtIndex: undefined,
      fullyFilledAtIndex: undefined,
    }))
  })

  it('uses filled state and filledAtIndex only for complete source-zone fill', () => {
    const result = evaluateZoneLifecycle({
      bars: [
        bar(100, 102, 98, 100, 0),
        bar(100, 120, 100, 120, 1),
        bar(120, 125, 114, 124, 2),
        bar(114, 115, 102, 102, 3),
      ],
      role: 'source_zone_retrace',
      direction: 'bullish',
      top: 114,
      bottom: 102,
      formedAtIndex: 1,
      confirmedAtIndex: 2,
      startIndex: 3,
      mitigationSource: 'body',
    })

    expect(result).toEqual(expect.objectContaining({
      state: 'filled',
      filled: true,
      fullyFilled: true,
      fillPercentage: 1,
      filledAtIndex: 3,
      fullyFilledAtIndex: 3,
    }))
  })

  it('tracks order-block touched state separately from mitigation', () => {
    const result = evaluateZoneLifecycle({
      bars: [
        bar(0, 0, 0, 0, 0),
        bar(96, 100, 94, 99, 1),
        bar(107, 116, 106, 115, 2),
        bar(96, 97, 90, 101, 3),
      ],
      role: 'order_block_retrace',
      direction: 'bullish',
      top: 106,
      bottom: 94,
      formedAtIndex: 1,
      confirmedAtIndex: 2,
      startIndex: 3,
      mitigationSource: 'body',
    })

    expect(result).toEqual(expect.objectContaining({
      state: 'touched',
      touched: true,
      mitigated: false,
    }))
    expect(result.lifecycle).toEqual(expect.objectContaining({
      firstTouchedAtIndex: 3,
      mitigatedAtIndex: undefined,
    }))
  })

  it('tracks breaker invalidation without source-zone fill fields', () => {
    const result = evaluateZoneLifecycle({
      bars: [
        bar(0, 0, 0, 0, 0),
        bar(114, 115, 101, 101, 1),
        bar(100, 116, 99, 116, 2),
      ],
      role: 'breaker_invalidation',
      direction: 'bearish',
      top: 114,
      bottom: 102,
      formedAtIndex: 1,
      confirmedAtIndex: 1,
      startIndex: 2,
      mitigationSource: 'body',
    })

    expect(result).toEqual(expect.objectContaining({
      state: 'invalidated',
      invalidated: true,
      invalidatedAtIndex: 2,
      filled: false,
    }))
    expect(result.lifecycle).toEqual({
      formedAtIndex: 1,
      confirmedAtIndex: 1,
      invalidatedAtIndex: 2,
    })
  })
})

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
