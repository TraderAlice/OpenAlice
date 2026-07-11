import type { OhlcvBar } from '@/domain/market-data/bars/index.js'
import { calculateATR } from '@/domain/analysis/price-action/indicators.js'

export const ORDER_FLOW_ATR_PERIOD = 14

export interface DirectionalPriceResponse {
  atr: number
  directionalPriceProgress: number
}

export function calculateOrderFlowAtr(
  targetBars: OhlcvBar[],
): number[] {
  return calculateATR(targetBars, ORDER_FLOW_ATR_PERIOD)
}

export function directionalOpenToCloseProgress(
  bar: OhlcvBar,
  deltaRatio: number,
  atr: number,
): DirectionalPriceResponse | null {
  if (!Number.isFinite(atr) || atr <= 0 || deltaRatio === 0) return null

  const deltaDirection = deltaRatio > 0 ? 1 : -1
  return {
    atr,
    directionalPriceProgress: ((bar.close - bar.open) * deltaDirection) / atr,
  }
}

export function isLatestBarEvidence(index: number, targetBarCount: number): boolean {
  return targetBarCount > 0 && index === targetBarCount - 1
}
