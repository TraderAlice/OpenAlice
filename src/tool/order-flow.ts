/**
 * Order Flow Analysis Tools — MCP 工具注册
 *
 * Delta Volume / Cumulative Delta / Volume Profile，基于 intrabar 聚合估算买卖压力。
 * 工具层负责：
 * 1. 获取目标周期 bars
 * 2. 选择 intrabar 周期
 * 3. 获取 intrabars（同一 barId，不同 interval）
 * 4. 调用核心算法
 * 5. 返回结构化结果
 */

import { tool } from 'ai'
import { z } from 'zod'
import { type BarService, type BarSourceRef } from '@/domain/market-data/bars/index'
import { calculateDeltaVolume, calculateVolumeProfile } from '@/domain/analysis/order-flow/delta-volume'
import { confidenceForCoverage } from '@/domain/analysis/order-flow/intrabar-plan'
import { loadIntrabarWindow } from '@/domain/analysis/order-flow/intrabar-window'

export interface OrderFlowToolsDeps {
  barService: BarService
}

const DEFAULT_DELTA_COUNT = 100

export function createOrderFlowTools(deps: OrderFlowToolsDeps) {
  const { barService } = deps

  return {
    calculateDeltaVolume: tool({
      description: `Calculate Delta Volume and Cumulative Delta (CVD) for a bar source.

Delta Volume estimates buying/selling pressure by aggregating lower-timeframe intrabars:
each intrabar's volume is classified as positive (close > open) or negative (close < open),
then summed to get the target bar's delta. More precise than single-bar heuristics, but
less accurate than true tick-by-tick data.

Cumulative Delta (CVD) is the running sum of deltas — directional volume accumulation.

Intrabar selection (automatic):
  - Chooses the finest intrabar interval that keeps requested_count × intrabars_per_parent <= 5000
  - TradingView may use internal 3m intrabars between 1m and 5m; 3m is not exposed as a target interval
  - Falls back to coarser intrabars or reduces count when needed

Returns per-bar approximate deltas, CVD, deltaRatio, and coverage
(min(intrabar volume / target volume, 1)). Bars with coverage < 90% are flagged as
low-confidence (partial intrabar data).

This tool is window-scoped and approximation-only. It is designed for recent
order-flow analysis, not for long-history standardized delta research. In
particular, TradingView intraday history is limited to about 5000 bars from the
current anchor backward, so higher-timeframe delta/CVD may auto-degrade to
coarser intrabars or reduce count.

Requires a barId from searchBars. TradingView's 1m bars are ideal for intrabar aggregation
(keyless, realtime Cboe One feed). Example:
  barId: "tradingview|AAPL"
  interval: "15m"
  count: 100

Note: count is dynamically limited by the selected intrabar interval and MAX_BARS=5000.
The response meta reports requestedCount, actualCount, maxSupportedCount,
intrabarTimeframe, truncated, and degradationReason so downstream agents can
judge precision explicitly.`,

      inputSchema: z.object({
        barId: z.string().describe('Bar source ID from searchBars'),
        assetClass: z.enum(['equity', 'crypto', 'currency', 'commodity']).optional()
          .describe('Required for vendor barIds (e.g. "equity" for tradingview|AAPL)'),
        interval: z.enum(['15m', '30m', '1h', '4h', '1d', '1w']).describe('Target bar interval'),
        count: z.number().int().positive().optional().describe('Requested number of most-recent bars (default 100; dynamically capped for intrabar safety)'),
        start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end: z.string().optional().describe('End date (YYYY-MM-DD)'),
      }),

      execute: async ({ barId, assetClass, interval, count, start, end }) => {
        const ref: BarSourceRef = assetClass ? { barId, assetClass } : { barId }
        const requestedCount = count ?? DEFAULT_DELTA_COUNT
        const window = await loadIntrabarWindow({
          barService,
          ref,
          barId,
          targetInterval: interval,
          requestedCount,
          start,
          end,
        })

        if (window.status === 'no_target_bars') {
          return {
            error: 'No target bars returned for the requested window',
            bars: [],
            meta: {
              ...window.targetMeta,
              ...window.plan,
              isApproximation: true,
            },
          }
        }

        if (window.status === 'no_intrabars') {
          return {
            error: `No intrabar data (${window.plan.intrabarInterval}) returned for the target window`,
            bars: [],
            meta: {
              ...window.targetMeta,
              ...window.plan,
              intrabarCount: 0,
              isApproximation: true,
            },
          }
        }

        const result = calculateDeltaVolume({
          targetBars: window.targetBars,
          intrabars: window.intrabars,
          targetInterval: interval,
        })

        return {
          bars: window.targetBars.map((bar, i) => ({
            date: bar.date,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            delta: result.deltas[i],
            approxDelta: result.deltas[i],
            cumulativeDelta: result.cumulativeDeltas[i],
            cvd: result.cumulativeDeltas[i],
            deltaRatio: result.deltaRatios[i],
            coverage: result.coverage[i],
            confidence: confidenceForCoverage(result.coverage[i]),
            lowConfidence: result.lowConfidenceIndices.includes(i),
            isApproximation: true,
          })),
          meta: {
            ...window.targetMeta,
            ...window.plan,
            intrabarTimeframe: window.plan.intrabarInterval,
            intrabarCount: window.intrabars.length,
            lowConfidenceBars: result.lowConfidenceIndices.length,
            isApproximation: true,
          },
        }
      },
    }),

    calculateVolumeProfile: tool({
      description: `Calculate Volume Profile — price-level volume distribution histogram.

Shows which price levels had the most trading activity (volume concentration). Key metrics:
  - POC (Point of Control): price level with highest volume
  - Value Area: price range containing 70% of total volume

Volume Profile is built from lower-timeframe intrabars inside the requested target window,
using the same automatic intrabar selection as Delta Volume:
  - Chooses the finest intrabar interval that keeps requested_count × intrabars_per_parent <= 5000
  - TradingView may use internal 3m intrabars between 1m and 5m
  - Falls back to coarser intrabars or reduces count when needed

Use this to identify:
  - Support/resistance zones (high-volume nodes)
  - Fair value (Value Area)
  - Breakout levels (volume gaps)

Returns bins (price ranges with volume), POC, Value Area bounds, and intrabar metadata
so downstream agents can judge precision explicitly.`,

      inputSchema: z.object({
        barId: z.string().describe('Bar source ID from searchBars'),
        assetClass: z.enum(['equity', 'crypto', 'currency', 'commodity']).optional()
          .describe('Required for vendor barIds'),
        interval: z.string().describe('Bar interval (e.g. "1d", "1h")'),
        count: z.number().int().positive().optional().describe('Number of bars (default 100)'),
        start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end: z.string().optional().describe('End date (YYYY-MM-DD)'),
        numBins: z.number().int().positive().optional().describe('Number of price bins (default 20)'),
      }),

      execute: async ({ barId, assetClass, interval, count, start, end, numBins }) => {
        const ref: BarSourceRef = assetClass ? { barId, assetClass } : { barId }
        const requestedCount = count ?? DEFAULT_DELTA_COUNT
        const window = await loadIntrabarWindow({
          barService,
          ref,
          barId,
          targetInterval: interval,
          requestedCount,
          start,
          end,
        })

        if (window.status === 'no_target_bars') {
          return {
            error: 'No bars returned for the requested window',
            bins: [],
            poc: null,
            valueArea: null,
            meta: {
              ...window.targetMeta,
              ...window.plan,
              isApproximation: true,
            },
          }
        }

        if (window.status === 'no_intrabars') {
          return {
            error: `No intrabar data (${window.plan.intrabarInterval}) returned for the target window`,
            bins: [],
            poc: null,
            valueArea: null,
            meta: {
              ...window.targetMeta,
              ...window.plan,
              intrabarTimeframe: window.plan.intrabarInterval,
              targetBars: window.targetBars.length,
              intrabarCount: 0,
              isApproximation: true,
            },
          }
        }

        const profile = calculateVolumeProfile({
          bars: window.intrabars,
          numBins: numBins ?? 20,
        })

        return {
          bins: profile.bins,
          poc: profile.poc,
          valueArea: {
            high: profile.valueAreaHigh,
            low: profile.valueAreaLow,
          },
          meta: {
            ...window.targetMeta,
            ...window.plan,
            intrabarTimeframe: window.plan.intrabarInterval,
            targetBars: window.targetBars.length,
            intrabarCount: window.intrabars.length,
            isApproximation: true,
          },
        }
      },
    }),
  }
}
