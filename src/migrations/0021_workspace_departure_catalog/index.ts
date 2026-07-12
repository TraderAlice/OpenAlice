import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { WorkspaceCatalogRecord } from '../../workspaces/workspace-catalog.js'
import type { Migration } from '../types.js'

interface RegistryMeta {
  id: string
  tag: string
  dir: string
  createdAt: string
  agents?: string[]
  template?: string
  spawnedFromVersion?: string
}

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

async function readJson(path: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch { return null }
}

async function readRequiredRegistry(path: string): Promise<RegistryMeta[] | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) }
  catch { throw new Error('cannot migrate Workspace lifecycle: workspaces.json is not valid JSON') }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
    throw new Error('cannot migrate Workspace lifecycle: workspaces.json has an unsupported shape')
  }
  const workspaces = (parsed as { workspaces?: unknown }).workspaces
  if (!Array.isArray(workspaces)) {
    throw new Error('cannot migrate Workspace lifecycle: workspaces.json is missing workspaces[]')
  }
  const metas: RegistryMeta[] = []
  for (const value of workspaces) {
    if (!value || typeof value !== 'object') throw new Error('cannot migrate Workspace lifecycle: invalid registry row')
    const meta = value as RegistryMeta
    if (
      typeof meta.id !== 'string' || typeof meta.tag !== 'string' ||
      typeof meta.dir !== 'string' || typeof meta.createdAt !== 'string'
    ) throw new Error('cannot migrate Workspace lifecycle: invalid registry row')
    metas.push(meta)
  }
  return metas
}

async function readExistingCatalog(path: string): Promise<WorkspaceCatalogRecord[]> {
  let text: string
  try { text = await readFile(path, 'utf8') }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) }
  catch { throw new Error('cannot migrate Workspace lifecycle: workspace-catalog.json is not valid JSON') }
  if (
    !parsed || typeof parsed !== 'object' ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { workspaces?: unknown }).workspaces)
  ) throw new Error('cannot migrate Workspace lifecycle: workspace-catalog.json has an unsupported shape')
  const records = (parsed as { workspaces: WorkspaceCatalogRecord[] }).workspaces
  for (const record of records) {
    if (
      !record || typeof record.id !== 'string' || typeof record.tag !== 'string' ||
      typeof record.activeDir !== 'string' || typeof record.createdAt !== 'string' ||
      typeof record.updatedAt !== 'string' || !Array.isArray(record.agents) ||
      !['active', 'offboarding', 'departed', 'restoring', 'purging', 'purged'].includes(record.lifecycle)
    ) throw new Error('cannot migrate Workspace lifecycle: invalid catalog row')
  }
  return records
}

async function directoryNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

async function inferLegacyAgents(root: string, id: string): Promise<string[]> {
  const parsed = await readJson(join(root, 'state', `${id}.json`)) as { records?: unknown[] } | null
  const agents = new Set<string>()
  for (const value of Array.isArray(parsed?.records) ? parsed!.records! : []) {
    if (value && typeof value === 'object' && typeof (value as Record<string, unknown>)['agent'] === 'string') {
      agents.add((value as Record<string, string>)['agent']!)
    }
  }
  return agents.size > 0 ? [...agents] : ['claude']
}

function inferredTemplate(id: string): string | undefined {
  if (id.startsWith('chat-')) return 'chat'
  if (id.startsWith('auto-quant-')) return 'auto-quant'
  return undefined
}

function activeRecord(meta: RegistryMeta, now: string): WorkspaceCatalogRecord {
  return {
    id: meta.id,
    tag: meta.tag,
    activeDir: meta.dir,
    createdAt: meta.createdAt,
    agents: Array.isArray(meta.agents) && meta.agents.length > 0 ? meta.agents : ['claude'],
    ...(meta.template ? { template: meta.template } : {}),
    ...(meta.spawnedFromVersion ? { spawnedFromVersion: meta.spawnedFromVersion } : {}),
    lifecycle: 'active',
    updatedAt: now,
  }
}

async function legacyRecord(
  root: string,
  id: string,
  activeDir: string,
  departedDir: string,
  now: string,
): Promise<WorkspaceCatalogRecord> {
  const info = await stat(departedDir).catch(() => null)
  const createdAt = info && Number.isFinite(info.birthtimeMs) && info.birthtimeMs > 0
    ? info.birthtime.toISOString()
    : now
  const template = inferredTemplate(id)
  return {
    id,
    tag: id,
    activeDir,
    createdAt,
    agents: await inferLegacyAgents(root, id),
    ...(template ? { template } : {}),
    lifecycle: 'departed',
    updatedAt: now,
    departedDir,
    departedAt: now,
    reason: 'Imported from a legacy unregistered Workspace directory',
    legacyImported: true,
  }
}

/**
 * Move every directory that the active registry no longer tracks out of the
 * manager-visible `workspaces/` floor. Nothing is deleted: legacy rows enter
 * the Catalog as departed assets and can be restored explicitly later.
 */
export async function migrateWorkspaceDepartureCatalog(
  root: string = defaultLauncherRoot(),
): Promise<{ active: number; departed: number; moved: number; conflicts: number }> {
  const activeRoot = join(root, 'workspaces')
  const departedRoot = join(root, 'departed-workspaces')
  const activeDirectories = await directoryNames(activeRoot)
  const registryMetas = await readRequiredRegistry(join(root, 'workspaces.json'))
  if (registryMetas === null && activeDirectories.length > 0) {
    throw new Error('cannot migrate Workspace lifecycle: workspaces.json is missing while Workspace directories exist')
  }
  const activeMetas = registryMetas ?? []
  const activeById = new Map(activeMetas.map((meta) => [meta.id, meta]))
  const catalogPath = join(root, 'state', 'workspace-catalog.json')
  const records = new Map<string, WorkspaceCatalogRecord>()
  for (const value of await readExistingCatalog(catalogPath)) {
    if (!value || typeof value.id !== 'string') {
      throw new Error('cannot migrate Workspace lifecycle: invalid catalog row')
    }
    records.set(value.id, value)
  }
  const now = new Date().toISOString()
  for (const meta of activeMetas) records.set(meta.id, activeRecord(meta, now))

  // Preflight the complete move set before mutating anything. An ID collision
  // is an identity dispute, not a condition migration may resolve by picking a
  // directory or leaving a ghost desk on the active floor.
  const orphanIds: string[] = []
  const conflicts: string[] = []
  for (const id of activeDirectories) {
    const source = join(activeRoot, id)
    const registered = activeById.get(id)
    if (registered && resolve(registered.dir) === resolve(source)) continue
    if (registered) {
      conflicts.push(`${id}: registry points to ${registered.dir}, but ${source} also exists`)
      continue
    }
    if ((await stat(join(departedRoot, id)).catch(() => null)) !== null) {
      conflicts.push(`${id}: active and departed directories both exist`)
      continue
    }
    orphanIds.push(id)
  }
  if (conflicts.length > 0) {
    throw new Error(`cannot migrate Workspace lifecycle: identity conflicts:\n${conflicts.join('\n')}`)
  }

  await mkdir(departedRoot, { recursive: true })
  let moved = 0
  for (const id of orphanIds) {
    const source = join(activeRoot, id)
    const destination = join(departedRoot, id)
    await rename(source, destination)
    moved += 1
    records.set(id, await legacyRecord(root, id, source, destination, now))
  }

  // Also index a departed directory created by a partially-applied/manual move.
  for (const id of await directoryNames(departedRoot)) {
    if (records.has(id)) continue
    records.set(id, await legacyRecord(root, id, join(activeRoot, id), join(departedRoot, id), now))
  }

  await mkdir(dirname(catalogPath), { recursive: true })
  const tmp = `${catalogPath}.tmp`
  await writeFile(tmp, JSON.stringify({ version: 1, workspaces: [...records.values()] }, null, 2), 'utf8')
  await rename(tmp, catalogPath)
  return {
    active: activeMetas.length,
    departed: [...records.values()].filter((record) => record.lifecycle === 'departed').length,
    moved,
    conflicts: 0,
  }
}

export const migration: Migration = {
  id: '0021_workspace_departure_catalog',
  appVersion: '0.75.0-beta',
  introducedAt: '2026-07-12',
  affects: ['workspaces/workspaces.json', 'workspaces/workspaces/*', 'workspaces/departed-workspaces/*', 'workspaces/state/workspace-catalog.json'],
  summary: 'Move unregistered Workspace directories into a durable departed catalog without deleting them.',
  rationale: 'The active Workspace root is a manager-visible office floor; departed desks must leave that namespace while retaining handoff and restore history.',
  up: async () => { await migrateWorkspaceDepartureCatalog() },
}
