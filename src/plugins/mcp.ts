import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Tool } from 'ai'
import type { Plugin, EngineContext } from '../core/types.js'
import type { ToolCenter } from '../core/tool-center.js'

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/**
 * Convert a tool result to MCP content blocks.
 *
 * If the result has a `.content` array (OpenClaw AgentToolResult format),
 * map each item to native MCP text/image blocks. This avoids stringify-ing
 * base64 image data into a giant JSON text blob.
 *
 * Otherwise, fall back to JSON.stringify as before.
 */
function toMcpContent(result: unknown): McpContent[] {
  if (
    result != null &&
    typeof result === 'object' &&
    'content' in result &&
    Array.isArray((result as { content: unknown }).content)
  ) {
    const items = (result as { content: Array<Record<string, unknown>> }).content
    const blocks: McpContent[] = []
    for (const item of items) {
      if (item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string') {
        blocks.push({ type: 'image', data: item.data, mimeType: item.mimeType })
      } else if (item.type === 'text' && typeof item.text === 'string') {
        blocks.push({ type: 'text', text: item.text })
      } else {
        blocks.push({ type: 'text', text: JSON.stringify(item) })
      }
    }
    // Also include details as text if present
    if ('details' in result && (result as { details: unknown }).details != null) {
      blocks.push({ type: 'text', text: JSON.stringify((result as { details: unknown }).details) })
    }
    return blocks.length > 0 ? blocks : [{ type: 'text', text: JSON.stringify(result) }]
  }
  return [{ type: 'text', text: JSON.stringify(result) }]
}

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

        // Extract raw shape from z.object() for MCP's inputSchema
        const shape = (t.inputSchema as any)?.shape ?? {}

        mcp.registerTool(name, {
          description: t.description,
          inputSchema: shape,
        }, async (args: any) => {
          try {
            const result = await t.execute!(args, {
              toolCallId: crypto.randomUUID(),
              messages: [],
            })
            return { content: toMcpContent(result) }
          } catch (err) {
            return {
              content: [{ type: 'text' as const, text: `Error: ${err}` }],
              isError: true,
            }
          }
        })
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
