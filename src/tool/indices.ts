/**
 * Index AI Tools
 *
 * Index discovery (CBOE, keyless). Constituents/historical stay on the
 * generic market surfaces; this is the "what index families exist" lens —
 * VIX variants, sector vol indices, SOFR-rate indices, etc.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { IndexClientLike } from '@/domain/market-data/client/types'

export function createIndexTools(indexClient: IndexClientLike) {
  return {
    indexSearch: tool({
      description: `Search listed indices by keyword (CBOE catalog, keyless).

Returns matching indices with symbol, name and description — the discovery
step for volatility families (VIX, VVIX, sector vols), buy-write/put-write
benchmarks and rate indices. Pair with the chart/bars surface to plot one.`,
      inputSchema: z.object({
        query: z.string().describe('Keyword, e.g. "volatility", "VIX", "dividend"'),
      }).meta({ examples: [{ query: 'volatility' }] }),
      execute: async ({ query }) => {
        return await indexClient.search({ query, provider: 'cboe' })
      },
    }),

    indexGetConstituents: tool({
      description: `Fetch the constituent symbols of a market index (e.g. S&P 500).

Returns each member symbol, name, weight and sector. Use this to build a
universe for screening or basket construction — pair with equity bars or
analysis tools to scan across constituents.`,
      inputSchema: z.object({
        symbol: z.string().describe('Index symbol, e.g. "^GSPC" for S&P 500, "^NDX" for NASDAQ-100'),
        provider: z.string().optional().describe('Data provider override (default: auto)'),
      }).meta({ examples: [{ symbol: '^GSPC' }] }),
      execute: async ({ symbol, provider }) => {
        return await indexClient.getConstituents({ symbol, ...(provider ? { provider } : {}) })
      },
    }),
  }
}
