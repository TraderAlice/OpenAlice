import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import {
  cleanupGlobalPiWorkspaceProviders,
  localizePiWorkspaceProvider,
  PI_BINDING_STATE_PATH,
  PI_PROJECT_SETTINGS_PATH,
  PI_PROVIDER_PREFIX,
  piWorkspaceProviderId,
  resolvePiAgentDir,
} from '../../workspaces/adapters/pi-config.js'
import type { Migration } from '../types.js'

interface MigrationOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly backupRoot?: string
}

interface WorkspaceDirectory {
  readonly kind: 'active' | 'departed'
  readonly name: string
  readonly dir: string
}

interface BindingCandidate extends WorkspaceDirectory {
  readonly providerId: string
  readonly localized: boolean
}

async function workspaceDirectories(
  root: string,
  kind: WorkspaceDirectory['kind'],
): Promise<WorkspaceDirectory[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ kind, name: entry.name, dir: join(root, entry.name) }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function readJsonRecord(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function bindingCandidate(workspace: WorkspaceDirectory): Promise<BindingCandidate | null> {
  let state: Record<string, unknown> | null = null
  let settings: Record<string, unknown> | null = null
  let invalidLocalConfig = false
  try {
    state = await readJsonRecord(join(workspace.dir, PI_BINDING_STATE_PATH))
  } catch {
    invalidLocalConfig = true
  }
  try {
    settings = await readJsonRecord(join(workspace.dir, PI_PROJECT_SETTINGS_PATH))
  } catch {
    invalidLocalConfig = true
  }
  const stateProvider = typeof state?.['providerId'] === 'string' ? state['providerId'] : null
  const selectedProvider = typeof settings?.['defaultProvider'] === 'string'
    && settings['defaultProvider'].startsWith(PI_PROVIDER_PREFIX)
    ? settings['defaultProvider']
    : null
  const providerId = stateProvider ?? selectedProvider ?? (
    invalidLocalConfig && existsSync(join(workspace.dir, PI_BINDING_STATE_PATH))
      ? piWorkspaceProviderId(workspace.dir)
      : null
  )
  if (!providerId || (!invalidLocalConfig && selectedProvider !== providerId)) return null
  return {
    ...workspace,
    providerId,
    localized: state?.['version'] === 2,
  }
}

async function backupCandidate(candidate: BindingCandidate, backupRoot: string): Promise<void> {
  const source = join(candidate.dir, '.pi')
  if (!existsSync(source)) return
  const destination = join(backupRoot, candidate.kind, candidate.name, '.pi')
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: true, errorOnExist: false })
}

/** Localize every known Pi Workspace provider, then remove only stale global
 * OpenAlice nodes. Failed Workspace ids stay in the global registry so one bad
 * local file cannot break a still-usable legacy binding. */
export async function migratePiLocalWorkspaceProviders(
  launcherRoot: string,
  options: MigrationOptions = {},
): Promise<{ found: number; migrated: number; failed: number; removedGlobal: number }> {
  const env = options.env ?? process.env
  const workspaces = [
    ...await workspaceDirectories(join(launcherRoot, 'workspaces'), 'active'),
    ...await workspaceDirectories(join(launcherRoot, 'departed-workspaces'), 'departed'),
  ]
  const candidates = (await Promise.all(workspaces.map(bindingCandidate)))
    .filter((candidate): candidate is BindingCandidate => candidate !== null)

  if (options.backupRoot) {
    await Promise.all(candidates.map((candidate) => backupCandidate(candidate, options.backupRoot!)))
    const globalModels = join(resolvePiAgentDir(env), 'models.json')
    if (existsSync(globalModels)) {
      const destination = join(options.backupRoot, 'pi-agent', 'models.json')
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(globalModels, destination)
    }
  }

  let migrated = 0
  let failed = 0
  const keepProviderIds = new Set<string>()
  for (const candidate of candidates) {
    try {
      await localizePiWorkspaceProvider(candidate.dir, env)
      const state = await readJsonRecord(join(candidate.dir, PI_BINDING_STATE_PATH))
      if (state?.['version'] !== 2) {
        keepProviderIds.add(candidate.providerId)
        failed += 1
        continue
      }
      if (!candidate.localized) migrated += 1
    } catch (error) {
      keepProviderIds.add(candidate.providerId)
      failed += 1
      console.warn(
        `[migration] kept global Pi provider for ${candidate.dir}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  let removedGlobal = 0
  try {
    removedGlobal = await cleanupGlobalPiWorkspaceProviders(keepProviderIds, env)
  } catch (error) {
    console.warn(
      `[migration] kept malformed Pi global models.json: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return { found: candidates.length, migrated, failed, removedGlobal }
}

export const migration: Migration = {
  id: '0031_pi_local_workspace_provider',
  appVersion: '0.89.1-beta',
  introducedAt: '2026-08-04',
  affects: [
    'workspaces/workspaces/*/.pi',
    'workspaces/departed-workspaces/*/.pi',
    'Pi user agent directory/models.json',
  ],
  summary: 'Move OpenAlice-managed Pi providers from the global model registry into Workspace-local extensions.',
  rationale: 'Workspace-local registration prevents concurrent Workspace writes from polluting or tearing Pi\'s user model registry.',
  up: async (ctx) => {
    const userDataHome = resolve(ctx.configDir(), '..', '..')
    const launcherRoot = resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(userDataHome, 'workspaces'))
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = join(
      dirname(ctx.configDir()),
      '_backup',
      `${timestamp}-pre-0031_pi_local_workspace_provider`,
      'workspace-pi-provider',
    )
    await migratePiLocalWorkspaceProviders(launcherRoot, { env: process.env, backupRoot })
  },
}
