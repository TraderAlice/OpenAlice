import { describe, expect, it } from 'vitest'

import type { Workspace } from '../components/workspace/api'
import { reconcileWorkspaceList } from './workspace-list-reconcile'

function workspace(id: string, title: string): Workspace {
  return {
    id,
    tag: id,
    dir: `/tmp/${id}`,
    createdAt: '2026-07-16T00:00:00.000Z',
    template: 'chat',
    agents: ['pi'],
    sessions: [{
      id: `${id}-session`,
      resumeId: `${id}-resume`,
      wsId: id,
      agent: 'pi',
      name: 'p1',
      createdAt: '2026-07-16T00:00:00.000Z',
      lastActiveAt: '2026-07-16T00:00:00.000Z',
      state: 'paused',
      pid: null,
      startedAt: null,
      title,
    }],
  }
}

describe('reconcileWorkspaceList', () => {
  it('keeps the existing array and rows for an identical polling response', () => {
    const current = [workspace('chat-1', 'Hello'), workspace('chat-2', 'Review')]
    const incoming = structuredClone(current)

    const reconciled = reconcileWorkspaceList(current, incoming)

    expect(reconciled).toBe(current)
    expect(reconciled[0]).toBe(current[0])
    expect(reconciled[1]).toBe(current[1])
  })

  it('updates only changed rows and preserves stable neighbors', () => {
    const current = [workspace('chat-1', 'Hello'), workspace('chat-2', 'Review')]
    const incoming = structuredClone(current)
    incoming[1] = workspace('chat-2', 'Updated review')

    const reconciled = reconcileWorkspaceList(current, incoming)

    expect(reconciled).not.toBe(current)
    expect(reconciled[0]).toBe(current[0])
    expect(reconciled[1]).toBe(incoming[1])
  })

  it('publishes order changes while reusing the unchanged Workspace objects', () => {
    const current = [workspace('chat-1', 'Hello'), workspace('chat-2', 'Review')]
    const incoming = [structuredClone(current[1]), structuredClone(current[0])]

    const reconciled = reconcileWorkspaceList(current, incoming)

    expect(reconciled).not.toBe(current)
    expect(reconciled).toEqual([current[1], current[0]])
    expect(reconciled[0]).toBe(current[1])
    expect(reconciled[1]).toBe(current[0])
  })
})
