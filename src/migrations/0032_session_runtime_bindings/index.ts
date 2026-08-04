import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { Migration } from '../types.js'

interface MigrationOptions {
  readonly backupRoot?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function migrateSessionRuntimeBindings(
  launcherRoot = resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces')),
  options: MigrationOptions = {},
): Promise<{ updated: boolean }> {
  const path = join(launcherRoot, 'state', 'resume-identities.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { updated: false }
    return { updated: false }
  }
  if (!isRecord(parsed) || parsed['version'] !== 1 || !Array.isArray(parsed['records'])) {
    return { updated: false }
  }
  if (options.backupRoot) {
    await mkdir(options.backupRoot, { recursive: true })
    await copyFile(path, join(options.backupRoot, 'resume-identities.json'))
  }
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, `${JSON.stringify({ ...parsed, version: 2 }, null, 2)}\n`, { mode: 0o600 })
  await rename(temp, path)
  return { updated: true }
}

export const migration: Migration = {
  id: '0032_session_runtime_bindings',
  appVersion: '0.90.0-beta',
  introducedAt: '2026-08-05',
  affects: ['workspaces/state/resume-identities.json'],
  summary: 'Version product Session identities for durable runtime, credential-reference, model, and effort bindings.',
  rationale: 'Fresh and resumed TUI/headless launches must replay one immutable Session selection without persisting credential secrets.',
  up: async (ctx) => {
    const userDataHome = resolve(ctx.configDir(), '..', '..')
    const launcherRoot = resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(userDataHome, 'workspaces'))
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    await migrateSessionRuntimeBindings(launcherRoot, {
      backupRoot: join(
        dirname(ctx.configDir()),
        '_backup',
        `${timestamp}-pre-0032_session_runtime_bindings`,
        'resume-identities',
      ),
    })
  },
}
