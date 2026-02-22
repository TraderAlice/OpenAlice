/**
 * Equity data access functions — CLOSE, HIGH, LOW, OPEN, VOLUME
 *
 * 公式语法：CLOSE('AAPL', 252, '1d')
 * - 第一参数 symbol
 * - 第二参数 lookback（K 线根数）
 * - 第三参数 interval（K 线周期，如 '1d', '1w', '1h'）
 */

import type { EquityIndicatorContext } from '../types'

export async function CLOSE(
  symbol: string,
  lookback: number,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, interval)
  return data.map((d) => d.close)
}

export async function HIGH(
  symbol: string,
  lookback: number,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, interval)
  return data.map((d) => d.high)
}

export async function LOW(
  symbol: string,
  lookback: number,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, interval)
  return data.map((d) => d.low)
}

export async function OPEN(
  symbol: string,
  lookback: number,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, interval)
  return data.map((d) => d.open)
}

export async function VOLUME(
  symbol: string,
  lookback: number,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback, interval)
  return data.map((d) => d.volume ?? 0)
}
