/**
 * Technical indicator functions — 纯数学计算
 *
 * RSI, BBANDS, MACD, ATR, STOCHRSI, ADX, OBV, VWAP, PIVOT
 */

import { EMA, SMA } from './statistics'

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

/**
 * Stochastic RSI — RSI applied to itself, normalized to 0-100.
 * More sensitive than plain RSI for detecting overbought/oversold in trending markets.
 */
export function STOCHRSI(
  data: number[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
): { stochRsi: number; k: number; d: number } {
  const minLen = rsiPeriod + stochPeriod + 1
  if (data.length < minLen) {
    throw new Error(`STOCHRSI requires at least ${minLen} data points, got ${data.length}`)
  }

  // Compute RSI series
  const rsiSeries: number[] = []
  for (let i = rsiPeriod + 1; i <= data.length; i++) {
    rsiSeries.push(RSI(data.slice(0, i), rsiPeriod))
  }

  // Stochastic of RSI over last stochPeriod values
  const recentRsi = rsiSeries.slice(-stochPeriod)
  const maxRsi = Math.max(...recentRsi)
  const minRsi = Math.min(...recentRsi)
  const range = maxRsi - minRsi
  const currentRsi = recentRsi[recentRsi.length - 1]

  const stochRsi = range === 0 ? 50 : ((currentRsi - minRsi) / range) * 100

  // %K = SMA(stochRsi, 3), %D = SMA(%K, 3) — approximated from recent values
  const k = stochRsi // Current value (full series would smooth this)
  const d = SMA(rsiSeries.slice(-3).map((r) => {
    const rr = recentRsi
    const mx = Math.max(...rr)
    const mn = Math.min(...rr)
    return mx === mn ? 50 : ((r - mn) / (mx - mn)) * 100
  }), 3)

  return { stochRsi, k, d }
}

/**
 * Average Directional Index (ADX) — trend strength indicator (0-100).
 * >25 = strong trend, <20 = weak/no trend.
 */
export function ADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): { adx: number; plusDI: number; minusDI: number } {
  const minLen = period * 2 + 1
  if (highs.length < minLen || lows.length < minLen || closes.length < minLen) {
    throw new Error(`ADX requires at least ${minLen} data points, got ${highs.length}`)
  }

  // Compute True Range, +DM, -DM
  const tr: number[] = []
  const plusDM: number[] = []
  const minusDM: number[] = []

  for (let i = 1; i < highs.length; i++) {
    const highDiff = highs[i] - highs[i - 1]
    const lowDiff = lows[i - 1] - lows[i]

    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ))

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0)
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0)
  }

  // Smoothed averages using Wilder's smoothing (same as ATR)
  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0)

  const dxValues: number[] = []

  for (let i = period; i < tr.length; i++) {
    if (i > period) {
      smoothTR = smoothTR - smoothTR / period + tr[i]
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i]
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i]
    }

    const pdi = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100
    const mdi = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100
    const diSum = pdi + mdi
    const dx = diSum === 0 ? 0 : (Math.abs(pdi - mdi) / diSum) * 100
    dxValues.push(dx)
  }

  // ADX = smoothed average of DX
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period
  }

  const plusDI = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100
  const minusDI = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100

  return { adx, plusDI, minusDI }
}

/**
 * On-Balance Volume (OBV) — cumulative volume flow indicator.
 * Rising OBV confirms uptrend, falling OBV confirms downtrend.
 * Returns the current OBV value.
 */
export function OBV(closes: number[], volumes: number[]): number {
  if (closes.length !== volumes.length || closes.length < 2) {
    throw new Error(`OBV requires at least 2 data points with matching closes and volumes`)
  }

  let obv = 0
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i]
    else if (closes[i] < closes[i - 1]) obv -= volumes[i]
    // If equal, OBV unchanged
  }

  return obv
}

/**
 * VWAP — Volume Weighted Average Price.
 * Requires high, low, close, volume arrays (intraday bars).
 * Returns the cumulative VWAP for the dataset.
 */
export function VWAP(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): number {
  if (highs.length !== lows.length || lows.length !== closes.length || closes.length !== volumes.length) {
    throw new Error('VWAP requires equal-length arrays for highs, lows, closes, volumes')
  }
  if (highs.length < 1) {
    throw new Error('VWAP requires at least 1 data point')
  }

  let cumulativeTPV = 0
  let cumulativeVolume = 0

  for (let i = 0; i < highs.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3
    cumulativeTPV += typicalPrice * volumes[i]
    cumulativeVolume += volumes[i]
  }

  if (cumulativeVolume === 0) return closes[closes.length - 1]
  return cumulativeTPV / cumulativeVolume
}

/**
 * Pivot Points (Standard/Floor) — support and resistance levels.
 * Takes the most recent bar's high, low, close to compute pivot levels.
 */
export function PIVOT(
  highs: number[],
  lows: number[],
  closes: number[],
): { pivot: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } {
  if (highs.length < 1 || lows.length < 1 || closes.length < 1) {
    throw new Error('PIVOT requires at least 1 data point')
  }

  const h = highs[highs.length - 1]
  const l = lows[lows.length - 1]
  const c = closes[closes.length - 1]

  const pivot = (h + l + c) / 3
  const r1 = 2 * pivot - l
  const s1 = 2 * pivot - h
  const r2 = pivot + (h - l)
  const s2 = pivot - (h - l)
  const r3 = h + 2 * (pivot - l)
  const s3 = l - 2 * (h - pivot)

  return { pivot, r1, r2, r3, s1, s2, s3 }
}
