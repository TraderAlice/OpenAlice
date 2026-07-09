/**
 * Order Flow Analysis Tools — MCP registration.
 *
 * The tool layer is only the schema adapter. Data loading, intrabar planning,
 * delta/CVD calculation, volume profile, confidence, and approximation metadata
 * live behind the order-flow domain interface.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService } from '@/domain/market-data/bars/index.js'
import { analyzeOrderFlowContext } from '@/domain/analysis/order-flow/context.js'

export interface OrderFlowToolsDeps {
  barService: BarService
}

const assetClassSchema = z.enum(['equity', 'crypto', 'currency', 'commodity'])

export function createOrderFlowTools(deps: OrderFlowToolsDeps) {
  const { barService } = deps

  return {
    analyzeOrderFlowContext: tool({
      description: `Analyze order-flow context for a bar source.

Returns approximate delta volume / CVD and volume profile from lower-timeframe
intrabars, plus precision metadata (intrabar interval, truncation,
degradationReason, coverage, low-confidence bars). This is window-scoped and
approximation-only, not true tick-by-tick order flow.

Modes:
  - context: delta/CVD plus volume profile
  - delta: delta/CVD only
  - profile: volume profile only

Intrabar selection is automatic and caps requests at MAX_BARS=5000. TradingView
sources may use internal 3m intrabars; other sources avoid 3m.`,

      inputSchema: z.object({
        barId: z.string().describe('Bar source ID from searchBars'),
        assetClass: assetClassSchema.optional()
          .describe('Required for vendor barIds (e.g. "equity" for tradingview|AAPL)'),
        interval: z.string().describe('Target bar interval (e.g. "15m", "1h", "4h", "1d")'),
        count: z.number().int().positive().optional()
          .describe('Requested number of most-recent target bars (default 100; dynamically capped for intrabar safety)'),
        start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end: z.string().optional().describe('End date (YYYY-MM-DD)'),
        mode: z.enum(['context', 'delta', 'profile']).optional()
          .describe('context returns both delta and profile; delta/profile return only that view'),
        numBins: z.number().int().positive().optional().describe('Volume profile bin count (default 20)'),
      }).strict(),

      execute: async (input) => analyzeOrderFlowContext(barService, input),
    }),
  }
}
