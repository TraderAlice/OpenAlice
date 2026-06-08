import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Plugin, EngineContext } from '../core/types.js'
import type { ToolCenter } from '../core/tool-center.js'
import type { WorkspaceToolCenter } from '../core/workspace-tool-center.js'
import type { IInboxStore } from '../core/inbox-store.js'
import type { IEntityStore } from '../core/entity-store.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { extractMcpShape, wrapToolExecute } from '../core/mcp-export.js'
import { registerCliRoutes } from './cli.js'

/**
 * MCP Plugin — exposes OpenAlice tools via Streamable HTTP, plus the CLI gateway.
 *
 *   GET/POST /mcp           Workspace-independent surface (ToolCenter).
 *                           Trading / market / news / brain / etc. — what
 *                           OpenAlice provides to any MCP client. No
 *                           identity required.
 *
 *   GET/POST /mcp/:wsId     Workspace-scoped surface (WorkspaceToolCenter).
 *                           inbox_push + entity_upsert / entity_search; tools
 *                           that need workspaceId close over it via the factory
 *                           pattern. The URL path IS the identity carrier —
 *                           agent never sees or supplies workspaceId, and
 *                           bootstrap.sh bakes the per-workspace URL into
 *                           the workspace's own .mcp.json.
 *
 *   GET  /cli/:wsId/:export/manifest   Same open posture, same identity-by-URL
 *   POST /cli/:wsId/:export/invoke     trick — the gateway for the workspace-local
 *                              `alice*` CLIs (`:export` = data | workspace; see
 *                              ./cli.ts). Reuses this server's open port so the
 *                              shim needs no token.
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
    const createWorkspaceMcpServer = (wsId: string, wsLabel: string) => {
      const tools = workspaceToolCenter.build({
        workspaceId: wsId,
        workspaceLabel: wsLabel,
        inboxStore,
        entityStore,
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
      allowHeaders: ['Content-Type', 'mcp-session-id', 'Last-Event-ID', 'mcp-protocol-version'],
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

      const transport = new WebStandardStreamableHTTPServerTransport()
      const mcp = createWorkspaceMcpServer(meta.id, meta.tag)
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

    this.server = serve({ fetch: app.fetch, port: this.port }, (info) => {
      console.log(`mcp plugin listening on http://localhost:${info.port}/mcp (+ /mcp/:wsId)`)
    })
  }

  async stop() {
    this.server?.close()
  }
}
