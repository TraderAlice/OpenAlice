/**
 * Inverse FVG (iFVG) Detection — 反转公允价值缺口检测
 *
 * iFVG: FVG breaker 获得反转/冲动确认后的更严格子集。
 *
 * 严格识别条件：
 * 1. 来源必须是 fvg_breaker
 * 2. breaker 形成后出现同方向吞没蜡烛（engulfing pattern）
 * 3. 冲动移动：确认 K 线实体 >= 平均 range × 1.5
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type {
  BreakerZone,
  FairValueGapVariant,
  InverseFVG,
  PriceActionVolumeConfirmation,
  VolumeConfirmationConfidence,
} from './types.js'
import { calculateATR, calculateAverageRange, calculateBodySize, isEngulfing } from './indicators.js'

export interface IFVGDetectionParams {
  bars: OhlcvBar[]
  breakers: BreakerZone[]
  /** ATR 计算周期（默认 14） */
  atrPeriod?: number
  /** 平均 range 计算周期（默认 20） */
  avgRangePeriod?: number
  /** 冲动移动倍数阈值（默认 1.5） */
  impulseThreshold?: number
  /** FVG breaker 形成后最多向后搜索多少根 K 线（默认 20） */
  maxLookAheadBars?: number
  /** 价格离 breaker 中点超过 zone 大小的该倍数后停止搜索（默认 1.5） */
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
    breakers,
    atrPeriod = 14,
    avgRangePeriod = 20,
    impulseThreshold = 1.5,
    maxLookAheadBars = 20,
    maxDistanceFromGapMultiplier = 1.5,
    volumeConfirmations,
  } = params

  if (bars.length < Math.max(atrPeriod, avgRangePeriod) || breakers.length === 0) {
    return []
  }

  const ifvgs: InverseFVG[] = []
  const atr = calculateATR(bars, atrPeriod)
  const avgRanges = calculateAverageRange(bars, avgRangePeriod)

  for (const breaker of breakers) {
    if (breaker.kind !== 'fvg_breaker') continue

    const startIndex = breaker.formedAtIndex
    const endIndex = Math.min(
      startIndex + maxLookAheadBars,
      breaker.lifecycle.invalidatedAtIndex ?? bars.length,
      bars.length,
    )
    const gapMidPrice = breaker.midpoint
    const maxDistanceFromGap = breaker.size * maxDistanceFromGapMultiplier

    // 检查 breaker 形成后的几根 K 线；若价格已经远离区域，则停止搜索。
    for (let i = startIndex; i < endIndex; i++) {
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

      // 条件3: 确认方向必须与 breaker 方向一致
      const currentBullish = currentBar.close > currentBar.open

      if (
        (breaker.direction === 'bullish' && !currentBullish) ||
        (breaker.direction === 'bearish' && currentBullish)
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
        type: breaker.direction === 'bullish' ? 'bullish_ifvg' : 'bearish_ifvg',
        variant: variantFromBreakerSource(breaker),
        top: breaker.top,
        bottom: breaker.bottom,
        breakerId: breaker.id,
        source: {
          kind: 'fvg_breaker',
          id: breaker.id,
          index: breaker.formedAtIndex,
          timeframe: breaker.timeframe,
        },
        reversalIndex: i,
        engulfingStrength,
        impulseRatio,
        reversalVolumeConfirmation: volumeConfirmationFor(volumeConfirmations, i, breaker.direction),
      })

      // 每个 breaker 只检测一次 iFVG
      break
    }
  }

  return ifvgs
}

function variantFromBreakerSource(breaker: BreakerZone): FairValueGapVariant {
  if (breaker.source?.kind === 'vi') return 'VI'
  if (breaker.source?.kind === 'og') return 'OG'
  return 'FVG'
}
