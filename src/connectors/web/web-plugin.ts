import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { resolve } from 'node:path'
import type { Plugin, EngineContext } from '../../core/types.js'
import { SessionStore, type ContentBlock } from '../../core/session.js'
import type { ConnectorCenter, Connector } from '../../core/connector-center.js'
import { persistMedia } from '../../core/media-store.js'
import { createChatRoutes, createMediaRoutes, type SSEClient } from './routes/chat.js'
import { createConfigRoutes, createOpenbbRoutes } from './routes/config.js'
import { createEventsRoutes } from './routes/events.js'
import { createCronRoutes } from './routes/cron.js'
import { createHeartbeatRoutes } from './routes/heartbeat.js'
import { createCryptoRoutes } from './routes/crypto.js'
import { createSecuritiesRoutes } from './routes/securities.js'
import { createDevRoutes } from './routes/dev.js'

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

    const app = new Hono()
    app.use('/api/*', cors())

    // ==================== Mount route modules ====================
    app.route('/api/chat', createChatRoutes({ ctx, session, sseClients: this.sseClients }))
    app.route('/api/media', createMediaRoutes())
    app.route('/api/config', createConfigRoutes({
      onConnectorsChange: async () => { await ctx.reconnectConnectors?.() },
    }))
    app.route('/api/openbb', createOpenbbRoutes())
    app.route('/api/events', createEventsRoutes(ctx))
    app.route('/api/cron', createCronRoutes(ctx))
    app.route('/api/heartbeat', createHeartbeatRoutes(ctx))
    app.route('/api/crypto', createCryptoRoutes(ctx))
    app.route('/api/securities', createSecuritiesRoutes(ctx))
    app.route('/api/dev', createDevRoutes(ctx.connectorCenter))

    // ==================== Serve UI (Vite build output) ====================
    const uiRoot = resolve('dist/ui')
    app.use('/*', serveStatic({ root: uiRoot }))
    app.get('*', serveStatic({ root: uiRoot, path: 'index.html' }))

    // ==================== Connector registration ====================
    this.unregisterConnector = ctx.connectorCenter.register(
      this.createConnector(this.sseClients, session),
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
    session: SessionStore,
  ): Connector {
    return {
      channel: 'web',
      to: 'default',
      capabilities: { push: true, media: true },
      send: async (payload) => {
        // Persist media to data/media/ with 3-word names
        const media: Array<{ type: 'image'; url: string }> = []
        for (const m of payload.media ?? []) {
          const name = await persistMedia(m.path)
          media.push({ type: 'image', url: `/api/media/${name}` })
        }

        const data = JSON.stringify({
          type: 'message',
          kind: payload.kind,
          text: payload.text,
          media: media.length > 0 ? media : undefined,
          source: payload.source,
        })

        for (const client of sseClients.values()) {
          try { client.send(data) } catch { /* client disconnected */ }
        }

        // Persist to session so history survives page refresh (text + image blocks)
        const blocks: ContentBlock[] = [
          { type: 'text', text: payload.text },
          ...media.map((m) => ({ type: 'image' as const, url: m.url })),
        ]
        await session.appendAssistant(blocks, 'engine', {
          kind: payload.kind,
          source: payload.source,
        })

        return { delivered: sseClients.size > 0 }
      },
    }
  }
}
