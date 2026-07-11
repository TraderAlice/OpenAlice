import { describe, expect, it } from 'vitest'

import type { InboxEntry } from '../../core/inbox-store.js'
import {
  annotateNameCollisions,
  detailIssue,
  flattenBoardRows,
  inboxReportsForIssue,
  issueRunRecord,
  snapshotBoardIssue,
  type IssuesSnapshot,
  type IssuesSnapshotWorkspace,
} from './board.js'

describe('issueRunRecord', () => {
  it('projects a resumable run without leaking its native runtime session id', () => {
    const projected = issueRunRecord({
      taskId: 'task-1',
      resumeId: 'resume-gentle-otter-abc123',
      wsId: 'ws-1',
      issueId: 'audit',
      agent: 'codex',
      prompt: 'inspect it',
      status: 'done',
      startedAt: 1,
      agentSessionId: 'native-secret-id',
    }, true)

    expect(projected).toMatchObject({
      taskId: 'task-1',
      resumeId: 'resume-gentle-otter-abc123',
      resumable: true,
    })
    expect(projected).not.toHaveProperty('agentSessionId')
  })
})

function ws(wsId: string, titles: string[]): IssuesSnapshotWorkspace {
  return {
    wsId,
    tag: wsId,
    status: 'ok',
    issues: titles.map((title, i) => ({
      id: `${wsId}-${i}`,
      title,
      status: 'todo',
      priority: 'none',
      assignee: 'unassigned',
      execution: { mode: 'fresh' },
    })),
  }
}

describe('annotateNameCollisions', () => {
  it('flags a name shared across workspaces (case-insensitive) and leaves unique names alone', () => {
    const workspaces = [ws('a', ['Pre-market brief', 'Unique A']), ws('b', ['pre-market brief', 'Unique B'])]
    const dups = annotateNameCollisions(workspaces)

    expect(dups).toEqual(['Pre-market brief']) // first-seen display casing
    expect(workspaces[0].issues[0].nameCollision).toBe(true)
    expect(workspaces[1].issues[0].nameCollision).toBe(true)
    // Unique names are untouched (no false flag).
    expect(workspaces[0].issues[1].nameCollision).toBeUndefined()
    expect(workspaces[1].issues[1].nameCollision).toBeUndefined()
  })

  it('does NOT treat a name repeated WITHIN one workspace as a collision', () => {
    const workspaces = [ws('a', ['Same', 'Same'])]
    const dups = annotateNameCollisions(workspaces)
    expect(dups).toEqual([])
    expect(workspaces[0].issues.every((i) => i.nameCollision === undefined)).toBe(true)
  })

  it('returns an empty list when every name is globally unique', () => {
    const workspaces = [ws('a', ['One']), ws('b', ['Two'])]
    expect(annotateNameCollisions(workspaces)).toEqual([])
  })
})

describe('flattenBoardRows', () => {
  it('flattens issues across workspaces, collapses `when` to `scheduled`, tags the owning workspace, and surfaces invalid workspaces', () => {
    const snapshot: IssuesSnapshot = {
      workspaces: [
        {
          wsId: 'a',
          tag: 'auto-quant',
          status: 'ok',
          issues: [
            { id: 'x', title: 'X', status: 'todo', priority: 'high', assignee: 'human', execution: { mode: 'fresh' } },
            {
              id: 'y',
              title: 'Y',
              status: 'todo',
              priority: 'none',
              assignee: 'unassigned',
              execution: { mode: 'fresh' },
              agent: 'pi',
              when: { kind: 'every', every: '1h' },
              nameCollision: true,
            },
          ],
        },
        { wsId: 'b', tag: 'broken', status: 'invalid', error: 'unreadable', issues: [] },
      ],
      duplicateNames: [],
    }
    const { rows, invalid } = flattenBoardRows(snapshot)
    expect(rows).toEqual([
      {
        id: 'x',
        title: 'X',
        status: 'todo',
        priority: 'high',
        assignee: 'human',
        execution: { mode: 'fresh' },
        scheduled: false,
        workspace: { wsId: 'a', tag: 'auto-quant' },
      },
      {
        id: 'y',
        title: 'Y',
        status: 'todo',
        priority: 'none',
        assignee: 'unassigned',
        agent: 'pi',
        execution: { mode: 'fresh' },
        scheduled: true,
        workspace: { wsId: 'a', tag: 'auto-quant' },
        nameCollision: true,
      },
    ])
    expect(invalid).toEqual([{ wsId: 'b', tag: 'broken', error: 'unreadable' }])
  })
})

describe('workspace default assignee projection', () => {
  const baseIssue = {
    id: 'i',
    title: 'Issue',
    status: 'todo',
    priority: 'none',
    assignee: 'unassigned',
    body: '',
  } as const

  it('projects a missing assignee to the owning workspace', () => {
    const issue = { ...baseIssue, assigneeDefaulted: true }
    expect(snapshotBoardIssue(issue, null, 'chat-jul4').assignee).toBe('ws:chat-jul4')
    expect(detailIssue(issue, null, 'chat-jul4').assignee).toBe('ws:chat-jul4')
  })

  it('respects an explicit unassigned assignee', () => {
    const issue = { ...baseIssue, assigneeDefaulted: false }
    expect(snapshotBoardIssue(issue, null, 'chat-jul4').assignee).toBe('unassigned')
    expect(detailIssue(issue, null, 'chat-jul4').assignee).toBe('unassigned')
  })
})

describe('inboxReportsForIssue', () => {
  // Newest-first, the order inboxStore.read returns.
  const entries = [
    { id: 'e3', ts: 3, workspaceId: 'w', comments: 'c3', origin: { kind: 'headless', runId: 'x', issueId: 'i1' } },
    { id: 'e2', ts: 2, workspaceId: 'w', comments: 'c2', origin: { kind: 'headless', runId: 'y', issueId: 'i2' } },
    { id: 'e1', ts: 1, workspaceId: 'w', comments: 'c1', origin: { kind: 'headless', runId: 'z', issueId: 'i1' } },
    { id: 'e0', ts: 0, workspaceId: 'w', comments: 'c0' }, // no origin at all
  ] as unknown as InboxEntry[]

  it('keeps only entries whose origin.issueId matches, preserving order', () => {
    expect(inboxReportsForIssue(entries, 'i1').map((e) => e.id)).toEqual(['e3', 'e1'])
  })

  it('returns [] for a non-matching issue and ignores origin-less entries', () => {
    expect(inboxReportsForIssue(entries, 'nope')).toEqual([])
  })
})
