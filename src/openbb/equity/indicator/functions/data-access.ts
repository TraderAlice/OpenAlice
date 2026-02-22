/**
 * Equity data access functions — CLOSE, HIGH, LOW, OPEN, VOLUME
 *
 * 从 archive-analysis 改编：
 * - 去掉 currentTime 参数（不再有 playhead 概念）
 * - 使用 EquityIndicatorContext（返回 EquityHistoricalData）
 * - volume 可能为 null（OpenBB 的 EquityHistoricalData.volume: number | null）
 */

import type { EquityIndicatorContext } from '../types'

export async function CLOSE(
  symbol: string,
  lookback: number,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback)
  return data.map((d) => d.close)
}

export async function HIGH(
  symbol: string,
  lookback: number,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback)
  return data.map((d) => d.high)
}

export async function LOW(
  symbol: string,
  lookback: number,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback)
  return data.map((d) => d.low)
}

export async function OPEN(
  symbol: string,
  lookback: number,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback)
  return data.map((d) => d.open)
}

export async function VOLUME(
  symbol: string,
  lookback: number,
  context: EquityIndicatorContext,
): Promise<number[]> {
  const data = await context.getHistoricalData(symbol, lookback)
  return data.map((d) => d.volume ?? 0)
}
