#!/usr/bin/env tsx

/**
 * Release acceptance for the existing-user Broker Pack path.
 *
 * Seeds the real Broker Packs from the previous GitHub Release, serves the
 * current candidate catalog from dist/broker-packs, runs the same automatic
 * reconciliation used by Alice, and proves every active pointer moves to the
 * candidate without deleting the prior immutable release.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import * as tar from 'tar'

import {
  brokerPackActivePath,
  brokerPackReleasesRoot,
  resolveActiveBrokerPack,
  type BrokerPackActivePointer,
  type InstalledBrokerPackManifest,
  type InstallableBrokerEngine,
} from '../src/core/broker-packs.js'
import {
  brokerPackCatalogFileName,
  type BrokerPackReleaseAsset,
  type BrokerPackReleaseCatalog,
} from '../src/core/broker-pack-catalog.js'
import { getCurrentVersion } from '../src/core/version.js'
import { reconcileInstalledBrokerPacks } from '../src/services/broker-packs/auto-updater.js'
import { getBrokerPackLocalStatus } from '../src/services/broker-packs/installer.js'

const repoRoot = resolve(import.meta.dirname, '..')
const candidateRoot = resolve(repoRoot, 'dist', 'broker-packs')
const repository = 'TraderAlice/OpenAlice'

async function main(): Promise<void> {
  const currentVersion = getCurrentVersion()
  const previousTag = readPreviousTag(process.argv.slice(2), currentVersion)
  const previousVersion = previousTag.replace(/^v/, '')
  if (previousVersion === currentVersion) {
    throw new Error(`previous release ${previousTag} must differ from candidate ${currentVersion}`)
  }

  const candidateCatalog = await readCatalog(
    resolve(candidateRoot, brokerPackCatalogFileName(currentVersion)),
  )
  const previousCatalog = await fetchJson<BrokerPackReleaseCatalog>(
    releaseAssetUrl(previousTag, brokerPackCatalogFileName(previousVersion)),
  )
  assertCatalog(previousCatalog, previousVersion)
  assertCatalog(candidateCatalog, currentVersion)

  const home = await mkdtemp(resolve(tmpdir(), 'openalice-broker-pack-upgrade-'))
  const oldHome = process.env['OPENALICE_HOME']
  const oldCatalogUrl = process.env['OPENALICE_BROKER_PACK_CATALOG_URL']
  const server = await serveCandidateAssets(candidateRoot)

  try {
    process.env['OPENALICE_HOME'] = home
    process.env['OPENALICE_BROKER_PACK_CATALOG_URL'] =
      `http://127.0.0.1:${serverPort(server)}/${brokerPackCatalogFileName(currentVersion)}`

    const candidateEngines = new Set(candidateCatalog.packs.map((asset) => asset.engine))
    const previousAssets = previousCatalog.packs.filter((asset) => candidateEngines.has(asset.engine))
    if (previousAssets.length !== previousCatalog.packs.length) {
      throw new Error(
        `candidate is missing a Pack from ${previousTag}: ` +
        `${previousCatalog.packs.filter((asset) => !candidateEngines.has(asset.engine)).map((asset) => asset.engine).join(', ')}`,
      )
    }

    const previousReleases = new Map<InstallableBrokerEngine, string>()
    for (const asset of previousAssets) {
      const release = await seedPreviousRelease(previousTag, asset)
      previousReleases.set(asset.engine, release)
    }

    const before = await Promise.all(
      previousAssets.map((asset) => getBrokerPackLocalStatus(asset.engine)),
    )
    for (const status of before) {
      if (!status.updateAvailable || status.version !== previousVersion) {
        throw new Error(`previous ${status.engine} Pack was not recognized as updateable: ${JSON.stringify(status)}`)
      }
    }

    const result = await reconcileInstalledBrokerPacks({ force: true, restart: false })
    if (result.failed.length > 0) {
      throw new Error(`candidate reconciliation failed: ${JSON.stringify(result.failed)}`)
    }
    const expected = [...candidateEngines].sort()
    const updated = [...result.updated].sort()
    if (JSON.stringify(updated) !== JSON.stringify(expected)) {
      throw new Error(`updated ${updated.join(', ') || 'none'}; expected ${expected.join(', ')}`)
    }

    for (const engine of expected) {
      const active = await resolveActiveBrokerPack(engine)
      if (!active || active.manifest.version !== currentVersion) {
        throw new Error(`${engine} did not activate candidate ${currentVersion}`)
      }
      const previousRelease = previousReleases.get(engine)
      if (!previousRelease) throw new Error(`${engine} previous release id was not recorded`)
      await stat(resolve(brokerPackReleasesRoot(engine), previousRelease))
      const status = await getBrokerPackLocalStatus(engine)
      if (!status.installed || status.updateAvailable || status.version !== currentVersion) {
        throw new Error(`${engine} candidate status is invalid: ${JSON.stringify(status)}`)
      }
    }

    console.log(
      `[broker-pack-upgrade-smoke] ${previousTag} -> v${currentVersion}: ` +
      `${expected.join(', ')} upgraded atomically`,
    )
  } finally {
    await new Promise<void>((done) => server.close(() => done()))
    await rm(home, { recursive: true, force: true })
    restoreEnv('OPENALICE_HOME', oldHome)
    restoreEnv('OPENALICE_BROKER_PACK_CATALOG_URL', oldCatalogUrl)
  }
}

async function seedPreviousRelease(
  tag: string,
  asset: BrokerPackReleaseAsset,
): Promise<string> {
  const bytes = await fetchBytes(releaseAssetUrl(tag, asset.file))
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== asset.sha256) {
    throw new Error(`${asset.engine} previous-release checksum mismatch`)
  }
  if (bytes.length !== asset.size) {
    throw new Error(`${asset.engine} previous-release size mismatch`)
  }

  const release = `${asset.version}-${digest.slice(0, 16)}-upgrade-smoke`
  const releaseRoot = resolve(brokerPackReleasesRoot(asset.engine), release)
  await mkdir(releaseRoot, { recursive: true })
  const archive = resolve(releaseRoot, `${asset.engine}.tgz`)
  await writeFile(archive, bytes)
  await tar.x({ cwd: releaseRoot, file: archive, strict: true, preservePaths: false })
  await rm(archive)

  const manifest: InstalledBrokerPackManifest = {
    schemaVersion: 1,
    apiVersion: asset.apiVersion,
    engine: asset.engine,
    version: asset.version,
    entry: asset.entry,
    contentId: digest.slice(0, 16),
    installedAt: new Date().toISOString(),
    sourceUrl: releaseAssetUrl(tag, asset.file),
  }
  await writeFile(resolve(releaseRoot, 'broker-pack.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const pointer: BrokerPackActivePointer = {
    schemaVersion: 1,
    engine: asset.engine,
    release,
    activatedAt: new Date().toISOString(),
  }
  await mkdir(resolve(brokerPackActivePath(asset.engine), '..'), { recursive: true })
  await writeFile(brokerPackActivePath(asset.engine), `${JSON.stringify(pointer, null, 2)}\n`)
  return release
}

async function serveCandidateAssets(root: string): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      const name = basename(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
      if (!name) {
        res.statusCode = 404
        res.end()
        return
      }
      const bytes = await readFile(resolve(root, name))
      res.setHeader('content-length', String(bytes.length))
      res.end(bytes)
    } catch {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  return server
}

function readPreviousTag(args: string[], currentVersion: string): string {
  const index = args.indexOf('--from')
  if (index >= 0) {
    const value = args[index + 1]?.trim()
    if (!value) throw new Error('--from requires a release tag')
    return value.startsWith('v') ? value : `v${value}`
  }
  const tags = execFileSync('git', ['tag', '--sort=-creatordate'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean)
  const previous = tags.find((tag) => tag.replace(/^v/, '') !== currentVersion)
  if (!previous) throw new Error('no previous release tag found; pass --from <tag>')
  return previous
}

function releaseAssetUrl(tag: string, file: string): string {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`
}

async function readCatalog(path: string): Promise<BrokerPackReleaseCatalog> {
  return JSON.parse(await readFile(path, 'utf8')) as BrokerPackReleaseCatalog
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse((await fetchBytes(url)).toString('utf8')) as T
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function assertCatalog(catalog: BrokerPackReleaseCatalog, version: string): void {
  if (
    catalog.schemaVersion !== 1
    || catalog.openAliceVersion !== version
    || catalog.platform !== process.platform
    || catalog.arch !== process.arch
    || catalog.packs.length === 0
  ) {
    throw new Error(
      `invalid ${version} catalog for ${process.platform}-${process.arch}: ${JSON.stringify(catalog)}`,
    )
  }
}

function serverPort(server: Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('candidate server has no TCP port')
  return address.port
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

await main()
