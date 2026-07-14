import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { WorkspaceHeadlessActivityTracker } from './workspace-runtime-activity.js'

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
}

describe('WorkspaceHeadlessActivityTracker', () => {
  it('tracks concurrent work independently and releases leases idempotently', () => {
    const tracker = new WorkspaceHeadlessActivityTracker()
    const first = tracker.begin({ workspaceId: 'ws-1', agent: 'pi', taskId: 'run-1', startedAt: 1 })
    const second = tracker.begin({ workspaceId: 'ws-1', agent: 'codex', taskId: 'run-2', startedAt: 2 })

    expect(tracker.list('ws-1')).toEqual([
      { taskId: 'run-1', agent: 'pi', startedAt: 1 },
      { taskId: 'run-2', agent: 'codex', startedAt: 2 },
    ])
    first.release()
    first.release()
    expect(tracker.list('ws-1')).toEqual([
      { taskId: 'run-2', agent: 'codex', startedAt: 2 },
    ])
    second.release()
    expect(tracker.has('ws-1')).toBe(false)
  })

  it('prunes a zombie lease from actual child-process exit evidence', () => {
    const tracker = new WorkspaceHeadlessActivityTracker()
    const lease = tracker.begin({ workspaceId: 'ws-1', agent: 'pi', startedAt: 1 })
    const child = new FakeChild()
    lease.attach(child as never)

    expect(tracker.has('ws-1')).toBe(true)
    child.exitCode = 0
    expect(tracker.list('ws-1')).toEqual([])
  })

  it('does not confuse activity in another Workspace', () => {
    const tracker = new WorkspaceHeadlessActivityTracker()
    tracker.begin({ workspaceId: 'ws-1', agent: 'pi' })
    expect(tracker.has('ws-2')).toBe(false)
  })
})
