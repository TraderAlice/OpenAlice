import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CLI_VERSION } from '../../../packages/cli/src/install-source.mjs'
import { ClientUpdateService } from '../../../packages/cli/src/client-updates.ts'
import { WebRelay } from '../../../packages/cli/src/web-relay.ts'

let root: string
const services: ClientUpdateService[] = []
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'alice-client-updates-')) })
afterEach(async () => { services.forEach(service => service.stop()); services.length = 0; await rm(root, { recursive: true, force: true }) })
const release = { status: 'available' as const, currentVersion: '1.0.0', latestVersion: '1.1.0', channel: 'stable' }
function service(discover = vi.fn(async () => release)) {
  const value = new ClientUpdateService({ path: join(root, 'policy.json'), discover })
  services.push(value)
  return value
}
it('does no discovery on construction/status and persists host policy across owners', async () => {
  const discover = vi.fn(async () => release)
  const first = service(discover)
  expect((await first.snapshot()).preferences.autoCheck).toBe(true)
  await first.savePreferences({ autoCheck: false })
  expect((await service(discover).snapshot()).preferences.autoCheck).toBe(false)
  first.activate()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(discover).not.toHaveBeenCalled()
  expect((await first.check()).discovery.value).toEqual({ ...release, currentVersion: CLI_VERSION })
  expect(discover).toHaveBeenCalledOnce()
  expect(discover).toHaveBeenCalledWith(CLI_VERSION)
  expect(first.currentVersion).toBe(CLI_VERSION)
})
it('coalesces manual checks and keeps last evidence after a failed check', async () => {
  let finish!: (value: typeof release) => void
  const discover = vi.fn(() => new Promise<typeof release>(resolve => { finish = resolve }))
  const owner = service(discover)
  const first = owner.check()
  const second = owner.check()
  await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
  finish(release)
  await Promise.all([first, second])
  discover.mockRejectedValueOnce(new Error('feed offline'))
  const failed = await owner.check()
  expect(failed.discovery.value).toEqual({ ...release, currentVersion: CLI_VERSION })
  expect(failed.discovery.error).toBe('feed offline')
})
it('activates once after shell readiness and rejects malformed policy without changing it', async () => {
  const discover = vi.fn(async () => release)
  const owner = service(discover)
  owner.activate(); owner.activate()
  await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
  await expect(owner.savePreferences({ autoCheck: 'false' })).rejects.toThrow()
  expect((await owner.snapshot()).preferences.autoCheck).toBe(true)
})

it('serves the injected desktop owner through HTTP with the same identity, policy and observation', async () => {
  const owner = new ClientUpdateService({ kind: 'desktop', path: join(root, 'desktop.json'), discover: async () => release })
  services.push(owner)
  const relay = new WebRelay({ clientUpdates: owner })
  try {
    const origin = await relay.listen()
    await owner.savePreferences({ autoCheck: false })
    const expected = await owner.check()
    const response = await fetch(`${origin}/relay/v1/updates`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expected)
    expect(expected).toMatchObject({ kind: 'desktop', currentVersion: CLI_VERSION, preferences: { autoCheck: false },
      discovery: { value: { currentVersion: CLI_VERSION } } })
  } finally { await relay.close() }
})
