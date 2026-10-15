import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import type { Migration } from '../types.js'

/** Frozen historical boundary: preserve facts, never manufacture an external route. */
export async function migrateDispatchCommunication(launcherRoot: string): Promise<void> {
  const path = join(launcherRoot, 'state', 'headless-tasks.json')
  let source: string
  try { source = await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const data = JSON.parse(source)
  if (!data || !Array.isArray(data.tasks)) throw new Error('Invalid headless task registry')
  let changed = false
  for (const task of data.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('Invalid headless task')
    if (task.communication !== undefined) continue
    if (![task.wsId, task.resumeId, task.agent].every(value => typeof value === 'string' && value.length > 0)) {
      throw new Error('Headless task lacks its execution identity')
    }
    task.communication = { version: 1, origin: { kind: 'unknown' },
      target: { workspaceId: task.wsId, resumeId: task.resumeId, agent: task.agent }, reply: { kind: 'none' } }
    changed = true
  }
  if (!changed) return
  try { await copyFile(path, `${path}.pre-0044.bak`, constants.COPYFILE_EXCL) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(data, null, 2))
  await rename(temporary, path)
}

export const migration: Migration = {
  id: '0044_dispatch_communication', appVersion: '0.93.1-beta', introducedAt: '2026-09-18',
  affects: ['state/headless-tasks.json'],
  summary: 'Mark historical headless communication as unknown without inferring outbound delivery; preserve original records and a backup.',
  up: async ctx => migrateDispatchCommunication(ctx.launcherRoot()),
}
