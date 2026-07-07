import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type { SwingPointLevels } from '../types.js'
import { bar } from './sweeps-raids.fixture.js'

export const emptySwingPoints: SwingPointLevels = {
  internal: { highs: [], lows: [] },
  swing: { highs: [], lows: [] },
  external: { highs: [], lows: [] },
}

export const eqhSwingPoints: SwingPointLevels = {
  internal: {
    highs: [
      { index: 1, price: 100, type: 'high' },
      { index: 3, price: 100.08, type: 'high' },
    ],
    lows: [],
  },
  swing: { highs: [], lows: [] },
  external: { highs: [], lows: [] },
}

export const eqlSwingPoints: SwingPointLevels = {
  internal: {
    highs: [],
    lows: [
      { index: 1, price: 100, type: 'low' },
      { index: 3, price: 99.92, type: 'low' },
    ],
  },
  swing: { highs: [], lows: [] },
  external: { highs: [], lows: [] },
}

export const outsideToleranceSwingPoints: SwingPointLevels = {
  internal: {
    highs: [
      { index: 1, price: 100, type: 'high' },
      { index: 3, price: 100.11, type: 'high' },
    ],
    lows: [],
  },
  swing: { highs: [], lows: [] },
  external: { highs: [], lows: [] },
}

export const threeTouchSwingPoints: SwingPointLevels = {
  internal: {
    highs: [
      { index: 1, price: 100, type: 'high' },
      { index: 3, price: 100.04, type: 'high' },
      { index: 5, price: 99.97, type: 'high' },
    ],
    lows: [],
  },
  swing: { highs: [], lows: [] },
  external: { highs: [], lows: [] },
}

export const capDisabledSwingPoints: SwingPointLevels = {
  internal: {
    highs: [
      { index: 1, price: 100, type: 'high' },
      { index: 3, price: 100.2, type: 'high' },
    ],
    lows: [],
  },
  swing: { highs: [], lows: [] },
  external: { highs: [], lows: [] },
}

export const eqhPoolSweepBars: OhlcvBar[] = [
  bar(99, 99.5, 98, 99, 0),
  bar(99, 100, 98.5, 99.5, 1),
  bar(99.5, 99.8, 98.8, 99.1, 2),
  bar(99.1, 100.08, 98.7, 99.4, 3),
  bar(99.4, 99.7, 98.9, 99.2, 4),
  bar(99.2, 100.2, 98.8, 99.9, 5),
]

export const eqlPoolSweepBars: OhlcvBar[] = [
  bar(101, 102, 100.5, 101, 0),
  bar(101, 101.5, 100, 100.5, 1),
  bar(100.5, 101.2, 100.2, 100.9, 2),
  bar(100.9, 101.3, 99.92, 100.6, 3),
  bar(100.6, 101.1, 100.3, 100.8, 4),
  bar(100.8, 101.2, 99.8, 100.1, 5),
]
