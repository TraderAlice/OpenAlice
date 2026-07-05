/**
 * Price Action Analysis — 共享类型定义
 *
 * FVG (Fair Value Gaps), iFVG (Inverse FVG), OB, BOS/CHoCH (Market Structure)
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types'

// ==================== Swing Points ====================

export interface SwingPoint {
  /** Bar 索引 */
  index: number
  /** 价格 */
  price: number
  /** Swing 类型 */
  type: 'high' | 'low'
}

export interface SwingPointLevels {
  /** Internal structure (lookback=5) */
  internal: {
    highs: SwingPoint[]
    lows: SwingPoint[]
  }
  /** Swing structure (lookback=20) */
  swing: {
    highs: SwingPoint[]
    lows: SwingPoint[]
  }
  /** External structure (lookback=50) */
  external: {
    highs: SwingPoint[]
    lows: SwingPoint[]
  }
}

// ==================== Fair Value Gaps ====================

export type FairValueGapVariant = 'FVG' | 'VI' | 'OG'
export type FairValueGapMitigationSource = 'close' | 'wick'
export type VolumeConfirmationConfidence = 'high' | 'usable' | 'low' | 'not_recommended'

export interface PriceActionVolumeConfirmation {
  /** Intrabar signed volume for this target bar */
  delta: number
  /** delta / intrabar volume, normalized to [-1, 1] */
  deltaRatio: number
  /** min(intrabar volume / target bar volume, 1) */
  coverage: number
  /** Confidence derived from coverage */
  confidence: VolumeConfirmationConfidence
  /** Lower timeframe used for the intrabar aggregation */
  intrabarInterval: string
  /** Number of intrabars available in the whole analyzed window */
  intrabarCount: number
  /** Whether delta direction agrees with the pattern direction */
  alignedWithPattern: boolean
}

export interface PriceActionVolumeConfirmationInput {
  delta: number
  deltaRatio: number
  coverage: number
  confidence: VolumeConfirmationConfidence
  intrabarInterval: string
  intrabarCount: number
}

export interface FairValueGap {
  /** FVG 类型 */
  type: 'bullish' | 'bearish'
  /** FVG/VI/OG variant */
  variant: FairValueGapVariant
  /** Gap 上边界 */
  top: number
  /** Gap 下边界 */
  bottom: number
  /** FVG 形成位置（中间 K 线的索引） */
  formationIndex: number
  /** FVG/VI/OG signal confirmation bar index used for intrabar confirmation */
  confirmationIndex: number
  /** Gap 大小（points） */
  size: number
  /** 是否已被填补（收盘价进入 gap 区域） */
  isFilled: boolean
  /** 填补百分比 (0-1)，1.0 表示完全填补 */
  fillPercentage: number
  /** 首次填补的 bar 索引 */
  filledAtIndex?: number
  /** 是否完全填补 (fillPercentage >= 1.0) */
  completelyFilled: boolean
  /** FVG/VI/OG 形成 K 线的 intrabar delta/coverage 确认 */
  formationVolumeConfirmation?: PriceActionVolumeConfirmation
}

// ==================== Inverse FVG ====================

export interface InverseFVG {
  /** iFVG 类型（反转后的类型） */
  type: 'bullish_ifvg' | 'bearish_ifvg'
  /** 原始 gap variant */
  variant: FairValueGapVariant
  /** 区域上边界 */
  top: number
  /** 区域下边界 */
  bottom: number
  /** 原始 FVG */
  originalFVG: FairValueGap
  /** 反转 K 线索引 */
  reversalIndex: number
  /** 吞没强度（反转 K 线 range 相对 ATR 的倍数） */
  engulfingStrength: number
  /** 冲动移动倍数（反转 K 线实体相对平均 range 的倍数） */
  impulseRatio: number
  /** iFVG 反转 K 线的 intrabar delta/coverage 确认 */
  reversalVolumeConfirmation?: PriceActionVolumeConfirmation
}

// ==================== Market Structure ====================

export type TrendDirection = 'bullish' | 'bearish' | 'unknown'
export type StructureLevel = 'internal' | 'swing' | 'external'

export interface BreakOfStructure {
  /** BOS 类型 */
  type: 'bullish' | 'bearish'
  /** 突破发生的 bar 索引 */
  index: number
  /** 突破价格（收盘价） */
  price: number
  /** 结构层级 */
  level: StructureLevel
  /** 被突破的 swing 点 */
  brokenSwing: SwingPoint
}

export interface ChangeOfCharacter {
  /** CHoCH 类型 */
  type: 'bullish' | 'bearish'
  /** 突破发生的 bar 索引 */
  index: number
  /** 突破价格（收盘价） */
  price: number
  /** 结构层级 */
  level: StructureLevel
  /** 被突破的 swing 点 */
  brokenSwing: SwingPoint
  /** 突破前的趋势方向 */
  trendBefore: TrendDirection
  /** CHoCH+ signal: reversal plus stronger opposing swing context */
  isPlus: boolean
}

export type StructureBreakEvent = BreakOfStructure | ChangeOfCharacter

export interface StructureState {
  /** Current state-machine trend for this structure level */
  trend: TrendDirection
  /** Numeric trend value: 1 bullish, -1 bearish, 0 unknown */
  trendValue: -1 | 0 | 1
  /** Most recent BOS on this level */
  lastBos?: BreakOfStructure
  /** Most recent CHoCH on this level */
  lastChoch?: ChangeOfCharacter
  /** Most recent structure break on this level */
  lastBreak?: StructureBreakEvent
  /** Most recent confirmed swing high available to this level */
  lastConfirmedHigh?: SwingPoint
  /** Most recent confirmed swing low available to this level */
  lastConfirmedLow?: SwingPoint
}

export interface MarketStructureAnalysis {
  /** Swing 点（三个层级） */
  swingPoints: SwingPointLevels
  /** Current state by structure level */
  stateByLevel: Record<StructureLevel, StructureState>
  /** Break of Structure 事件 */
  bos: BreakOfStructure[]
  /** Change of Character 事件 */
  choch: ChangeOfCharacter[]
}

// ==================== Order Blocks ====================

export type OrderBlockTrigger = 'BOS' | 'CHoCH'
export type OrderBlockPositionMode = 'full' | 'middle' | 'accurate' | 'precise'
export type OrderBlockMitigationMode = 'absolute' | 'middle'
export type OrderBlockOverlapMethod = 'previous' | 'recent'

export interface OrderBlockVolumeConfirmation extends PriceActionVolumeConfirmation {
  /** Whether delta direction agrees with the OB direction */
  alignedWithBlock: boolean
}

export interface OrderBlock {
  /** OB 类型 */
  type: 'bullish' | 'bearish'
  /** 结构层级 */
  level: StructureLevel
  /** 触发事件类型 */
  trigger: OrderBlockTrigger
  /** OB 区域上边界 */
  top: number
  /** OB 区域下边界 */
  bottom: number
  /** 中线 */
  middle: number
  /** 作为 OB 锚点的极值蜡烛索引 */
  index: number
  /** 结构突破发生索引 */
  breakoutIndex: number
  /** 突破收盘价 */
  breakoutPrice: number
  /** 被突破的 swing 点 */
  brokenSwing: SwingPoint
  /** 形成 OB 时关联的成交量 */
  volume: number | null
  /** OB 蜡烛方向 */
  candleDirection: 'bullish' | 'bearish' | 'doji'
  /** 是否已被 mitigated */
  mitigated: boolean
  /** 首次 mitigation 索引 */
  mitigatedAtIndex?: number
  /** 区域高度 */
  size: number
  /** 成交量占返回 OB 样本总成交量的百分比 */
  volumeSharePct?: number
  /** Estimated internal buy volume from intrabar delta on the OB anchor bar */
  internalBuyVolume?: number
  /** Estimated internal sell volume from intrabar delta on the OB anchor bar */
  internalSellVolume?: number
  /** Internal buy volume percentage, 0-100 */
  internalBuyVolumePct?: number
  /** Internal sell volume percentage, 0-100 */
  internalSellVolumePct?: number
  /** OB 锚点 K 线的 intrabar delta/coverage 确认 */
  anchorVolumeConfirmation?: OrderBlockVolumeConfirmation
  /** 结构突破 K 线的 intrabar delta/coverage 确认 */
  breakoutVolumeConfirmation?: OrderBlockVolumeConfirmation
}

// ==================== 完整分析结果 ====================

export interface PriceActionAnalysis {
  /** Fair Value Gaps */
  fvgs: FairValueGap[]
  /** Inverse FVGs */
  ifvgs: InverseFVG[]
  /** Order Blocks */
  orderBlocks: OrderBlock[]
  /** Market Structure */
  marketStructure: MarketStructureAnalysis
}
