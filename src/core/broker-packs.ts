/**
 * Broker-pack installed-state contract shared by Alice and UTA.
 * Alice installs and activates immutable releases; UTA only resolves them.
 */

import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { runtimePath } from './paths.js'
import { getCurrentVersion } from './version.js'

export const BROKER_PACK_SCHEMA_VERSION = 1 as const
export const BROKER_PACK_API_VERSION = 1 as const

export const INSTALLABLE_BROKER_ENGINES = [
  'ccxt',
  'alpaca',
  'ibkr',
  'leverup',
  'longbridge',
  'snaptrade',
] as const

export type InstallableBrokerEngine = typeof INSTALLABLE_BROKER_ENGINES[number]

export interface BrokerPackActivePointer {
  schemaVersion: typeof BROKER_PACK_SCHEMA_VERSION
  engine: InstallableBrokerEngine
  release: string
  activatedAt: string
}

export interface InstalledBrokerPackManifest {
  schemaVersion: typeof BROKER_PACK_SCHEMA_VERSION
  apiVersion: typeof BROKER_PACK_API_VERSION
  engine: InstallableBrokerEngine
  version: string
  entry: string
  contentId: string
  installedAt: string
  sourceUrl?: string
}

export interface ResolvedBrokerPack {
  root: string
  entry: string
  pointer: BrokerPackActivePointer
  manifest: InstalledBrokerPackManifest
}

export interface ResolvedBrokerPackRelease {
  root: string
  entry: string
  manifest: InstalledBrokerPackManifest
}

export function isInstallableBrokerEngine(value: string): value is InstallableBrokerEngine {
  return (INSTALLABLE_BROKER_ENGINES as readonly string[]).includes(value)
}

export function brokerPackEngineRoot(engine: InstallableBrokerEngine): string {
  return runtimePath('broker-packs', engine)
}

export function brokerPackActivePath(engine: InstallableBrokerEngine): string {
  return resolve(brokerPackEngineRoot(engine), 'active.json')
}

export function brokerPackReleasesRoot(engine: InstallableBrokerEngine): string {
  return resolve(brokerPackEngineRoot(engine), 'releases')
}

export async function resolveActiveBrokerPack(engine: InstallableBrokerEngine): Promise<ResolvedBrokerPack | null> {
  let pointerRaw: unknown
  try {
    pointerRaw = JSON.parse(await readFile(brokerPackActivePath(engine), 'utf8'))
  } catch (err) {
    if (isMissingFile(err)) return null
    throw err
  }

  const pointer = parseActivePointer(pointerRaw, engine)
  const release = await resolveBrokerPackRelease(engine, pointer.release)
  return { ...release, pointer }
}

export async function resolveBrokerPackRelease(
  engine: InstallableBrokerEngine,
  release: string,
): Promise<ResolvedBrokerPackRelease> {
  if (!/^[A-Za-z0-9._-]+$/.test(release)) {
    throw new Error(`Invalid broker-pack release id for ${engine}`)
  }
  const releasesRoot = brokerPackReleasesRoot(engine)
  const root = resolve(releasesRoot, release)
  assertChild(releasesRoot, root, 'release')

  const manifestPath = resolve(root, 'broker-pack.json')
  const packagePath = resolve(root, 'package.json')
  const [realReleasesRoot, realRoot, realManifest, realPackage] = await Promise.all([
    realpath(releasesRoot),
    realpath(root),
    realpath(manifestPath),
    realpath(packagePath),
  ])
  assertChild(realReleasesRoot, realRoot, 'release')
  assertChild(realRoot, realManifest, 'manifest')
  assertChild(realRoot, realPackage, 'package')

  const manifest = parseInstalledManifest(
    JSON.parse(await readFile(manifestPath, 'utf8')),
    engine,
  )
  const currentVersion = getCurrentVersion()
  if (manifest.version !== currentVersion) {
    throw new Error(
      `Installed broker pack ${engine} targets OpenAlice ${manifest.version}; ${currentVersion} is running`,
    )
  }
  const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { name?: unknown; version?: unknown }
  if (pkg.name !== `@traderalice/uta-broker-${engine}` || pkg.version !== manifest.version) {
    throw new Error(`Installed broker pack ${engine} has an invalid package identity`)
  }
  const declaredEntry = resolve(root, manifest.entry)
  assertChild(root, declaredEntry, 'entry')
  const realEntry = await realpath(declaredEntry)
  assertChild(realRoot, realEntry, 'entry')
  return { root, entry: declaredEntry, manifest }
}

function parseActivePointer(raw: unknown, engine: InstallableBrokerEngine): BrokerPackActivePointer {
  if (!raw || typeof raw !== 'object') throw new Error(`Invalid active broker-pack pointer for ${engine}`)
  const row = raw as Record<string, unknown>
  if (row.schemaVersion !== BROKER_PACK_SCHEMA_VERSION || row.engine !== engine) {
    throw new Error(`Broker-pack pointer mismatch for ${engine}`)
  }
  if (typeof row.release !== 'string' || !/^[A-Za-z0-9._-]+$/.test(row.release)) {
    throw new Error(`Invalid broker-pack release id for ${engine}`)
  }
  if (typeof row.activatedAt !== 'string') throw new Error(`Invalid broker-pack activation time for ${engine}`)
  return row as unknown as BrokerPackActivePointer
}

function parseInstalledManifest(raw: unknown, engine: InstallableBrokerEngine): InstalledBrokerPackManifest {
  if (!raw || typeof raw !== 'object') throw new Error(`Invalid installed broker-pack manifest for ${engine}`)
  const row = raw as Record<string, unknown>
  if (
    row.schemaVersion !== BROKER_PACK_SCHEMA_VERSION
    || row.apiVersion !== BROKER_PACK_API_VERSION
    || row.engine !== engine
  ) {
    throw new Error(`Installed broker pack ${engine} is incompatible with this OpenAlice runtime`)
  }
  for (const key of ['version', 'entry', 'contentId', 'installedAt'] as const) {
    if (typeof row[key] !== 'string' || row[key].length === 0) {
      throw new Error(`Installed broker pack ${engine} has invalid ${key}`)
    }
  }
  return row as unknown as InstalledBrokerPackManifest
}

function assertChild(root: string, candidate: string, label: string): void {
  if (candidate === root || !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`Broker-pack ${label} escapes its allowed directory`)
  }
}

function isMissingFile(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
