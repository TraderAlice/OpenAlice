import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type { ZoneDirection, ZoneLifecycle, ZoneMitigationSource, ZoneState } from './types.js'
import { zoneTriggerPrice } from './zone-price.js'

export type ZoneLifecycleRole = 'source_zone_retrace' | 'order_block_retrace' | 'breaker_invalidation'

export interface EvaluateZoneLifecycleParams {
  bars: OhlcvBar[]
  role: ZoneLifecycleRole
  direction: ZoneDirection
  top: number
  bottom: number
  formedAtIndex: number
  confirmedAtIndex?: number
  startIndex: number
  mitigationSource: ZoneMitigationSource
}

export interface ZoneLifecycleEvaluation {
  state: ZoneState
  lifecycle: ZoneLifecycle
  touched: boolean
  mitigated: boolean
  filled: boolean
  fullyFilled: boolean
  broken: boolean
  invalidated: boolean
  fillPercentage: number
  filledAtIndex?: number
  fullyFilledAtIndex?: number
  mitigatedAtIndex?: number
  invalidatedAtIndex?: number
}

export function evaluateZoneLifecycle(params: EvaluateZoneLifecycleParams): ZoneLifecycleEvaluation {
  switch (params.role) {
    case 'source_zone_retrace':
      return evaluateSourceZoneRetrace(params)
    case 'order_block_retrace':
      return evaluateOrderBlockRetrace(params)
    case 'breaker_invalidation':
      return evaluateBreakerInvalidation(params)
  }
}

function evaluateSourceZoneRetrace(params: EvaluateZoneLifecycleParams): ZoneLifecycleEvaluation {
  const midpoint = midpointOf(params)
  const gapSize = params.top - params.bottom
  let firstTouchedAtIndex: number | undefined
  let lastTouchedAtIndex: number | undefined
  let mitigatedAtIndex: number | undefined
  let filledAtIndex: number | undefined
  let brokenAtIndex: number | undefined
  let maxFillPercentage = 0
  let currentlyInside = false

  for (let i = params.startIndex; i < params.bars.length; i++) {
    const bar = params.bars[i]
    const intersects = rangeIntersectsZone(bar, params)
    if (intersects) {
      firstTouchedAtIndex ??= i
      lastTouchedAtIndex = i
      currentlyInside = true
    } else {
      currentlyInside = false
    }

    const price = lifecyclePrice(bar, params.direction, params.mitigationSource)
    const fullFill = params.direction === 'bullish'
      ? price <= params.bottom
      : price >= params.top
    const broken = params.direction === 'bullish'
      ? price < params.bottom
      : price > params.top

    if (fullFill) {
      maxFillPercentage = 1
      filledAtIndex ??= i
      if (broken) brokenAtIndex ??= i
    } else {
      maxFillPercentage = Math.max(maxFillPercentage, fillPercentage(params.direction, price, params, gapSize))
    }

    if (
      mitigatedAtIndex === undefined &&
      reachesSourceMitigationTarget(params.direction, price, params.top, params.bottom, midpoint, params.mitigationSource)
    ) {
      mitigatedAtIndex = i
    }
  }

  const state = stateFromEvents({
    touched: firstTouchedAtIndex !== undefined,
    mitigated: mitigatedAtIndex !== undefined,
    filled: filledAtIndex !== undefined,
    broken: brokenAtIndex !== undefined,
    invalidated: false,
  })
  const lifecycle: ZoneLifecycle = {
    formedAtIndex: params.formedAtIndex,
    confirmedAtIndex: params.confirmedAtIndex,
    firstTouchedAtIndex,
    lastTouchedAtIndex,
    currentlyInside,
    mitigatedAtIndex,
    fillPercentage: maxFillPercentage,
    filledAtIndex,
    fullyFilledAtIndex: filledAtIndex,
    brokenAtIndex,
  }

  return buildEvaluation(state, lifecycle)
}

function evaluateOrderBlockRetrace(params: EvaluateZoneLifecycleParams): ZoneLifecycleEvaluation {
  const midpoint = midpointOf(params)
  let firstTouchedAtIndex: number | undefined
  let lastTouchedAtIndex: number | undefined
  let mitigatedAtIndex: number | undefined
  let currentlyInside = false

  for (let i = params.startIndex; i < params.bars.length; i++) {
    const bar = params.bars[i]
    const intersects = rangeIntersectsZone(bar, params)
    if (intersects) {
      firstTouchedAtIndex ??= i
      lastTouchedAtIndex = i
      currentlyInside = true
    } else {
      currentlyInside = false
    }

    const price = lifecyclePrice(bar, params.direction, params.mitigationSource)
    const target = params.mitigationSource === 'midpoint'
      ? midpoint
      : params.direction === 'bullish'
        ? params.bottom
        : params.top
    if (mitigatedAtIndex === undefined && (params.direction === 'bullish' ? price < target : price > target)) {
      mitigatedAtIndex = i
    }
  }

  const state = stateFromEvents({
    touched: firstTouchedAtIndex !== undefined,
    mitigated: mitigatedAtIndex !== undefined,
    filled: false,
    broken: false,
    invalidated: false,
  })
  const lifecycle: ZoneLifecycle = {
    formedAtIndex: params.formedAtIndex,
    confirmedAtIndex: params.confirmedAtIndex,
    firstTouchedAtIndex,
    lastTouchedAtIndex,
    currentlyInside,
    mitigatedAtIndex,
  }

  return buildEvaluation(state, lifecycle)
}

function evaluateBreakerInvalidation(params: EvaluateZoneLifecycleParams): ZoneLifecycleEvaluation {
  let invalidatedAtIndex: number | undefined

  for (let i = params.startIndex; i < params.bars.length; i++) {
    const price = lifecyclePrice(params.bars[i], params.direction, params.mitigationSource)
    if (params.direction === 'bearish' ? price > params.top : price < params.bottom) {
      invalidatedAtIndex = i
      break
    }
  }

  const state = stateFromEvents({
    touched: false,
    mitigated: false,
    filled: false,
    broken: false,
    invalidated: invalidatedAtIndex !== undefined,
  })
  const lifecycle: ZoneLifecycle = {
    formedAtIndex: params.formedAtIndex,
    confirmedAtIndex: params.confirmedAtIndex,
    invalidatedAtIndex,
  }

  return buildEvaluation(state, lifecycle)
}

function buildEvaluation(state: ZoneState, lifecycle: ZoneLifecycle): ZoneLifecycleEvaluation {
  return {
    state,
    lifecycle,
    touched: lifecycle.firstTouchedAtIndex !== undefined,
    mitigated: lifecycle.mitigatedAtIndex !== undefined,
    filled: lifecycle.filledAtIndex !== undefined,
    fullyFilled: lifecycle.fullyFilledAtIndex !== undefined,
    broken: lifecycle.brokenAtIndex !== undefined,
    invalidated: lifecycle.invalidatedAtIndex !== undefined,
    fillPercentage: lifecycle.fillPercentage ?? 0,
    filledAtIndex: lifecycle.filledAtIndex,
    fullyFilledAtIndex: lifecycle.fullyFilledAtIndex,
    mitigatedAtIndex: lifecycle.mitigatedAtIndex,
    invalidatedAtIndex: lifecycle.invalidatedAtIndex,
  }
}

function stateFromEvents(events: {
  touched: boolean
  mitigated: boolean
  filled: boolean
  broken: boolean
  invalidated: boolean
}): ZoneState {
  if (events.invalidated) return 'invalidated'
  if (events.broken) return 'broken'
  if (events.filled) return 'filled'
  if (events.mitigated) return 'mitigated'
  if (events.touched) return 'touched'
  return 'active'
}

function rangeIntersectsZone(bar: OhlcvBar, zone: Pick<EvaluateZoneLifecycleParams, 'top' | 'bottom'>): boolean {
  return bar.high >= zone.bottom && bar.low <= zone.top
}

function lifecyclePrice(bar: OhlcvBar, direction: ZoneDirection, source: ZoneMitigationSource): number {
  return zoneTriggerPrice(bar, direction, source === 'midpoint' ? 'body' : source)
}

function midpointOf(zone: Pick<EvaluateZoneLifecycleParams, 'top' | 'bottom'>): number {
  return (zone.top + zone.bottom) / 2
}

function fillPercentage(
  direction: ZoneDirection,
  price: number,
  zone: Pick<EvaluateZoneLifecycleParams, 'top' | 'bottom'>,
  gapSize: number,
): number {
  if (price <= zone.bottom || price >= zone.top) return 0

  const raw = direction === 'bullish'
    ? (zone.top - price) / gapSize
    : (price - zone.bottom) / gapSize
  return Math.max(0, Math.min(1, raw))
}

function reachesSourceMitigationTarget(
  direction: ZoneDirection,
  price: number,
  top: number,
  bottom: number,
  midpoint: number,
  source: ZoneMitigationSource,
): boolean {
  if (source === 'midpoint') {
    return direction === 'bullish' ? price <= midpoint : price >= midpoint
  }

  return direction === 'bullish' ? price < top : price > bottom
}
