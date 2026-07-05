/**
 * /api/schedule — read-only dashboard for workspace self-scheduling.
 *
 * Aggregates every workspace's own `.alice/issues/<id>.md` files (the agent
 * writes them; a launcher scanner fires due scheduled issues as headless runs —
 * there is NO central registry) enriched with the scanner's last-fired marker +
 * computed next-due. Creation/edit is NOT a route — scheduling is a coding task
 * (the agent edits the files). This surface is purely the scheduling projection:
 * "what is scheduled across my workspaces".
 */
import { Hono } from 'hono'

import type { WorkspaceService } from '../../workspaces/service.js'

export function createScheduleRoutes(svc: WorkspaceService): Hono {
  const app = new Hono()

  // GET /api/schedule → { workspaces: [{ wsId, tag, status, tasks: [...] }] }
  app.get('/', async (c) => {
    return c.json(await svc.scheduleSnapshot())
  })

  return app
}
