/**
 * /api/issues — the Issue board, a Linear-style human+AI surface that aggregates
 * issues across ALL workspaces.
 *
 * Like /api/schedule, the READ side is built by SCANNING each workspace's own
 * `.alice/issues/` directory (one markdown file per issue) — there is NO central
 * store. An issue is a tracked work item; if it additionally carries a `when` it
 * self-schedules, and the row then carries the scanner's firing markers.
 *
 * Read endpoints:
 *   GET  /api/issues               → list across all workspaces
 *   GET  /api/issues/:wsId/:id      → one issue's detail { issue, activity, runs, inboxReports }
 *   POST /api/issues/:wsId/:id/retry → rerun the latest failed/interrupted schedule now
 *
 * Phase 2b adds the human/UI WRITE path (the agent edits the files directly /
 * via its own tools). Both writes go through the shared mutation helper
 * (`workspaces/issues/mutate.ts`) so the human and agent surfaces can never
 * drift on file format or validation; writes are working-tree only (no commit):
 *   PATCH /api/issues/:wsId/:id           body { status?, priority?, assignee?, what? }
 *   POST  /api/issues/:wsId/:id/comments  body { text }  (author = 'human';
 *     exact Session owners are notified and their final reply returns here)
 *
 * Both return the same detail shape GET /api/issues/:wsId/:id does, so the UI
 * can swap its cache after an edit. They mirror the agent-config route's
 * validate → registry.get → write → json shape + logging.
 */
import { Hono } from 'hono'

import {
  MODEL_REASONING_EFFORTS,
  isModelReasoningEffort,
  type ModelReasoningEffort,
} from '../../ai-providers/model-semantics.js'
import type { WorkspaceConversationControl } from '../../core/workspace-tool-center.js'
import { ACTIVITY_UPDATE_COALESCE_MS } from '../../core/provenance-store.js'
import { createWorkspaceConversationControl } from '../../workspaces/conversation-control.js'
import { dispatchIssueCommentReply } from '../../workspaces/issues/comment-delivery.js'
import { issueMutation, issueMutationFingerprint } from '../../workspaces/issues/change-tracker.js'
import { updateIssueCommentDelivery } from '../../workspaces/issues/comments.js'
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  issueAssigneeResumeId,
  issueAssigneeSchema,
  type IssuePriority,
  type IssueStatus,
} from '../../workspaces/issues/declaration.js'
import { appendIssueComment, updateIssueFields } from '../../workspaces/issues/mutate.js'
import { isAgentRuntime } from '../../workspaces/cli-adapter.js'
import { logger as launcherLogger } from '../../workspaces/logger.js'
import {
  HeadlessCapacityError,
  HeadlessResumeError,
  IssueRetryError,
  type WorkspaceService,
} from '../../workspaces/service.js'

/** Upper bound on a single comment's text (matches the headless seed cap). */
const MAX_COMMENT = 16000
const MAX_WHAT = 60000

function validId(id: string | undefined): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id)
}

async function safeJson(c: import('hono').Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

export interface IssueRoutesDeps {
  /** Test seam; production uses the embedded provenance-aware control. */
  conversation?: WorkspaceConversationControl
}

export function createIssuesRoutes(svc: WorkspaceService, deps: IssueRoutesDeps = {}): Hono {
  const app = new Hono()
  const conversation = deps.conversation ?? createWorkspaceConversationControl(svc)

  // GET /api/issues → { workspaces: [{ wsId, tag, status, error?, issues: [...] }] }
  app.get('/', async (c) => {
    return c.json(await svc.issuesSnapshot())
  })

  // GET /api/issues/:wsId/:id → { issue: {...incl. What + markers}, comments, runs: [...],
  // inboxReports: [...] }. The issue→inbox join lives in svc.issueDetail (domain),
  // so this route is a thin pass-through. 404 when the workspace or the issue id
  // is absent (mirrors the workspaces route convention: `{ error: 'not_found' }`).
  app.get('/:wsId/:id', async (c) => {
    const detail = await svc.issueDetail(c.req.param('wsId'), c.req.param('id'))
    if (!detail) return c.json({ error: 'not_found' }, 404)
    return c.json(detail)
  })

  // POST /api/issues/:wsId/:id/retry — the UI never supplies a prompt, runtime,
  // owner, or timeout. The service re-reads the live Issue and reuses the same
  // dispatch path as the scheduler without advancing its next-fire marker.
  app.post('/:wsId/:id/retry', async (c) => {
    const wsId = c.req.param('wsId')
    const id = c.req.param('id')
    if (!validId(wsId) || !validId(id)) return c.json({ error: 'not_found' }, 404)
    try {
      return c.json(await svc.retryIssue(wsId, id), 202)
    } catch (err) {
      if (err instanceof IssueRetryError) {
        const status = err.code === 'not_found' ? 404
          : err.code === 'not_scheduled' ? 422
          : 409
        return c.json({ error: err.code, message: err.message }, status)
      }
      if (err instanceof HeadlessCapacityError) {
        return c.json({ error: 'capacity_reached', message: err.message }, 429)
      }
      if (err instanceof HeadlessResumeError) {
        return c.json({ error: err.code, message: err.message }, 409)
      }
      launcherLogger.warn('issue.retry_failed', { wsId, id, err })
      return c.json({
        error: 'retry_failed',
        message: err instanceof Error ? err.message : String(err),
      }, 500)
    }
  })

  // PATCH /api/issues/:wsId/:id — patch board fields { status?, priority?,
  // assignee? } plus the scheduled runtime override { agent? } on one issue
  // (the human/UI path). `agent: null` removes the override so future fires use
  // the workspace default runtime. Other scheduling frontmatter (`when`)
  // stays file-owned. Returns the updated detail shape; 404 when missing.
  app.patch('/:wsId/:id', async (c) => {
    const wsId = c.req.param('wsId')
    const id = c.req.param('id')
    if (!validId(wsId) || !validId(id)) return c.json({ error: 'not_found' }, 404)
    const meta = svc.registry.get(wsId)
    if (!meta) return c.json({ error: 'not_found' }, 404)

    const body = await safeJson(c)
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const patch: {
      status?: IssueStatus
      priority?: IssuePriority
      assignee?: string
      agent?: string | null
      model?: string | null
      effort?: ModelReasoningEffort | null
      what?: string
    } = {}
    if ('status' in fields) {
      const s = fields['status']
      if (typeof s !== 'string' || !ISSUE_STATUSES.includes(s as IssueStatus)) {
        return c.json({ error: 'invalid_status', message: `status must be one of: ${ISSUE_STATUSES.join(', ')}` }, 400)
      }
      patch.status = s as IssueStatus
    }
    if ('priority' in fields) {
      const p = fields['priority']
      if (typeof p !== 'string' || !ISSUE_PRIORITIES.includes(p as IssuePriority)) {
        return c.json({ error: 'invalid_priority', message: `priority must be one of: ${ISSUE_PRIORITIES.join(', ')}` }, 400)
      }
      patch.priority = p as IssuePriority
    }
    if ('assignee' in fields) {
      const a = fields['assignee']
      const assignee = typeof a === 'string' ? issueAssigneeSchema.safeParse(a.trim()) : null
      if (!assignee?.success) {
        return c.json({ error: 'invalid_assignee', message: 'assignee must be @workspace, @new, @human, @unassigned, or an exact @resumeId' }, 400)
      }
      const resumeId = issueAssigneeResumeId(assignee.data)
      if (resumeId) {
        const identity = svc.resumeRegistry.get(resumeId)
        if (!identity) {
          return c.json({
            error: 'invalid_assignee_session',
            message: 'Session assignee must identify a known product Session',
          }, 400)
        }
        if (identity.lifecycle === 'retired') {
          return c.json({
            error: 'retired_assignee_session',
            message: 'the selected Session is retired; assign its successor or another active Session',
          }, 409)
        }
        if (!identity.agentSessionId) {
          return c.json({
            error: 'unavailable_assignee_session',
            message: 'the selected Session is not resumable yet; complete one agent turn before assigning it',
          }, 409)
        }
      }
      patch.assignee = assignee.data
    }
    if ('agent' in fields) {
      const raw = fields['agent']
      if (raw === null || raw === '') {
        patch.agent = null
      } else if (typeof raw !== 'string') {
        return c.json({ error: 'invalid_agent', message: 'agent must be a runtime id or null' }, 400)
      } else {
        const agent = raw.trim()
        const adapter = svc.adapters.get(agent)
        if (!adapter || !isAgentRuntime(adapter) || !meta.agents.includes(agent)) {
          return c.json({ error: 'invalid_agent', message: `unknown or disabled agent runtime: ${agent}` }, 400)
        }
        patch.agent = agent
      }
    }
    if ('model' in fields) {
      const raw = fields['model']
      if (raw === null || raw === '') {
        patch.model = null
      } else if (typeof raw !== 'string' || !raw.trim()) {
        return c.json({ error: 'invalid_model', message: 'model must be a native model id or null' }, 400)
      } else {
        patch.model = raw.trim()
      }
    }
    if ('effort' in fields) {
      const raw = fields['effort']
      if (raw === null || raw === '') {
        patch.effort = null
      } else if (!isModelReasoningEffort(raw)) {
        return c.json({
          error: 'invalid_effort',
          message: `effort must be one of: ${MODEL_REASONING_EFFORTS.join(', ')}`,
        }, 400)
      } else {
        patch.effort = raw
      }
    }
    if ('what' in fields) {
      const what = fields['what']
      if (typeof what !== 'string' || what.trim().length === 0) {
        return c.json({ error: 'invalid_what', message: 'what must be non-empty markdown' }, 400)
      }
      if (what.length > MAX_WHAT) {
        return c.json({ error: 'what_too_long', message: `max ${MAX_WHAT} chars` }, 400)
      }
      patch.what = what.trim()
    }
    if (Object.keys(patch).length === 0) {
      return c.json({
        error: 'no_fields',
        message: 'provide at least one of status, priority, assignee, agent, model, effort, what',
      }, 400)
    }

    try {
      const res = await updateIssueFields(meta.dir, id, patch)
      if (!res.ok) {
        if (res.reason === 'not_found') return c.json({ error: 'not_found' }, 404)
        return c.json({ error: 'invalid_issue', message: res.error }, 422)
      }
      const mutation = issueMutation(res.previous, res.issue)
      await svc.provenanceStore.append({
        artifact: { kind: 'issue', workspaceId: wsId, issueId: id },
        action: 'updated',
        origin: { kind: 'human' },
        at: Date.now(),
        ...(mutation ? {
          mutation,
          fingerprint: issueMutationFingerprint(wsId, id, res.issue),
        } : {}),
      }, { coalesceWithinMs: ACTIVITY_UPDATE_COALESCE_MS })
      launcherLogger.info('issue.updated', { wsId, id, fields: Object.keys(patch) })
      const detail = await svc.issueDetail(wsId, id)
      return c.json(detail ?? { issue: res.issue, comments: [], runs: [], inboxReports: [], provenance: [], activity: [] })
    } catch (err) {
      launcherLogger.warn('issue.update_failed', { wsId, id, err })
      return c.json({ error: 'write_failed', message: (err as Error).message }, 500)
    }
  })

  // POST /api/issues/:wsId/:id/comments — append a structured markdown comment
  // to `<id>.comments.json`. Author is fixed to 'human' here (the agent path
  // stamps its signed resume id when one is available). A different fixed
  // Session owner is notified in the background; workspace-owned Issues remain
  // durable notes and never recruit a random worker. Returns updated detail.
  app.post('/:wsId/:id/comments', async (c) => {
    const wsId = c.req.param('wsId')
    const id = c.req.param('id')
    if (!validId(wsId) || !validId(id)) return c.json({ error: 'not_found' }, 404)
    const meta = svc.registry.get(wsId)
    if (!meta) return c.json({ error: 'not_found' }, 404)

    const body = await safeJson(c)
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const text = fields['text']
    if (typeof text !== 'string' || text.trim().length === 0) {
      return c.json({ error: 'text_required' }, 400)
    }
    if (text.length > MAX_COMMENT) {
      return c.json({ error: 'text_too_long', message: `max ${MAX_COMMENT} chars` }, 400)
    }

    try {
      const res = await appendIssueComment(meta.dir, id, 'human', text)
      if (!res.ok) {
        if (res.reason === 'not_found') return c.json({ error: 'not_found' }, 404)
        return c.json({ error: 'invalid_issue', message: res.error }, 422)
      }
      await svc.provenanceStore.append({
        artifact: { kind: 'issue', workspaceId: wsId, issueId: id },
        action: 'commented',
        origin: { kind: 'human' },
        at: Date.now(),
      })
      const dispatched = await dispatchIssueCommentReply({
        conversation,
        issueWorkspaceId: wsId,
        issue: res.issue,
        comment: res.comment,
      })
      if (dispatched.status !== 'not_requested') {
        const updated = await updateIssueCommentDelivery(meta.dir, id, res.comment.id, dispatched.delivery)
        if (!updated.ok) {
          launcherLogger.warn('issue.comment_delivery_state_failed', {
            wsId,
            id,
            commentId: res.comment.id,
            error: updated.error,
          })
        }
      }
      launcherLogger.info('issue.comment_added', { wsId, id, author: 'human' })
      const detail = await svc.issueDetail(wsId, id)
      return c.json(detail ?? { issue: res.issue, comments: [res.comment], runs: [], inboxReports: [], provenance: [], activity: [] })
    } catch (err) {
      launcherLogger.warn('issue.comment_failed', { wsId, id, err })
      return c.json({ error: 'write_failed', message: (err as Error).message }, 500)
    }
  })

  return app
}
