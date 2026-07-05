/**
 * Inverse FVG (iFVG) Detection — 反转公允价值缺口检测
 *
 * iFVG: FVG 被填补后，价格从中反转，原失衡区转变为机构订单区（支撑/阻力）。
 *
 * 严格识别条件：
 * 1. FVG 已被填补（fillPercentage > 0）
 * 2. 填补后出现吞没蜡烛（engulfing pattern）
 * 3. 冲动移动：反转K线实体 >= 平均 range × 1.5
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types'
import type {
  FairValueGap,
  InverseFVG,
  PriceActionVolumeConfirmation,
  VolumeConfirmationConfidence,
} from './types.js'
import { calculateATR, calculateAverageRange, calculateBodySize, isEngulfing } from './indicators.js'

export interface IFVGDetectionParams {
  bars: OhlcvBar[]
  fvgs: FairValueGap[]
  /** ATR 计算周期（默认 14） */
  atrPeriod?: number
  /** 平均 range 计算周期（默认 20） */
  avgRangePeriod?: number
  /** 冲动移动倍数阈值（默认 1.5） */
  impulseThreshold?: number
  /** FVG 填补后最多向后搜索多少根 K 线（默认 20） */
  maxLookAheadBars?: number
  /** 价格离 FVG 中点超过 gap 大小的该倍数后停止搜索（默认 1.5） */
  maxDistanceFromGapMultiplier?: number
  volumeConfirmations?: Map<number, PriceActionVolumeConfirmationInput>
}

export interface PriceActionVolumeConfirmationInput {
  delta: number
  deltaRatio: number
  coverage: number
  confidence: VolumeConfirmationConfidence
  intrabarInterval: string
  intrabarCount: number
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

/**
 * 检测 Inverse FVG
 *
 * 严格版：需要吞没蜡烛 + 冲动移动
 */
export function detectInverseFVG(params: IFVGDetectionParams): InverseFVG[] {
  const {
    bars,
    fvgs,
    atrPeriod = 14,
    avgRangePeriod = 20,
    impulseThreshold = 1.5,
    maxLookAheadBars = 20,
    maxDistanceFromGapMultiplier = 1.5,
    volumeConfirmations,
  } = params

  if (bars.length < Math.max(atrPeriod, avgRangePeriod) || fvgs.length === 0) {
    return []
  }

  const ifvgs: InverseFVG[] = []
  const atr = calculateATR(bars, atrPeriod)
  const avgRanges = calculateAverageRange(bars, avgRangePeriod)

  // 遍历所有已填补的 FVG
  for (const fvg of fvgs) {
    // 必须已被填补
    if (!fvg.isFilled || fvg.filledAtIndex === undefined) {
      continue
    }

    // 从填补位置开始，寻找反转 K 线
    const startIndex = fvg.filledAtIndex
    const gapMidPrice = (fvg.top + fvg.bottom) / 2
    const maxDistanceFromGap = fvg.size * maxDistanceFromGapMultiplier

    // 检查填补后的几根 K 线；若价格已经远离 FVG 区域，则停止搜索。
    for (let i = startIndex; i < Math.min(startIndex + maxLookAheadBars, bars.length); i++) {
      const currentBar = bars[i]
      const previousBar = i > 0 ? bars[i - 1] : null

      if (!previousBar) continue
      if (Math.abs(currentBar.close - gapMidPrice) > maxDistanceFromGap) break

      // 条件1: 检查吞没形态
      if (!isEngulfing(currentBar, previousBar)) {
        continue
      }

      // 条件2: 检查冲动移动
      const bodySize = calculateBodySize(currentBar)
      const avgRange = avgRanges[i]

      if (avgRange === 0 || bodySize < avgRange * impulseThreshold) {
        continue
      }

      // 条件3: 反转方向必须与原 FVG 方向一致
      // 看涨 FVG 填补后，应该出现看涨反转（iFVG 作为支撑）
      // 看跌 FVG 填补后，应该出现看跌反转（iFVG 作为阻力）
      const currentBullish = currentBar.close > currentBar.open

      if (
        (fvg.type === 'bullish' && !currentBullish) ||
        (fvg.type === 'bearish' && currentBullish)
      ) {
        continue
      }

      // 计算吞没强度（相对 ATR）
      const rangeSize = currentBar.high - currentBar.low
      const currentATR = atr[i]
      const engulfingStrength = currentATR > 0 ? rangeSize / currentATR : 0

      // 计算冲动移动倍数
      const impulseRatio = avgRange > 0 ? bodySize / avgRange : 0

      // 创建 iFVG
      ifvgs.push({
        type: fvg.type === 'bullish' ? 'bullish_ifvg' : 'bearish_ifvg',
        variant: fvg.variant,
        top: fvg.top,
        bottom: fvg.bottom,
        originalFVG: fvg,
        reversalIndex: i,
        engulfingStrength,
        impulseRatio,
        reversalVolumeConfirmation: volumeConfirmationFor(volumeConfirmations, i, fvg.type),
      })

      // 每个 FVG 只检测一次 iFVG
      break
    }
  }

  return ifvgs
}
