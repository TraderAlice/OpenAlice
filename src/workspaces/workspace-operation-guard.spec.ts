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
