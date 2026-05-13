import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { resolve } from 'node:path'
import type { Plugin, EngineContext } from '../core/types.js'
import type { ProducerHandle } from '../core/producer.js'
import { SessionStore } from '../core/session.js'
import { WebConnector } from '../connectors/web/web-connector.js'
import { readWebSubchannels } from '../core/config.js'
import { createChatRoutes, createMediaRoutes, type SSEClient } from './routes/chat.js'
import { createChannelsRoutes } from './routes/channels.js'
import { createConfigRoutes, createMarketDataRoutes } from './routes/config.js'
import { createEventsRoutes } from './routes/events.js'
import { createTopologyRoutes } from './routes/topology.js'
import { createCronRoutes } from './routes/cron.js'
import { createHeartbeatRoutes } from './routes/heartbeat.js'
import { createTradingRoutes } from './routes/trading.js'
import { createTradingConfigRoutes } from './routes/trading-config.js'
import { createDevRoutes } from './routes/dev.js'
import { createSimulatorRoutes } from './routes/simulator.js'
import { createToolsRoutes } from './routes/tools.js'
import { createAgentStatusRoutes } from './routes/agent-status.js'
import { createPersonaRoutes } from './routes/persona.js'
import { createNewsRoutes } from './routes/news.js'
import { createMarketRoutes } from './routes/market.js'
import { createNotificationsRoutes } from './routes/notifications.js'
import { createVersionRoutes } from './routes/version.js'
import { mountOpenTypeBB } from '../server/opentypebb.js'
import { buildSDKCredentials } from '../domain/market-data/credential-map.js'
import { createWorkspaceService, type WorkspaceService } from '../workspaces/service.js'
import { createWorkspaceRoutes } from './routes/workspaces.js'
import { attachWorkspacesWS, type AttachedWS } from './workspaces-ws.js'
import type { Server as HttpServer } from 'node:http'

export interface WebConfig {
  port: number
}

export class WebPlugin implements Plugin {
  name = 'webui'
  private server: ReturnType<typeof serve> | null = null
  /** SSE clients grouped by channel ID. Default channel: 'default'. */
  private sseByChannel = new Map<string, Map<string, SSEClient>>()
  private unregisterConnector?: () => void
  private ingestProducer?: ProducerHandle<readonly ['agent.work.requested']>
  private workspaceService: WorkspaceService | null = null
  private workspacesWs: AttachedWS | null = null

  constructor(private config: WebConfig) {}

  async start(ctx: EngineContext) {
    // Load sub-channel definitions
    const subChannels = await readWebSubchannels()

    // Initialize sessions for the default channel and all sub-channels
    const sessions = new Map<string, SessionStore>()

    const defaultSession = new SessionStore('web/default')
    await defaultSession.restore()
    sessions.set('default', defaultSession)

    for (const ch of subChannels) {
      const session = new SessionStore(`web/${ch.id}`)
      await session.restore()
      sessions.set(ch.id, session)
    }

    // Initialize SSE map for known channels (entries are created lazily too)
    this.sseByChannel.set('default', new Map())
    for (const ch of subChannels) {
      this.sseByChannel.set(ch.id, new Map())
    }

    const app = new Hono()

    app.onError((err: Error, c: Context) => {
      if (err instanceof SyntaxError) {
        return c.json({ error: 'Invalid JSON' }, 400)
      }
      console.error('web: unhandled error:', err)
      return c.json({ error: err.message }, 500)
    })

    app.use('/api/*', cors())

    // ==================== Producers ====================
    // Chat message.received/sent events go through ConnectorCenter's shared
    // `connectors` producer — see `ctx.connectorCenter.emitMessage*`.
    //
    // webhook-ingest: POST /api/events/ingest — enumerates its concrete emits so
    // each external type shows up on the Flow graph as a real injection edge.
    // Extend this tuple when adding new `external: true` event types.
    this.ingestProducer = ctx.listenerRegistry.declareProducer({
      name: 'webhook-ingest',
      emits: ['agent.work.requested'] as const,
    })

    // ==================== Mount route modules ====================
    app.route('/api/chat', createChatRoutes({ ctx, sessions, sseByChannel: this.sseByChannel }))
    app.route('/api/channels', createChannelsRoutes({ sessions, sseByChannel: this.sseByChannel }))
    app.route('/api/media', createMediaRoutes())
    app.route('/api/config', createConfigRoutes({
      ctx,
      onConnectorsChange: async () => { await ctx.reconnectConnectors() },
    }))
    app.route('/api/market-data', createMarketDataRoutes(ctx))
    app.route('/api/events', createEventsRoutes({ ctx, ingestProducer: this.ingestProducer }))
    app.route('/api/topology', createTopologyRoutes(ctx))
    app.route('/api/cron', createCronRoutes(ctx))
    app.route('/api/heartbeat', createHeartbeatRoutes(ctx))
    app.route('/api/trading/config', createTradingConfigRoutes(ctx))
    app.route('/api/trading', createTradingRoutes(ctx))
    app.route('/api/dev', createDevRoutes(ctx.connectorCenter))
    app.route('/api/simulator', createSimulatorRoutes(ctx))
    app.route('/api/tools', createToolsRoutes(ctx.toolCenter))
    app.route('/api/agent-status', createAgentStatusRoutes(ctx))
    app.route('/api/news', createNewsRoutes(ctx))
    app.route('/api/market', createMarketRoutes(ctx))
    app.route('/api/persona', createPersonaRoutes())
    app.route('/api/notifications', createNotificationsRoutes({
      notificationsStore: ctx.notificationsStore,
    }))
    app.route('/api/version', createVersionRoutes())

    // ==================== Workspaces (launcher-style PTY) ====================
    // Self-contained subsystem ported from auto-quant-launcher. Owns its own
    // state under ~/.openalice/workspaces/ and its own /api/workspaces/pty WS.
    this.workspaceService = await createWorkspaceService()
    app.route('/api/workspaces', createWorkspaceRoutes(this.workspaceService))

    // ==================== Mount opentypebb (market data HTTP) ====================
    // opentypebb is Alice's first-class market-data package; its router is
    // merged into this app so UI and external consumers hit a single port.
    mountOpenTypeBB(app, ctx.bbEngine, {
      basePath: '/api/market-data-v1',
      // Read config lazily so UI edits to marketData.providerKeys /
      // marketData.providers take effect on the next request — no remount
      // needed. Requires the config-write route to refresh ctx.config.
      defaultCredentials: () => buildSDKCredentials(ctx.config.marketData.providerKeys),
      defaultProviders: () => ctx.config.marketData.providers,
    })

    // ==================== Serve UI (Vite build output) ====================
    const uiRoot = resolve('dist/ui')
    app.use('/*', serveStatic({ root: uiRoot }))
    app.get('*', serveStatic({ root: uiRoot, path: 'index.html' }))

    // ==================== Connector registration ====================
    // WebConnector exists primarily so `lastInteraction` tracking
    // identifies 'web' as the active surface. Notifications themselves
    // are pulled by the UI via 20s polling against /api/notifications/history
    // — no in-process push wire is needed for the web surface.
    this.unregisterConnector = ctx.connectorCenter.register(new WebConnector())

    // ==================== Start server ====================
    this.server = serve({ fetch: app.fetch, port: this.config.port }, (info: { port: number }) => {
      console.log(`web plugin listening on http://localhost:${info.port}`)
    })

    // Attach WS upgrade handler for /api/workspaces/pty onto the same http.Server.
    if (this.workspaceService) {
      this.workspacesWs = attachWorkspacesWS(this.server as HttpServer, this.workspaceService)
    }
  }

  async stop() {
    this.sseByChannel.clear()
    this.unregisterConnector?.()
    this.ingestProducer?.dispose()
    this.ingestProducer = undefined
    this.workspacesWs?.dispose()
    this.workspacesWs = null
    if (this.workspaceService) {
      await this.workspaceService.dispose('plugin stop')
      this.workspaceService = null
    }
    this.server?.close()
  }
}
