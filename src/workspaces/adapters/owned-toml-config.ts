/**
 * Reversible ownership for top-level scalar assignments OpenAlice injects into
 * a native TOML config. Unknown assignments, sections, comments, and spacing
 * remain byte-for-byte untouched.
 *
 * This deliberately supports only top-level keys. Provider tables belong in an
 * isolated runtime home and must not be projected into a shared project file.
 */

import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { readWorkspaceFile, writeWorkspaceFile } from '../file-service.js'

interface SavedTomlLine {
  readonly present: boolean
  readonly line?: string
}

interface OwnedTomlStateEntry {
  readonly key: string
  readonly previous: SavedTomlLine
  readonly injected: SavedTomlLine
}

interface OwnedTomlState {
  readonly version: 1
  readonly entries: OwnedTomlStateEntry[]
}

export interface OwnedTomlEntry {
  readonly key: string
  readonly value?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)
}

function assignmentPattern(key: string): RegExp {
  return new RegExp(`^\\s*${key.replaceAll('-', '\\-')}\\s*=`)
}

function sectionIndex(lines: readonly string[]): number {
  const found = lines.findIndex((line) => /^\s*\[/.test(line))
  return found === -1 ? lines.length : found
}

function findTopLevelLine(lines: readonly string[], key: string): number {
  const end = sectionIndex(lines)
  const pattern = assignmentPattern(key)
  const matches: number[] = []
  for (let index = 0; index < end; index += 1) {
    if (pattern.test(lines[index] ?? '')) matches.push(index)
  }
  if (matches.length > 1) throw new Error(`TOML config contains duplicate top-level ${key} assignments`)
  return matches[0] ?? -1
}

function snapshot(lines: readonly string[], key: string): SavedTomlLine {
  const index = findTopLevelLine(lines, key)
  return index === -1 ? { present: false } : { present: true, line: lines[index] }
}

function apply(lines: string[], key: string, saved: SavedTomlLine): void {
  const index = findTopLevelLine(lines, key)
  if (!saved.present) {
    if (index !== -1) lines.splice(index, 1)
    return
  }
  if (index !== -1) {
    lines[index] = saved.line ?? ''
    return
  }
  lines.splice(sectionIndex(lines), 0, saved.line ?? '')
}

function sameLine(left: SavedTomlLine, right: SavedTomlLine): boolean {
  return left.present === right.present && (!left.present || left.line === right.line)
}

function splitToml(raw: string | null): string[] {
  if (raw === null || raw.length === 0) return []
  const lines = raw.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

async function readState(cwd: string, statePath: string): Promise<OwnedTomlState | null> {
  const raw = await readWorkspaceFile(cwd, statePath)
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`OpenAlice TOML ownership state is not valid JSON: ${join(cwd, statePath)}`)
  }
  if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['entries'])) {
    throw new Error(`Unsupported OpenAlice TOML ownership state: ${join(cwd, statePath)}`)
  }
  const entries: OwnedTomlStateEntry[] = []
  for (const entry of value['entries']) {
    if (
      !isRecord(entry) ||
      typeof entry['key'] !== 'string' ||
      !isSafeKey(entry['key']) ||
      !isRecord(entry['previous']) ||
      !isRecord(entry['injected']) ||
      typeof entry['previous']['present'] !== 'boolean' ||
      typeof entry['injected']['present'] !== 'boolean' ||
      (entry['previous']['present'] === true && typeof entry['previous']['line'] !== 'string') ||
      (entry['injected']['present'] === true && typeof entry['injected']['line'] !== 'string')
    ) {
      throw new Error(`Unsupported OpenAlice TOML ownership state: ${join(cwd, statePath)}`)
    }
    entries.push(entry as unknown as OwnedTomlStateEntry)
  }
  return { version: 1, entries }
}

async function writeLines(cwd: string, configPath: string, lines: readonly string[]): Promise<void> {
  if (lines.every((line) => line.trim().length === 0)) {
    await rm(join(cwd, configPath), { force: true })
    return
  }
  await writeWorkspaceFile(cwd, configPath, `${lines.join('\n')}\n`)
}

export async function writeOwnedTomlConfig(opts: {
  readonly cwd: string
  readonly configPath: string
  readonly statePath: string
  readonly entries: readonly OwnedTomlEntry[]
  /** Keys written by an older OpenAlice release before ownership state existed. */
  readonly legacyOwnedKeys?: readonly string[]
}): Promise<void> {
  const raw = await readWorkspaceFile(opts.cwd, opts.configPath)
  const lines = splitToml(raw)
  const state = await readState(opts.cwd, opts.statePath)
  const priorByKey = new Map(state?.entries.map((entry) => [entry.key, entry]) ?? [])
  const legacyOwned = new Set(state ? [] : opts.legacyOwnedKeys ?? [])
  const nextEntries: OwnedTomlStateEntry[] = []

  for (const desired of opts.entries) {
    if (!isSafeKey(desired.key)) throw new Error(`Invalid OpenAlice TOML ownership key: ${desired.key}`)
    const previous = priorByKey.get(desired.key)?.previous
      ?? (legacyOwned.has(desired.key) ? { present: false } : snapshot(lines, desired.key))
    const injected: SavedTomlLine = desired.value
      ? { present: true, line: `${desired.key} = ${desired.value}` }
      : { present: false }
    apply(lines, desired.key, injected)
    nextEntries.push({ key: desired.key, previous, injected })
  }

  await writeLines(opts.cwd, opts.configPath, lines)
  await writeWorkspaceFile(opts.cwd, opts.statePath, `${JSON.stringify({
    version: 1,
    entries: nextEntries,
  } satisfies OwnedTomlState, null, 2)}\n`)
}

export async function resetOwnedTomlConfig(opts: {
  readonly cwd: string
  readonly configPath: string
  readonly statePath: string
  /** Keys written by an older OpenAlice release before ownership state existed. */
  readonly legacyOwnedKeys?: readonly string[]
}): Promise<void> {
  const raw = await readWorkspaceFile(opts.cwd, opts.configPath)
  const state = await readState(opts.cwd, opts.statePath)

  if (state && raw === null) {
    await rm(join(opts.cwd, opts.statePath), { force: true })
    return
  }

  const lines = splitToml(raw)
  if (state) {
    for (const entry of state.entries) {
      if (sameLine(snapshot(lines, entry.key), entry.injected)) {
        apply(lines, entry.key, entry.previous)
      }
    }
  } else {
    for (const key of opts.legacyOwnedKeys ?? []) apply(lines, key, { present: false })
  }
  await writeLines(opts.cwd, opts.configPath, lines)
  await rm(join(opts.cwd, opts.statePath), { force: true })
}
