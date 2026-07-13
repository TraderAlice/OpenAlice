/** 0020_headless_issue_trigger — preserve the Issue's home Workspace separately
 * from the Workspace where a signed Session executes. */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { Migration } from '../types.js'

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

export async function migrateHeadlessIssueTrigger(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ updated: number }> {
  const path = join(launcherRoot, 'state', 'headless-tasks.json')
  let parsed: { version?: number; tasks?: Array<Record<string, unknown>> }
  try { parsed = JSON.parse(await readFile(path, 'utf8')) as typeof parsed }
  catch { return { updated: 0 } }
  if (!Array.isArray(parsed.tasks)) return { updated: 0 }
  let updated = 0
  for (const task of parsed.tasks) {
    const issueId = typeof task['issueId'] === 'string' ? task['issueId'] : null
    const wsId = typeof task['wsId'] === 'string' ? task['wsId'] : null
    if (issueId && wsId) {
      task['trigger'] = { kind: 'issue', workspaceId: wsId, issueId }
      delete task['issueId']
      updated++
    }
  }
  if (updated === 0 && parsed.version === 3) return { updated: 0 }
  parsed.version = 3
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(parsed, null, 2), 'utf8')
  await rename(tmp, path)
  return { updated }
}

export const migration: Migration = {
  id: '0020_headless_issue_trigger',
  appVersion: '0.80.0-beta',
  introducedAt: '2026-07-12',
  affects: ['workspaces/state/headless-tasks.json'],
  summary: 'Store the composite Issue trigger separately from a run execution Workspace.',
  rationale: 'An exact signed Session may execute a scheduled Issue across Workspace boundaries without breaking Activity attribution.',
  up: async () => { await migrateHeadlessIssueTrigger() },
}
