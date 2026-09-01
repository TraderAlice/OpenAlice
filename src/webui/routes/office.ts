/** Office building plus Project-owned Day state. Never a spawn surface. */
import { Hono } from 'hono'
import { ZodError } from 'zod'

import { OfficeDayUnavailableError } from '../../core/office-day-store.js'
import {
  RoutineFollowUpConflictError,
  RoutineFollowUpCreateDisallowedError,
  RoutineFollowUpStaleObservationError,
  RoutineFollowUpUnavailableError,
} from '../../core/routine-follow-up-store.js'
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
    const latestPrompt = entry.latestExecution
      ? svc.headlessTasks.get(entry.latestExecution.taskId)?.prompt.trim()
      : undefined
    const assignment = latestPrompt || (record ? sessionPreferredTitle(record) : undefined)
    return {
      resumeId: entry.resumeId,
      agent: entry.agent,
      name: record?.name ?? entry.resumeId,
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
      ...(assignment ? { title: assignment } : {}),
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

  app.get('/day', (c) => {
    try {
      return c.json(svc.officeDayStore.observe())
    } catch (error) {
      if (error instanceof OfficeDayUnavailableError) {
        return c.json({ error: error.code, message: error.message }, 503)
      }
      return c.json({
        error: 'office_day_read_failed',
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  })

  app.post('/day/open', async (c) => {
    try {
      const input: unknown = await c.req.json()
      return c.json(await svc.officeDayStore.open(input))
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return c.json({
          error: 'invalid_office_day_request',
          message: 'The Office Day request body is invalid.',
        }, 400)
      }
      if (error instanceof OfficeDayUnavailableError) {
        return c.json({ error: error.code, message: error.message }, 503)
      }
      return c.json({
        error: 'office_day_write_failed',
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  })

  app.post('/day/commands', async (c) => {
    try {
      const input: unknown = await c.req.json()
      return c.json(await svc.officeDayStore.execute(input))
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return c.json({
          error: 'invalid_office_day_request',
          message: 'The Office Day request body is invalid.',
        }, 400)
      }
      if (error instanceof OfficeDayUnavailableError) {
        return c.json({ error: error.code, message: error.message }, 503)
      }
      return c.json({
        error: 'office_day_write_failed',
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  })

  app.get('/routine-follow-ups', (c) => {
    try {
      return c.json({ followUps: svc.routineFollowUpStore.list() })
    } catch (error) {
      if (error instanceof RoutineFollowUpUnavailableError) {
        return c.json({ error: error.code, message: error.message }, 503)
      }
      return c.json({
        error: 'routine_follow_up_read_failed',
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  })

  app.put('/routine-follow-ups/:inboxEntryId', async (c) => {
    const inboxEntryId = c.req.param('inboxEntryId')
    if (!inboxEntryId) {
      return c.json({
        error: 'inbox_entry_id_required',
        message: 'An Inbox entry id is required.',
      }, 400)
    }

    let observation
    try {
      observation = svc.routineFollowUpStore.observe(inboxEntryId)
    } catch (error) {
      if (error instanceof RoutineFollowUpUnavailableError) {
        return c.json({ error: error.code, message: error.message }, 503)
      }
      return c.json({
        error: 'routine_follow_up_read_failed',
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
    const existing = observation.followUp
    if (!svc.inboxStore) {
      return c.json({
        error: 'inbox_unavailable',
        message: 'Inbox authority is unavailable.',
      }, 503)
    }

    // This exact read snapshots fresh-Carry attention authority. Once the live
    // Issue check below passes, overlapping read/delete cannot revoke that intent;
    // the Decision Desk already degrades honestly if the report later disappears.
    let entry
    try {
      entry = await svc.inboxStore.get(inboxEntryId)
    } catch (error) {
      return c.json({
        error: 'inbox_read_failed',
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
    if (!entry) {
      return c.json({
        error: 'inbox_entry_not_found',
        message: 'The Inbox report no longer exists.',
      }, 404)
    }

    const issueWorkspaceId = entry.origin?.issueWorkspaceId
    const issueId = entry.origin?.issueId
    if (
      entry.origin?.kind !== 'headless'
      || typeof issueWorkspaceId !== 'string'
      || issueWorkspaceId.length === 0
      || issueWorkspaceId.trim() !== issueWorkspaceId
      || typeof issueId !== 'string'
      || issueId.length === 0
      || issueId.trim() !== issueId
      || !Number.isFinite(entry.ts)
      || !Number.isInteger(entry.ts)
      || entry.ts < 0
    ) {
      return c.json({
        error: 'not_a_routine_report',
        message: 'Only a server-attributed scheduled Issue report can be carried for follow-up.',
      }, 422)
    }

    const inboxAllowsCreate = !(
      typeof entry.readAt === 'number'
      && Number.isFinite(entry.readAt)
      && entry.readAt > 0
    )
    let allowCreate = false
    if (!existing && inboxAllowsCreate) {
      let detail
      try {
        detail = await svc.issueDetail(issueWorkspaceId, issueId)
      } catch (error) {
        return c.json({
          error: 'routine_issue_read_failed',
          message: error instanceof Error ? error.message : String(error),
        }, 500)
      }
      if (!detail) {
        return c.json({
          error: 'routine_issue_not_found',
          message: 'The Issue that produced this report no longer exists.',
        }, 404)
      }
      if (!detail.issue.when) {
        return c.json({
          error: 'routine_issue_not_scheduled',
          message: 'The Issue that produced this report is not scheduled.',
        }, 422)
      }
      allowCreate = true
    }

    try {
      const result = await svc.routineFollowUpStore.put({
        inboxEntryId: entry.id,
        reportTs: entry.ts,
        issueWorkspaceId,
        issueId,
      }, {
        allowCreate,
        observedRevision: observation.revision,
      })
      return c.json(result)
    } catch (error) {
      if (error instanceof RoutineFollowUpStaleObservationError) {
        return c.json({
          error: 'routine_follow_up_no_longer_active',
          message: 'This decision changed while the request was in flight. Refresh before retrying.',
        }, 409)
      }
      if (error instanceof RoutineFollowUpCreateDisallowedError) {
        return c.json({
          error: 'routine_report_already_reviewed',
          message: 'This Inbox report was already reviewed and cannot be carried again.',
        }, 409)
      }
      if (error instanceof RoutineFollowUpConflictError) {
        return c.json({ error: error.code, message: error.message }, 409)
      }
      if (error instanceof RoutineFollowUpUnavailableError) {
        return c.json({ error: error.code, message: error.message }, 503)
      }
      return c.json({
        error: 'routine_follow_up_write_failed',
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  })

  app.delete('/routine-follow-ups/:inboxEntryId', async (c) => {
    const inboxEntryId = c.req.param('inboxEntryId')
    if (!inboxEntryId) {
      return c.json({
        error: 'inbox_entry_id_required',
        message: 'An Inbox entry id is required.',
      }, 400)
    }
    try {
      const removed = await svc.routineFollowUpStore.remove(inboxEntryId)
      return c.json({ ok: true, removed })
    } catch (error) {
      if (error instanceof RoutineFollowUpUnavailableError) {
        return c.json({ error: error.code, message: error.message }, 503)
      }
      return c.json({
        error: 'routine_follow_up_write_failed',
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  })

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
