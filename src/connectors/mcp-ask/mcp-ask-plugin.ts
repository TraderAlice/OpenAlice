/**
 * MCP Ask Connector
 *
 * Exposes Alice's conversation ability via a standalone MCP server on a
 * dedicated port. External agents (e.g. OpenClaw) call `askWithSession`
 * to talk to Alice as an agent — not to use her tools directly.
 *
 * Deliberately separated from the main MCP server (which exposes internal
 * tools) to prevent circular calls: Alice's own AI provider never sees
 * these tools because they are not registered in ToolCenter.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { glob } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type { Plugin, EngineContext } from '../../core/types.js'
import { SessionStore, toTextHistory } from '../../core/session.js'
import { registerConnector, touchInteraction } from '../../core/connector-registry.js'

export interface McpAskConfig {
  port: number
}

const SESSION_PREFIX = 'mcp-ask'

export class McpAskPlugin implements Plugin {
  name = 'mcp-ask'
  private server: ReturnType<typeof serve> | null = null
  private sessions = new Map<string, SessionStore>()
  private unregisterConnector?: () => void

  constructor(private config: McpAskConfig) {}

  private async getSession(sessionId: string): Promise<SessionStore> {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = new SessionStore(`${SESSION_PREFIX}__${sessionId}`)
      await session.restore()
      this.sessions.set(sessionId, session)
    }
    return session
  }

  async start(ctx: EngineContext) {
    const plugin = this

    const createMcpServer = () => {
      const mcp = new McpServer({ name: 'open-alice-ask', version: '1.0.0' })

      // ── askWithSession ──
      mcp.tool(
        'askWithSession',
        'Send a message to Alice and get a response within a persistent session.',
        { message: z.string().describe('The message to send to Alice'), sessionId: z.string().describe('Session identifier (caller-managed)') },
        async ({ message, sessionId }) => {
          const session = await plugin.getSession(sessionId)
          touchInteraction('mcp-ask', sessionId)

          const result = await ctx.engine.askWithSession(message, session, {
            historyPreamble: 'The following is the conversation from an external MCP client. Use it as context if the caller references earlier messages.',
          })

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ text: result.text, sessionId }) }],
          }
        },
      )

      // ── listSessions ──
      mcp.tool(
        'listSessions',
        'List all mcp-ask sessions.',
        {},
        async () => {
          const sessionsDir = join(process.cwd(), 'data', 'sessions')
          const sessions: Array<{ sessionId: string }> = []
          try {
            for await (const entry of glob(`${SESSION_PREFIX}__*.jsonl`, { cwd: sessionsDir })) {
              const name = basename(entry, '.jsonl')
              const sessionId = name.slice(`${SESSION_PREFIX}__`.length)
              if (sessionId) sessions.push({ sessionId })
            }
          } catch { /* no sessions dir yet */ }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ sessions }) }],
          }
        },
      )

      // ── getSessionHistory ──
      mcp.tool(
        'getSessionHistory',
        'Read conversation history for a session.',
        { sessionId: z.string().describe('Session identifier'), limit: z.number().int().positive().default(50).describe('Max messages to return').optional() },
        async ({ sessionId, limit }) => {
          const session = await plugin.getSession(sessionId)
          const entries = await session.readActive()
          const history = toTextHistory(entries)
          const trimmed = history.slice(-(limit ?? 50))
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ messages: trimmed }) }],
          }
        },
      )

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
      const mcp = createMcpServer()
      await mcp.connect(transport)
      return transport.handleRequest(c.req.raw)
    })

    // Register as connector for outbound delivery (heartbeat/cron)
    this.unregisterConnector = registerConnector({
      channel: 'mcp-ask',
      to: 'default',
      deliver: async (_text: string) => {
        // MCP is pull-based; outbound delivery is a no-op.
        // Callers retrieve responses by calling askWithSession.
      },
    })

    this.server = serve({ fetch: app.fetch, port: this.config.port }, (info) => {
      console.log(`mcp-ask connector listening on http://localhost:${info.port}/mcp`)
    })
  }

  async stop() {
    this.unregisterConnector?.()
    this.server?.close()
  }
}
