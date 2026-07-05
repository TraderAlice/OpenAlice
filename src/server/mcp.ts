import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Plugin, EngineContext } from '../core/types.js'
import type { ToolCenter } from '../core/tool-center.js'
import { type WorkspaceToolCenter, makeWorkspaceResolver } from '../core/workspace-tool-center.js'
import type { IInboxStore } from '../core/inbox-store.js'
import type { IEntityStore } from '../core/entity-store.js'
import type { WorkspaceService } from '../workspaces/service.js'
import type { InboxOrigin } from '../core/inbox-store.js'
import { extractMcpShape, wrapToolExecute } from '../core/mcp-export.js'
import { registerCliRoutes } from './cli.js'
import { resolveInboxOrigin } from './inbox-origin.js'

/**
 * MCP Plugin — exposes OpenAlice tools via Streamable HTTP, plus the CLI gateway.
 *
 *   GET/POST /mcp           Workspace-independent surface (ToolCenter).
 *                           Trading / market / news / brain / etc. — what
 *                           OpenAlice provides to any MCP client. No
 *                           identity required.
 *
 *   GET/POST /mcp/:wsId     Workspace-scoped surface (WorkspaceToolCenter).
 *                           inbox_push / inbox_read + workspace_path +
 *                           entity_upsert / entity_search; tools
 *                           that need workspaceId close over it via the factory
 *                           pattern. The URL path IS the identity carrier —
 *                           agent never sees or supplies workspaceId, and
 *                           bootstrap.sh bakes the per-workspace URL into
 *                           the workspace's own .mcp.json.
 *
 *   GET  /cli/:wsId/:export/manifest   Same identity-by-URL trick — the gateway
 *   POST /cli/:wsId/:export/invoke     for the workspace-local CLIs (alice*, traderhub)
 *                              (`:export` = data | workspace; see ./cli.ts).
 *                              Reuses this server's port so the shim needs no
 *                              token.
 *
 * SECURITY POSTURE: this whole listener is UNAUTHENTICATED and binds
 * 127.0.0.1 only (see the serve() call). The tool surface includes trading;
 * its protection is the loopback boundary — every consumer (agent CLIs, the
 * `alice*` shims) is a local workspace subprocess. There is no auth layer
 * because there is intentionally no remote caller; the wsId in the path is
 * routing, not a secret. Remote/multi-user access belongs to the web port,
 * which gates on the admin token. Do NOT make this honor OPENALICE_BIND_HOST.
 *
 * Holds references to both registries and the WorkspaceService (for wsId
 * registry lookup). Tools are rebuilt per-request so disable/enable +
 * factory closure over wsId both work without restart.
 */
export class McpPlugin implements Plugin {
  name = 'mcp'
  private server: ReturnType<typeof serve> | null = null

  constructor(
    private toolCenter: ToolCenter,
    private port: number,
    private workspaceToolCenter: WorkspaceToolCenter,
    private inboxStore: IInboxStore,
    private entityStore: IEntityStore,
    /** Lazy because WorkspaceService is created later (deferred during web
     *  plugin start); McpPlugin starts earlier. Resolved at request time. */
    private getWorkspaceService: () => WorkspaceService | null,
  ) {}

  async start(_ctx: EngineContext) {
    const toolCenter = this.toolCenter
    const workspaceToolCenter = this.workspaceToolCenter
    const inboxStore = this.inboxStore
    const entityStore = this.entityStore
    const getWorkspaceService = this.getWorkspaceService

    /** Build a per-request McpServer with the global ToolCenter catalog. */
    const createGlobalMcpServer = async () => {
      const tools = await toolCenter.getMcpTools()
      const mcp = new McpServer({ name: 'open-alice', version: '1.0.0' })
      for (const [name, t] of Object.entries(tools)) {
        if (!t.execute) continue
        mcp.registerTool(name, {
          description: t.description,
          inputSchema: extractMcpShape(t),
        }, wrapToolExecute(t))
      }
      return mcp
    }

    /** Build a per-request McpServer scoped to a specific workspace.
     *  Each WorkspaceToolFactory is invoked with the URL's wsId so its
     *  tools' execute() closes over that identity. */
    const createWorkspaceMcpServer = (wsId: string, wsLabel: string, origin?: InboxOrigin) => {
      // GLOBAL issue-board reader, backed by the live WorkspaceService — parity
      // with the CLI gateway so issue_list / issue_show read EVERY workspace's
      // issues here too. Absent when the service isn't up → tools self-read.
      const svc = getWorkspaceService()
      const tools = workspaceToolCenter.build({
        workspaceId: wsId,
        workspaceLabel: wsLabel,
        inboxStore,
        entityStore,
        // Parity with the CLI gateway so external MCP consumers get the same
        // workspace_path resolution — shared helper, so the two can't drift.
        resolveWorkspace: makeWorkspaceResolver(getWorkspaceService),
        ...(svc
          ? {
              board: {
                snapshot: () => svc.issuesSnapshot(),
                detail: (w: string, i: string) => svc.issueDetail(w, i),
                resolveByName: (n: string) => svc.resolveIssuesByName(n),
              },
            }
          : {}),
        // Agent-invisible run provenance from the out-of-band header (resolved
        // server-side from the authoritative registry). Absent → undefined.
        ...(origin ? { origin } : {}),
      })
      const mcp = new McpServer({ name: 'open-alice-workspace', version: '1.0.0' })
      for (const [name, t] of Object.entries(tools)) {
        if (!t.execute) continue
        mcp.registerTool(name, {
          description: t.description,
          inputSchema: extractMcpShape(t),
        }, wrapToolExecute(t))
      }
      return mcp
    }

    const app = new Hono()

    app.use('*', cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'mcp-session-id', 'Last-Event-ID', 'mcp-protocol-version', 'x-openalice-run', 'x-openalice-session'],
      exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'],
    }))

    app.all('/mcp', async (c) => {
      const transport = new WebStandardStreamableHTTPServerTransport()
      const mcp = await createGlobalMcpServer()
      await mcp.connect(transport)
      return transport.handleRequest(c.req.raw)
    })

    app.all('/mcp/:wsId', async (c) => {
      const wsId = c.req.param('wsId')
      const svc = getWorkspaceService()
      if (!svc) {
        // Workspace subsystem hasn't started yet — reject loudly rather
        // than serving an empty catalog.
        return c.text('workspace service unavailable', 503)
      }
      const meta = svc.registry.get(wsId)
      if (!meta) return c.text('unknown workspace', 404)

      // Out-of-band identity (agent never sees it): the spawn-injected AQ_RUN_ID
      // (headless) / AQ_SESSION_ID (interactive) rides these mutually-exclusive
      // headers, resolved server-side to an authoritative origin and baked into
      // the tools. The session header is validated against THIS workspace's
      // session registry.
      const origin = resolveInboxOrigin(
        {
          run: c.req.header('x-openalice-run'),
          session: c.req.header('x-openalice-session'),
          wsId: meta.id,
        },
        getWorkspaceService,
      )

      const transport = new WebStandardStreamableHTTPServerTransport()
      const mcp = createWorkspaceMcpServer(meta.id, meta.tag, origin)
      await mcp.connect(transport)
      return transport.handleRequest(c.req.raw)
    })

    // CLI gateway — same app, same open port, same identity-by-URL trick.
    registerCliRoutes(app, {
      toolCenter,
      workspaceToolCenter,
      inboxStore,
      entityStore,
      getWorkspaceService,
    })

    // LOOPBACK-ONLY, ALWAYS — deliberately NOT honoring OPENALICE_BIND_HOST.
    // This listener carries the full tool surface (trading included) and the
    // CLI gateway with NO authentication: its security model is "only local
    // processes can reach it". Its sole consumers are workspace subprocesses
    // (native agent CLIs + the CLI shims), which run on the same host
    // and always dial 127.0.0.1 — so there is no legitimate remote caller to
    // serve. Remote access is the web port's job (47331), which gates on the
    // admin token. Without an explicit hostname @hono/node-server binds the
    // wildcard address, which exposed this surface to the LAN; pinning
    // loopback closes that structurally rather than via an auth layer the
    // zero-config CLI injection can't carry. In Docker, OPENALICE_BIND_HOST
    // =0.0.0.0 still applies to the web plugin; MCP stays on container-local
    // loopback and is reached by in-container workspaces — only 47331 is
    // published, so nothing external could reach MCP regardless.
    this.server = serve({ fetch: app.fetch, port: this.port, hostname: '127.0.0.1' }, (info) => {
      console.log(`mcp plugin listening on http://127.0.0.1:${info.port}/mcp (+ /mcp/:wsId, /cli)`)
    })
  }

  async stop() {
    this.server?.close()
  }
}
