/**
 * Data access functions
 *
 * Used to extract OHLCV arrays from historical data
 */

import { FunctionContext } from '../types';

/**
 * Get close price array
 * @param symbol - Trading pair
 * @param lookback - Number of candlesticks to look back
 * @param context - Execution context
 */
export async function CLOSE(
  symbol: string,
  lookback: number,
  context: FunctionContext,
  currentTime: Date,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, currentTime);
  return data.map((d) => d.close);
}

/**
 * Get high price array
 */
export async function HIGH(
  symbol: string,
  lookback: number,
  context: FunctionContext,
  currentTime: Date,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, currentTime);
  return data.map((d) => d.high);
}

/**
 * Get low price array
 */
export async function LOW(
  symbol: string,
  lookback: number,
  context: FunctionContext,
  currentTime: Date,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, currentTime);
  return data.map((d) => d.low);
}

/**
 * Get open price array
 */
export async function OPEN(
  symbol: string,
  lookback: number,
  context: FunctionContext,
  currentTime: Date,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, currentTime);
  return data.map((d) => d.open);
}

/**
 * Get volume array
 */
export async function VOLUME(
  symbol: string,
  lookback: number,
  context: FunctionContext,
  currentTime: Date,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, currentTime);
  return data.map((d) => d.volume);
}
