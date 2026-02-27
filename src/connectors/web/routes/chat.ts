import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { EngineContext } from '../../../core/types.js'
import { SessionStore, toChatHistory } from '../../../core/session.js'
import { touchInteraction } from '../../../core/connector-registry.js'

export interface SSEClient {
  id: string
  send: (data: string) => void
}

interface ChatDeps {
  ctx: EngineContext
  session: SessionStore
  sseClients: Map<string, SSEClient>
  mediaMap: Map<string, string>
}

/** Chat routes: POST /, GET /history, GET /events (SSE) */
export function createChatRoutes({ ctx, session, sseClients, mediaMap }: ChatDeps) {
  const app = new Hono()

  app.post('/', async (c) => {
    const body = await c.req.json<{ message?: string }>()
    const message = body.message?.trim()
    if (!message) return c.json({ error: 'message is required' }, 400)

    touchInteraction('web', 'default')

    const receivedEntry = await ctx.eventLog.append('message.received', {
      channel: 'web', to: 'default', prompt: message,
    })

    const result = await ctx.engine.askWithSession(message, session, {
      historyPreamble: 'The following is the recent conversation from the Web UI. Use it as context if the user references earlier messages.',
    })

    await ctx.eventLog.append('message.sent', {
      channel: 'web', to: 'default', prompt: message,
      reply: result.text, durationMs: Date.now() - receivedEntry.ts,
    })

    // Map media files to serveable URLs
    const media = (result.media ?? []).map((m) => {
      const id = randomUUID()
      mediaMap.set(id, m.path)
      return { type: 'image' as const, url: `/api/media/${id}` }
    })

    // Evict old media entries (keep last 200)
    if (mediaMap.size > 200) {
      const keys = [...mediaMap.keys()]
      for (let i = 0; i < keys.length - 200; i++) mediaMap.delete(keys[i])
    }

    return c.json({ text: result.text, media })
  })

  app.get('/history', async (c) => {
    const limit = Number(c.req.query('limit')) || 100
    const entries = await session.readActive()
    return c.json({ messages: toChatHistory(entries).slice(-limit) })
  })

  app.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      const clientId = randomUUID()
      sseClients.set(clientId, {
        id: clientId,
        send: (data) => { stream.writeSSE({ data }).catch(() => {}) },
      })

      const pingInterval = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '' }).catch(() => {})
      }, 30_000)

      stream.onAbort(() => {
        clearInterval(pingInterval)
        sseClients.delete(clientId)
      })

      await new Promise<void>(() => {})
    })
  })

  return app
}

/** Media routes: GET /:id */
export function createMediaRoutes(mediaMap: Map<string, string>) {
  const app = new Hono()

  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const filePath = mediaMap.get(id)
    if (!filePath) return c.notFound()

    try {
      const buf = await readFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase()
      const mime =
        ext === 'png' ? 'image/png'
          : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'webp' ? 'image/webp'
              : ext === 'gif' ? 'image/gif'
                : 'application/octet-stream'
      return c.body(buf, { headers: { 'Content-Type': mime } })
    } catch {
      return c.notFound()
    }
  })

  return app
}
