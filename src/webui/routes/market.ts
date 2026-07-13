/**
 * Market data aggregation routes.
 *
 * `/api/market/*` is Alice's own namespace for cross-asset-class behaviour
 * that doesn't map 1:1 to an embedded provider fetcher — currently just the
 * heuristic symbol search. Quote / historical / fundamentals remain on the
 * compatibility passthrough at `/api/market-data-v1/*`.
 */

import { Hono } from 'hono'
import type { EngineContext } from '../../core/types.js'
import { aggregateSymbolSearch } from '../../domain/market-data/aggregate-search.js'
import { fetchSectorRotation, type SectorRotationResult } from '../../domain/analysis/sector-rotation.js'
import { createHubFetcher } from '../../domain/market-data/reference/hub.js'
import type { ReferenceMeta } from '../../domain/market-data/reference/types.js'
import type { EquityClientLike } from '../../domain/market-data/client/types.js'

export function createMarketRoutes(ctx: EngineContext): Hono {
  const app = new Hono()
  const rotationViaHub = createHubFetcher(ctx.config.marketData.hub)

  app.get('/search', async (c) => {
    const query = c.req.query('query') ?? ''
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Math.max(1, Math.min(100, Number(limitRaw) || 20)) : 20
    const results = await aggregateSymbolSearch(ctx.marketSearch, query, limit)
    return c.json({ results, count: results.length })
  })

  // GICS sector rotation map — same compute as the sectorRotation AI tool.
  // Hub-first: the hosted hub computes the same board (meta.origin says so).
  app.get('/sector-rotation', async (c) => {
    const hub = await rotationViaHub<SectorRotationResult & { meta: ReferenceMeta }>('rotation')
    if (hub) return c.json(hub)
    const local = await fetchSectorRotation(ctx.equityClient)
    return c.json({ ...local, meta: { provider: ctx.config.marketData.providers.equity, asOf: local.asOf, origin: 'local' as const } })
  })

  // First-party per-symbol equity endpoints — the detail-page panels'
  // replacement for the legacy /api/market-data-v1 passthrough (divorce
  // step: migrate consumers, then kill the compat layer). Same response
  // envelope ({results, provider}) so the UI swap is URL-only.
  const EQUITY_ENDPOINTS: Record<string, keyof EquityClientLike> = {
    profile: 'getProfile',
    metrics: 'getKeyMetrics',
    ratios: 'getFinancialRatios',
    balance: 'getBalanceSheet',
    income: 'getIncomeStatement',
    cash: 'getCashFlow',
  }
  app.get('/equity/:endpoint', async (c) => {
    const method = EQUITY_ENDPOINTS[c.req.param('endpoint')]
    if (!method) {
      return c.json({ error: `Unknown equity endpoint. Available: ${Object.keys(EQUITY_ENDPOINTS).join(', ')}` }, 404)
    }
    const symbol = c.req.query('symbol')
    if (!symbol) return c.json({ error: 'symbol is required' }, 400)
    try {
      const fn = ctx.equityClient[method] as (p: Record<string, unknown>) => Promise<unknown[]>
      const results = await fn.call(ctx.equityClient, { symbol })
      return c.json({ results, provider: ctx.config.marketData.providers.equity })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  return app
}
