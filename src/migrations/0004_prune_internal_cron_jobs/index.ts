/**
 * 0004_prune_internal_cron_jobs — remove orphan `__*__` entries from
 * `data/cron/jobs.json` left over from before heartbeat/snapshot moved
 * to Pump.
 *
 * Pre-Pump-refactor, heartbeat and snapshot schedules lived as
 * internal cron jobs named `__heartbeat__` and `__snapshot__`. Commit
 * `6311661` migrated them to private Pumps and added an in-line
 * cleanup loop in `src/main.ts`, but the loop ran before
 * `cronEngine.start()` loaded the jobs from disk — silently a no-op
 * for weeks while `__snapshot__` kept firing every 15 min and burning
 * AI calls on an empty payload.
 *
 * This migration is the correct home for the cleanup: the framework
 * runs it on boot before any subsystem starts, records it in
 * `data/config/_meta.json`, and snapshots `data/config/` to
 * `data/_backup/`. The cron jobs file itself isn't snapshotted (it's
 * outside `data/config/`); the body is fully recoverable from
 * read-modify-write semantics and only removes entries matching the
 * internal namespace pattern.
 *
 * Idempotent: re-running on a freshly-pruned file leaves it byte-for-
 * byte unchanged. No-op when the file doesn't exist (fresh install).
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Migration } from '../types.js'
import { dataPath } from '@/core/paths.js'

const DEFAULT_JOBS_PATH = dataPath('cron', 'jobs.json')

interface RawJob {
  name: string
  [k: string]: unknown
}

interface JobsFile {
  jobs: RawJob[]
}

function isInternalJobName(name: string): boolean {
  return name.startsWith('__') && name.endsWith('__')
}

/**
 * Read jobs file, drop `__*__` entries, write back atomically.
 * Exported as a free function so the spec can test against a temp
 * path without `chdir`. `migration.up` below calls it with the
 * canonical `data/cron/jobs.json`.
 */
export async function pruneInternalCronJobs(
  jobsFilePath: string = DEFAULT_JOBS_PATH,
): Promise<{ removed: string[] }> {
  let raw: string
  try {
    raw = await readFile(jobsFilePath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { removed: [] }
    }
    throw err
  }

  const data = JSON.parse(raw) as JobsFile
  if (!Array.isArray(data.jobs)) return { removed: [] }

  const removed: string[] = []
  const kept: RawJob[] = []
  for (const job of data.jobs) {
    if (typeof job?.name === 'string' && isInternalJobName(job.name)) {
      removed.push(job.name)
    } else {
      kept.push(job)
    }
  }

  if (removed.length === 0) return { removed: [] }

  const next: JobsFile = { jobs: kept }
  await mkdir(dirname(jobsFilePath), { recursive: true })
  const tmp = `${jobsFilePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
  await rename(tmp, jobsFilePath)

  for (const name of removed) {
    console.log(`[migration 0004] removed orphan cron job ${name}`)
  }

  return { removed }
}

export const migration: Migration = {
  id: '0004_prune_internal_cron_jobs',
  appVersion: '0.10.0-beta.3',
  introducedAt: '2026-05-12',
  affects: ['cron/jobs.json'],
  summary:
    'Prune orphan __heartbeat__ / __snapshot__ entries from data/cron/jobs.json (Pump refactor leftover)',
  rationale:
    'Replaces the broken in-line cleanup loop in src/main.ts that ran before cronEngine.start() loaded from disk and was therefore a no-op.',
  up: async () => {
    await pruneInternalCronJobs()
  },
}
