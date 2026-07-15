import { randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const DATA_HOME_PREFERENCES_VERSION = 1
const MAX_RECENT_HOMES = 8
const IGNORED_EMPTY_DIRECTORY_ENTRIES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const OPENALICE_HOME_ENTRIES = new Set([
  'provider-keys.json',
  'sealing.key',
])
const OPENALICE_HOME_MARKERS = [
  ['data', 'config'],
  ['workspaces', 'workspaces.json'],
  ['state', 'guardian.lock'],
  ['state', 'runtime.lock'],
  ['runtime', 'broker-packs'],
] as const

export type DataHomeContents = 'empty' | 'openalice-home' | 'nonempty'
export type DataHomeSource = 'default' | 'desktop-preference' | 'environment'
export type DataHomeSelectionLock = 'openalice-home-env' | 'workspace-root-env' | null

export interface DataHomePreferences {
  readonly version: 1
  readonly selectedHome: string | null
  readonly recentHomes: readonly string[]
  readonly askOnStartup: boolean
  readonly startupPromptCompleted: boolean
}

export interface PreparedDataHome {
  readonly path: string
  readonly contents: DataHomeContents
}

export class DataHomeUnavailableError extends Error {
  constructor(readonly path: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DataHomeUnavailableError'
  }
}

export class OverlappingDataHomesError extends Error {
  constructor(readonly currentHome: string, readonly requestedHome: string) {
    super('The new data location must not contain the current location or be inside it.')
    this.name = 'OverlappingDataHomesError'
  }
}

export function defaultDataHomePreferences(): DataHomePreferences {
  return {
    version: DATA_HOME_PREFERENCES_VERSION,
    selectedHome: null,
    recentHomes: [],
    askOnStartup: false,
    startupPromptCompleted: false,
  }
}

function normalizedPathKey(path: string, platform: NodeJS.Platform): string {
  const normalized = resolve(path)
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

export function dedupeRecentDataHomes(
  homes: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const home of homes) {
    if (typeof home !== 'string' || home.trim().length === 0 || !isAbsolute(home)) continue
    const normalized = resolve(home)
    const key = normalizedPathKey(normalized, platform)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
    if (result.length >= MAX_RECENT_HOMES) break
  }
  return result
}

export function parseDataHomePreferences(raw: unknown): DataHomePreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultDataHomePreferences()
  const value = raw as Record<string, unknown>
  const selectedHome = typeof value['selectedHome'] === 'string' && isAbsolute(value['selectedHome'])
    ? resolve(value['selectedHome'])
    : null
  const recentHomes = dedupeRecentDataHomes([
    ...(selectedHome ? [selectedHome] : []),
    ...(Array.isArray(value['recentHomes']) ? value['recentHomes'].filter((row): row is string => typeof row === 'string') : []),
  ])
  return {
    version: DATA_HOME_PREFERENCES_VERSION,
    selectedHome,
    recentHomes,
    askOnStartup: value['askOnStartup'] === true,
    startupPromptCompleted: value['startupPromptCompleted'] === true,
  }
}

export async function readDataHomePreferences(path: string): Promise<DataHomePreferences> {
  try {
    return parseDataHomePreferences(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as NodeJS.ErrnoException).code
      : undefined
    if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    return defaultDataHomePreferences()
  }
}

export async function writeDataHomePreferences(
  path: string,
  preferences: DataHomePreferences,
): Promise<void> {
  const normalized = parseDataHomePreferences(preferences)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export function rememberDataHome(
  preferences: DataHomePreferences,
  selectedHome: string,
  options: { readonly startupPromptCompleted?: boolean } = {},
): DataHomePreferences {
  const normalized = resolve(selectedHome)
  return {
    ...preferences,
    version: DATA_HOME_PREFERENCES_VERSION,
    selectedHome: normalized,
    recentHomes: dedupeRecentDataHomes([normalized, ...preferences.recentHomes]),
    startupPromptCompleted: options.startupPromptCompleted ?? preferences.startupPromptCompleted,
  }
}

export function setAskForDataHomeOnStartup(
  preferences: DataHomePreferences,
  askOnStartup: boolean,
): DataHomePreferences {
  return { ...preferences, askOnStartup }
}

export function resolveDataHomeSelectionLock(env: NodeJS.ProcessEnv): DataHomeSelectionLock {
  if (env['OPENALICE_HOME']?.trim()) return 'openalice-home-env'
  if (env['AQ_LAUNCHER_ROOT']?.trim()) return 'workspace-root-env'
  return null
}

export function shouldAskForDataHomeAtStartup(options: {
  readonly preferences: DataHomePreferences
  readonly selectionLock: DataHomeSelectionLock
  readonly legacyDataPresent: boolean
  readonly defaultHomeHasState: boolean
}): boolean {
  if (options.selectionLock !== null || options.legacyDataPresent) return false
  if (options.preferences.askOnStartup) return true
  return !options.preferences.startupPromptCompleted &&
    options.preferences.selectedHome === null &&
    !options.defaultHomeHasState
}

function classifyDataHomeEntries(path: string, entries: readonly string[]): DataHomeContents {
  const meaningful = entries.filter((entry) => !IGNORED_EMPTY_DIRECTORY_ENTRIES.has(entry))
  if (meaningful.length === 0) return 'empty'
  if (
    meaningful.some((entry) => OPENALICE_HOME_ENTRIES.has(entry)) ||
    OPENALICE_HOME_MARKERS.some((parts) => existsSync(resolve(path, ...parts)))
  ) return 'openalice-home'
  return 'nonempty'
}

export async function prepareDataHome(
  input: string,
  options: { readonly create?: boolean } = {},
): Promise<PreparedDataHome> {
  const requested = resolve(input)
  try {
    if (options.create === true) await mkdir(requested, { recursive: true, mode: 0o700 })
    const info = await stat(requested)
    if (!info.isDirectory()) {
      throw new DataHomeUnavailableError(requested, 'The selected data location is not a directory.')
    }
    await access(requested, constants.R_OK | constants.W_OK)
    const canonical = await realpath(requested)
    const entries = await readdir(canonical)
    const probe = resolve(canonical, `.openalice-write-probe-${process.pid}-${randomUUID()}`)
    try {
      await writeFile(probe, '', { flag: 'wx', mode: 0o600 })
    } finally {
      await rm(probe, { force: true }).catch(() => undefined)
    }
    return { path: canonical, contents: classifyDataHomeEntries(canonical, entries) }
  } catch (error) {
    if (error instanceof DataHomeUnavailableError) throw error
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as NodeJS.ErrnoException).code
      : undefined
    const detail = code === 'ENOENT'
      ? 'The selected data location no longer exists.'
      : 'The selected data location is unavailable or not writable.'
    throw new DataHomeUnavailableError(requested, detail, { cause: error })
  }
}

function pathContains(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

export function assertSeparateDataHomes(currentHome: string, requestedHome: string): void {
  const current = resolve(currentHome)
  const requested = resolve(requestedHome)
  if (current === requested) return
  if (pathContains(current, requested) || pathContains(requested, current)) {
    throw new OverlappingDataHomesError(current, requested)
  }
}

export function hasExistingOpenAliceHome(path: string): boolean {
  return [...OPENALICE_HOME_ENTRIES].some((entry) => existsSync(resolve(path, entry))) ||
    OPENALICE_HOME_MARKERS.some((parts) => existsSync(resolve(path, ...parts)))
}
