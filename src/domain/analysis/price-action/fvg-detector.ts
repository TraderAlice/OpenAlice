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
  ZoneState,
} from './types.js'
import { calculatePriceActionVolatility } from './indicators.js'
import { applyZoneOverlapFiltering, buildFamilyFilterMeta } from './overlap-filter.js'
import { bodyHigh, bodyLow } from './zone-price.js'
import { evaluateZoneLifecycle } from './zone-lifecycle.js'

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

  const lifecycle = evaluateZoneLifecycle({
    bars: opts.bars,
    role: 'source_zone_retrace',
    direction: opts.type,
    top: opts.top,
    bottom: opts.bottom,
    formedAtIndex: opts.formationIndex,
    confirmedAtIndex: opts.confirmationIndex,
    startIndex: opts.confirmationIndex + 1,
    mitigationSource: opts.zoneMitigationSource,
  })
  const fillStatus = {
    isFilled: lifecycle.filled,
    fillPercentage: lifecycle.fillPercentage,
    filledAtIndex: lifecycle.filledAtIndex,
    completelyFilled: lifecycle.fullyFilled,
    state: lifecycle.state,
    lifecycle: lifecycle.lifecycle,
  }

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
