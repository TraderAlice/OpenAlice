/**
 * Read-only Office building. Each Workspace is one room. Never a spawn surface.
 */
import { Hono } from 'hono'

import { sessionPreferredTitle } from '../../workspaces/session-registry.js'
import {
  OFFICE_CONFIG,
  compareOfficeRooms,
  eventsThroughSeq,
  officeHarnessForTemplate,
  officeProjectionNow,
  projectOfficeDrawers,
  projectOfficeFloor,
  type OfficeRosterPerson,
} from '../../workspaces/office-floor.js'
import type { WorkspaceSessionDirectoryEntry } from '../../workspaces/session-directory.js'
import type { WorkspaceService } from '../../workspaces/service.js'

function parseAsOfSeq(raw: string | undefined, lastSeq: number): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.min(parsed, lastSeq)
}

function sessionLastInteractionAt(entry: WorkspaceSessionDirectoryEntry): number {
  const interactiveAt = entry.interactive ? Date.parse(entry.interactive.lastActiveAt) : 0
  const executionAt = entry.latestExecution?.finishedAt ?? entry.latestExecution?.startedAt ?? 0
  return Math.max(
    entry.updatedAt,
    Number.isFinite(interactiveAt) ? interactiveAt : 0,
    executionAt,
  )
}

async function projectRoom(
  svc: WorkspaceService,
  workspaceId: string,
  harness: ReturnType<typeof officeHarnessForTemplate>,
  events: Parameters<typeof projectOfficeFloor>[2],
  now: number,
  includeLatestResult: boolean,
) {
  const directory = await svc.sessionDirectory(workspaceId, 200)
  if (!directory) return null
  const roster: OfficeRosterPerson[] = directory.sessions.map((entry) => {
    const record = svc.sessionRegistry.findByResumeId(workspaceId, entry.resumeId)
    return {
      resumeId: entry.resumeId,
      agent: entry.agent,
      name: record?.name ?? entry.resumeId,
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
      ...(record && sessionPreferredTitle(record) ? { title: sessionPreferredTitle(record) } : {}),
      ...(record ? { sessionRecordId: record.id } : {}),
      ...(entry.presence ? { presence: entry.presence } : {}),
      lifecycle: entry.lifecycle === 'retired' ? 'retired' : 'active',
      active: entry.active,
      lastInteractionAt: sessionLastInteractionAt(entry),
    }
  })
  const floor = projectOfficeFloor(workspaceId, roster, events, now)
  const directoryByResumeId = new Map(directory.sessions.map((entry) => [entry.resumeId, entry]))
  return {
    workspace: { ...directory.workspace, harness },
    lastInteractionAt: floor.lastInteractionAt,
    sleeping: floor.sleeping,
    employees: floor.employees.map((employee) => ({
      ...employee,
      ...(() => {
        const execution = directoryByResumeId.get(employee.resumeId)?.latestExecution
        const finishedAt = execution?.finishedAt
        return includeLatestResult
          && execution?.status === 'done'
          && execution.assistantPreview
          && finishedAt !== undefined
          && finishedAt <= now
          ? { latestResult: { text: execution.assistantPreview, at: finishedAt } }
          : {}
      })(),
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
  const activityJournal = svc.activityJournal ?? svc.agentRuntimeLog

  app.get('/floor', async (c) => {
    const lastSeq = activityJournal.lastSeq()
    const asOfSeq = parseAsOfSeq(c.req.query('asOfSeq'), lastSeq)
    // Live Office is a bounded current-state projection. Only explicit replay
    // pays the cost of reading immutable history from disk.
    const events = asOfSeq === undefined
      ? activityJournal.projectionEvents()
      : await activityJournal.read({})
    const sliced = asOfSeq === undefined ? events : eventsThroughSeq(events, asOfSeq)
    const now = officeProjectionNow(sliced, asOfSeq, lastSeq)
    const requested = c.req.query('workspaceId')?.trim()
    const requestedWorkspace = requested ? svc.registry.get(requested) : undefined
    const rooms = requested
      ? requestedWorkspace
        ? [{
            id: requestedWorkspace.id,
            tag: requestedWorkspace.tag,
            harness: officeHarnessForTemplate(requestedWorkspace.template ?? 'other'),
          }]
        : []
      : svc.registry.list().map((workspace) => ({
          id: workspace.id,
          tag: workspace.tag,
          harness: officeHarnessForTemplate(workspace.template ?? 'other'),
        }))
        .sort(compareOfficeRooms)
    if (requested && rooms.length === 0) return c.json({ error: 'workspace_not_found' }, 404)
    const offices = []
    for (const room of rooms) {
      const office = await projectRoom(
        svc,
        room.id,
        room.harness,
        sliced,
        now,
        asOfSeq === undefined,
      )
      if (office) offices.push(office)
    }
    return c.json({
      config: OFFICE_CONFIG,
      offices,
      lastSeq,
      firstSeq: activityJournal.firstSeq(),
      ...(asOfSeq !== undefined ? { asOfSeq } : {}),
    })
  })

  return app
}
