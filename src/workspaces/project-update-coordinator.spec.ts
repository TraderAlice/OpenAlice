import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceService } from './service.js'
vi.mock('../services/broker-packs/installer.js', () => ({ getBrokerPackLocalStatus: vi.fn(async () => ({ installed: false, source: 'workspace' })) }))
vi.mock('./alice-harness-assets.js', () => ({ aliceHarnessSourceVersion: vi.fn(async () => 'skills-2') }))
import { ProjectUpdateCoordinator } from './project-update-coordinator.js'

describe('project inventory evidence', () => {
  function fixture() {
    const current = vi.fn(async () => 'skills-1')
    const service = { registry: { list: () => [{ id: 'chat', dir: '/fixture/chat', template: 'chat' }] }, templates: { get: () => ({ upgradeStrategy: 'managed-context', version: '2' }) }, templateUpgrades: { currentVersion: async () => '1' }, aliceHarnessUpgrades: { currentVersion: current } }
    return { current, coordinator: new ProjectUpdateCoordinator(service as unknown as WorkspaceService, '/unused') }
  }
  it('preserves cached identities and freshness alongside a failed refresh, but cannot approve stale evidence', async () => {
    const { current, coordinator } = fixture()
    const first = await coordinator.inventorySnapshot()
    expect(first.units.some(u => u.id === 'alice-harness:chat')).toBe(true)
    current.mockRejectedValue(new Error('owner unavailable'))
    const failed = await coordinator.inventorySnapshot(true)
    expect(failed.units).toEqual(first.units)
    expect(failed.succeededAt).toBe(first.succeededAt)
    expect(failed.error).toBe('owner unavailable')
    await expect(coordinator.plan(['alice-harness:chat'])).rejects.toThrow('owner unavailable')
  })
  it('joins concurrent readers and refreshes explicitly after Workspace creation', async () => {
    const { current, coordinator } = fixture()
    await Promise.all([coordinator.inventory(), coordinator.inventory()])
    expect(current).toHaveBeenCalledTimes(1)
    await coordinator.inventorySnapshot(true)
    expect(current).toHaveBeenCalledTimes(2)
  })
  it('plans only requested content without reading unrelated Workspaces or layers', async () => {
    const current = vi.fn(async (workspace: { id: string }) => {
      if (workspace.id !== 'default-chat') throw new Error('Unrelated Workspace was read')
      return '1'
    })
    const injected = vi.fn(async () => { throw new Error('Unselected layer was read') })
    const service = {
      registry: { list: () => ['default-chat', 'old-chat'].map(id => ({ id, dir: `/fixture/${id}`, template: 'chat' })) },
      templates: { get: () => ({ upgradeStrategy: 'managed-context', version: '2' }) },
      templateUpgrades: { currentVersion: current, plan: async () => ({ planDigest: 'exact', toVersion: '2', blockers: [], summary: { conflicts: 0 } }) },
      aliceHarnessUpgrades: { currentVersion: injected },
    }
    const coordinator = new ProjectUpdateCoordinator(service as unknown as WorkspaceService, '/unused')
    const plan = await coordinator.plan(['template:default-chat'])
    expect(plan.proposals.map(proposal => proposal.unit.id)).toEqual(['template:default-chat'])
    expect(current).toHaveBeenCalledOnce()
    expect(injected).not.toHaveBeenCalled()
  })

})
