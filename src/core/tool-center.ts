/**
 * ToolCenter — unified tool registry.
 *
 * All tool definitions are registered here once during bootstrap.
 * Consumers (AI providers, MCP plugin, etc.) pull from ToolCenter
 * in the format they need, instead of reaching through Engine.
 */

import type { Tool } from 'ai'

export class ToolCenter {
  private tools: Record<string, Tool> = {}

  /** Batch-register tool definitions. Later registrations overwrite same-name tools. */
  register(tools: Record<string, Tool>): void {
    Object.assign(this.tools, tools)
  }

  /** Vercel AI SDK format — for createAgent / VercelAIProvider. */
  getVercelTools(): Record<string, Tool> {
    return { ...this.tools }
  }

  /** MCP format — for McpPlugin. Currently identical to Vercel but kept separate for future divergence. */
  getMcpTools(): Record<string, Tool> {
    return { ...this.tools }
  }

  /** Tool name list (for logging / debugging). */
  list(): string[] {
    return Object.keys(this.tools)
  }
}
