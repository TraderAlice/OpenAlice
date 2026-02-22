/**
 * Statistics functions
 *
 * Basic statistical calculations and moving averages
 */

/**
 * Simple Moving Average (SMA)
 * @param data - Data array
 * @param period - Period
 * @returns Latest MA value
 */
export function SMA(data: number[], period: number): number {
  if (data.length < period) {
    throw new Error(
      `SMA requires at least ${period} data points, got ${data.length}`,
    );
  }

  const slice = data.slice(-period);
  const sum = slice.reduce((acc, val) => acc + val, 0);
  return sum / period;
}

/**
 * Exponential Moving Average (EMA)
 * @param data - Data array
 * @param period - Period
 * @returns Latest EMA value
 */
export function EMA(data: number[], period: number): number {
  if (data.length < period) {
    throw new Error(
      `EMA requires at least ${period} data points, got ${data.length}`,
    );
  }

  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((acc, val) => acc + val, 0) / period;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Standard Deviation (STDEV)
 * @param data - Data array
 * @returns Standard deviation
 */
export function STDEV(data: number[]): number {
  if (data.length === 0) {
    throw new Error('STDEV requires at least 1 data point');
  }

  const mean = data.reduce((acc, val) => acc + val, 0) / data.length;
  const variance =
    data.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / data.length;
  return Math.sqrt(variance);
}

/**
 * Maximum value
 * @param data - Data array
 * @returns Maximum value
 */
export function MAX(data: number[]): number {
  if (data.length === 0) {
    throw new Error('MAX requires at least 1 data point');
  }
  return Math.max(...data);
}

/**
 * Minimum value
 * @param data - Data array
 * @returns Minimum value
 */
export function MIN(data: number[]): number {
  if (data.length === 0) {
    throw new Error('MIN requires at least 1 data point');
  }
  return Math.min(...data);
}

/**
 * Sum
 * @param data - Data array
 * @returns Sum total
 */
export function SUM(data: number[]): number {
  return data.reduce((acc, val) => acc + val, 0);
}

/**
 * Average
 * @param data - Data array
 * @returns Average value
 */
export function AVERAGE(data: number[]): number {
  if (data.length === 0) {
    throw new Error('AVERAGE requires at least 1 data point');
  }
  return data.reduce((acc, val) => acc + val, 0) / data.length;
}
