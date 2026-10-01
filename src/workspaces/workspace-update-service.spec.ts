import { beforeEach, expect, it, vi } from 'vitest'
import { readPreferences } from '../core/preferences.js'
import { readUpdatePreferences } from '../core/update-preferences.js'
import { readHarnessSource } from './harness-source.js'
import { WorkspaceUpdateService } from './workspace-update-service.js'
import type { WorkspaceService } from './service.js'

vi.mock('../core/update-preferences.js', () => ({ readUpdatePreferences: vi.fn() }))
vi.mock('../core/preferences.js', () => ({ readPreferences: vi.fn() }))
vi.mock('./harness-source.js', () => ({ readHarnessSource: vi.fn() }))

const preferences = { autoCheckApp: true, autoUpdateAutoQuant: true, autoUpdateAutoPrediction: true }
function service() {
  return {
    registry: { list: vi.fn(() => []), get: vi.fn(id => id === 'aq' ? { id, dir: '/workspace/aq', template: 'auto-quant-v2' } : undefined) },
    templates: { get: vi.fn(() => ({ version: '1.3.0', upgradeStrategy: 'managed-context' })) },
    templateUpgrades: { currentVersion: vi.fn(async () => '1.2.0'), plan: vi.fn() },
    sourceUpgrades: {
      latest: vi.fn().mockResolvedValue({ version: '1.3.0', verified: false }),
      plan: vi.fn().mockResolvedValue({ blocked: false, blockers: [], planDigest: 'reviewed-digest' }),
      apply: vi.fn().mockResolvedValue({ workspaceId: 'aq' }),
    },
  }
}

beforeEach(() => {
  vi.mocked(readPreferences).mockResolvedValue({ quickChat: { recentChatWorkspaceId: null }, autoQuant: { defaultWorkspaceId: 'aq' }, autoPrediction: { defaultWorkspaceId: null } } as Awaited<ReturnType<typeof readPreferences>>)
  vi.mocked(readUpdatePreferences).mockResolvedValue({ ...preferences })
  vi.mocked(readHarnessSource).mockResolvedValue({ version: '1.2.0' } as Awaited<ReturnType<typeof readHarnessSource>>)
})

it('applies an upstream stable tag through the reviewed source manager when safe', async () => {
  const svc = service()
  const updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  await updates.refreshAndApplyPolicy()
  expect(svc.sourceUpgrades.latest).toHaveBeenCalledWith('auto-quant-v2', '1.2.0', true)
  expect(svc.sourceUpgrades.plan).toHaveBeenCalledWith('aq', true, '1.3.0')
  expect(svc.sourceUpgrades.apply).toHaveBeenCalledWith('aq', true, { planDigest: 'reviewed-digest', targetVersion: '1.3.0' })
  expect(updates.list()).toMatchObject([{ phase: 'updated', verified: false }])
})

it('reports a blocker and leaves the Workspace untouched', async () => {
  const svc = service()
  svc.sourceUpgrades.plan.mockResolvedValue({ blocked: true, blockers: ['active_runtime'], planDigest: 'reviewed-digest' })
  const updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  await updates.refreshAndApplyPolicy()
  expect(svc.sourceUpgrades.apply).not.toHaveBeenCalled()
  expect(updates.list()).toMatchObject([{ phase: 'blocked', reason: 'active_runtime' }])
})

it('discovers available releases while automatic application is disabled', async () => {
  vi.mocked(readUpdatePreferences).mockResolvedValue({ ...preferences, autoUpdateAutoQuant: false })
  const svc = service()
  const updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  await updates.check()
  expect(svc.sourceUpgrades.latest).toHaveBeenCalled()
  await updates.applyPolicy()
  expect(svc.sourceUpgrades.apply).not.toHaveBeenCalled()
  expect(updates.list()).toMatchObject([{ phase: 'available', toVersion: '1.3.0' }])
})

it('manual checks never plan or apply even with automatic updates enabled', async () => {
  const svc = service()
  const updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  await updates.check()
  expect(svc.sourceUpgrades.plan).not.toHaveBeenCalled()
  expect(svc.sourceUpgrades.apply).not.toHaveBeenCalled()
  expect(updates.list()).toMatchObject([{ phase: 'available', toVersion: '1.3.0' }])
})

it('a preference revoked during planning prevents the merge', async () => {
  const svc = service()
  svc.sourceUpgrades.plan.mockImplementation(async () => {
    vi.mocked(readUpdatePreferences).mockResolvedValue({ ...preferences, autoUpdateAutoQuant: false })
    return { blocked: false, blockers: [], planDigest: 'reviewed-digest' }
  })
  const updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  await updates.refreshAndApplyPolicy()
  expect(svc.sourceUpgrades.apply).not.toHaveBeenCalled()
  expect(updates.list()).toMatchObject([{ phase: 'available' }])
})

it('coalesces checks and does not apply a retained candidate after failed discovery', async () => {
  const svc = service()
  const updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  const first = updates.check()
  expect(updates.check()).toBe(first)
  await first
  expect(svc.sourceUpgrades.latest).toHaveBeenCalledOnce()
  svc.sourceUpgrades.latest.mockRejectedValueOnce(new Error('upstream offline'))
  await updates.refreshAndApplyPolicy()
  expect(updates.list()).toMatchObject([{ phase: 'failed', failureStage: 'check', reason: 'upstream offline' }])
  expect(updates.list()[0].toVersion).toBeUndefined()
  expect(svc.sourceUpgrades.apply).not.toHaveBeenCalled()
})


it('checks only persisted defaults and includes Chat without generating any plans', async () => {
  const svc = service()
  vi.mocked(readPreferences).mockResolvedValue({ quickChat: { recentChatWorkspaceId: 'chat' }, autoQuant: { defaultWorkspaceId: 'aq' }, autoPrediction: { defaultWorkspaceId: null } } as Awaited<ReturnType<typeof readPreferences>>)
  svc.registry.get.mockImplementation(id => ({ id, dir: `/workspace/${id}`, template: id === 'chat' ? 'chat' : 'auto-quant-v2' }))
  svc.sourceUpgrades.latest.mockResolvedValueOnce(null as never)
  const updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  await updates.check()
  expect(updates.list()).toMatchObject([{ workspaceId: 'chat', phase: 'available', fromVersion: '1.2.0', toVersion: '1.3.0' }, { workspaceId: 'aq', phase: 'current' }])
  expect(svc.registry.list).not.toHaveBeenCalled()
  expect(svc.registry.get.mock.calls.map(([id]) => id)).toEqual(['chat', 'aq'])
  expect(svc.sourceUpgrades.plan).not.toHaveBeenCalled()
  expect(svc.templateUpgrades.plan).not.toHaveBeenCalled()
  svc.templateUpgrades.currentVersion.mockResolvedValue('1.3.0')
  await updates.check()
  expect(updates.list()[0]).toMatchObject({ phase: 'current' })
  expect(updates.list()[0].toVersion).toBeUndefined()
})

it('clears a failed check and old candidate on current discovery, without planning', async () => {
  const svc = service(), updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  await updates.check()
  svc.sourceUpgrades.latest.mockRejectedValueOnce(new Error('offline'))
  await updates.check()
  expect(updates.list()[0]).toMatchObject({ phase: 'failed', failureStage: 'check' })
  svc.sourceUpgrades.latest.mockResolvedValueOnce(null as never)
  await updates.refreshAndApplyPolicy()
  expect(updates.list()[0]).toEqual(expect.objectContaining({ phase: 'current' }))
  expect(updates.list()[0].reason).toBeUndefined()
  expect(updates.list()[0].toVersion).toBeUndefined()
  expect(svc.sourceUpgrades.plan).not.toHaveBeenCalled()
})

it('does not apply a target whose default was changed while reviewing', async () => {
  const svc = service(), updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  svc.sourceUpgrades.plan.mockImplementation(async () => {
    vi.mocked(readPreferences).mockResolvedValue({ quickChat: { recentChatWorkspaceId: null }, autoQuant: { defaultWorkspaceId: null }, autoPrediction: { defaultWorkspaceId: null } } as Awaited<ReturnType<typeof readPreferences>>)
    return { blocked: false, blockers: [], planDigest: 'reviewed-digest' }
  })
  await updates.refreshAndApplyPolicy()
  expect(svc.sourceUpgrades.apply).not.toHaveBeenCalled()
  await updates.check()
  expect(updates.list()).toEqual([])
})

it.each(['review', 'apply'] as const)('distinguishes %s failure from discovery failure', async stage => {
  const svc = service(), updates = new WorkspaceUpdateService(svc as unknown as WorkspaceService)
  if (stage === 'review') svc.sourceUpgrades.plan.mockRejectedValueOnce(new Error('preview failed'))
  else svc.sourceUpgrades.apply.mockRejectedValueOnce(new Error('write failed'))
  await updates.refreshAndApplyPolicy()
  expect(updates.list()[0]).toMatchObject({ phase: 'failed', failureStage: stage })
})
