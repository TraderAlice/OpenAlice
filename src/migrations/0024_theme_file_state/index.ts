import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Migration } from '../types.js'

const DEFAULT_APPEARANCE = {
  activeFamilyId: 'builtin-openalice',
  mode: 'system',
  terminal: { mode: 'follow' },
  marketColors: 'protected',
  marketDirection: 'green-up-red-down',
  statusColors: 'protected',
} as const

export async function migrateThemeFileState(dataDirectory: string): Promise<boolean> {
  const preferencesPath = join(dataDirectory, 'preferences.json')
  const raw = await readJson(preferencesPath)
  if (raw === null || (raw !== undefined && !isRecord(raw))) {
    throw new Error('Cannot add theme selection to malformed data/preferences.json')
  }

  await mkdir(join(dataDirectory, 'themes'), { recursive: true })
  const preferences = raw ?? {}
  if (isRecord(preferences['appearance'])) return false
  await writeAtomic(preferencesPath, {
    ...preferences,
    version: 1,
    appearance: DEFAULT_APPEARANCE,
  })
  return true
}

export const migration: Migration = {
  id: '0024_theme_file_state',
  appVersion: '0.83.0-beta',
  introducedAt: '2026-07-18',
  affects: ['data/preferences.json', 'data/themes/*.json'],
  summary: 'Create file-backed theme families and seed the built-in active theme selection.',
  rationale: 'Theme families must survive reload and packaging without making browser localStorage the source of truth.',
  up: async (ctx) => {
    await migrateThemeFileState(join(ctx.configDir(), '..'))
  },
}

async function readJson(path: string): Promise<unknown | undefined | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return null
  }
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
