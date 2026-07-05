/**
 * Volumetric Order Block detection.
 *
 * Volumetric OB model: when structure breaks, locate the extreme candle between
 * the broken swing and breakout, derive a zone from that candle, then mark it
 * mitigated when price closes through its boundary.
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types'
import type {
  BreakOfStructure,
  ChangeOfCharacter,
  OrderBlock,
  OrderBlockMitigationMode,
  OrderBlockOverlapMethod,
  OrderBlockPositionMode,
  OrderBlockTrigger,
  OrderBlockVolumeConfirmation,
  PriceActionVolumeConfirmationInput,
  StructureLevel,
} from './types.js'

export interface DetectOrderBlocksParams {
  bars: OhlcvBar[]
  bos: BreakOfStructure[]
  choch: ChangeOfCharacter[]
  levels?: StructureLevel[]
  triggerFilter?: 'all' | OrderBlockTrigger
  positionMode?: OrderBlockPositionMode
  mitigationMode?: OrderBlockMitigationMode
  includeMitigated?: boolean
  maxOrderBlocks?: number
  volumeConfirmations?: Map<number, OrderBlockVolumeConfirmationInput>
  hideOverlap?: boolean
  overlapMethod?: OrderBlockOverlapMethod
}

type StructureBreak = (BreakOfStructure | ChangeOfCharacter) & { trigger: OrderBlockTrigger }

export type OrderBlockVolumeConfirmationInput = PriceActionVolumeConfirmationInput

function candleDirection(bar: OhlcvBar): 'bullish' | 'bearish' | 'doji' {
  if (bar.close > bar.open) return 'bullish'
  if (bar.close < bar.open) return 'bearish'
  return 'doji'
}

function ohlc4(bar: OhlcvBar): number {
  return (bar.open + bar.high + bar.low + bar.close) / 4
}

function hl2(bar: OhlcvBar): number {
  return (bar.high + bar.low) / 2
}

function hlcc4(bar: OhlcvBar): number {
  return (bar.high + bar.low + bar.close + bar.close) / 4
}

function positionPrice(bar: OhlcvBar, type: 'bullish' | 'bearish', mode: OrderBlockPositionMode): number {
  switch (mode) {
    case 'full':
      return type === 'bullish' ? bar.high : bar.low
    case 'middle':
      return ohlc4(bar)
    case 'accurate':
    case 'precise':
      return hl2(bar)
  }
}

function findExtremeIndex(
  bars: OhlcvBar[],
  type: 'bullish' | 'bearish',
  fromIndex: number,
  toIndex: number,
): number | null {
  const start = Math.max(0, Math.min(fromIndex, toIndex))
  const end = Math.min(bars.length - 1, Math.max(fromIndex, toIndex))
  if (end < start) return null

  let best = start
  for (let i = start + 1; i <= end; i++) {
    if (type === 'bullish') {
      if (bars[i].low < bars[best].low) best = i
    } else if (bars[i].high > bars[best].high) {
      best = i
    }
  }
  return best
}

function buildZone(
  bars: OhlcvBar[],
  type: 'bullish' | 'bearish',
  extremeIndex: number,
  mode: OrderBlockPositionMode,
): Pick<OrderBlock, 'top' | 'bottom' | 'middle' | 'size'> {
  const extremeBar = bars[extremeIndex]
  // Pine uses the candle one bar before the located extreme for the body-side
  // boundary. Clamp for short synthetic/test windows.
  const bodyBar = bars[Math.max(0, extremeIndex - 1)]

  let top = type === 'bullish'
    ? positionPrice(bodyBar, type, mode)
    : extremeBar.high
  let bottom = type === 'bullish'
    ? extremeBar.low
    : positionPrice(bodyBar, type, mode)
  let middle = (top + bottom) / 2

  if (mode === 'precise') {
    if (type === 'bullish') {
      const bodyFloor = Math.min(bodyBar.open, bodyBar.close)
      if (middle < bodyFloor && top > hlcc4(bodyBar)) top = middle
    } else {
      const bodyCeiling = Math.max(bodyBar.open, bodyBar.close)
      if (middle > bodyCeiling && bottom < hlcc4(bodyBar)) bottom = middle
    }
    middle = (top + bottom) / 2
  }

  const normalizedTop = Math.max(top, bottom)
  const normalizedBottom = Math.min(top, bottom)
  return {
    top: normalizedTop,
    bottom: normalizedBottom,
    middle: (normalizedTop + normalizedBottom) / 2,
    size: normalizedTop - normalizedBottom,
  }
}

function mitigationTarget(ob: Pick<OrderBlock, 'type' | 'bottom' | 'top' | 'middle'>, mode: OrderBlockMitigationMode): number {
  if (mode === 'middle') return ob.middle
  return ob.type === 'bullish' ? ob.bottom : ob.top
}

function findMitigationIndex(
  bars: OhlcvBar[],
  ob: Pick<OrderBlock, 'type' | 'bottom' | 'top' | 'middle' | 'breakoutIndex'>,
  mode: OrderBlockMitigationMode,
): number | undefined {
  const target = mitigationTarget(ob, mode)
  for (let i = ob.breakoutIndex + 1; i < bars.length; i++) {
    const close = bars[i].close
    if (ob.type === 'bullish' ? close < target : close > target) return i
  }
  return undefined
}

function triggerMatches(trigger: OrderBlockTrigger, filter: 'all' | OrderBlockTrigger): boolean {
  return filter === 'all' || trigger === filter
}

function volumeConfirmationFor(
  confirmations: Map<number, OrderBlockVolumeConfirmationInput> | undefined,
  index: number,
  type: 'bullish' | 'bearish',
): OrderBlockVolumeConfirmation | undefined {
  const confirmation = confirmations?.get(index)
  if (!confirmation) return undefined

  return {
    ...confirmation,
    alignedWithPattern: type === 'bullish'
      ? confirmation.delta > 0
      : confirmation.delta < 0,
    alignedWithBlock: type === 'bullish'
      ? confirmation.delta > 0
      : confirmation.delta < 0,
  }
}

function addInternalActivityFromIntrabar(
  ob: OrderBlock,
  anchorVolume: OrderBlockVolumeConfirmation | undefined,
): void {
  if (!anchorVolume || ob.volume == null || ob.volume <= 0) return

  const signedDelta = Math.max(-ob.volume, Math.min(ob.volume, anchorVolume.deltaRatio * ob.volume))
  const buyVolume = Math.max(0, (ob.volume + signedDelta) / 2)
  const sellVolume = Math.max(0, (ob.volume - signedDelta) / 2)
  const total = buyVolume + sellVolume
  if (total <= 0) return

  ob.internalBuyVolume = buyVolume
  ob.internalSellVolume = sellVolume
  ob.internalBuyVolumePct = Math.floor((buyVolume / total) * 100)
  ob.internalSellVolumePct = Math.floor((sellVolume / total) * 100)
}

function overlapsPineStyle(current: OrderBlock, previous: OrderBlock): boolean {
  if (current.type !== previous.type || current.level !== previous.level) return false
  return current.type === 'bullish'
    ? current.bottom < previous.top
    : current.top > previous.bottom
}

function pushWithOverlapPolicy(
  out: OrderBlock[],
  ob: OrderBlock,
  hideOverlap: boolean,
  overlapMethod: OrderBlockOverlapMethod,
): void {
  if (!hideOverlap) {
    out.push(ob)
    return
  }

  const previousIndex = out.findLastIndex((candidate) => overlapsPineStyle(ob, candidate))
  if (previousIndex === -1) {
    out.push(ob)
    return
  }

  if (overlapMethod === 'recent') {
    out.splice(previousIndex, 1)
    out.push(ob)
  }
}

export function detectOrderBlocks(params: DetectOrderBlocksParams): OrderBlock[] {
  const {
    bars,
    bos,
    choch,
    levels = ['internal', 'swing'],
    triggerFilter = 'all',
    positionMode = 'precise',
    mitigationMode = 'absolute',
    includeMitigated = false,
    maxOrderBlocks = 10,
    volumeConfirmations,
    hideOverlap = true,
    overlapMethod = 'previous',
  } = params

  if (bars.length === 0) return []

  const levelSet = new Set(levels)
  const breaks: StructureBreak[] = [
    ...bos.map((b) => ({ ...b, trigger: 'BOS' as const })),
    ...choch.map((c) => ({ ...c, trigger: 'CHoCH' as const })),
  ]
    .filter((b) => levelSet.has(b.level))
    .filter((b) => triggerMatches(b.trigger, triggerFilter))
    .sort((a, b) => a.index - b.index)

  const out: OrderBlock[] = []

  for (const brk of breaks) {
    const extremeIndex = findExtremeIndex(
      bars,
      brk.type,
      brk.brokenSwing.index,
      Math.max(brk.brokenSwing.index, brk.index - 1),
    )
    if (extremeIndex == null) continue

    const zone = buildZone(bars, brk.type, extremeIndex, positionMode)
    if (zone.size <= 0) continue

    const volume = bars[extremeIndex].volume
    const anchorVolumeConfirmation = volumeConfirmationFor(volumeConfirmations, extremeIndex, brk.type)
    const ob: OrderBlock = {
      type: brk.type,
      level: brk.level,
      trigger: brk.trigger,
      ...zone,
      index: extremeIndex,
      breakoutIndex: brk.index,
      breakoutPrice: brk.price,
      brokenSwing: brk.brokenSwing,
      volume,
      candleDirection: candleDirection(bars[extremeIndex]),
      mitigated: false,
      anchorVolumeConfirmation,
      breakoutVolumeConfirmation: volumeConfirmationFor(volumeConfirmations, brk.index, brk.type),
    }
    addInternalActivityFromIntrabar(ob, anchorVolumeConfirmation)

    const mitigatedAtIndex = findMitigationIndex(bars, ob, mitigationMode)
    if (mitigatedAtIndex !== undefined) {
      ob.mitigated = true
      ob.mitigatedAtIndex = mitigatedAtIndex
    }
    if (!includeMitigated && ob.mitigated) continue

    pushWithOverlapPolicy(out, ob, hideOverlap, overlapMethod)
  }

  const ranked = out
    .sort((a, b) => b.breakoutIndex - a.breakoutIndex)
    .slice(0, maxOrderBlocks === 0 ? undefined : maxOrderBlocks)

  const totalVolume = ranked.reduce((sum, ob) => sum + Math.max(0, ob.volume ?? 0), 0)
  if (totalVolume > 0) {
    for (const ob of ranked) {
      ob.volumeSharePct = Math.floor(((ob.volume ?? 0) / totalVolume) * 100)
    }
  }

  return ranked
}
