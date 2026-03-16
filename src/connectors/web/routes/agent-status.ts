import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { EngineContext } from '../../../core/types.js'

/** Tool call log routes: GET /, GET /recent, GET /stream (SSE) */
export function createAgentStatusRoutes(ctx: EngineContext) {
  const app = new Hono()

  // Paginated query from disk (full history)
  app.get('/', async (c) => {
    const page = Number(c.req.query('page')) || 1
    const pageSize = Number(c.req.query('pageSize')) || 100
    const name = c.req.query('name') || undefined
    const result = await ctx.toolCallLog.query({ page, pageSize, name })
    return c.json(result)
  })

  // Fast in-memory query (ring buffer)
  app.get('/recent', (c) => {
    const afterSeq = Number(c.req.query('afterSeq')) || 0
    const limit = Number(c.req.query('limit')) || 100
    const name = c.req.query('name') || undefined
    const entries = ctx.toolCallLog.recent({ afterSeq, limit, name })
    return c.json({ entries, lastSeq: ctx.toolCallLog.lastSeq() })
  })

  // Real-time SSE stream
  app.get('/stream', (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = ctx.toolCallLog.subscribe((record) => {
        stream.writeSSE({ data: JSON.stringify(record) }).catch(() => {})
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
