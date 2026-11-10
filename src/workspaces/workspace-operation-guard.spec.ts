import { describe, expect, it } from 'vitest'

import { WorkspaceOperationGuard } from './workspace-operation-guard.js'

describe('WorkspaceOperationGuard groups', () => {
  it('claims ids atomically in stable order and releases all of them', () => {
    const guard = new WorkspaceOperationGuard()
    const lease = guard.acquireMany(['target', 'source', 'target'], 'absorb')
    expect(lease?.workspaceIds).toEqual(['source', 'target'])
    expect(guard.current('source')).toBe('absorb')
    expect(guard.acquireMany(['source', 'other'], 'opposite')).toBeNull()
    expect(guard.current('other')).toBeNull()
    lease?.release()
    expect(guard.current('source')).toBeNull()
    expect(guard.current('target')).toBeNull()
  })

  it('queues a review until every requested Workspace is free', async () => {
    const guard = new WorkspaceOperationGuard()
    const source = guard.acquire('source', 'offboard')!
    const pending = guard.acquireManyWhenAvailable(['target', 'source'], 'absorb')
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    source.release()
    const lease = await pending
    expect(guard.current('source')).toBe('absorb')
    expect(guard.current('target')).toBe('absorb')
    lease.release()
  })

  it('retries when a colliding lease releases between snapshots', async () => {
    const guard = new WorkspaceOperationGuard()
    const source = guard.acquire('source', 'offboard')!
    const originalAcquireMany = guard.acquireMany.bind(guard)
    let released = false
    guard.acquireMany = ((workspaceIds: readonly string[], operation: string) => {
      const lease = originalAcquireMany(workspaceIds, operation)
      if (!released && !lease) {
        released = true
        source.release()
      }
      return lease
    }) as typeof guard.acquireMany

    const lease = await guard.acquireManyWhenAvailable(['source', 'target'], 'absorb')
    expect(lease.workspaceIds).toEqual(['source', 'target'])
    lease.release()
  })
})

describe('WorkspaceOperationGuard shared leases', () => {
  it('allows multiple shared start-leases to coexist on one Workspace', () => {
    const guard = new WorkspaceOperationGuard()
    const a = guard.acquireShared('ws', 'headless-run')
    const b = guard.acquireShared('ws', 'headless-probe')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(guard.current('ws')).toBe('headless-run')
    a!.release()
    expect(guard.current('ws')).toBe('headless-probe')
    b!.release()
    expect(guard.current('ws')).toBeNull()
  })

  it('rejects an exclusive acquire while any shared lease is active', () => {
    const guard = new WorkspaceOperationGuard()
    const shared = guard.acquireShared('ws', 'headless-run')!
    expect(guard.acquire('ws', 'template-upgrade')).toBeNull()
    expect(guard.current('ws')).toBe('headless-run')
    shared.release()
    expect(guard.acquire('ws', 'template-upgrade')).not.toBeNull()
  })

  it('rejects a shared acquire while an exclusive lease is active', () => {
    const guard = new WorkspaceOperationGuard()
    const exclusive = guard.acquire('ws', 'offboarding')!
    expect(guard.acquireShared('ws', 'headless-run')).toBeNull()
    exclusive.release()
    expect(guard.acquireShared('ws', 'headless-run')).not.toBeNull()
  })

  it('waits for every shared lease to release before granting an exclusive lease', async () => {
    const guard = new WorkspaceOperationGuard()
    const a = guard.acquireShared('ws', 'headless-run')!
    const b = guard.acquireShared('ws', 'headless-probe')!
    const pending = guard.acquireWhenAvailable('ws', 'template-upgrade')
    let settled = false
    void pending.then(() => { settled = true })
    a.release()
    await Promise.resolve()
    expect(settled).toBe(false)
    b.release()
    const lease = await pending
    expect(guard.current('ws')).toBe('template-upgrade')
    lease.release()
  })
})
