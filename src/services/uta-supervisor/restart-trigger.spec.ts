import { afterEach, expect, it, vi } from 'vitest'
const files = vi.hoisted(() => ({ writeFile: vi.fn(async () => {}), rename: vi.fn(async () => {}), mkdir: vi.fn(async () => {}) }))
vi.mock('fs/promises', () => files)
vi.mock('./url.js', () => ({ isUTADisabled: () => false, resolveUTAUrl: () => 'http://fixture' }))
import { triggerUTARestart } from './restart-trigger.js'
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('serializes different Pack activation requests against the same UTA process', async () => {
  let started = 1
  files.rename.mockImplementation(async () => { started++ })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, startedAt: String(started) }))))
  const [first, second] = await Promise.all([
    triggerUTARestart({ flagPath: '/fixture/restart', intervalMs: 1 }),
    triggerUTARestart({ flagPath: '/fixture/restart', intervalMs: 1 }),
  ])
  expect(first).toMatchObject({ ready: true, oldStartedAt: '1', newStartedAt: '2' })
  expect(second).toMatchObject({ ready: true, oldStartedAt: '2', newStartedAt: '3' })
  expect(files.rename).toHaveBeenCalledTimes(2)
})
