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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createIssuesRoutes } from './issues.js'
import type { InboxEntry } from '../../core/inbox-store.js'
import { detailIssue } from '../../workspaces/issues/board.js'
import { readWorkspaceIssues } from '../../workspaces/issues/declaration.js'
import { createIssue } from '../../workspaces/issues/mutate.js'
import type { WorkspaceService } from '../../workspaces/service.js'

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
  const svc = {
    registry: {
      get: (id: string) => (id === 'ws-1' ? { id: 'ws-1', dir: wsDir, tag: 'ws-1', agents: [] } : undefined),
    },
    issueDetail: async (wsId: string, id: string) => {
      if (wsId !== 'ws-1') return null
      const r = await readWorkspaceIssues(wsDir)
      if (!r.ok) return null
      const issue = r.issues.find((i) => i.id === id)
      return issue ? { issue: detailIssue(issue, null), runs: [], inboxReports } : null
    },
  } as unknown as WorkspaceService
  return createIssuesRoutes(svc)
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
    const app = build()
    expect((await req(app, 'PATCH', '/ws-1/bad.id', { status: 'done' })).status).toBe(404)
  })

  it('404 for an unknown workspace', async () => {
    const app = build()
    const r = await req(app, 'PATCH', '/ws-nope/x', { status: 'done' })
    expect(r.status).toBe(404)
  })

  it('404 for a missing issue in a real workspace', async () => {
    const app = build()
    const r = await req(app, 'PATCH', '/ws-1/ghost', { status: 'done' })
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('not_found')
  })

  it('400 invalid_status for an unknown status', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const app = build()
    const r = await req(app, 'PATCH', '/ws-1/i1', { status: 'nope' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('invalid_status')
  })

  it('400 no_fields when the body has none of the patchable fields', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const app = build()
    const r = await req(app, 'PATCH', '/ws-1/i1', { foo: 'bar' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('no_fields')
  })

  it('updates fields and returns the detail shape', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T', body: 'keep me' })
    const app = build()
    const r = await req(app, 'PATCH', '/ws-1/i1', { status: 'in_progress', priority: 'high', assignee: 'human' })
    expect(r.status).toBe(200)
    expect(r.body.issue).toMatchObject({
      id: 'i1',
      status: 'in_progress',
      priority: 'high',
      assignee: 'human',
      body: 'keep me',
    })
    expect(Array.isArray(r.body.runs)).toBe(true)
    // Persisted on disk.
    const re = await readWorkspaceIssues(wsDir)
    expect(re.ok && re.issues[0].status).toBe('in_progress')
  })
})

describe('GET /api/issues/:wsId/:id — inboxReports pass-through', () => {
  it('surfaces issueDetail.inboxReports verbatim', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const reports = [
      { id: 'e2', ts: 2, workspaceId: 'ws-1', comments: 'r2', origin: { kind: 'headless', runId: 'c', issueId: 'i1' } },
      { id: 'e1', ts: 1, workspaceId: 'ws-1', comments: 'r1', origin: { kind: 'headless', runId: 'a', issueId: 'i1' } },
    ] as unknown as InboxEntry[]
    const r = await req(build(reports), 'GET', '/ws-1/i1')
    expect(r.status).toBe(200)
    expect(r.body.inboxReports.map((e: any) => e.comments)).toEqual(['r2', 'r1'])
  })

  it('inboxReports defaults to [] when the issue produced none', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const r = await req(build(), 'GET', '/ws-1/i1')
    expect(r.status).toBe(200)
    expect(r.body.inboxReports).toEqual([])
  })
})

describe('POST /api/issues/:wsId/:id/comments', () => {
  it('400 text_required for a blank comment', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T' })
    const app = build()
    expect((await req(app, 'POST', '/ws-1/i1/comments', { text: '   ' })).body.error).toBe('text_required')
  })

  it('404 for a missing issue', async () => {
    const app = build()
    const r = await req(app, 'POST', '/ws-1/ghost/comments', { text: 'hi' })
    expect(r.status).toBe(404)
  })

  it('appends a human comment and returns the detail shape', async () => {
    await createIssue(wsDir, { id: 'i1', title: 'T', body: 'desc' })
    const app = build()
    const r = await req(app, 'POST', '/ws-1/i1/comments', { text: 'looks good' })
    expect(r.status).toBe(200)
    expect(r.body.issue.body).toContain('## Comments')
    expect(r.body.issue.body).toContain('**human**')
    expect(r.body.issue.body).toContain('looks good')
    expect(r.body.issue.body).toContain('desc')
  })
})
