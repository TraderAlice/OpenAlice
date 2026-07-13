/**
 * 0013_session_run_source — version SessionRegistry files for durable
 * headless-run provenance.
 *
 * v2 adds an optional `sourceRunId` to records materialized from headless runs.
 * Existing records cannot be backfilled reliably, so the migration only bumps
 * the containing file version and preserves every record byte-for-byte at the
 * JSON value level. New links are written when the user first opens a run.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { Migration } from '../types.js'

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

export async function migrateSessionRunSource(
  launcherRoot: string = defaultLauncherRoot(),
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
      parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown
    } catch {
      continue
    }
    if (!isRecord(parsed) || parsed['version'] !== 1 || !Array.isArray(parsed['records'])) continue
    await writeAtomic(path, { ...parsed, version: 2 })
    updated += 1
  }
  return { updated }
}

export const migration: Migration = {
  id: '0013_session_run_source',
  appVersion: '0.74.0-beta',
  introducedAt: '2026-07-11',
  affects: ['workspaces/state/sessions/*.json'],
  summary:
    'Version Session records for durable headless-run provenance and idempotent return-to-session navigation.',
  rationale:
    'Inbox and automation results need to reopen one stable conversation, not create a duplicate Session each time a run is inspected.',
  up: async () => {
    await migrateSessionRunSource()
  },
}
