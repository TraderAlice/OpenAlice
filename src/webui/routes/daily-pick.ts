import { Hono } from 'hono'
import type { EngineContext } from '../../core/types.js'

export function createDailyPickRoutes(ctx: EngineContext) {
  const app = new Hono()

  app.get('/today', async (c) => {
    const pick = await ctx.dailyPickEngine.getToday()
    return c.json({ pick })
  })

  app.get('/recent', async (c) => {
    const limit = Number(c.req.query('limit') ?? '10')
    const picks = await ctx.dailyPickEngine.getRecent(limit)
    return c.json({ picks })
  })

  app.get('/watchlist', async (c) => {
    const entries = await ctx.dailyPickEngine.getWatchlist()
    return c.json({ entries })
  })

  app.put('/watchlist', async (c) => {
    const body = await c.req.json<{ entries: Array<{ symbol: string; name?: string; note?: string }> }>()
    await ctx.dailyPickEngine.setWatchlist(body.entries)
    return c.json({ ok: true, count: body.entries.length })
  })

  app.get('/lessons', async (c) => {
    const lessons = await ctx.dailyPickEngine.getLessons()
    return c.json({ lessons })
  })

  app.get('/wraps', async (c) => {
    const files = await ctx.dailyPickEngine.listWrapFiles()
    return c.json({ files })
  })

  app.get('/wraps/:endDate', async (c) => {
    const endDate = c.req.param('endDate')
    const markdown = await ctx.dailyPickEngine.readWrapFile(endDate)
    if (markdown === null) return c.json({ error: 'wrap not found' }, 404)
    return c.json({ endDate, markdown })
  })

  app.post('/run/pick', async (c) => {
    try {
      const pick = await ctx.dailyPickEngine.pickToday()
      return c.json({ ok: true, pick })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/override', async (c) => {
    try {
      const body = await c.req.json<{ symbol: string; name?: string; reason?: string }>()
      const symbol = (body.symbol ?? '').trim()
      if (!symbol) return c.json({ error: 'symbol is required' }, 400)
      const reason = body.reason?.trim() || `Manually selected by user at ${new Date().toISOString()}`
      const pick = await ctx.dailyPickEngine.overridePick(symbol, body.name, reason)
      return c.json({ ok: true, pick })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/run/hourly', async (c) => {
    try {
      const pick = await ctx.dailyPickEngine.runHourly()
      return c.json({ ok: true, pick })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/run/wrap', async (c) => {
    try {
      const result = await ctx.dailyPickEngine.runWrap()
      return c.json({ ok: true, result })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  return app
}
