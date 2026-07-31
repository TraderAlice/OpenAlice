/**
 * 0029_session_native_titles — separate native Session titles from the
 * launch-time prompt used as a display fallback.
 */

import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { Migration } from '../types.js'

interface MigrationOptions {
  readonly backupRoot?: string
}

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temp, path)
}

export async function migrateSessionNativeTitles(
  launcherRoot: string = defaultLauncherRoot(),
  options: MigrationOptions = {},
): Promise<{ updated: number }> {
  const sessionsDir = join(launcherRoot, 'state', 'sessions')
  let names: string[]
  try {
    names = await readdir(sessionsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { updated: 0 }
    throw error
  }

  let updated = 0
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) continue
    const path = join(sessionsDir, name)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch {
      continue
    }
    if (
      !isRecord(parsed)
      || (parsed['version'] !== 1 && parsed['version'] !== 2)
      || !Array.isArray(parsed['records'])
    ) continue

    const records = parsed['records'].map((value) => {
      if (!isRecord(value) || typeof value['title'] !== 'string') return value
      const next = { ...value }
      if (typeof next['fallbackTitle'] !== 'string') next['fallbackTitle'] = next['title']
      delete next['title']
      return next
    })
    if (options.backupRoot) {
      await mkdir(options.backupRoot, { recursive: true })
      await cp(path, join(options.backupRoot, name), { errorOnExist: false })
    }
    await writeAtomic(path, { ...parsed, version: 3, records })
    updated += 1
  }
  return { updated }
}

export const migration: Migration = {
  id: '0029_session_native_titles',
  appVersion: '0.87.0-beta',
  introducedAt: '2026-07-30',
  affects: ['workspaces/state/sessions/*.json'],
  summary: 'Treat the first Session message as a fallback and reserve the preferred title for native runtime metadata.',
  rationale:
    'Claude, Codex, OpenCode, and Pi can already name Sessions; OpenAlice should preserve those titles instead of permanently shadowing them with the launch prompt.',
  up: async (ctx) => {
    const userDataHome = resolve(ctx.configDir(), '..', '..')
    const launcherRoot = resolve(
      process.env['AQ_LAUNCHER_ROOT'] ?? join(userDataHome, 'workspaces'),
    )
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    await migrateSessionNativeTitles(launcherRoot, {
      backupRoot: join(
        dirname(ctx.configDir()),
        '_backup',
        `${timestamp}-pre-0029_session_native_titles`,
        'workspace-sessions',
      ),
    })
  },
}
