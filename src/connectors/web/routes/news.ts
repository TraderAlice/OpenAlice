import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'

const VALID_LOOKBACKS = new Set(['1h', '2h', '12h', '24h', '1d', '2d', '7d', '30d'])
const DEFAULT_LOOKBACK = '24h'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** News routes: GET / */
export function createNewsRoutes(ctx: EngineContext) {
  const app = new Hono()

  app.get('/', async (c) => {
    if (!ctx.newsProvider) {
      return c.json({ error: 'News provider not available' }, 503)
    }

    const lookback = c.req.query('lookback') || DEFAULT_LOOKBACK
    if (!VALID_LOOKBACKS.has(lookback)) {
      return c.json({
        error: `Invalid lookback "${lookback}". Valid: ${[...VALID_LOOKBACKS].join(', ')}`,
      }, 400)
    }

    const rawLimit = Number(c.req.query('limit')) || DEFAULT_LIMIT
    const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT)

    const sourceFilter = c.req.query('source') || undefined
    const sources = sourceFilter
      ? new Set(sourceFilter.split(',').map((s) => s.trim().toLowerCase()))
      : undefined

    let items = await ctx.newsProvider.getNewsV2({
      endTime: new Date(),
      lookback,
      limit: sources ? undefined : limit,
    })

    if (sources) {
      items = items.filter((item) => {
        const src = item.metadata.source?.toLowerCase()
        return src != null && sources.has(src)
      })
    }

    if (items.length > limit) {
      items = items.slice(-limit)
    }

    const shaped = items.map((item) => ({
      time: item.time.toISOString(),
      title: item.title,
      content: item.content,
      source: item.metadata.source ?? null,
      link: item.metadata.link ?? null,
      categories: item.metadata.categories ?? null,
    }))

    return c.json({ items: shaped, count: shaped.length, lookback })
  })

  return app
}
