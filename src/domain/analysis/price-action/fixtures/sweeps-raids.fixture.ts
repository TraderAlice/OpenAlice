import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type { FairValueGap, SwingPointLevels } from '../types.js'

export function bar(open: number, high: number, low: number, close: number, index: number): OhlcvBar {
  return {
    date: `2024-01-01 09:${String(index).padStart(2, '0')}`,
    open,
    high,
    low,
    close,
    volume: 1000,
  }
}

export const swingSweepBars = [
  bar(100, 101, 99, 100, 0),
  bar(101, 110, 100, 105, 1),
  bar(105, 106, 101, 103, 2),
  bar(103, 112, 102, 109, 3),
]

export const bodyBreakBars = [
  bar(100, 101, 99, 100, 0),
  bar(101, 110, 100, 105, 1),
  bar(105, 106, 101, 103, 2),
  bar(109, 113, 108, 112, 3),
]

export const fvgRaidBars = [
  bar(100, 101, 99, 100, 0),
  bar(103, 106, 102, 105, 1),
  bar(108, 112, 107, 111, 2),
  bar(111, 113, 106, 110, 3),
]

export const sameBarMultiTargetBars = [
  bar(100, 101, 99, 100, 0),
  bar(101, 110, 100, 105, 1),
  bar(105, 109, 103, 106, 2),
  bar(109, 115, 108, 112, 3),
  bar(112, 114, 106, 109, 4),
]

export const swingTargets: SwingPointLevels = {
  internal: {
    highs: [{ index: 1, price: 110, type: 'high' }],
    lows: [{ index: 2, price: 101, type: 'low' }],
  },
  swing: {
    highs: [{ index: 1, price: 110, type: 'high' }],
    lows: [],
  },
  external: {
    highs: [],
    lows: [],
  },
}

export const duplicateSwingTargets: SwingPointLevels = {
  internal: {
    highs: [
      { index: 1, price: 110, type: 'high' },
      { index: 3, price: 112, type: 'high' },
    ],
    lows: [],
  },
  swing: {
    highs: [],
    lows: [],
  },
  external: {
    highs: [],
    lows: [],
  },
}

export const bullishFvgTarget: FairValueGap = {
  id: 'fvg-bullish-1',
  type: 'bullish',
  variant: 'FVG',
  kind: 'fvg',
  direction: 'bullish',
  top: 107,
  bottom: 101,
  midpoint: 104,
  formationIndex: 1,
  confirmationIndex: 2,
  formedAtIndex: 1,
  confirmedAtIndex: 2,
  size: 6,
  sizeAtr: 1.5,
  state: 'active',
  lifecycle: {
    formedAtIndex: 1,
    confirmedAtIndex: 2,
  },
  isFilled: false,
  fillPercentage: 0,
  completelyFilled: false,
}
