/**
 * Technical indicator functions
 *
 * Commonly used technical analysis indicators
 */

import { EMA } from './statistics';

/**
 * Relative Strength Index (RSI)
 * @param data - Price data array
 * @param period - Period (typically 14)
 * @returns RSI value (0-100)
 */
export function RSI(data: number[], period: number = 14): number {
  if (data.length < period + 1) {
    throw new Error(
      `RSI requires at least ${period + 1} data points, got ${data.length}`,
    );
  }

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }

  // Separate gains and losses
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));

  // Calculate average gains and losses
  let avgGain =
    gains.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
  let avgLoss =
    losses.slice(0, period).reduce((acc, val) => acc + val, 0) / period;

  // Smoothing
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Bollinger Bands (BBANDS)
 * @param data - Price data array
 * @param period - Period (typically 20)
 * @param stdDevMultiplier - Standard deviation multiplier (typically 2)
 * @returns { upper: upper band, middle: middle band, lower: lower band }
 */
export function BBANDS(
  data: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): { upper: number; middle: number; lower: number } {
  if (data.length < period) {
    throw new Error(
      `BBANDS requires at least ${period} data points, got ${data.length}`,
    );
  }

  const slice = data.slice(-period);
  const middle = slice.reduce((acc, val) => acc + val, 0) / period;
  const variance =
    slice.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + stdDev * stdDevMultiplier,
    middle: middle,
    lower: middle - stdDev * stdDevMultiplier,
  };
}

/**
 * MACD (Moving Average Convergence Divergence)
 * @param data - Price data array
 * @param fastPeriod - Fast line period (typically 12)
 * @param slowPeriod - Slow line period (typically 26)
 * @param signalPeriod - Signal line period (typically 9)
 * @returns { macd: MACD line, signal: signal line, histogram: histogram }
 */
export function MACD(
  data: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macd: number; signal: number; histogram: number } {
  if (data.length < slowPeriod + signalPeriod) {
    throw new Error(
      `MACD requires at least ${slowPeriod + signalPeriod} data points, got ${data.length}`,
    );
  }

  // Calculate fast and slow EMA
  const fastEMA = EMA(data, fastPeriod);
  const slowEMA = EMA(data, slowPeriod);

  // MACD line = fast EMA - slow EMA
  const macdValue = fastEMA - slowEMA;

  // Calculate MACD history for signal line
  const macdHistory: number[] = [];
  for (let i = slowPeriod; i <= data.length; i++) {
    const slice = data.slice(0, i);
    const fast = EMA(slice, fastPeriod);
    const slow = EMA(slice, slowPeriod);
    macdHistory.push(fast - slow);
  }

  // Signal line = EMA of MACD
  const signalValue = EMA(macdHistory, signalPeriod);

  // Histogram = MACD - signal line
  const histogram = macdValue - signalValue;

  return {
    macd: macdValue,
    signal: signalValue,
    histogram: histogram,
  };
}

/**
 * Average True Range (ATR)
 * @param highs - High price array
 * @param lows - Low price array
 * @param closes - Close price array
 * @param period - Period (typically 14)
 * @returns ATR value
 */
export function ATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): number {
  if (
    highs.length !== lows.length ||
    lows.length !== closes.length ||
    highs.length < period + 1
  ) {
    throw new Error(
      `ATR requires at least ${period + 1} data points for all arrays`,
    );
  }

  // Calculate True Range
  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];

    const tr = Math.max(
      high - low, // Current high-low range
      Math.abs(high - prevClose), // Current high vs previous close
      Math.abs(low - prevClose), // Current low vs previous close
    );

    trueRanges.push(tr);
  }

  // Calculate ATR (using smoothed moving average)
  let atr =
    trueRanges.slice(0, period).reduce((acc, val) => acc + val, 0) / period;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}
