/**
 * Price Action Analysis — 共享类型定义
 *
 * FVG (Fair Value Gaps), iFVG (Inverse FVG), OB, BOS/CHoCH (Market Structure)
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types.js'

export type PriceActionSchemaVersion = 2
export type ZoneDirection = 'bullish' | 'bearish'
export type ZoneState = 'active' | 'touched' | 'mitigated' | 'filled' | 'broken' | 'invalidated'
export type ZoneKind = 'fvg' | 'vi' | 'og' | 'order_block' | 'fvg_breaker' | 'order_block_breaker'
export type ZoneMitigationSource = 'body' | 'wick' | 'midpoint'
export type ZoneOverlapPolicy = 'ranked' | 'older' | 'newer' | 'none'

export interface PriceActionFamilyFilterMeta {
  detectedCount: number
  lifecycleFilteredCount: number
  overlapFilteredCount: number
  returnedCount: number
}

export interface PriceActionSourceRef {
  kind: ZoneKind | 'swing' | 'liquidity_pool'
  id?: string
  index?: number
  level?: StructureLevel
  top?: number
  bottom?: number
  timeframe?: string
}

export interface ZoneLifecycle {
  formedAtIndex: number
  confirmedAtIndex?: number
  firstTouchedAtIndex?: number
  lastTouchedAtIndex?: number
  currentlyInside?: boolean
  mitigatedAtIndex?: number
  fillPercentage?: number
  filledAtIndex?: number
  fullyFilledAtIndex?: number
  brokenAtIndex?: number
  invalidatedAtIndex?: number
}

export interface ZoneEnvelope {
  id?: string
  kind: ZoneKind
  direction: ZoneDirection
  top: number
  bottom: number
  midpoint: number
  size: number
  sizeAtr: number
  formedAtIndex: number
  confirmedAtIndex: number
  state: ZoneState
  lifecycle: ZoneLifecycle
  source?: PriceActionSourceRef
  timeframe?: string
  rank?: number
  premiumDiscount?: PremiumDiscountZoneAnnotation
}

export interface PriceActionVolatilityMeta {
  period: number
  currentVolatility: number
  fallback: {
    used: boolean
    reason?: 'insufficient_bars' | 'zero_volatility'
    availableBars: number
  }
}

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

export interface FairValueGap extends Partial<Omit<ZoneEnvelope, 'top' | 'bottom' | 'size'>> {
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
  /** Confirming FVG breaker zone id */
  breakerId?: string
  /** Lightweight reference to the confirming FVG breaker */
  source: PriceActionSourceRef
  /** 反转 K 线索引 */
  reversalIndex: number
  /** 吞没强度（反转 K 线 range 相对 ATR 的倍数） */
  engulfingStrength: number
  /** 冲动移动倍数（反转 K 线实体相对平均 range 的倍数） */
  impulseRatio: number
  /** iFVG 反转 K 线的 intrabar delta/coverage 确认 */
  reversalVolumeConfirmation?: PriceActionVolumeConfirmation
  /** Premium / discount / equilibrium location relative to the selected range */
  premiumDiscount?: PremiumDiscountZoneAnnotation
}

// ==================== Market Structure ====================

export type TrendDirection = 'bullish' | 'bearish' | 'unknown'
export type StructureLevel = 'internal' | 'swing' | 'external'
export type MarketStructureMode = 'pivot' | 'extreme'
export type SwingStrengthValue = 'strong' | 'weak'
export type SwingStrengthExplanationTag =
  | 'strong_high_defended'
  | 'strong_low_defended'
  | 'weak_high_target'
  | 'weak_low_target'
  | 'weak_high_swept'
  | 'weak_low_swept'

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

export interface StructureRangePoint extends SwingPoint {
  classification: 'strong_high' | 'strong_low' | 'weak_high' | 'weak_low'
}

export interface ActiveStructureRange {
  high?: StructureRangePoint
  low?: StructureRangePoint
}

export interface SwingStrengthEntry {
  id: string
  type: SwingPoint['type']
  level: StructureLevel
  index: number
  price: number
  strength: SwingStrengthValue
  reason: string
  liquidityTarget?: PriceActionSourceRef
  scoringImpact?: {
    zoneScoreDelta: number
    explanationTag: SwingStrengthExplanationTag
  }
}

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
  /** Active high/low range used by extreme-mode structure reads */
  activeRange?: ActiveStructureRange
}

export interface MarketStructureAnalysis {
  /** Public structure mode used for this analysis */
  marketStructureMode: MarketStructureMode
  /** Swing 点（三个层级） */
  swingPoints: SwingPointLevels
  /** Current state by structure level */
  stateByLevel: Record<StructureLevel, StructureState>
  /** Break of Structure 事件 */
  bos: BreakOfStructure[]
  /** Change of Character 事件 */
  choch: ChangeOfCharacter[]
  /** Strong/weak swing classification by level */
  swingStrength: SwingStrengthEntry[]
}

// ==================== Order Blocks ====================

export type OrderBlockTrigger = 'BOS' | 'CHoCH'
export type OrderBlockPositionMode = 'full' | 'middle' | 'accurate' | 'precise'
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
  /** Premium / discount / equilibrium location relative to the selected range */
  premiumDiscount?: PremiumDiscountZoneAnnotation
}

// ==================== Breakers / Liquidity / Premium Discount ====================

export interface BreakerZone extends ZoneEnvelope {
  kind: 'fvg_breaker' | 'order_block_breaker'
  sourceDirection: ZoneDirection
  sourceBrokenAtIndex: number
}

export interface LiquidityPool {
  id: string
  kind: 'liquidity_pool'
  type: 'EQH' | 'EQL'
  direction: ZoneDirection
  level: StructureLevel
  price: number
  tolerance: number
  toleranceAtr?: number
  touches: SwingPoint[]
  firstTouchedAtIndex: number
  lastTouchedAtIndex: number
  swept: boolean
  sweptAtIndex?: number
  sweepId?: string
}

export interface LiquiditySweep {
  kind: 'swing_sweep' | 'fvg_raid' | 'liquidity_pool_sweep'
  direction: ZoneDirection
  sweepIndex: number
  sweptLevel: number
  wickExtreme: number
  close: number
  reclaimSource: ZoneMitigationSource
  reclaimConfirmed: boolean
  target: PriceActionSourceRef
  penetration: number
  penetrationAtr?: number
  relatedStructure?: PriceActionSourceRef
}

export type PremiumDiscountLocation = 'premium' | 'discount' | 'equilibrium'
export type PremiumDiscountZoneLocation = PremiumDiscountLocation | 'spanning'

export interface PremiumDiscountZoneAnnotation {
  location: PremiumDiscountZoneLocation
  midpointLocation: PremiumDiscountLocation
  coverage: {
    premium: number
    discount: number
    equilibrium: number
  }
}

export interface PremiumDiscountUnavailable {
  status: 'unavailable'
  reason: 'missing_range'
}

export interface PremiumDiscountAvailable {
  status: 'available'
  range: {
    high: SwingPoint
    low: SwingPoint
    midpoint: number
    equilibrium: {
      bottom: number
      top: number
    }
  }
  currentPrice: number
  location: PremiumDiscountLocation
  equilibriumBandPct: number
}

export type PremiumDiscountContext = PremiumDiscountAvailable | PremiumDiscountUnavailable

export interface PriceActionMeta {
  schemaVersion: PriceActionSchemaVersion
  volatility: PriceActionVolatilityMeta
  totalFvgCount: number
  returnedFvgCount: number
  totalIfvgCount: number
  returnedIfvgCount: number
  totalOrderBlockCount: number
  returnedOrderBlockCount: number
  mitigatedOrderBlockCount: number
  bosCount: number
  chochCount: number
  [key: string]: unknown
}

// ==================== 完整分析结果 ====================

export interface PriceActionAnalysis {
  /** Market Structure */
  marketStructure: MarketStructureAnalysis
  /** Premium / discount / equilibrium context */
  premiumDiscount: PremiumDiscountContext
  /** EQH/EQL liquidity pools */
  liquidityPools: LiquidityPool[]
  /** Swing, pool, and zone sweep events */
  liquiditySweeps: LiquiditySweep[]
  /** Fair Value Gaps */
  fvgs: FairValueGap[]
  /** Inverse FVGs */
  ifvgs: InverseFVG[]
  /** Order Blocks */
  orderBlocks: OrderBlock[]
  /** Breaker zones */
  breakers: BreakerZone[]
  /** Result metadata */
  meta: PriceActionMeta
}

// ==================== Multi-timeframe summary ====================

export type PriceActionMtfStatus = 'ok' | 'partial' | 'error'
export type PriceActionMtfIntervalStatus = 'ok' | 'insufficient' | 'error'

export interface PriceActionDetailRequest {
  tool: 'analyzePriceAction'
  args: {
    barId: string
    assetClass?: 'equity' | 'crypto' | 'currency' | 'commodity'
    interval: string
    count?: number
    start?: string
    end?: string
    [key: string]: unknown
  }
}

export interface PriceActionMtfIntervalSummary {
  interval: string
  status: PriceActionMtfIntervalStatus
  trend?: {
    internal: TrendDirection
    swing: TrendDirection
    external: TrendDirection
    dominant: TrendDirection
  }
  liquidity?: {
    poolCount: number
    sweepCount: number
    recentSweeps: LiquiditySweep[]
  }
  zone?: {
    fvgCount: number
    ifvgCount: number
    orderBlockCount: number
    nearestFvg?: FairValueGap
    nearestIFVG?: InverseFVG
    nearestOrderBlock?: OrderBlock
  }
  premiumDiscount?: PremiumDiscountContext
  structure?: {
    mode: MarketStructureMode
    bosCount: number
    chochCount: number
    lastBreak?: StructureBreakEvent
    strongWeak: SwingStrengthEntry[]
  }
  detailRequest: PriceActionDetailRequest
  error?: string
  meta?: PriceActionMeta
}

export interface PriceActionMtfSummary {
  bias: TrendDirection | 'mixed' | 'neutral'
  alignment: 'aligned' | 'mixed' | 'conflicted' | 'unknown'
  conflicts: string[]
  confluences: string[]
}

export interface PriceActionMtfAnalysis {
  status: PriceActionMtfStatus
  summary: PriceActionMtfSummary
  intervals: PriceActionMtfIntervalSummary[]
  error?: string
}
