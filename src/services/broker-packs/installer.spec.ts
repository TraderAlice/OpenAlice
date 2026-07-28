import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as tar from 'tar'

import { brokerPackCatalogFileName } from '../../core/broker-pack-catalog.js'
import { getCurrentVersion } from '../../core/version.js'

let home: string
let fixture: string
let server: Server | undefined
let savedEnv: Record<string, string | undefined>

beforeEach(async () => {
  savedEnv = {
    OPENALICE_HOME: process.env['OPENALICE_HOME'],
    OPENALICE_BROKER_PACK_CATALOG_URL: process.env['OPENALICE_BROKER_PACK_CATALOG_URL'],
    OPENALICE_BROKER_PACK_ALLOW_WORKSPACE: process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'],
  }
  home = await mkdtemp(resolve(tmpdir(), 'openalice-broker-pack-home-'))
  fixture = await mkdtemp(resolve(tmpdir(), 'openalice-broker-pack-fixture-'))
  process.env['OPENALICE_HOME'] = home
  process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'] = '0'
})

afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()))
  server = undefined
  await rm(home, { recursive: true, force: true })
  await rm(fixture, { recursive: true, force: true })
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
})

interface PublishedPackOptions {
  packageName?: string
  packageVersion?: string
  checksum?: string
  catalogSize?: number
  catalogVersion?: string
  catalogPlatform?: NodeJS.Platform
  catalogArch?: string
  assetVersion?: string
  apiVersion?: number
  includeAsset?: boolean
}

async function publishCcxtPack(options: PublishedPackOptions = {}) {
  const version = getCurrentVersion()
  const payload = resolve(fixture, `payload-${Date.now()}-${Math.random()}`)
  await mkdir(resolve(payload, 'dist'), { recursive: true })
  await writeFile(resolve(payload, 'package.json'), JSON.stringify({
    name: options.packageName ?? '@traderalice/uta-broker-ccxt',
    version: options.packageVersion ?? version,
    type: 'module',
    main: './dist/index.js',
  }))
  await writeFile(resolve(payload, 'dist/index.js'), 'export const API_VERSION = 1\n')

  const archiveName = `OpenAlice-Broker-ccxt-${version}-${process.platform}-${process.arch}.tgz`
  const archive = resolve(fixture, archiveName)
  await tar.c({ gzip: true, cwd: payload, file: archive }, ['package.json', 'dist'])
  const bytes = await readFile(archive)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const catalogName = brokerPackCatalogFileName(version)
  const asset = {
    engine: 'ccxt',
    version: options.assetVersion ?? version,
    apiVersion: options.apiVersion ?? 1,
    file: archiveName,
    entry: 'dist/index.js',
    sha256: options.checksum ?? sha256,
    size: options.catalogSize ?? bytes.length,
  }
  const catalog = {
    schemaVersion: 1,
    openAliceVersion: options.catalogVersion ?? version,
    platform: options.catalogPlatform ?? process.platform,
    arch: options.catalogArch ?? process.arch,
    packs: options.includeAsset === false ? [] : [asset],
  }

  server = createServer((req, res) => {
    if (req.url === `/${catalogName}`) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(catalog))
    } else if (req.url === `/${archiveName}`) {
      res.setHeader('content-length', String(bytes.length))
      res.end(bytes)
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no TCP address')
  process.env['OPENALICE_BROKER_PACK_CATALOG_URL'] = `http://127.0.0.1:${address.port}/${catalogName}`
  return { version, sha256, catalog, asset }
}

async function loadInstaller() {
  vi.resetModules()
  return import('./installer.js')
}

async function seedCompatibleCcxtPack(version = '0.84.0-beta', apiVersion = 1) {
  const { brokerPackEngineRoot } = await import('../../core/broker-packs.js')
  const engineRoot = brokerPackEngineRoot('ccxt')
  const release = `${version}-existing`
  const releaseRoot = resolve(engineRoot, 'releases', release)
  await mkdir(resolve(releaseRoot, 'dist'), { recursive: true })
  await writeFile(resolve(engineRoot, 'active.json'), JSON.stringify({
    schemaVersion: 1,
    engine: 'ccxt',
    release,
    activatedAt: '2026-07-20T00:00:00.000Z',
  }))
  await writeFile(resolve(releaseRoot, 'broker-pack.json'), JSON.stringify({
    schemaVersion: 1,
    apiVersion,
    engine: 'ccxt',
    version,
    entry: 'dist/index.js',
    contentId: 'existing',
    installedAt: '2026-07-20T00:00:00.000Z',
  }))
  await writeFile(resolve(releaseRoot, 'package.json'), JSON.stringify({
    name: '@traderalice/uta-broker-ccxt',
    version,
    type: 'module',
  }))
  await writeFile(resolve(releaseRoot, 'dist/index.js'), 'export const API_VERSION = 1\n')
  return { engineRoot, release }
}

describe('broker-pack installer', () => {
  it('distinguishes built-in, workspace, missing, and broken local status', async () => {
    const { brokerPackEngineRoot } = await import('../../core/broker-packs.js')
    const engineRoot = brokerPackEngineRoot('ccxt')
    const { getBrokerPackLocalStatus } = await loadInstaller()

    await expect(getBrokerPackLocalStatus('mock')).resolves.toMatchObject({
      engine: 'mock', installed: true, source: 'builtin',
    })
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toEqual({
      engine: 'ccxt', installed: false, source: 'missing',
    })

    process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'] = '1'
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({
      engine: 'ccxt', installed: true, source: 'workspace',
    })

    process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'] = '0'
    await mkdir(engineRoot, { recursive: true })
    await writeFile(resolve(engineRoot, 'active.json'), '{not-json')
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({
      engine: 'ccxt', installed: false, source: 'broken', reason: expect.any(String),
    })
  })

  it('downloads, verifies, activates, and idempotently repairs a version-matched pack', async () => {
    const { version, sha256 } = await publishCcxtPack()
    const { installBrokerPack, getBrokerPackLocalStatus } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).resolves.toMatchObject({
      engine: 'ccxt', installed: true, source: 'downloaded', version,
    })
    await expect(installBrokerPack('ccxt')).resolves.toMatchObject({
      engine: 'ccxt', installed: true, source: 'downloaded', version,
    })
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({
      engine: 'ccxt', installed: true, source: 'downloaded', version,
    })

    const { brokerPackEngineRoot, resolveActiveBrokerPack } = await import('../../core/broker-packs.js')
    const active = await resolveActiveBrokerPack('ccxt')
    expect(active?.manifest).toMatchObject({ engine: 'ccxt', version, contentId: sha256.slice(0, 16) })
    expect(await readFile(active!.entry, 'utf8')).toContain('API_VERSION = 1')
    expect(await readdir(resolve(brokerPackEngineRoot('ccxt'), 'releases'))).toHaveLength(1)
    expect(await readdir(brokerPackEngineRoot('ccxt'))).not.toContain('.install.lock')
  })

  it('reports and atomically reconciles a compatible Pack left by the previous app release', async () => {
    const old = await seedCompatibleCcxtPack()
    const { version } = await publishCcxtPack()
    const { getBrokerPackLocalStatus } = await loadInstaller()

    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({
      installed: true,
      source: 'downloaded',
      version: '0.84.0-beta',
      updateAvailable: true,
    })

    const { reconcileInstalledBrokerPacks } = await import('./auto-updater.js')
    await expect(reconcileInstalledBrokerPacks({ force: true, restart: false })).resolves.toEqual({
      checked: ['ccxt'],
      updated: ['ccxt'],
      failed: [],
    })

    const { resolveActiveBrokerPack } = await import('../../core/broker-packs.js')
    await expect(resolveActiveBrokerPack('ccxt')).resolves.toMatchObject({
      manifest: { version },
    })
    expect(await readdir(resolve(old.engineRoot, 'releases'))).toContain(old.release)
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({
      installed: true,
      version,
      updateAvailable: false,
    })
  })

  it('automatically replaces an installed Pack whose declared API is no longer supported', async () => {
    await seedCompatibleCcxtPack('0.84.0-beta', 0)
    const { version } = await publishCcxtPack()
    const { getBrokerPackLocalStatus } = await loadInstaller()

    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({
      installed: false,
      source: 'broken',
      version: '0.84.0-beta',
      updateAvailable: true,
      reason: expect.stringMatching(/requires API 1/i),
    })

    const { reconcileInstalledBrokerPacks } = await import('./auto-updater.js')
    await expect(reconcileInstalledBrokerPacks({ force: true, restart: false })).resolves.toEqual({
      checked: ['ccxt'],
      updated: ['ccxt'],
      failed: [],
    })
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({
      installed: true,
      version,
      updateAvailable: false,
    })
  })

  it('does not activate a checksum mismatch and cleans staging plus its lock', async () => {
    await publishCcxtPack({ checksum: '0'.repeat(64) })
    const { installBrokerPack, getBrokerPackLocalStatus } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).rejects.toThrow(/checksum mismatch/i)
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({ installed: false, source: 'missing' })

    const { brokerPackEngineRoot } = await import('../../core/broker-packs.js')
    expect(await readdir(brokerPackEngineRoot('ccxt'))).toEqual([])
  })

  it('keeps the previous active release when a repair download fails validation', async () => {
    const published = await publishCcxtPack()
    const { installBrokerPack, getBrokerPackLocalStatus } = await loadInstaller()
    await installBrokerPack('ccxt')
    const { resolveActiveBrokerPack } = await import('../../core/broker-packs.js')
    const before = await resolveActiveBrokerPack('ccxt')

    published.asset.sha256 = '0'.repeat(64)
    await expect(installBrokerPack('ccxt')).rejects.toThrow(/checksum mismatch/i)

    const after = await resolveActiveBrokerPack('ccxt')
    expect(after?.pointer.release).toBe(before?.pointer.release)
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({ installed: true, source: 'downloaded' })
  })

  it('repairs a corrupt content-addressed release without mutating it in place', async () => {
    const { version } = await publishCcxtPack()
    const { installBrokerPack, getBrokerPackLocalStatus } = await loadInstaller()
    await installBrokerPack('ccxt')
    const { brokerPackEngineRoot, resolveActiveBrokerPack } = await import('../../core/broker-packs.js')
    const before = await resolveActiveBrokerPack('ccxt')
    await writeFile(resolve(before!.root, 'package.json'), JSON.stringify({
      name: '@traderalice/uta-broker-alpaca', version, type: 'module',
    }))

    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({
      installed: false, source: 'broken', reason: expect.stringMatching(/package identity/i),
    })
    await expect(installBrokerPack('ccxt')).resolves.toMatchObject({ installed: true, source: 'downloaded' })

    const after = await resolveActiveBrokerPack('ccxt')
    expect(after?.pointer.release).not.toBe(before?.pointer.release)
    expect(after?.pointer.release).toMatch(/-repair-/)
    expect(await readdir(resolve(brokerPackEngineRoot('ccxt'), 'releases'))).toHaveLength(2)
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({ installed: true, source: 'downloaded' })

    await expect(installBrokerPack('ccxt')).resolves.toMatchObject({ installed: true })
    expect(await readdir(resolve(brokerPackEngineRoot('ccxt'), 'releases'))).toHaveLength(2)
  })

  it.each([
    ['OpenAlice version', { catalogVersion: '0.0.0-other' }],
    ['platform', { catalogPlatform: process.platform === 'win32' ? 'linux' : 'win32' }],
    ['architecture', { catalogArch: `${process.arch}-other` }],
  ] as const)('rejects a catalog for the wrong %s', async (_label, options) => {
    await publishCcxtPack(options)
    const { installBrokerPack } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).rejects.toThrow(/catalog is incompatible/i)
  })

  it('rejects an unsupported pack API before downloading it', async () => {
    await publishCcxtPack({ apiVersion: 2 })
    const { installBrokerPack } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).rejects.toThrow(/API 2 is unsupported/i)
  })

  it('rejects an asset version that disagrees with its otherwise compatible catalog', async () => {
    await publishCcxtPack({ assetVersion: '0.0.0-other' })
    const { installBrokerPack } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).rejects.toThrow(/asset targets OpenAlice 0\.0\.0-other/i)
  })

  it('rejects an archive whose package identity does not match the engine', async () => {
    await publishCcxtPack({ packageName: '@traderalice/uta-broker-alpaca' })
    const { installBrokerPack, getBrokerPackLocalStatus } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).rejects.toThrow(/package name mismatch/i)
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({ installed: false, source: 'missing' })
  })

  it('rejects a truncated or oversized response using the catalog size', async () => {
    const published = await publishCcxtPack()
    published.asset.size += 1
    const { installBrokerPack } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).rejects.toThrow(/size mismatch/i)
  })

  it('reports a missing engine without creating an active pointer', async () => {
    await publishCcxtPack({ includeAsset: false })
    const { installBrokerPack, getBrokerPackLocalStatus } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).rejects.toThrow(/No ccxt broker pack is published/i)
    await expect(getBrokerPackLocalStatus('ccxt')).resolves.toMatchObject({ installed: false, source: 'missing' })
  })

  it('does not steal a lock owned by a live installer process', async () => {
    const { brokerPackEngineRoot } = await import('../../core/broker-packs.js')
    const lock = resolve(brokerPackEngineRoot('ccxt'), '.install.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(resolve(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    const { installBrokerPack } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).rejects.toThrow(/already running/i)
  })

  it('serializes simultaneous installs and leaves one valid active release', async () => {
    await publishCcxtPack()
    const { installBrokerPack } = await loadInstaller()

    const results = await Promise.allSettled([
      installBrokerPack('ccxt'),
      installBrokerPack('ccxt'),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ message: expect.stringMatching(/already running/i) }) }),
    ])
    const { brokerPackEngineRoot, resolveActiveBrokerPack } = await import('../../core/broker-packs.js')
    await expect(resolveActiveBrokerPack('ccxt')).resolves.toMatchObject({ manifest: { engine: 'ccxt' } })
    expect(await readdir(brokerPackEngineRoot('ccxt'))).not.toContain('.install.lock')
  })

  it('recovers an abandoned incomplete lock after its stale window', async () => {
    await publishCcxtPack()
    const { brokerPackEngineRoot } = await import('../../core/broker-packs.js')
    const lock = resolve(brokerPackEngineRoot('ccxt'), '.install.lock')
    await mkdir(lock, { recursive: true })
    const old = new Date(Date.now() - 11 * 60 * 1000)
    await utimes(lock, old, old)
    const { installBrokerPack } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).resolves.toMatchObject({ installed: true })
    expect(await readdir(brokerPackEngineRoot('ccxt'))).not.toContain('.install.lock')
  })

  it('immediately recovers a lock whose recorded owner process has exited', async () => {
    await publishCcxtPack()
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    const ownerPid = child.pid
    if (!ownerPid) throw new Error('test child did not receive a pid')
    await once(child, 'exit')

    const { brokerPackEngineRoot } = await import('../../core/broker-packs.js')
    const lock = resolve(brokerPackEngineRoot('ccxt'), '.install.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(resolve(lock, 'owner.json'), JSON.stringify({
      pid: ownerPid,
      startedAt: new Date().toISOString(),
    }))
    const { installBrokerPack } = await loadInstaller()

    await expect(installBrokerPack('ccxt')).resolves.toMatchObject({ installed: true })
    expect(await readdir(brokerPackEngineRoot('ccxt'))).not.toContain('.install.lock')
  })
})
