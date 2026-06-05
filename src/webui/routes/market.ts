/**
 * Market data aggregation routes.
 *
 * `/api/market/*` is Alice's own namespace for cross-asset-class behaviour
 * that doesn't map 1:1 to an opentypebb fetcher — currently just the
 * heuristic symbol search. Quote / historical / fundamentals remain on the
 * raw opentypebb passthrough at `/api/market-data-v1/*`.
 */

import { Hono } from 'hono'
import type { EngineContext } from '../../core/types.js'
import { aggregateSymbolSearch } from '../../domain/market-data/aggregate-search.js'
import { fetchSectorRotation } from '../../domain/analysis/sector-rotation.js'

export function createMarketRoutes(ctx: EngineContext): Hono {
  const app = new Hono()

  app.get('/search', async (c) => {
    const query = c.req.query('query') ?? ''
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Math.max(1, Math.min(100, Number(limitRaw) || 20)) : 20
    const results = await aggregateSymbolSearch(ctx.marketSearch, query, limit)
    return c.json({ results, count: results.length })
  })

  // GICS sector rotation map — same compute as the sectorRotation AI tool.
  app.get('/sector-rotation', async (c) => {
    return c.json(await fetchSectorRotation(ctx.equityClient))
  })

  return app
}
