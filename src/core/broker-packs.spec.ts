import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let home: string
let savedHome: string | undefined

beforeEach(async () => {
  savedHome = process.env['OPENALICE_HOME']
  home = await mkdtemp(resolve(tmpdir(), 'openalice-broker-pack-resolver-'))
  process.env['OPENALICE_HOME'] = home
  vi.resetModules()
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = savedHome
  vi.resetModules()
})

async function writeActivePack(options: {
  release?: string
  pointerEngine?: string
  manifestEngine?: string
  version?: string
  apiVersion?: number
  entry?: string
  packageName?: string
  packageVersion?: string
  writeEntry?: boolean
} = {}) {
  const { getCurrentVersion } = await import('./version.js')
  const release = options.release ?? '0.80.0-testcontent'
  const engineRoot = resolve(home, 'runtime/broker-packs/ccxt')
  const releaseRoot = resolve(engineRoot, 'releases', release)
  await mkdir(resolve(releaseRoot, 'dist'), { recursive: true })
  await writeFile(resolve(engineRoot, 'active.json'), JSON.stringify({
    schemaVersion: 1,
    engine: options.pointerEngine ?? 'ccxt',
    release,
    activatedAt: '2026-07-15T00:00:00.000Z',
  }))
  await writeFile(resolve(releaseRoot, 'broker-pack.json'), JSON.stringify({
    schemaVersion: 1,
    apiVersion: options.apiVersion ?? 1,
    engine: options.manifestEngine ?? 'ccxt',
    version: options.version ?? getCurrentVersion(),
    entry: options.entry ?? 'dist/index.js',
    contentId: 'testcontent',
    installedAt: '2026-07-15T00:00:00.000Z',
  }))
  await writeFile(resolve(releaseRoot, 'package.json'), JSON.stringify({
    name: options.packageName ?? '@traderalice/uta-broker-ccxt',
    version: options.packageVersion ?? options.version ?? getCurrentVersion(),
    type: 'module',
  }))
  if (options.writeEntry !== false) {
    await writeFile(resolve(releaseRoot, 'dist/index.js'), 'export const ok = true\n')
  }
  return { engineRoot, releaseRoot }
}

describe('resolveActiveBrokerPack', () => {
  it('returns null when no pack has been activated', async () => {
    const { resolveActiveBrokerPack } = await import('./broker-packs.js')

    await expect(resolveActiveBrokerPack('ccxt')).resolves.toBeNull()
  })

  it('resolves a version-matched immutable release entry', async () => {
    const { releaseRoot } = await writeActivePack()
    const { resolveActiveBrokerPack } = await import('./broker-packs.js')

    const resolved = await resolveActiveBrokerPack('ccxt')

    expect(resolved).toMatchObject({
      root: releaseRoot,
      entry: resolve(releaseRoot, 'dist/index.js'),
      pointer: { engine: 'ccxt', release: '0.80.0-testcontent' },
      manifest: { engine: 'ccxt', apiVersion: 1, contentId: 'testcontent' },
    })
  })

  it('rejects a pointer for a different engine', async () => {
    await writeActivePack({ pointerEngine: 'alpaca' })
    const { resolveActiveBrokerPack } = await import('./broker-packs.js')

    await expect(resolveActiveBrokerPack('ccxt')).rejects.toThrow(/pointer mismatch/i)
  })

  it('rejects release traversal before reading outside the engine root', async () => {
    const engineRoot = resolve(home, 'runtime/broker-packs/ccxt')
    await mkdir(engineRoot, { recursive: true })
    await writeFile(resolve(engineRoot, 'active.json'), JSON.stringify({
      schemaVersion: 1,
      engine: 'ccxt',
      release: '../alpaca',
      activatedAt: '2026-07-15T00:00:00.000Z',
    }))
    const { resolveActiveBrokerPack } = await import('./broker-packs.js')

    await expect(resolveActiveBrokerPack('ccxt')).rejects.toThrow(/invalid broker-pack release/i)
  })

  it('rejects an incompatible manifest API or engine', async () => {
    await writeActivePack({ apiVersion: 2, manifestEngine: 'alpaca' })
    const { resolveActiveBrokerPack } = await import('./broker-packs.js')

    await expect(resolveActiveBrokerPack('ccxt')).rejects.toThrow(/incompatible/i)
  })

  it('reports an API-version mismatch with the installed release version', async () => {
    await writeActivePack({ apiVersion: 2, version: '0.84.0-beta' })
    const {
      BrokerPackApiVersionMismatchError,
      resolveActiveBrokerPack,
    } = await import('./broker-packs.js')

    await expect(resolveActiveBrokerPack('ccxt')).rejects.toEqual(expect.objectContaining({
      name: BrokerPackApiVersionMismatchError.name,
      installedApiVersion: 2,
      installedVersion: '0.84.0-beta',
    }))
  })

  it('keeps an older app-version Pack loadable when its Pack API is compatible', async () => {
    await writeActivePack({ version: '0.0.0-other' })
    const { resolveActiveBrokerPack } = await import('./broker-packs.js')

    await expect(resolveActiveBrokerPack('ccxt')).resolves.toMatchObject({
      manifest: { version: '0.0.0-other', apiVersion: 1 },
    })
  })

  it('rejects an entry path that escapes the immutable release', async () => {
    await writeActivePack({ entry: '../outside.js' })
    const { resolveActiveBrokerPack } = await import('./broker-packs.js')

    await expect(resolveActiveBrokerPack('ccxt')).rejects.toThrow(/entry escapes/i)
  })

  it('rejects a missing entry or mismatched package identity as a broken release', async () => {
    await writeActivePack({ writeEntry: false })
    const { resolveActiveBrokerPack } = await import('./broker-packs.js')
    await expect(resolveActiveBrokerPack('ccxt')).rejects.toThrow(/ENOENT/i)

    await writeActivePack({ packageName: '@traderalice/uta-broker-alpaca' })
    await expect(resolveActiveBrokerPack('ccxt')).rejects.toThrow(/invalid package identity/i)
  })

  if (process.platform !== 'win32') {
    it('rejects an entry symlink that resolves outside the immutable release', async () => {
      const { releaseRoot } = await writeActivePack({ writeEntry: false })
      const outside = resolve(home, 'outside.js')
      await writeFile(outside, 'export const escaped = true\n')
      await symlink(outside, resolve(releaseRoot, 'dist/index.js'))
      const { resolveActiveBrokerPack } = await import('./broker-packs.js')

      await expect(resolveActiveBrokerPack('ccxt')).rejects.toThrow(/entry escapes/i)
    })

    it('rejects a release directory symlink that escapes the engine release root', async () => {
      const { releaseRoot } = await writeActivePack()
      const outside = resolve(home, 'outside-release')
      await rename(releaseRoot, outside)
      await symlink(outside, releaseRoot, 'dir')
      const { resolveActiveBrokerPack } = await import('./broker-packs.js')

      await expect(resolveActiveBrokerPack('ccxt')).rejects.toThrow(/release escapes/i)
    })
  }
})
