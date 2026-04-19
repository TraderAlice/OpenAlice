/**
 * TwstockMcpClient — MCP client wrapper for the remote twstock server.
 *
 * Lazy-connects on first tool call so OpenAlice starts even if the server is down.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export class TwstockMcpClient {
  private client: Client | null = null
  private connecting: Promise<Client> | null = null

  constructor(private mcpUrl: string) {}

  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client

    // Guard against concurrent connection attempts
    if (this.connecting) return this.connecting

    this.connecting = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl))
      const client = new Client({ name: 'open-alice', version: '1.0.0' })
      await client.connect(transport)
      this.client = client
      return client
    })()

    try {
      return await this.connecting
    } catch (err) {
      // Reset so the next call retries
      this.client = null
      throw err
    } finally {
      this.connecting = null
    }
  }

  /** Call a remote twstock MCP tool by name. */
  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const client = await this.ensureConnected()
    const result = await client.callTool({ name: toolName, arguments: args })

    if (result.isError) {
      const text = extractText(result.content)
      throw new Error(text || 'twstock MCP tool returned an error')
    }

    const text = extractText(result.content)
    // Try to parse as JSON; return raw string if not valid JSON
    try { return JSON.parse(text) } catch { return text }
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = null
  }
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? '')
  return content
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')
}
