import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/**
 * Standalone CLI projection of the AliceProject identity contract.
 *
 * The public CLI installer deliberately ships without the monorepo package
 * graph, so this tiny module mirrors `@traderalice/guardian-runtime` rather
 * than adding a runtime package dependency to the installed payload. Keep the
 * v1 hash namespace and environment names in sync with that owner module.
 */
export interface AliceProjectIdentity {
  id: string
  key: string
  displayName: string
  home: string
  appRoot: string | null
}

export function resolveAliceProjectIdentity(options: {
  home: string
  appRoot?: string | null
  env?: NodeJS.ProcessEnv
  key?: string
  displayName?: string
}): AliceProjectIdentity {
  const env = options.env ?? process.env
  const home = resolve(options.home)
  const appRootValue = env['OPENALICE_PROJECT_APP_ROOT'] ?? options.appRoot
  const appRoot = typeof appRootValue === 'string' && appRootValue.trim()
    ? resolve(appRootValue)
    : null
  const key = normalizeProjectKey(env['OPENALICE_PROJECT_KEY'] ?? options.key ?? 'default')
  const explicitId = env['OPENALICE_PROJECT_ID']?.trim()
  const id = explicitId ? normalizeProjectId(explicitId) : deriveAliceProjectId(home)
  const displayName = normalizeDisplayName(
    env['OPENALICE_PROJECT_NAME']
      ?? options.displayName
      ?? defaultProjectDisplayName(key),
  )
  return Object.freeze({ id, key, displayName, home, appRoot })
}

export function deriveAliceProjectId(home: string): string {
  return deriveAliceProjectIdFromCanonicalHome(resolve(home))
}

/** Derive identity for an already-canonical path on another platform.
 * The SSH transfer planner must not run a remote POSIX Home through the local
 * host's path resolver (for example macOS `/home` symlink semantics).
 */
export function deriveAliceProjectIdFromCanonicalHome(home: string): string {
  const digest = createHash('sha256')
    .update('openalice/alice-project/v1\0')
    .update(home)
    .digest('hex')
    .slice(0, 24)
  return `alice-project-${digest}`
}

export function aliceProjectEnvironment(project: AliceProjectIdentity): NodeJS.ProcessEnv {
  return {
    OPENALICE_PROJECT_ID: project.id,
    OPENALICE_PROJECT_KEY: project.key,
    OPENALICE_PROJECT_NAME: project.displayName,
    ...(project.appRoot ? { OPENALICE_PROJECT_APP_ROOT: project.appRoot } : {}),
  }
}

function normalizeProjectId(value: string): string {
  if (!/^alice-project-[a-z0-9][a-z0-9_-]{7,95}$/.test(value)) {
    throw new Error('OPENALICE_PROJECT_ID is not a valid AliceProject id.')
  }
  return value
}

function normalizeProjectKey(value: string): string {
  const key = value.trim()
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(key)) {
    throw new Error('AliceProject key must begin with a lowercase letter and use only letters, numbers, "_", or "-".')
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
