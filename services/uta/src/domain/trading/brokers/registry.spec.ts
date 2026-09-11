import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let home: string
let savedEnv: Record<string, string | undefined>

beforeEach(async () => {
  savedEnv = {
    OPENALICE_HOME: process.env['OPENALICE_HOME'],
    OPENALICE_BROKER_PACK_PREFER_WORKSPACE: process.env['OPENALICE_BROKER_PACK_PREFER_WORKSPACE'],
    OPENALICE_BROKER_PACK_ALLOW_WORKSPACE: process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'],
  }
  home = await mkdtemp(resolve(tmpdir(), 'openalice-broker-registry-'))
  process.env['OPENALICE_HOME'] = home
  process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'] = '0'
  delete process.env['OPENALICE_BROKER_PACK_PREFER_WORKSPACE']
  vi.resetModules()
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
})

async function activateCcxtModule(release: string, source: string) {
  const { getCurrentVersion } = await import('@/core/version.js')
  const engineRoot = resolve(home, 'runtime/broker-packs/ccxt')
  const releaseRoot = resolve(engineRoot, 'releases', release)
  await mkdir(resolve(releaseRoot, 'dist'), { recursive: true })
  await writeFile(resolve(releaseRoot, 'dist/index.js'), source)
  await writeFile(resolve(releaseRoot, 'package.json'), JSON.stringify({
    name: '@traderalice/uta-broker-ccxt',
    version: getCurrentVersion(),
    type: 'module',
  }))
  await writeFile(resolve(releaseRoot, 'broker-pack.json'), JSON.stringify({
    schemaVersion: 1,
    apiVersion: 1,
    engine: 'ccxt',
    version: getCurrentVersion(),
    entry: 'dist/index.js',
    contentId: release,
    installedAt: '2026-07-15T00:00:00.000Z',
  }))
  await writeFile(resolve(engineRoot, 'active.json'), JSON.stringify({
    schemaVersion: 1,
    engine: 'ccxt',
    release,
    activatedAt: '2026-07-15T00:00:00.000Z',
  }))
}

function validModuleSource(overrides: { apiVersion?: number; engine?: string } = {}) {
  return [
    `export const BROKER_PACK_API_VERSION = ${overrides.apiVersion ?? 1}`,
    `export const BROKER_ENGINE = ${JSON.stringify(overrides.engine ?? 'ccxt')}`,
    'export const configSchema = { parse: (value) => value }',
    'export const createBroker = (config) => ({ id: config.id, label: config.label, brokerEngine: BROKER_ENGINE })',
  ].join('\n')
}

describe('broker engine registry', () => {
  it('keeps Mock built in while reporting an absent live engine without loading its SDK', async () => {
    const { loadBrokerEngine } = await import('./registry.js')

    await expect(loadBrokerEngine('ccxt')).rejects.toMatchObject({
      name: 'BrokerPackUnavailableError',
      code: 'BROKER_PACK_UNAVAILABLE',
      engine: 'ccxt',
    })

    const mock = await loadBrokerEngine('mock')
    expect(mock.configSchema).toBeTruthy()
    expect(mock.createBroker({ id: 'sim', brokerConfig: {} }).brokerEngine).toBe('mock')
  })

  it('uses source code only when explicitly preferred and workspace loading is allowed', async () => {
    await activateCcxtModule('valid-release', validModuleSource())
    process.env['OPENALICE_BROKER_PACK_PREFER_WORKSPACE'] = '1'
    const { loadBrokerEngine, clearBrokerEngineCache } = await import('./registry.js')
    const installed = await loadBrokerEngine('ccxt')
    expect('safeParse' in installed.configSchema).toBe(false)
    process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'] = '1'
    clearBrokerEngineCache()
    const source = await loadBrokerEngine('ccxt')
    expect(typeof source.configSchema.safeParse).toBe('function')
  })

  it('loads and validates an activated pack module', async () => {
    await activateCcxtModule('valid-release', validModuleSource())
    const { loadBrokerEngine } = await import('./registry.js')

    const entry = await loadBrokerEngine('ccxt')
    const broker = entry.createBroker({ id: 'okx-main', label: 'Main OKX', brokerConfig: {} })

    expect(entry.configSchema.parse({ mode: 'live' })).toEqual({ mode: 'live' })
    expect(broker).toMatchObject({ id: 'okx-main', label: 'Main OKX', brokerEngine: 'ccxt' })
  })

  it.each([
    ['API version', validModuleSource({ apiVersion: 2 }), /API version mismatch/i],
    ['engine identity', validModuleSource({ engine: 'alpaca' }), /engine mismatch/i],
    ['required exports', 'export const BROKER_PACK_API_VERSION = 1\nexport const BROKER_ENGINE = "ccxt"', /missing configSchema\/createBroker/i],
  ] as const)('wraps an invalid installed module with actionable %s detail', async (_label, source, message) => {
    await activateCcxtModule('invalid-release', source)
    const { loadBrokerEngine } = await import('./registry.js')

    await expect(loadBrokerEngine('ccxt')).rejects.toMatchObject({
      name: 'BrokerPackUnavailableError',
      code: 'BROKER_PACK_UNAVAILABLE',
      engine: 'ccxt',
      message: expect.stringMatching(message),
    })
  })

  it('evicts a failed load so a newly activated repair can load without restarting the test process', async () => {
    await activateCcxtModule('broken-release', validModuleSource({ apiVersion: 2 }))
    const { loadBrokerEngine } = await import('./registry.js')
    await expect(loadBrokerEngine('ccxt')).rejects.toThrow(/API version mismatch/i)

    await activateCcxtModule('repaired-release', validModuleSource())

    await expect(loadBrokerEngine('ccxt')).resolves.toMatchObject({
      configSchema: expect.any(Object),
      createBroker: expect.any(Function),
    })
  })

  it('wraps a corrupt active pointer as an actionable unavailable-pack error', async () => {
    const engineRoot = resolve(home, 'runtime/broker-packs/ccxt')
    await mkdir(engineRoot, { recursive: true })
    await writeFile(resolve(engineRoot, 'active.json'), '{not-json')
    const { loadBrokerEngine } = await import('./registry.js')

    await expect(loadBrokerEngine('ccxt')).rejects.toMatchObject({
      name: 'BrokerPackUnavailableError',
      code: 'BROKER_PACK_UNAVAILABLE',
      engine: 'ccxt',
      message: expect.stringMatching(/is invalid/i),
    })
  })
})
