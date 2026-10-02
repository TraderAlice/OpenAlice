import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { approveUpdate, createUpdatePlan, projectUpdateUnit, type UpdateOperation } from '@traderalice/update-lifecycle'
import { UpdateControlService, type UpdateControlOptions } from './update-control.ts'
import type { MachinePlanPreview } from './machine-management.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'update-control-')); roots.push(root)
  let version = '1.0.0', remote = '1.0.0', scope = 'cloud:project', projectDone = false
  let child: UpdateOperation | null = null
  const childPlan = createUpdatePlan('project', [{ unit: projectUpdateUnit('template:chat', 'template', 'workspace', { version: '1' }, { version: '2' }), fingerprint: 'files-hash', stages: ['apply', 'verify'] }])
  const machinePlan = (): MachinePlanPreview => ({ id: 'probe', mode: 'upgrade', machine: { key: 'cloud', sshTarget: 'fixture', label: 'Fixture' }, project: { key: 'project', displayName: 'Project' },
    platform: 'linux-arm64', installedVersion: remote, activeVersion: remote, targetVersion: '1.1.0', runtime: 'native', actions: remote === '1.1.0' ? [] : ['install native CLI', 'restart'], blocker: null, deferredUpdate: false, expiresAt: 'future' })
  const backendApply = vi.fn(async () => { remote = '1.1.0' })
  const install = vi.fn(async () => {})
  const project = vi.fn(async (path: string, body?: unknown) => {
    if (path === '/api/updates/plan') return childPlan
    if (path === '/api/updates/operations') { const request = body as { id: string }; child = approveUpdate(childPlan, childPlan.fingerprint, request.id, 'now'); return child }
    if (path.endsWith('/resume')) { projectDone = true; child = { ...child!, phase: 'succeeded' }; return child }
    return child
  })
  const options: UpdateControlOptions = { root, scope: () => scope, project, backend: { plan: async () => machinePlan(), apply: backendApply }, client: { current: () => version, downloaded: () => '1.1.0', install, ready: async () => true } }
  return { options, backendApply, install, project, setVersion: (value: string) => { version = value }, setScope: (value: string) => { scope = value }, projectDone: () => projectDone }
}
it('persists backend and project completion across controller recreation', async () => {
  const f = await fixture(), service = new UpdateControlService(f.options)
  const plan = await service.review({ client: true, backend: true, projectUnits: ['template:chat'] })
  await service.approve(plan, plan.fingerprint)
  const pending = await service.resume()
  expect(pending.phase).toBe('waiting'); expect(f.projectDone()).toBe(true)
  expect(f.backendApply).toHaveBeenCalledTimes(1); expect(f.install).toHaveBeenCalledTimes(1)
  f.setVersion('1.1.0')
  const restarted = new UpdateControlService(f.options)
  expect((await restarted.resume()).phase).toBe('succeeded')
  expect(f.backendApply).toHaveBeenCalledTimes(1); expect(f.install).toHaveBeenCalledTimes(1)
})
it('retains exact scope on target switching and joins two UI resume requests', async () => {
  const f = await fixture(), service = new UpdateControlService(f.options)
  const plan = await service.review({ client: false, backend: true, projectUnits: [] })
  await service.approve(plan, plan.fingerprint)
  f.setScope('cloud:other')
  expect((await service.resume()).phase).toBe('blocked'); expect(f.backendApply).not.toHaveBeenCalled()
  f.setScope('cloud:project')
  const first = service.resume(), second = service.resume()
  expect(first).toBe(second)
  expect((await first).phase).toBe('succeeded'); expect(f.backendApply).toHaveBeenCalledTimes(1)
})
it('rejects a changed approval and never executes a caller-edited child command', async () => {
  const f = await fixture(), service = new UpdateControlService(f.options)
  const plan = await service.review({ client: true, backend: false, projectUnits: [] })
  plan.proposals[0]!.unit.desired = { version: '0.1.0' }
  await expect(service.approve(plan, plan.fingerprint)).rejects.toThrow('changed')
  expect(f.install).not.toHaveBeenCalled()
})
