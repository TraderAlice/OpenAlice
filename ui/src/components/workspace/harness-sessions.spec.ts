import { describe, expect, it } from 'vitest'

import type { SessionRecord, Workspace, WorkspaceSessionDirectoryEntry } from './api'
import {
  flattenHarnessSessions,
  harnessSessionTitle,
  isHeadlessBornWithoutInteractive,
  joinWorkspaceHarnessSessions,
  orderHarnessSessions,
  shortResumeId,
  toHarnessSession,
} from './harness-sessions'

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    resumeId: 'resume-interactive',
    wsId: 'ws-1',
    agent: 'pi',
    name: 'p1',
    createdAt: '2026-08-01T00:00:00.000Z',
    lastActiveAt: '2026-08-01T01:00:00.000Z',
    state: 'paused',
    pid: null,
    startedAt: null,
    title: 'Interactive thesis',
    ...overrides,
  }
}

function workspace(sessions: readonly SessionRecord[] = [session()]): Workspace {
  return {
    id: 'ws-1',
    tag: 'chat-aug1',
    dir: '/tmp/chat-aug1',
    createdAt: '2026-08-01T00:00:00.000Z',
    template: 'chat',
    sessions: [...sessions],
  }
}

function headlessSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return session({
    id: 'session-headless',
    resumeId: 'resume-headless-only',
    agent: 'codex',
    name: 'x1',
    createdAt: '2026-08-02T00:00:00.000Z',
    lastActiveAt: '2026-08-02T02:00:00.000Z',
    surface: 'headless',
    title: undefined,
    ...overrides,
  })
}

function entry(overrides: Partial<WorkspaceSessionDirectoryEntry> = {}): WorkspaceSessionDirectoryEntry {
  return {
    resumeId: 'resume-headless-only',
    agent: 'codex',
    createdAt: Date.parse('2026-08-02T00:00:00.000Z'),
    updatedAt: Date.parse('2026-08-02T02:00:00.000Z'),
    lifecycle: 'active',
    resumable: true,
    active: false,
    latestExecution: {
      taskId: 'task-1',
      status: 'done',
      startedAt: Date.parse('2026-08-02T01:50:00.000Z'),
      finishedAt: Date.parse('2026-08-02T02:00:00.000Z'),
      assistantPreview: 'Morning scan complete. Semis still lead.',
    },
    ...overrides,
  }
}

describe('harness session titles', () => {
  it('prefers a coworker nametag over the conversation title', () => {
    expect(harnessSessionTitle(
      session({ displayName: 'AAPL desk' }),
      entry({ resumeId: 'resume-interactive', displayName: 'Ignored directory name' }),
    )).toBe('AAPL desk')
    expect(harnessSessionTitle(null, entry({ displayName: 'AAPL desk' }))).toBe('AAPL desk')
  })

  it('prefers the interactive title, then preview, a readable Issue id, then a short resume id', () => {
    expect(harnessSessionTitle(session(), entry({ resumeId: 'resume-interactive' }))).toBe('Interactive thesis')
    expect(harnessSessionTitle(null, entry())).toBe('Morning scan complete. Semis still lead.')
    expect(harnessSessionTitle(null, entry({
      latestExecution: { taskId: 'task-1', status: 'done', startedAt: 1, issueId: 'scan-open' },
    }))).toBe('Scan Open')
    expect(harnessSessionTitle(session({ title: '# Launch prompt\n\nWrite the close brief.' }), entry({
      resumeId: 'resume-interactive',
      createdBy: {
        kind: 'issue',
        workspaceId: 'ws-1',
        issueId: 'daily-market-close',
        policy: 'new-then-resume',
        fire: 'schedule',
      },
    }))).toBe('Daily Market Close')
    expect(harnessSessionTitle(null, entry({
      resumeId: 'resume-calm-amber-river-a1b2c3',
      latestExecution: undefined,
    }))).toBe(shortResumeId('resume-calm-amber-river-a1b2c3'))
  })
})

describe('joinWorkspaceHarnessSessions', () => {
  it('uses the persistent Session roster until Directory arrives', () => {
    const rows = joinWorkspaceHarnessSessions(workspace(), null)
    expect(rows.map((row) => row.resumeId)).toEqual(['resume-interactive'])
    expect(rows[0]?.session?.id).toBe('session-1')
  })

  it('uses roster presence before Directory arrives instead of flashing archived rows', () => {
    const rows = joinWorkspaceHarnessSessions(workspace([
      session(),
      headlessSession({
        resumeId: 'resume-archived',
        presence: 'archived',
      }),
    ]), null)

    expect(rows.map((row) => row.resumeId)).toEqual(['resume-interactive'])
  })

  it('decorates the persistent roster and never invents Directory-only rows', () => {
    const rows = joinWorkspaceHarnessSessions(workspace([session(), headlessSession()]), {
      workspace: { id: 'ws-1', tag: 'chat-aug1' },
      sessions: [
        entry({ resumeId: 'resume-interactive', interactive: {
          name: 'p1',
          title: 'Interactive thesis',
          state: 'paused',
          lastActiveAt: '2026-08-01T01:00:00.000Z',
        } }),
        entry(),
        entry({ resumeId: 'resume-directory-only' }),
      ],
    }, { includeHeadlessBornSessions: true })

    expect(rows.map((row) => row.resumeId)).toEqual([
      'resume-headless-only',
      'resume-interactive',
    ])
    expect(rows[0]?.session.id).toBe('session-headless')
    expect(rows[0]?.title).toBe('Morning scan complete. Semis still lead.')
    expect(rows.some((row) => row.resumeId === 'resume-directory-only')).toBe(false)
  })

  it('always hides connector-owned Sessions even when ordinary headless rows are enabled', () => {
    const connector = headlessSession({
      id: 'session-connector',
      resumeId: 'resume-connector',
    })
    const ordinary = headlessSession()
    const rows = joinWorkspaceHarnessSessions(workspace([session(), connector, ordinary]), {
      workspace: { id: 'ws-1', tag: 'chat-aug1' },
      sessions: [
        entry({ resumeId: 'resume-interactive' }),
        entry({ resumeId: 'resume-connector', rosterVisibility: 'hidden' }),
        entry(),
      ],
    }, { includeHeadlessBornSessions: true })

    expect(rows.map((row) => row.resumeId)).toEqual([
      'resume-headless-only',
      'resume-interactive',
    ])
  })

  it('locks TUI while headless occupies and sorts running occupancy first', () => {
    const paused = session({ lastActiveAt: '2026-08-03T00:00:00.000Z' })
    const runningHeadless = entry({
      resumeId: 'resume-running',
      active: true,
      latestExecution: { taskId: 'task-run', status: 'running', startedAt: Date.parse('2026-08-02T12:00:00.000Z') },
    })
    const failed = entry({
      resumeId: 'resume-failed',
      latestExecution: {
        taskId: 'task-fail',
        status: 'failed',
        startedAt: Date.parse('2026-08-04T11:00:00.000Z'),
        finishedAt: Date.parse('2026-08-04T11:05:00.000Z'),
      },
    })

    const runningRecord = headlessSession({
      id: 'session-running',
      resumeId: 'resume-running',
      agent: 'claude',
      name: 'c1',
      state: 'running',
      lastActiveAt: '2026-08-02T12:00:00.000Z',
    })
    const failedRecord = headlessSession({
      id: 'session-failed',
      resumeId: 'resume-failed',
      name: 'x2',
      lastActiveAt: '2026-08-04T11:05:00.000Z',
    })

    const rows = joinWorkspaceHarnessSessions(workspace([paused, runningRecord, failedRecord]), {
      workspace: { id: 'ws-1', tag: 'chat-aug1' },
      sessions: [
        entry({ resumeId: paused.resumeId }),
        runningHeadless,
        failed,
      ],
    }, { includeHeadlessBornSessions: true })

    expect(rows.map((row) => row.resumeId)).toEqual([
      'resume-running',
      'resume-failed',
      'resume-interactive',
    ])
    expect(rows[0]).toMatchObject({
      occupancyRunning: true,
      headlessOccupying: true,
      resumable: true,
    })
    expect(toHarnessSession('ws-1', runningRecord, runningHeadless).headlessOccupying).toBe(true)
    expect(rows.find((row) => row.resumeId === 'resume-failed')?.failed).toBe(true)
  })

  it('keeps archived colleagues out of the floor roster', () => {
    const archivedSeat = session({
      id: 'session-archived',
      resumeId: 'resume-archived',
      state: 'paused',
      pid: null,
      startedAt: null,
    })
    const withArchivedSeat = {
      ...workspace(),
      sessions: [...workspace().sessions, archivedSeat],
    }
    const rows = joinWorkspaceHarnessSessions(workspace(), {
      workspace: { id: 'ws-1', tag: 'chat-aug1' },
      sessions: [
        entry({ resumeId: 'resume-interactive' }),
        entry({ resumeId: 'resume-archived', presence: 'archived' }),
      ],
    })
    expect(rows.map((row) => row.resumeId)).toEqual(['resume-interactive'])
    expect(joinWorkspaceHarnessSessions(withArchivedSeat, {
      workspace: { id: 'ws-1', tag: 'chat-aug1' },
      sessions: [
        entry({ resumeId: 'resume-interactive' }),
        entry({ resumeId: 'resume-archived', presence: 'archived' }),
      ],
    }, { presence: 'archived' }).map((row) => row.resumeId)).toEqual(['resume-archived'])
    expect(joinWorkspaceHarnessSessions(withArchivedSeat, {
      workspace: { id: 'ws-1', tag: 'chat-aug1' },
      sessions: [
        entry({ resumeId: 'resume-interactive' }),
        entry({ resumeId: 'resume-archived', presence: 'archived' }),
      ],
    }).map((row) => row.resumeId)).toEqual(['resume-interactive'])
  })

  it('does not lock an interactive TUI that is already the occupant', () => {
    const live = session({ state: 'running', pid: 9, startedAt: 1 })
    const row = toHarnessSession('ws-1', live, entry({
      resumeId: live.resumeId,
      active: true,
      latestExecution: { taskId: 'old', status: 'done', startedAt: 1 },
    }))
    expect(row.occupancyRunning).toBe(true)
    expect(row.headlessOccupying).toBe(false)
  })

  it('hides headless-born Sessions that have never opened a TUI', () => {
    const bornHeadless = headlessSession({ sourceRunId: 'run-1' })
    const openedLater = headlessSession({
      id: 'session-opened',
      resumeId: 'resume-opened',
      sourceRunId: 'run-2',
    })
    expect(isHeadlessBornWithoutInteractive(bornHeadless, entry())).toBe(true)
    expect(isHeadlessBornWithoutInteractive(openedLater, entry({
      resumeId: 'resume-opened',
      interactive: {
        name: 'x2',
        state: 'paused',
        lastActiveAt: '2026-08-03T00:00:00.000Z',
      },
    }))).toBe(false)

    const rows = joinWorkspaceHarnessSessions(workspace([session(), bornHeadless, openedLater]), {
      workspace: { id: 'ws-1', tag: 'chat-aug1' },
      sessions: [
        entry({ resumeId: 'resume-interactive' }),
        entry(),
        entry({
          resumeId: 'resume-opened',
          interactive: {
            name: 'x2',
            state: 'paused',
            lastActiveAt: '2026-08-03T00:00:00.000Z',
          },
        }),
      ],
    })
    expect(rows.map((row) => row.resumeId)).toEqual([
      'resume-opened',
      'resume-interactive',
    ])
  })
})

describe('orderHarnessSessions', () => {
  it('keeps one resumeId as one row when flattening several desks', () => {
    const other: Workspace = {
      ...workspace([]),
      id: 'ws-2',
      tag: 'chat-aug2',
      dir: '/tmp/chat-aug2',
      sessions: [headlessSession({ wsId: 'ws-2' })],
    }
    const rows = flattenHarnessSessions(
      [workspace(), other],
      new Map([
        ['ws-2', {
          workspace: { id: 'ws-2', tag: 'chat-aug2' },
          sessions: [entry({
            latestExecution: {
              taskId: 'task-new',
              status: 'done',
              startedAt: Date.parse('2026-08-04T00:00:00.000Z'),
              finishedAt: Date.parse('2026-08-04T00:10:00.000Z'),
              assistantPreview: 'Newer occupancy',
            },
          })],
        }],
      ]),
      { includeHeadlessBornSessions: true },
    )
    expect(rows.map((row) => `${row.workspaceId}:${row.resumeId}`)).toEqual([
      'ws-2:resume-headless-only',
      'ws-1:resume-interactive',
    ])
  })
})
