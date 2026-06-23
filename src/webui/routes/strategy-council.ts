/**
 * Strategy Council routes — dashboard backend.
 *
 * Endpoints:
 *   POST /deliberate       — kick off a deliberation and return the StrategyDecision
 *   GET  /recent           — list recent decisions (memory buffer, fast)
 *   GET  /history          — paginated history (disk)
 *   GET  /stream           — SSE stream of new decisions
 *   GET  /roles            — the current role definitions (for debug / UI)
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { EngineContext } from '../../core/types.js'
import { DEFAULT_ROLES, STRATEGY_DECISION_EVENT } from '../../core/strategy-council/index.js'

export function createStrategyCouncilRoutes(ctx: EngineContext) {
  const app = new Hono()

  // ---------- Roles (read-only debug) ----------
  app.get('/roles', (c) => {
    return c.json({
      roles: DEFAULT_ROLES.map((r) => ({
        name: r.name,
        label: r.label,
        allowedToolGroups: r.allowedToolGroups,
        extraDisabledTools: r.extraDisabledTools ?? [],
        systemPromptPreview: r.systemPrompt.slice(0, 400),
      })),
    })
  })

  // ---------- Deliberate (synchronous) ----------
  app.post('/deliberate', async (c) => {
    if (!ctx.strategyCouncil) {
      return c.json({ error: 'StrategyCouncil is not wired into this context' }, 503)
    }
    const body = await c.req.json().catch(() => ({})) as {
      input?: string
      profileByRole?: Record<string, string>
    }
    const input = body.input?.trim()
    if (!input) return c.json({ error: 'missing "input" field' }, 400)

    try {
      const decision = await ctx.strategyCouncil.deliberate(input, {
        profileByRole: body.profileByRole,
      })
      return c.json({ decision })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  // ---------- Recent (memory buffer) ----------
  app.get('/recent', (c) => {
    const limit = Number(c.req.query('limit')) || 50
    const entries = ctx.eventLog.recent({ type: STRATEGY_DECISION_EVENT, limit })
    return c.json({ entries, lastSeq: ctx.eventLog.lastSeq() })
  })

  // ---------- History (disk, paginated) ----------
  app.get('/history', async (c) => {
    const page = Number(c.req.query('page')) || 1
    const pageSize = Number(c.req.query('pageSize')) || 50
    const result = await ctx.eventLog.query({ page, pageSize, type: STRATEGY_DECISION_EVENT })
    return c.json(result)
  })

  // ---------- SSE stream ----------
  app.get('/stream', (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = ctx.eventLog.subscribeType(STRATEGY_DECISION_EVENT, (entry) => {
        stream.writeSSE({ data: JSON.stringify(entry) }).catch(() => {})
      })
      const pingInterval = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '' }).catch(() => {})
      }, 30_000)
      stream.onAbort(() => {
        clearInterval(pingInterval)
        unsub()
      })
      await new Promise<void>(() => {})
    })
  })

  return app
}
