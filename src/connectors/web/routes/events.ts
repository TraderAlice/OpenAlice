import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { EngineContext } from '../../../core/types.js'

/** Event log routes: GET /, GET /recent, GET /stream (SSE) */
export function createEventsRoutes(ctx: EngineContext) {
  const app = new Hono()

  // Paginated query from disk (full history)
  app.get('/', async (c) => {
    const page = Number(c.req.query('page')) || 1
    const pageSize = Number(c.req.query('pageSize')) || 100
    const type = c.req.query('type') || undefined
    const result = await ctx.eventLog.query({ page, pageSize, type })
    return c.json(result)
  })

  // Fast in-memory query (ring buffer)
  app.get('/recent', (c) => {
    const afterSeq = Number(c.req.query('afterSeq')) || 0
    const limit = Number(c.req.query('limit')) || 100
    const type = c.req.query('type') || undefined
    const entries = ctx.eventLog.recent({ afterSeq, limit, type })
    return c.json({ entries, lastSeq: ctx.eventLog.lastSeq() })
  })

  app.get('/stream', (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = ctx.eventLog.subscribe((entry) => {
        stream.writeSSE({ data: JSON.stringify(entry) }).catch(() => {})
      })

      const pingInterval = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '' }).catch(() => {})
      }, 30_000)

      stream.onAbort(() => {
        clearInterval(pingInterval)
        unsub()
      })

      await new Promise<void>(() => {})
    })
  })

  return app
}
