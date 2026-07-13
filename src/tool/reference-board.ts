/**
 * Board reads for agents — the same reference boards the UI renders
 * (hub-first with local fallback), as one MCP tool. Before this, agents
 * could only compose board-grade views from primitives; now
 * `marketGetBoard` / `traderhub board get` serves the finished product.
 */

import { z } from 'zod'
import { tool } from 'ai'
import type { ReferenceDataService } from '@/domain/market-data/reference/types.js'

const BOARDS = [
  'movers', 'calendar', 'macro', 'valuation',
  'term-structure', 'global-macro', 'shipping', 'fed',
] as const

export function createReferenceBoardTools(reference: ReferenceDataService) {
  return {
    marketGetBoard: tool({
      description: `Read a finished market board — the same boards the OpenAlice UI renders.

Available boards:
- movers: gainers/losers/most-active + value/growth/size screener lists (intraday)
- calendar: upcoming earnings, IPOs and ex-dividend dates (14-day window by default)
- macro: 14 US macro series cards — rates, labor, CPI YoY, oil, dollar, M2, sentiment (FRED)
- valuation: S&P 500 PE / Shiller CAPE / earnings yield / dividend yield (multpl)
- term-structure: BTC/ETH futures curve with annualized basis vs perpetual (Deribit)
- global-macro: 7 countries × CPI/short-rate/CLI/house/equity indices (OECD + BIS + World Bank, via FRED; CPI annual, rest monthly — check each cell's date)
- shipping: daily transit volume at 6 maritime chokepoints (IMF PortWatch)
- fed: balance sheet, primary dealer positioning, FOMC documents

meta.origin tells you who served it ('hub' = hosted TraderHub, 'local' = this
instance's own keys); meta.stale means the upstream refresh failed and you are
seeing the last good snapshot. For sector rotation use the sectorRotation tool.`,
      inputSchema: z.object({
        board: z.enum(BOARDS).describe('Which board to read'),
        days: z.number().int().positive().max(370).optional()
          .describe('calendar only: forward window in days (default 14)'),
      }).meta({ examples: [{ board: 'macro' }] }),
      execute: async ({ board, days }) => {
        switch (board) {
          case 'movers': return reference.movers()
          case 'calendar': return reference.calendar(days ? { days } : undefined)
          case 'macro': return reference.macro()
          case 'valuation': return reference.valuation()
          case 'term-structure': return reference.termStructure()
          case 'global-macro': return reference.globalMacro()
          case 'shipping': return reference.shipping()
          case 'fed': return reference.fed()
        }
      },
    }),
  }
}
