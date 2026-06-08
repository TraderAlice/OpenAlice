/**
 * 0008_disable_targetless_cron_jobs — disable pre-headless cron jobs that
 * have no target workspace.
 *
 * Cron jobs used to fire into the in-process AgentWork path (a prompt with no
 * workspace). That path is gone: a cron job now dispatches a headless run into
 * a chosen workspace (`workspaceId` + `agent`). A legacy job carries no
 * `workspaceId`, so on every fire the new listener would log a loud "no target
 * workspace" error and do nothing — the exact orphan-cron noise the 0004
 * incident warns about.
 *
 * This migration disables (does NOT delete) any enabled job lacking a
 * `workspaceId`, so it stops firing on upgrade. The job stays visible in the
 * Automation UI for the user to re-target (assign a workspace + agent) or
 * delete. Internal `__*__` jobs were already pruned by 0004.
 *
 * Idempotent: re-running finds no enabled-and-targetless jobs and leaves the
 * file byte-for-byte unchanged. No-op when the file doesn't exist.
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Migration } from '../types.js'
import { dataPath } from '@/core/paths.js'

const DEFAULT_JOBS_PATH = dataPath('cron', 'jobs.json')

interface RawJob {
  id?: string
  name?: string
  enabled?: boolean
  workspaceId?: unknown
  [k: string]: unknown
}

interface JobsFile {
  jobs: RawJob[]
}

function hasWorkspace(job: RawJob): boolean {
  return typeof job.workspaceId === 'string' && job.workspaceId.length > 0
}

/**
 * Disable enabled jobs with no target workspace, write back atomically.
 * Exported so the spec can drive it against a temp path. Returns the
 * names/ids of the jobs it disabled.
 */
export async function disableTargetlessCronJobs(
  jobsFilePath: string = DEFAULT_JOBS_PATH,
): Promise<{ disabled: string[] }> {
  let raw: string
  try {
    raw = await readFile(jobsFilePath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { disabled: [] }
    }
    throw err
  }

  const data = JSON.parse(raw) as JobsFile
  if (!Array.isArray(data.jobs)) return { disabled: [] }

  const disabled: string[] = []
  for (const job of data.jobs) {
    if (job?.enabled === true && !hasWorkspace(job)) {
      job.enabled = false
      disabled.push(job.name ?? job.id ?? '(unnamed)')
    }
  }

  if (disabled.length === 0) return { disabled: [] }

  await mkdir(dirname(jobsFilePath), { recursive: true })
  const tmp = `${jobsFilePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await rename(tmp, jobsFilePath)

  for (const name of disabled) {
    console.log(`[migration 0008] disabled targetless cron job ${name} — assign a workspace + agent to re-enable`)
  }

  return { disabled }
}

export const migration: Migration = {
  id: '0008_disable_targetless_cron_jobs',
  appVersion: '0.40.0-beta.3',
  introducedAt: '2026-06-08',
  affects: ['cron/jobs.json'],
  summary:
    'Disable enabled cron jobs that have no target workspace (legacy AgentWork-era jobs) so they stop firing into the retired path.',
  rationale:
    'Cron now dispatches headless Workspace runs (workspaceId + agent). Targetless jobs would error loudly on every fire; disable them so the user can re-target or delete.',
  up: async () => {
    await disableTargetlessCronJobs()
  },
}
