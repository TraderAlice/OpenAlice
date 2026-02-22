/**
 * Statistics functions — 纯数学计算
 *
 * SMA, EMA, STDEV, MAX, MIN, SUM, AVERAGE
 */

/** Simple Moving Average */
export function SMA(data: number[], period: number): number {
  if (data.length < period) {
    throw new Error(`SMA requires at least ${period} data points, got ${data.length}`)
  }
  const slice = data.slice(-period)
  const sum = slice.reduce((acc, val) => acc + val, 0)
  return sum / period
}

/** Exponential Moving Average */
export function EMA(data: number[], period: number): number {
  if (data.length < period) {
    throw new Error(`EMA requires at least ${period} data points, got ${data.length}`)
  }
  const multiplier = 2 / (period + 1)
  let ema = data.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema
  }
  return ema
}

/** Standard Deviation */
export function STDEV(data: number[]): number {
  if (data.length === 0) {
    throw new Error('STDEV requires at least 1 data point')
  }
  const mean = data.reduce((acc, val) => acc + val, 0) / data.length
  const variance = data.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / data.length
  return Math.sqrt(variance)
}

/** Maximum value */
export function MAX(data: number[]): number {
  if (data.length === 0) {
    throw new Error('MAX requires at least 1 data point')
  }
  return Math.max(...data)
}

/** Minimum value */
export function MIN(data: number[]): number {
  if (data.length === 0) {
    throw new Error('MIN requires at least 1 data point')
  }
  return Math.min(...data)
}

/** Sum */
export function SUM(data: number[]): number {
  return data.reduce((acc, val) => acc + val, 0)
}

/** Average */
export function AVERAGE(data: number[]): number {
  if (data.length === 0) {
    throw new Error('AVERAGE requires at least 1 data point')
  }
  return data.reduce((acc, val) => acc + val, 0) / data.length
}
