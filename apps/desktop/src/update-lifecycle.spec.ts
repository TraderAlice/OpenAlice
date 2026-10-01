import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
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
