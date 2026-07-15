import { describe, expect, it } from 'vitest'

import type { InboxEntry } from '../../core/inbox-store.js'
import {
  annotateNameCollisions,
  detailIssue,
  flattenBoardRows,
  inboxReportsForIssue,
  issueActivityRecords,
  issueProvenanceRecords,
  issueRunRecord,
  snapshotBoardIssue,
  type IssuesSnapshot,
  type IssuesSnapshotWorkspace,
} from './board.js'

describe('issueProvenanceRecords', () => {
  it('keeps product Session attribution while stripping storage-only fields', () => {
    const projected = issueProvenanceRecords([{
      id: 'p-1',
      artifact: { kind: 'issue', workspaceId: 'ws-1', issueId: 'audit' },
      action: 'created',
      origin: {
        kind: 'session',
        workspaceId: 'ws-1',
        resumeId: 'resume-gentle-otter-abc123',
        agent: 'codex',
        execution: { kind: 'headless', taskId: 'task-1' },
      },
      at: 123,
      fingerprint: 'internal-dedupe-key',
    }])

    expect(projected).toEqual([{
      id: 'p-1',
      action: 'created',
      origin: {
        kind: 'session',
        workspaceId: 'ws-1',
        resumeId: 'resume-gentle-otter-abc123',
        agent: 'codex',
        execution: { kind: 'headless', taskId: 'task-1' },
      },
      at: 123,
    }])
    expect(projected[0]).not.toHaveProperty('artifact')
    expect(projected[0]).not.toHaveProperty('fingerprint')
  })

  it('folds legacy autosave spam into one user-facing update activity', () => {
    const artifact = { kind: 'issue' as const, workspaceId: 'ws-1', issueId: 'audit' }
    const origin = { kind: 'human' as const }
    const projected = issueProvenanceRecords([
      { id: 'newest', artifact, action: 'updated', origin, at: 250 },
      { id: 'middle', artifact, action: 'updated', origin, at: 200 },
      { id: 'oldest', artifact, action: 'updated', origin, at: 100 },
    ])

    expect(projected).toEqual([{ id: 'newest', action: 'updated', origin, at: 250 }])
  })

  it('keeps separate update activities across comments', () => {
    const artifact = { kind: 'issue' as const, workspaceId: 'ws-1', issueId: 'audit' }
    const origin = { kind: 'human' as const }
    const projected = issueProvenanceRecords([
      { id: 'after', artifact, action: 'updated', origin, at: 250 },
      { id: 'comment', artifact, action: 'commented', origin, at: 225 },
      { id: 'before', artifact, action: 'updated', origin, at: 200 },
    ])

    expect(projected.map((record) => record.id)).toEqual(['after', 'comment', 'before'])
  })
})

describe('issueActivityRecords', () => {
  it('projects changes and runs into one newest-first Issue log', () => {
    const change = { id: 'p-1', action: 'updated' as const, origin: { kind: 'human' as const }, at: 100 }
    const run = {
      taskId: 'run-1', resumeId: 'resume-1', wsId: 'ws-1', issueId: 'audit', agent: 'codex',
      prompt: 'scan', status: 'done' as const, startedAt: 200, resumable: true,
    }

    expect(issueActivityRecords([change], [run])).toEqual([
      { kind: 'run', id: 'run-1', at: 200, run },
      { kind: 'change', ...change },
    ])
  })
})

describe('issueRunRecord', () => {
  it('projects a resumable run without leaking its native runtime session id', () => {
    const projected = issueRunRecord({
      taskId: 'task-1',
      resumeId: 'resume-gentle-otter-abc123',
      wsId: 'ws-1',
      trigger: { kind: 'issue', workspaceId: 'ws-home', issueId: 'audit' },
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

  it('derives an actionable failure explanation for legacy killed runs', () => {
    const projected = issueRunRecord({
      taskId: 'task-sleep',
      resumeId: 'resume-sleep',
      wsId: 'ws-1',
      trigger: { kind: 'issue', workspaceId: 'ws-1', issueId: 'scan' },
      agent: 'pi',
      prompt: 'scan',
      status: 'failed',
      startedAt: 1,
      durationMs: 44 * 60_000,
      killed: true,
      signal: 'SIGKILL',
    }, false)

    expect(projected.failure).toMatchObject({ kind: 'system_paused', retryable: true })
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
      assignee: '@unassigned',
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
            { id: 'x', title: 'X', status: 'todo', priority: 'high', assignee: '@human' },
            {
              id: 'y',
              title: 'Y',
              status: 'todo',
              priority: 'none',
              assignee: '@workspace',
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
        assignee: '@human',
        scheduled: false,
        workspace: { wsId: 'a', tag: 'auto-quant' },
      },
      {
        id: 'y',
        title: 'Y',
        status: 'todo',
        priority: 'none',
        assignee: '@workspace',
        agent: 'pi',
        scheduled: true,
        workspace: { wsId: 'a', tag: 'auto-quant' },
        nameCollision: true,
      },
    ])
    expect(invalid).toEqual([{ wsId: 'b', tag: 'broken', error: 'unreadable' }])
  })
})

describe('assignee projection', () => {
  const baseIssue = {
    id: 'i',
    title: 'Issue',
    status: 'todo',
    priority: 'none',
    assignee: '@workspace',
    what: 'Issue',
  } as const

  it('projects Workspace ownership without needing a workspace-tag rewrite', () => {
    expect(snapshotBoardIssue(baseIssue, null).assignee).toBe('@workspace')
    expect(detailIssue(baseIssue, null).assignee).toBe('@workspace')
  })

  it('respects an explicit unassigned assignee', () => {
    const issue = { ...baseIssue, assignee: '@unassigned' as const }
    expect(snapshotBoardIssue(issue, null).assignee).toBe('@unassigned')
    expect(detailIssue(issue, null).assignee).toBe('@unassigned')
  })

  it('carries live automation health only when scheduled markers are supplied', () => {
    const scheduled = { ...baseIssue, when: { kind: 'every' as const, every: '1h' } }
    const markers = {
      lastFiredAtMs: 100,
      nextDueAtMs: 200,
      automationHealth: { state: 'healthy' as const, message: 'Latest scheduled run completed.', latestTaskId: 'run-1' },
    }
    expect(snapshotBoardIssue(scheduled, markers).automationHealth).toEqual(markers.automationHealth)
    expect(detailIssue(scheduled, markers).automationHealth).toEqual(markers.automationHealth)
    expect(snapshotBoardIssue(baseIssue, null)).not.toHaveProperty('automationHealth')
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
    expect(inboxReportsForIssue(entries, 'w', 'i1').map((e) => e.id)).toEqual(['e3', 'e1'])
  })

  it('returns [] for a non-matching issue and ignores origin-less entries', () => {
    expect(inboxReportsForIssue(entries, 'w', 'nope')).toEqual([])
  })
})
