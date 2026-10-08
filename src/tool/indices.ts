/**
 * Index AI Tools
 *
 * Index discovery (CBOE, keyless) and current constituents (FMP).
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { IndexClientLike } from '@/domain/market-data/client/types'

export function createIndexTools(indexClient: IndexClientLike) {
  return {
    indexGetConstituents: tool({
      description: `Get current index constituents through FMP. Supports S&P 500 (^GSPC or sp500),
Dow Jones (^DJI or dowjones), and the provider's nasdaq list. Requires configured
FMP access. Unsupported index symbols fail explicitly; this is not a historical
universe or a guarantee of point-in-time membership.`,
      inputSchema: z.object({
        symbol: z.string().trim().min(1).describe('^GSPC, ^DJI, sp500, dowjones, or nasdaq'),
        provider: z.literal('fmp').optional(),
      }).meta({ examples: [{ symbol: '^GSPC' }] }),
      execute: async ({ symbol }) => indexClient.getConstituents({ symbol, provider: 'fmp' }),
    }),
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
  }
}
