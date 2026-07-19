/**
 * Reversible ownership for the small JSON nodes OpenAlice injects into native
 * runtime config files. The surrounding file belongs to the runtime/user.
 *
 * On first write we snapshot each owned path. Later writes keep that original
 * snapshot while updating the injected value. Reset restores a path only when
 * its current value still equals OpenAlice's last injection; user edits made
 * after injection win. Unknown sibling keys are never touched.
 */

import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { readWorkspaceFile, writeWorkspaceFile } from '../file-service.js'

export interface OwnedJsonEntry {
  readonly path: readonly string[]
  readonly present: boolean
  readonly value?: unknown
}

interface SavedJsonValue {
  readonly present: boolean
  readonly value?: unknown
}

interface OwnedJsonStateEntry {
  readonly path: string[]
  readonly previous: SavedJsonValue
  readonly injected: SavedJsonValue
}

interface OwnedJsonState {
  readonly version: 1
  readonly entries: OwnedJsonStateEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pathId(path: readonly string[]): string {
  return JSON.stringify(path)
}

function isSafeOwnedPath(path: readonly string[]): boolean {
  return path.length > 0 && path.every((segment) => (
    segment.length > 0 &&
    segment !== '__proto__' &&
    segment !== 'prototype' &&
    segment !== 'constructor'
  ))
}

function snapshot(root: Readonly<Record<string, unknown>>, path: readonly string[]): SavedJsonValue {
  let current: unknown = root
  for (const segment of path.slice(0, -1)) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return { present: false }
    current = current[segment]
  }
  const key = path.at(-1)
  if (!key || !isRecord(current) || !Object.prototype.hasOwnProperty.call(current, key)) return { present: false }
  return { present: true, value: current[key] }
}

function apply(root: Record<string, unknown>, path: readonly string[], saved: SavedJsonValue): void {
  if (path.length === 0) return
  let current = root
  for (const segment of path.slice(0, -1)) {
    const child = current[segment]
    if (isRecord(child)) current = child
    else {
      const created: Record<string, unknown> = {}
      current[segment] = created
      current = created
    }
  }
  const key = path.at(-1)!
  if (saved.present) current[key] = saved.value
  else delete current[key]
  pruneEmptyParents(root, path.slice(0, -1))
}

function pruneEmptyParents(root: Record<string, unknown>, parentPath: readonly string[]): void {
  for (let length = parentPath.length; length > 0; length -= 1) {
    const path = parentPath.slice(0, length)
    const parent = valueAt(root, path.slice(0, -1))
    const key = path.at(-1)!
    if (!isRecord(parent) || !isRecord(parent[key]) || Object.keys(parent[key]).length > 0) return
    delete parent[key]
  }
}

function valueAt(root: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = root
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

function sameValue(left: SavedJsonValue, right: SavedJsonValue): boolean {
  if (left.present !== right.present) return false
  if (!left.present) return true
  return JSON.stringify(left.value) === JSON.stringify(right.value)
}

interface LoadedJsonObject {
  readonly value: Record<string, unknown>
  readonly exists: boolean
}

async function readJsonObject(cwd: string, path: string, label: string): Promise<LoadedJsonObject> {
  const raw = await readWorkspaceFile(cwd, path)
  if (raw === null) return { value: {}, exists: false }
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`${label} is not valid JSON: ${join(cwd, path)}`)
  }
  if (!isRecord(value)) throw new Error(`${label} must contain a JSON object: ${join(cwd, path)}`)
  return { value, exists: true }
}

async function readState(cwd: string, statePath: string): Promise<OwnedJsonState | null> {
  const raw = await readWorkspaceFile(cwd, statePath)
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`OpenAlice JSON ownership state is not valid JSON: ${join(cwd, statePath)}`)
  }
  if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['entries'])) {
    throw new Error(`Unsupported OpenAlice JSON ownership state: ${join(cwd, statePath)}`)
  }
  const entries: OwnedJsonStateEntry[] = []
  for (const rawEntry of value['entries']) {
    if (
      !isRecord(rawEntry) ||
      !Array.isArray(rawEntry['path']) ||
      !rawEntry['path'].every((part) => typeof part === 'string') ||
      !isSafeOwnedPath(rawEntry['path'] as string[]) ||
      !isRecord(rawEntry['previous']) ||
      !isRecord(rawEntry['injected']) ||
      typeof rawEntry['previous']['present'] !== 'boolean' ||
      typeof rawEntry['injected']['present'] !== 'boolean'
    ) {
      throw new Error(`Unsupported OpenAlice JSON ownership state: ${join(cwd, statePath)}`)
    }
    entries.push(rawEntry as unknown as OwnedJsonStateEntry)
  }
  return { version: 1, entries }
}

export async function writeOwnedJsonConfig(opts: {
  readonly cwd: string
  readonly configPath: string
  readonly statePath: string
  readonly label: string
  readonly entries: readonly OwnedJsonEntry[]
}): Promise<void> {
  const { value: config } = await readJsonObject(opts.cwd, opts.configPath, opts.label)
  const state = await readState(opts.cwd, opts.statePath)
  const priorByPath = new Map(state?.entries.map((entry) => [pathId(entry.path), entry]) ?? [])
  const nextEntries: OwnedJsonStateEntry[] = []

  for (const desired of opts.entries) {
    if (!isSafeOwnedPath(desired.path)) {
      throw new Error(`Invalid OpenAlice JSON ownership path: ${pathId(desired.path)}`)
    }
    const existing = priorByPath.get(pathId(desired.path))
    const previous = existing?.previous ?? snapshot(config, desired.path)
    const injected: SavedJsonValue = desired.present
      ? { present: true, value: desired.value }
      : { present: false }
    apply(config, desired.path, injected)
    nextEntries.push({ path: [...desired.path], previous, injected })
  }

  await writeWorkspaceFile(opts.cwd, opts.configPath, `${JSON.stringify(config, null, 2)}\n`)
  await writeWorkspaceFile(opts.cwd, opts.statePath, `${JSON.stringify({
    version: 1,
    entries: nextEntries,
  } satisfies OwnedJsonState, null, 2)}\n`)
}

export async function resetOwnedJsonConfig(opts: {
  readonly cwd: string
  readonly configPath: string
  readonly statePath: string
  readonly label: string
  /** Paths owned by pre-state OpenAlice versions; removed when no state exists. */
  readonly legacyOwnedPaths?: readonly (readonly string[])[]
}): Promise<void> {
  const { value: config, exists: configExists } = await readJsonObject(
    opts.cwd,
    opts.configPath,
    opts.label,
  )
  const state = await readState(opts.cwd, opts.statePath)

  // Deleting the native config after injection is an unambiguous user edit.
  // Retire our rollback state without recreating any prior or injected values.
  if (state && !configExists) {
    await rm(join(opts.cwd, opts.statePath), { force: true })
    return
  }

  if (state) {
    for (const entry of state.entries) {
      if (sameValue(snapshot(config, entry.path), entry.injected)) {
        apply(config, entry.path, entry.previous)
      }
    }
  } else {
    for (const path of opts.legacyOwnedPaths ?? []) apply(config, path, { present: false })
  }

  if (Object.keys(config).length === 0) await rm(join(opts.cwd, opts.configPath), { force: true })
  else await writeWorkspaceFile(opts.cwd, opts.configPath, `${JSON.stringify(config, null, 2)}\n`)
  await rm(join(opts.cwd, opts.statePath), { force: true })
}
