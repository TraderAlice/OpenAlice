/**
 * Swing Point Detection — 摆动点检测
 *
 * 三个层级的 swing 点检测（internal/swing/external），用于识别市场结构和支撑/阻力。
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type { SwingPoint, SwingPointLevels } from './types.js'

export interface SwingDetectionParams {
  bars: OhlcvBar[]
  /** Internal structure lookback (默认 5) */
  internalLookback?: number
  /** Swing structure lookback (默认 20) */
  swingLookback?: number
  /** External structure lookback (默认 50) */
  externalLookback?: number
}

function slidingWindowExtremes(
  bars: OhlcvBar[],
  lookback: number,
  valueFor: (bar: OhlcvBar) => number,
  isBetter: (candidate: number, current: number) => boolean,
): Array<number | undefined> {
  const windowSize = lookback * 2 + 1
  const extremes: Array<number | undefined> = Array.from({ length: bars.length })
  const deque: number[] = []
  let head = 0

  for (let i = 0; i < bars.length; i++) {
    while (head < deque.length && deque[head] <= i - windowSize) head++
    while (
      head < deque.length &&
      isBetter(valueFor(bars[i]), valueFor(bars[deque[deque.length - 1]]))
    ) {
      deque.pop()
    }
    deque.push(i)

    if (i >= windowSize - 1) {
      const center = i - lookback
      extremes[center] = valueFor(bars[deque[head]])
    }
  }

  return extremes
}

/**
 * 检测单个层级的 swing 点
 *
 * Swing High: 中心高点 >= 左右各 lookback 根K线的高点
 * Swing Low: 中心低点 <= 左右各 lookback 根K线的低点
 */
function detectSwingPointsAtLevel(
  bars: OhlcvBar[],
  lookback: number
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = []
  const lows: SwingPoint[] = []
  if (lookback < 0 || bars.length < lookback * 2 + 1) return { highs, lows }

  const maxHighByCenter = slidingWindowExtremes(
    bars,
    lookback,
    (bar) => bar.high,
    (candidate, current) => candidate > current,
  )
  const minLowByCenter = slidingWindowExtremes(
    bars,
    lookback,
    (bar) => bar.low,
    (candidate, current) => candidate < current,
  )

  // 需要左右各 lookback 根K线，所以从 lookback 开始，到 length - lookback 结束
  for (let i = lookback; i < bars.length - lookback; i++) {
    if (bars[i].high >= (maxHighByCenter[i] ?? Infinity)) {
      highs.push({
        index: i,
        price: bars[i].high,
        type: 'high',
      })
    }

    if (bars[i].low <= (minLowByCenter[i] ?? -Infinity)) {
      lows.push({
        index: i,
        price: bars[i].low,
        type: 'low',
      })
    }
  }

  return { highs, lows }
}

/**
 * 检测三个层级的 Swing 点
 *
 * - Internal (lookback=5): 短期结构，信号密集
 * - Swing (lookback=20): 中期结构
 * - External (lookback=50): 长期结构，主要支撑/阻力
 */
export function detectSwingPoints(params: SwingDetectionParams): SwingPointLevels {
  const {
    bars,
    internalLookback = 5,
    swingLookback = 20,
    externalLookback = 50,
  } = params

  return {
    internal: detectSwingPointsAtLevel(bars, internalLookback),
    swing: detectSwingPointsAtLevel(bars, swingLookback),
    external: detectSwingPointsAtLevel(bars, externalLookback),
  }
}
