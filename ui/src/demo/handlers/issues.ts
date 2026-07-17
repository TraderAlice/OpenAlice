import { http, HttpResponse } from 'msw'
import type { IssuePriority, IssueSnapshot, IssueStatus } from '../../api/issues'
import {
  demoIssueAddComment,
  demoIssueDetail,
  demoIssueRetry,
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
const auditFixture = (request: Request): string | null => request.headers.get('x-openalice-theme-audit-fixture')
  ?? (request.referrer ? new URL(request.referrer).searchParams.get('themeAuditFixture') : null)
const invalidAuditSnapshot: IssueSnapshot = {
  workspaces: [{ wsId: 'audit-invalid-workspace', tag: 'broken-audit-desk', status: 'invalid', error: 'Malformed issue frontmatter', issues: [] }],
  duplicateNames: [],
}
const auditBoardReads = new Map<string, number>()

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
  http.get('/api/issues', ({ request }) => {
    const fixture = auditFixture(request)
    if (fixture === 'issues-failed-health') {
      const snapshot = structuredClone(demoIssuesSnapshot)
      const source = snapshot.workspaces.flatMap((workspace) => workspace.issues ?? [])
        .filter((issue) => issue.when)
      const issues = [{
        ...structuredClone(source[0]!),
        id: 'audit-health-failed',
        title: 'Audit failed automation',
        automationHealth: { state: 'failed' as const, message: 'Audit failed scheduler state.' },
      }]
      return HttpResponse.json({ workspaces: [{ wsId: 'audit-health', tag: 'audit-health', status: 'ok', issues }], duplicateNames: [] } satisfies IssueSnapshot)
    }
    if (fixture === 'issues-due') {
      const due = structuredClone(demoIssuesSnapshot)
      const issue = due.workspaces.flatMap((workspace) => workspace.issues ?? []).find((candidate) => Boolean(candidate.when))
      if (issue) issue.automationHealth = { state: 'due', message: 'Audit scheduled run is due.' }
      return HttpResponse.json(due)
    }
    if (fixture === 'issues-stale') {
      const run = request.headers.get('x-openalice-theme-audit-run') ?? 'unknown'
      const reads = (auditBoardReads.get(run) ?? 0) + 1
      auditBoardReads.set(run, reads)
      if (reads > 1) return HttpResponse.json({ error: 'audit_stale_refresh' }, { status: 500 })
    }
    if (fixture === 'issues-error') return HttpResponse.json({ error: 'audit_issue_failure' }, { status: 500 })
    return HttpResponse.json(fixture === 'issues-invalid' ? invalidAuditSnapshot : demoIssuesSnapshot)
  }),

  http.get('/api/issues/:wsId/:id', ({ params, request }) => {
    if (auditFixture(request) === 'issue-detail-load-error') {
      return HttpResponse.json({ error: 'audit_detail_failure' }, { status: 500 })
    }
    const detail = demoIssueDetail(String(params.wsId), String(params.id))
    if (detail && auditFixture(request) === 'issue-runtime-failures') {
      const variant = structuredClone(detail)
      const base = variant.runs[0]!
      variant.runs = [
        {
          ...base,
          taskId: 'audit-paused-run',
          status: 'failed',
          failure: { kind: 'system_paused', title: 'Audit launcher pause', message: 'Audit retryable interruption.', retryable: true },
        },
        {
          ...base,
          taskId: 'audit-process-failure',
          status: 'failed',
          failure: { kind: 'process_exit', title: 'Audit process failure', message: 'Audit non-retryable process exit.', retryable: false },
        },
        ...variant.runs,
      ]
      return HttpResponse.json(variant)
    }
    if (detail && auditFixture(request) === 'issue-delivery-failed') {
      const variant = structuredClone(detail)
      const comment = {
        id: 'audit-delivery-failed', author: 'human', at: new Date().toISOString(), markdown: 'Audit failed delivery.',
        delivery: { state: 'failed' as const, targetResumeId: 'audit-owner', taskId: 'audit-delivery-task', error: 'Audit owner unavailable.' },
      }
      variant.activity = [{ kind: 'comment', id: comment.id, at: Date.now(), comment }, ...(variant.activity ?? [])]
      return HttpResponse.json(variant)
    }
    if (detail && auditFixture(request) === 'issue-status-variants') {
      const variant = structuredClone(detail)
      const base = variant.runs[0]
      if (base) {
        const { finishedAt: _finishedAt, durationMs: _durationMs, exitCode: _exitCode, ...runningBase } = base
        const running = { ...runningBase, taskId: 'audit-running', status: 'running' as const }
        const interrupted = { ...base, taskId: 'audit-interrupted', status: 'interrupted' as const }
        variant.runs = [running, interrupted, ...variant.runs]
      }
      return HttpResponse.json(variant)
    }
    if (detail && auditFixture(request) === 'issue-node-selection') {
      return HttpResponse.json({ ...detail, issue: { ...detail.issue, what: `${detail.issue.what}\n\n---\n\nAudit boundary` } })
    }
    if (detail && auditFixture(request) === 'issue-continue-error') {
      return HttpResponse.json({
        ...detail,
        activity: [{ kind: 'change', id: 'audit-session-change', action: 'updated', at: Date.now(), origin: { kind: 'session', workspaceId: String(params.wsId), resumeId: 'audit-resume-missing', agent: 'codex' } }, ...(detail.activity ?? [])],
      })
    }
    return detail
      ? HttpResponse.json(detail)
      : HttpResponse.json({ error: 'not_found' }, { status: 404 })
  }),

  http.patch('/api/issues/:wsId/:id', async ({ params, request }) => {
    if (auditFixture(request) === 'issue-property-error') return HttpResponse.json({ error: 'audit_property_failure' }, { status: 500 })
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
    if (auditFixture(request) === 'issue-comment-error') {
      return HttpResponse.json({ error: 'audit_comment_failure' }, { status: 500 })
    }
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

  http.post('/api/issues/:wsId/:id/retry', ({ params }) => {
    const detail = demoIssueRetry(String(params.wsId), String(params.id))
    return detail
      ? HttpResponse.json(detail, { status: 202 })
      : HttpResponse.json({
          error: 'not_retryable',
          message: 'Only the latest failed or interrupted scheduled run can be retried.',
        }, { status: 409 })
  }),
]
