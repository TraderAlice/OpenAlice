/**
 * Read-only Web UI projection of the private Agent conversation event log.
 *
 * The route is mounted below OpenAlice's normal auth gate and exposes joined,
 * typed records only. It never exposes the launcher path or a filesystem read
 * primitive, and it owns no replay/resume/delete operations.
 */
import { Hono } from 'hono'

import type { AgentConversationLog } from '../../workspaces/agent-conversation-log.js'

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export function createAgentConversationRoutes(log: AgentConversationLog): Hono {
  const app = new Hono()

  app.get('/', async (c) => {
    const page = positiveInteger(c.req.query('page'), 1)
    const pageSize = Math.min(100, positiveInteger(c.req.query('pageSize'), 50))
    return c.json(await log.query({ page, pageSize }))
  })

  return app
}
