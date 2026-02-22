/**
 * Technical indicator functions — 纯数学计算
 *
 * RSI, BBANDS, MACD, ATR
 * 从 archive-analysis 直接复制，无改动。
 */

import { EMA } from './statistics'

/** Relative Strength Index (RSI) */
export function RSI(data: number[], period: number = 14): number {
  if (data.length < period + 1) {
    throw new Error(`RSI requires at least ${period + 1} data points, got ${data.length}`)
  }

  const changes: number[] = []
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1])
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
  data: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): { upper: number; middle: number; lower: number } {
  if (data.length < period) {
    throw new Error(`BBANDS requires at least ${period} data points, got ${data.length}`)
  }

  const slice = data.slice(-period)
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
  data: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macd: number; signal: number; histogram: number } {
  if (data.length < slowPeriod + signalPeriod) {
    throw new Error(
      `MACD requires at least ${slowPeriod + signalPeriod} data points, got ${data.length}`,
    )
  }

  const fastEMA = EMA(data, fastPeriod)
  const slowEMA = EMA(data, slowPeriod)
  const macdValue = fastEMA - slowEMA

  const macdHistory: number[] = []
  for (let i = slowPeriod; i <= data.length; i++) {
    const slice = data.slice(0, i)
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
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): number {
  if (highs.length !== lows.length || lows.length !== closes.length || highs.length < period + 1) {
    throw new Error(`ATR requires at least ${period + 1} data points for all arrays`)
  }

  const trueRanges: number[] = []
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i]
    const low = lows[i]
    const prevClose = closes[i - 1]

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    )
    trueRanges.push(tr)
  }

  let atr = trueRanges.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period
  }

  return atr
}
