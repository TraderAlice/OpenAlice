/**
 * Equity data access functions — CLOSE, HIGH, LOW, OPEN, VOLUME
 *
 * 公式语法：CLOSE('AAPL', '1d')
 * - 第一参数 symbol
 * - 第二参数 interval（K 线周期，如 '1d', '1w', '1h'）
 *
 * 数据拉取量由 adapter 层按 interval 决定，公式层不关心。
 */

import type { EquityIndicatorContext } from '../types'

export async function CLOSE(
  symbol: string,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, interval)
  return data.map((d) => d.close)
}

export async function HIGH(
  symbol: string,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, interval)
  return data.map((d) => d.high)
}

export async function LOW(
  symbol: string,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, interval)
  return data.map((d) => d.low)
}

export async function OPEN(
  symbol: string,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, interval)
  return data.map((d) => d.open)
}

export async function VOLUME(
  symbol: string,
  interval: string,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, interval)
  return data.map((d) => d.volume ?? 0)
}
