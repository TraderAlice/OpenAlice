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
import { type WorkspaceToolCenter, makeWorkspaceResolver } from '../core/workspace-tool-center.js'
import type { IInboxStore, InboxOrigin } from '../core/inbox-store.js'
import type { IEntityStore } from '../core/entity-store.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { extractMcpShape, wrapToolExecute } from '../core/mcp-export.js'
import { type CliExport, getExport, mappedToolNames } from './cli-commands.js'
import { resolveInboxOrigin } from './inbox-origin.js'

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
    origin?: InboxOrigin,
  ): { resolve: (name: string) => Tool | null; inventoryNames: () => string[] } => {
    if (exp.scope === 'scoped') {
      // GLOBAL issue-board reader, backed by the live WorkspaceService.
      // Built here so issue_list / issue_show on `alice-workspace` read EVERY
      // workspace's issues (reads global), while create/update/comment stay
      // caller-local. Absent when the service isn't up yet → tools self-read.
      const svc = getWorkspaceService()
      const wsTools = workspaceToolCenter.build({
        workspaceId: ws.id,
        workspaceLabel: ws.tag,
        inboxStore,
        entityStore,
        // Lets workspace_path resolve ANY peer's dir (not just the caller) —
        // the in-workspace cross-workspace addressing path. Shared with the
        // mcp.ts build site so the two never drift.
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
        // Agent-invisible run provenance from the `x-openalice-run` header
        // (resolved server-side). Only the invoke path passes it; manifest omits
        // it (no execution, no push). Absent → undefined.
        ...(origin ? { origin } : {}),
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
          // io:'input' + unrepresentable:'any' — schemas with .transform()
          // (e.g. trading's positiveNumeric) have no output-side JSON-schema
          // representation; the default call threw and the catch silently
          // rendered "(no flags)" for every order verb, leaving agents to
          // guess flag names from prose. Input-side conversion is exactly
          // what a CLI manifest wants anyway.
          schema = z.toJSONSchema(tool.inputSchema as z.ZodType, { io: 'input', unrepresentable: 'any' })
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
    // Out-of-band identity (agent never sees it): the `alice` shim forwards the
    // spawn-injected AQ_RUN_ID (headless) / AQ_SESSION_ID (interactive) here as
    // mutually-exclusive headers, resolved server-side to an authoritative origin
    // and baked into the scoped tools (e.g. inbox_push auto-link). The session
    // header is validated against THIS workspace's session registry.
    const origin = resolveInboxOrigin(
      {
        run: c.req.header('x-openalice-run'),
        session: c.req.header('x-openalice-session'),
        wsId: r.ws.id,
      },
      getWorkspaceService,
    )
    const tool = exportCatalog(r.exp, r.ws, origin).resolve(toolName)
    if (!tool) return c.json({ error: `Tool not available: ${toolName}` }, 404)

    const rawArgs =
      body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {}

    // Same validate+coerce path as the MCP boundary (string -> number etc.),
    // so the client may send every flag as a raw string. strictObject: an
    // unknown flag must error, not silently vanish — a typo'd --quantity
    // once staged a quantity-less order that validated clean.
    const schema = z.strictObject(extractMcpShape(tool))
    let validated: Record<string, unknown>
    try {
      validated = await schema.parseAsync(rawArgs)
    } catch (err) {
      // Field-level issues, not String(ZodError) — an agent reading
      // "Validation failed" alone is stranded guessing flag names/shapes.
      const details = err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
        : String(err)
      return c.json({ error: 'Validation failed', details }, 400)
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
