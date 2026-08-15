/**
 * Read-only projection of the agent runtime lifecycle journal.
 * Occupancy history for Automation; never a spawn or replay-control surface.
 */
import { Hono } from 'hono'

import { isAgentRuntimeEventType } from '../../workspaces/agent-runtime-log.js'
import type { WorkspaceService } from '../../workspaces/service.js'

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export function createAgentRuntimeLogRoutes(svc: WorkspaceService): Hono {
  const app = new Hono()

  app.get('/', async (c) => {
    const afterSeqRaw = c.req.query('afterSeq')
    const typeRaw = c.req.query('type')
    const type = typeRaw && isAgentRuntimeEventType(typeRaw) ? typeRaw : undefined
    if (afterSeqRaw !== undefined) {
      const afterSeq = Math.max(0, Number.parseInt(afterSeqRaw, 10) || 0)
      const limit = Math.min(500, positiveInteger(c.req.query('limit'), 100))
      const entries = await svc.agentRuntimeLog.read({
        afterSeq,
        limit,
        ...(type ? { type } : {}),
      })
      return c.json({
        entries,
        lastSeq: svc.agentRuntimeLog.lastSeq(),
      })
    }
    const page = positiveInteger(c.req.query('page'), 1)
    const pageSize = Math.min(100, positiveInteger(c.req.query('pageSize'), 50))
    const result = await svc.agentRuntimeLog.query({
      page,
      pageSize,
      ...(type ? { type } : {}),
    })
    return c.json({
      ...result,
      lastSeq: svc.agentRuntimeLog.lastSeq(),
    })
  })

  return app
}
