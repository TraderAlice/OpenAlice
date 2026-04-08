import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'node:crypto'
import { serve } from '@hono/node-server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Plugin, EngineContext } from '../core/types.js'
import type { ToolCenter } from '../core/tool-center.js'
import { extractMcpShape, wrapToolExecute } from '../core/mcp-export.js'
import { readSecurityConfig } from '../core/config.js'

/**
 * MCP Plugin — exposes tools via Streamable HTTP.
 *
 * Holds a reference to ToolCenter and queries it per-request, so tool
 * changes (reconnect, disable/enable) are picked up automatically.
 */
export class McpPlugin implements Plugin {
  name = 'mcp'
  private server: ReturnType<typeof serve> | null = null

  constructor(
    private toolCenter: ToolCenter,
    private port: number,
  ) {}

  async start(_ctx: EngineContext) {
    const toolCenter = this.toolCenter

    const createMcpServer = async () => {
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

    const app = new Hono()

    // Auth middleware — require bearer token if configured
    app.use('*', createMiddleware(async (c, next) => {
      const { apiToken } = await readSecurityConfig()
      if (!apiToken) return next()

      const authHeader = c.req.header('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
      const provided = authHeader.slice(7)
      const aBuf = Buffer.from(provided)
      const bBuf = Buffer.from(apiToken)
      if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
      return next()
    }))

    const securityConfig = await readSecurityConfig()
    const corsOrigins = securityConfig.corsOrigins ?? [
      `http://localhost:${this.port}`,
      `http://127.0.0.1:${this.port}`,
    ]

    app.use('*', cors({
      origin: corsOrigins,
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'Last-Event-ID', 'mcp-protocol-version'],
      exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'],
    }))

    app.all('/mcp', async (c) => {
      const transport = new WebStandardStreamableHTTPServerTransport()
      const mcp = await createMcpServer()
      await mcp.connect(transport)
      return transport.handleRequest(c.req.raw)
    })

    this.server = serve({ fetch: app.fetch, port: this.port }, (info) => {
      console.log(`mcp plugin listening on http://localhost:${info.port}/mcp`)
    })
  }

  async stop() {
    this.server?.close()
  }
}
