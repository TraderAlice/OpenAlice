/**
 * Breaker zone detection.
 *
 * A breaker is a role reversal of an existing FVG/VI/OG or order-block zone.
 * Creation requires a far-edge break; midpoint mitigation is intentionally not
 * a breaker signal.
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type {
  BreakerZone,
  FairValueGap,
  OrderBlock,
  PriceActionSourceRef,
  ZoneDirection,
  ZoneKind,
  ZoneMitigationSource,
} from './types.js'
import { zoneTriggerPrice } from './zone-price.js'

export interface DetectBreakersParams {
  bars: OhlcvBar[]
  fvgs: FairValueGap[]
  orderBlocks: OrderBlock[]
  fvgZoneMitigationSource?: ZoneMitigationSource
  orderBlockZoneMitigationSource?: ZoneMitigationSource
}

export function detectBreakers(params: DetectBreakersParams): BreakerZone[] {
  const {
    bars,
    fvgs,
    orderBlocks,
    fvgZoneMitigationSource = 'body',
    orderBlockZoneMitigationSource = 'body',
  } = params

  const breakers: BreakerZone[] = []

  if (fvgZoneMitigationSource !== 'midpoint') {
    for (const fvg of fvgs) {
      const brokenAtIndex = fvg.lifecycle?.brokenAtIndex
      if (brokenAtIndex === undefined) continue

      breakers.push(buildBreaker({
        bars,
        kind: 'fvg_breaker',
        sourceDirection: fvg.type,
        top: fvg.top,
        bottom: fvg.bottom,
        midpoint: fvg.midpoint ?? (fvg.top + fvg.bottom) / 2,
        size: fvg.size,
        sizeAtr: fvg.sizeAtr ?? 0,
        brokenAtIndex,
        source: {
          kind: sourceKindForFVG(fvg),
          id: fvg.id,
          index: fvg.formationIndex,
          timeframe: fvg.timeframe,
        },
        invalidationSource: fvgZoneMitigationSource,
      }))
    }
  }

  if (orderBlockZoneMitigationSource !== 'midpoint') {
    for (const orderBlock of orderBlocks) {
      const brokenAtIndex = orderBlock.mitigatedAtIndex
      if (!orderBlock.mitigated || brokenAtIndex === undefined) continue

      breakers.push(buildBreaker({
        bars,
        kind: 'order_block_breaker',
        sourceDirection: orderBlock.type,
        top: orderBlock.top,
        bottom: orderBlock.bottom,
        midpoint: orderBlock.middle,
        size: orderBlock.size,
        sizeAtr: 0,
        brokenAtIndex,
        source: {
          kind: 'order_block',
          index: orderBlock.index,
          level: orderBlock.level,
        },
        invalidationSource: orderBlockZoneMitigationSource,
      }))
    }
  }

  return breakers.sort((a, b) => a.formedAtIndex - b.formedAtIndex)
}

function buildBreaker(opts: {
  bars: OhlcvBar[]
  kind: BreakerZone['kind']
  sourceDirection: ZoneDirection
  top: number
  bottom: number
  midpoint: number
  size: number
  sizeAtr: number
  brokenAtIndex: number
  source: PriceActionSourceRef
  invalidationSource: Exclude<ZoneMitigationSource, 'midpoint'>
}): BreakerZone {
  const direction = reverseDirection(opts.sourceDirection)
  const invalidatedAtIndex = findInvalidatedAtIndex({
    bars: opts.bars,
    direction,
    top: opts.top,
    bottom: opts.bottom,
    startIndex: opts.brokenAtIndex + 1,
    source: opts.invalidationSource,
  })
  const id = `${opts.kind}:${opts.source.kind}:${opts.source.id ?? opts.source.index ?? opts.brokenAtIndex}:${opts.brokenAtIndex}`

  return {
    id,
    kind: opts.kind,
    direction,
    top: opts.top,
    bottom: opts.bottom,
    midpoint: opts.midpoint,
    size: opts.size,
    sizeAtr: opts.sizeAtr,
    formedAtIndex: opts.brokenAtIndex,
    confirmedAtIndex: opts.brokenAtIndex,
    state: invalidatedAtIndex === undefined ? 'active' : 'invalidated',
    lifecycle: {
      formedAtIndex: opts.brokenAtIndex,
      confirmedAtIndex: opts.brokenAtIndex,
      brokenAtIndex: opts.brokenAtIndex,
      invalidatedAtIndex,
    },
    source: opts.source,
    sourceDirection: opts.sourceDirection,
    sourceBrokenAtIndex: opts.brokenAtIndex,
  }
}

function findInvalidatedAtIndex(opts: {
  bars: OhlcvBar[]
  direction: ZoneDirection
  top: number
  bottom: number
  startIndex: number
  source: Exclude<ZoneMitigationSource, 'midpoint'>
}): number | undefined {
  for (let i = opts.startIndex; i < opts.bars.length; i++) {
    const price = invalidationPrice(opts.bars[i], opts.direction, opts.source)
    if (opts.direction === 'bearish' ? price > opts.top : price < opts.bottom) {
      return i
    }
  }
  return undefined
}

function invalidationPrice(
  bar: OhlcvBar,
  direction: ZoneDirection,
  source: Exclude<ZoneMitigationSource, 'midpoint'>,
): number {
  return zoneTriggerPrice(bar, direction, source)
}

function reverseDirection(direction: ZoneDirection): ZoneDirection {
  return direction === 'bullish' ? 'bearish' : 'bullish'
}

function sourceKindForFVG(fvg: FairValueGap): Extract<ZoneKind, 'fvg' | 'vi' | 'og'> {
  if (fvg.kind === 'vi' || fvg.variant === 'VI') return 'vi'
  if (fvg.kind === 'og' || fvg.variant === 'OG') return 'og'
  return 'fvg'
}
