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
 *   GET  /api/issues/:wsId/:id      → one issue's detail { issue, runs, inboxReports }
 *
 * Phase 2b adds the human/UI WRITE path (the agent edits the files directly /
 * via its own tools). Both writes go through the shared mutation helper
 * (`workspaces/issues/mutate.ts`) so the human and agent surfaces can never
 * drift on file format or validation; writes are working-tree only (no commit):
 *   PATCH /api/issues/:wsId/:id           body { status?, priority?, assignee? }
 *   POST  /api/issues/:wsId/:id/comments  body { text }  (author = 'human')
 *
 * Both return the same detail shape GET /api/issues/:wsId/:id does, so the UI
 * can swap its cache after an edit. They mirror the agent-config route's
 * validate → registry.get → write → json shape + logging.
 */
import { Hono } from 'hono'

import { ISSUE_PRIORITIES, ISSUE_STATUSES, type IssuePriority, type IssueStatus } from '../../workspaces/issues/declaration.js'
import { appendIssueComment, updateIssueFields } from '../../workspaces/issues/mutate.js'
import { isAgentRuntime } from '../../workspaces/cli-adapter.js'
import { logger as launcherLogger } from '../../workspaces/logger.js'
import type { WorkspaceService } from '../../workspaces/service.js'

/** Upper bound on a single comment's text (matches the headless seed cap). */
const MAX_COMMENT = 16000

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

export function createIssuesRoutes(svc: WorkspaceService): Hono {
  const app = new Hono()

  // GET /api/issues → { workspaces: [{ wsId, tag, status, error?, issues: [...] }] }
  app.get('/', async (c) => {
    return c.json(await svc.issuesSnapshot())
  })

  // GET /api/issues/:wsId/:id → { issue: {...incl. body + markers}, runs: [...],
  // inboxReports: [...] }. The issue→inbox join lives in svc.issueDetail (domain),
  // so this route is a thin pass-through. 404 when the workspace or the issue id
  // is absent (mirrors the workspaces route convention: `{ error: 'not_found' }`).
  app.get('/:wsId/:id', async (c) => {
    const detail = await svc.issueDetail(c.req.param('wsId'), c.req.param('id'))
    if (!detail) return c.json({ error: 'not_found' }, 404)
    return c.json(detail)
  })

  // PATCH /api/issues/:wsId/:id — patch board fields { status?, priority?,
  // assignee? } plus the scheduled runtime override { agent? } on one issue
  // (the human/UI path). `agent: null` removes the override so future fires use
  // the workspace default runtime. Other scheduling frontmatter (when/what)
  // stays file-owned. Returns the updated detail shape; 404 when missing.
  app.patch('/:wsId/:id', async (c) => {
    const wsId = c.req.param('wsId')
    const id = c.req.param('id')
    if (!validId(wsId) || !validId(id)) return c.json({ error: 'not_found' }, 404)
    const meta = svc.registry.get(wsId)
    if (!meta) return c.json({ error: 'not_found' }, 404)

    const body = await safeJson(c)
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const patch: { status?: IssueStatus; priority?: IssuePriority; assignee?: string; agent?: string | null } = {}
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
      if (typeof a !== 'string' || a.trim().length === 0) {
        return c.json({ error: 'invalid_assignee', message: 'assignee must be a non-empty string' }, 400)
      }
      patch.assignee = a.trim()
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
    if (Object.keys(patch).length === 0) {
      return c.json({ error: 'no_fields', message: 'provide at least one of status, priority, assignee, agent' }, 400)
    }

    try {
      const res = await updateIssueFields(meta.dir, id, patch)
      if (!res.ok) {
        if (res.reason === 'not_found') return c.json({ error: 'not_found' }, 404)
        return c.json({ error: 'invalid_issue', message: res.error }, 422)
      }
      await svc.provenanceStore.append({
        artifact: { kind: 'issue', workspaceId: wsId, issueId: id },
        action: 'updated',
        origin: { kind: 'human' },
        at: Date.now(),
      })
      launcherLogger.info('issue.updated', { wsId, id, fields: Object.keys(patch) })
      const detail = await svc.issueDetail(wsId, id)
      return c.json(detail ?? { issue: res.issue, runs: [], inboxReports: [] })
    } catch (err) {
      launcherLogger.warn('issue.update_failed', { wsId, id, err })
      return c.json({ error: 'write_failed', message: (err as Error).message }, 500)
    }
  })

  // POST /api/issues/:wsId/:id/comments — append a comment to the issue body
  // under the stable `## Comments` section. Author is fixed to 'human' here
  // (the agent path stamps 'ws:<label>'). Returns the updated detail shape.
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
      launcherLogger.info('issue.comment_added', { wsId, id, author: 'human' })
      const detail = await svc.issueDetail(wsId, id)
      return c.json(detail ?? { issue: res.issue, runs: [], inboxReports: [] })
    } catch (err) {
      launcherLogger.warn('issue.comment_failed', { wsId, id, err })
      return c.json({ error: 'write_failed', message: (err as Error).message }, 500)
    }
  })

  return app
}
