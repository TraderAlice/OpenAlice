import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Tool } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { readWorkspaceIssues } from '../workspaces/issues/declaration.js'
import { readIssueComments } from '../workspaces/issues/comments.js'
import type {
  IssueDetail,
  IssuesSnapshot,
  WikilinkIssueRef,
} from '../workspaces/issues/board.js'
import {
  issueCommentFactory,
  issueCreateFactory,
  issueListFactory,
  issueShowFactory,
  issueUpdateFactory,
} from './issue-tools.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'issue-tools-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Context whose `resolveWorkspace(self)` points at the temp checkout dir. */
function ctx(over: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return {
    workspaceId: 'ws-self',
    workspaceLabel: 'auto-quant',
    inboxStore: {} as never,
    entityStore: {} as never,
    resolveWorkspace: (id) => (id === 'ws-self' ? { id, dir, tag: 'auto-quant' } : null),
    ...over,
  }
}

async function run(tool: Tool, args: Record<string, unknown>) {
  return (await tool.execute!(args, { toolCallId: 't', messages: [] })) as Record<string, unknown> & {
    ok: boolean
    error?: string
  }
}

/** Round-trip oracle: read one issue back through the production reader. */
async function readBack(id: string) {
  const r = await readWorkspaceIssues(dir)
  if (!r.ok) throw new Error(`readWorkspaceIssues not ok: ${JSON.stringify(r)}`)
  return r.issues.find((i) => i.id === id)
}

describe('issue_create', () => {
  it('creates an issue, stamps the workspace assignee, and is reachable via the reader', async () => {
    const res = await run(issueCreateFactory.build(ctx()), { title: 'Fix the thing' })
    expect(res.ok).toBe(true)
    expect(res.issue).toMatchObject({ id: 'fix-the-thing', title: 'Fix the thing', assignee: '@workspace' })
    const issue = await readBack('fix-the-thing')
    expect(issue?.title).toBe('Fix the thing')
  })

  it('records the creating product Session without accepting identity args', async () => {
    const append = vi.fn(async (input) => ({ id: 'p-1', ...input }))
    const context = ctx({
      provenanceStore: { append, list: vi.fn(), latest: vi.fn() },
      origin: {
        kind: 'interactive',
        sessionId: 'surface-1',
        resumeId: 'resume-1',
        agent: 'codex',
      },
    })
    await run(issueCreateFactory.build(context), { id: 'owned', title: 'Owned issue' })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      artifact: { kind: 'issue', workspaceId: 'ws-self', issueId: 'owned' },
      action: 'created',
      origin: {
        kind: 'session',
        workspaceId: 'ws-self',
        resumeId: 'resume-1',
        agent: 'codex',
        execution: { kind: 'interactive', sessionRecordId: 'surface-1' },
      },
    }))
  })

  it('refuses to overwrite an existing id (conflict → clean error)', async () => {
    await run(issueCreateFactory.build(ctx()), { id: 'dup', title: 'one' })
    const res = await run(issueCreateFactory.build(ctx()), { id: 'dup', title: 'two' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/already exists/)
  })

  it('defaults scheduled work to Workspace ownership', async () => {
    const created = await run(issueCreateFactory.build(ctx()), {
      id: 'fresh-owner',
      title: 'Fresh owner',
      when: { kind: 'every', every: '30m' },
    })
    expect(created.ok).toBe(true)
    expect((await readBack('fresh-owner'))?.assignee).toBe('@workspace')
  })

  it('defaults creation to the server-attributed current Session', async () => {
    const context = ctx({
      origin: {
        kind: 'interactive',
        sessionId: 'surface-1',
        resumeId: 'resume-kind-owl-abc123',
        agent: 'codex',
      },
      resolveSessionIdentity: () => ({ workspaceId: 'ws-self', agent: 'codex', resumable: true }),
    })
    const created = await run(issueCreateFactory.build(context), {
      id: 'owned-schedule',
      title: 'Owned schedule',
      when: { kind: 'every', every: '30m' },
    })
    expect(created.ok).toBe(true)
    expect((await readBack('owned-schedule'))?.assignee)
      .toBe('@resume-kind-owl-abc123')

    const explicit = await run(issueCreateFactory.build(context), {
      id: 'owned-explicit', title: 'Owned explicit', assignee: '@me',
    })
    expect(explicit.ok).toBe(true)
    expect((await readBack('owned-explicit'))?.assignee).toBe('@resume-kind-owl-abc123')
  })

  it('does not make a non-resumable Shell PTY the implicit owner', async () => {
    const context = ctx({
      origin: {
        kind: 'interactive',
        sessionId: 'shell-surface',
        resumeId: 'resume-shell-terminal',
        agent: 'shell',
      },
      resolveSessionIdentity: () => ({ workspaceId: 'ws-self', agent: 'shell', resumable: false }),
    })

    const implicit = await run(issueCreateFactory.build(context), {
      id: 'shell-created', title: 'Shell-created issue',
    })
    expect(implicit.ok).toBe(true)
    expect((await readBack('shell-created'))?.assignee).toBe('@workspace')

    const explicit = await run(issueCreateFactory.build(context), {
      id: 'shell-owned', title: 'Invalid shell owner', assignee: '@me',
    })
    expect(explicit.ok).toBe(false)
    expect(explicit.error).toMatch(/not resumable yet/)
  })

  it('allows assigning an exact signed Session from another workspace', async () => {
    const context = ctx({
      resolveSessionIdentity: () => ({ workspaceId: 'ws-peer', agent: 'pi', resumable: true }),
    })
    const result = await run(issueCreateFactory.build(context), {
      id: 'foreign-owner',
      title: 'Foreign owner',
      when: { kind: 'every', every: '30m' },
      assignee: '@resume-peer',
    })
    expect(result.ok).toBe(true)
  })

  it('refuses to assign a Session that has no resumable runtime identity yet', async () => {
    const context = ctx({
      resolveSessionIdentity: () => ({ workspaceId: 'ws-self', agent: 'pi', resumable: false }),
    })
    const result = await run(issueCreateFactory.build(context), {
      id: 'unready-owner',
      title: 'Unready owner',
      when: { kind: 'every', every: '30m' },
      assignee: '@resume-unready',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not resumable yet/)
  })
})

describe('issue_update', () => {
  it('updates canonical What while preserving scheduling', async () => {
    await run(issueCreateFactory.build(ctx()), {
      id: 'sched',
      title: 'scheduled work',
      when: { kind: 'every', every: '30m' },
      assignee: '@workspace',
      what: 'keep me',
    })
    const res = await run(issueUpdateFactory.build(ctx()), {
      id: 'sched', status: 'in_progress', priority: 'high', what: 'new exact work',
    })
    expect(res.ok).toBe(true)
    const issue = await readBack('sched')
    expect(issue).toMatchObject({ status: 'in_progress', priority: 'high', what: 'new exact work' })
    // scheduling frontmatter survives a board-field patch
    expect(issue?.when).toEqual({ kind: 'every', every: '30m' })
  })

  it('records successful mutations but not rejected ones', async () => {
    const append = vi.fn(async (input) => ({ id: 'p-1', ...input }))
    const context = ctx({ provenanceStore: { append, list: vi.fn(), latest: vi.fn() } })
    await run(issueCreateFactory.build(context), { id: 'trail', title: 'trail' })
    append.mockClear()
    await run(issueUpdateFactory.build(context), { id: 'trail', status: 'in_progress' })
    await run(issueUpdateFactory.build(context), { id: 'missing', status: 'done' })
    expect(append).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'updated' }),
      { coalesceWithinMs: 900000 },
    )
  })

  it('errors with no fields to update', async () => {
    await run(issueCreateFactory.build(ctx()), { id: 'x', title: 'x' })
    const res = await run(issueUpdateFactory.build(ctx()), { id: 'x' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no fields/)
  })

  it('returns a not-found error for a missing issue (never throws)', async () => {
    const res = await run(issueUpdateFactory.build(ctx()), { id: 'ghost', status: 'done' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no such issue/)
  })
})

describe('issue_comment', () => {
  it('appends a ws-authored structured markdown comment', async () => {
    await run(issueCreateFactory.build(ctx()), { id: 'c1', title: 'commentable', what: 'desc' })
    const res = await run(issueCommentFactory.build(ctx()), { id: 'c1', text: 'progress note' })
    expect(res.ok).toBe(true)
    const comments = await readIssueComments(dir, 'c1')
    expect(comments.ok && comments.comments[0]).toMatchObject({ author: 'ws:auto-quant', markdown: 'progress note' })
  })

  it('signs the commenter Session and notifies a different fixed owner', async () => {
    await run(issueCreateFactory.build(ctx()), {
      id: 'owned-comment', title: 'Owned comment', assignee: '@resume-owner',
    })
    const ask = vi.fn(async () => ({
      status: 'dispatched' as const,
      taskId: 'run-reply',
      resumeId: 'resume-owner',
      workspaceId: 'ws-owner',
      workspace: 'owner-desk',
      agent: 'pi',
      resolution: {
        mode: 'exact' as const,
        origin: { kind: 'session' as const, workspaceId: 'ws-owner', resumeId: 'resume-owner', agent: 'pi' },
      },
    }))
    const context = ctx({
      origin: {
        kind: 'interactive', sessionId: 'surface-1', resumeId: 'resume-commenter', agent: 'codex',
      },
      conversation: { ask, read: vi.fn() },
    })
    const res = await run(issueCommentFactory.build(context), {
      id: 'owned-comment', text: 'What changed?',
    })
    expect(res.ok).toBe(true)
    const comments = await readIssueComments(dir, 'owned-comment')
    expect(comments.ok && comments.comments[0]).toMatchObject({
      author: '@resume-commenter',
      delivery: { state: 'pending', targetResumeId: 'resume-owner', taskId: 'run-reply' },
    })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'resume', resumeId: 'resume-owner' },
      subject: expect.objectContaining({ commentId: expect.any(String) }),
    }))
  })

  it('errors cleanly on a missing issue', async () => {
    const res = await run(issueCommentFactory.build(ctx()), { id: 'nope', text: 'hi' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no such issue/)
  })
})

describe('issue_list / issue_show', () => {
  it('lists compact rows and shows one in full', async () => {
    await run(issueCreateFactory.build(ctx()), { id: 'a', title: 'Alpha', priority: 'high' })
    await run(issueCreateFactory.build(ctx()), { id: 'b', title: 'Beta' })
    const list = await run(issueListFactory.build(ctx()), { mode: 'detailed' })
    expect(list.ok).toBe(true)
    expect((list.issues as Array<{ id: string }>).map((i) => i.id).sort()).toEqual(['a', 'b'])

    const show = await run(issueShowFactory.build(ctx()), { id: 'a' })
    expect(show.ok).toBe(true)
    expect(show.issue).toMatchObject({ id: 'a', title: 'Alpha', priority: 'high' })
  })

  it('issue_list returns empty (not an error) when no issues dir exists', async () => {
    const list = await run(issueListFactory.build(ctx()), {})
    expect(list.ok).toBe(true)
    expect(list.mode).toBe('summary')
    expect(list.issues).toEqual([])
  })

  it('issue_show errors on a missing issue', async () => {
    const res = await run(issueShowFactory.build(ctx()), { id: 'missing' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no such issue/)
  })
})

describe('global board (ctx.board present)', () => {
  // A two-workspace snapshot: one valid pair + a colliding name ("Shared") in
  // both, plus a workspace whose issues dir failed to read.
  const snapshot: IssuesSnapshot = {
    workspaces: [
      {
        wsId: 'ws-a',
        tag: 'auto-quant',
        status: 'ok',
        issues: [
          { id: 'alpha', title: 'Alpha', status: 'todo', priority: 'high', assignee: '@human' },
          {
            id: 'shared-a',
            title: 'Shared',
            status: 'in_progress',
            priority: 'none',
            assignee: '@workspace',
            when: { kind: 'every', every: '30m' },
            nameCollision: true,
          },
        ],
      },
      {
        wsId: 'ws-b',
        tag: 'research',
        status: 'ok',
        issues: [
          {
            id: 'shared-b',
            title: 'Shared',
            status: 'todo',
            priority: 'low',
            assignee: '@unassigned',
            nameCollision: true,
          },
        ],
      },
      { wsId: 'ws-c', tag: 'broken', status: 'invalid', error: 'retired .alice/issue.json', issues: [] },
    ],
    duplicateNames: ['Shared'],
  }

  const detailFor: Record<string, IssueDetail> = {
    'ws-a/alpha': {
      issue: {
        id: 'alpha',
        title: 'Alpha',
        what: 'the alpha body',
        status: 'todo',
        priority: 'high',
        assignee: '@human',
      },
      comments: [],
      runs: [],
      inboxReports: [],
      provenance: [],
      activity: [],
    },
  }

  function boardCtx(over: Partial<WorkspaceToolContext['board']> = {}) {
    const board: NonNullable<WorkspaceToolContext['board']> = {
      snapshot: async () => snapshot,
      detail: async (wsId, id) => detailFor[`${wsId}/${id}`] ?? null,
      resolveByName: async (name) => {
        const token = name.trim().toLowerCase()
        const refs: WikilinkIssueRef[] = []
        for (const ws of snapshot.workspaces) {
          for (const issue of ws.issues) {
            if (issue.id.toLowerCase() === token || issue.title.trim().toLowerCase() === token) {
              refs.push({ wsId: ws.wsId, wsTag: ws.tag, id: issue.id, title: issue.title })
            }
          }
        }
        return refs
      },
      ...over,
    }
    return ctx({
      workspaceId: 'ws-a',
      workspaceLabel: 'auto-quant',
      resolveWorkspace: (id) => (id === 'ws-a' ? { id, dir, tag: 'auto-quant' } : null),
      board,
    })
  }

  it('issue_list flattens rows across every workspace, tags collisions, surfaces invalid', async () => {
    const list = await run(issueListFactory.build(boardCtx()), { mode: 'detailed' })
    expect(list.ok).toBe(true)
    const rows = list.issues as Array<{
      id: string
      workspace: { wsId: string; tag: string }
      scheduled: boolean
      nameCollision?: boolean
    }>
    expect(rows.map((r) => r.id).sort()).toEqual(['alpha', 'shared-a', 'shared-b'])
    // workspace handle rides each row
    expect(rows.find((r) => r.id === 'alpha')?.workspace).toEqual({ wsId: 'ws-a', tag: 'auto-quant' })
    // scheduled collapses `when`
    expect(rows.find((r) => r.id === 'shared-a')?.scheduled).toBe(true)
    expect(rows.find((r) => r.id === 'alpha')?.scheduled).toBe(false)
    // cross-workspace name clash flagged
    expect(rows.find((r) => r.id === 'shared-a')?.nameCollision).toBe(true)
    expect(rows.find((r) => r.id === 'shared-b')?.nameCollision).toBe(true)
    // unreadable workspace surfaced, not dropped
    expect(list.invalid).toEqual([{ wsId: 'ws-c', tag: 'broken', error: 'retired .alice/issue.json' }])
  })

  it('redirects a failed local write to the attributable cross-workspace ask flow', async () => {
    const result = await run(issueCommentFactory.build(boardCtx()), {
      id: 'shared-b',
      text: 'why?',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('writes only this workspace')
    expect(result.error).toContain('issue ask --id "shared-b" --owner')
    expect(result.error).toContain('--await')
  })

  it('issue_list summary hides low-priority global noise but keeps local issues', async () => {
    const list = await run(issueListFactory.build(boardCtx()), {})
    expect(list.ok).toBe(true)
    expect(list.mode).toBe('summary')
    expect(list.issues).toEqual([
      expect.objectContaining({
        id: 'alpha',
        priority: 'high',
        workspace: 'auto-quant',
      }),
      expect.objectContaining({
        id: 'shared-a',
        priority: 'none',
        workspace: 'auto-quant',
        nameCollision: true,
      }),
    ])
    expect(list.summary).toMatchObject({
      total: 3,
      focus: 2,
      hiddenActive: 1,
      hiddenLowPriority: 1,
      terminal: 0,
      invalid: 1,
    })
    expect(list.hint).toMatch(/--mode detailed/)
  })

  it('issue_show returns full detail for a unique name', async () => {
    const show = await run(issueShowFactory.build(boardCtx()), { id: 'Alpha' })
    expect(show.ok).toBe(true)
    expect(show.mode).toBe('summary')
    expect(show.issue).toMatchObject({ id: 'alpha', what: 'the alpha body' })
    expect(show.runs).toEqual([])
    expect(show.inboxReports).toEqual([])
    expect(show.ambiguous).toBeUndefined()
  })

  it('issue_show keeps repeated prompts out of summary mode but includes them on request', async () => {
    const detail: IssueDetail = {
      issue: {
        id: 'alpha', title: 'Alpha', what: 'one canonical prompt', status: 'todo',
        priority: 'high', assignee: '@human',
      },
      comments: [],
      runs: [{
        taskId: 'task-1', resumeId: 'resume-kind-owl-abc123', wsId: 'ws-a', issueId: 'alpha',
        agent: 'codex', prompt: 'large repeated execution prompt', status: 'done', startedAt: 1,
        resumable: true,
      }],
      inboxReports: [],
      provenance: [{
        id: 'p-1', action: 'created', at: 1,
        origin: { kind: 'session', workspaceId: 'ws-a', resumeId: 'resume-kind-owl-abc123', agent: 'codex' },
      }],
      activity: [],
    }
    const context = boardCtx({ detail: async () => detail })

    const summary = await run(issueShowFactory.build(context), { id: 'Alpha' })
    expect(JSON.stringify(summary)).not.toContain('large repeated execution prompt')
    expect(summary.runs).toEqual([expect.objectContaining({
      taskId: 'task-1', resumeId: 'resume-kind-owl-abc123', resumable: true,
    })])
    expect(summary.provenance).toEqual([expect.objectContaining({
      action: 'created',
      origin: expect.objectContaining({ resumeId: 'resume-kind-owl-abc123' }),
    })])

    const detailed = await run(issueShowFactory.build(context), { id: 'Alpha', mode: 'detailed' })
    expect(JSON.stringify(detailed)).toContain('large repeated execution prompt')
  })

  it('issue_show returns an ambiguous candidate list for a colliding name', async () => {
    const show = await run(issueShowFactory.build(boardCtx()), { id: 'shared' })
    expect(show.ok).toBe(true)
    expect(show.issue).toBeUndefined()
    expect(show.ambiguous).toEqual([
      { wsId: 'ws-a', wsTag: 'auto-quant', id: 'shared-a', title: 'Shared' },
      { wsId: 'ws-b', wsTag: 'research', id: 'shared-b', title: 'Shared' },
    ])
  })

  it('issue_show falls back to a self-file read when the global board has no match', async () => {
    // Write a local-only issue; the global resolver returns 0 → self read finds it.
    await run(issueCreateFactory.build(ctx()), { id: 'local-only', title: 'Local Only' })
    const show = await run(issueShowFactory.build(boardCtx()), { id: 'local-only' })
    expect(show.ok).toBe(true)
    expect(show.issue).toMatchObject({ id: 'local-only', title: 'Local Only' })
  })

  it('issue_show errors not_found when neither the board nor the self files match', async () => {
    const show = await run(issueShowFactory.build(boardCtx()), { id: 'ghost' })
    expect(show.ok).toBe(false)
    expect(show.error).toMatch(/no such issue/)
  })
})

describe('workspace resolution failures', () => {
  it('errors cleanly when the resolver is unwired', async () => {
    const res = await run(issueListFactory.build(ctx({ resolveWorkspace: undefined })), {})
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/unavailable/)
  })

  it('errors cleanly when this workspace cannot be located', async () => {
    const res = await run(issueListFactory.build(ctx({ resolveWorkspace: () => null })), {})
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/cannot locate/)
  })
})
