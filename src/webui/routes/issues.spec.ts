/**
 * PATCH /api/issues/:wsId/:id + POST /api/issues/:wsId/:id/comments — the
 * human/UI write path. Drives the routes against a stubbed WorkspaceService
 * whose `registry.get` points at a REAL temp workspace dir (so the shared
 * mutation helper actually reads/writes files) and whose `issueDetail` re-reads
 * that dir through the production reader. Modeled on headless.spec's harness.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createIssuesRoutes } from './issues.js'
import type { InboxEntry } from '../../core/inbox-store.js'
import { detailIssue } from '../../workspaces/issues/board.js'
import { readWorkspaceIssues } from '../../workspaces/issues/declaration.js'
import { createIssue } from '../../workspaces/issues/mutate.js'
import { readIssueComments } from '../../workspaces/issues/comments.js'
import { IssueRetryError, type WorkspaceService } from '../../workspaces/service.js'
import type { WorkspaceConversationControl } from '../../core/workspace-tool-center.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

let wsDir: string
beforeEach(async () => {
  wsDir = await mkdtemp(join(tmpdir(), 'issues-route-'))
})
afterEach(async () => {
  await rm(wsDir, { recursive: true, force: true })
})

// The inbox→issue JOIN now lives in svc.issueDetail (domain) — see board.spec's
// `inboxReportsForIssue` test. Here the route is a thin pass-through, so the stub
// just echoes whatever inboxReports it's handed.
function build(inboxReports: InboxEntry[] = []) {
  const appendProvenance = vi.fn(async (input) => ({ id: 'p-1', ...input }))
  const ask = vi.fn(async () => ({
    status: 'dispatched' as const,
    taskId: 'run-comment-reply',
    resumeId: 'resume-kind-owl-abc123',
    workspaceId: 'ws-1',
    workspace: 'ws-1',
    agent: 'codex',
    resolution: {
      mode: 'exact' as const,
      origin: {
        kind: 'session' as const,
        workspaceId: 'ws-1',
        resumeId: 'resume-kind-owl-abc123',
        agent: 'codex',
      },
    },
  }))
  const conversation = { ask, read: vi.fn() } as unknown as WorkspaceConversationControl
  const readDetail = async (wsId: string, id: string) => {
    if (wsId !== 'ws-1') return null
    const r = await readWorkspaceIssues(wsDir)
    if (!r.ok) return null
    const issue = r.issues.find((i) => i.id === id)
    if (!issue) return null
    const comments = await readIssueComments(wsDir, id)
    return { issue: detailIssue(issue, null), comments: comments.ok ? comments.comments : [], runs: [], inboxReports, provenance: [], activity: [] }
  }
  const retryIssue = vi.fn(async (wsId: string, id: string) => {
    const detail = await readDetail(wsId, id)
    if (!detail) throw new IssueRetryError('not_found', 'Issue not found.')
    return detail
  })
  const svc = {
    registry: {
      get: (id: string) => (
        id === 'ws-1'
          ? { id: 'ws-1', dir: wsDir, tag: 'ws-1', agents: ['claude', 'codex', 'pi', 'shell'] }
          : undefined
      ),
    },
    adapters: {
      get: (id: string) => {
        if (id === 'shell') return { id: 'shell', displayName: 'Shell', kind: 'utility' }
        if (id === 'claude' || id === 'codex' || id === 'pi') return { id, displayName: id }
        return undefined
      },
    },
    resumeRegistry: {
      get: (resumeId: string) => resumeId === 'resume-kind-owl-abc123'
        ? { resumeId, wsId: 'ws-1', agent: 'codex', agentSessionId: 'native-1', createdAt: 1, updatedAt: 1 }
        : resumeId === 'resume-unready'
          ? { resumeId, wsId: 'ws-1', agent: 'codex', createdAt: 1, updatedAt: 1 }
        : null,
    },
    issueDetail: readDetail,
    retryIssue,
    provenanceStore: { append: appendProvenance, list: vi.fn(), latest: vi.fn() },
  } as unknown as WorkspaceService
  return { app: createIssuesRoutes(svc, { conversation }), appendProvenance, retryIssue, ask }
}

async function req(app: any, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, body: json as any }
}

describe('PATCH /api/issues/:wsId/:id', () => {
  it('404 on a malformed id', async () => {
    const { app } = build()
    expect((await req(app, 'PATCH', '/ws-1/bad.id', { status: 'done' })).status).toBe(404)
  })

  it('404 for an unknown workspace', async () => {
    const { app } = build()
    const r = await req(app, 'PATCH', '/ws-nope/x', { status: 'done' })
    expect(r.status).toBe(404)
  })

  it('404 for a missing issue in a real workspace', async () => {
    const { app } = build()
    const r = await req(app, 'PATCH', '/ws-1/ghost', { status: 'done' })
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('not_found')
  })

  it('400 invalid_status for an unknown status', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const { app } = build()
    const r = await req(app, 'PATCH', '/ws-1/i1', { status: 'nope' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('invalid_status')
  })

  it('400 invalid_agent for an unknown or utility runtime', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const { app } = build()
    expect((await req(app, 'PATCH', '/ws-1/i1', { agent: 'nope' })).body.error).toBe('invalid_agent')
    expect((await req(app, 'PATCH', '/ws-1/i1', { agent: 'shell' })).body.error).toBe('invalid_agent')
  })

  it('400 invalid_effort for an unsupported value', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const { app } = build()
    const r = await req(app, 'PATCH', '/ws-1/i1', { effort: 'extreme' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('invalid_effort')
  })

  it('validates and persists explicit scheduled ownership', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T', when: { kind: 'every', every: '1h' } })
    const { app } = build()
    const invalid = await req(app, 'PATCH', '/ws-1/i1', { assignee: 'session:' })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error).toBe('invalid_assignee')

    const updated = await req(app, 'PATCH', '/ws-1/i1', {
      assignee: '@resume-kind-owl-abc123',
    })
    expect(updated.status).toBe(200)
    expect(updated.body.issue.assignee).toBe('@resume-kind-owl-abc123')
  })

  it('409 when the selected Session assignee is not resumable yet', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T', when: { kind: 'every', every: '1h' } })
    const { app } = build()
    const unavailable = await req(app, 'PATCH', '/ws-1/i1', {
      assignee: '@resume-unready',
    })
    expect(unavailable.status).toBe(409)
    expect(unavailable.body.error).toBe('unavailable_assignee_session')
  })

  it('400 no_fields when the body has none of the patchable fields', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const { app } = build()
    const r = await req(app, 'PATCH', '/ws-1/i1', { foo: 'bar' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('no_fields')
  })

  it('updates fields including the scheduled agent runtime and returns the detail shape', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T', body: 'keep me' })
    const { app, appendProvenance } = build()
    const r = await req(app, 'PATCH', '/ws-1/i1', {
      status: 'in_progress',
      priority: 'high',
      assignee: '@human',
      agent: 'pi',
      model: 'gemini-3.5-pro',
      effort: 'high',
      what: 'new exact work',
    })
    expect(r.status).toBe(200)
    expect(r.body.issue).toMatchObject({
      id: 'i1',
      status: 'in_progress',
      priority: 'high',
      assignee: '@human',
      agent: 'pi',
      model: 'gemini-3.5-pro',
      effort: 'high',
      what: 'new exact work',
    })
    expect(Array.isArray(r.body.runs)).toBe(true)
    // Persisted on disk.
    const re = await readWorkspaceIssues(wsDir)
    expect(re.ok && re.issues[0].status).toBe('in_progress')
    expect(re.ok && re.issues[0].agent).toBe('pi')
    expect(re.ok && re.issues[0].model).toBe('gemini-3.5-pro')
    expect(re.ok && re.issues[0].effort).toBe('high')
    expect(re.ok && re.issues[0].what).toBe('new exact work')
    expect(appendProvenance).toHaveBeenCalledWith(expect.objectContaining({
      artifact: { kind: 'issue', workspaceId: 'ws-1', issueId: 'i1' },
      action: 'updated',
      origin: { kind: 'human' },
      mutation: {
        fields: expect.arrayContaining([
          { field: 'status', before: 'todo', after: 'in_progress' },
          { field: 'priority', before: 'none', after: 'high' },
          { field: 'assignee', before: '@workspace', after: '@human' },
          { field: 'runtime', after: 'pi' },
          { field: 'model', after: 'gemini-3.5-pro' },
          { field: 'effort', after: 'high' },
          { field: 'what' },
        ]),
      },
    }), { coalesceWithinMs: 900000 })
  })

  it('clears the scheduled agent runtime with null', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T', agent: 'claude' })
    const { app } = build()
    const r = await req(app, 'PATCH', '/ws-1/i1', { agent: null })
    expect(r.status).toBe(200)
    expect(r.body.issue.agent).toBeUndefined()
    const re = await readWorkspaceIssues(wsDir)
    expect(re.ok && re.issues[0].agent).toBeUndefined()
  })
})

describe('GET /api/issues/:wsId/:id — inboxReports pass-through', () => {
  it('surfaces issueDetail.inboxReports verbatim', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const reports = [
      { id: 'e2', ts: 2, workspaceId: 'ws-1', comments: 'r2', origin: { kind: 'headless', runId: 'c', issueId: 'i1' } },
      { id: 'e1', ts: 1, workspaceId: 'ws-1', comments: 'r1', origin: { kind: 'headless', runId: 'a', issueId: 'i1' } },
    ] as unknown as InboxEntry[]
    const r = await req(build(reports).app, 'GET', '/ws-1/i1')
    expect(r.status).toBe(200)
    expect(r.body.inboxReports.map((e: any) => e.comments)).toEqual(['r2', 'r1'])
  })

  it('inboxReports defaults to [] when the issue produced none', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const r = await req(build().app, 'GET', '/ws-1/i1')
    expect(r.status).toBe(200)
    expect(r.body.inboxReports).toEqual([])
  })
})

describe('POST /api/issues/:wsId/:id/retry', () => {
  it('returns the authoritative detail with 202', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T', when: { kind: 'every', every: '1h' } })
    const { app, retryIssue } = build()
    const r = await req(app, 'POST', '/ws-1/i1/retry')
    expect(r.status).toBe(202)
    expect(r.body.issue.id).toBe('i1')
    expect(retryIssue).toHaveBeenCalledWith('ws-1', 'i1')
  })

  it('maps retry conflicts to an actionable response', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T', when: { kind: 'every', every: '1h' } })
    const { app, retryIssue } = build()
    retryIssue.mockRejectedValueOnce(new IssueRetryError('already_running', 'This Issue already has a run in progress.'))
    const r = await req(app, 'POST', '/ws-1/i1/retry')
    expect(r.status).toBe(409)
    expect(r.body).toEqual({
      error: 'already_running',
      message: 'This Issue already has a run in progress.',
    })
  })
})

describe('POST /api/issues/:wsId/:id/comments', () => {
  it('400 text_required for a blank comment', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const { app } = build()
    expect((await req(app, 'POST', '/ws-1/i1/comments', { text: '   ' })).body.error).toBe('text_required')
  })

  it('404 for a missing issue', async () => {
    const { app } = build()
    const r = await req(app, 'POST', '/ws-1/ghost/comments', { text: 'hi' })
    expect(r.status).toBe(404)
  })

  it('appends a human comment and returns the detail shape', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T', body: 'desc' })
    const { app, appendProvenance } = build()
    const r = await req(app, 'POST', '/ws-1/i1/comments', { text: 'looks good' })
    expect(r.status).toBe(200)
    expect(r.body.issue.what).toBe('desc')
    expect(r.body.comments).toEqual([
      expect.objectContaining({ author: 'human', markdown: 'looks good' }),
    ])
    expect(appendProvenance).toHaveBeenCalledWith(expect.objectContaining({
      action: 'commented',
      origin: { kind: 'human' },
    }))
  })

  it('notifies the fixed owner and persists pending delivery without blocking the comment', async () => {
    await createIssue(wsDir, {
      id: 'i1',
      title: 'T',
      assignee: '@resume-kind-owl-abc123',
    })
    const { app, ask } = build()
    const r = await req(app, 'POST', '/ws-1/i1/comments', { text: 'please explain' })
    expect(r.status).toBe(200)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'resume', resumeId: 'resume-kind-owl-abc123' },
      subject: expect.objectContaining({ kind: 'issue', issueId: 'i1', commentId: expect.any(String) }),
    }))
    expect(r.body.comments[0].delivery).toEqual({
      state: 'pending',
      targetResumeId: 'resume-kind-owl-abc123',
      taskId: 'run-comment-reply',
    })
  })
})
