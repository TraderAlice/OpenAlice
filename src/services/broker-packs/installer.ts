/** Download, validate, stage, and atomically activate optional broker packs. */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, resolve, sep } from 'node:path'
import * as tar from 'tar'
import {
  BROKER_PACK_API_VERSION,
  BROKER_PACK_SCHEMA_VERSION,
  brokerPackActivePath,
  brokerPackEngineRoot,
  brokerPackReleasesRoot,
  BrokerPackApiVersionMismatchError,
  resolveActiveBrokerPack,
  resolveBrokerPackRelease,
  type BrokerPackActivePointer,
  type InstalledBrokerPackManifest,
  type InstallableBrokerEngine,
} from '../../core/broker-packs.js'
import {
  brokerPackCatalogFileName,
  type BrokerPackReleaseAsset,
  type BrokerPackReleaseCatalog,
} from '../../core/broker-pack-catalog.js'
import { getCurrentVersion } from '../../core/version.js'
import { assertBrokerPackRequirements } from './requirements.js'

const DEFAULT_BASE_URL = 'https://download.openalice.ai'
const MAX_PACK_BYTES = 512 * 1024 * 1024
const INSTALL_LOCK_STALE_MS = 10 * 60 * 1000

export interface BrokerPackLocalStatus {
  engine: InstallableBrokerEngine | 'mock'
  installed: boolean
  source: 'builtin' | 'workspace' | 'downloaded' | 'missing' | 'broken'
  version?: string
  updateAvailable?: boolean
  reason?: string
}

export async function getBrokerPackLocalStatus(engine: InstallableBrokerEngine | 'mock'): Promise<BrokerPackLocalStatus> {
  if (engine === 'mock') return { engine, installed: true, source: 'builtin', version: getCurrentVersion() }
  try {
    const active = await resolveActiveBrokerPack(engine)
    if (active) {
      return {
        engine,
        installed: true,
        source: 'downloaded',
        version: active.manifest.version,
        updateAvailable: active.manifest.version !== getCurrentVersion(),
      }
    }
  } catch (err) {
    if (err instanceof BrokerPackApiVersionMismatchError) {
      return {
        engine,
        installed: false,
        source: 'broken',
        version: err.installedVersion,
        updateAvailable: true,
        reason: err.message,
      }
    }
    return { engine, installed: false, source: 'broken', reason: err instanceof Error ? err.message : String(err) }
  }
  if (workspacePacksAvailable()) {
    return { engine, installed: true, source: 'workspace', version: getCurrentVersion() }
  }
  return { engine, installed: false, source: 'missing' }
}

export async function installBrokerPack(engine: InstallableBrokerEngine): Promise<BrokerPackLocalStatus> {
  const engineRoot = brokerPackEngineRoot(engine)
  const lock = resolve(engineRoot, '.install.lock')
  await mkdir(engineRoot, { recursive: true })
  await acquireInstallLock(lock, engine)

  const workRoot = resolve(engineRoot, `.staging-${process.pid}-${Date.now()}`)
  try {
    const catalogUrl = resolveCatalogUrl()
    const catalog = await fetchCatalog(catalogUrl)
    const asset = catalog.packs.find((row) => row.engine === engine)
    if (!asset) throw new Error(`No ${engine} broker pack is published for ${process.platform}-${process.arch}`)
    validateAsset(asset, getCurrentVersion())
    assertBrokerPackRequirements(asset, {
      platform: process.platform,
      glibcVersion: runtimeGlibcVersion(),
    })

    await mkdir(workRoot, { recursive: true })
    const archivePath = resolve(workRoot, basename(asset.file))
    const assetUrl = new URL(asset.file, catalogUrl).href
    await download(assetUrl, archivePath, asset.size)
    const actualSha = await sha256File(archivePath)
    if (actualSha !== asset.sha256) {
      throw new Error(`Broker-pack checksum mismatch: expected ${asset.sha256}, got ${actualSha}`)
    }

    const extracted = resolve(workRoot, 'payload')
    await mkdir(extracted, { recursive: true })
    await tar.x({ file: archivePath, cwd: extracted, strict: true, preservePaths: false })
    await validateExtractedPackage(extracted, engine, asset)

    const contentId = actualSha.slice(0, 16)
    const preferredRelease = `${safePart(asset.version)}-${contentId}`
    const installedAt = new Date().toISOString()
    const manifest: InstalledBrokerPackManifest = {
      schemaVersion: BROKER_PACK_SCHEMA_VERSION,
      apiVersion: BROKER_PACK_API_VERSION,
      engine,
      version: asset.version,
      entry: asset.entry,
      contentId,
      installedAt,
      sourceUrl: assetUrl,
    }
    await writeFile(resolve(extracted, 'broker-pack.json'), JSON.stringify(manifest, null, 2) + '\n')

    await mkdir(brokerPackReleasesRoot(engine), { recursive: true })
    const release = await activateImmutableRelease(extracted, engine, preferredRelease, asset, contentId)

    const pointer: BrokerPackActivePointer = {
      schemaVersion: BROKER_PACK_SCHEMA_VERSION,
      engine,
      release,
      activatedAt: new Date().toISOString(),
    }
    const activePath = brokerPackActivePath(engine)
    const activeTmp = `${activePath}.${process.pid}.tmp`
    await writeFile(activeTmp, JSON.stringify(pointer, null, 2) + '\n')
    await rename(activeTmp, activePath)
    return {
      engine,
      installed: true,
      source: 'downloaded',
      version: asset.version,
      updateAvailable: false,
    }
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined)
    await rm(lock, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function fetchCatalog(url: string): Promise<BrokerPackReleaseCatalog> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Broker-pack catalog request failed: HTTP ${res.status}`)
  const raw = await res.json() as Partial<BrokerPackReleaseCatalog>
  const version = getCurrentVersion()
  if (
    raw.schemaVersion !== 1
    || raw.openAliceVersion !== version
    || raw.platform !== process.platform
    || raw.arch !== process.arch
    || !Array.isArray(raw.packs)
  ) {
    throw new Error(`Broker-pack catalog is incompatible with OpenAlice ${version} on ${process.platform}-${process.arch}`)
  }
  return raw as BrokerPackReleaseCatalog
}

function validateAsset(asset: BrokerPackReleaseAsset, currentVersion: string): void {
  if (asset.version !== currentVersion) throw new Error(`Broker-pack asset targets OpenAlice ${asset.version}; expected ${currentVersion}`)
  if (asset.apiVersion !== BROKER_PACK_API_VERSION) throw new Error(`Broker-pack API ${asset.apiVersion} is unsupported`)
  if (!/^[A-Za-z0-9._-]+$/.test(asset.file) || basename(asset.file) !== asset.file) throw new Error('Invalid broker-pack asset name')
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid broker-pack checksum')
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_PACK_BYTES) throw new Error('Invalid broker-pack size')
  if (!asset.entry || asset.entry.startsWith('/') || asset.entry.includes('..')) throw new Error('Invalid broker-pack entry')
}

async function activateImmutableRelease(
  extracted: string,
  engine: InstallableBrokerEngine,
  preferredRelease: string,
  asset: BrokerPackReleaseAsset,
  contentId: string,
): Promise<string> {
  const active = await resolveActiveBrokerPack(engine).catch(() => null)
  if (
    active
    && active.manifest.contentId === contentId
    && active.manifest.entry === asset.entry
    && active.manifest.version === asset.version
  ) {
    return active.pointer.release
  }

  if (await releaseMatches(engine, preferredRelease, asset, contentId)) return preferredRelease

  const preferredRoot = resolve(brokerPackReleasesRoot(engine), preferredRelease)
  if (!await pathExists(preferredRoot)) {
    try {
      await rename(extracted, preferredRoot)
      return preferredRelease
    } catch (err) {
      // A destination may appear between the existence check and rename. This
      // is also how Windows reports a rename onto an existing directory.
      if (await releaseMatches(engine, preferredRelease, asset, contentId)) return preferredRelease
      if (!await pathExists(preferredRoot)) throw err
    }
  }

  // Never mutate a corrupt immutable release in place: the running UTA may
  // still have its native files open on Windows. Install a fresh repair release
  // and switch active.json only after the replacement is complete.
  const repairRelease = await nextRepairReleaseId(engine, preferredRelease)
  await rename(extracted, resolve(brokerPackReleasesRoot(engine), repairRelease))
  return repairRelease
}

async function releaseMatches(
  engine: InstallableBrokerEngine,
  release: string,
  asset: BrokerPackReleaseAsset,
  contentId: string,
): Promise<boolean> {
  try {
    const existing = await resolveBrokerPackRelease(engine, release)
    return existing.manifest.contentId === contentId
      && existing.manifest.entry === asset.entry
      && existing.manifest.version === asset.version
  } catch {
    return false
  }
}

async function nextRepairReleaseId(engine: InstallableBrokerEngine, base: string): Promise<string> {
  const stamp = `${Date.now()}-${process.pid}`
  for (let attempt = 0; attempt < 100; attempt++) {
    const release = `${base}-repair-${stamp}-${attempt}`
    if (!await pathExists(resolve(brokerPackReleasesRoot(engine), release))) return release
  }
  throw new Error(`Unable to allocate a repair release for ${engine}`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (err) {
    if (isCode(err, 'ENOENT')) return false
    throw err
  }
}

async function download(url: string, target: string, expectedSize: number): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok || !res.body) throw new Error(`Broker-pack download failed: HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_PACK_BYTES || declared > expectedSize + 1024) throw new Error('Broker-pack download is larger than published metadata')
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(target, { flags: 'wx' }))
  const downloaded = (await stat(target)).size
  if (downloaded !== expectedSize) throw new Error(`Broker-pack size mismatch: expected ${expectedSize}, got ${downloaded}`)
}

async function validateExtractedPackage(root: string, engine: InstallableBrokerEngine, asset: BrokerPackReleaseAsset): Promise<void> {
  const packagePath = resolve(root, 'package.json')
  const [realRoot, realPackage, realEntry] = await Promise.all([
    realpath(root),
    realpath(packagePath),
    realpath(resolve(root, asset.entry)),
  ])
  if (realPackage === realRoot || !realPackage.startsWith(`${realRoot}${sep}`)) {
    throw new Error(`Broker-pack package metadata escapes the extracted package for ${engine}`)
  }
  if (realEntry === realRoot || !realEntry.startsWith(`${realRoot}${sep}`)) {
    throw new Error(`Broker-pack entry escapes the extracted package for ${engine}`)
  }
  const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { name?: unknown; version?: unknown }
  if (pkg.name !== `@traderalice/uta-broker-${engine}`) throw new Error(`Broker-pack package name mismatch for ${engine}`)
  if (pkg.version !== asset.version) throw new Error(`Broker-pack package version mismatch for ${engine}`)
}

function resolveCatalogUrl(): string {
  const version = getCurrentVersion()
  const override = process.env['OPENALICE_BROKER_PACK_CATALOG_URL']?.trim()
  if (override) return override
  const base = (process.env['OPENALICE_BROKER_PACK_BASE_URL']?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '')
  return `${base}/${brokerPackCatalogFileName(version)}`
}

function workspacePacksAvailable(): boolean {
  if (process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'] === '1') return true
  if (process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'] === '0') return false
  return process.env['NODE_ENV'] === 'test'
    || process.env['OPENALICE_LAUNCHER'] === 'dev'
}

function runtimeGlibcVersion(): string | null {
  if (process.platform !== 'linux') return null
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } }
  return report.header?.glibcVersionRuntime ?? null
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function safePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-')
}

function isCode(err: unknown, code: string): boolean {
  return !!err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === code
}

async function acquireInstallLock(lock: string, engine: InstallableBrokerEngine): Promise<void> {
  try {
    await createInstallLock(lock)
    return
  } catch (err) {
    if (!isCode(err, 'EEXIST')) throw err
  }

  if (!await isRecoverableInstallLock(lock)) {
    throw new Error(`Another ${engine} broker-pack install is already running`)
  }

  const stale = `${lock}.stale-${process.pid}-${Date.now()}`
  try {
    await rename(lock, stale)
  } catch (err) {
    if (isCode(err, 'ENOENT') || isCode(err, 'EEXIST') || isCode(err, 'ENOTEMPTY')) {
      throw new Error(`Another ${engine} broker-pack install is already running`)
    }
    throw err
  }
  await rm(stale, { recursive: true, force: true })

  try {
    await createInstallLock(lock)
  } catch (err) {
    if (isCode(err, 'EEXIST')) throw new Error(`Another ${engine} broker-pack install is already running`)
    throw err
  }
}

async function createInstallLock(lock: string): Promise<void> {
  await mkdir(lock)
  try {
    await writeFile(resolve(lock, 'owner.json'), JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }) + '\n')
  } catch (err) {
    await rm(lock, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}

async function isRecoverableInstallLock(lock: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(resolve(lock, 'owner.json'), 'utf8')) as { pid?: unknown }
    if (Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0) {
      return !isProcessAlive(Number(owner.pid))
    }
  } catch {
    // An interrupted owner write is recoverable only after the directory ages.
  }
  try {
    return Date.now() - (await stat(lock)).mtimeMs >= INSTALL_LOCK_STALE_MS
  } catch {
    return true
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return !isCode(err, 'ESRCH')
  }
}
