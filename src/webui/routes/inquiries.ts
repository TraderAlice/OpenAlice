/**
 * Business-object follow-ups for the human UI.
 *
 * The UI never constructs native runtime/session identifiers. It names an
 * Inbox entry or Issue relation, this route resolves the same provenance used
 * by the embedded CLI, and dispatches asynchronously through the shared
 * WorkspaceConversationControl. HeadlessTaskRegistry keeps the reverse link so
 * answers survive navigation, refresh, and process restart.
 */
import { Hono } from 'hono'

import type { IInboxStore } from '../../core/inbox-store.js'
import { makeInboxEntryOriginResolver } from '../../core/workspace-tool-center.js'
import { createWorkspaceConversationControl } from '../../workspaces/conversation-control.js'
import type { HeadlessInquiryScope, HeadlessInquirySubject, HeadlessTaskRecord } from '../../workspaces/headless-task-registry.js'
import { issueAssigneeResumeId } from '../../workspaces/issues/declaration.js'
import { HeadlessCapacityError, HeadlessResumeError, type WorkspaceService } from '../../workspaces/service.js'

const DEFAULT_TIMEOUT_MS = 300_000
const MAX_PROMPT_CHARS = 16_000
const LIST_LIMIT = 50

export interface InquiryRoutesDeps {
  service: WorkspaceService
  inboxStore: IInboxStore
}

function validId(id: string | undefined): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id)
}

async function promptFromRequest(c: import('hono').Context): Promise<string | null> {
  try {
    const body = await c.req.json() as { prompt?: unknown }
    if (typeof body.prompt !== 'string') return null
    const prompt = body.prompt.trim()
    return prompt.length > 0 && prompt.length <= MAX_PROMPT_CHARS ? prompt : null
  } catch {
    return null
  }
}

function errorResponse(c: import('hono').Context, err: unknown) {
  if (err instanceof HeadlessCapacityError) {
    return c.json({ error: 'capacity', message: err.message }, 429)
  }
  if (err instanceof HeadlessResumeError) {
    return c.json({ error: err.code, message: err.message }, 409)
  }
  return c.json({ error: 'dispatch_failed', message: err instanceof Error ? err.message : String(err) }, 500)
}

async function inquiryProjection(
  conversation: ReturnType<typeof createWorkspaceConversationControl>,
  task: HeadlessTaskRecord,
) {
  const current = await conversation.read(task.taskId)
  return {
    taskId: task.taskId,
    resumeId: task.resumeId,
    workspaceId: task.wsId,
    agent: task.agent,
    status: task.status,
    startedAt: task.startedAt,
    ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
    ...(task.durationMs !== undefined ? { durationMs: task.durationMs } : {}),
    ...(task.error ? { error: task.error } : {}),
    inquiry: task.inquiry!,
    assistantText: current?.structured?.assistantText ?? null,
  }
}

export function createInquiryRoutes(deps: InquiryRoutesDeps): Hono {
  const app = new Hono()
  const conversation = createWorkspaceConversationControl(deps.service)
  const resolveInboxOrigin = makeInboxEntryOriginResolver(() => deps.service)

  const list = async (subject: HeadlessInquiryScope) => Promise.all(
    deps.service.headlessTasks
      .list({ inquiry: subject, limit: LIST_LIMIT })
      .filter((task) => task.inquiry)
      .map((task) => inquiryProjection(conversation, task)),
  )

  app.get('/inbox/:id', async (c) => {
    const id = c.req.param('id')
    return c.json({ inquiries: await list({ kind: 'inbox', entryId: id }) })
  })

  app.post('/inbox/:id', async (c) => {
    const id = c.req.param('id')
    const prompt = await promptFromRequest(c)
    if (!prompt) return c.json({ error: 'invalid_prompt', message: 'prompt must be 1-16000 characters' }, 400)
    const entry = await deps.inboxStore.get(id)
    if (!entry) return c.json({ error: 'not_found' }, 404)
    const origin = resolveInboxOrigin(entry)
    const target = origin?.resumeId
      ? { kind: 'resume' as const, resumeId: origin.resumeId }
      : { kind: 'inbox' as const, inboxEntryId: entry.id, workspaceId: entry.workspaceId }
    try {
      const result = await conversation.ask({
        prompt,
        target,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        subject: { kind: 'inbox', entryId: entry.id },
      })
      if (result.status === 'unavailable') {
        return c.json({ error: 'unavailable', resolution: result.resolution }, 409)
      }
      return c.json(result, 202)
    } catch (err) {
      return errorResponse(c, err)
    }
  })

  app.get('/issues/:wsId/:id', async (c) => {
    const wsId = c.req.param('wsId')
    const id = c.req.param('id')
    return c.json({
      inquiries: await list({ kind: 'issue', workspaceId: wsId, issueId: id }),
    })
  })

  app.post('/issues/:wsId/:id', async (c) => {
    const wsId = c.req.param('wsId')
    const id = c.req.param('id')
    if (!validId(wsId) || !validId(id)) return c.json({ error: 'not_found' }, 404)
    let body: { prompt?: unknown; relation?: unknown; runId?: unknown }
    try {
      body = await c.req.json() as typeof body
    } catch {
      return c.json({ error: 'invalid_json' }, 400)
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
      return c.json({ error: 'invalid_prompt', message: 'prompt must be 1-16000 characters' }, 400)
    }
    const relation = body.relation
    if (!['creator', 'owner', 'run'].includes(String(relation))) {
      return c.json({ error: 'invalid_relation', message: 'relation must be creator, owner, or run' }, 400)
    }
    const detail = await deps.service.issueDetail(wsId, id)
    if (!detail) return c.json({ error: 'not_found' }, 404)

    let target
    let runId: string | undefined
    if (relation === 'owner') {
      const resumeId = issueAssigneeResumeId(detail.issue.assignee)
      if (!resumeId) {
        return c.json({ error: 'no_stable_owner', message: 'this Issue recruits a new Session for every run' }, 409)
      }
      target = { kind: 'resume' as const, resumeId }
    } else if (relation === 'run') {
      runId = typeof body.runId === 'string' ? body.runId : undefined
      const run = runId ? detail.runs.find((candidate) => candidate.taskId === runId) : undefined
      if (!run) return c.json({ error: 'run_not_found' }, 404)
      target = { kind: 'resume' as const, resumeId: run.resumeId }
    } else {
      target = { kind: 'issue' as const, workspaceId: wsId, issueId: id, action: 'created' as const }
    }

    const subject: HeadlessInquirySubject = {
      kind: 'issue',
      workspaceId: wsId,
      issueId: id,
      relation: relation as 'creator' | 'owner' | 'run',
      ...(runId ? { runId } : {}),
    }
    try {
      const result = await conversation.ask({ prompt, target, timeoutMs: DEFAULT_TIMEOUT_MS, subject })
      if (result.status === 'unavailable') {
        return c.json({ error: 'unavailable', resolution: result.resolution }, 409)
      }
      return c.json(result, 202)
    } catch (err) {
      return errorResponse(c, err)
    }
  })

  return app
}
