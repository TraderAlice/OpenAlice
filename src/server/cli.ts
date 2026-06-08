/**
 * CLI gateway — the third adapter over the tool registry.
 *
 * `domain/` is the truth; HTTP routes serve the UI and MCP serves in-process
 * AI. This gateway serves the workspace-local `alice*` CLIs: thin
 * argv -> JSON -> HTTP forwarders a native agent runs from its shell. It reuses
 * the exact dispatch chain the MCP server uses (`extractMcpShape` +
 * `wrapToolExecute`), so the CLIs and MCP stay front-ends over one registry.
 *
 * Mounted on the MCP server's Hono app (open posture, no admin-token gate — the
 * workspace CLI carries no secret). Identity rides the URL path (`:wsId`), like
 * `/mcp/:wsId`. The `:export` segment selects a CliExport (data / workspace /
 * …) — the binary the agent invoked (`alice` vs `alice-workspace`) maps to it.
 *
 *   GET  /cli/:wsId/:export/manifest   grouped command tree + per-verb JSON
 *                                      schema (powers `--help`), plus the
 *                                      registered-but-unmapped tools in scope.
 *   POST /cli/:wsId/:export/invoke     { tool, args } -> validate + execute.
 *
 * Each export resolves tools from ONE scope (global ToolCenter for `data`,
 * the per-workspace WorkspaceToolCenter for `workspace`) and invoke is gated to
 * that export's own map — so `alice` can't reach a collaboration tool and
 * vice-versa, and trading/cron stay off entirely (no `uta` export yet).
 */

import type { Hono } from 'hono'
import { z } from 'zod'
import type { Tool } from 'ai'
import type { ToolCenter } from '../core/tool-center.js'
import type { WorkspaceToolCenter } from '../core/workspace-tool-center.js'
import type { IInboxStore } from '../core/inbox-store.js'
import type { IEntityStore } from '../core/entity-store.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { extractMcpShape, wrapToolExecute } from '../core/mcp-export.js'
import { type CliExport, getExport, mappedToolNames } from './cli-commands.js'

export interface CliGatewayDeps {
  toolCenter: ToolCenter
  workspaceToolCenter: WorkspaceToolCenter
  inboxStore: IInboxStore
  /** Built per-request for the `workspace` (scoped) export's tools. */
  entityStore: IEntityStore
  /** Lazy — WorkspaceService is created after McpPlugin starts. */
  getWorkspaceService: () => WorkspaceService | null
}

type WsMeta = { id: string; tag: string }

/** Mount /cli/:wsId/:export/* onto an existing Hono app (the MCP server's app). */
export function registerCliRoutes(app: Hono, deps: CliGatewayDeps): void {
  const { toolCenter, workspaceToolCenter, inboxStore, entityStore, getWorkspaceService } = deps

  /** Resolve + validate the workspace from the URL path. */
  const resolveWs = (wsId: string): { meta: WsMeta } | { error: 'unavailable' | 'unknown' } => {
    const svc = getWorkspaceService()
    if (!svc) return { error: 'unavailable' }
    const meta = svc.registry.get(wsId)
    if (!meta) return { error: 'unknown' }
    return { meta: { id: meta.id, tag: meta.tag } }
  }

  /**
   * A per-request lookup over ONE export's scope: global catalog for `data`,
   * the (per-workspace) scoped catalog for `workspace`. Never crosses scopes —
   * an export only sees the tools its category owns.
   */
  const exportCatalog = (
    exp: CliExport,
    ws: WsMeta,
  ): { resolve: (name: string) => Tool | null; inventoryNames: () => string[] } => {
    if (exp.scope === 'scoped') {
      const wsTools = workspaceToolCenter.build({
        workspaceId: ws.id,
        workspaceLabel: ws.tag,
        inboxStore,
        entityStore,
      })
      return {
        resolve: (name) => wsTools[name] ?? null,
        inventoryNames: () => Object.keys(wsTools),
      }
    }
    return {
      resolve: (name) => toolCenter.get(name) ?? null,
      inventoryNames: () => toolCenter.getInventory().map((t) => t.name),
    }
  }

  /** Shared workspace+export resolution for both routes. */
  const resolveCtx = (
    wsIdParam: string,
    exportParam: string,
  ):
    | { ok: true; exp: CliExport; ws: WsMeta }
    | { ok: false; status: 404 | 503; error: string } => {
    const ws = resolveWs(wsIdParam)
    if ('error' in ws) {
      return ws.error === 'unavailable'
        ? { ok: false, status: 503, error: 'workspace service unavailable' }
        : { ok: false, status: 404, error: 'unknown workspace' }
    }
    const exp = getExport(exportParam)
    if (!exp) return { ok: false, status: 404, error: `unknown CLI export: ${exportParam}` }
    return { ok: true, exp, ws: ws.meta }
  }

  app.get('/cli/:wsId/:export/manifest', (c) => {
    const r = resolveCtx(c.req.param('wsId'), c.req.param('export'))
    if (!r.ok) return c.json({ error: r.error }, r.status)
    const cat = exportCatalog(r.exp, r.ws)

    const groups: Record<
      string,
      Record<string, { tool: string; description: string; schema: unknown }>
    > = {}
    for (const [group, verbs] of Object.entries(r.exp.commands)) {
      for (const [verb, toolName] of Object.entries(verbs)) {
        const tool = cat.resolve(toolName)
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

    // No-silent-caps: surface tools registered IN THIS SCOPE but not reachable
    // via this export, so coverage gaps are visible rather than implied-complete.
    const mapped = mappedToolNames(c.req.param('export'))
    const unmapped = cat.inventoryNames().filter((n) => !mapped.has(n))

    return c.json({ export: c.req.param('export'), description: r.exp.description, groups, unmapped })
  })

  app.post('/cli/:wsId/:export/invoke', async (c) => {
    const r = resolveCtx(c.req.param('wsId'), c.req.param('export'))
    if (!r.ok) return c.json({ error: r.error }, r.status)

    const body = (await c.req.json().catch(() => ({}))) as { tool?: unknown; args?: unknown }
    const toolName = typeof body.tool === 'string' ? body.tool : ''
    if (!mappedToolNames(c.req.param('export')).has(toolName)) {
      return c.json({ error: `Unknown CLI command tool: ${toolName || '(none)'}` }, 404)
    }
    const tool = exportCatalog(r.exp, r.ws).resolve(toolName)
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
