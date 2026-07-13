import { http, HttpResponse } from 'msw'
import type { IssuePriority, IssueStatus } from '../../api/issues'
import {
  demoIssueAddComment,
  demoIssueDetail,
  demoIssueUpdate,
  demoIssuesSnapshot,
} from '../fixtures/issues'

// Enum allow-lists for the write path, kept in sync with the IssueStatus /
// IssuePriority unions in ../../api/issues (the `satisfies` pins them so adding a
// union member without listing it here is a type error). The real PATCH route
// validates against ISSUE_STATUSES / ISSUE_PRIORITIES the same way.
const ISSUE_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'canceled',
] as const satisfies readonly IssueStatus[]
const ISSUE_PRIORITIES = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
] as const satisfies readonly IssuePriority[]

const COMMENT_MAX = 16_000

// GET /api/issues returns the aggregated board SNAPSHOT (workspaces[].issues[]),
// produced server-side by scanning every workspace's `.alice/issues/<id>.md`
// dir — same shape family as /api/schedule, but the read-only board surface
// (no markdown body in the list; Phase 2 detail view loads it). The demo reads
// the live (mutable) snapshot so PATCH edits below show up on the board too.
//
// GET /api/issues/:wsId/:id is the Phase 2a DETAIL: one issue's full fields
// (body + scheduling frontmatter) + its headless run history (Activity feed).
// demoIssueDetail derives the display fields from the same board snapshot and
// returns null for an unknown (wsId, id) pair → 404 (mirrors the real route).
//
// PATCH /api/issues/:wsId/:id and POST /api/issues/:wsId/:id/comments are the
// Phase 2b write path: they mutate the in-memory fixture in place (status /
// priority / assignee on the board row, agent in detail extras; a `## Comments`
// block appended to the markdown body) and return the same `{ issue, runs }`
// detail shape as GET, so the demo reflects the change without a backend.
export const issuesHandlers = [
  http.get('/api/issues', () => HttpResponse.json(demoIssuesSnapshot)),

  http.get('/api/issues/:wsId/:id', ({ params }) => {
    const detail = demoIssueDetail(String(params.wsId), String(params.id))
    return detail
      ? HttpResponse.json(detail)
      : HttpResponse.json({ error: 'not_found' }, { status: 404 })
  }),

  http.patch('/api/issues/:wsId/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => null)) as {
      status?: unknown
      priority?: unknown
      assignee?: unknown
      agent?: unknown
      what?: unknown
    } | null
    if (!body || typeof body !== 'object') {
      return HttpResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const patch: { status?: IssueStatus; priority?: IssuePriority; assignee?: string; agent?: string | null; what?: string } = {}
    if (body.status !== undefined) {
      if (!ISSUE_STATUSES.includes(body.status as IssueStatus)) {
        return HttpResponse.json({ error: 'invalid_status' }, { status: 400 })
      }
      patch.status = body.status as IssueStatus
    }
    if (body.priority !== undefined) {
      if (!ISSUE_PRIORITIES.includes(body.priority as IssuePriority)) {
        return HttpResponse.json({ error: 'invalid_priority' }, { status: 400 })
      }
      patch.priority = body.priority as IssuePriority
    }
    if (body.assignee !== undefined) {
      if (typeof body.assignee !== 'string' || body.assignee.trim() === '') {
        return HttpResponse.json({ error: 'invalid_assignee' }, { status: 400 })
      }
      patch.assignee = body.assignee.trim()
    }
    if (body.agent !== undefined) {
      if (body.agent === null || body.agent === '') {
        patch.agent = null
      } else if (typeof body.agent !== 'string') {
        return HttpResponse.json({ error: 'invalid_agent' }, { status: 400 })
      } else {
        const agent = body.agent.trim()
        if (!['claude', 'codex', 'opencode', 'pi'].includes(agent)) {
          return HttpResponse.json({ error: 'invalid_agent' }, { status: 400 })
        }
        patch.agent = agent
      }
    }
    if (body.what !== undefined) {
      if (typeof body.what !== 'string' || !body.what.trim()) {
        return HttpResponse.json({ error: 'invalid_what' }, { status: 400 })
      }
      patch.what = body.what.trim()
    }
    if (
      patch.status === undefined &&
      patch.priority === undefined &&
      patch.assignee === undefined &&
      patch.agent === undefined
      && patch.what === undefined
    ) {
      return HttpResponse.json({ error: 'no_fields' }, { status: 400 })
    }

    const detail = demoIssueUpdate(String(params.wsId), String(params.id), patch)
    return detail
      ? HttpResponse.json(detail)
      : HttpResponse.json({ error: 'not_found' }, { status: 404 })
  }),

  http.post('/api/issues/:wsId/:id/comments', async ({ params, request }) => {
    const body = (await request.json().catch(() => null)) as { text?: unknown } | null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) {
      return HttpResponse.json({ error: 'text_required' }, { status: 400 })
    }
    if (text.length > COMMENT_MAX) {
      return HttpResponse.json({ error: 'text_too_long' }, { status: 400 })
    }

    // Human/UI path → author 'human' (the agent path stamps 'ws:<label>').
    const detail = demoIssueAddComment(String(params.wsId), String(params.id), 'human', text)
    return detail
      ? HttpResponse.json(detail)
      : HttpResponse.json({ error: 'not_found' }, { status: 404 })
  }),
]
