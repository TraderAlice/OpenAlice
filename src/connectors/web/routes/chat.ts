import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import type { EngineContext } from '../../../core/types.js'
import type { AskOptions } from '../../../core/ai-provider-manager.js'
import { SessionStore, toChatHistory } from '../../../core/session.js'
import { readWebSubchannels } from '../../../core/config.js'
import { resolveMediaPath } from '../../../core/media-store.js'

export interface SSEClient {
  id: string
  send: (data: string) => void
}

interface ChatDeps {
  ctx: EngineContext
  sessions: Map<string, SessionStore>
  sseByChannel: Map<string, Map<string, SSEClient>>
}

/** Chat routes: POST /, GET /history, GET /events (SSE) */
export function createChatRoutes({ ctx, sessions, sseByChannel }: ChatDeps) {
  const app = new Hono()

  app.post('/', async (c) => {
    const body = await c.req.json() as { message?: string; channelId?: string }
    const message = body.message?.trim()
    if (!message) return c.json({ error: 'message is required' }, 400)

    const channelId = body.channelId ?? 'default'
    const session = sessions.get(channelId)
    if (!session) return c.json({ error: 'channel not found' }, 404)

    // Build AskOptions from channel config (if not default)
    const opts: AskOptions = {
      historyPreamble: `You are operating via the Web UI (session: web/${channelId}). The following is the recent conversation.`,
    }
    if (channelId !== 'default') {
      const channels = await readWebSubchannels()
      const channel = channels.find((ch) => ch.id === channelId)
      if (channel) {
        if (channel.systemPrompt) opts.systemPrompt = channel.systemPrompt
        if (channel.disabledTools?.length) opts.disabledTools = channel.disabledTools
        if (channel.profile) opts.profileSlug = channel.profile
      }
    }

    const receivedEntry = await ctx.connectorCenter.emitMessageReceived({
      channel: 'web', to: channelId, prompt: message,
    })

    const stream = ctx.agentCenter.askWithSession(message, session, opts)

    // Stream events directly on the POST response (reliable, same connection).
    // Also push to other SSE clients for multi-tab sync (best-effort).
    const channelClients = sseByChannel.get(channelId) ?? new Map()

    return streamSSE(c, async (sseStream) => {
      for await (const event of stream) {
        if (event.type === 'done') continue
        const data = JSON.stringify({ type: 'stream', event })

        // Write to requesting client (reliable)
        await sseStream.writeSSE({ data })

        // Push to other SSE clients (best-effort, multi-tab)
        for (const client of channelClients.values()) {
          try { client.send(data) } catch { /* disconnected */ }
        }
      }

      // Stream fully drained — await resolves immediately with cached result
      const result = await stream

      await ctx.connectorCenter.emitMessageSent({
        channel: 'web', to: channelId, prompt: message,
        reply: result.text, durationMs: Date.now() - receivedEntry.ts,
      })

      // Media already persisted by AgentCenter — use pre-built URLs
      const media = (result.mediaUrls ?? []).map((url: string) => ({ type: 'image', url }))

      // Final event with result
      await sseStream.writeSSE({
        data: JSON.stringify({ type: 'done', text: result.text, media }),
      })
    })
  })

  app.get('/history', async (c) => {
    const limit = Number(c.req.query('limit')) || 100
    const channelId = c.req.query('channel') ?? 'default'
    // Cursor: uuid of the oldest-loaded message on the client. Server
    // returns the `limit` entries appearing BEFORE that uuid in session
    // order. Omit to fetch the newest `limit` entries.
    const before = c.req.query('before')
    const session = sessions.get(channelId)
    if (!session) return c.json({ error: 'channel not found' }, 404)
    const entries = await session.readActive()

    // Slice off anything at/after the cursor entry (older-than-cursor only).
    let sliced = entries
    if (before) {
      const cutoffIdx = entries.findIndex((e) => e.uuid === before)
      sliced = cutoffIdx >= 0 ? entries.slice(0, cutoffIdx) : []
    }

    const window = sliced.slice(-limit)
    const messages = toChatHistory(window)
    // hasMore reflects raw entry reality — more entries exist older than
    // the window even if toChatHistory merged some into fewer items.
    const hasMore = window.length < sliced.length
    return c.json({ messages, hasMore })
  })

  app.get('/events', (c) => {
    const channelId = c.req.query('channel') ?? 'default'
    // Create SSE client map for this channel if it doesn't exist yet
    if (!sseByChannel.has(channelId)) sseByChannel.set(channelId, new Map())
    const channelClients = sseByChannel.get(channelId)!

    return streamSSE(c, async (stream) => {
      const clientId = randomUUID()
      channelClients.set(clientId, {
        id: clientId,
        send: (data) => { stream.writeSSE({ data }).catch(() => {}) },
      })

      const pingInterval = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '' }).catch(() => {})
      }, 30_000)

      stream.onAbort(() => {
        clearInterval(pingInterval)
        channelClients.delete(clientId)
      })

      await new Promise<void>(() => {})
    })
  })

  return app
}

/** Media routes: GET /:name — serves from data/media/ */
export function createMediaRoutes() {
  const app = new Hono()

  const MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  }

  app.get('/:date/:name', async (c) => {
    const { date, name } = c.req.param()
    const filePath = resolveMediaPath(join(date, name))

    try {
      const buf = await readFile(filePath)
      const ext = extname(name).toLowerCase()
      const mime = MIME[ext] ?? 'application/octet-stream'
      return c.body(buf, { headers: { 'Content-Type': mime } })
    } catch {
      return c.notFound()
    }
  })

  return app
}
