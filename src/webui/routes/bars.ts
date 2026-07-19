/**
 * Federated K-line routes — `/api/bars/*`.
 *
 * The frontend chart's source-aware data path. Unlike the vendor-only
 * `/api/market-data-v1/*` passthrough, this goes through the federated bar
 * service: one symbol can have many bar sources (vendor + each connected
 * broker), each named by barId and tagged with a capability (realtime/iex/
 * delayed). Disambiguation is by EXPLICIT provider, never an internal rule —
 * the UI shows which source a chart came from and lets the user switch.
 */

import { Hono } from 'hono'
import type { EngineContext } from '../../core/types.js'
import type { BarSourceRef, GetBarsOpts } from '../../domain/market-data/bars/index.js'
import type { AssetClass } from '../../domain/market-data/aggregate-search.js'

export function createBarsRoutes(ctx: EngineContext): Hono {
  const app = new Hono()

  // GET /api/bars/search?query=&limit= → federated source candidates (barIds),
  // each with source/sourceId/assetClass/label/barCapability for the picker.
  app.get('/search', async (c) => {
    const query = (c.req.query('query') ?? '').trim()
    const requestedLimit = Number(c.req.query('limit') ?? 20)
    const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20))
    if (!query) return c.json({ candidates: [], count: 0 })
    const candidates = await ctx.barService.searchBarSources(query, { limit })
    return c.json({ candidates, count: candidates.length })
  })

  // GET /api/bars?barId=&interval=&count=&start=&end=&assetClass=
  //  or ?symbol=&assetClass=&interval=  (vendor-default, when no barId chosen yet)
  app.get('/', async (c) => {
    const interval = c.req.query('interval') ?? '1d'
    const barId = c.req.query('barId')
    const symbol = c.req.query('symbol')
    const assetClass = c.req.query('assetClass') as AssetClass | undefined
    const count = c.req.query('count')
    const start = c.req.query('start')
    const end = c.req.query('end')

    let ref: BarSourceRef
    if (barId) ref = assetClass ? { barId, assetClass } : { barId }
    else if (symbol && assetClass) ref = { symbol, assetClass }
    else return c.json({ results: null, meta: null, error: 'provide barId, or symbol + assetClass' }, 400)

    const opts: GetBarsOpts = { interval }
    if (count) opts.count = Number(count)
    if (start) opts.start = start
    if (end) opts.end = end

    try {
      const { bars, meta } = await ctx.barService.getBars(ref, opts)
      return c.json({ results: bars, meta })
    } catch (err) {
      // Loud-but-graceful: the chart shows the message, doesn't crash.
      return c.json({ results: null, meta: null, error: err instanceof Error ? err.message : String(err) })
    }
  })

  return app
}
