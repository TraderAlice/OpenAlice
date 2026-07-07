/**
 * Fair Value Gap (FVG) Detection — 公允价值缺口检测
 *
 * 检测价格失衡，并追踪填补状态。
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type {
  FairValueGap,
  FairValueGapVariant,
  PriceActionFamilyFilterMeta,
  PriceActionVolumeConfirmation,
  PriceActionVolumeConfirmationInput,
  ZoneOverlapPolicy,
  ZoneMitigationSource,
  ZoneLifecycle,
  ZoneState,
} from './types.js'
import { calculatePriceActionVolatility } from './indicators.js'
import { applyZoneOverlapFiltering, buildFamilyFilterMeta } from './overlap-filter.js'

export interface FVGDetectionParams {
  bars: OhlcvBar[]
  /** Gap variant: standard FVG, Volume Imbalance, Opening Gap, or all (default FVG) */
  gapMode?: FairValueGapVariant | 'all'
  /** Zone mitigation source for lifecycle checks (default body) */
  zoneMitigationSource?: ZoneMitigationSource
  /** Minimum gap size normalized by formation ATR/volatility */
  minGapAtrMultiplier?: number
  /** Optional precomputed volatility/ATR by absolute bar index */
  formationVolatilityByIndex?: number[]
  /** 中间K线实体占比阈值（默认 0.7） */
  minBodyRatio?: number
  /** Include filled/invalidated resolved zones. Defaults to false. */
  includeResolved?: boolean
  /** Remove overlapping same-bucket zones. Defaults to ranked. */
  overlapPolicy?: ZoneOverlapPolicy
  volumeConfirmations?: Map<number, PriceActionVolumeConfirmationInput>
}

export interface FVGDetectionResult {
  fvgs: FairValueGap[]
  meta: PriceActionFamilyFilterMeta
}

/**
 * 计算 FVG 的填补状态
 *
 * 遍历 gap 形成后的所有 bars，检查 close/wick 是否进入 gap 区域
 */
function calculateLifecycle(
  fvgType: 'bullish' | 'bearish',
  top: number,
  bottom: number,
  formationIndex: number,
  confirmationIndex: number,
  bars: OhlcvBar[],
  zoneMitigationSource: ZoneMitigationSource,
): {
  isFilled: boolean
  fillPercentage: number
  filledAtIndex?: number
  completelyFilled: boolean
  state: ZoneState
  lifecycle: ZoneLifecycle
} {
  const gapSize = top - bottom
  const midpoint = (top + bottom) / 2
  let maxFillPercentage = 0
  let filledAtIndex: number | undefined
  let firstTouchedAtIndex: number | undefined
  let lastTouchedAtIndex: number | undefined
  let mitigatedAtIndex: number | undefined
  let fullyFilledAtIndex: number | undefined
  let brokenAtIndex: number | undefined
  let currentlyInside = false

  // Lifecycle starts after the signal is confirmed; the confirmation candle defines the zone.
  for (let i = confirmationIndex + 1; i < bars.length; i++) {
    const bar = bars[i]
    const rangeIntersectsZone = bar.high >= bottom && bar.low <= top
    if (rangeIntersectsZone) {
      firstTouchedAtIndex ??= i
      lastTouchedAtIndex = i
      currentlyInside = true
    } else {
      currentlyInside = false
    }

    const price = sourcePrice(bar, fvgType, zoneMitigationSource)
    const fillTarget = fvgType === 'bullish' ? bottom : top

    // 完全填补检测：价格穿过整个 gap
    if (
      (fvgType === 'bullish' && price <= fillTarget) ||
      (fvgType === 'bearish' && price >= fillTarget)
    ) {
      maxFillPercentage = 1.0
      filledAtIndex ??= i
      fullyFilledAtIndex ??= i
      if (
        brokenAtIndex === undefined &&
        ((fvgType === 'bullish' && price < bottom) ||
          (fvgType === 'bearish' && price > top))
      ) {
        brokenAtIndex = i
      }
    }

    // 检查价格是否进入 gap（部分填补）
    if (price > bottom && price < top) {
      // 计算填补百分比
      let fillPercentage: number
      if (fvgType === 'bullish') {
        // 看涨 FVG: 价格从上方回落进入 gap，越接近 bottom 填补越彻底
        // fillPercentage = (top - close) / gapSize
        // close 接近 top 时接近 0，close 接近 bottom 时接近 1
        fillPercentage = (top - price) / gapSize
      } else {
        // 看跌 FVG: 价格从下方回升进入 gap，越接近 top 填补越彻底
        // fillPercentage = (close - bottom) / gapSize
        // close 接近 bottom 时接近 0，close 接近 top 时接近 1
        fillPercentage = (price - bottom) / gapSize
      }

      fillPercentage = Math.max(0, Math.min(1, fillPercentage))

      if (fillPercentage > maxFillPercentage) {
        maxFillPercentage = fillPercentage
        filledAtIndex ??= i
      }
    }

    if (mitigatedAtIndex === undefined && reachesMitigationTarget(fvgType, price, top, bottom, midpoint, zoneMitigationSource)) {
      mitigatedAtIndex = i
    }
  }

  const state = stateFromLifecycle({
    touched: firstTouchedAtIndex !== undefined,
    mitigated: mitigatedAtIndex !== undefined,
    filled: fullyFilledAtIndex !== undefined,
    broken: brokenAtIndex !== undefined,
  })

  const lifecycle: ZoneLifecycle = {
    formedAtIndex: formationIndex,
    confirmedAtIndex: confirmationIndex,
    firstTouchedAtIndex,
    lastTouchedAtIndex,
    currentlyInside,
    mitigatedAtIndex,
    fillPercentage: maxFillPercentage,
    filledAtIndex,
    fullyFilledAtIndex,
    brokenAtIndex,
  }

  return {
    isFilled: maxFillPercentage > 0,
    fillPercentage: maxFillPercentage,
    filledAtIndex,
    completelyFilled: maxFillPercentage >= 1.0,
    state,
    lifecycle,
  }
}

function sourcePrice(
  bar: OhlcvBar,
  direction: 'bullish' | 'bearish',
  zoneMitigationSource: ZoneMitigationSource,
): number {
  if (zoneMitigationSource === 'wick') {
    return direction === 'bullish' ? bar.low : bar.high
  }

  return direction === 'bullish' ? bodyLow(bar) : bodyHigh(bar)
}

function reachesMitigationTarget(
  direction: 'bullish' | 'bearish',
  price: number,
  top: number,
  bottom: number,
  midpoint: number,
  zoneMitigationSource: ZoneMitigationSource,
): boolean {
  if (zoneMitigationSource === 'midpoint') {
    return direction === 'bullish' ? price <= midpoint : price >= midpoint
  }

  return direction === 'bullish' ? price < top : price > bottom
}

function stateFromLifecycle(events: {
  touched: boolean
  mitigated: boolean
  filled: boolean
  broken: boolean
}): ZoneState {
  if (events.broken) return 'broken'
  if (events.filled) return 'filled'
  if (events.mitigated) return 'mitigated'
  if (events.touched) return 'touched'
  return 'active'
}

function bodyLow(bar: OhlcvBar): number {
  return Math.min(bar.open, bar.close)
}

function bodyHigh(bar: OhlcvBar): number {
  return Math.max(bar.open, bar.close)
}

function bodyRatio(bar: OhlcvBar): number {
  const totalSize = bar.high - bar.low
  return totalSize > 0 ? Math.abs(bar.close - bar.open) / totalSize : 0
}

function enabledVariants(gapMode: FairValueGapVariant | 'all'): FairValueGapVariant[] {
  return gapMode === 'all' ? ['FVG', 'VI', 'OG'] : [gapMode]
}

function pushGap(
  out: FairValueGap[],
  opts: {
    bars: OhlcvBar[]
    variant: FairValueGapVariant
    type: 'bullish' | 'bearish'
    top: number
    bottom: number
    formationIndex: number
    confirmationIndex: number
    minGapAtrMultiplier: number
    formationVolatility: number
    zoneMitigationSource: ZoneMitigationSource
    volumeConfirmations?: Map<number, PriceActionVolumeConfirmationInput>
  },
): void {
  const size = opts.top - opts.bottom
  const sizeAtr = size / Math.max(opts.formationVolatility, Number.EPSILON)
  if (sizeAtr < opts.minGapAtrMultiplier) return

  const fillStatus = calculateLifecycle(
    opts.type,
    opts.top,
    opts.bottom,
    opts.formationIndex,
    opts.confirmationIndex,
    opts.bars,
    opts.zoneMitigationSource,
  )

  const kind = opts.variant.toLowerCase() as 'fvg' | 'vi' | 'og'
  const midpoint = (opts.top + opts.bottom) / 2

  out.push({
    type: opts.type,
    variant: opts.variant,
    kind,
    direction: opts.type,
    top: opts.top,
    bottom: opts.bottom,
    midpoint,
    formedAtIndex: opts.formationIndex,
    confirmedAtIndex: opts.confirmationIndex,
    formationIndex: opts.formationIndex,
    confirmationIndex: opts.confirmationIndex,
    size,
    sizeAtr,
    ...fillStatus,
    formationVolumeConfirmation: volumeConfirmationFor(opts.volumeConfirmations, opts.confirmationIndex, opts.type),
  })
}

function shouldReturnZone(state: ZoneState): boolean {
  return state !== 'filled' && state !== 'invalidated'
}

function volumeConfirmationFor(
  confirmations: Map<number, PriceActionVolumeConfirmationInput> | undefined,
  index: number,
  type: 'bullish' | 'bearish',
): PriceActionVolumeConfirmation | undefined {
  const confirmation = confirmations?.get(index)
  if (!confirmation) return undefined

  return {
    ...confirmation,
    alignedWithPattern: type === 'bullish'
      ? confirmation.delta > 0
      : confirmation.delta < 0,
  }
}

export function detectFairValueGaps(params: FVGDetectionParams): FairValueGap[] {
  return detectFairValueGapsWithMeta(params).fvgs
}

export function detectFairValueGapsWithMeta(params: FVGDetectionParams): FVGDetectionResult {
  const {
    bars,
    gapMode = 'FVG',
    zoneMitigationSource = 'body',
    minGapAtrMultiplier = 0,
    formationVolatilityByIndex,
    minBodyRatio = 0.7,
    includeResolved = false,
    overlapPolicy = 'ranked',
    volumeConfirmations,
  } = params

  if (bars.length < 3) {
    return {
      fvgs: [],
      meta: buildFamilyFilterMeta({
        detectedCount: 0,
        afterLifecycleCount: 0,
        overlapFilteredCount: 0,
        returnedCount: 0,
      }),
    }
  }

  const fvgs: FairValueGap[] = []
  const variants = new Set(enabledVariants(gapMode))
  const volatility = calculatePriceActionVolatility(bars)
  const volatilityByIndex = formationVolatilityByIndex ?? volatility.formationVolatilityByIndex

  // 遍历所有可能的 FVG 模式（需要 3 根 K 线）
  for (let i = 0; i < bars.length - 2; i++) {
    const bar1 = bars[i] // 第一根
    const bar2 = bars[i + 1] // 中间根（用于验证实体强度）
    const bar3 = bars[i + 2] // 第三根

    if (variants.has('FVG') && bodyRatio(bar2) >= minBodyRatio) {
      // Standard FVG: first/third candle wick gap.
      if (bar3.low > bar1.high) {
        pushGap(fvgs, {
          bars, variant: 'FVG', type: 'bullish', top: bar3.low, bottom: bar1.high,
          formationIndex: i + 1, confirmationIndex: i + 2, minGapAtrMultiplier,
          formationVolatility: volatilityByIndex[i + 1], zoneMitigationSource, volumeConfirmations,
        })
      }
      if (bar1.low > bar3.high) {
        pushGap(fvgs, {
          bars, variant: 'FVG', type: 'bearish', top: bar1.low, bottom: bar3.high,
          formationIndex: i + 1, confirmationIndex: i + 2, minGapAtrMultiplier,
          formationVolatility: volatilityByIndex[i + 1], zoneMitigationSource, volumeConfirmations,
        })
      }
    }

    if (variants.has('VI')) {
      // Pine VI: body gap between current and previous candle plus overlap guard.
      const prevBodyTop = bodyHigh(bar2)
      const prevBodyBottom = bodyLow(bar2)
      const currBodyTop = bodyHigh(bar3)
      const currBodyBottom = bodyLow(bar3)

      if (
        bar3.open > bar2.close &&
        bar2.high > bar3.low &&
        bar3.close > bar2.close &&
        bar3.open > bar2.open &&
        bar2.high < Math.min(bar3.close, bar3.open)
      ) {
        pushGap(fvgs, {
          bars, variant: 'VI', type: 'bullish', top: currBodyBottom, bottom: prevBodyTop,
          formationIndex: i + 2, confirmationIndex: i + 2, minGapAtrMultiplier,
          formationVolatility: volatilityByIndex[i + 2], zoneMitigationSource, volumeConfirmations,
        })
      }

      if (
        bar3.open < bar2.close &&
        bar2.low < bar3.high &&
        bar3.close < bar2.close &&
        bar3.open < bar2.open &&
        bar2.low > Math.max(bar3.close, bar3.open)
      ) {
        pushGap(fvgs, {
          bars, variant: 'VI', type: 'bearish', top: prevBodyBottom, bottom: currBodyTop,
          formationIndex: i + 2, confirmationIndex: i + 2, minGapAtrMultiplier,
          formationVolatility: volatilityByIndex[i + 2], zoneMitigationSource, volumeConfirmations,
        })
      }
    }

    if (variants.has('OG')) {
      // Pine OG: opening gap between current candle and previous candle wick.
      if (bar3.low > bar2.high) {
        pushGap(fvgs, {
          bars, variant: 'OG', type: 'bullish', top: bar3.low, bottom: bar2.high,
          formationIndex: i + 2, confirmationIndex: i + 2, minGapAtrMultiplier,
          formationVolatility: volatilityByIndex[i + 2], zoneMitigationSource, volumeConfirmations,
        })
      }
      if (bar3.high < bar2.low) {
        pushGap(fvgs, {
          bars, variant: 'OG', type: 'bearish', top: bar2.low, bottom: bar3.high,
          formationIndex: i + 2, confirmationIndex: i + 2, minGapAtrMultiplier,
          formationVolatility: volatilityByIndex[i + 2], zoneMitigationSource, volumeConfirmations,
        })
      }
    }
  }

  const afterLifecycle = includeResolved ? fvgs : fvgs.filter((fvg) => shouldReturnZone(fvg.state ?? 'active'))
  const overlapFiltered = applyZoneOverlapFiltering(afterLifecycle, overlapPolicy, (fvg) => ({
    kind: fvg.kind ?? (fvg.variant.toLowerCase() as 'fvg' | 'vi' | 'og'),
    direction: fvg.direction ?? fvg.type,
    top: fvg.top,
    bottom: fvg.bottom,
    state: fvg.state ?? 'active',
    timeframe: fvg.timeframe,
    rank: fvg.rank,
    size: fvg.size,
    sizeAtr: fvg.sizeAtr,
    formedAtIndex: fvg.formedAtIndex ?? fvg.formationIndex,
    confirmedAtIndex: fvg.confirmedAtIndex ?? fvg.confirmationIndex,
  }))

  return {
    fvgs: overlapFiltered.items,
    meta: buildFamilyFilterMeta({
      detectedCount: fvgs.length,
      afterLifecycleCount: afterLifecycle.length,
      overlapFilteredCount: overlapFiltered.overlapFilteredCount,
      returnedCount: overlapFiltered.items.length,
    }),
  }
}
