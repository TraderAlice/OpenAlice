import { existsSync } from 'node:fs'
import { cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import {
  LEGACY_PI_AGENT_DIR,
  migrateLegacyPiAgentDir,
} from '../../workspaces/adapters/pi-config.js'
import type { Migration } from '../types.js'

interface MigrationOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly backupRoot?: string
}

interface LegacyWorkspace {
  readonly kind: 'active' | 'departed'
  readonly name: string
  readonly dir: string
}

async function workspaceDirectories(
  root: string,
  kind: LegacyWorkspace['kind'],
): Promise<LegacyWorkspace[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ kind, name: entry.name, dir: join(root, entry.name) }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Reconcile every active and departed Workspace that still has the old
 * redirected `.pi-agent` home. Each source tree is copied before mutation;
 * individual malformed Pi stores are left in place and reported so one
 * optional runtime cannot prevent the rest of OpenAlice from starting.
 */
export async function migratePiNativeWorkspaceConfig(
  launcherRoot: string,
  options: MigrationOptions = {},
): Promise<{ found: number; migrated: number; failed: number }> {
  const workspaces = [
    ...await workspaceDirectories(join(launcherRoot, 'workspaces'), 'active'),
    ...await workspaceDirectories(join(launcherRoot, 'departed-workspaces'), 'departed'),
  ].filter((workspace) => existsSync(join(workspace.dir, LEGACY_PI_AGENT_DIR)))

  let migrated = 0
  let failed = 0
  for (const workspace of workspaces) {
    try {
      if (options.backupRoot) {
        const backup = join(options.backupRoot, workspace.kind, workspace.name, LEGACY_PI_AGENT_DIR)
        await mkdir(dirname(backup), { recursive: true })
        await cp(join(workspace.dir, LEGACY_PI_AGENT_DIR), backup, {
          recursive: true,
          errorOnExist: false,
        })
      }
      if (await migrateLegacyPiAgentDir(workspace.dir, options.env ?? process.env)) migrated += 1
    } catch (error) {
      failed += 1
      console.warn(
        `[migration] kept legacy Pi state for ${workspace.dir}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { found: workspaces.length, migrated, failed }
}

export const migration: Migration = {
  id: '0024_pi_native_workspace_config',
  appVersion: '0.82.0-beta',
  introducedAt: '2026-07-18',
  affects: [
    'workspaces/workspaces/*/.pi-agent',
    'workspaces/departed-workspaces/*/.pi-agent',
    'Pi user agent directory',
  ],
  summary: 'Move redirected Pi Workspace homes into Pi\'s native global-provider and project-settings layers.',
  rationale: 'Redirecting PI_CODING_AGENT_DIR hid the user\'s global Pi packages, settings, auth, resources, and sessions.',
  up: async (ctx) => {
    const userDataHome = resolve(ctx.configDir(), '..', '..')
    const launcherRoot = resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(userDataHome, 'workspaces'))
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = join(
      dirname(ctx.configDir()),
      '_backup',
      `${timestamp}-pre-0024_pi_native_workspace_config`,
      'workspace-pi-agent',
    )
    await migratePiNativeWorkspaceConfig(launcherRoot, {
      env: process.env,
      backupRoot,
    })
  },
}
