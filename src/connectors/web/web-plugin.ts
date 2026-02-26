import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Plugin, EngineContext } from '../../core/types.js'
import { SessionStore, toChatHistory } from '../../core/session.js'
import { registerConnector, touchInteraction } from '../../core/connector-registry.js'
import { loadConfig, writeConfigSection, readApiKeysConfig, readOpenbbConfig, type ConfigSection } from '../../core/config.js'
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
      const items = toChatHistory(entries)
      const trimmed = items.slice(-limit)

      return c.json({ messages: trimmed })
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
        const validSections: ConfigSection[] = ['engine', 'model', 'agent', 'crypto', 'securities', 'openbb', 'compaction', 'aiProvider', 'heartbeat', 'apiKeys', 'telegram']
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

    // ==================== API Keys status ====================
    app.get('/api/config/api-keys/status', async (c) => {
      try {
        const keys = await readApiKeysConfig()
        return c.json({
          anthropic: !!keys.anthropic,
          openai: !!keys.openai,
          google: !!keys.google,
        })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    // ==================== OpenBB provider key test ====================
    app.post('/api/openbb/test-provider', async (c) => {
      const TEST_ENDPOINTS: Record<string, { credField: string; path: string }> = {
        fred:             { credField: 'fred_api_key',             path: '/api/v1/economy/fred_search?query=GDP&provider=fred' },
        bls:              { credField: 'bls_api_key',              path: '/api/v1/economy/survey/bls_search?query=unemployment&provider=bls' },
        eia:              { credField: 'eia_api_key',              path: '/api/v1/commodity/short_term_energy_outlook?provider=eia' },
        econdb:           { credField: 'econdb_api_key',           path: '/api/v1/economy/available_indicators?provider=econdb' },
        fmp:              { credField: 'fmp_api_key',              path: '/api/v1/equity/screener?provider=fmp&limit=1' },
        nasdaq:           { credField: 'nasdaq_api_key',           path: '/api/v1/equity/search?query=AAPL&provider=nasdaq&is_symbol=true' },
        intrinio:         { credField: 'intrinio_api_key',         path: '/api/v1/equity/search?query=AAPL&provider=intrinio&limit=1' },
        tradingeconomics: { credField: 'tradingeconomics_api_key', path: '/api/v1/economy/calendar?provider=tradingeconomics' },
      }

      try {
        const { provider, key } = await c.req.json<{ provider: string; key: string }>()
        const endpoint = TEST_ENDPOINTS[provider]
        if (!endpoint) return c.json({ ok: false, error: `Unknown provider: ${provider}` }, 400)
        if (!key) return c.json({ ok: false, error: 'No API key provided' }, 400)

        const openbbConfig = await readOpenbbConfig()
        const credHeader = JSON.stringify({ [endpoint.credField]: key })
        const url = `${openbbConfig.apiUrl}${endpoint.path}`

        const res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers: { 'X-OpenBB-Credentials': credHeader },
        })

        if (res.ok) {
          return c.json({ ok: true })
        }
        const body = await res.text().catch(() => '')
        return c.json({ ok: false, error: `OpenBB returned ${res.status}: ${body.slice(0, 200)}` })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return c.json({ ok: false, error: msg.includes('timeout') ? 'Cannot reach OpenBB API' : msg })
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

    // ==================== Trading Engine Reconnect ====================

    app.post('/api/crypto/reconnect', async (c) => {
      if (!ctx.reconnectCrypto) return c.json({ success: false, error: 'Not available' }, 501)
      const result = await ctx.reconnectCrypto()
      return c.json(result, result.success ? 200 : 500)
    })

    app.post('/api/securities/reconnect', async (c) => {
      if (!ctx.reconnectSecurities) return c.json({ success: false, error: 'Not available' }, 501)
      const result = await ctx.reconnectSecurities()
      return c.json(result, result.success ? 200 : 500)
    })

    // ==================== Serve UI (Vite build output) ====================
    // Serves the built frontend from dist/ui/ (produced by `pnpm build:ui`).
    // During development, use the Vite dev server (port 5173) instead — see README.
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
