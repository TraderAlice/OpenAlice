import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type { ZoneDirection, ZoneMitigationSource } from './types.js'

export function bodyLow(bar: OhlcvBar): number {
  return Math.min(bar.open, bar.close)
}

export function bodyHigh(bar: OhlcvBar): number {
  return Math.max(bar.open, bar.close)
}

export function adverseBodyEdge(bar: OhlcvBar, direction: ZoneDirection): number {
  return direction === 'bullish' ? bodyLow(bar) : bodyHigh(bar)
}

export function adverseWickEdge(bar: OhlcvBar, direction: ZoneDirection): number {
  return direction === 'bullish' ? bar.low : bar.high
}

export function zoneTriggerPrice(
  bar: OhlcvBar,
  direction: ZoneDirection,
  source: Exclude<ZoneMitigationSource, 'midpoint'>,
): number {
  return source === 'wick'
    ? adverseWickEdge(bar, direction)
    : adverseBodyEdge(bar, direction)
}
