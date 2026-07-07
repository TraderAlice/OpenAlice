/**
 * Price Action Analysis Tools — MCP 工具注册
 *
 * FVG (Fair Value Gaps), iFVG (Inverse FVG), OB, BOS/CHoCH (Market Structure)
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService, GetBarsOpts, BarSourceRef } from '@/domain/market-data/bars/index.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import { detectFairValueGapsWithMeta } from '@/domain/analysis/price-action/fvg-detector.js'
import { detectInverseFVG } from '@/domain/analysis/price-action/ifvg-detector.js'
import { detectBreakers } from '@/domain/analysis/price-action/breaker-detector.js'
import { detectOrderBlocksWithMeta } from '@/domain/analysis/price-action/ob-detector.js'
import { detectSwingPoints } from '@/domain/analysis/price-action/swing-detector.js'
import { analyzeMarketStructure } from '@/domain/analysis/price-action/market-structure.js'
import { detectLiquidityPools } from '@/domain/analysis/price-action/liquidity-pools.js'
import { detectLiquiditySweeps } from '@/domain/analysis/price-action/liquidity-sweeps.js'
import { calculatePriceActionVolatility } from '@/domain/analysis/price-action/indicators.js'
import { buildPriceActionVolumeConfirmations } from '@/domain/analysis/price-action/volume-confirmation.js'
import {
  annotateZonesWithPremiumDiscount,
  calculatePremiumDiscountContext,
} from '@/domain/analysis/price-action/premium-discount.js'
import {
  scoreFVGImportance,
  scoreIFVGImportance,
  type ScoringContext,
} from '@/domain/analysis/price-action/importance-scoring.js'
import type {
  BreakerZone,
  FairValueGap,
  InverseFVG,
  LiquidityPool,
  LiquiditySweep,
  MarketStructureAnalysis,
  OrderBlock,
  PremiumDiscountContext,
  PriceActionDetailRequest,
  PriceActionMtfAnalysis,
  PriceActionMtfIntervalSummary,
  PriceActionMtfSummary,
  StructureBreakEvent,
  TrendDirection,
} from '@/domain/analysis/price-action/types.js'

export interface PriceActionToolsDeps {
  barService: BarService
}

const zoneMitigationSourceSchema = z.enum(['body', 'wick', 'midpoint'])
const overlapPolicySchema = z.enum(['ranked', 'older', 'newer', 'none'])
const assetClassSchema = z.enum(['equity', 'crypto', 'currency', 'commodity'])
const structureLevelSchema = z.enum(['internal', 'swing', 'external'])
const marketStructureModeSchema = z.enum(['pivot', 'extreme'])

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
  }
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
  }
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

function latestBreak(marketStructure: MarketStructureAnalysis): StructureBreakEvent | undefined {
  return [...marketStructure.bos, ...marketStructure.choch].sort((a, b) => b.index - a.index)[0]
}

function dominantTrend(marketStructure: MarketStructureAnalysis): TrendDirection {
  const trends = [
    marketStructure.stateByLevel.external.trend,
    marketStructure.stateByLevel.swing.trend,
    marketStructure.stateByLevel.internal.trend,
  ]
  const bullish = trends.filter((trend) => trend === 'bullish').length
  const bearish = trends.filter((trend) => trend === 'bearish').length
  if (bullish > bearish) return 'bullish'
  if (bearish > bullish) return 'bearish'
  return 'unknown'
}

function distanceFromCurrentPrice(zone: { top: number; bottom: number }, currentPrice: number): number {
  return Math.abs(((zone.top + zone.bottom) / 2) - currentPrice)
}

function nearestByPrice<T extends { top: number; bottom: number }>(zones: T[], currentPrice: number): T | undefined {
  return zones
    .map((zone) => ({ zone, distance: distanceFromCurrentPrice(zone, currentPrice) }))
    .sort((a, b) => a.distance - b.distance)[0]?.zone
}

function buildDetailRequest(args: Record<string, unknown>, interval: string): PriceActionDetailRequest {
  return {
    tool: 'analyzePriceAction',
    args: {
      ...args,
      interval,
    } as PriceActionDetailRequest['args'],
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function summarizeMtf(intervals: PriceActionMtfIntervalSummary[]): PriceActionMtfSummary {
  const successful = intervals.filter((entry) => entry.status === 'ok' && entry.trend)
  if (successful.length === 0) {
    return {
      bias: 'unknown',
      alignment: 'unknown',
      conflicts: [],
      confluences: [],
    }
  }

  const trendCounts = successful.reduce<Record<TrendDirection, number>>((counts, entry) => {
    const trend = entry.trend?.dominant ?? 'unknown'
    counts[trend] += 1
    return counts
  }, { bullish: 0, bearish: 0, unknown: 0 })
  const higherTimeframeTrend = successful.find((entry) => entry.trend?.dominant !== 'unknown')?.trend?.dominant
  const bias: PriceActionMtfSummary['bias'] =
    higherTimeframeTrend && higherTimeframeTrend !== 'unknown'
      ? higherTimeframeTrend
      : trendCounts.bullish > trendCounts.bearish
        ? 'bullish'
        : trendCounts.bearish > trendCounts.bullish
          ? 'bearish'
          : trendCounts.bullish === 0 && trendCounts.bearish === 0
            ? 'neutral'
            : 'mixed'

  const conflicts: string[] = []
  const confluences: string[] = []
  for (let i = 0; i < successful.length; i += 1) {
    for (let j = i + 1; j < successful.length; j += 1) {
      const left = successful[i]
      const right = successful[j]
      const leftTrend = left.trend?.swing ?? 'unknown'
      const rightTrend = right.trend?.swing ?? 'unknown'
      if (leftTrend === 'unknown' || rightTrend === 'unknown') continue
      if (leftTrend === rightTrend) {
        confluences.push(`${left.interval} and ${right.interval} swing trend both ${leftTrend}`)
      } else {
        conflicts.push(`${left.interval} swing trend ${leftTrend} conflicts with ${right.interval} swing trend ${rightTrend}`)
      }
    }
  }

  const premiumDiscountConfluences = successful
    .filter((entry) => entry.premiumDiscount?.status === 'available')
    .map((entry) => `${entry.interval} price is in ${entry.premiumDiscount?.status === 'available' ? entry.premiumDiscount.location : 'unknown'}`)
  confluences.push(...premiumDiscountConfluences)

  const alignment: PriceActionMtfSummary['alignment'] =
    conflicts.length > 0
      ? 'conflicted'
      : confluences.length > 0 && (trendCounts.bullish > 0 || trendCounts.bearish > 0)
        ? 'aligned'
        : successful.length > 1
          ? 'mixed'
          : 'unknown'

  return {
    bias,
    alignment,
    conflicts,
    confluences,
  }
}

export function createPriceActionTools(deps: PriceActionToolsDeps) {
  const { barService } = deps

  return {
    analyzePriceAction: tool({
      description: `Analyze price action patterns (FVG, iFVG, Order Blocks, BOS/CHoCH) for ICT/SMC trading.

**Fair Value Gaps (FVG)**: Price imbalances formed by three candles where the first and third
do not overlap. The detector can also use VI (body/volume imbalance)
and OG (opening gap) variants, with mitigation by body, wick, or midpoint. When enabled,
the formation candle includes lower-timeframe intrabar delta confirmation.

**Inverse FVG (iFVG)**: When an FVG is filled and price reverses from within the gap, it
transforms into an institutional order block (support/resistance). When enabled,
the reversal candle includes lower-timeframe intrabar delta confirmation.

**Order Blocks (OB)**: Volumetric order blocks. When a BOS/CHoCH
breaks structure, the detector locates the extreme candle between the broken swing and
breakout, derives a support/resistance zone, and marks it mitigated when price closes
through the configured zone trigger. When enabled, OBs include lower-timeframe intrabar
delta confirmation for both the anchor candle and breakout candle, with coverage-based
confidence.

**Market Structure (BOS/CHoCH)**:
- BOS (Break of Structure): Continuation break of the active structure state
- CHoCH (Change of Character): Reversal break that flips structure state
- CHoCH+: CHoCH with stronger opposing swing context
- Three levels: internal (short-term), swing (medium-term), external (long-term)

Returns detailed zones with fill status, reversal patterns, structure breaks,
and current market-structure state by level.

Example:
  barId: "tradingview|AAPL"
  interval: "15m"
  count: 100`,

      inputSchema: z.object({
        barId: z.string().describe('Bar source ID from searchBars'),
        assetClass: z.enum(['equity', 'crypto', 'currency', 'commodity']).optional()
          .describe('Required for vendor barIds (e.g. "equity" for tradingview|AAPL)'),
        interval: z.string().describe('Bar interval (e.g. "15m", "1h", "4h", "1d")'),
        count: z.number().int().positive().optional().describe('Number of bars (default 200)'),
        start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end: z.string().optional().describe('End date (YYYY-MM-DD)'),
        gapMode: z.enum(['FVG', 'VI', 'OG', 'all']).optional().describe('Gap variant to detect (default FVG): standard FVG, Volume Imbalance, Opening Gap, or all'),
        zoneMitigationSource: zoneMitigationSourceSchema.optional().describe('Default zone mitigation trigger source for FVG/VI/OG and order blocks: body, wick, or midpoint (default body)'),
        fvgZoneMitigationSource: zoneMitigationSourceSchema.optional().describe('Override zone mitigation trigger source for FVG/VI/OG only (default inherits zoneMitigationSource)'),
        orderBlockZoneMitigationSource: zoneMitigationSourceSchema.optional().describe('Override zone mitigation trigger source for order blocks only (default inherits zoneMitigationSource)'),
        gapVolumeConfirmation: z.boolean().optional().describe('Try to attach lower-timeframe intrabar delta/coverage confirmation to FVG/VI/OG formation bars (default true)'),
        minGapAtrMultiplier: z.number().nonnegative().optional().describe('Minimum FVG/VI/OG gap size as a multiple of formation ATR/volatility (default 0)'),
        minBodyRatio: z.number().optional().describe('Minimum candle body ratio for FVG middle candle (default 0.7)'),
        maxFVGs: z.number().int().min(0).optional().describe('Maximum FVGs to return (default 10, use 0 for all)'),
        maxIFVGs: z.number().int().min(0).optional().describe('Maximum iFVGs to return (default 5, use 0 for all)'),
        includeFilled: z.boolean().optional().describe('Include completely filled FVGs (default false)'),
        proximityPct: z.number().nonnegative().optional().describe('Only return zones within this percentage of current price, e.g. 0.05 for 5%'),
        maxIFVGLookAheadBars: z.number().int().positive().optional().describe('Bars to search after FVG fill when detecting iFVGs (default 20)'),
        ifvgVolumeConfirmation: z.boolean().optional().describe('Try to attach lower-timeframe intrabar delta/coverage confirmation to iFVG reversal bars (default true)'),
        minImpulseRatio: z.number().nonnegative().optional().describe('Additional impulse ratio filter for returned iFVGs; detector already requires >= 1.5 by default'),
        minEngulfingStrength: z.number().nonnegative().optional().describe('Additional engulfing strength filter for returned iFVGs (default: no extra filter)'),
        maxOrderBlocks: z.number().int().min(0).optional().describe('Maximum order blocks to return (default 10, use 0 for all)'),
        includeMitigatedOrderBlocks: z.boolean().optional().describe('Include mitigated order blocks (default false)'),
        orderBlockTrigger: z.enum(['all', 'BOS', 'CHoCH']).optional().describe('Filter order blocks by structure-break trigger (default all)'),
        orderBlockPosition: z.enum(['full', 'middle', 'accurate', 'precise']).optional().describe('Order-block zone positioning mode (default precise)'),
        overlapPolicy: overlapPolicySchema.optional().describe('Zone overlap filtering policy for FVG/VI/OG and order blocks: ranked, older, newer, or none (default ranked)'),
        orderBlockVolumeConfirmation: z.boolean().optional().describe('Try to attach lower-timeframe intrabar delta/coverage confirmation to OB anchor and breakout bars (default true)'),
        internalLookback: z.number().int().min(2).optional().describe('Internal swing lookback (default 5)'),
        swingLookback: z.number().int().min(2).optional().describe('Swing lookback (default 20)'),
        externalLookback: z.number().int().min(2).optional().describe('External swing lookback (default 50)'),
        marketStructureMode: marketStructureModeSchema.optional().describe('Market-structure mode: pivot preserves classic swing sensitivity; extreme compresses minor pivots into active extremes (default pivot)'),
        liquidityPoolToleranceAtrMultiplier: z.number().nonnegative().optional().describe('EQH/EQL pool tolerance as ATR200 multiplier (default 0.1)'),
        liquidityPoolTolerancePctCap: z.number().nonnegative().optional().describe('EQH/EQL pool tolerance percentage cap, e.g. 0.001 for 0.1%; 0 disables cap (default 0.001)'),
        minLiquidityPoolTouches: z.number().int().min(2).optional().describe('Minimum equal-high/equal-low touches needed to form a liquidity pool (default 2)'),
        liquidityPoolLevels: z.array(structureLevelSchema).min(1).optional().describe('Structure levels used for liquidity pool derivation (default internal and swing)'),
      }).strict(),

      execute: async ({
        barId,
        assetClass,
        interval,
        count,
        start,
        end,
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
      }) => {
        const ref: BarSourceRef = assetClass ? { barId, assetClass } : { barId }
        const opts: GetBarsOpts = { interval, count: count ?? 200, start, end }

        // 获取 K 线数据
        const result = await barService.getBars(ref, opts)

        if (result.bars.length === 0) {
          const volatility = calculatePriceActionVolatility(result.bars)
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
              ...result.meta,
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
            },
          }
        }

        const volumeConfirmation = await buildPriceActionVolumeConfirmations({
          barService,
          ref,
          barId,
          interval,
          bars: result.bars,
          enabled: gapVolumeConfirmation || ifvgVolumeConfirmation || orderBlockVolumeConfirmation,
        })

        const volatility = calculatePriceActionVolatility(result.bars)

        // 1. 检测 FVG
        const fvgDetection = detectFairValueGapsWithMeta({
          bars: result.bars,
          gapMode,
          zoneMitigationSource: fvgZoneMitigationSource ?? zoneMitigationSource,
          minGapAtrMultiplier,
          formationVolatilityByIndex: volatility.formationVolatilityByIndex,
          minBodyRatio,
          overlapPolicy,
          volumeConfirmations: gapVolumeConfirmation ? volumeConfirmation.confirmations : undefined,
        })
        const allFVGs = fvgDetection.fvgs

        // 2. 检测 Swing 点
        const swingPoints = detectSwingPoints({
          bars: result.bars,
          internalLookback,
          swingLookback,
          externalLookback,
        })

        // 3. 分析市场结构
        const marketStructure = analyzeMarketStructure({
          bars: result.bars,
          swingPoints,
          internalLookback,
          swingLookback,
          externalLookback,
          marketStructureMode,
        })

        const currentPrice = result.bars[result.bars.length - 1].close
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
          bars: result.bars,
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
          barCount: result.bars.length,
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
          bars: result.bars,
          bos: marketStructure.bos,
          choch: marketStructure.choch,
          triggerFilter: orderBlockTrigger,
          positionMode: orderBlockPosition,
          zoneMitigationSource: orderBlockZoneMitigationSource ?? zoneMitigationSource,
          includeMitigated: true,
          maxOrderBlocks: 0,
          volumeConfirmations: orderBlockVolumeConfirmation ? volumeConfirmation.confirmations : undefined,
          overlapPolicy,
        })
        const allOrderBlocks = orderBlockDetection.orderBlocks
        const allBreakers = detectBreakers({
          bars: result.bars,
          fvgs: allFVGs,
          orderBlocks: allOrderBlocks,
          fvgZoneMitigationSource: fvgZoneMitigationSource ?? zoneMitigationSource,
          orderBlockZoneMitigationSource: orderBlockZoneMitigationSource ?? zoneMitigationSource,
        })
        const allIFVGs = detectInverseFVG({
          bars: result.bars,
          breakers: allBreakers,
          maxLookAheadBars: maxIFVGLookAheadBars,
          volumeConfirmations: ifvgVolumeConfirmation ? volumeConfirmation.confirmations : undefined,
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
            ...result.meta,
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
            ...volumeConfirmation.meta,
            bosCount: marketStructure.bos.length,
            chochCount: marketStructure.choch.length,
          },
        }
      },
    }),

    analyzeMultiTimeframePriceAction: tool({
      description: `Summarize price action context across multiple timeframes.

Returns condensed trend, liquidity, zone, premium/discount, and structure context per interval.
Use each interval's detailRequest with analyzePriceAction when full single-timeframe details are needed.`,

      inputSchema: z.object({
        barId: z.string().describe('Bar source ID from searchBars'),
        assetClass: assetClassSchema.optional()
          .describe('Required for vendor barIds (e.g. "equity" for tradingview|AAPL)'),
        intervals: z.array(z.string()).min(1).max(8).describe('Intervals to summarize, ordered from higher timeframe to execution timeframe'),
        count: z.number().int().positive().optional().describe('Number of bars per interval (default 200)'),
        start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end: z.string().optional().describe('End date (YYYY-MM-DD)'),
        gapMode: z.enum(['FVG', 'VI', 'OG', 'all']).optional().describe('Gap variant to detect (default FVG)'),
        zoneMitigationSource: zoneMitigationSourceSchema.optional().describe('Default zone mitigation trigger source for zones (default body)'),
        fvgZoneMitigationSource: zoneMitigationSourceSchema.optional().describe('Override zone mitigation trigger source for FVG/VI/OG only'),
        orderBlockZoneMitigationSource: zoneMitigationSourceSchema.optional().describe('Override zone mitigation trigger source for order blocks only'),
        gapVolumeConfirmation: z.boolean().optional().describe('Try to attach lower-timeframe intrabar delta/coverage confirmation to FVG/VI/OG formation bars (default false for MTF summary)'),
        minGapAtrMultiplier: z.number().nonnegative().optional(),
        minBodyRatio: z.number().optional(),
        maxFVGs: z.number().int().min(0).optional().describe('Maximum FVGs to consider per interval (default 5, use 0 for all)'),
        maxIFVGs: z.number().int().min(0).optional().describe('Maximum iFVGs to consider per interval (default 3, use 0 for all)'),
        includeFilled: z.boolean().optional().describe('Include completely filled FVGs (default false)'),
        proximityPct: z.number().nonnegative().optional(),
        maxIFVGLookAheadBars: z.number().int().positive().optional(),
        ifvgVolumeConfirmation: z.boolean().optional().describe('Try to attach lower-timeframe intrabar delta/coverage confirmation to iFVG reversal bars (default false for MTF summary)'),
        minImpulseRatio: z.number().nonnegative().optional(),
        minEngulfingStrength: z.number().nonnegative().optional(),
        maxOrderBlocks: z.number().int().min(0).optional().describe('Maximum order blocks to consider per interval (default 5, use 0 for all)'),
        includeMitigatedOrderBlocks: z.boolean().optional().describe('Include mitigated order blocks (default false)'),
        orderBlockTrigger: z.enum(['all', 'BOS', 'CHoCH']).optional(),
        orderBlockPosition: z.enum(['full', 'middle', 'accurate', 'precise']).optional(),
        overlapPolicy: overlapPolicySchema.optional(),
        orderBlockVolumeConfirmation: z.boolean().optional().describe('Try to attach lower-timeframe intrabar delta/coverage confirmation to OB bars (default false for MTF summary)'),
        internalLookback: z.number().int().min(2).optional(),
        swingLookback: z.number().int().min(2).optional(),
        externalLookback: z.number().int().min(2).optional(),
        marketStructureMode: marketStructureModeSchema.optional().describe('Market-structure mode: pivot or extreme (default pivot)'),
        liquidityPoolToleranceAtrMultiplier: z.number().nonnegative().optional().describe('EQH/EQL pool tolerance as ATR200 multiplier (default 0.1)'),
        liquidityPoolTolerancePctCap: z.number().nonnegative().optional().describe('EQH/EQL pool tolerance percentage cap; 0 disables cap (default 0.001)'),
        minLiquidityPoolTouches: z.number().int().min(2).optional().describe('Minimum equal-high/equal-low touches needed to form a liquidity pool (default 2)'),
        liquidityPoolLevels: z.array(structureLevelSchema).min(1).optional().describe('Structure levels used for liquidity pool derivation (default internal and swing)'),
      }).strict(),

      execute: async (input): Promise<PriceActionMtfAnalysis> => {
        const {
          barId,
          assetClass,
          intervals,
          count,
          start,
          end,
          gapMode = 'FVG',
          zoneMitigationSource = 'body',
          fvgZoneMitigationSource,
          orderBlockZoneMitigationSource,
          gapVolumeConfirmation = false,
          minGapAtrMultiplier,
          minBodyRatio,
          maxFVGs = 5,
          maxIFVGs = 3,
          includeFilled = false,
          proximityPct,
          maxIFVGLookAheadBars,
          ifvgVolumeConfirmation = false,
          minImpulseRatio,
          minEngulfingStrength,
          maxOrderBlocks = 5,
          includeMitigatedOrderBlocks = false,
          orderBlockTrigger = 'all',
          orderBlockPosition = 'precise',
          overlapPolicy,
          orderBlockVolumeConfirmation = false,
          internalLookback,
          swingLookback,
          externalLookback,
          marketStructureMode,
          liquidityPoolToleranceAtrMultiplier,
          liquidityPoolTolerancePctCap,
          minLiquidityPoolTouches,
          liquidityPoolLevels,
        } = input

        const baseDetailArgs = { ...input }
        delete (baseDetailArgs as { intervals?: unknown }).intervals
        const ref: BarSourceRef = assetClass ? { barId, assetClass } : { barId }

        const intervalResults = await Promise.all(intervals.map(async (interval): Promise<PriceActionMtfIntervalSummary> => {
          const detailRequest = buildDetailRequest(baseDetailArgs, interval)

          try {
            const result = await barService.getBars(ref, { interval, count: count ?? 200, start, end })
            if (result.bars.length < 3) {
              return {
                interval,
                status: 'insufficient',
                detailRequest,
                error: 'Insufficient bars returned for price-action summary',
                meta: {
                  ...result.meta,
                  schemaVersion: 2,
                  volatility: calculatePriceActionVolatility(result.bars),
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
                },
              }
            }

            const volumeConfirmation = await buildPriceActionVolumeConfirmations({
              barService,
              ref,
              barId,
              interval,
              bars: result.bars,
              enabled: gapVolumeConfirmation || ifvgVolumeConfirmation || orderBlockVolumeConfirmation,
            })
            const volatility = calculatePriceActionVolatility(result.bars)
            const fvgDetection = detectFairValueGapsWithMeta({
              bars: result.bars,
              gapMode,
              zoneMitigationSource: fvgZoneMitigationSource ?? zoneMitigationSource,
              minGapAtrMultiplier,
              formationVolatilityByIndex: volatility.formationVolatilityByIndex,
              minBodyRatio,
              overlapPolicy,
              volumeConfirmations: gapVolumeConfirmation ? volumeConfirmation.confirmations : undefined,
            })
            const allFVGs = fvgDetection.fvgs
            const swingPoints = detectSwingPoints({
              bars: result.bars,
              internalLookback,
              swingLookback,
              externalLookback,
            })
            const marketStructure = analyzeMarketStructure({
              bars: result.bars,
              swingPoints,
              internalLookback,
              swingLookback,
              externalLookback,
              marketStructureMode,
            })
            const currentPrice = result.bars[result.bars.length - 1].close
            const premiumDiscount = calculatePremiumDiscountContext({
              marketStructure,
              currentPrice,
            })
            const liquidityPools = detectLiquidityPools({
              swingPoints,
              currentVolatility: volatility.currentVolatility,
              liquidityPoolToleranceAtrMultiplier,
              liquidityPoolTolerancePctCap,
              minLiquidityPoolTouches,
              liquidityPoolLevels,
            })
            const liquiditySweeps = detectLiquiditySweeps({
              bars: result.bars,
              swingPoints,
              fvgs: allFVGs,
              liquidityPools,
              currentVolatility: volatility.currentVolatility,
              marketStructure,
              zoneMitigationSource: fvgZoneMitigationSource ?? zoneMitigationSource,
            })
            const scoringContext: ScoringContext = {
              currentPrice,
              volatility: volatility.currentVolatility,
              barCount: result.bars.length,
              marketStructure,
            }
            const fvgs = annotateZonesWithPremiumDiscount(
              rankFVGs(allFVGs, scoringContext, { maxFVGs, includeFilled, proximityPct }),
              premiumDiscount,
            )
            const orderBlockDetection = detectOrderBlocksWithMeta({
              bars: result.bars,
              bos: marketStructure.bos,
              choch: marketStructure.choch,
              triggerFilter: orderBlockTrigger,
              positionMode: orderBlockPosition,
              zoneMitigationSource: orderBlockZoneMitigationSource ?? zoneMitigationSource,
              includeMitigated: true,
              maxOrderBlocks: 0,
              volumeConfirmations: orderBlockVolumeConfirmation ? volumeConfirmation.confirmations : undefined,
              overlapPolicy,
            })
            const allOrderBlocks = orderBlockDetection.orderBlocks
            const allBreakers = detectBreakers({
              bars: result.bars,
              fvgs: allFVGs,
              orderBlocks: allOrderBlocks,
              fvgZoneMitigationSource: fvgZoneMitigationSource ?? zoneMitigationSource,
              orderBlockZoneMitigationSource: orderBlockZoneMitigationSource ?? zoneMitigationSource,
            })
            const allIFVGs = detectInverseFVG({
              bars: result.bars,
              breakers: allBreakers,
              maxLookAheadBars: maxIFVGLookAheadBars,
              volumeConfirmations: ifvgVolumeConfirmation ? volumeConfirmation.confirmations : undefined,
            })
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
              interval,
              status: 'ok',
              trend: {
                internal: marketStructure.stateByLevel.internal.trend,
                swing: marketStructure.stateByLevel.swing.trend,
                external: marketStructure.stateByLevel.external.trend,
                dominant: dominantTrend(marketStructure),
              },
              liquidity: {
                poolCount: liquidityPools.length,
                sweepCount: liquiditySweeps.length,
                recentSweeps: liquiditySweeps.slice(-3),
              },
              zone: {
                fvgCount: fvgs.length,
                ifvgCount: ifvgs.length,
                orderBlockCount: orderBlocks.length,
                nearestFvg: nearestByPrice(fvgs, currentPrice),
                nearestIFVG: nearestByPrice(ifvgs, currentPrice),
                nearestOrderBlock: nearestByPrice(orderBlocks, currentPrice),
              },
              premiumDiscount,
              structure: {
                mode: marketStructure.marketStructureMode,
                bosCount: marketStructure.bos.length,
                chochCount: marketStructure.choch.length,
                lastBreak: latestBreak(marketStructure),
                strongWeak: marketStructure.swingStrength.slice(-6),
              },
              detailRequest,
              meta: {
                ...result.meta,
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
                returnedBreakerCount: allBreakers.length,
                totalOrderBlockCount: allOrderBlocks.length,
                returnedOrderBlockCount: orderBlocks.length,
                mitigatedOrderBlockCount: allOrderBlocks.filter((ob) => ob.mitigated).length,
                orderBlockFilterMeta: orderBlockDetection.meta,
                ...volumeConfirmation.meta,
                bosCount: marketStructure.bos.length,
                chochCount: marketStructure.choch.length,
              },
            }
          } catch (error) {
            return {
              interval,
              status: 'error',
              detailRequest,
              error: errorMessage(error),
            }
          }
        }))

        const successfulCount = intervalResults.filter((entry) => entry.status === 'ok').length
        const status: PriceActionMtfAnalysis['status'] =
          successfulCount === 0 ? 'error' : successfulCount === intervalResults.length ? 'ok' : 'partial'

        return {
          status,
          summary: summarizeMtf(intervalResults),
          intervals: intervalResults,
          ...(status === 'error' ? { error: 'All intervals failed or returned insufficient data' } : {}),
        }
      },
    }),

  }
}
