import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { SessionRuntimeBinding } from '../../workspaces/cli-adapter.js'
import { MANAGER_WORKSPACE_ID } from '../../workspaces/manager-workspace.js'
import { parseSessionRuntimeBinding } from '../../workspaces/session-runtime-binding.js'
import type { Migration } from '../types.js'

interface LegacyResumeRecord extends Record<string, unknown> {
  resumeId: string
  wsId: string
  agent: string
  runtimeBinding?: SessionRuntimeBinding
}

interface LegacyResumeRegistry {
  version: 2
  records: LegacyResumeRecord[]
}

interface WorkspaceLocation {
  readonly writeDir: string
}

const RESUME_REGISTRY_REL = join('state', 'resume-identities.json')

function assertedFileName(resumeId: string): string {
  if (!resumeId || resumeId === '.' || resumeId === '..' || /[\\/\0]/u.test(resumeId)) {
    throw new Error(`invalid Session resumeId for Workspace storage: ${resumeId}`)
  }
  return `${resumeId}.json`
}

function parseLegacyRegistry(value: unknown): LegacyResumeRegistry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('resume-identities.json has an unsupported shape')
  }
  const root = value as Record<string, unknown>
  if (root['version'] === 1 && Array.isArray(root['records'])) return null
  if (root['version'] !== 2 || !Array.isArray(root['records'])) {
    throw new Error('resume-identities.json has an unsupported shape')
  }

  const records = root['records'].map((value): LegacyResumeRecord => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('resume-identities.json contains an invalid record')
    }
    const record = value as Record<string, unknown>
    if (
      typeof record['resumeId'] !== 'string'
      || typeof record['wsId'] !== 'string'
      || typeof record['agent'] !== 'string'
      || typeof record['createdAt'] !== 'number'
      || typeof record['updatedAt'] !== 'number'
    ) {
      throw new Error('resume-identities.json contains an invalid record')
    }
    const runtimeBinding = parseSessionRuntimeBinding(record['runtimeBinding'])
    if (record['runtimeBinding'] !== undefined && !runtimeBinding) {
      throw new Error('resume-identities.json contains an invalid Session runtime binding')
    }
    return {
      ...record,
      resumeId: record['resumeId'],
      wsId: record['wsId'],
      agent: record['agent'],
      ...(runtimeBinding ? { runtimeBinding } : {}),
    }
  })

  return { version: 2, records }
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function workspaceLocations(launcherRoot: string): Promise<Map<string, WorkspaceLocation>> {
  const locations = new Map<string, WorkspaceLocation>()
  const catalog = await readOptionalJson(join(launcherRoot, 'state', 'workspace-catalog.json'))
  if (catalog && typeof catalog === 'object' && !Array.isArray(catalog)) {
    const rows = (catalog as Record<string, unknown>)['workspaces']
    if (Array.isArray(rows)) {
      for (const value of rows) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const row = value as Record<string, unknown>
        if (typeof row['id'] !== 'string') continue
        const writeDir = typeof row['departedDir'] === 'string'
          ? row['departedDir']
          : typeof row['activeDir'] === 'string' ? row['activeDir'] : null
        if (writeDir) locations.set(row['id'], { writeDir })
      }
    }
  }

  // The active registry is authoritative when a Workspace has been restored:
  // write to its live checkout instead of a historical Catalog fallback.
  const active = await readOptionalJson(join(launcherRoot, 'workspaces.json'))
  if (active && typeof active === 'object' && !Array.isArray(active)) {
    const rows = (active as Record<string, unknown>)['workspaces']
    if (Array.isArray(rows)) {
      for (const value of rows) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const row = value as Record<string, unknown>
        if (typeof row['id'] !== 'string' || typeof row['dir'] !== 'string') continue
        locations.set(row['id'], { writeDir: row['dir'] })
      }
    }
  }
  return locations
}

function sessionPath(
  launcherRoot: string,
  locations: ReadonlyMap<string, WorkspaceLocation>,
  record: LegacyResumeRecord,
): string {
  const fileName = assertedFileName(record.resumeId)
  if (record.wsId === MANAGER_WORKSPACE_ID) {
    return join(launcherRoot, 'state', 'workspace-manager-sessions', fileName)
  }
  const location = locations.get(record.wsId)
  if (!location) {
    throw new Error(`cannot locate Workspace ${record.wsId} for Session ${record.resumeId}`)
  }
  return join(location.writeDir, '.alice', 'sessions', fileName)
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function ensureSessionFile(path: string, record: LegacyResumeRecord): Promise<void> {
  if (!record.runtimeBinding) return
  const target = {
    version: 1,
    resumeId: record.resumeId,
    agent: record.agent,
    ai: record.runtimeBinding,
  }
  const existing = await readOptionalJson(path)
  if (existing !== undefined) {
    if (JSON.stringify(existing) !== JSON.stringify(target)) {
      throw new Error(`Session ${record.resumeId} already owns a different Workspace AI config`)
    }
    return
  }
  await atomicWrite(path, target)
}

export async function migrateWorkspaceSessionRuntimeBindings(
  launcherRoot: string,
  options: { readonly backupRoot?: string } = {},
): Promise<{ migrated: boolean; sessions: number }> {
  const registryPath = join(launcherRoot, RESUME_REGISTRY_REL)
  const raw = await readOptionalJson(registryPath)
  if (raw === undefined) return { migrated: false, sessions: 0 }
  const legacy = parseLegacyRegistry(raw)
  if (!legacy) return { migrated: false, sessions: 0 }

  if (options.backupRoot) {
    const backup = join(options.backupRoot, RESUME_REGISTRY_REL)
    await mkdir(dirname(backup), { recursive: true })
    await copyFile(registryPath, backup)
  }

  const locations = await workspaceLocations(launcherRoot)
  let sessions = 0
  for (const record of legacy.records) {
    if (!record.runtimeBinding) continue
    await ensureSessionFile(sessionPath(launcherRoot, locations, record), record)
    sessions += 1
  }

  const records = legacy.records.map(({ runtimeBinding: _runtimeBinding, ...record }) => record)
  await atomicWrite(registryPath, { version: 1, records })
  return { migrated: true, sessions }
}

export const migration: Migration = {
  id: '0039_workspace_session_runtime_bindings',
  appVersion: '0.89.3-beta',
  introducedAt: '2026-08-11',
  affects: [
    'workspaces/state/resume-identities.json',
    'workspaces/state/workspace-manager-sessions/*.json',
    'workspaces/workspaces/*/.alice/sessions/*.json',
    'workspaces/departed-workspaces/*/.alice/sessions/*.json',
  ],
  summary: 'Move 0.89.2 Session AI bindings from the launcher identity registry into their owning Workspaces.',
  rationale: 'Session launch semantics travel with the Workspace while the launcher registry remains a secret-free identity map.',
  up: async (ctx) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = join(
      dirname(ctx.configDir()),
      '_backup',
      `${timestamp}-pre-0039_workspace_session_runtime_bindings`,
    )
    await migrateWorkspaceSessionRuntimeBindings(ctx.launcherRoot(), { backupRoot })
  },
}
