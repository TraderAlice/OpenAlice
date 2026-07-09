/**
 * Price Action Analysis Tools — MCP 工具注册
 *
 * FVG (Fair Value Gaps), iFVG (Inverse FVG), OB, BOS/CHoCH (Market Structure)
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService } from '@/domain/market-data/bars/index.js'
import {
  analyzePriceActionContext,
  analyzePriceActionFromBars,
  analyzePriceActionMtf,
  buildAnalyzeOptions,
} from '@/domain/analysis/price-action/context.js'
import type { AnalyzePriceActionBarsOptions } from '@/domain/analysis/price-action/analyze.js'

export interface PriceActionToolsDeps {
  barService: BarService
}

const zoneMitigationSourceSchema = z.enum(['body', 'wick', 'midpoint'])
const overlapPolicySchema = z.enum(['ranked', 'older', 'newer', 'none'])
const assetClassSchema = z.enum(['equity', 'crypto', 'currency', 'commodity'])
const structureLevelSchema = z.enum(['internal', 'swing', 'external'])
const marketStructureModeSchema = z.enum(['pivot', 'extreme'])

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
        const analysisOptions = buildAnalyzeOptions(input, {
          gapVolumeConfirmation: true,
          ifvgVolumeConfirmation: true,
          orderBlockVolumeConfirmation: true,
          maxFVGs: 10,
          maxIFVGs: 5,
          maxOrderBlocks: 10,
        })

        return analyzePriceActionFromBars(barService, {
          barId: input.barId,
          assetClass: input.assetClass,
          interval: input.interval,
          count: input.count,
          start: input.start,
          end: input.end,
          options: analysisOptions,
        })
      },
    }),

    analyzePriceActionContext: tool({
      description: `Return a compact multi-timeframe price-action context for a bar source.

This is the default agent-facing price-action entrypoint. It chooses opinionated
defaults for market context, execution context, or debugging, and hides detector
tuning unless a caller intentionally uses analyzePriceAction for full detail.`,

      inputSchema: z.object({
        barId: z.string().describe('Bar source ID from searchBars'),
        assetClass: assetClassSchema.optional()
          .describe('Required for vendor barIds (e.g. "equity" for tradingview|AAPL)'),
        intervals: z.array(z.string()).min(1).max(8).optional()
          .describe('Optional intervals ordered from higher timeframe to execution timeframe; defaults depend on mode'),
        mode: z.enum(['context', 'execution', 'debug']).optional()
          .describe('context: cheap higher-timeframe read; execution: nearer zones with intrabar confirmation; debug: fuller detail defaults'),
        count: z.number().int().positive().optional().describe('Number of bars per interval (default 200)'),
        start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end: z.string().optional().describe('End date (YYYY-MM-DD)'),
      }).strict(),

      execute: async (input) => analyzePriceActionContext(barService, input),
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

      execute: async (input) => {
        const options: AnalyzePriceActionBarsOptions = input
        const baseDetailArgs = { ...input }
        delete (baseDetailArgs as { intervals?: unknown }).intervals

        return analyzePriceActionMtf(barService, {
          barId: input.barId,
          assetClass: input.assetClass,
          intervals: input.intervals,
          count: input.count,
          start: input.start,
          end: input.end,
          options,
          defaults: {
            gapVolumeConfirmation: false,
            ifvgVolumeConfirmation: false,
            orderBlockVolumeConfirmation: false,
            maxFVGs: 5,
            maxIFVGs: 3,
            maxOrderBlocks: 5,
          },
          detailBaseArgs: baseDetailArgs,
        })
      },
    }),

  }
}
