import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import { detectBreakers } from './breaker-detector.js'
import { detectFairValueGapsWithMeta } from './fvg-detector.js'
import { detectInverseFVG } from './ifvg-detector.js'
import { scoreFVGImportance, scoreIFVGImportance, type ScoringContext } from './importance-scoring.js'
import { calculatePriceActionVolatility } from './indicators.js'
import { detectLiquidityPools } from './liquidity-pools.js'
import { detectLiquiditySweeps } from './liquidity-sweeps.js'
import { analyzeMarketStructure } from './market-structure.js'
import { detectOrderBlocksWithMeta } from './ob-detector.js'
import {
  annotateZonesWithPremiumDiscount,
  calculatePremiumDiscountContext,
} from './premium-discount.js'
import { detectSwingPoints } from './swing-detector.js'
import type {
  BreakerZone,
  FairValueGap,
  InverseFVG,
  LiquidityPool,
  LiquiditySweep,
  MarketStructureAnalysis,
  OrderBlock,
  PriceActionAnalysis,
  PriceActionMeta,
  PriceActionVolumeConfirmationInput,
  PremiumDiscountContext,
  StructureLevel,
  ZoneMitigationSource,
  ZoneOverlapPolicy,
} from './types.js'

export interface AnalyzePriceActionBarsOptions {
  gapMode?: FairValueGap['variant'] | 'all'
  zoneMitigationSource?: ZoneMitigationSource
  fvgZoneMitigationSource?: ZoneMitigationSource
  orderBlockZoneMitigationSource?: ZoneMitigationSource
  gapVolumeConfirmation?: boolean
  minGapAtrMultiplier?: number
  minBodyRatio?: number
  maxFVGs?: number
  maxIFVGs?: number
  includeFilled?: boolean
  proximityPct?: number
  maxIFVGLookAheadBars?: number
  ifvgVolumeConfirmation?: boolean
  minImpulseRatio?: number
  minEngulfingStrength?: number
  maxOrderBlocks?: number
  includeMitigatedOrderBlocks?: boolean
  orderBlockTrigger?: 'all' | 'BOS' | 'CHoCH'
  orderBlockPosition?: 'full' | 'middle' | 'accurate' | 'precise'
  overlapPolicy?: ZoneOverlapPolicy
  orderBlockVolumeConfirmation?: boolean
  internalLookback?: number
  swingLookback?: number
  externalLookback?: number
  marketStructureMode?: 'pivot' | 'extreme'
  liquidityPoolToleranceAtrMultiplier?: number
  liquidityPoolTolerancePctCap?: number
  minLiquidityPoolTouches?: number
  liquidityPoolLevels?: StructureLevel[]
}

export interface AnalyzePriceActionBarsParams {
  bars: OhlcvBar[]
  interval: string
  meta?: object
  options?: AnalyzePriceActionBarsOptions
  volumeConfirmations?: Map<number, PriceActionVolumeConfirmationInput>
  volumeConfirmationMeta?: object
}

export type PriceActionAnalysisResult = PriceActionAnalysis & {
  error?: string
}

function withinProximity(top: number, bottom: number, currentPrice: number, proximityPct?: number): boolean {
  if (proximityPct === undefined || proximityPct <= 0 || currentPrice === 0) return true

  const midPrice = (top + bottom) / 2
  return Math.abs(midPrice - currentPrice) / Math.abs(currentPrice) <= proximityPct
}

function unavailablePremiumDiscount(): PremiumDiscountContext {
  return {
    status: 'unavailable',
    reason: 'missing_range',
  }
}

function emptyMarketStructure(): MarketStructureAnalysis {
  return {
    marketStructureMode: 'pivot',
    swingPoints: {
      internal: { highs: [], lows: [] },
      swing: { highs: [], lows: [] },
      external: { highs: [], lows: [] },
    },
    stateByLevel: {
      internal: { trend: 'unknown', trendValue: 0 },
      swing: { trend: 'unknown', trendValue: 0 },
      external: { trend: 'unknown', trendValue: 0 },
    },
    bos: [],
    choch: [],
    swingStrength: [],
  }
}

function limitResults<T>(items: T[], maxItems: number): T[] {
  return maxItems === 0 ? items : items.slice(0, maxItems)
}

function recalculateOrderBlockVolumeShares(orderBlocks: OrderBlock[]): OrderBlock[] {
  for (const orderBlock of orderBlocks) delete orderBlock.volumeSharePct
  const totalVolume = orderBlocks.reduce((sum, orderBlock) => sum + Math.max(0, orderBlock.volume ?? 0), 0)
  if (totalVolume <= 0) return orderBlocks

  for (const orderBlock of orderBlocks) {
    orderBlock.volumeSharePct = Math.floor(((orderBlock.volume ?? 0) / totalVolume) * 100)
  }
  return orderBlocks
}

function annotateSweptLiquidityPools(pools: LiquidityPool[], sweeps: LiquiditySweep[]): LiquidityPool[] {
  const poolSweeps = sweeps.filter((sweep) => sweep.kind === 'liquidity_pool_sweep')

  return pools.map((pool) => {
    const sweep = poolSweeps.find((candidate) => candidate.target.id === pool.id)
    if (!sweep) return pool

    return {
      ...pool,
      swept: true,
      sweptAtIndex: sweep.sweepIndex,
      sweepId: `${sweep.kind}-${sweep.sweepIndex}-${pool.id}`,
    }
  })
}

function rankFVGs(
  fvgs: FairValueGap[],
  context: ScoringContext,
  opts: {
    maxFVGs: number
    includeFilled: boolean
    proximityPct?: number
  },
): FairValueGap[] {
  const ranked = fvgs
    .filter((fvg) => opts.includeFilled || !fvg.completelyFilled)
    .filter((fvg) => withinProximity(fvg.top, fvg.bottom, context.currentPrice, opts.proximityPct))
    .map((fvg) => ({ fvg, score: scoreFVGImportance(fvg, context) }))
    .sort((a, b) => b.score - a.score)
    .map(({ fvg }) => fvg)

  return limitResults(ranked, opts.maxFVGs)
}

function rankIFVGs(
  ifvgs: InverseFVG[],
  context: ScoringContext,
  opts: {
    maxIFVGs: number
    proximityPct?: number
    minImpulseRatio?: number
    minEngulfingStrength?: number
  },
): InverseFVG[] {
  const ranked = ifvgs
    .filter((ifvg) => opts.minImpulseRatio === undefined || ifvg.impulseRatio >= opts.minImpulseRatio)
    .filter((ifvg) => opts.minEngulfingStrength === undefined || ifvg.engulfingStrength >= opts.minEngulfingStrength)
    .filter((ifvg) => withinProximity(ifvg.top, ifvg.bottom, context.currentPrice, opts.proximityPct))
    .map((ifvg) => ({ ifvg, score: scoreIFVGImportance(ifvg, context) }))
    .sort((a, b) => b.score - a.score)
    .map(({ ifvg }) => ifvg)

  return limitResults(ranked, opts.maxIFVGs)
}

function rankBreakers(
  breakers: BreakerZone[],
  context: ScoringContext,
  opts: {
    proximityPct?: number
  },
): BreakerZone[] {
  return breakers
    .filter((breaker) => withinProximity(breaker.top, breaker.bottom, context.currentPrice, opts.proximityPct))
    .sort((a, b) => b.formedAtIndex - a.formedAtIndex)
}

export function analyzePriceActionBars(params: AnalyzePriceActionBarsParams): PriceActionAnalysisResult {
  const {
    bars,
    meta = {},
    options = {},
    volumeConfirmations,
    volumeConfirmationMeta = {},
  } = params
  const {
    gapMode = 'FVG',
    zoneMitigationSource = 'body',
    fvgZoneMitigationSource,
    orderBlockZoneMitigationSource,
    gapVolumeConfirmation = true,
    minGapAtrMultiplier,
    minBodyRatio,
    maxFVGs = 10,
    maxIFVGs = 5,
    includeFilled = false,
    proximityPct,
    maxIFVGLookAheadBars,
    ifvgVolumeConfirmation = true,
    minImpulseRatio,
    minEngulfingStrength,
    maxOrderBlocks = 10,
    includeMitigatedOrderBlocks = false,
    orderBlockTrigger = 'all',
    orderBlockPosition = 'precise',
    overlapPolicy,
    orderBlockVolumeConfirmation = true,
    internalLookback,
    swingLookback,
    externalLookback,
    marketStructureMode,
    liquidityPoolToleranceAtrMultiplier,
    liquidityPoolTolerancePctCap,
    minLiquidityPoolTouches,
    liquidityPoolLevels,
  } = options

  if (bars.length === 0) {
    const volatility = calculatePriceActionVolatility(bars)
    return {
      marketStructure: emptyMarketStructure(),
      premiumDiscount: unavailablePremiumDiscount(),
      liquidityPools: [],
      liquiditySweeps: [],
      fvgs: [],
      ifvgs: [],
      orderBlocks: [],
      breakers: [],
      error: 'No bars returned for the requested window',
      meta: {
        ...meta,
        schemaVersion: 2,
        volatility: {
          period: volatility.period,
          currentVolatility: volatility.currentVolatility,
          fallback: volatility.fallback,
        },
        totalFvgCount: 0,
        returnedFvgCount: 0,
        totalIfvgCount: 0,
        returnedIfvgCount: 0,
        totalBreakerCount: 0,
        returnedBreakerCount: 0,
        totalOrderBlockCount: 0,
        returnedOrderBlockCount: 0,
        mitigatedOrderBlockCount: 0,
        bosCount: 0,
        chochCount: 0,
      } as PriceActionMeta,
    }
  }

  const volatility = calculatePriceActionVolatility(bars)

  const fvgDetection = detectFairValueGapsWithMeta({
    bars,
    gapMode,
    zoneMitigationSource: fvgZoneMitigationSource ?? zoneMitigationSource,
    minGapAtrMultiplier,
    formationVolatilityByIndex: volatility.formationVolatilityByIndex,
    minBodyRatio,
    overlapPolicy,
    volumeConfirmations: gapVolumeConfirmation ? volumeConfirmations : undefined,
  })
  const allFVGs = fvgDetection.fvgs

  const swingPoints = detectSwingPoints({
    bars,
    internalLookback,
    swingLookback,
    externalLookback,
  })

  const marketStructure = analyzeMarketStructure({
    bars,
    swingPoints,
    internalLookback,
    swingLookback,
    externalLookback,
    marketStructureMode,
  })

  const currentPrice = bars[bars.length - 1].close
  const premiumDiscount = calculatePremiumDiscountContext({
    marketStructure,
    currentPrice,
  })
  const allLiquidityPools = detectLiquidityPools({
    swingPoints,
    currentVolatility: volatility.currentVolatility,
    liquidityPoolToleranceAtrMultiplier,
    liquidityPoolTolerancePctCap,
    minLiquidityPoolTouches,
    liquidityPoolLevels,
  })
  const liquiditySweeps = detectLiquiditySweeps({
    bars,
    swingPoints,
    fvgs: allFVGs,
    liquidityPools: allLiquidityPools,
    currentVolatility: volatility.currentVolatility,
    marketStructure,
    zoneMitigationSource: fvgZoneMitigationSource ?? zoneMitigationSource,
  })
  const liquidityPools = annotateSweptLiquidityPools(allLiquidityPools, liquiditySweeps)
  const scoringContext: ScoringContext = {
    currentPrice,
    volatility: volatility.currentVolatility,
    barCount: bars.length,
    marketStructure,
  }

  const fvgs = annotateZonesWithPremiumDiscount(
    rankFVGs(allFVGs, scoringContext, {
      maxFVGs,
      includeFilled,
      proximityPct,
    }),
    premiumDiscount,
  )
  const orderBlockDetection = detectOrderBlocksWithMeta({
    bars,
    bos: marketStructure.bos,
    choch: marketStructure.choch,
    triggerFilter: orderBlockTrigger,
    positionMode: orderBlockPosition,
    zoneMitigationSource: orderBlockZoneMitigationSource ?? zoneMitigationSource,
    includeMitigated: true,
    maxOrderBlocks: 0,
    volumeConfirmations: orderBlockVolumeConfirmation ? volumeConfirmations : undefined,
    overlapPolicy,
  })
  const allOrderBlocks = orderBlockDetection.orderBlocks
  const allBreakers = detectBreakers({
    bars,
    fvgs: allFVGs,
    orderBlocks: allOrderBlocks,
    fvgZoneMitigationSource: fvgZoneMitigationSource ?? zoneMitigationSource,
    orderBlockZoneMitigationSource: orderBlockZoneMitigationSource ?? zoneMitigationSource,
  })
  const allIFVGs = detectInverseFVG({
    bars,
    breakers: allBreakers,
    maxLookAheadBars: maxIFVGLookAheadBars,
    volumeConfirmations: ifvgVolumeConfirmation ? volumeConfirmations : undefined,
  })
  const breakers = annotateZonesWithPremiumDiscount(
    rankBreakers(allBreakers, scoringContext, { proximityPct }),
    premiumDiscount,
  )
  const ifvgs = annotateZonesWithPremiumDiscount(
    rankIFVGs(allIFVGs, scoringContext, {
      maxIFVGs,
      proximityPct,
      minImpulseRatio,
      minEngulfingStrength,
    }),
    premiumDiscount,
  )
  const orderBlocks = annotateZonesWithPremiumDiscount(
    recalculateOrderBlockVolumeShares(
      limitResults(
        allOrderBlocks
          .filter((orderBlock) => includeMitigatedOrderBlocks || !orderBlock.mitigated)
          .map((orderBlock) => ({ ...orderBlock })),
        maxOrderBlocks,
      ),
    ),
    premiumDiscount,
  )

  return {
    marketStructure,
    premiumDiscount,
    liquidityPools,
    liquiditySweeps,
    fvgs,
    ifvgs,
    orderBlocks,
    breakers,
    meta: {
      ...meta,
      schemaVersion: 2,
      volatility: {
        period: volatility.period,
        currentVolatility: volatility.currentVolatility,
        fallback: volatility.fallback,
      },
      totalFvgCount: allFVGs.length,
      returnedFvgCount: fvgs.length,
      fvgFilterMeta: fvgDetection.meta,
      totalIfvgCount: allIFVGs.length,
      returnedIfvgCount: ifvgs.length,
      totalBreakerCount: allBreakers.length,
      returnedBreakerCount: breakers.length,
      totalOrderBlockCount: allOrderBlocks.length,
      returnedOrderBlockCount: orderBlocks.length,
      mitigatedOrderBlockCount: allOrderBlocks.filter((ob) => ob.mitigated).length,
      orderBlockFilterMeta: orderBlockDetection.meta,
      ...volumeConfirmationMeta,
      bosCount: marketStructure.bos.length,
      chochCount: marketStructure.choch.length,
    } as PriceActionMeta,
  }
}
