/**
 * CLI gateway — the third adapter over the tool registry.
 *
 * `domain/` is the truth; HTTP routes serve the UI and MCP serves in-process
 * AI. This gateway serves the workspace-local `alice` CLI: a thin
 * argv -> JSON -> HTTP forwarder a native agent runs from its shell. It reuses
 * the exact dispatch chain the MCP server uses (`extractMcpShape` +
 * `wrapToolExecute`), so the CLI and MCP stay two front-ends over one registry.
 *
 * Mounted on the MCP server's Hono app (open posture, no admin-token gate — the
 * workspace CLI carries no secret). Identity rides the URL path (`:wsId`), like
 * `/mcp/:wsId`. Two routes:
 *
 *   GET  /cli/:wsId/manifest   grouped command tree + per-verb JSON schema
 *                              (powers `alice --help` / `alice <group> --help`),
 *                              plus the list of registered-but-unmapped tools.
 *   POST /cli/:wsId/invoke     { tool, args } -> validate + execute -> JSON.
 *
 * Invoke is gated to tools in CLI_COMMANDS, so the CLI surface == the map
 * (trading / cron stay off it even though MCP still exposes them).
 */

import type { Hono } from 'hono'
import { z } from 'zod'
import type { Tool } from 'ai'
import type { ToolCenter } from '../core/tool-center.js'
import type { WorkspaceToolCenter } from '../core/workspace-tool-center.js'
import type { IInboxStore } from '../core/inbox-store.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { extractMcpShape, wrapToolExecute } from '../core/mcp-export.js'
import { CLI_COMMANDS, mappedToolNames } from './cli-commands.js'

export interface CliGatewayDeps {
  toolCenter: ToolCenter
  workspaceToolCenter: WorkspaceToolCenter
  inboxStore: IInboxStore
  /** Lazy — WorkspaceService is created after McpPlugin starts. */
  getWorkspaceService: () => WorkspaceService | null
}

type WsMeta = { id: string; tag: string }

/** Mount /cli/:wsId/* onto an existing Hono app (the MCP server's app). */
export function registerCliRoutes(app: Hono, deps: CliGatewayDeps): void {
  const { toolCenter, workspaceToolCenter, inboxStore, getWorkspaceService } = deps

  /** Resolve + validate the workspace from the URL path. */
  const resolveWs = (wsId: string): { meta: WsMeta } | { error: 'unavailable' | 'unknown' } => {
    const svc = getWorkspaceService()
    if (!svc) return { error: 'unavailable' }
    const meta = svc.registry.get(wsId)
    if (!meta) return { error: 'unknown' }
    return { meta: { id: meta.id, tag: meta.tag } }
  }

  /** Look up a tool across the global catalog and the workspace-scoped one. */
  const resolveTool = (name: string, ws: WsMeta): Tool | null => {
    const global = toolCenter.get(name)
    if (global) return global
    const wsTools = workspaceToolCenter.build({
      workspaceId: ws.id,
      workspaceLabel: ws.tag,
      inboxStore,
    })
    return wsTools[name] ?? null
  }

  app.get('/cli/:wsId/manifest', (c) => {
    const ws = resolveWs(c.req.param('wsId'))
    if ('error' in ws) {
      return ws.error === 'unavailable'
        ? c.json({ error: 'workspace service unavailable' }, 503)
        : c.json({ error: 'unknown workspace' }, 404)
    }

    const groups: Record<
      string,
      Record<string, { tool: string; description: string; schema: unknown }>
    > = {}
    for (const [group, verbs] of Object.entries(CLI_COMMANDS)) {
      for (const [verb, toolName] of Object.entries(verbs)) {
        const tool = resolveTool(toolName, ws.meta)
        if (!tool) continue
        let schema: unknown = {}
        try {
          schema = z.toJSONSchema(tool.inputSchema as z.ZodType)
        } catch {
          /* leave {} */
        }
        ;(groups[group] ??= {})[verb] = {
          tool: toolName,
          description: tool.description ?? '',
          schema,
        }
      }
    }

    // No-silent-caps: surface tools registered but NOT reachable via the CLI,
    // so coverage gaps are visible rather than implied-complete.
    const mapped = mappedToolNames()
    const unmapped = toolCenter
      .getInventory()
      .map((t) => t.name)
      .filter((n) => !mapped.has(n))

    return c.json({ groups, unmapped })
  })

  app.post('/cli/:wsId/invoke', async (c) => {
    const ws = resolveWs(c.req.param('wsId'))
    if ('error' in ws) {
      return ws.error === 'unavailable'
        ? c.json({ error: 'workspace service unavailable' }, 503)
        : c.json({ error: 'unknown workspace' }, 404)
    }

    const body = (await c.req.json().catch(() => ({}))) as { tool?: unknown; args?: unknown }
    const toolName = typeof body.tool === 'string' ? body.tool : ''
    if (!mappedToolNames().has(toolName)) {
      return c.json({ error: `Unknown CLI command tool: ${toolName || '(none)'}` }, 404)
    }
    const tool = resolveTool(toolName, ws.meta)
    if (!tool) return c.json({ error: `Tool not available: ${toolName}` }, 404)

    const rawArgs =
      body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {}

    // Same validate+coerce path as the MCP boundary (string -> number etc.),
    // so the client may send every flag as a raw string.
    const schema = z.object(extractMcpShape(tool))
    let validated: Record<string, unknown>
    try {
      validated = await schema.parseAsync(rawArgs)
    } catch (err) {
      return c.json({ error: 'Validation failed', details: String(err) }, 400)
    }

    const result = await wrapToolExecute(tool)(validated)
    if (result.isError) {
      const text = result.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n')
      return c.json({ error: text || 'tool error' }, 500)
    }
    // Hand back the MCP content blocks; the client prints text blocks verbatim
    // (data tools return one text block that already holds the JSON payload).
    return c.json({ content: result.content })
  })
}
