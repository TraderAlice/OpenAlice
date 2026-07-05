/**
 * Price Action Analysis Tools — MCP 工具注册
 *
 * FVG (Fair Value Gaps), iFVG (Inverse FVG), OB, BOS/CHoCH (Market Structure)
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService, GetBarsOpts, BarSourceRef } from '@/domain/market-data/bars/index'
import type { OhlcvBar } from '@/domain/market-data/bars/types'
import { detectFairValueGaps } from '@/domain/analysis/price-action/fvg-detector'
import { detectInverseFVG } from '@/domain/analysis/price-action/ifvg-detector'
import { detectOrderBlocks } from '@/domain/analysis/price-action/ob-detector'
import { detectSwingPoints } from '@/domain/analysis/price-action/swing-detector'
import { analyzeMarketStructure } from '@/domain/analysis/price-action/market-structure'
import { calculateATR, calculateAverageRange } from '@/domain/analysis/price-action/indicators'
import { buildPriceActionVolumeConfirmations } from '@/domain/analysis/price-action/volume-confirmation'
import {
  scoreFVGImportance,
  scoreIFVGImportance,
  type ScoringContext,
} from '@/domain/analysis/price-action/importance-scoring'
import type { FairValueGap, InverseFVG, OrderBlock } from '@/domain/analysis/price-action/types'

export interface PriceActionToolsDeps {
  barService: BarService
}

function latestVolatility(bars: OhlcvBar[]): number {
  const atr = calculateATR(bars, 14).at(-1)
  if (atr && atr > 0) return atr

  const avgRange = calculateAverageRange(bars, 20).at(-1)
  if (avgRange && avgRange > 0) return avgRange

  const currentPrice = bars.at(-1)?.close ?? 0
  return Math.max(Math.abs(currentPrice) * 0.01, 1)
}

function withinProximity(top: number, bottom: number, currentPrice: number, proximityPct?: number): boolean {
  if (proximityPct === undefined || proximityPct <= 0 || currentPrice === 0) return true

  const midPrice = (top + bottom) / 2
  return Math.abs(midPrice - currentPrice) / Math.abs(currentPrice) <= proximityPct
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

export function createPriceActionTools(deps: PriceActionToolsDeps) {
  const { barService } = deps

  return {
    analyzePriceAction: tool({
      description: `Analyze price action patterns (FVG, iFVG, Order Blocks, BOS/CHoCH) for ICT/SMC trading.

**Fair Value Gaps (FVG)**: Price imbalances formed by three candles where the first and third
do not overlap. The detector can also use VI (body/volume imbalance)
and OG (opening gap) variants, with mitigation by close or wick. When enabled,
the formation candle includes lower-timeframe intrabar delta confirmation.

**Inverse FVG (iFVG)**: When an FVG is filled and price reverses from within the gap, it
transforms into an institutional order block (support/resistance). When enabled,
the reversal candle includes lower-timeframe intrabar delta confirmation.

**Order Blocks (OB)**: Volumetric order blocks. When a BOS/CHoCH
breaks structure, the detector locates the extreme candle between the broken swing and
breakout, derives a support/resistance zone, and marks it mitigated when price closes
through the configured boundary. When enabled, OBs include lower-timeframe intrabar
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
        fvgMitigationSource: z.enum(['close', 'wick']).optional().describe('Use close or wick to mark FVG mitigation/fill status (default close)'),
        gapVolumeConfirmation: z.boolean().optional().describe('Try to attach lower-timeframe intrabar delta/coverage confirmation to FVG/VI/OG formation bars (default true)'),
        minGapSize: z.number().optional().describe('Minimum FVG size to filter noise (default 0)'),
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
        orderBlockMitigation: z.enum(['absolute', 'middle']).optional().describe('Mitigation trigger: absolute boundary or middle line (default absolute)'),
        hideOverlappingOrderBlocks: z.boolean().optional().describe('Hide overlapping order blocks using Pine-style overlap filtering (default true)'),
        orderBlockOverlapMethod: z.enum(['previous', 'recent']).optional().describe('When order blocks overlap, keep the previous/older block or the recent/newer block (default previous)'),
        orderBlockVolumeConfirmation: z.boolean().optional().describe('Try to attach lower-timeframe intrabar delta/coverage confirmation to OB anchor and breakout bars (default true)'),
        internalLookback: z.number().int().min(2).optional().describe('Internal swing lookback (default 5)'),
        swingLookback: z.number().int().min(2).optional().describe('Swing lookback (default 20)'),
        externalLookback: z.number().int().min(2).optional().describe('External swing lookback (default 50)'),
      }),

      execute: async ({
        barId,
        assetClass,
        interval,
        count,
        start,
        end,
        gapMode = 'FVG',
        fvgMitigationSource = 'close',
        gapVolumeConfirmation = true,
        minGapSize,
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
        orderBlockMitigation = 'absolute',
        hideOverlappingOrderBlocks = true,
        orderBlockOverlapMethod = 'previous',
        orderBlockVolumeConfirmation = true,
        internalLookback,
        swingLookback,
        externalLookback,
      }) => {
        const ref: BarSourceRef = assetClass ? { barId, assetClass } : { barId }
        const opts: GetBarsOpts = { interval, count: count ?? 200, start, end }

        // 获取 K 线数据
        const result = await barService.getBars(ref, opts)

        if (result.bars.length === 0) {
          return {
            error: 'No bars returned for the requested window',
            fvgs: [],
            ifvgs: [],
            orderBlocks: [],
            marketStructure: {
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
            },
            meta: {
              ...result.meta,
              totalFvgCount: 0,
              returnedFvgCount: 0,
              totalIfvgCount: 0,
              returnedIfvgCount: 0,
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

        // 1. 检测 FVG
        const allFVGs = detectFairValueGaps({
          bars: result.bars,
          gapMode,
          mitigationSource: fvgMitigationSource,
          minGapSize,
          minBodyRatio,
          volumeConfirmations: gapVolumeConfirmation ? volumeConfirmation.confirmations : undefined,
        })

        // 2. 检测 iFVG
        const allIFVGs = detectInverseFVG({
          bars: result.bars,
          fvgs: allFVGs,
          maxLookAheadBars: maxIFVGLookAheadBars,
          volumeConfirmations: ifvgVolumeConfirmation ? volumeConfirmation.confirmations : undefined,
        })

        // 3. 检测 Swing 点
        const swingPoints = detectSwingPoints({
          bars: result.bars,
          internalLookback,
          swingLookback,
          externalLookback,
        })

        // 4. 分析市场结构
        const marketStructure = analyzeMarketStructure({
          bars: result.bars,
          swingPoints,
          internalLookback,
          swingLookback,
          externalLookback,
        })

        const currentPrice = result.bars[result.bars.length - 1].close
        const scoringContext: ScoringContext = {
          currentPrice,
          volatility: latestVolatility(result.bars),
          barCount: result.bars.length,
          marketStructure,
        }

        const fvgs = rankFVGs(allFVGs, scoringContext, {
          maxFVGs,
          includeFilled,
          proximityPct,
        })
        const ifvgs = rankIFVGs(allIFVGs, scoringContext, {
          maxIFVGs,
          proximityPct,
          minImpulseRatio,
          minEngulfingStrength,
        })
        const allOrderBlocks = detectOrderBlocks({
          bars: result.bars,
          bos: marketStructure.bos,
          choch: marketStructure.choch,
          triggerFilter: orderBlockTrigger,
          positionMode: orderBlockPosition,
          mitigationMode: orderBlockMitigation,
          includeMitigated: true,
          maxOrderBlocks: 0,
          volumeConfirmations: orderBlockVolumeConfirmation ? volumeConfirmation.confirmations : undefined,
          hideOverlap: hideOverlappingOrderBlocks,
          overlapMethod: orderBlockOverlapMethod,
        })
        const orderBlocks = recalculateOrderBlockVolumeShares(
          limitResults(
            allOrderBlocks
              .filter((orderBlock) => includeMitigatedOrderBlocks || !orderBlock.mitigated)
              .map((orderBlock) => ({ ...orderBlock })),
            maxOrderBlocks,
          ),
        )

        return {
          fvgs,
          ifvgs,
          orderBlocks,
          marketStructure,
          meta: {
            ...result.meta,
            totalFvgCount: allFVGs.length,
            returnedFvgCount: fvgs.length,
            totalIfvgCount: allIFVGs.length,
            returnedIfvgCount: ifvgs.length,
            totalOrderBlockCount: allOrderBlocks.length,
            returnedOrderBlockCount: orderBlocks.length,
            mitigatedOrderBlockCount: allOrderBlocks.filter((ob) => ob.mitigated).length,
            ...volumeConfirmation.meta,
            bosCount: marketStructure.bos.length,
            chochCount: marketStructure.choch.length,
          },
        }
      },
    }),

  }
}
