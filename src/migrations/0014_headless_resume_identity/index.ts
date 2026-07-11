/**
 * 0014_headless_resume_identity — give every historical headless execution a
 * durable OpenAlice-owned resume identity.
 *
 * taskId identifies one execution. resumeId identifies the runtime
 * conversation that may span many executions. Historical v1 records were all
 * fresh one-shot runs, so each receives its own resumeId during the v2 upgrade.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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

export async function migrateHeadlessResumeIdentity(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ updated: boolean; assigned: number }> {
  const path = join(launcherRoot, 'state', 'headless-tasks.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { updated: false, assigned: 0 }
    return { updated: false, assigned: 0 }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['tasks'])) {
    return { updated: false, assigned: 0 }
  }

  let assigned = 0
  const tasks = parsed['tasks'].map((value) => {
    if (!isRecord(value) || typeof value['resumeId'] === 'string') return value
    assigned += 1
    return { ...value, resumeId: randomUUID() }
  })
  if (parsed['version'] === 2 && assigned === 0) return { updated: false, assigned: 0 }

  await writeAtomic(path, { ...parsed, version: 2, tasks })
  return { updated: true, assigned }
}

export const migration: Migration = {
  id: '0014_headless_resume_identity',
  appVersion: '0.75.0-beta',
  introducedAt: '2026-07-11',
  affects: ['workspaces/state/headless-tasks.json'],
  summary:
    'Assign durable resumeId values to historical headless runs so execution identity and resumable conversation identity remain distinct.',
  rationale:
    'Agents need to continue the runtime conversation behind an Inbox result without treating one automation task id as the conversation itself.',
  up: async () => {
    await migrateHeadlessResumeIdentity()
  },
}
