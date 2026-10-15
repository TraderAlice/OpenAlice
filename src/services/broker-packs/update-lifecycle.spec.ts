import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ root: '', disabled: true, installed: false, loaded: false,
  sha: 'a'.repeat(64), install: vi.fn(), restart: vi.fn() }))
vi.mock('../../core/broker-packs.js', () => ({
  brokerPackEngineRoot: () => f.root,
  resolveActiveBrokerPack: async () => f.installed ? { manifest: { version: '0.94.1', contentId: f.sha.slice(0, 16) } } : null,
}))
vi.mock('./installer.js', () => ({
  planBrokerPack: async () => ({ version: '0.94.1', sha256: f.sha }),
  getBrokerPackLocalStatus: async () => ({ version: '0.94.0' }),
  installBrokerPack: f.install,
}))
vi.mock('../uta-supervisor/url.js', () => ({ isUTADisabled: () => f.disabled, resolveUTAUrl: () => 'http://fixture' }))
vi.mock('../uta-supervisor/restart-trigger.js', () => ({ triggerUTARestart: f.restart }))
import { applyBrokerPackUpdate } from './update-lifecycle.js'
beforeEach(async () => {
  f.root = await mkdtemp(join(tmpdir(), 'pack-update-')); f.disabled = true; f.installed = false; f.loaded = false
  f.install.mockReset().mockImplementation(async () => { f.installed = true })
  f.restart.mockReset().mockResolvedValue({ ready: false, error: 'response lost' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ identity: f.loaded ? { version: '0.94.1', contentId: f.sha.slice(0, 16) } : null }))))
})
afterEach(async () => { vi.unstubAllGlobals(); await rm(f.root, { recursive: true, force: true }) })
it('leaves an optional disabled UTA waiting without reinstalling its Pack when UTA becomes available', async () => {
  expect((await applyBrokerPackUpdate('ccxt')).phase).toBe('waiting')
  expect(f.install).toHaveBeenCalledTimes(1); expect(f.restart).not.toHaveBeenCalled()
  f.disabled = false; f.loaded = true
  expect((await applyBrokerPackUpdate('ccxt')).phase).toBe('succeeded')
  expect(f.install).toHaveBeenCalledTimes(1); expect(f.restart).not.toHaveBeenCalled()
})
it('reconciles a lost UTA restart response from the exact loaded module without another restart', async () => {
  f.disabled = false
  expect((await applyBrokerPackUpdate('ccxt')).phase).toBe('waiting')
  f.loaded = true
  expect((await applyBrokerPackUpdate('ccxt')).phase).toBe('succeeded')
  expect(f.restart).toHaveBeenCalledTimes(1); expect(f.install).toHaveBeenCalledTimes(1)
})
it('retains the approved checksum when the catalog changes during execution', async () => {
  f.install.mockRejectedValueOnce(new Error('Broker Pack catalog changed after review'))
  const failed = await applyBrokerPackUpdate('ccxt')
  expect(failed.phase).toBe('failed'); expect(failed.plan.proposals[0]!.fingerprint).toBe(f.sha)
  expect(f.restart).not.toHaveBeenCalled()
})
