import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Tool } from 'ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { readWorkspaceIssues } from '../workspaces/issues/declaration.js'
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
    expect(res.issue).toMatchObject({ id: 'fix-the-thing', title: 'Fix the thing', assignee: 'ws:auto-quant' })
    const issue = await readBack('fix-the-thing')
    expect(issue?.title).toBe('Fix the thing')
  })

  it('refuses to overwrite an existing id (conflict → clean error)', async () => {
    await run(issueCreateFactory.build(ctx()), { id: 'dup', title: 'one' })
    const res = await run(issueCreateFactory.build(ctx()), { id: 'dup', title: 'two' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/already exists/)
  })
})

describe('issue_update', () => {
  it('validates and writes patched fields, preserving body + scheduling', async () => {
    await run(issueCreateFactory.build(ctx()), {
      id: 'sched',
      title: 'scheduled work',
      when: { kind: 'every', every: '30m' },
      body: 'keep me',
    })
    const res = await run(issueUpdateFactory.build(ctx()), { id: 'sched', status: 'in_progress', priority: 'high' })
    expect(res.ok).toBe(true)
    const issue = await readBack('sched')
    expect(issue).toMatchObject({ status: 'in_progress', priority: 'high', body: 'keep me' })
    // scheduling frontmatter survives a board-field patch
    expect(issue?.when).toEqual({ kind: 'every', every: '30m' })
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
  it('appends a ws-authored comment into the issue body', async () => {
    await run(issueCreateFactory.build(ctx()), { id: 'c1', title: 'commentable', body: 'desc' })
    const res = await run(issueCommentFactory.build(ctx()), { id: 'c1', text: 'progress note' })
    expect(res.ok).toBe(true)
    const issue = await readBack('c1')
    expect(issue?.body).toMatch(/## Comments/)
    expect(issue?.body).toMatch(/\*\*ws:auto-quant\*\*/)
    expect(issue?.body).toMatch(/progress note/)
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
          { id: 'alpha', title: 'Alpha', status: 'todo', priority: 'high', assignee: 'human' },
          {
            id: 'shared-a',
            title: 'Shared',
            status: 'in_progress',
            priority: 'none',
            assignee: 'ws:auto-quant',
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
            assignee: 'unassigned',
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
        body: 'the alpha body',
        status: 'todo',
        priority: 'high',
        assignee: 'human',
      },
      runs: [],
      inboxReports: [],
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
    expect(show.issue).toMatchObject({ id: 'alpha', body: 'the alpha body' })
    expect(show.runs).toEqual([])
    expect(show.inboxReports).toEqual([])
    expect(show.ambiguous).toBeUndefined()
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
