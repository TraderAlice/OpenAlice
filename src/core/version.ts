/**
 * App version awareness — current version + latest GitHub release.
 *
 * The current version comes from package.json#version (read once at
 * module load). The latest version comes from the GitHub Releases API
 * (cached in-memory with a TTL — GitHub unauthenticated rate limit is
 * 60 req/h per IP, so we don't want to hit it on every UI load).
 *
 * The repo owner+name is derived from package.json#repository.url so
 * fork users don't poll the upstream repo.
 *
 * Self-hosted source distribution: when the user sees "update
 * available" they manually run `git pull && pnpm build` and restart.
 * Auto-execute is out of scope (Electron will handle that path
 * differently when packaging lands).
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ==================== Current version (from package.json) ====================

interface PackageJson {
  version?: string
  repository?: { url?: string } | string
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

/** Parse owner+repo from `git+https://github.com/<owner>/<repo>.git` style URLs. */
export function getRepoSlug(): { owner: string; repo: string } | null {
  const repository = readPackageJson().repository
  const url = typeof repository === 'string' ? repository : repository?.url ?? ''
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
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
  // Cores equal — release > prerelease
  if (A.pre === null && B.pre === null) return 0
  if (A.pre === null) return 1
  if (B.pre === null) return -1
  // Both prereleases — lexicographic comparison
  return A.pre < B.pre ? -1 : A.pre > B.pre ? 1 : 0
}

// ==================== Latest release (cached GitHub fetch) ====================

export interface LatestRelease {
  version: string
  url: string
  body: string
  publishedAt: string
}

interface CacheEntry {
  fetchedAt: number
  result: LatestRelease | null
  error: string | null
}

export type ReleaseChannel = 'stable' | 'beta'

interface FetchLatestReleaseOptions {
  /** Force re-fetch even if this channel's cache is fresh. */
  force?: boolean
  /** Override the channel inferred from the installed product version. */
  channel?: ReleaseChannel
}

const SUCCESS_TTL_MS = 60 * 60 * 1000 // 1h
const ERROR_TTL_MS = 5 * 60 * 1000 // 5min

const cache = new Map<ReleaseChannel, CacheEntry>()

function releaseChannelForVersion(version: string): ReleaseChannel {
  return parseVersion(version).pre?.split('.')[0]?.toLowerCase() === 'beta'
    ? 'beta'
    : 'stable'
}

function matchesReleaseChannel(
  release: { tag_name?: string; draft?: boolean; prerelease?: boolean },
  channel: ReleaseChannel,
): boolean {
  if (release.draft || !release.tag_name) return false
  if (channel === 'beta') {
    return release.prerelease === true && /-beta(?:\.|$)/i.test(release.tag_name)
  }
  return release.prerelease !== true && !release.tag_name.includes('-')
}

/**
 * Fetch the latest GitHub release. Returns null + error string when the
 * API is unreachable / rate-limited / repo has no releases. Result
 * (success or failure) is cached so a flapping UI doesn't burn the
 * rate limit.
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

  const slug = getRepoSlug()
  if (!slug) {
    const entry = { fetchedAt: now, result: null, error: 'Could not derive repo slug from package.json' }
    cache.set(channel, entry)
    return { result: null, error: entry.error }
  }

  try {
    // Use /releases so beta installations can see prereleases. Stable and beta
    // installations intentionally select disjoint rows from the same response.
    const url = `https://api.github.com/repos/${slug.owner}/${slug.repo}/releases?per_page=100`
    const res = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const error = `GitHub API ${res.status} ${res.statusText}`
      cache.set(channel, { fetchedAt: now, result: null, error })
      return { result: null, error }
    }
    type ReleaseRow = { tag_name?: string; html_url?: string; body?: string; published_at?: string; draft?: boolean; prerelease?: boolean }
    const list = await res.json() as ReleaseRow[]
    // GitHub returns newest-first by default. Take the first release in the
    // installed product's channel; stable never follows a prerelease and beta
    // never follows stable or another prerelease family such as rc.
    const data = Array.isArray(list) ? list.find((release) => matchesReleaseChannel(release, channel)) : null
    if (!data || !data.tag_name) {
      const entry = { fetchedAt: now, result: null, error: `No published releases found for ${channel} channel` }
      cache.set(channel, entry)
      return { result: null, error: entry.error }
    }
    const result: LatestRelease = {
      version: data.tag_name.replace(/^v/, ''),
      url: data.html_url ?? `https://github.com/${slug.owner}/${slug.repo}/releases`,
      body: data.body ?? '',
      publishedAt: data.published_at ?? '',
    }
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
  latest: string | null
  hasUpdate: boolean
  releaseUrl: string | null
  releaseNotes: string | null
  publishedAt: string | null
  error: string | null
}

export async function getVersionInfo(opts?: FetchLatestReleaseOptions): Promise<VersionInfo> {
  const current = getCurrentVersion()
  const { result, error } = await fetchLatestRelease(opts)
  if (!result) {
    return {
      current, latest: null, hasUpdate: false,
      releaseUrl: null, releaseNotes: null, publishedAt: null,
      error,
    }
  }
  const hasUpdate = compareVersions(result.version, current) > 0
  return {
    current,
    latest: result.version,
    hasUpdate,
    releaseUrl: result.url,
    releaseNotes: result.body,
    publishedAt: result.publishedAt,
    error: null,
  }
}
