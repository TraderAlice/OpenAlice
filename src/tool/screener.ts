/**
 * Equity Screener Tool
 *
 * Filters the local symbol index + market data to find stocks matching
 * technical and fundamental criteria. Uses the existing equityDiscover
 * (gainers/losers/active) as a candidate source, then applies filters.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EquityClientLike } from '@/domain/market-data/client/types.js'
import type { SymbolIndex } from '@/domain/market-data/equity/index.js'

export function createScreenerTools(
  equityClient: EquityClientLike,
  symbolIndex: SymbolIndex,
) {
  return {
    equityScreen: tool({
      description: `Screen equities using fundamental and momentum criteria.

Starts with a candidate pool (gainers, losers, most active, or a custom symbol list),
then filters by market cap, P/E ratio, sector, and other criteria.

This is useful for finding new opportunities that match your trading style.

Examples:
  equityScreen({ pool: "active", minMarketCap: 10000000000 })
  equityScreen({ pool: "gainers", sector: "Technology", maxPE: 30 })
  equityScreen({ pool: "custom", symbols: ["AAPL","MSFT","GOOGL","AMZN","NVDA","META"] })`,
      inputSchema: z.object({
        pool: z.enum(['gainers', 'losers', 'active', 'custom']).describe(
          'Candidate pool: "gainers"/"losers"/"active" from market movers, or "custom" with your own symbol list',
        ),
        symbols: z.array(z.string()).optional().describe('Custom symbol list (only for pool="custom")'),
        sector: z.string().optional().describe('Filter by sector (e.g. "Technology", "Healthcare")'),
        minMarketCap: z.number().optional().describe('Minimum market cap in USD'),
        maxMarketCap: z.number().optional().describe('Maximum market cap in USD'),
        minPE: z.number().optional().describe('Minimum P/E ratio'),
        maxPE: z.number().optional().describe('Maximum P/E ratio'),
        maxResults: z.number().int().positive().optional().describe('Max results to return (default: 10)'),
      }),
      execute: async ({ pool, symbols, sector, minMarketCap, maxMarketCap, minPE, maxPE, maxResults }) => {
        // Step 1: Get candidate symbols
        let candidates: Array<Record<string, unknown>>

        switch (pool) {
          case 'gainers':
            candidates = await equityClient.getGainers().catch(() => [])
            break
          case 'losers':
            candidates = await equityClient.getLosers().catch(() => [])
            break
          case 'active':
            candidates = await equityClient.getActive().catch(() => [])
            break
          case 'custom':
            if (!symbols || symbols.length === 0) {
              return { error: 'Provide symbols array for custom pool.' }
            }
            candidates = symbols.map(s => ({ symbol: s }))
            break
          default:
            return { error: `Unknown pool: ${pool}` }
        }

        if (candidates.length === 0) {
          return { pool, results: [], message: 'No candidates found.' }
        }

        // Limit candidate pool to avoid excessive API calls
        const candidateSymbols = candidates
          .map(c => (c.symbol as string) ?? '')
          .filter(s => s.length > 0)
          .slice(0, 25)

        // Step 2: Fetch profiles for filtering
        const hasFilters = sector || minMarketCap || maxMarketCap || minPE !== undefined || maxPE !== undefined

        if (!hasFilters) {
          // No filters — just return the raw candidate data
          return {
            pool,
            count: candidateSymbols.length,
            results: candidates.slice(0, maxResults ?? 10),
          }
        }

        // Fetch profiles in parallel
        const profilePromises = candidateSymbols.map(async (symbol) => {
          try {
            const [profiles, metrics] = await Promise.all([
              equityClient.getProfile({ symbol, provider: 'yfinance' }).catch(() => []),
              equityClient.getKeyMetrics({ symbol, limit: 1, provider: 'yfinance' }).catch(() => []),
            ])

            const profile = profiles[0] as Record<string, unknown> | undefined
            const metric = metrics[0] as Record<string, unknown> | undefined

            return {
              symbol,
              name: profile?.companyName ?? profile?.shortName ?? symbol,
              sector: profile?.sector as string | undefined,
              industry: profile?.industry as string | undefined,
              marketCap: (profile?.marketCap ?? profile?.mktCap) as number | undefined,
              pe: (metric?.peRatio ?? profile?.trailingPE) as number | undefined,
              price: profile?.price as number | undefined,
              change: (candidates.find(c => c.symbol === symbol) as Record<string, unknown>)?.changesPercentage as number | undefined,
            }
          } catch {
            return { symbol, name: symbol }
          }
        })

        const profiles = await Promise.all(profilePromises)

        // Step 3: Apply filters
        const filtered = profiles.filter(p => {
          if (sector && p.sector?.toLowerCase() !== sector.toLowerCase()) return false
          if (minMarketCap && (p.marketCap == null || p.marketCap < minMarketCap)) return false
          if (maxMarketCap && (p.marketCap != null && p.marketCap > maxMarketCap)) return false
          if (minPE !== undefined && (p.pe == null || p.pe < minPE)) return false
          if (maxPE !== undefined && (p.pe != null && p.pe > maxPE)) return false
          return true
        })

        return {
          pool,
          candidatesScanned: candidateSymbols.length,
          matchCount: filtered.length,
          results: filtered.slice(0, maxResults ?? 10),
        }
      },
    }),
  }
}
