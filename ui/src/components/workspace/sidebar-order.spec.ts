import { describe, expect, it } from 'vitest'

import type { SessionRecord, Workspace } from './api'
import { orderSessionsForSidebar, orderWorkspacesForSidebar } from './sidebar-order'

function session(
  id: string,
  state: SessionRecord['state'],
  lastActiveAt: string,
): SessionRecord {
  return {
    id,
    resumeId: `resume-${id}`,
    wsId: 'ws',
    agent: 'pi',
    name: id,
    createdAt: lastActiveAt,
    lastActiveAt,
    state,
    pid: state === 'running' ? 1 : null,
    startedAt: state === 'running' ? 1 : null,
    title: id,
  }
}

function workspace(
  id: string,
  createdAt: string,
  sessions: readonly SessionRecord[],
): Workspace {
  return {
    id,
    tag: id,
    dir: `/tmp/${id}`,
    createdAt,
    template: 'chat',
    agents: ['pi'],
    sessions: sessions.map((record) => ({ ...record, wsId: id })),
  }
}

describe('sidebar attention order', () => {
  it('lifts running workspaces, then recent activity', () => {
    const oldestPaused = workspace('oldest-paused', '2026-01-01T00:00:00Z', [
      session('oldest-session', 'paused', '2026-01-01T00:00:00Z'),
    ])
    const runningOld = workspace('running-old', '2026-02-01T00:00:00Z', [
      session('running-session', 'running', '2026-02-01T00:00:00Z'),
    ])
    const recentPaused = workspace('recent-paused', '2026-07-01T00:00:00Z', [
      session('recent-session', 'paused', '2026-07-10T00:00:00Z'),
    ])
    const olderPaused = workspace('older-paused', '2026-06-01T00:00:00Z', [
      session('older-session', 'paused', '2026-07-09T00:00:00Z'),
    ])

    expect(orderWorkspacesForSidebar(
      [olderPaused, recentPaused, runningOld, oldestPaused],
    ).map((candidate) => candidate.id)).toEqual([
      'running-old',
      'recent-paused',
      'older-paused',
      'oldest-paused',
    ])
  })

  it('uses workspace creation time when no session activity exists', () => {
    const older = workspace('older', '2026-07-01T00:00:00Z', [])
    const newer = workspace('newer', '2026-07-10T00:00:00Z', [])

    expect(orderWorkspacesForSidebar([older, newer]).map((candidate) => candidate.id))
      .toEqual(['newer', 'older'])
  })

  it('lifts running sessions, then recent activity', () => {
    const oldestPaused = session('oldest-paused', 'paused', '2026-01-01T00:00:00Z')
    const runningOld = session('running-old', 'running', '2026-02-01T00:00:00Z')
    const recentPaused = session('recent-paused', 'paused', '2026-07-10T00:00:00Z')
    const olderPaused = session('older-paused', 'paused', '2026-07-09T00:00:00Z')

    expect(orderSessionsForSidebar(
      [olderPaused, recentPaused, runningOld, oldestPaused],
    ).map((candidate) => candidate.id)).toEqual([
      'running-old',
      'recent-paused',
      'older-paused',
      'oldest-paused',
    ])
  })
})
