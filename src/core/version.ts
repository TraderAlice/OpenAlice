/**
 * App version awareness — current version + latest channel release.
 *
 * The current version comes from the shared product build identity.
 * The latest stable or beta version comes from the matching OpenAlice
 * CDN manifest and is cached in memory with separate success/error TTLs.
 * Explicit runtime identity and installed provenance, rather than package
 * semver alone, select the channel and update authority. Source development
 * stays on the dev channel even though package.json still supplies its display
 * version. Dev discovery stays in the native CLI, pinned/custom installs do
 * not discover updates, and service-managed runtimes defer to the service that
 * deployed them.
 * GitHub Release assets remain the immutable payload source, but update
 * discovery does not depend on GitHub's anonymous API.
 */

import { DiscoveryStore, selectRelease, releaseChannelMatchesVersion, installSourceUpdateChannel, releaseChannelForVersion, type ReleaseDecision } from '@traderalice/update-lifecycle'
import { readFileSync } from 'node:fs'
import { getProductVersion as getCurrentVersion } from '@traderalice/update-lifecycle/node'
export { getCurrentVersion }

// ==================== Latest release (cached manifest fetch) ====================

export interface LatestRelease {
  version: string
  url: string
  body: string | null
  publishedAt: string
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
  /** Report running identity without contacting the release feed. */
  currentOnly?: boolean
  /** Test seam for the running process environment. */
  env?: EnvLike
  /** Test seam for installed provenance reads. */
  readTextFile?: ReadTextFile
}

const SUCCESS_TTL_MS = 60 * 60 * 1000 // 1h
const ERROR_TTL_MS = 5 * 60 * 1000 // 5min

// Fixed feed inventory: each channel owns one bounded single-flight resource.
const cache = new Map<ReleaseChannel, DiscoveryStore<LatestRelease>>()

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
 * Retains the last valid result alongside an error when refreshing fails.
 * Successes and failures are cached independently per channel so repeated UI
 * loads do not flap the discovery endpoint.
 */
export async function fetchLatestRelease(
  opts?: FetchLatestReleaseOptions,
): Promise<{ result: LatestRelease | null; error: string | null }> {
  const channel = opts?.channel ?? releaseChannelForVersion(getCurrentVersion())
  if (!channel) return { result: null, error: 'Running product identity has no supported release channel' }
  let store = cache.get(channel)
  if (!store) {
    store = new DiscoveryStore<LatestRelease>({ successTtlMs: SUCCESS_TTL_MS, errorTtlMs: ERROR_TTL_MS })
    cache.set(channel, store)
  }
  await store.check(async () => {
    const res = await fetch(MANIFEST_URLS[channel], {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`OpenAlice ${channel} manifest ${res.status} ${res.statusText}`)
    return parseReleaseManifest(await res.json(), channel)
  }, opts?.force)
  const { value: result, error } = store.getSnapshot()
  return { result, error }
}

/** Reset the in-memory cache. Test-only. */
export function _resetCacheForTest(): void {
  for (const store of cache.values()) store.clear()
  cache.clear()
}

// ==================== Combined view ====================

export interface VersionInfo {
  current: string
  channel: VersionChannel
  updateAuthority: UpdateAuthority
  latest: string | null
  /** Compatibility projection for released clients; decision is authoritative. */
  hasUpdate: boolean
  decision: ReleaseDecision | null
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
    opts?.currentOnly
    || context.error
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
      decision: null,
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
      latest: null, hasUpdate: false, decision: null,
      releaseUrl: null, releaseNotes: null, publishedAt: null,
      error,
    }
  }
  const decision = selectRelease(
    { channel: context.channel, version: current },
    { channel: context.channel, version: result.version },
    context.channel,
  )
  const hasUpdate = !error && decision.status === 'available'
  return {
    current,
    channel: context.channel,
    updateAuthority: context.authority,
    latest: result.version,
    hasUpdate,
    decision,
    releaseUrl: result.url,
    releaseNotes: result.body,
    publishedAt: result.publishedAt,
    error: error ?? (decision.status === 'unknown' ? 'Cannot determine the running release identity' : null),
  }
}

function resolveUpdateContext(
  env: EnvLike,
  readTextFile: ReadTextFile,
  currentVersion: string,
): UpdateContext {
  const runtimeProfile = env['OPENALICE_RUNTIME_PROFILE']?.trim()
    || env['OPENALICE_LAUNCHER']?.trim()

  // package.json remains the source runtime's display/build baseline, but it
  // must not turn a dev checkout into the stable or beta update channel.
  if (isSourceRuntimeProfile(runtimeProfile)) {
    return { channel: 'dev', authority: 'source', error: null }
  }

  if (runtimeProfile === 'electron-packaged') {
    return { channel: releaseChannelForVersion(currentVersion) ?? 'custom', authority: 'desktop', error: null }
  }

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
      : releaseChannelForVersion(currentVersion) ?? 'custom'
  )

  if (runtimeProfile === 'docker') {
    return { channel, authority: 'service', error: provenanceError }
  }

  if (installedSourcePath) {
    const authority = channel === 'pinned' || channel === 'custom' ? 'none' : 'cli'
    return { channel, authority, error: provenanceError }
  }

  return { channel: 'dev', authority: 'source', error: null }
}

function isSourceRuntimeProfile(runtimeProfile: string | undefined): boolean {
  return runtimeProfile === 'dev'
    || runtimeProfile === 'electron-dev'
    || runtimeProfile === 'electron'
}

function readInstalledChannel(path: string, readTextFile: ReadTextFile): VersionChannel | null {
  try {
    const channel = installSourceUpdateChannel(JSON.parse(readTextFile(path)))
    return channel === 'development' ? 'dev' : channel
  } catch { return null }
}
