/**
 * Price Action Analysis Tools — MCP 工具注册
 *
 * FVG (Fair Value Gaps), iFVG (Inverse FVG), OB, BOS/CHoCH (Market Structure)
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService, GetBarsOpts, BarSourceRef } from '@/domain/market-data/bars/index.js'
import { analyzePriceActionBars, type AnalyzePriceActionBarsOptions } from '@/domain/analysis/price-action/analyze.js'
import { calculatePriceActionVolatility } from '@/domain/analysis/price-action/indicators.js'
import { buildPriceActionVolumeConfirmations } from '@/domain/analysis/price-action/volume-confirmation.js'
import type {
  MarketStructureAnalysis,
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

function buildAnalyzeOptions(
  input: AnalyzePriceActionBarsOptions,
  defaults: Pick<
    AnalyzePriceActionBarsOptions,
    'gapVolumeConfirmation' | 'ifvgVolumeConfirmation' | 'orderBlockVolumeConfirmation' | 'maxFVGs' | 'maxIFVGs' | 'maxOrderBlocks'
  >,
): AnalyzePriceActionBarsOptions {
  return {
    ...input,
    gapMode: input.gapMode ?? 'FVG',
    zoneMitigationSource: input.zoneMitigationSource ?? 'body',
    gapVolumeConfirmation: input.gapVolumeConfirmation ?? defaults.gapVolumeConfirmation,
    maxFVGs: input.maxFVGs ?? defaults.maxFVGs,
    maxIFVGs: input.maxIFVGs ?? defaults.maxIFVGs,
    includeFilled: input.includeFilled ?? false,
    ifvgVolumeConfirmation: input.ifvgVolumeConfirmation ?? defaults.ifvgVolumeConfirmation,
    maxOrderBlocks: input.maxOrderBlocks ?? defaults.maxOrderBlocks,
    includeMitigatedOrderBlocks: input.includeMitigatedOrderBlocks ?? false,
    orderBlockTrigger: input.orderBlockTrigger ?? 'all',
    orderBlockPosition: input.orderBlockPosition ?? 'precise',
    orderBlockVolumeConfirmation: input.orderBlockVolumeConfirmation ?? defaults.orderBlockVolumeConfirmation,
  }
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

**Inverse FVG (iFVG)**: A confirmed subset of FVG breaker zones, produced when a broken
FVG shows reversal/impulse confirmation and links back to the breaker. When enabled,
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

      execute: async (input) => {
        const { barId, assetClass, interval, count, start, end } = input
        const analysisOptions = buildAnalyzeOptions(input, {
          gapVolumeConfirmation: true,
          ifvgVolumeConfirmation: true,
          orderBlockVolumeConfirmation: true,
          maxFVGs: 10,
          maxIFVGs: 5,
          maxOrderBlocks: 10,
        })
        const ref: BarSourceRef = assetClass ? { barId, assetClass } : { barId }
        const opts: GetBarsOpts = { interval, count: count ?? 200, start, end }

        // 获取 K 线数据
        const result = await barService.getBars(ref, opts)

        const volumeConfirmation = result.bars.length > 0
          ? await buildPriceActionVolumeConfirmations({
            barService,
            ref,
            barId,
            interval,
            bars: result.bars,
            enabled: Boolean(
              analysisOptions.gapVolumeConfirmation ||
              analysisOptions.ifvgVolumeConfirmation ||
              analysisOptions.orderBlockVolumeConfirmation,
            ),
          })
          : { confirmations: undefined, meta: {} }

        return analyzePriceActionBars({
          bars: result.bars,
          interval,
          meta: result.meta,
          options: analysisOptions,
          volumeConfirmations: volumeConfirmation.confirmations,
          volumeConfirmationMeta: volumeConfirmation.meta,
        })
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
        const { barId, assetClass, intervals, count, start, end } = input
        const analysisOptions = buildAnalyzeOptions(input, {
          gapVolumeConfirmation: false,
          ifvgVolumeConfirmation: false,
          orderBlockVolumeConfirmation: false,
          maxFVGs: 5,
          maxIFVGs: 3,
          maxOrderBlocks: 5,
        })

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
              enabled: Boolean(
                analysisOptions.gapVolumeConfirmation ||
                analysisOptions.ifvgVolumeConfirmation ||
                analysisOptions.orderBlockVolumeConfirmation,
              ),
            })
            const detail = analyzePriceActionBars({
              bars: result.bars,
              interval,
              meta: result.meta,
              options: analysisOptions,
              volumeConfirmations: volumeConfirmation.confirmations,
              volumeConfirmationMeta: volumeConfirmation.meta,
            })
            const { marketStructure, liquidityPools, liquiditySweeps, fvgs, ifvgs, orderBlocks, premiumDiscount } = detail
            const currentPrice = result.bars[result.bars.length - 1].close

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
                ...detail.meta,
                returnedBreakerCount: detail.meta.totalBreakerCount,
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
        const errorCount = intervalResults.filter((entry) => entry.status === 'error').length
        const status: PriceActionMtfAnalysis['status'] =
          successfulCount === intervalResults.length
            ? 'ok'
            : errorCount === intervalResults.length
              ? 'error'
              : 'partial'

        return {
          status,
          summary: summarizeMtf(intervalResults),
          intervals: intervalResults,
          ...(status === 'error' ? { error: 'All intervals failed' } : {}),
        }
      },
    }),

  }
}
