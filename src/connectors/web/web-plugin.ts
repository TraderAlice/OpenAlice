import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Plugin, EngineContext } from '../../core/types.js'
import { SessionStore, toTextHistory } from '../../core/session.js'
import { registerConnector, touchInteraction } from '../../core/connector-registry.js'
import { loadConfig, writeConfigSection, type ConfigSection } from '../../core/config.js'
import { readAIConfig, writeAIConfig, type AIProvider } from '../../core/ai-config.js'

export interface WebConfig {
  port: number
}

interface SSEClient {
  id: string
  send: (data: string) => void
}

export class WebPlugin implements Plugin {
  name = 'web'
  private server: ReturnType<typeof serve> | null = null
  private session!: SessionStore
  private ctx!: EngineContext
  private sseClients = new Map<string, SSEClient>()
  private unregisterConnector?: () => void
  /** Media path lookup: id → absolute file path. */
  private mediaMap = new Map<string, string>()

  constructor(private config: WebConfig) {}

  async start(ctx: EngineContext) {
    this.ctx = ctx

    // Initialize session (mirrors Telegram's per-user pattern, single user for web)
    this.session = new SessionStore('web/default')
    await this.session.restore()

    const app = new Hono()
    app.use('/api/*', cors())

    // ==================== Chat endpoint ====================
    app.post('/api/chat', async (c) => {
      const body = await c.req.json<{ message?: string }>()
      const message = body.message?.trim()
      if (!message) {
        return c.json({ error: 'message is required' }, 400)
      }

      // Guard: engine already processing
      if (ctx.engine.isGenerating) {
        return c.json({ error: 'Engine is busy, please try again in a moment.' }, 409)
      }

      touchInteraction('web', 'default')

      // Log: message received
      const receivedEntry = await ctx.eventLog.append('message.received', {
        channel: 'web',
        to: 'default',
        prompt: message,
      })

      // Route through unified provider (Engine → ProviderRouter → Vercel or Claude Code)
      const result = await ctx.engine.askWithSession(message, this.session, {
        historyPreamble: 'The following is the recent conversation from the Web UI. Use it as context if the user references earlier messages.',
      })

      // Log: message sent
      await ctx.eventLog.append('message.sent', {
        channel: 'web',
        to: 'default',
        prompt: message,
        reply: result.text,
        durationMs: Date.now() - receivedEntry.ts,
      })

      // Map media files to serveable URLs
      const media = (result.media ?? []).map((m) => {
        const id = randomUUID()
        this.mediaMap.set(id, m.path)
        return { type: 'image' as const, url: `/api/media/${id}` }
      })

      // Evict old media entries (keep last 200)
      if (this.mediaMap.size > 200) {
        const keys = [...this.mediaMap.keys()]
        for (let i = 0; i < keys.length - 200; i++) {
          this.mediaMap.delete(keys[i])
        }
      }

      return c.json({ text: result.text, media })
    })

    // ==================== History endpoint ====================
    app.get('/api/chat/history', async (c) => {
      const limit = Number(c.req.query('limit')) || 100

      const entries = await this.session.readActive()
      const history = toTextHistory(entries)
      const trimmed = history.slice(-limit)

      // Attach timestamps from the original entries (best-effort match)
      const entryTimestamps = entries
        .filter((e) => e.type === 'user' || e.type === 'assistant')
        .map((e) => e.timestamp)

      const messages = trimmed.map((h, i) => ({
        role: h.role,
        text: h.text,
        timestamp: entryTimestamps[entryTimestamps.length - trimmed.length + i] ?? null,
      }))

      return c.json({ messages })
    })

    // ==================== SSE endpoint ====================
    app.get('/api/chat/events', (c) => {
      return streamSSE(c, async (stream) => {
        const clientId = randomUUID()

        this.sseClients.set(clientId, {
          id: clientId,
          send: (data) => {
            stream.writeSSE({ data }).catch(() => {})
          },
        })

        // Keep alive with periodic pings
        const pingInterval = setInterval(() => {
          stream.writeSSE({ event: 'ping', data: '' }).catch(() => {})
        }, 30_000)

        stream.onAbort(() => {
          clearInterval(pingInterval)
          this.sseClients.delete(clientId)
        })

        // Keep stream open indefinitely
        await new Promise<void>(() => {})
      })
    })

    // ==================== Media endpoint ====================
    app.get('/api/media/:id', async (c) => {
      const id = c.req.param('id')
      const filePath = this.mediaMap.get(id)
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

    // ==================== Config endpoints ====================
    app.get('/api/config', async (c) => {
      try {
        const [config, aiConfig] = await Promise.all([loadConfig(), readAIConfig()])
        return c.json({ ...config, aiProvider: aiConfig.provider })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    app.put('/api/config/ai-provider', async (c) => {
      try {
        const body = await c.req.json<{ provider?: string }>()
        const provider = body.provider
        if (provider !== 'claude-code' && provider !== 'vercel-ai-sdk') {
          return c.json({ error: 'Invalid provider. Must be "claude-code" or "vercel-ai-sdk".' }, 400)
        }
        await writeAIConfig(provider as AIProvider)
        return c.json({ provider })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    app.put('/api/config/:section', async (c) => {
      try {
        const section = c.req.param('section') as ConfigSection
        const validSections: ConfigSection[] = ['engine', 'model', 'agent', 'crypto', 'securities', 'compaction', 'heartbeat']
        if (!validSections.includes(section)) {
          return c.json({ error: `Invalid section "${section}". Valid: ${validSections.join(', ')}` }, 400)
        }
        const body = await c.req.json()
        const validated = await writeConfigSection(section, body)
        return c.json(validated)
      } catch (err) {
        if (err instanceof Error && err.name === 'ZodError') {
          return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400)
        }
        return c.json({ error: String(err) }, 500)
      }
    })

    // ==================== Event Log endpoints ====================
    app.get('/api/events/recent', (c) => {
      const afterSeq = Number(c.req.query('afterSeq')) || 0
      const limit = Number(c.req.query('limit')) || 100
      const type = c.req.query('type') || undefined
      const entries = ctx.eventLog.recent({ afterSeq, limit, type })
      return c.json({ entries, lastSeq: ctx.eventLog.lastSeq() })
    })

    app.get('/api/events/stream', (c) => {
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

    // ==================== Cron endpoints ====================
    app.get('/api/cron/jobs', (c) => {
      const jobs = ctx.cronEngine.list()
      return c.json({ jobs })
    })

    app.post('/api/cron/jobs', async (c) => {
      try {
        const body = await c.req.json<{
          name: string
          payload: string
          schedule: { kind: string; at?: string; every?: string; cron?: string }
          enabled?: boolean
        }>()
        if (!body.name || !body.payload || !body.schedule?.kind) {
          return c.json({ error: 'name, payload, and schedule are required' }, 400)
        }
        const id = await ctx.cronEngine.add({
          name: body.name,
          payload: body.payload,
          schedule: body.schedule as import('../../task/cron/engine.js').CronSchedule,
          enabled: body.enabled,
        })
        return c.json({ id })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    app.put('/api/cron/jobs/:id', async (c) => {
      try {
        const id = c.req.param('id')
        const body = await c.req.json()
        await ctx.cronEngine.update(id, body)
        return c.json({ ok: true })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    app.delete('/api/cron/jobs/:id', async (c) => {
      try {
        const id = c.req.param('id')
        await ctx.cronEngine.remove(id)
        return c.json({ ok: true })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    app.post('/api/cron/jobs/:id/run', async (c) => {
      try {
        const id = c.req.param('id')
        await ctx.cronEngine.runNow(id)
        return c.json({ ok: true })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    // ==================== Heartbeat endpoints ====================
    app.get('/api/heartbeat/status', (c) => {
      return c.json({
        enabled: ctx.heartbeat.isEnabled(),
      })
    })

    app.post('/api/heartbeat/trigger', async (c) => {
      try {
        // Find the __heartbeat__ cron job and runNow on it
        const jobs = ctx.cronEngine.list()
        const hbJob = jobs.find((j) => j.name === '__heartbeat__')
        if (!hbJob) {
          return c.json({ error: 'Heartbeat cron job not found. Is heartbeat enabled?' }, 404)
        }
        await ctx.cronEngine.runNow(hbJob.id)
        return c.json({ ok: true })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    app.put('/api/heartbeat/enabled', async (c) => {
      try {
        const body = await c.req.json<{ enabled: boolean }>()
        await ctx.heartbeat.setEnabled(body.enabled)
        return c.json({ enabled: ctx.heartbeat.isEnabled() })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    // ==================== Serve UI (Vite build output) ====================
    const uiRoot = resolve('dist/ui')
    app.use('/*', serveStatic({ root: uiRoot }))

    // SPA fallback: serve index.html for non-API routes (client-side routing)
    app.get('*', serveStatic({ root: uiRoot, path: 'index.html' }))

    // ==================== Connector registration ====================
    this.unregisterConnector = registerConnector({
      channel: 'web',
      to: 'default',
      deliver: async (text: string) => {
        const data = JSON.stringify({ type: 'message', text })
        for (const client of this.sseClients.values()) {
          try { client.send(data) } catch { /* client disconnected */ }
        }
      },
    })

    // ==================== Start server ====================
    this.server = serve({ fetch: app.fetch, port: this.config.port }, (info) => {
      console.log(`web plugin listening on http://localhost:${info.port}`)
    })
  }

  async stop() {
    this.sseClients.clear()
    this.unregisterConnector?.()
    this.server?.close()
  }
}
