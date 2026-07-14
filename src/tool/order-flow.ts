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
approximation-only, not true tick-by-tick order flow. Summary-bearing responses
identify this fidelity as bar_proxy; latest bar completion is unknown.

Modes:
  - context: delta/CVD plus volume profile and structured summary
  - summary: structured summary without raw delta bars or profile bins
  - delta: delta/CVD only
  - profile: volume profile only

Intrabar selection is automatic, respects source-declared interval support, and
caps requests at MAX_BARS=5000.`,

      inputSchema: z.object({
        barId: z.string().describe('Bar source ID from searchBars'),
        assetClass: assetClassSchema.optional()
          .describe('Required for vendor barIds (e.g. "equity" for tradingview|AAPL)'),
        interval: z.string().describe('Target bar interval (e.g. "15m", "1h", "4h", "1d")'),
        count: z.number().int().positive().optional()
          .describe('Requested number of most-recent target bars (default 100; dynamically capped for intrabar safety)'),
        start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end: z.string().optional().describe('End date (YYYY-MM-DD)'),
        mode: z.enum(['context', 'summary', 'delta', 'profile']).optional()
          .describe('context returns raw views and summary; summary omits raw views; delta/profile return only that view'),
        numBins: z.number().int().positive().optional().describe('Volume profile bin count (default 20)'),
      }).strict(),

      execute: async (input) => analyzeOrderFlowContext(barService, input),
    }),
  }
}
