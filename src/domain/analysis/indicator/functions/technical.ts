/**
 * Technical indicator functions — 纯数学计算
 *
 * RSI, BBANDS, MACD, ATR
 * 接受 number[] 或 TrackedValues（自动提取 values）
 */

import { toValues, type TrackedValues } from '../types'
import { EMA } from './statistics'

type NumericInput = number[] | TrackedValues

/** Relative Strength Index (RSI) */
export function RSI(data: NumericInput, period: number = 14): number {
  const v = toValues(data)
  if (v.length < period + 1) {
    throw new Error(`RSI requires at least ${period + 1} data points, got ${v.length}`)
  }

  const changes: number[] = []
  for (let i = 1; i < v.length; i++) {
    changes.push(v[i] - v[i - 1])
  }

  const gains = changes.map((c) => (c > 0 ? c : 0))
  const losses = changes.map((c) => (c < 0 ? -c : 0))

  let avgGain = gains.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  let avgLoss = losses.slice(0, period).reduce((acc, val) => acc + val, 0) / period

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
  }

  if (avgLoss === 0) {
    return 100
  }

  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Bollinger Bands (BBANDS) */
export function BBANDS(
  data: NumericInput,
  period: number = 20,
  stdDevMultiplier: number = 2,
): { upper: number; middle: number; lower: number } {
  const v = toValues(data)
  if (v.length < period) {
    throw new Error(`BBANDS requires at least ${period} data points, got ${v.length}`)
  }

  const slice = v.slice(-period)
  const middle = slice.reduce((acc, val) => acc + val, 0) / period
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) / period
  const stdDev = Math.sqrt(variance)

  return {
    upper: middle + stdDev * stdDevMultiplier,
    middle,
    lower: middle - stdDev * stdDevMultiplier,
  }
}

/** MACD (Moving Average Convergence Divergence) */
export function MACD(
  data: NumericInput,
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macd: number; signal: number; histogram: number } {
  const v = toValues(data)
  if (v.length < slowPeriod + signalPeriod) {
    throw new Error(
      `MACD requires at least ${slowPeriod + signalPeriod} data points, got ${v.length}`,
    )
  }

  const fastEMA = EMA(v, fastPeriod)
  const slowEMA = EMA(v, slowPeriod)
  const macdValue = fastEMA - slowEMA

  const macdHistory: number[] = []
  for (let i = slowPeriod; i <= v.length; i++) {
    const slice = v.slice(0, i)
    const fast = EMA(slice, fastPeriod)
    const slow = EMA(slice, slowPeriod)
    macdHistory.push(fast - slow)
  }

  const signalValue = EMA(macdHistory, signalPeriod)
  const histogram = macdValue - signalValue

  return {
    macd: macdValue,
    signal: signalValue,
    histogram,
  }
}

/** Average True Range (ATR) */
export function ATR(
  highs: NumericInput,
  lows: NumericInput,
  closes: NumericInput,
  period: number = 14,
): number {
  const h = toValues(highs)
  const l = toValues(lows)
  const c = toValues(closes)
  if (h.length !== l.length || l.length !== c.length || h.length < period + 1) {
    throw new Error(`ATR requires at least ${period + 1} data points for all arrays`)
  }

  const trueRanges: number[] = []
  for (let i = 1; i < h.length; i++) {
    const tr = Math.max(
      h[i] - l[i],
      Math.abs(h[i] - c[i - 1]),
      Math.abs(l[i] - c[i - 1]),
    )
    trueRanges.push(tr)
  }

  let atr = trueRanges.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period
  }

  return atr
}
