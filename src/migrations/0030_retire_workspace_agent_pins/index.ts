/**
 * 0030_retire_workspace_agent_pins — remove the retired per-Workspace adapter
 * allowlist from active and lifecycle registry records.
 */

import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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

export function stripWorkspaceAgentPins(raw: unknown): {
  value: unknown
  updated: number
} {
  if (!isRecord(raw) || !Array.isArray(raw['workspaces'])) {
    return { value: raw, updated: 0 }
  }
  let updated = 0
  const workspaces = raw['workspaces'].map((value) => {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'agents')) return value
    const next = { ...value }
    delete next['agents']
    updated += 1
    return next
  })
  return {
    value: updated > 0 ? { ...raw, workspaces } : raw,
    updated,
  }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temp, path)
}

async function migrateFile(
  path: string,
  backupPath?: string,
): Promise<number> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  const migrated = stripWorkspaceAgentPins(raw)
  if (migrated.updated === 0) return 0
  if (backupPath) {
    await mkdir(dirname(backupPath), { recursive: true })
    await cp(path, backupPath, { errorOnExist: false })
  }
  await writeAtomicJson(path, migrated.value)
  return migrated.updated
}

export async function migrateWorkspaceAgentPins(
  launcherRoot: string = defaultLauncherRoot(),
  options: MigrationOptions = {},
): Promise<{ registryUpdated: number; catalogUpdated: number }> {
  const registryPath = join(launcherRoot, 'workspaces.json')
  const catalogPath = join(launcherRoot, 'state', 'workspace-catalog.json')
  const registryUpdated = await migrateFile(
    registryPath,
    options.backupRoot ? join(options.backupRoot, 'workspaces.json') : undefined,
  )
  const catalogUpdated = await migrateFile(
    catalogPath,
    options.backupRoot ? join(options.backupRoot, 'state', 'workspace-catalog.json') : undefined,
  )
  return { registryUpdated, catalogUpdated }
}

export const migration: Migration = {
  id: '0030_retire_workspace_agent_pins',
  appVersion: '0.87.0-beta',
  introducedAt: '2026-07-31',
  affects: [
    'workspaces/workspaces.json',
    'workspaces/state/workspace-catalog.json',
  ],
  summary:
    'Remove per-Workspace adapter allowlists so runtime availability follows the live installation registry.',
  rationale:
    'Workspace creation time is not a durable capability boundary. New adapters and future installation-level defaults must not be hidden by historical Workspace metadata.',
  up: async (ctx) => {
    const userDataHome = resolve(ctx.configDir(), '..', '..')
    const launcherRoot = resolve(
      process.env['AQ_LAUNCHER_ROOT'] ?? join(userDataHome, 'workspaces'),
    )
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    await migrateWorkspaceAgentPins(launcherRoot, {
      backupRoot: join(
        dirname(ctx.configDir()),
        '_backup',
        `${timestamp}-pre-0030_retire_workspace_agent_pins`,
        'workspace-registry',
      ),
    })
  },
}
