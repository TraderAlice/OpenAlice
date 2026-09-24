import { beforeEach, expect, it, vi } from 'vitest'
import { readUpdatePreferences } from '../core/update-preferences.js'
import { readHarnessSource } from './harness-source.js'
import { WorkspaceAutoUpdates } from './workspace-auto-updates.js'
import type { WorkspaceService } from './service.js'

vi.mock('../core/update-preferences.js', () => ({ readUpdatePreferences: vi.fn() }))
vi.mock('./harness-source.js', () => ({ readHarnessSource: vi.fn() }))

const preferences = { autoCheckApp: true, autoUpdateAutoQuant: true, autoUpdateAutoPrediction: true }
function service() {
  return {
    registry: { list: () => [{ id: 'aq', dir: '/workspace/aq', template: 'auto-quant-v2' }] },
    sourceUpgrades: {
      latest: vi.fn().mockResolvedValue({ version: '1.3.0', verified: false }),
      plan: vi.fn().mockResolvedValue({ blocked: false, blockers: [], planDigest: 'reviewed-digest' }),
      apply: vi.fn().mockResolvedValue({ workspaceId: 'aq' }),
    },
  }
}

beforeEach(() => {
  vi.mocked(readUpdatePreferences).mockResolvedValue({ ...preferences })
  vi.mocked(readHarnessSource).mockResolvedValue({ version: '1.2.0' } as Awaited<ReturnType<typeof readHarnessSource>>)
})

it('applies an upstream stable tag through the reviewed source manager when safe', async () => {
  const svc = service()
  const updates = new WorkspaceAutoUpdates(svc as unknown as WorkspaceService)
  await updates.check()
  expect(svc.sourceUpgrades.latest).toHaveBeenCalledWith('auto-quant-v2', '1.2.0', true)
  expect(svc.sourceUpgrades.plan).toHaveBeenCalledWith('aq', true, '1.3.0')
  expect(svc.sourceUpgrades.apply).toHaveBeenCalledWith('aq', true, { planDigest: 'reviewed-digest', targetVersion: '1.3.0' })
  expect(updates.list()).toMatchObject([{ phase: 'updated', verified: false }])
})

it('reports a blocker and leaves the Workspace untouched', async () => {
  const svc = service()
  svc.sourceUpgrades.plan.mockResolvedValue({ blocked: true, blockers: ['active_runtime'], planDigest: 'reviewed-digest' })
  const updates = new WorkspaceAutoUpdates(svc as unknown as WorkspaceService)
  await updates.check()
  expect(svc.sourceUpgrades.apply).not.toHaveBeenCalled()
  expect(updates.list()).toMatchObject([{ phase: 'blocked', reason: 'active_runtime' }])
})

it('respects the installation preference before querying upstream', async () => {
  vi.mocked(readUpdatePreferences).mockResolvedValue({ ...preferences, autoUpdateAutoQuant: false })
  const svc = service()
  const updates = new WorkspaceAutoUpdates(svc as unknown as WorkspaceService)
  await updates.check()
  expect(svc.sourceUpgrades.latest).not.toHaveBeenCalled()
  expect(updates.list()).toMatchObject([{ phase: 'disabled' }])
})
