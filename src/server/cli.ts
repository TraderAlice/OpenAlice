import { registerConnectorModelRoutes } from './connector-model.js'
import { registerMarketReferenceRoute } from './market-reference.js'
import { registerWorkspaceFileRoutes } from './workspace-files.js'
import { registerProjectCliRoutes } from './project-cli.js'
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
 * …) — the binary maps to its public export (`alice` and its legacy alias use `data`).
 *
 *   GET  /cli/:wsId/:export/manifest   grouped command tree + per-verb JSON
 *                                      schema (powers `--help`), plus the
 *                                      registered-but-unmapped tools in scope.
 *   POST /cli/:wsId/:export/invoke     { tool, args } -> validate + execute.
 *
 * alice combines both registry scopes, selecting the owner per mapped tool.
 * Legacy workspace requests stay scoped. Trading retains the separate uta map.
 */

import type { Hono } from 'hono'
import { readAliceHarnessConfig, cliGroupEnabled, DEFAULT_ALICE_HARNESS_CONFIG } from '../workspaces/alice-harness-policy.js'
import { z } from 'zod'
import type { Tool } from 'ai'
import type { ToolCenter } from '../core/tool-center.js'
import {
  type WorkspaceToolCenter,
  makeInboxEntryOriginResolver,
  makeWorkspaceResolver,
} from '../core/workspace-tool-center.js'
import type { IInboxStore, InboxOrigin } from '../core/inbox-store.js'
import { sessionCoworkerLabel } from '../workspaces/session-registry.js'
import type { IEntityStore } from '../core/entity-store.js'
import { sessionOriginFromInboxOrigin } from '../core/provenance-store.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { logger as launcherLogger } from '../workspaces/logger.js'
import { extractMcpShape, wrapToolExecute } from '../core/mcp-export.js'
import {
  type CliExport,
  toolRegistryScope,
  getExport,
  mappedToolNames,
  mappedToolNamesForScope,
} from './cli-commands.js'
import { resolveInboxOrigin } from './inbox-origin.js'
import { extractTradeDecisionRefs } from './trade-provenance.js'
import { createWorkspaceConversationControl } from '../workspaces/conversation-control.js'

export interface CliGatewayDeps {
  toolCenter: ToolCenter
  workspaceToolCenter: WorkspaceToolCenter
  inboxStore: IInboxStore
  /** Built per-request for the `workspace` (scoped) export's tools. */
  entityStore: IEntityStore
  /** Lazy — WorkspaceService is created after McpPlugin starts. */
  getWorkspaceService: () => WorkspaceService | null
}

type WsMeta = { id: string; tag: string; dir?: string }

/** Mount /cli/:wsId/:export/* onto an existing Hono app (the MCP server's app). */
export function registerCliRoutes(app: Hono, deps: CliGatewayDeps, manifestOnly = false): void {
  const { toolCenter, workspaceToolCenter, inboxStore, entityStore, getWorkspaceService } = deps
  if (!manifestOnly) {
    registerConnectorModelRoutes(app, getWorkspaceService)
    registerProjectCliRoutes(app, toolCenter)
    registerMarketReferenceRoute(app, toolCenter)
    registerWorkspaceFileRoutes(app, id => getWorkspaceService()?.registry.get(id))
  }

  /** Resolve + validate the workspace from the URL path. */
  const resolveWs = (wsId: string): { meta: WsMeta } | { error: 'unavailable' | 'unknown' } => {
    const svc = getWorkspaceService()
    if (!svc) return { error: 'unavailable' }
    // Older test doubles and embedders only expose the ordinary registry.
    // The real service adds resolveRuntimeWorkspace so the reserved manager
    // identity can share the CLI without entering the business registry.
    const meta = svc.resolveRuntimeWorkspace?.(wsId) ?? svc.registry.get(wsId)
    if (!meta) return { error: 'unknown' }
    return { meta: { id: meta.id, tag: meta.tag, dir: meta.dir } }
  }

  /**
   * Per-request dispatch preserves Workspace context when a mixed export
   * resolves collaboration tools; global tools never shadow scoped tools.
   */
  const exportCatalog = (
    exp: CliExport,
    ws: WsMeta,
    origin?: InboxOrigin,
  ): { resolve: (name: string) => Tool | null; inventoryNames: () => string[] } => {
    if (exp.scope === 'mixed') {
      const scoped = exportCatalog(getExport('workspace')!, ws, origin)
      return {
        resolve: name => toolRegistryScope(exp, name) === 'scoped' ? scoped.resolve(name) : toolCenter.get(name),
        inventoryNames: () => [...new Set([...toolCenter.getInventory().map(t => t.name), ...scoped.inventoryNames()])],
      }
    }
    if (exp.scope === 'scoped') {
      // GLOBAL issue-board reader, backed by the live WorkspaceService.
      // Built here so issue_list / issue_show on `alice` read EVERY
      // workspace's issues (reads global), while create/update/comment stay
      // caller-local. Absent when the service isn't up yet → tools self-read.
      const svc = getWorkspaceService()
      const wsTools = workspaceToolCenter.build({
        workspaceId: ws.id,
        workspaceLabel: ws.tag,
        inboxStore,
        entityStore,
        ...(svc ? { provenanceStore: svc.provenanceStore } : {}),
        ...(svc ? { conversation: createWorkspaceConversationControl(svc) } : {}),
        ...(svc ? { templateUpgrades: svc.templateUpgrades, aliceHarnessUpgrades: svc.aliceHarnessUpgrades } : {}),
        ...(svc ? {
          setSessionDisplayName: async (input) => {
            const identity = await svc.setSessionDisplayName({
              wsId: ws.id,
              resumeId: input.resumeId,
              displayName: input.displayName,
            })
            return {
              resumeId: identity.resumeId,
              ...(identity.displayName ? { displayName: identity.displayName } : {}),
            }
          },
        } : {}),
        // Lets workspace_path resolve ANY peer's dir (not just the caller) —
        // the in-workspace cross-workspace addressing path. Shared with the
        // mcp.ts build site so the two never drift.
        resolveWorkspace: makeWorkspaceResolver(getWorkspaceService),
        ...(svc ? {
          workspaceInventory: async () => Promise.all(svc.registry.list().map(async (meta) => {
            await svc.sessionRegistry.ensureLoaded(meta.id)
            void svc.refreshSessionTitles?.(meta)
            const sessions = svc.sessionRegistry.listFor(meta.id)
            const activity = svc.workspaceRuntimeActivity(meta.id)
            return {
              id: meta.id,
              tag: meta.tag,
              ...(meta.template ? { template: meta.template } : {}),
              createdAt: meta.createdAt,
              sessions: {
                total: sessions.length,
                running: activity.sessions.length,
                recent: sessions
                  .slice()
                  .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
                  .slice(0, 4)
                  .map((session) => ({
                    resumeId: session.resumeId,
                    agent: session.agent,
                    title: sessionCoworkerLabel(
                      session,
                      svc.resumeRegistry.get(session.resumeId)?.displayName,
                    ) ?? session.name,
                    state: session.state,
                    lastActiveAt: session.lastActiveAt,
                  })),
              },
              headlessRunning: activity.headless.length,
            }
          })),
        } : {}),
        resolveInboxOrigin: makeInboxEntryOriginResolver(getWorkspaceService),
        ...(svc ? { sessionDirectory: (id: string, limit?: number) => svc.sessionDirectory(id, limit) } : {}),
        ...(svc ? {
          resolveSessionIdentity: (resumeId: string) => {
            const identity = svc.resumeRegistry.get(resumeId)
            return identity
              ? {
                  workspaceId: identity.wsId,
                  agent: identity.agent,
                  resumable: identity.lifecycle !== 'retired' && Boolean(identity.agentSessionId),
                }
              : null
          },
        } : {}),
        ...(svc
          ? {
              issueRuns: { start: (w: string, i: string, r?: string) => svc.startIssueRun(w, i, r) },
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
        ...(origin?.kind === 'headless' && origin.runId && svc ? { callerRun: svc.headlessTasks.get(origin.runId) ?? undefined } : {}),
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

  app.get(manifestOnly ? '/api/workspaces/:wsId/cli/:export/manifest' : '/cli/:wsId/:export/manifest', async (c) => {
    const r = resolveCtx(c.req.param('wsId'), c.req.param('export'))
    if (!r.ok) return c.json({ error: r.error }, r.status)
    let policy
    try { policy = r.ws.dir ? await readAliceHarnessConfig(r.ws.dir) : DEFAULT_ALICE_HARNESS_CONFIG }
    catch (error) { return c.json({ error: (error as Error).message }, 503) }
    const cat = exportCatalog(r.exp, r.ws)

    const groups: Record<
      string,
      Record<string, { tool: string; description: string; schema: unknown }>
    > = {}
    for (const [group, verbs] of Object.entries(r.exp.commands)) {
      if (!cliGroupEnabled(policy, r.exp.binary, group)) continue
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

    // No-silent-caps diagnostics: surface tools registered in this registry
    // scope but not owned by ANY public CLI. Sibling global exports deliberately
    // share ToolCenter, so a UTA tool must not look like a missing `alice` verb.
    const mapped = mappedToolNamesForScope(r.exp.scope)
    const unmapped = cat.inventoryNames().filter((n) => !mapped.has(n))

    // Discovery must remain usable even if the optional upgrade receipt is unreadable.
    const upgradeWarning = !manifestOnly && r.ws.dir
      ? await getWorkspaceService()?.aliceHarnessUpgrades?.upgradeNotice(r.ws.id).catch(() => undefined)
      : undefined
    return c.json({
      ...(upgradeWarning ? { warnings: [upgradeWarning] } : {}),
      export: c.req.param('export'),
      description: r.exp.description,
      groupDescriptions: r.exp.groupDescriptions,
      groups,
      unmapped,
    })
  })

  // UI documentation exposes discovery only, never an invocation alias.
  if (manifestOnly) return

  app.post('/cli/:wsId/:export/invoke', async (c) => {
    const r = resolveCtx(c.req.param('wsId'), c.req.param('export'))
    if (!r.ok) return c.json({ error: r.error }, r.status)

    const body = (await c.req.json().catch(() => ({}))) as { tool?: unknown; args?: unknown }
    const toolName = typeof body.tool === 'string' ? body.tool : ''
    if (!mappedToolNames(c.req.param('export')).has(toolName)) {
      return c.json({ error: `Unknown CLI command tool: ${toolName || '(none)'}` }, 404)
    }
    let policy
    try { policy = r.ws.dir ? await readAliceHarnessConfig(r.ws.dir) : DEFAULT_ALICE_HARNESS_CONFIG }
    catch (error) { return c.json({ error: (error as Error).message }, 503) }
    const enabled = Object.entries(r.exp.commands).some(([group, verbs]) =>
      cliGroupEnabled(policy, r.exp.binary, group) && Object.values(verbs).includes(toolName))
    if (!enabled) return c.json({ error: `CLI command disabled by Workspace configuration: ${toolName}` }, 403)
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
    // A UTA Git commit is the durable business decision. Attribute only commits
    // created through an authoritative Workspace Session header; a bare local
    // API/CLI call remains unattributed rather than being guessed as an agent.
    const provenanceOrigin = sessionOriginFromInboxOrigin(r.ws.id, origin)
    const decisionRefs = provenanceOrigin
      ? extractTradeDecisionRefs(toolName, result.content)
      : []
    if (provenanceOrigin && decisionRefs.length > 0) {
      const svc = getWorkspaceService()
      if (svc) {
        try {
          for (const ref of decisionRefs) {
            await svc.provenanceStore.append({
              artifact: {
                kind: 'trade-decision',
                accountId: ref.accountId,
                decisionId: ref.decisionId,
              },
              action: 'decided',
              origin: provenanceOrigin,
              at: Date.now(),
              fingerprint: `trade-decision:${ref.accountId}:${ref.decisionId}:decided`,
            })
          }
        } catch (err) {
          // Trading already committed successfully. A diagnostics write must
          // never turn that success into a reported command failure.
          launcherLogger.warn('trade_decision_provenance.append_failed', { err })
        }
      }
    }
    // Hand back the MCP content blocks; the client prints text blocks verbatim
    // (data tools return one text block that already holds the JSON payload).
    return c.json({ content: result.content })
  })
}
