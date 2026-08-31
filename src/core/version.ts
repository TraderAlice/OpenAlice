/**
 * App version awareness — current version + latest channel release.
 *
 * The current version comes from package.json#version (read once at module
 * load). The latest stable or beta version comes from the matching OpenAlice
 * CDN manifest and is cached in memory with separate success/error TTLs.
 * Installed provenance, rather than package semver, selects the channel and
 * update authority. Dev discovery stays in the native CLI, pinned/custom
 * installs do not discover updates, and service-managed runtimes defer to the
 * service that deployed them.
 * GitHub Release assets remain the immutable payload source, but update
 * discovery does not depend on GitHub's anonymous API.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ==================== Current version (from package.json) ====================

interface PackageJson {
  version?: string
}

let _packageJson: PackageJson | null = null

function readPackageJson(): PackageJson {
  if (_packageJson !== null) return _packageJson
  const here = fileURLToPath(import.meta.url)
  const candidates = [
    process.env['OPENALICE_APP_HOME'] && resolve(process.env['OPENALICE_APP_HOME'], 'package.json'),
    resolve(process.cwd(), 'package.json'),
    resolve(dirname(here), '..', '..', 'package.json'),
  ].filter((value): value is string => Boolean(value))
  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as PackageJson
      if (typeof parsed.version === 'string') {
        _packageJson = parsed
        return _packageJson
      }
    } catch {
      // Packaged Alice/UTA and source execution have different import.meta.url
      // roots; continue through the explicit app home, cwd, and source fallbacks.
    }
  }
  _packageJson = {}
  return _packageJson
}

export function getCurrentVersion(): string {
  return readPackageJson().version ?? '0.0.0'
}

// ==================== Semver comparison (minimal) ====================

interface ParsedVersion {
  core: number[]
  pre: string | null
}

function parseVersion(s: string): ParsedVersion {
  const stripped = s.replace(/^v/, '')
  const dashIdx = stripped.indexOf('-')
  const core = dashIdx === -1 ? stripped : stripped.slice(0, dashIdx)
  const pre = dashIdx === -1 ? null : stripped.slice(dashIdx + 1)
  const coreNums = core.split('.').map((n) => parseInt(n, 10) || 0)
  while (coreNums.length < 3) coreNums.push(0)
  return { core: coreNums.slice(0, 3), pre }
}

/**
 * Compare two semver-style versions. Returns negative if a<b, 0 if equal,
 * positive if a>b. Handles the common cases (MAJOR.MINOR.PATCH-PRERELEASE)
 * — not a full RFC-compliant comparator, but enough for "is the remote
 * release newer than ours".
 */
export function compareVersions(a: string, b: string): number {
  const A = parseVersion(a)
  const B = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (A.core[i] !== B.core[i]) return A.core[i] - B.core[i]
  }
  return comparePrerelease(A.pre, B.pre)
}

function comparePrerelease(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1

  const leftParts = left.split('.')
  const rightParts = right.split('.')
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

// ==================== Latest release (cached manifest fetch) ====================

export interface LatestRelease {
  version: string
  url: string
  body: string | null
  publishedAt: string
}

interface CacheEntry {
  fetchedAt: number
  result: LatestRelease | null
  error: string | null
}

export type ReleaseChannel = 'stable' | 'beta'

const MANIFEST_URLS: Record<ReleaseChannel, string> = {
  stable: 'https://download.openalice.ai/manifest.json',
  beta: 'https://download.openalice.ai/beta/manifest.json',
}

interface FetchLatestReleaseOptions {
  /** Force re-fetch even if this channel's cache is fresh. */
  force?: boolean
  /** Override the channel inferred from the installed product version. */
  channel?: ReleaseChannel
}

export type VersionChannel = 'stable' | 'beta' | 'dev' | 'pinned' | 'custom'
export type UpdateAuthority = 'source' | 'desktop' | 'cli' | 'service' | 'none'

type EnvLike = Readonly<Record<string, string | undefined>>
type ReadTextFile = (path: string) => string

interface UpdateContext {
  channel: VersionChannel
  authority: UpdateAuthority
  error: string | null
}

interface GetVersionInfoOptions extends FetchLatestReleaseOptions {
  /** Test seam for the running process environment. */
  env?: EnvLike
  /** Test seam for installed provenance reads. */
  readTextFile?: ReadTextFile
}

const SUCCESS_TTL_MS = 60 * 60 * 1000 // 1h
const ERROR_TTL_MS = 5 * 60 * 1000 // 5min

const cache = new Map<ReleaseChannel, CacheEntry>()

function releaseChannelForVersion(version: string): ReleaseChannel {
  return parseVersion(version).pre?.split('.')[0]?.toLowerCase() === 'beta'
    ? 'beta'
    : 'stable'
}

function releaseChannelMatchesVersion(channel: ReleaseChannel, version: string): boolean {
  if (channel === 'stable') return /^\d+\.\d+\.\d+$/.test(version)
  return /^\d+\.\d+\.\d+-beta(?:\.[1-9][0-9]*)?$/.test(version)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function parseReleaseManifest(value: unknown, channel: ReleaseChannel): LatestRelease {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${channel} release manifest is not an object`)
  }

  const manifest = value as Record<string, unknown>
  if (manifest['channel'] !== channel) {
    throw new Error(`${channel} release manifest declares channel ${String(manifest['channel'])}`)
  }

  const version = manifest['version']
  if (typeof version !== 'string' || !releaseChannelMatchesVersion(channel, version)) {
    throw new Error(`${channel} release manifest advertises out-of-channel version ${String(version)}`)
  }

  const releaseNotesUrl = manifest['releaseNotesUrl']
  if (typeof releaseNotesUrl !== 'string' || !isHttpUrl(releaseNotesUrl)) {
    throw new Error(`${channel} release manifest has an invalid releaseNotesUrl`)
  }

  const publishedAt = manifest['publishedAt']
  if (
    typeof publishedAt !== 'string'
    || publishedAt.trim() === ''
    || !Number.isFinite(Date.parse(publishedAt))
  ) {
    throw new Error(`${channel} release manifest has an invalid publishedAt`)
  }

  return {
    version,
    url: releaseNotesUrl,
    body: null,
    publishedAt,
  }
}

/**
 * Fetch the latest release from the requested OpenAlice CDN channel manifest.
 * Returns null + an error string when the manifest is unreachable or invalid.
 * Successes and failures are cached independently per channel so repeated UI
 * loads do not flap the discovery endpoint.
 */
export async function fetchLatestRelease(
  opts?: FetchLatestReleaseOptions,
): Promise<{ result: LatestRelease | null; error: string | null }> {
  const now = Date.now()
  const channel = opts?.channel ?? releaseChannelForVersion(getCurrentVersion())
  const cached = cache.get(channel)
  if (!opts?.force && cached) {
    const ttl = cached.error ? ERROR_TTL_MS : SUCCESS_TTL_MS
    if (now - cached.fetchedAt < ttl) {
      return { result: cached.result, error: cached.error }
    }
  }

  try {
    const url = MANIFEST_URLS[channel]
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const error = `OpenAlice ${channel} manifest ${res.status} ${res.statusText}`
      cache.set(channel, { fetchedAt: now, result: null, error })
      return { result: null, error }
    }
    const result = parseReleaseManifest(await res.json(), channel)
    cache.set(channel, { fetchedAt: now, result, error: null })
    return { result, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    cache.set(channel, { fetchedAt: now, result: null, error })
    return { result: null, error }
  }
}

/** Reset the in-memory cache. Test-only. */
export function _resetCacheForTest(): void {
  cache.clear()
}

// ==================== Combined view ====================

export interface VersionInfo {
  current: string
  channel: VersionChannel
  updateAuthority: UpdateAuthority
  latest: string | null
  hasUpdate: boolean
  releaseUrl: string | null
  releaseNotes: string | null
  publishedAt: string | null
  error: string | null
}

export async function getVersionInfo(opts?: GetVersionInfoOptions): Promise<VersionInfo> {
  const current = getCurrentVersion()
  const context = opts?.channel
    ? { channel: opts.channel, authority: 'source' as const, error: null }
    : resolveUpdateContext(
        opts?.env ?? process.env,
        opts?.readTextFile ?? ((path) => readFileSync(path, 'utf8')),
        current,
      )

  if (
    context.error
    || context.authority === 'service'
    || context.authority === 'none'
    || context.channel === 'dev'
    || context.channel === 'pinned'
    || context.channel === 'custom'
  ) {
    return {
      current,
      channel: context.channel,
      updateAuthority: context.authority,
      latest: null,
      hasUpdate: false,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      error: context.error,
    }
  }

  const { result, error } = await fetchLatestRelease({
    force: opts?.force,
    channel: context.channel,
  })
  if (!result) {
    return {
      current,
      channel: context.channel,
      updateAuthority: context.authority,
      latest: null, hasUpdate: false,
      releaseUrl: null, releaseNotes: null, publishedAt: null,
      error,
    }
  }
  const hasUpdate = compareVersions(result.version, current) > 0
  return {
    current,
    channel: context.channel,
    updateAuthority: context.authority,
    latest: result.version,
    hasUpdate,
    releaseUrl: result.url,
    releaseNotes: result.body,
    publishedAt: result.publishedAt,
    error: null,
  }
}

function resolveUpdateContext(
  env: EnvLike,
  readTextFile: ReadTextFile,
  currentVersion: string,
): UpdateContext {
  const installedSourcePath = env['OPENALICE_INSTALL_SOURCE']?.trim()
  const installedChannel = installedSourcePath
    ? readInstalledChannel(installedSourcePath, readTextFile)
    : null
  const provenanceError = installedSourcePath && installedChannel === null
    ? 'Installed OpenAlice update metadata is invalid'
    : null
  const channel = installedChannel ?? (
    installedSourcePath
      ? 'custom'
      : releaseChannelForVersion(currentVersion)
  )

  if (env['OPENALICE_SERVICE_MANAGER']?.trim() === 'railway') {
    return { channel, authority: 'service', error: provenanceError }
  }

  const runtimeProfile = env['OPENALICE_RUNTIME_PROFILE']?.trim()
    || env['OPENALICE_LAUNCHER']?.trim()
  if (runtimeProfile === 'electron-packaged') {
    return { channel, authority: 'desktop', error: provenanceError }
  }
  if (runtimeProfile === 'docker') {
    return { channel, authority: 'service', error: provenanceError }
  }

  if (installedSourcePath) {
    const authority = channel === 'pinned' || channel === 'custom' ? 'none' : 'cli'
    return { channel, authority, error: provenanceError }
  }

  return { channel, authority: 'source', error: null }
}

function readInstalledChannel(path: string, readTextFile: ReadTextFile): VersionChannel | null {
  try {
    const parsed = JSON.parse(readTextFile(path)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const source = parsed as Record<string, unknown>
    if (!isValidInstalledSource(source)) return null

    const schemaVersion = source['schemaVersion']
    if (schemaVersion === 2 || schemaVersion === 3) {
      return normalizeInstalledChannel(source['updateChannel'])
    }
    if (schemaVersion !== 1) return null

    const selector = source['selector']
    if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return null
    const kind = (selector as Record<string, unknown>)['kind']
    const value = (selector as Record<string, unknown>)['value']
    if (kind === 'version') return 'pinned'
    if (kind !== 'branch' || typeof value !== 'string') return null
    if (value === 'master') {
      return source['installerUrl'] === 'https://openalice.ai/install' ? 'stable' : 'custom'
    }
    return 'dev'
  } catch {
    return null
  }
}

function isValidInstalledSource(source: Record<string, unknown>): boolean {
  const schemaVersion = source['schemaVersion']
  const selector = source['selector']
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return false
  const kind = (selector as Record<string, unknown>)['kind']
  const value = (selector as Record<string, unknown>)['value']
  if (
    ![1, 2, 3].includes(schemaVersion as number)
    || source['repository'] !== 'TraderAlice/OpenAlice'
    || typeof source['cliVersion'] !== 'string'
    || source['cliVersion'].length < 1
    || (kind !== 'branch' && kind !== 'version')
    || typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || value.includes('..')
    || !/^[A-Za-z0-9._/-]+$/.test(value)
    || typeof source['installerUrl'] !== 'string'
    || !isHttpUrl(source['installerUrl'])
  ) {
    return false
  }
  if (schemaVersion !== 3) return true

  const artifact = source['artifact']
  return (
    typeof source['method'] === 'string'
    && ['direct', 'npm', 'bun', 'brew', 'aur'].includes(source['method'])
    && Boolean(artifact)
    && typeof artifact === 'object'
    && !Array.isArray(artifact)
    && ['darwin', 'linux'].includes((artifact as Record<string, unknown>)['platform'] as string)
    && ['arm64', 'x64'].includes((artifact as Record<string, unknown>)['arch'] as string)
    && typeof (artifact as Record<string, unknown>)['sha256'] === 'string'
    && /^[a-f0-9]{64}$/.test((artifact as Record<string, unknown>)['sha256'] as string)
    && typeof source['installedAt'] === 'string'
    && Number.isFinite(Date.parse(source['installedAt']))
  )
}

function normalizeInstalledChannel(value: unknown): VersionChannel | null {
  if (value === 'development') return 'dev'
  if (value === 'stable' || value === 'beta' || value === 'pinned' || value === 'custom') {
    return value
  }
  return null
}
