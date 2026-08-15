/**
 * Read-only Office building. Each Workspace is one room. Never a spawn surface.
 */
import { Hono } from 'hono'

import { sessionPreferredTitle } from '../../workspaces/session-registry.js'
import {
  compareOfficeRooms,
  eventsThroughSeq,
  officeProjectionNow,
  projectOfficeDrawers,
  projectOfficeFloor,
  type OfficeRosterPerson,
} from '../../workspaces/office-floor.js'
import type { WorkspaceService } from '../../workspaces/service.js'

function parseAsOfSeq(raw: string | undefined, lastSeq: number): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.min(parsed, lastSeq)
}

async function projectRoom(
  svc: WorkspaceService,
  workspaceId: string,
  events: Parameters<typeof projectOfficeFloor>[2],
  now: number,
) {
  const directory = await svc.sessionDirectory(workspaceId, 200)
  if (!directory) return null
  const roster: OfficeRosterPerson[] = directory.sessions.map((entry) => {
    const record = svc.sessionRegistry.findByResumeId(workspaceId, entry.resumeId)
    return {
      resumeId: entry.resumeId,
      agent: entry.agent,
      name: record?.name ?? entry.resumeId,
      ...(record && sessionPreferredTitle(record) ? { title: sessionPreferredTitle(record) } : {}),
      ...(record ? { sessionRecordId: record.id } : {}),
      ...(entry.presence ? { presence: entry.presence } : {}),
      lifecycle: entry.lifecycle === 'retired' ? 'retired' : 'active',
    }
  })
  const floor = projectOfficeFloor(workspaceId, roster, events, now)
  return {
    workspace: directory.workspace,
    employees: floor.employees.map((employee) => ({
      ...employee,
      drawers: projectOfficeDrawers(
        workspaceId,
        employee.resumeId,
        svc.provenanceStore.list({ resumeId: employee.resumeId, limit: 24 }),
      ),
    })),
  }
}

export function createOfficeRoutes(svc: WorkspaceService): Hono {
  const app = new Hono()

  app.get('/floor', async (c) => {
    const lastSeq = svc.agentRuntimeLog.lastSeq()
    const asOfSeq = parseAsOfSeq(c.req.query('asOfSeq'), lastSeq)
    const events = await svc.agentRuntimeLog.read({})
    const sliced = asOfSeq === undefined ? events : eventsThroughSeq(events, asOfSeq)
    const now = officeProjectionNow(sliced, asOfSeq, lastSeq)
    const requested = c.req.query('workspaceId')?.trim()
    const rooms = requested
      ? svc.registry.get(requested)
        ? [{ id: requested, tag: svc.registry.get(requested)!.tag }]
        : []
      : svc.registry.list().map((workspace) => ({ id: workspace.id, tag: workspace.tag }))
        .sort(compareOfficeRooms)
    if (requested && rooms.length === 0) return c.json({ error: 'workspace_not_found' }, 404)
    const offices = []
    for (const room of rooms) {
      const office = await projectRoom(svc, room.id, sliced, now)
      if (office) offices.push(office)
    }
    return c.json({
      offices,
      lastSeq,
      firstSeq: events[0]?.seq ?? 0,
      ...(asOfSeq !== undefined ? { asOfSeq } : {}),
    })
  })

  return app
}
