import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

export const ALICE_PROJECT_ID_PREFIX = 'alice-project-'

export interface AliceProjectIdentity {
  /** Stable identity for the complete-home boundary, not a Guardian run id. */
  id: string
  /** Machine-local selector used by the Supervisor and CLI. */
  key: string
  /** Human-facing label. It may change without changing the project id. */
  displayName: string
  /** Canonical complete OPENALICE_HOME owned by this project. */
  home: string
  /** Optional source or installed application root used to launch it. */
  appRoot: string | null
}

export interface ResolveAliceProjectIdentityOptions {
  home: string
  appRoot?: string | null
  env?: NodeJS.ProcessEnv
  key?: string
  displayName?: string
}

/**
 * Resolve the top-level OpenAlice runtime identity.
 *
 * Supervisor-launched projects carry explicit metadata. Direct dev and
 * Electron launches derive the same stable fallback from their complete home,
 * keeping identity independent from mutable display names and Web ports.
 */
export function resolveAliceProjectIdentity(
  options: ResolveAliceProjectIdentityOptions,
): AliceProjectIdentity {
  const env = options.env ?? process.env
  const home = resolve(options.home)
  const appRoot = normalizeOptionalPath(
    env['OPENALICE_PROJECT_APP_ROOT'] ?? options.appRoot,
  )
  const key = normalizeProjectKey(
    env['OPENALICE_PROJECT_KEY'] ?? options.key ?? 'default',
  )
  const explicitId = env['OPENALICE_PROJECT_ID']?.trim()
  const id = explicitId
    ? normalizeProjectId(explicitId)
    : deriveAliceProjectId(home)
  const displayName = normalizeDisplayName(
    env['OPENALICE_PROJECT_NAME']
      ?? options.displayName
      ?? defaultProjectDisplayName(key),
  )
  return Object.freeze({ id, key, displayName, home, appRoot })
}

export function deriveAliceProjectId(home: string): string {
  const canonicalHome = resolve(home)
  const digest = createHash('sha256')
    .update('openalice/alice-project/v1\0')
    .update(canonicalHome)
    .digest('hex')
    .slice(0, 24)
  return `${ALICE_PROJECT_ID_PREFIX}${digest}`
}

export function aliceProjectEnvironment(
  project: AliceProjectIdentity,
): NodeJS.ProcessEnv {
  return {
    OPENALICE_PROJECT_ID: project.id,
    OPENALICE_PROJECT_KEY: project.key,
    OPENALICE_PROJECT_NAME: project.displayName,
    ...(project.appRoot
      ? { OPENALICE_PROJECT_APP_ROOT: project.appRoot }
      : {}),
  }
}

function normalizeProjectId(value: string): string {
  if (!/^alice-project-[a-z0-9][a-z0-9_-]{7,95}$/.test(value)) {
    throw new Error(
      'OPENALICE_PROJECT_ID must begin with "alice-project-" and contain only lowercase letters, numbers, "_", or "-".',
    )
  }
  return value
}

function normalizeProjectKey(value: string): string {
  const key = value.trim()
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(key)) {
    throw new Error(
      'AliceProject key must begin with a lowercase letter and contain only lowercase letters, numbers, "_", or "-".',
    )
  }
  return key
}

function normalizeDisplayName(value: string): string {
  const displayName = value.trim()
  if (displayName.length < 1 || displayName.length > 80) {
    throw new Error('AliceProject display name must contain 1-80 characters.')
  }
  return displayName
}

function normalizeOptionalPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  return resolve(value)
}

function defaultProjectDisplayName(key: string): string {
  if (key !== 'default') return fitDisplayName(humanizeProjectKey(key))
  return 'Default AliceProject'
}

function fitDisplayName(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 77)}...`
}

function humanizeProjectKey(value: string): string {
  return value
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}
