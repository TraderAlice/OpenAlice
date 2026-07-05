/**
 * 基础技术指标计算
 *
 * ATR (Average True Range) 等指标，用于 iFVG 验证和其他分析
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types'

/**
 * 计算 True Range
 */
function calculateTrueRange(current: OhlcvBar, previous: OhlcvBar | null): number {
  const highLow = current.high - current.low

  if (!previous) {
    return highLow
  }

  const highClose = Math.abs(current.high - previous.close)
  const lowClose = Math.abs(current.low - previous.close)

  return Math.max(highLow, highClose, lowClose)
}

/**
 * 计算 ATR (Average True Range)
 *
 * @param bars K线数据
 * @param period ATR周期（默认14）
 * @returns 每根bar的ATR值数组
 */
export function calculateATR(bars: OhlcvBar[], period = 14): number[] {
  if (bars.length < period) {
    return []
  }

  const atr: number[] = []
  let sum = 0

  // 计算初始ATR（简单平均）
  for (let i = 0; i < period; i++) {
    const previous = i > 0 ? bars[i - 1] : null
    const tr = calculateTrueRange(bars[i], previous)
    sum += tr
  }

  atr[period - 1] = sum / period

  // 使用平滑方法计算后续ATR（Wilder's smoothing）
  for (let i = period; i < bars.length; i++) {
    const previous = bars[i - 1]
    const tr = calculateTrueRange(bars[i], previous)
    atr[i] = (atr[i - 1] * (period - 1) + tr) / period
  }

  return atr
}

/**
 * 计算平均K线范围（high - low）
 *
 * @param bars K线数据
 * @param lookback 回溯周期
 * @returns 每根bar的平均范围数组
 */
export function calculateAverageRange(bars: OhlcvBar[], lookback = 20): number[] {
  const avgRanges: number[] = []

  for (let i = 0; i < bars.length; i++) {
    const start = Math.max(0, i - lookback + 1)
    const window = bars.slice(start, i + 1)

    const sum = window.reduce((acc, bar) => acc + (bar.high - bar.low), 0)
    avgRanges[i] = sum / window.length
  }

  return avgRanges
}

/**
 * 计算K线实体大小（abs(close - open)）
 */
export function calculateBodySize(bar: OhlcvBar): number {
  return Math.abs(bar.close - bar.open)
}

/**
 * 计算K线范围大小（high - low）
 */
export function calculateRangeSize(bar: OhlcvBar): number {
  return bar.high - bar.low
}

/**
 * 判断K线是否为吞没形态
 *
 * @param current 当前K线
 * @param previous 前一根K线
 * @returns 是否为吞没（实体和影线都完全覆盖）
 */
export function isEngulfing(current: OhlcvBar, previous: OhlcvBar): boolean {
  // 实体吞没
  const bodyEngulfs =
    current.high > previous.high &&
    current.low < previous.low

  // 方向相反
  const currentBullish = current.close > current.open
  const previousBullish = previous.close > previous.open
  const oppositeDirection = currentBullish !== previousBullish

  return bodyEngulfs && oppositeDirection
}
