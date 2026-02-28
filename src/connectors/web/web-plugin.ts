import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Plugin, EngineContext } from '../../core/types.js'
import { SessionStore } from '../../core/session.js'
import { registerConnector, type Connector } from '../../core/connector-registry.js'
import { createChatRoutes, createMediaRoutes, type SSEClient } from './routes/chat.js'
import { createConfigRoutes, createOpenbbRoutes } from './routes/config.js'
import { createEventsRoutes } from './routes/events.js'
import { createCronRoutes } from './routes/cron.js'
import { createHeartbeatRoutes } from './routes/heartbeat.js'
import { createCryptoRoutes } from './routes/crypto.js'
import { createSecuritiesRoutes } from './routes/securities.js'

export interface WebConfig {
  port: number
}

export class WebPlugin implements Plugin {
  name = 'web'
  private server: ReturnType<typeof serve> | null = null
  private sseClients = new Map<string, SSEClient>()
  private unregisterConnector?: () => void

  constructor(private config: WebConfig) {}

  async start(ctx: EngineContext) {
    // Initialize session (mirrors Telegram's per-user pattern, single user for web)
    const session = new SessionStore('web/default')
    await session.restore()

    // Shared media map for file serving
    const mediaMap = new Map<string, string>()

    const app = new Hono()
    app.use('/api/*', cors())

    // ==================== Mount route modules ====================
    app.route('/api/chat', createChatRoutes({ ctx, session, sseClients: this.sseClients, mediaMap }))
    app.route('/api/media', createMediaRoutes(mediaMap))
    app.route('/api/config', createConfigRoutes({
      onConnectorsChange: async () => { await ctx.reconnectConnectors?.() },
    }))
    app.route('/api/openbb', createOpenbbRoutes())
    app.route('/api/events', createEventsRoutes(ctx))
    app.route('/api/cron', createCronRoutes(ctx))
    app.route('/api/heartbeat', createHeartbeatRoutes(ctx))
    app.route('/api/crypto', createCryptoRoutes(ctx))
    app.route('/api/securities', createSecuritiesRoutes(ctx))

    // ==================== Serve UI (Vite build output) ====================
    const uiRoot = resolve('dist/ui')
    app.use('/*', serveStatic({ root: uiRoot }))
    app.get('*', serveStatic({ root: uiRoot, path: 'index.html' }))

    // ==================== Connector registration ====================
    this.unregisterConnector = registerConnector(
      this.createConnector(this.sseClients, mediaMap),
    )

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

  private createConnector(
    sseClients: Map<string, SSEClient>,
    mediaMap: Map<string, string>,
  ): Connector {
    return {
      channel: 'web',
      to: 'default',
      capabilities: { push: true, media: true },
      deliver: async (payload) => {
        // Map media file paths to serveable URLs
        const media = (payload.media ?? []).map((m) => {
          const id = randomUUID()
          mediaMap.set(id, m.path)
          return { type: 'image' as const, url: `/api/media/${id}` }
        })

        const data = JSON.stringify({
          type: 'message',
          text: payload.text,
          media: media.length > 0 ? media : undefined,
          source: payload.source,
        })

        for (const client of sseClients.values()) {
          try { client.send(data) } catch { /* client disconnected */ }
        }

        return { delivered: sseClients.size > 0 }
      },
    }
  }
}
