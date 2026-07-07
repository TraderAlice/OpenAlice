import { describe, expect, it } from 'vitest'
import { detectBreakers } from './breaker-detector.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type { FairValueGap, OrderBlock } from './types.js'

describe('detectBreakers', () => {
  it('creates a bearish FVG breaker only after a bullish FVG breaks through its far edge', () => {
    const fvg = makeFVG({
      id: 'fvg-a',
      type: 'bullish',
      direction: 'bullish',
      top: 114,
      bottom: 102,
      midpoint: 108,
      size: 12,
      lifecycle: {
        formedAtIndex: 1,
        confirmedAtIndex: 2,
        mitigatedAtIndex: 3,
        brokenAtIndex: 4,
      },
    })

    const breakers = detectBreakers({
      bars: makeBars([
        [120, 122, 118, 121],
        [121, 123, 119, 122],
        [122, 124, 114, 116],
        [116, 117, 106, 108],
        [108, 109, 98, 100],
      ]),
      fvgs: [fvg],
      orderBlocks: [],
      fvgZoneMitigationSource: 'body',
    })

    expect(breakers).toEqual([
      expect.objectContaining({
        kind: 'fvg_breaker',
        direction: 'bearish',
        top: 114,
        bottom: 102,
        midpoint: 108,
        size: 12,
        formedAtIndex: 4,
        confirmedAtIndex: 4,
        state: 'active',
        source: {
          kind: 'fvg',
          id: 'fvg-a',
          index: 1,
        },
        sourceDirection: 'bullish',
        sourceBrokenAtIndex: 4,
      }),
    ])
  })

  it('does not create a breaker from midpoint-only source mitigation', () => {
    const breakers = detectBreakers({
      bars: makeBars([
        [120, 122, 118, 121],
        [121, 123, 119, 122],
        [122, 124, 114, 116],
        [116, 117, 106, 108],
      ]),
      fvgs: [
        makeFVG({
          lifecycle: {
            formedAtIndex: 1,
            confirmedAtIndex: 2,
            mitigatedAtIndex: 3,
            brokenAtIndex: 3,
          },
        }),
      ],
      orderBlocks: [],
      fvgZoneMitigationSource: 'midpoint',
    })

    expect(breakers).toEqual([])
  })

  it('creates a bullish order-block breaker when a bearish OB breaks upward', () => {
    const ob = makeOrderBlock({
      type: 'bearish',
      top: 125,
      bottom: 116,
      middle: 120.5,
      size: 9,
      index: 4,
      breakoutIndex: 6,
      mitigated: true,
      mitigatedAtIndex: 7,
    })

    const breakers = detectBreakers({
      bars: makeBars([
        [120, 122, 118, 119],
        [119, 121, 117, 118],
        [118, 120, 116, 117],
        [117, 124, 116, 123],
        [123, 125, 120, 121],
        [121, 122, 110, 111],
        [111, 112, 104, 105],
        [121, 130, 120, 128],
      ]),
      fvgs: [],
      orderBlocks: [ob],
      orderBlockZoneMitigationSource: 'body',
    })

    expect(breakers).toEqual([
      expect.objectContaining({
        kind: 'order_block_breaker',
        direction: 'bullish',
        top: 125,
        bottom: 116,
        midpoint: 120.5,
        size: 9,
        formedAtIndex: 7,
        source: {
          kind: 'order_block',
          index: 4,
          level: 'swing',
        },
        sourceDirection: 'bearish',
        sourceBrokenAtIndex: 7,
      }),
    ])
  })

  it('invalidates only after price crosses back through the breaker far edge', () => {
    const fvg = makeFVG({
      type: 'bullish',
      direction: 'bullish',
      top: 114,
      bottom: 102,
      midpoint: 108,
      size: 12,
      lifecycle: {
        formedAtIndex: 1,
        confirmedAtIndex: 2,
        brokenAtIndex: 3,
      },
    })

    const breakers = detectBreakers({
      bars: makeBars([
        [120, 122, 118, 121],
        [121, 123, 119, 122],
        [122, 124, 114, 116],
        [108, 109, 98, 100],
        [100, 112, 99, 110],
        [110, 118, 109, 116],
      ]),
      fvgs: [fvg],
      orderBlocks: [],
      fvgZoneMitigationSource: 'body',
    })

    expect(breakers).toEqual([
      expect.objectContaining({
        direction: 'bearish',
        state: 'invalidated',
        lifecycle: expect.objectContaining({
          invalidatedAtIndex: 5,
        }),
      }),
    ])
  })
})

function makeFVG(overrides: Partial<FairValueGap> = {}): FairValueGap {
  return {
    id: 'fvg-1',
    kind: 'fvg',
    direction: 'bullish',
    type: 'bullish',
    variant: 'FVG',
    top: 114,
    bottom: 102,
    midpoint: 108,
    sizeAtr: 2,
    formedAtIndex: 1,
    formationIndex: 1,
    confirmedAtIndex: 2,
    confirmationIndex: 2,
    size: 12,
    state: 'broken',
    lifecycle: { formedAtIndex: 1, confirmedAtIndex: 2, brokenAtIndex: 4 },
    isFilled: true,
    fillPercentage: 1,
    filledAtIndex: 4,
    completelyFilled: true,
    ...overrides,
  }
}

function makeOrderBlock(overrides: Partial<OrderBlock> = {}): OrderBlock {
  return {
    type: 'bearish',
    level: 'swing',
    trigger: 'CHoCH',
    top: 125,
    bottom: 116,
    middle: 120.5,
    index: 4,
    breakoutIndex: 6,
    breakoutPrice: 105,
    brokenSwing: { index: 2, price: 116, type: 'low' },
    volume: 1000,
    candleDirection: 'bearish',
    mitigated: true,
    mitigatedAtIndex: 7,
    size: 9,
    ...overrides,
  }
}

function makeBars(values: Array<[number, number, number, number]>): OhlcvBar[] {
  return values.map(([open, high, low, close], index) => ({
    date: `2024-01-${String(index + 1).padStart(2, '0')}`,
    open,
    high,
    low,
    close,
    volume: 1000,
  }))
}
