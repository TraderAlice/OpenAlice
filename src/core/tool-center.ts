/**
 * ToolCenter — unified tool registry.
 *
 * All tool definitions are registered here once during bootstrap.
 * Consumers (AI providers, MCP plugin, etc.) pull from ToolCenter
 * in the format they need, instead of reaching through Engine.
 */

import type { Tool } from 'ai'
import { readToolsConfig } from './config.js'

interface ToolEntry {
  tool: Tool
  group: string
}

export class ToolCenter {
  private tools: Record<string, ToolEntry> = {}

  /** Batch-register tool definitions under a group. Later registrations overwrite same-name tools. */
  register(tools: Record<string, Tool>, group: string): void {
    for (const [name, tool] of Object.entries(tools)) {
      this.tools[name] = { tool, group }
    }
  }

  /** Vercel AI SDK format — returns only enabled tools (reads disabled list from disk). */
  async getVercelTools(): Promise<Record<string, Tool>> {
    const { disabled } = await readToolsConfig()
    const result: Record<string, Tool> = {}
    if (disabled.length === 0) {
      for (const [name, entry] of Object.entries(this.tools)) {
        result[name] = entry.tool
      }
      return result
    }
    const disabledSet = new Set(disabled)
    for (const [name, entry] of Object.entries(this.tools)) {
      if (!disabledSet.has(name)) result[name] = entry.tool
    }
    return result
  }

  /** MCP format — same filtering as Vercel. Kept separate for future divergence. */
  async getMcpTools(): Promise<Record<string, Tool>> {
    return this.getVercelTools()
  }

  /** Full tool inventory with group metadata (for frontend / API). */
  getInventory(): Array<{ name: string; group: string; description: string }> {
    return Object.entries(this.tools).map(([name, entry]) => ({
      name,
      group: entry.group,
      description: (entry.tool.description ?? '').slice(0, 200),
    }))
  }

  /** Tool name list (for logging / debugging). */
  list(): string[] {
    return Object.keys(this.tools)
  }
}
