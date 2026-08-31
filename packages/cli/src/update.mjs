import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveInstalledLayout } from './install-layout.mjs'
import {
  packageManagerForSource,
  packageManagerUpdateMessage,
} from './package-manager.mjs'
import {
  CLI_VERSION,
  installSourceUpdateChannel,
  readInstallSource,
} from './install-source.mjs'

const CURRENT_VERSION = CLI_VERSION
const DEFAULT_MANIFEST_URLS = Object.freeze({
  stable: 'https://download.openalice.ai/manifest.json',
  beta: 'https://download.openalice.ai/beta/manifest.json',
  dev: 'https://download.openalice.ai/cli/dev/manifest.json',
})
const LEGACY_STABLE_VERSION = '0.90.1'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000
const CHECK_TIMEOUT_MS = 1_500
const EXPLICIT_CHECK_TIMEOUT_MS = 10_000
const INSTALLER_DOWNLOAD_TIMEOUT_MS = 30_000
const DEV_MANIFEST_TARGET_COUNT = 4

export function parseUpdateArgs(argv) {
  const options = { checkOnly: false, yes: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.checkOnly = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else if (arg === '--json') options.json = true
    else if (arg === '--channel') {
      const channel = normalizeUpdateChannel(argv[index + 1])
      if (!channel) throw new Error('--channel must be stable, beta, or dev')
      options.channel = channel
      index += 1
    }
    else throw new Error(`Unknown update option: ${arg}`)
  }
  if (options.json && !options.checkOnly) {
    throw new Error('--json requires --check')
  }
  return options
}

export async function checkForUpdate(options = {}, dependencies = {}) {
  const currentVersion = options.currentVersion ?? CURRENT_VERSION
  const installSource = options.installSource ?? await (
    dependencies.readInstallSourceImpl ?? readInstallSource
  )({ env: dependencies.env ?? process.env })
  const sourceChannel = normalizeUpdateChannel(installSourceUpdateChannel(installSource))
  const channel = options.channel === undefined
    ? sourceChannel
    : normalizeUpdateChannel(options.channel)
  if (!channel) {
    return {
      status: 'unsupported',
      currentVersion,
      channel: installSourceUpdateChannel(installSource),
      sourceChannel: installSourceUpdateChannel(installSource),
      message: unsupportedChannelMessage(
        installSource,
        installSourceUpdateChannel(installSource),
      ),
    }
  }

  const manager = packageManagerForSource(installSource)
  const ownership = manager ? { label: manager.label, update: manager.update } : null
  if (channel === 'dev') {
    const manifest = await fetchDevManifest({
      manifestUrl: options.manifestUrl
        ?? dependencies.env?.['OPENALICE_UPDATE_MANIFEST_URL']
        ?? process.env['OPENALICE_UPDATE_MANIFEST_URL']
        ?? DEFAULT_MANIFEST_URLS.dev,
      timeoutMs: options.timeoutMs ?? EXPLICIT_CHECK_TIMEOUT_MS,
      platform: options.platform ?? process.platform,
      arch: options.arch ?? process.arch,
    }, dependencies)
    const currentArtifactSha256 = options.currentArtifactSha256
      ?? installSource?.artifact?.sha256
      ?? null
    const sameArtifact = currentArtifactSha256 === manifest.target.sha256
    return {
      status: sourceChannel !== 'dev' || !sameArtifact ? 'available' : 'current',
      currentVersion,
      latestVersion: manifest.version,
      latestCommit: manifest.commit,
      latestContentIdentity: manifest.target.contentIdentity,
      latestArtifactSha256: manifest.target.sha256,
      releaseNotesUrl: `https://github.com/TraderAlice/OpenAlice/commit/${manifest.commit}`,
      installer: manifest.installer,
      channel,
      sourceChannel: sourceChannel ?? installSourceUpdateChannel(installSource),
      ...(ownership ? { packageManager: ownership } : {}),
    }
  }

  const manifest = await fetchReleaseManifest({
    manifestUrl: options.manifestUrl
      ?? dependencies.env?.['OPENALICE_UPDATE_MANIFEST_URL']
      ?? process.env['OPENALICE_UPDATE_MANIFEST_URL']
      ?? DEFAULT_MANIFEST_URLS[channel],
    timeoutMs: options.timeoutMs ?? EXPLICIT_CHECK_TIMEOUT_MS,
  }, dependencies)
  if (manifest.channel !== channel || !releaseChannelMatchesVersion(channel, manifest.version)) {
    throw new Error(`${channel} update manifest advertises out-of-channel version ${manifest.version}`)
  }
  if (
    channel === 'stable'
    && manifest.version === LEGACY_STABLE_VERSION
    && isNativeDirectInstallSource(installSource)
  ) {
    return {
      status: 'unsupported',
      currentVersion,
      latestVersion: manifest.version,
      releaseNotesUrl: manifest.releaseNotesUrl,
      channel,
      sourceChannel: sourceChannel ?? installSourceUpdateChannel(installSource),
      message: 'Stable 0.90.1 uses the legacy Node-managed layout and cannot safely replace a native CLI installation. Stay on beta/dev until a native stable release is available.',
    }
  }
  const comparison = compareVersions(manifest.version, currentVersion)
  return {
    status: sourceChannel !== channel || comparison > 0 ? 'available' : 'current',
    currentVersion,
    latestVersion: manifest.version,
    releaseNotesUrl: manifest.releaseNotesUrl,
    installer: manifest.installer,
    channel,
    sourceChannel: sourceChannel ?? installSourceUpdateChannel(installSource),
    ...(ownership ? { packageManager: ownership } : {}),
  }
}

export async function runUpdateCommand(argv, dependencies = {}) {
  const options = parseUpdateArgs(argv)
  const stdout = dependencies.stdout ?? process.stdout
  const env = dependencies.env ?? process.env
  if (env['OPENALICE_SERVICE_MANAGER']?.trim() === 'railway' && !options.checkOnly) {
    stdout.write('Railway service variables own this OpenAlice installation. Set OPENALICE_RAILWAY_CHANNEL and optional OPENALICE_RAILWAY_VERSION, then restart or redeploy the service.\n')
    stdout.write('OpenAlice did not modify the persistent release pointer.\n')
    return 0
  }
  const installSource = await (
    dependencies.readInstallSourceImpl ?? readInstallSource
  )({ env })
  const manager = packageManagerForSource(installSource)
  if (manager && !options.checkOnly) {
    if (options.channel && options.channel !== 'stable') {
      stdout.write(`${manager.label} owns this OpenAlice installation and publishes only the stable channel.\n`)
      stdout.write(`To switch to ${options.channel}, use the direct installer explicitly: curl -fsSL https://openalice.ai/install | bash -s -- --channel ${options.channel}\n`)
      stdout.write('OpenAlice did not modify the package manager\'s files.\n')
      return 0
    }
    stdout.write(`${packageManagerUpdateMessage(installSource)}\n`)
    stdout.write('OpenAlice did not modify the package manager\'s files.\n')
    return 0
  }
  let result
  try {
    result = await checkForUpdate({ installSource, channel: options.channel }, dependencies)
  } catch (error) {
    throw new Error(`Could not check for OpenAlice updates: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (options.json) {
    stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  }
  if (result.status === 'unsupported') {
    stdout.write(`${result.message}\n`)
    return 0
  }
  if (result.status === 'current') {
    stdout.write(`OpenAlice ${result.currentVersion} is current on ${result.channel}.\n`)
    if (manager) stdout.write(`${manager.label} owns future updates for this installation.\n`)
    return 0
  }

  const candidate = result.channel === 'dev' && result.latestCommit
    ? `dev@${result.latestCommit.slice(0, 12)}`
    : result.latestVersion
  stdout.write(`OpenAlice ${candidate} is available on ${result.channel} (current ${result.currentVersion}).\n`)
  if (result.releaseNotesUrl) stdout.write(`Release notes: ${result.releaseNotesUrl}\n`)
  if (options.checkOnly) {
    stdout.write(manager
      ? result.channel === 'stable'
        ? `Update with: ${manager.update}\n`
        : `Switch with the direct installer: curl -fsSL https://openalice.ai/install | bash -s -- --channel ${result.channel}\n`
      : 'Run "openalice update" to review and install it.\n')
    return 0
  }
  const layout = Object.hasOwn(dependencies, 'layout')
    ? dependencies.layout
    : resolveInstalledLayout(import.meta.url, { env })
  if (!layout) {
    throw new Error('This OpenAlice CLI is running from source, not an installed release. Re-run the public installer to update the installed command.')
  }
  const applyUpdate = dependencies.applyUpdate ?? downloadAndRunInstaller
  return await applyUpdate(result, {
    layout,
    yes: options.yes,
    env,
    fetchImpl: dependencies.fetchImpl,
    spawnImpl: dependencies.spawnImpl,
  })
}

export async function maybeNotifyUpdate(options = {}, dependencies = {}) {
  const env = dependencies.env ?? process.env
  const stderr = dependencies.stderr ?? process.stderr
  const interactive = dependencies.interactive ?? Boolean(stderr.isTTY)
  if (
    options.enabled === false
    || !interactive
    || env['OPENALICE_NO_UPDATE_CHECK'] === '1'
    || env['CI']
  ) {
    return null
  }

  const layout = Object.hasOwn(dependencies, 'layout')
    ? dependencies.layout
    : resolveInstalledLayout(import.meta.url, { env })
  if (!layout) return null

  const readFileImpl = dependencies.readFileImpl ?? readFile
  const writeFileImpl = dependencies.writeFileImpl ?? writeFile
  const now = dependencies.now?.() ?? Date.now()
  let installSource
  try {
    installSource = options.installSource ?? await (
      dependencies.readInstallSourceImpl ?? readInstallSource
    )({ env })
  } catch {
    return null
  }
  const channel = normalizeUpdateChannel(installSourceUpdateChannel(installSource))
  if (!channel) return null
  const sourceFingerprint = updateSourceFingerprint(installSource, channel)
  let cache = await readUpdateCache(layout.updateCachePath, readFileImpl)
  let result = cachedResult(cache, now, channel, sourceFingerprint)

  if (!result) {
    try {
      result = await checkForUpdate({
        timeoutMs: CHECK_TIMEOUT_MS,
        installSource,
        channel,
      }, dependencies)
      cache = {
        schemaVersion: 1,
        channel,
        sourceFingerprint,
        checkedAt: new Date(now).toISOString(),
        result,
        notifiedAt: cache?.notifiedAt ?? null,
        notifiedVersion: cache?.notifiedVersion ?? null,
        notifiedKey: cache?.notifiedKey ?? null,
      }
    } catch {
      cache = {
        schemaVersion: 1,
        channel,
        sourceFingerprint,
        checkedAt: new Date(now).toISOString(),
        result: null,
        notifiedAt: cache?.notifiedAt ?? null,
        notifiedVersion: cache?.notifiedVersion ?? null,
        notifiedKey: cache?.notifiedKey ?? null,
      }
      await writeCacheBestEffort(layout.updateCachePath, cache, writeFileImpl)
      return null
    }
  }

  if (result.status !== 'available') {
    await writeCacheBestEffort(layout.updateCachePath, cache, writeFileImpl)
    return result
  }
  const notificationKey = updateNotificationKey(result)
  const lastNotified = Date.parse(cache?.notifiedAt ?? '')
  const alreadyRecent = cache?.notifiedKey === notificationKey
    && Number.isFinite(lastNotified)
    && now - lastNotified < CHECK_INTERVAL_MS
  if (!alreadyRecent) {
    const candidate = result.channel === 'dev' && result.latestCommit
      ? `dev@${result.latestCommit.slice(0, 12)}`
      : result.latestVersion
    stderr.write(
      `\nOpenAlice ${candidate} is available on ${result.channel} (current ${result.currentVersion}). `
      + 'Run "openalice update" to review and install it.\n\n',
    )
    cache.notifiedAt = new Date(now).toISOString()
    cache.notifiedVersion = result.latestVersion
    cache.notifiedKey = notificationKey
  }
  await writeCacheBestEffort(layout.updateCachePath, cache, writeFileImpl)
  return result
}

export function compareVersions(left, right) {
  const parsedLeft = parseVersion(left)
  const parsedRight = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (parsedLeft.core[index] !== parsedRight.core[index]) {
      return parsedLeft.core[index] > parsedRight.core[index] ? 1 : -1
    }
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
}

export function formatUpdateHelp() {
  return `Usage:
  openalice update --check [--channel stable|beta|dev] [--json]
  openalice update [--channel stable|beta|dev] [--yes]

Without --channel, checks the installation's current update channel. Applying
an update downloads the same channel-neutral installer, verifies its SHA-256,
and runs the ordinary atomic installer transaction for a direct install.
Package-manager installs report their owning manager and are never overwritten.

Options:
  --channel  Check or switch to stable, beta, or dev
  --check    Check and report without changing files
  --json     Print machine-readable check output (requires --check)
  -y, --yes  Approve the installer plan non-interactively
  -h, --help Show this help
`
}

async function fetchReleaseManifest(options, dependencies) {
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  timeout.unref?.()
  try {
    const response = await fetchImpl(options.manifestUrl, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`release manifest returned HTTP ${response.status}`)
    return requireReleaseManifest(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}

function requireReleaseManifest(value) {
  if (
    !value
    || !['stable', 'beta'].includes(value.channel)
    || typeof value.version !== 'string'
    || !isVersion(value.version)
    || typeof value.releaseNotesUrl !== 'string'
    || !isHttpUrl(value.releaseNotesUrl)
  ) {
    throw new Error('release manifest does not contain a valid CLI installer')
  }
  return {
    channel: value.channel,
    version: value.version,
    releaseNotesUrl: value.releaseNotesUrl,
    installer: requireInstaller(value.installer, 'release'),
  }
}

async function fetchDevManifest(options, dependencies) {
  const manifest = await fetchDevManifestDocument(options, dependencies)
  return {
    ...manifest,
    target: selectDevManifestTarget(manifest, options),
  }
}

export async function fetchDevManifestDocument(options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  timeout.unref?.()
  try {
    const response = await fetchImpl(options.manifestUrl, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`dev manifest returned HTTP ${response.status}`)
    return requireDevManifestDocument(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}

function requireDevManifestDocument(value) {
  if (
    value?.schemaVersion !== 1
    || value.channel !== 'dev'
    || value.repository !== 'TraderAlice/OpenAlice'
    || typeof value.version !== 'string'
    || !isVersion(value.version)
    || typeof value.commit !== 'string'
    || !/^[a-f0-9]{7,64}$/.test(value.commit)
    || !Array.isArray(value.targets)
    || value.targets.length !== DEV_MANIFEST_TARGET_COUNT
  ) {
    throw new Error('dev manifest is invalid')
  }
  const targets = []
  const seen = new Set()
  for (const target of value.targets) {
    const key = `${String(target?.platform)}-${String(target?.arch)}`
    const expectedArchive = `openalice-cli-dev-${key}.tar.gz`
    if (
      !['darwin', 'linux'].includes(target?.platform)
      || !['arm64', 'x64'].includes(target?.arch)
      || seen.has(key)
      || typeof target.archive !== 'string'
      || target.archive !== expectedArchive
      || typeof target.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(target.sha256)
      || typeof target.contentIdentity !== 'string'
      || !/^[a-f0-9]{16}$/.test(target.contentIdentity)
    ) {
      throw new Error(`dev manifest contains an invalid ${key} target`)
    }
    seen.add(key)
    targets.push({
      platform: target.platform,
      arch: target.arch,
      archive: target.archive,
      sha256: target.sha256,
      contentIdentity: target.contentIdentity,
    })
  }
  return {
    version: value.version,
    commit: value.commit,
    installer: requireInstaller(value.installer, 'dev'),
    targets,
  }
}

export function selectDevManifestTarget(manifest, options) {
  const matchingTargets = manifest.targets.filter((target) => (
    target.platform === options.platform && target.arch === options.arch
  ))
  if (matchingTargets.length !== 1) {
    throw new Error(`dev manifest does not contain exactly one ${options.platform}-${options.arch} target`)
  }
  const target = matchingTargets[0]
  return {
    platform: target.platform,
    arch: target.arch,
    archive: target.archive,
    sha256: target.sha256,
    contentIdentity: target.contentIdentity,
  }
}

function requireInstaller(installer, manifestKind) {
  if (
    !installer
    || typeof installer.url !== 'string'
    || !isHttpUrl(installer.url)
    || typeof installer.versionedUrl !== 'string'
    || !isHttpUrl(installer.versionedUrl)
    || typeof installer.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(installer.sha256)
  ) {
    throw new Error(`${manifestKind} manifest does not contain a valid CLI installer`)
  }
  return {
    url: installer.url,
    versionedUrl: installer.versionedUrl,
    sha256: installer.sha256,
  }
}

export async function downloadAndRunInstaller(result, context) {
  const channel = normalizeUpdateChannel(result.channel)
  if (!channel) throw new Error('update result does not contain a supported channel')
  if (channel === 'stable' && result.latestVersion === LEGACY_STABLE_VERSION) {
    throw new Error('Stable 0.90.1 cannot safely replace a native CLI installation; wait for a native stable release')
  }
  if (
    channel === 'dev'
    && (
      !/^[a-f0-9]{64}$/.test(result.latestArtifactSha256 ?? '')
      || !/^[a-f0-9]{16}$/.test(result.latestContentIdentity ?? '')
    )
  ) {
    throw new Error('dev update result is missing verified artifact identity')
  }
  const fetchImpl = context.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), INSTALLER_DOWNLOAD_TIMEOUT_MS)
  timeout.unref?.()
  let bytes
  try {
    const response = await fetchImpl(result.installer.versionedUrl, {
      signal: controller.signal,
      headers: { accept: 'text/plain' },
    })
    if (!response.ok) throw new Error(`installer download returned HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  } finally {
    clearTimeout(timeout)
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== result.installer.sha256) {
    throw new Error('downloaded installer failed SHA-256 verification')
  }
  if (!bytes.toString('utf8', 0, 64).startsWith('#!/usr/bin/env bash')) {
    throw new Error('downloaded installer is not the OpenAlice Bash installer')
  }

  const temporary = await mkdtemp(join(tmpdir(), 'openalice-update-'))
  const installerPath = join(temporary, 'install')
  try {
    await writeFile(installerPath, bytes, { mode: 0o700 })
    await chmod(installerPath, 0o700)
    const selectorArgs = channel === 'dev'
      ? ['--channel', 'dev']
      : ['--channel', channel, '--version', result.latestVersion]
    const args = [
      installerPath,
      ...selectorArgs,
      '--install-dir', context.layout.installRoot,
      '--no-modify-path',
      ...(context.yes ? ['--yes'] : []),
    ]
    return await runProcess(context.spawnImpl ?? spawn, 'bash', args, {
      stdio: 'inherit',
      env: {
        ...context.env,
        OPENALICE_EXPECTED_CLI_VERSION: result.latestVersion,
        ...(result.latestContentIdentity
          ? { OPENALICE_EXPECTED_CLI_CONTENT_IDENTITY: result.latestContentIdentity }
          : {}),
        ...(result.latestArtifactSha256
          ? { OPENALICE_EXPECTED_CLI_ARTIFACT_SHA256: result.latestArtifactSha256 }
          : {}),
      },
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function runProcess(spawnImpl, command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(command, args, options)
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(0)
      else rejectPromise(new Error(`installer exited with code=${String(code)}, signal=${String(signal)}`))
    })
  })
}

function unsupportedChannelMessage(source, channel) {
  if (channel === 'pinned') {
    return `This CLI is pinned to ${source.selector.value}; automatic stable-channel updates are disabled. Re-run the installer with a different selector to change channels.`
  }
  if (channel === 'custom') {
    return `This CLI was installed from ${source.installerUrl}; public stable-channel updates are disabled for custom installers. Use that installer to update without crossing trust boundaries.`
  }
  return `This CLI follows branch ${source?.selector?.value ?? 'unknown'}; stable release update checks are disabled for development channels. Re-run that branch's installer to refresh it.`
}

function isNativeDirectInstallSource(source) {
  return source?.schemaVersion === 3
    && source.method === 'direct'
    && source.artifact !== null
    && typeof source.artifact === 'object'
}

export function normalizeUpdateChannel(channel) {
  if (channel === 'stable' || channel === 'beta' || channel === 'dev') return channel
  if (channel === 'development') return 'dev'
  return null
}

function releaseChannelMatchesVersion(channel, version) {
  if (channel === 'stable') return /^\d+\.\d+\.\d+$/.test(version)
  if (channel === 'beta') return /^\d+\.\d+\.\d+-beta(?:\.[1-9][0-9]*)?$/.test(version)
  return false
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) throw new Error(`Invalid OpenAlice version: ${value}`)
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  }
}

function isVersion(value) {
  try {
    parseVersion(value)
    return true
  } catch {
    return false
  }
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1
    if (right[index] === undefined) return 1
    if (left[index] === right[index]) continue
    const leftNumeric = /^\d+$/.test(left[index])
    const rightNumeric = /^\d+$/.test(right[index])
    if (leftNumeric && rightNumeric) return Number(left[index]) > Number(right[index]) ? 1 : -1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return left[index] > right[index] ? 1 : -1
  }
  return 0
}

function cachedResult(cache, now, channel, sourceFingerprint) {
  const checkedAt = Date.parse(cache?.checkedAt ?? '')
  if (
    cache?.schemaVersion !== 1
    || cache?.channel !== channel
    || cache?.sourceFingerprint !== sourceFingerprint
    || cache?.result?.channel !== channel
    || !Number.isFinite(checkedAt)
    || now - checkedAt >= CHECK_INTERVAL_MS
  ) {
    return null
  }
  return cache.result ?? null
}

function updateSourceFingerprint(source, channel) {
  const artifact = source?.artifact?.sha256
  const selector = `${source?.selector?.kind ?? 'unknown'}:${source?.selector?.value ?? 'unknown'}`
  return [
    channel,
    source?.cliVersion ?? CURRENT_VERSION,
    artifact ?? selector,
    source?.method ?? 'legacy',
  ].join(':')
}

function updateNotificationKey(result) {
  return [
    result.channel ?? 'unknown',
    result.latestVersion ?? 'unknown',
    result.latestArtifactSha256 ?? result.latestCommit ?? 'release',
  ].join(':')
}

async function readUpdateCache(path, readFileImpl) {
  try {
    return JSON.parse(await readFileImpl(path, 'utf8'))
  } catch {
    return null
  }
}

async function writeCacheBestEffort(path, value, writeFileImpl) {
  try {
    await writeFileImpl(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  } catch {
    // Update discovery must never block OpenAlice startup.
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
