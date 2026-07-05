/**
 * Market Structure Analysis — BOS/CHoCH 检测
 *
 * BOS (Break of Structure): 趋势延续信号，价格突破与当前趋势一致的 swing 点
 * CHoCH (Change of Character): 趋势反转信号，价格突破与当前趋势相反的 swing 点
 *
 * State-machine implementation: each structure level keeps a trend state while
 * confirmed swing points enter candidate queues. A break flips that level's
 * state and consumes the broken-side candidates.
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types'
import type {
  SwingPointLevels,
  SwingPoint,
  BreakOfStructure,
  ChangeOfCharacter,
  StructureLevel,
  MarketStructureAnalysis,
  StructureState,
} from './types.js'

export interface MarketStructureParams {
  bars: OhlcvBar[]
  swingPoints: SwingPointLevels
  internalLookback?: number
  swingLookback?: number
  externalLookback?: number
}

const DEFAULT_INTERNAL_LOOKBACK = 5
const DEFAULT_SWING_LOOKBACK = 20
const DEFAULT_EXTERNAL_LOOKBACK = 50

function emptyStructureState(): StructureState {
  return {
    trend: 'unknown',
    trendValue: 0,
  }
}

type TrendValue = -1 | 0 | 1

interface StructureBreaksAtLevel {
  bos: BreakOfStructure[]
  choch: ChangeOfCharacter[]
  state: StructureState
}

function trendDirection(trend: TrendValue): StructureState['trend'] {
  if (trend > 0) return 'bullish'
  if (trend < 0) return 'bearish'
  return 'unknown'
}

function crossedAbove(previousClose: number, close: number, price: number): boolean {
  return previousClose <= price && close > price
}

function crossedBelow(previousClose: number, close: number, price: number): boolean {
  return previousClose >= price && close < price
}

function sortedSwings(swings: SwingPoint[]): SwingPoint[] {
  return [...swings].sort((a, b) => a.index - b.index)
}

function detectStructureBreaksAtLevel(
  bars: OhlcvBar[],
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[],
  level: StructureLevel,
  lookback: number
): StructureBreaksAtLevel {
  const bos: BreakOfStructure[] = []
  const choch: ChangeOfCharacter[] = []
  if (bars.length === 0) return { bos, choch, state: emptyStructureState() }

  const highs = sortedSwings(swingHighs)
  const lows = sortedSwings(swingLows)
  const confirmedHighs: SwingPoint[] = []
  const confirmedLows: SwingPoint[] = []
  let nextHighIndex = 0
  let nextLowIndex = 0
  let trend: TrendValue = 0
  let lastBos: BreakOfStructure | undefined
  let lastChoch: ChangeOfCharacter | undefined
  let lastBreak: BreakOfStructure | ChangeOfCharacter | undefined

  const confirmSwings = (barIndex: number) => {
    while (nextHighIndex < highs.length && highs[nextHighIndex].index + lookback <= barIndex) {
      confirmedHighs.unshift(highs[nextHighIndex])
      nextHighIndex++
    }
    while (nextLowIndex < lows.length && lows[nextLowIndex].index + lookback <= barIndex) {
      confirmedLows.unshift(lows[nextLowIndex])
      nextLowIndex++
    }
  }

  for (let i = 0; i < bars.length; i++) {
    confirmSwings(i)
    const close = bars[i].close
    const previousClose = i > 0 ? bars[i - 1].close : close
    const latestHigh = confirmedHighs[0]
    const latestLow = confirmedLows[0]

    if (latestHigh && crossedAbove(previousClose, close, latestHigh.price)) {
      if (trend < 0) {
        const event: ChangeOfCharacter = {
          type: 'bullish',
          index: i,
          price: close,
          level,
          brokenSwing: latestHigh,
          trendBefore: 'bearish',
          isPlus: confirmedLows.length > 1 && confirmedLows[0].price > confirmedLows[1].price,
        }
        choch.push(event)
        lastChoch = event
        lastBreak = event
      } else {
        const event: BreakOfStructure = {
          type: 'bullish',
          index: i,
          price: close,
          level,
          brokenSwing: latestHigh,
        }
        bos.push(event)
        lastBos = event
        lastBreak = event
      }
      trend = 1
      confirmedHighs.length = 0
    }

    if (latestLow && crossedBelow(previousClose, close, latestLow.price)) {
      if (trend > 0) {
        const event: ChangeOfCharacter = {
          type: 'bearish',
          index: i,
          price: close,
          level,
          brokenSwing: latestLow,
          trendBefore: 'bullish',
          isPlus: confirmedHighs.length > 1 && confirmedHighs[0].price < confirmedHighs[1].price,
        }
        choch.push(event)
        lastChoch = event
        lastBreak = event
      } else {
        const event: BreakOfStructure = {
          type: 'bearish',
          index: i,
          price: close,
          level,
          brokenSwing: latestLow,
        }
        bos.push(event)
        lastBos = event
        lastBreak = event
      }
      trend = -1
      confirmedLows.length = 0
    }
  }

  return {
    bos,
    choch,
    state: {
      trend: trendDirection(trend),
      trendValue: trend,
      lastBos,
      lastChoch,
      lastBreak,
      lastConfirmedHigh: confirmedHighs[0],
      lastConfirmedLow: confirmedLows[0],
    },
  }
}

/**
 * 分析市场结构（三个层级的 BOS/CHoCH）
 */
export function analyzeMarketStructure(params: MarketStructureParams): MarketStructureAnalysis {
  const {
    bars,
    swingPoints,
    internalLookback = DEFAULT_INTERNAL_LOOKBACK,
    swingLookback = DEFAULT_SWING_LOOKBACK,
    externalLookback = DEFAULT_EXTERNAL_LOOKBACK,
  } = params

  // 检测三个层级的结构突破（传入各自的lookback）
  const internalBreaks = detectStructureBreaksAtLevel(
    bars,
    swingPoints.internal.highs,
    swingPoints.internal.lows,
    'internal',
    internalLookback
  )

  const swingBreaks = detectStructureBreaksAtLevel(
    bars,
    swingPoints.swing.highs,
    swingPoints.swing.lows,
    'swing',
    swingLookback
  )

  const externalBreaks = detectStructureBreaksAtLevel(
    bars,
    swingPoints.external.highs,
    swingPoints.external.lows,
    'external',
    externalLookback
  )

  // 合并所有层级的结果
  return {
    swingPoints,
    stateByLevel: {
      internal: internalBreaks.state,
      swing: swingBreaks.state,
      external: externalBreaks.state,
    },
    bos: [...internalBreaks.bos, ...swingBreaks.bos, ...externalBreaks.bos],
    choch: [...internalBreaks.choch, ...swingBreaks.choch, ...externalBreaks.choch],
  }
}
