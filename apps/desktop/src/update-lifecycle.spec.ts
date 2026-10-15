import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createUpdatePlan, projectUpdateUnit } from '@traderalice/update-lifecycle'
import { FileUpdateJournal } from '@traderalice/update-lifecycle/node'
import { UpdateControlService, type UpdateControlOptions } from '../../../packages/cli/src/update-control.ts'
import { DesktopUpdateLifecycle } from './update-lifecycle.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root() { const value = await mkdtemp(join(tmpdir(), 'desktop-lifecycle-')); roots.push(value); return value }
it('retains native handoff through controller recreation until exact binary AND required services are ready', async () => {
  const dir = await root(); let version = '0.94.1-beta.2'
  const service = new DesktopUpdateLifecycle(dir, () => version)
  const prepare = vi.fn(async () => { expect((await service.snapshot())?.inFlight).toBe('desktop:prepare') })
  const handoff = vi.fn(async () => { expect((await service.snapshot())?.inFlight).toBe('desktop:activate') })
  expect((await service.install('0.94.1', prepare, handoff)).phase).toBe('waiting')
  const restarted = new DesktopUpdateLifecycle(dir, () => version)
  version = '0.94.1'
  const waiting = await restarted.resume(async () => false)
  expect(waiting?.phase).toBe('waiting'); expect(waiting?.completed['desktop:activate']).toBeDefined()
  expect((await restarted.resume(async () => true))?.phase).toBe('succeeded')
  expect(prepare).toHaveBeenCalledTimes(1); expect(handoff).toHaveBeenCalledTimes(1)
})
it('does not call a different newer desktop success or restart it blindly', async () => {
  const dir = await root(); let version = '0.94.1'
  const service = new DesktopUpdateLifecycle(dir, () => version)
  await service.install('0.94.2', async () => {}, async () => {})
  version = '0.94.3'
  expect((await new DesktopUpdateLifecycle(dir, () => version).resume(async () => true))?.phase).toBe('recovery')
  await expect(service.install('0.94.4', async () => {}, async () => {})).rejects.toThrow('approved')
})
it('rechecks exact identity after verification while waiting for service readiness', async () => {
  const dir = await root(); let version = '0.94.1'
  const service = new DesktopUpdateLifecycle(dir, () => version)
  await service.install('0.94.2', async () => {}, async () => {})
  version = '0.94.2'
  expect((await service.resume(async () => false))?.completed['desktop:verify']).toBeDefined()
  version = '0.94.3'
  expect((await service.resume(async () => true))?.phase).toBe('recovery')
})

async function coordinatedFixture() {
  const dir = await root()
  let version = '1.0.0'
  const native = new DesktopUpdateLifecycle(dir, () => version)
  const project = new FileUpdateJournal(join(dir, 'project'), 'project')
  const projectPlan = createUpdatePlan('project', [{
    unit: projectUpdateUnit('template:chat', 'template', 'workspace', { version: '1.0.0' }, { version: '1.1.0' }),
    fingerprint: 'content', stages: ['apply', 'verify'],
  }])
  const prepare = vi.fn(async () => {})
  const handoff = vi.fn(async () => { throw new Error('native handoff failed') })
  const options: UpdateControlOptions = {
    root: dir, scope: () => 'local:project',
    project: async (path, body) => {
      if (path === '/api/updates/plan') return projectPlan
      if (path === '/api/updates/operations') return project.approve(projectPlan, projectPlan.fingerprint, (body as { id: string }).id)
      if (path.endsWith('/resume')) return project.run({ reconcile: async () => ({ status: 'ready' }), execute: async () => ({ status: 'complete', receipt: 'content-applied' }) })
      return project.read()
    },
    client: {
      current: () => version, downloaded: () => '1.1.0', ready: async () => true,
      install: (target, parent) => native.install(target, prepare, handoff, parent),
      recovery: { status: () => native.snapshot(), resume: () => native.resume(async () => true), abandon: () => native.journal.abandon() },
    },
  }
  const control = new UpdateControlService(options)
  const approve = async (client: boolean) => {
    const plan = await control.review({ client, backend: false, projectUnits: ['template:chat'] })
    return control.approve(plan, plan.fingerprint)
  }
  return { options, control, native, prepare, handoff, approve, setVersion: (next: string) => { version = next } }
}
it('routes completed project history plus failed native activation to the native receipt for all recovery commands', async () => {
  const f = await coordinatedFixture()
  const parent = await f.approve(false)
  expect((await f.control.resume()).phase).toBe('succeeded')
  const failed = await f.native.install('1.1.0', f.prepare, f.handoff)
  expect(failed.phase).toBe('failed')
  const restarted = new UpdateControlService(f.options)
  expect((await restarted.status())?.id).toBe(failed.id)
  expect((await restarted.resume()).id).toBe(failed.id)
  expect(f.handoff).toHaveBeenCalledTimes(1)
  await restarted.abandon()
  expect(await f.native.snapshot()).toBeNull()
  expect((await restarted.status())?.id).toBe(parent.id)
})
it('routes unfinished project work ahead of completed native history and rejects a new approval', async () => {
  const f = await coordinatedFixture()
  await f.native.install('1.1.0', f.prepare, async () => {})
  f.setVersion('1.1.0')
  expect((await f.native.resume(async () => true))?.phase).toBe('succeeded')
  const parent = await f.approve(false)
  expect((await f.control.status())?.id).toBe(parent.id)
  await expect(f.approve(true)).rejects.toThrow('unfinished update')
  await f.control.abandon()
  expect((await f.native.snapshot())?.phase).toBe('succeeded')
  expect((await f.control.resume()).phase).toBe('succeeded')
})
it('keeps a linked native child with its parent through restart and exact activation', async () => {
  const f = await coordinatedFixture()
  const parent = await f.approve(true)
  await f.control.resume()
  expect((await f.native.snapshot())?.plan.proposals[0]?.reference?.parentOperationId).toBe(parent.id)
  const restarted = new UpdateControlService(f.options)
  expect((await restarted.status())?.id).toBe(parent.id)
  const recovery = await restarted.resume()
  expect(recovery.id).toBe(parent.id)
  expect(recovery.phase).toBe('recovery')
  expect(f.handoff).toHaveBeenCalledTimes(1)
  f.setVersion('1.1.1')
  expect((await restarted.resume()).phase).toBe('recovery')
  f.setVersion('1.1.0')
  expect((await restarted.resume()).phase).toBe('succeeded')
  expect((await f.native.snapshot())?.phase).toBe('succeeded')
})
it('abandons a linked parent and child together without discarding an unrelated pending receipt', async () => {
  const f = await coordinatedFixture()
  await f.approve(true)
  await f.control.resume()
  await f.control.abandon()
  expect(await f.control.status()).toBeNull()
  expect(await f.native.snapshot()).toBeNull()

  const another = await f.approve(true)
  // Independent exact-version requests are not evidence of parentage.
  const native = await f.native.install('1.1.0', f.prepare, f.handoff)
  expect((await f.control.status())?.id).toBe(native.id)
  await expect(f.approve(false)).rejects.toThrow('unfinished native')
  await f.control.abandon()
  expect((await f.control.status())?.id).toBe(another.id)
})
it('does not adopt an existing native receipt into a different parent with the same target', async () => {
  const f = await coordinatedFixture()
  await f.native.install('1.1.0', f.prepare, f.handoff, 'parent-a')
  await expect(f.native.install('1.1.0', f.prepare, f.handoff, 'parent-b')).rejects.toThrow('approved desktop')
  expect(f.handoff).toHaveBeenCalledTimes(1)
})
