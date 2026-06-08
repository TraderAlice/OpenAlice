/**
 * /api/headless — the headless-task management plane (cross-workspace).
 *
 * Read-only view over `WorkspaceService.headlessTasks`: "what are the workers
 * doing" across every workspace. Dispatch lives at POST /api/workspaces/:id/
 * headless (it's per-workspace); this surface is the panel + per-task status.
 */
import { Hono } from 'hono'

import type { HeadlessTaskStatus } from '../../workspaces/headless-task-registry.js'
import type { WorkspaceService } from '../../workspaces/service.js'

const STATUSES = new Set<HeadlessTaskStatus>(['running', 'done', 'failed', 'interrupted'])

export function createHeadlessRoutes(svc: WorkspaceService): Hono {
  const app = new Hono()

  // GET /api/headless?wsId=&status=&limit=  → tasks, newest-first.
  app.get('/', (c) => {
    const wsId = c.req.query('wsId') || undefined
    const statusRaw = c.req.query('status')
    const status =
      statusRaw && STATUSES.has(statusRaw as HeadlessTaskStatus)
        ? (statusRaw as HeadlessTaskStatus)
        : undefined
    const limitRaw = Number(c.req.query('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100
    return c.json({ tasks: svc.headlessTasks.list({ wsId, status, limit }) })
  })

  // GET /api/headless/:taskId → one task's record.
  app.get('/:taskId', (c) => {
    const rec = svc.headlessTasks.get(c.req.param('taskId'))
    if (!rec) return c.json({ error: 'not_found' }, 404)
    return c.json(rec)
  })

  return app
}
