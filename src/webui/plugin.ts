import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { createAdaptorServer, serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { rm } from 'node:fs/promises'
import { uiBundlePath } from '@/core/paths.js'
import type { Plugin, EngineContext } from '../core/types.js'
import type { ProducerHandle } from '../core/producer.js'
import { SessionStore } from '../core/session.js'
import { readWebSubchannels } from '../core/config.js'
import { createMediaRoutes } from './routes/media.js'
import { createChannelsRoutes, type SSEClient } from './routes/channels.js'
import { createConfigRoutes, createMarketDataRoutes } from './routes/config.js'
import { createEventsRoutes } from './routes/events.js'
import { createTopologyRoutes } from './routes/topology.js'
import { createScheduleRoutes } from './routes/schedule.js'
import { createIssuesRoutes } from './routes/issues.js'
import { createTradingProxyRoutes } from './routes/trading-proxy.js'
import { createTradingConfigRoutes } from './routes/trading-config.js'
import { createToolsRoutes } from './routes/tools.js'
import { createAgentStatusRoutes } from './routes/agent-status.js'
import { createPersonaRoutes } from './routes/persona.js'
import { createNewsRoutes } from './routes/news.js'
import { createMarketRoutes } from './routes/market.js'
import { createBarsRoutes } from './routes/bars.js'
import { createReferenceRoutes } from './routes/reference.js'
import { createInboxRoutes } from './routes/inbox.js'
import { createEntityRoutes } from './routes/entities.js'
import { createWikilinkRoutes } from './routes/wikilink.js'
import { createVersionRoutes } from './routes/version.js'
import { createAuthRoutes } from './routes/auth.js'
import { createPreferencesRoutes } from './routes/preferences.js'
import { createAuthMiddleware } from './middleware/auth.js'
import { mountOpenTypeBB } from '../server/opentypebb.js'
import { buildSDKCredentials } from '../domain/market-data/credential-map.js'
import { resolveUTAUrl } from '../services/uta-supervisor/url.js'
import { createWorkspaceService, type WorkspaceService } from '../workspaces/service.js'

/** Cross-plugin hand-off for WorkspaceService. WebPlugin creates it
 *  inside `start()`; McpPlugin needs it earlier for the `/mcp/:wsId`
 *  route lookup. A small ref-box lets the late creator publish without
 *  changing either plugin's constructor signature. */
export interface WorkspaceServiceRef {
  current: WorkspaceService | null
}

export function createWorkspaceServiceRef(): WorkspaceServiceRef {
  return { current: null }
}
import { createWorkspaceRoutes } from './routes/workspaces.js'
import { createHeadlessRoutes } from './routes/headless.js'
import { attachWorkspacesWS, type AttachedWS } from './workspaces-ws.js'
import { attachWorkspacesIpc, type AttachedWorkspaceIpc } from './workspaces-ipc.js'
import { attachWebIpc, type AttachedWebIpc } from './web-ipc.js'
import { mountLocalToolGateway } from '../server/local-tool-gateway.js'
import type { Server as HttpServer } from 'node:http'

export interface WebConfig {
  /** Effective web port (env-overridden if guardian injected, else from config file). */
  port: number
  /** Effective MCP/local-tool port retained for legacy logs and config. */
  mcpPort: number
  /** Base URL used by workspace `alice*` CLI shims. */
  toolBaseUrl: string
  /** Optional MCP protocol URL. Absent when the MCP server is disabled. */
  mcpBaseUrl?: string
  /** Mount unauthenticated /cli on this web listener. Safe only on loopback. */
  localCliOnWeb?: boolean
  /** Start the TCP HTTP listener. Electron app mode sets this false. */
  listen?: boolean
  /** Optional Unix socket / named pipe for workspace CLI shims in app mode. */
  cliSocketPath?: string
}

export class WebPlugin implements Plugin {
  name = 'webui'
  private server: ReturnType<typeof serve> | null = null
  /** SSE clients grouped by channel ID. Default channel: 'default'. */
  private sseByChannel = new Map<string, Map<string, SSEClient>>()
  private ingestProducer?: ProducerHandle<readonly ['agent.work.requested']>
  private workspaceService: WorkspaceService | null = null
  private workspacesWs: AttachedWS | null = null
  private workspacesIpc: AttachedWorkspaceIpc | null = null
  private webIpc: AttachedWebIpc | null = null
  private cliSocketServer: HttpServer | null = null

  constructor(
    private config: WebConfig,
    /** Optional cross-plugin ref that gets populated when the workspace
     *  service finishes starting. McpPlugin reads through this to find
     *  workspaces for the `/mcp/:wsId` route. Omitted in legacy callers
     *  / tests; ignored when null. */
    private workspaceServiceRef?: WorkspaceServiceRef,
  ) {}

  async start(ctx: EngineContext) {
    // ==================== Auth bootstrap ====================
    // Generate the admin token on first run; subsequent boots no-op.
    // We do this BEFORE any route mounts so the public-mode safety
    // check below has a meaningful auth-file state to read.
    const { bootstrapToken, getTokenInfo } = await import('@/services/auth/index.js')
    await bootstrapToken({
      onFirstGeneration: (token) => {
        console.log('')
        console.log('═══════════════════════════════════════════════════════════════')
        console.log('  First-run admin token (save this — won\'t be shown again):')
        console.log('')
        console.log(`      ${token}`)
        console.log('')
        console.log('  To rotate: delete data/config/auth.json and restart.')
        console.log('═══════════════════════════════════════════════════════════════')
        console.log('')
      },
    })

    // ==================== Public-mode safety net ====================
    // Refuse to start if Alice is bound to a non-localhost interface
    // without an admin token configured. Prevents the "I set
    // OPENALICE_BIND_HOST=0.0.0.0 for testing and forgot auth" footgun.
    const bindHost = (process.env['OPENALICE_BIND_HOST'] ?? '127.0.0.1').trim()
    const bindIsPublic = bindHost !== '127.0.0.1' && bindHost !== '::1' && bindHost !== 'localhost'
    if (bindIsPublic) {
      const tokenInfo = await getTokenInfo()
      if (!tokenInfo.exists && process.env['OPENALICE_DISABLE_AUTH'] !== '1') {
        throw new Error(
          `Refusing to start: OPENALICE_BIND_HOST="${bindHost}" exposes Alice ` +
          `to non-localhost callers, but no admin token has been provisioned. ` +
          `Start once with OPENALICE_BIND_HOST=127.0.0.1 to generate the token, ` +
          `then re-set the bind. Set OPENALICE_DISABLE_AUTH=1 only when you ` +
          `understand the implication (no protection at the Alice boundary).`
        )
      }
    }

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

    if (this.config.localCliOnWeb) {
      if (bindIsPublic) {
        throw new Error('Refusing to mount unauthenticated /cli on a non-loopback web listener')
      }
      // Electron/dev can reuse the loopback web listener for workspace CLI
      // shims, eliminating the old default MCP/CLI side port. Docker/public-web
      // keeps this off and uses a separate loopback-only local tool gateway.
      mountLocalToolGateway(app, {
        toolCenter: ctx.toolCenter,
        workspaceToolCenter: ctx.workspaceToolCenter,
        inboxStore: ctx.inboxStore,
        entityStore: ctx.entityStore,
        getWorkspaceService: () => this.workspaceServiceRef?.current ?? this.workspaceService,
      })
    }

    // ==================== Auth gate ====================
    //
    // The gate sits between CORS and every normal route mount. When enabled,
    // local `/cli` is mounted above this gate only on a loopback listener; all
    // public web surfaces stay below the auth middleware.
    // Public surface (/api/auth/*, /api/version, /login, static assets, /mcp) is
    // allowlisted inside the middleware itself. Localhost requests
    // bypass when no trusted proxy is configured — preserving the
    // zero-friction dev UX. See safe/playbooks/{01,02,03}-*.md for the
    // testable contract.
    const trustedProxies = (process.env['OPENALICE_TRUSTED_PROXIES'] ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean)
    const csrfTrustedOrigins = (process.env['OPENALICE_CSRF_TRUSTED_ORIGINS'] ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean)
    const authDisabled = process.env['OPENALICE_DISABLE_AUTH'] === '1'
    app.route('/api/auth', createAuthRoutes({ trustedProxies }))
    app.use('*', createAuthMiddleware({
      trustedProxies,
      csrfTrustedOrigins,
      disabled: authDisabled,
    }))

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
    // /api/channels is the last surviving piece of the legacy web-chat
    // stack — kept (vestigial) only because the surviving TabStrip reads
    // channel titles. Slated for end-to-end removal (tracked in Linear).
    app.route('/api/channels', createChannelsRoutes({ sessions, sseByChannel: this.sseByChannel }))
    app.route('/api/media', createMediaRoutes())
    app.route('/api/config', createConfigRoutes({ ctx }))
    app.route('/api/preferences', createPreferencesRoutes())
    app.route('/api/market-data', createMarketDataRoutes(ctx))
    app.route('/api/events', createEventsRoutes({ ctx, ingestProducer: this.ingestProducer }))
    app.route('/api/topology', createTopologyRoutes(ctx))
    app.route('/api/trading/config', createTradingConfigRoutes(ctx))
    // `/api/trading/*` and `/api/simulator/*` are proxied to the UTA carrier.
    // UTA is optional, so the proxy owns the unavailable response instead of
    // making WebPlugin startup fail.
    const utaProxy = createTradingProxyRoutes({
      utaBaseUrl: resolveUTAUrl(),
      getPolicy: ctx.tradingModePolicy,
    })
    app.route('/api/trading', utaProxy)
    app.route('/api/simulator', createTradingProxyRoutes({
      utaBaseUrl: resolveUTAUrl(),
      getPolicy: ctx.tradingModePolicy,
    }))
    app.route('/api/tools', createToolsRoutes(ctx.toolCenter))
    app.route('/api/agent-status', createAgentStatusRoutes(ctx))
    app.route('/api/news', createNewsRoutes(ctx))
    app.route('/api/market', createMarketRoutes(ctx))
    app.route('/api/bars', createBarsRoutes(ctx))
    app.route('/api/reference', createReferenceRoutes(ctx))
    app.route('/api/persona', createPersonaRoutes())
    app.route('/api/inbox', createInboxRoutes({ inboxStore: ctx.inboxStore }))
    app.route('/api/version', createVersionRoutes())

    // ==================== Workspaces (launcher-style PTY) ====================
    // Self-contained subsystem ported from auto-quant-launcher. Owns its own
    // state under ~/.openalice/workspaces/ and its own /api/workspaces/pty WS.
    this.workspaceService = await createWorkspaceService({
      webPort: this.config.port,
      mcpPort: this.config.mcpPort,
      toolBaseUrl: this.config.toolBaseUrl,
      ...(this.config.cliSocketPath ? { toolSocketPath: this.config.cliSocketPath } : {}),
      mcpBaseUrl: this.config.mcpBaseUrl,
      inboxStore: ctx.inboxStore,
    })
    this.workspacesIpc = attachWorkspacesIpc(this.workspaceService)
    if (this.workspaceServiceRef) this.workspaceServiceRef.current = this.workspaceService
    app.route('/api/workspaces', createWorkspaceRoutes(this.workspaceService))
    app.route('/api/headless', createHeadlessRoutes(this.workspaceService))
    app.route('/api/schedule', createScheduleRoutes(this.workspaceService))
    app.route('/api/issues', createIssuesRoutes(this.workspaceService))
    // Tracked entities — read surface for the Tracked tab. Mounted here (not
    // with the other /api/* routes above) because backlink scanning needs the
    // workspace registry, which only exists once workspaceService is created.
    app.route(
      '/api/entities',
      createEntityRoutes({ entityStore: ctx.entityStore, registry: this.workspaceService.registry }),
    )
    // Cross-namespace [[name]] resolver — entities (global store) + issues (per-
    // workspace scan) in one lookup so the UI can navigate or disambiguate a
    // clicked wikilink. Same dep shape rationale as /api/entities above.
    app.route(
      '/api/wikilink',
      createWikilinkRoutes({ entityStore: ctx.entityStore, service: this.workspaceService }),
    )

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
    // UI bundle lives in `ui/dist/` (the UI package's own dist), not
    // `dist/ui/` — see ui/vite.config.ts for why (history: UI was added
    // after engine-only era and got an awkward `../dist/ui` outDir; now
    // that UI is first-class, the output lives in its own package).
    const uiRoot = uiBundlePath()
    app.use('/*', serveStatic({ root: uiRoot }))
    app.get('*', serveStatic({ root: uiRoot, path: 'index.html' }))

    this.webIpc = attachWebIpc(app)

    if (this.config.cliSocketPath) {
      if (process.platform !== 'win32') await rm(this.config.cliSocketPath, { force: true })
      const server = createAdaptorServer({ fetch: (request, env) => app.fetch(request, env) }) as HttpServer
      await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (err: Error) => {
          server.off('listening', onListening)
          rejectListen(err)
        }
        const onListening = () => {
          server.off('error', onError)
          resolveListen()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(this.config.cliSocketPath)
      })
      this.cliSocketServer = server
      console.log(`local tool gateway listening on ${this.config.cliSocketPath}`)
    }

    if (this.config.listen === false) {
      console.log('web plugin listening over Electron IPC')
      return
    }

    // ==================== Start server ====================
    // Default hostname is 127.0.0.1 — public-internet exposure requires
    // explicit `OPENALICE_BIND_HOST=0.0.0.0` (gated by the safety check
    // above + the auth middleware on every route).
    const hostname = (process.env['OPENALICE_BIND_HOST'] ?? '127.0.0.1').trim()
    this.server = serve({ fetch: app.fetch, port: this.config.port, hostname }, (info: { port: number }) => {
      console.log(`web plugin listening on http://${hostname}:${info.port}`)
    })

    // Attach WS upgrade handler for /api/workspaces/pty onto the same http.Server.
    if (this.workspaceService) {
      this.workspacesWs = attachWorkspacesWS(this.server as HttpServer, this.workspaceService)
    }
  }

  async stop() {
    this.sseByChannel.clear()
    this.ingestProducer?.dispose()
    this.ingestProducer = undefined
    this.webIpc?.dispose()
    this.webIpc = null
    this.cliSocketServer?.close()
    this.cliSocketServer = null
    this.workspacesIpc?.dispose()
    this.workspacesIpc = null
    this.workspacesWs?.dispose()
    this.workspacesWs = null
    if (this.workspaceService) {
      await this.workspaceService.dispose('plugin stop')
      this.workspaceService = null
      if (this.workspaceServiceRef) this.workspaceServiceRef.current = null
    }
    this.server?.close()
  }
}
