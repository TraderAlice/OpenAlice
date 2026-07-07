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

import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type {
  SwingPointLevels,
  SwingPoint,
  BreakOfStructure,
  ChangeOfCharacter,
  StructureLevel,
  MarketStructureAnalysis,
  MarketStructureMode,
  StructureState,
  SwingStrengthEntry,
  ActiveStructureRange,
} from './types.js'

export interface MarketStructureParams {
  bars: OhlcvBar[]
  swingPoints: SwingPointLevels
  internalLookback?: number
  swingLookback?: number
  externalLookback?: number
  marketStructureMode?: MarketStructureMode
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

function compressConsecutiveExtremes(points: { highs: SwingPoint[]; lows: SwingPoint[] }): {
  highs: SwingPoint[]
  lows: SwingPoint[]
} {
  const events = [...points.highs, ...points.lows].sort((a, b) => a.index - b.index || a.type.localeCompare(b.type))
  const compressed: SwingPoint[] = []

  for (const point of events) {
    const previous = compressed[compressed.length - 1]
    if (!previous || previous.type !== point.type) {
      compressed.push(point)
      continue
    }

    const pointIsMoreExtreme =
      point.type === 'high' ? point.price > previous.price : point.price < previous.price
    if (pointIsMoreExtreme) {
      compressed[compressed.length - 1] = point
    }
  }

  return {
    highs: compressed.filter((point) => point.type === 'high'),
    lows: compressed.filter((point) => point.type === 'low'),
  }
}

function swingPointsForMode(swingPoints: SwingPointLevels, mode: MarketStructureMode): SwingPointLevels {
  if (mode === 'pivot') return swingPoints

  return {
    internal: compressConsecutiveExtremes(swingPoints.internal),
    swing: compressConsecutiveExtremes(swingPoints.swing),
    external: compressConsecutiveExtremes(swingPoints.external),
  }
}

function swingId(level: StructureLevel, point: SwingPoint): string {
  return `${level}-${point.type}-${point.index}`
}

function wasSweptAsLiquidity(bars: OhlcvBar[], point: SwingPoint): boolean {
  return bars.slice(point.index + 1).some((bar) => {
    if (point.type === 'high') return bar.high > point.price && bar.close <= point.price
    return bar.low < point.price && bar.close >= point.price
  })
}

function strengthForSwing(trend: StructureState['trend'], point: SwingPoint): SwingStrengthEntry['strength'] | undefined {
  if (trend === 'bullish') return point.type === 'low' ? 'strong' : 'weak'
  if (trend === 'bearish') return point.type === 'high' ? 'strong' : 'weak'
  return undefined
}

function buildReason(trend: StructureState['trend'], point: SwingPoint, strength: SwingStrengthEntry['strength'], swept: boolean): string {
  if (swept && strength === 'weak') {
    return `${point.type === 'high' ? 'High' : 'Low'} was swept by a wick and reclaimed in ${trend} structure.`
  }
  if (strength === 'strong') {
    return `${point.type === 'high' ? 'High' : 'Low'} is the defended structural anchor in ${trend} context.`
  }
  return `${point.type === 'high' ? 'High' : 'Low'} is a liquidity target in ${trend} context.`
}

function buildSwingStrength(
  bars: OhlcvBar[],
  swingPoints: SwingPointLevels,
  stateByLevel: Record<StructureLevel, StructureState>
): SwingStrengthEntry[] {
  const entries: SwingStrengthEntry[] = []
  const levels: StructureLevel[] = ['internal', 'swing', 'external']

  for (const level of levels) {
    const trend = stateByLevel[level].trend
    const points = [...swingPoints[level].highs, ...swingPoints[level].lows].sort((a, b) => a.index - b.index)

    for (const point of points) {
      const strength = strengthForSwing(trend, point)
      if (!strength) continue

      const swept = wasSweptAsLiquidity(bars, point)
      const weakTag = point.type === 'high' ? 'weak_high_target' : 'weak_low_target'
      const sweptTag = point.type === 'high' ? 'weak_high_swept' : 'weak_low_swept'
      const strongTag = point.type === 'high' ? 'strong_high_defended' : 'strong_low_defended'
      const explanationTag = strength === 'strong' ? strongTag : swept ? sweptTag : weakTag

      entries.push({
        id: swingId(level, point),
        type: point.type,
        level,
        index: point.index,
        price: point.price,
        strength,
        reason: buildReason(trend, point, strength, swept),
        liquidityTarget: strength === 'weak' && swept
          ? { kind: 'swing', id: swingId(level, point), index: point.index }
          : undefined,
        scoringImpact: {
          zoneScoreDelta: strength === 'strong' ? 12 : swept ? -8 : -4,
          explanationTag,
        },
      })
    }
  }

  return entries
}

function buildActiveRange(
  level: StructureLevel,
  swingPoints: SwingPointLevels,
  swingStrength: SwingStrengthEntry[]
): ActiveStructureRange | undefined {
  const high = swingPoints[level].highs.at(-1)
  const low = swingPoints[level].lows.at(-1)
  if (!high && !low) return undefined

  const strengthById = new Map(swingStrength.map((entry) => [entry.id, entry]))
  return {
    high: high
      ? {
          ...high,
          classification: strengthById.get(swingId(level, high))?.strength === 'strong' ? 'strong_high' : 'weak_high',
        }
      : undefined,
    low: low
      ? {
          ...low,
          classification: strengthById.get(swingId(level, low))?.strength === 'strong' ? 'strong_low' : 'weak_low',
        }
      : undefined,
  }
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
    swingPoints: rawSwingPoints,
    internalLookback = DEFAULT_INTERNAL_LOOKBACK,
    swingLookback = DEFAULT_SWING_LOOKBACK,
    externalLookback = DEFAULT_EXTERNAL_LOOKBACK,
    marketStructureMode = 'pivot',
  } = params
  const swingPoints = swingPointsForMode(rawSwingPoints, marketStructureMode)

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

  const stateByLevel = {
    internal: internalBreaks.state,
    swing: swingBreaks.state,
    external: externalBreaks.state,
  }
  const swingStrength = buildSwingStrength(bars, swingPoints, stateByLevel)

  if (marketStructureMode === 'extreme') {
    stateByLevel.internal.activeRange = buildActiveRange('internal', swingPoints, swingStrength)
    stateByLevel.swing.activeRange = buildActiveRange('swing', swingPoints, swingStrength)
    stateByLevel.external.activeRange = buildActiveRange('external', swingPoints, swingStrength)
  }

  return {
    marketStructureMode,
    swingPoints,
    stateByLevel,
    bos: [...internalBreaks.bos, ...swingBreaks.bos, ...externalBreaks.bos],
    choch: [...internalBreaks.choch, ...swingBreaks.choch, ...externalBreaks.choch],
    swingStrength,
  }
}
