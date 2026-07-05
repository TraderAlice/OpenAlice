/**
 * Fair Value Gap (FVG) Detection — 公允价值缺口检测
 *
 * 检测价格失衡，并追踪填补状态（基于 close 或 wick）。
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types'
import type {
  FairValueGap,
  FairValueGapMitigationSource,
  FairValueGapVariant,
  PriceActionVolumeConfirmation,
  PriceActionVolumeConfirmationInput,
} from './types.js'

export interface FVGDetectionParams {
  bars: OhlcvBar[]
  /** Gap variant: standard FVG, Volume Imbalance, Opening Gap, or all (default FVG) */
  gapMode?: FairValueGapVariant | 'all'
  /** Mitigation source matching Pine's Close/Wick option (default close) */
  mitigationSource?: FairValueGapMitigationSource
  /** 最小 gap 大小（points），用于过滤噪音 */
  minGapSize?: number
  /** 中间K线实体占比阈值（默认 0.7） */
  minBodyRatio?: number
  volumeConfirmations?: Map<number, PriceActionVolumeConfirmationInput>
}

/**
 * 计算 FVG 的填补状态
 *
 * 遍历 gap 形成后的所有 bars，检查 close/wick 是否进入 gap 区域
 */
function calculateFillStatus(
  fvgType: 'bullish' | 'bearish',
  top: number,
  bottom: number,
  formationIndex: number,
  bars: OhlcvBar[],
  mitigationSource: FairValueGapMitigationSource,
): {
  isFilled: boolean
  fillPercentage: number
  filledAtIndex?: number
  completelyFilled: boolean
} {
  const gapSize = top - bottom
  let maxFillPercentage = 0
  let filledAtIndex: number | undefined

  // 遍历 FVG 形成后的所有 K 线
  for (let i = formationIndex + 1; i < bars.length; i++) {
    const bar = bars[i]
    const price = mitigationSource === 'close'
      ? bar.close
      : fvgType === 'bullish' ? bar.low : bar.high

    // 完全填补检测：价格穿过整个 gap
    if (
      (fvgType === 'bullish' && price <= bottom) ||
      (fvgType === 'bearish' && price >= top)
    ) {
      maxFillPercentage = 1.0
      if (filledAtIndex === undefined) {
        filledAtIndex = i
      }
      break
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
        if (filledAtIndex === undefined) {
          filledAtIndex = i
        }
      }
    }
  }

  return {
    isFilled: maxFillPercentage > 0,
    fillPercentage: maxFillPercentage,
    filledAtIndex,
    completelyFilled: maxFillPercentage >= 1.0,
  }
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
    minGapSize: number
    mitigationSource: FairValueGapMitigationSource
    volumeConfirmations?: Map<number, PriceActionVolumeConfirmationInput>
  },
): void {
  const size = opts.top - opts.bottom
  if (size < opts.minGapSize) return

  const fillStatus = calculateFillStatus(
    opts.type,
    opts.top,
    opts.bottom,
    opts.formationIndex,
    opts.bars,
    opts.mitigationSource,
  )

  out.push({
    type: opts.type,
    variant: opts.variant,
    top: opts.top,
    bottom: opts.bottom,
    formationIndex: opts.formationIndex,
    confirmationIndex: opts.confirmationIndex,
    size,
    ...fillStatus,
    formationVolumeConfirmation: volumeConfirmationFor(opts.volumeConfirmations, opts.confirmationIndex, opts.type),
  })
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
  const {
    bars,
    gapMode = 'FVG',
    mitigationSource = 'close',
    minGapSize = 0,
    minBodyRatio = 0.7,
    volumeConfirmations,
  } = params

  if (bars.length < 3) {
    return []
  }

  const fvgs: FairValueGap[] = []
  const variants = new Set(enabledVariants(gapMode))

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
          formationIndex: i + 1, confirmationIndex: i + 2, minGapSize, mitigationSource, volumeConfirmations,
        })
      }
      if (bar1.low > bar3.high) {
        pushGap(fvgs, {
          bars, variant: 'FVG', type: 'bearish', top: bar1.low, bottom: bar3.high,
          formationIndex: i + 1, confirmationIndex: i + 2, minGapSize, mitigationSource, volumeConfirmations,
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
          formationIndex: i + 2, confirmationIndex: i + 2, minGapSize, mitigationSource, volumeConfirmations,
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
          formationIndex: i + 2, confirmationIndex: i + 2, minGapSize, mitigationSource, volumeConfirmations,
        })
      }
    }

    if (variants.has('OG')) {
      // Pine OG: opening gap between current candle and previous candle wick.
      if (bar3.low > bar2.high) {
        pushGap(fvgs, {
          bars, variant: 'OG', type: 'bullish', top: bar3.low, bottom: bar2.high,
          formationIndex: i + 2, confirmationIndex: i + 2, minGapSize, mitigationSource, volumeConfirmations,
        })
      }
      if (bar3.high < bar2.low) {
        pushGap(fvgs, {
          bars, variant: 'OG', type: 'bearish', top: bar2.low, bottom: bar3.high,
          formationIndex: i + 2, confirmationIndex: i + 2, minGapSize, mitigationSource, volumeConfirmations,
        })
      }
    }
  }

  return fvgs
}
