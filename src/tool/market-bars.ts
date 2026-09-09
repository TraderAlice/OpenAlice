import { tool } from 'ai'
import { z } from 'zod'
import type { BarService } from '../domain/market-data/bars/types.js'

/** Raw market data; the chart and optional calculators use this same service. */
export function createMarketBarsTools({ barService }: { barService: BarService }) {
  return {
    getMarketBars: tool({
      description: 'Read normalized OHLCV bars with source, returned-window timestamps and freshness metadata. freshness.delay describes possible delay and its basis; recordAgeSeconds is not measured feed latency. Use the returned bars in local Python, JavaScript or other pipelines. barId selects an explicit source; symbol plus assetClass uses the configured vendor. meta.quality reports incomplete OHLC records excluded from the fetched window before count selection. No calculation is required.',
      inputSchema: z.object({
        barId: z.string().min(1).optional().describe('Explicit sourceId|nativeSymbol from market search-bars'),
        symbol: z.string().min(1).optional(),
        assetClass: z.enum(['equity', 'crypto', 'currency', 'commodity']).optional(),
        interval: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']).default('1d'),
        count: z.number().int().min(1).max(5000).optional(),
        start: z.string().optional().describe('Inclusive start date, YYYY-MM-DD'),
        end: z.string().optional().describe('End date, YYYY-MM-DD'),
        asOf: z.string().optional().describe('Count anchor date, YYYY-MM-DD; cannot conflict with end'),
      }),
      execute: async ({ barId, symbol, assetClass, ...window }) => {
        if (barId && symbol) throw new Error('Choose barId or symbol, not both')
        if (!barId && (!symbol || !assetClass)) throw new Error('Supply barId, or symbol and assetClass')
        const ref = barId ? { barId, ...(assetClass ? { assetClass } : {}) } : { symbol: symbol!, assetClass: assetClass! }
        return barService.getBars(ref, window)
      },
    }),
  }
}
