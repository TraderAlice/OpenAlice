import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveInstalledLayout } from './install-layout.mjs'
import { installSourceUpdateChannel, readInstallSource } from './install-source.mjs'

const CURRENT_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version
const DEFAULT_MANIFEST_URL = 'https://download.openalice.ai/manifest.json'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000
const CHECK_TIMEOUT_MS = 1_500
const EXPLICIT_CHECK_TIMEOUT_MS = 10_000
const INSTALLER_DOWNLOAD_TIMEOUT_MS = 30_000

export function parseUpdateArgs(argv) {
  const options = { checkOnly: false, yes: false, json: false }
  for (const arg of argv) {
    if (arg === '--check') options.checkOnly = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else if (arg === '--json') options.json = true
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
  )()
  const channel = installSourceUpdateChannel(installSource)
  if (channel !== 'stable') {
    return {
      status: 'unsupported',
      currentVersion,
      channel,
      message: unsupportedChannelMessage(installSource, channel),
    }
  }

  const manifest = await fetchReleaseManifest({
    manifestUrl: options.manifestUrl
      ?? dependencies.env?.['OPENALICE_UPDATE_MANIFEST_URL']
      ?? process.env['OPENALICE_UPDATE_MANIFEST_URL']
      ?? DEFAULT_MANIFEST_URL,
    timeoutMs: options.timeoutMs ?? EXPLICIT_CHECK_TIMEOUT_MS,
  }, dependencies)
  const comparison = compareVersions(manifest.version, currentVersion)
  return {
    status: comparison > 0 ? 'available' : 'current',
    currentVersion,
    latestVersion: manifest.version,
    releaseNotesUrl: manifest.releaseNotesUrl,
    installer: manifest.installer,
    channel,
  }
}

export async function runUpdateCommand(argv, dependencies = {}) {
  const options = parseUpdateArgs(argv)
  const stdout = dependencies.stdout ?? process.stdout
  let result
  try {
    result = await checkForUpdate({}, dependencies)
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
    stdout.write(`OpenAlice ${result.currentVersion} is current.\n`)
    return 0
  }

  stdout.write(`OpenAlice ${result.latestVersion} is available (current ${result.currentVersion}).\n`)
  if (result.releaseNotesUrl) stdout.write(`Release notes: ${result.releaseNotesUrl}\n`)
  if (options.checkOnly) {
    stdout.write('Run "openalice update" to review and install it.\n')
    return 0
  }

  const layout = Object.hasOwn(dependencies, 'layout')
    ? dependencies.layout
    : resolveInstalledLayout(import.meta.url)
  if (!layout) {
    throw new Error('This OpenAlice CLI is running from source, not an installed release. Re-run the public installer to update the installed command.')
  }
  const applyUpdate = dependencies.applyUpdate ?? downloadAndRunInstaller
  return await applyUpdate(result, {
    layout,
    yes: options.yes,
    env: dependencies.env ?? process.env,
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
    : resolveInstalledLayout(import.meta.url)
  if (!layout) return null

  const readFileImpl = dependencies.readFileImpl ?? readFile
  const writeFileImpl = dependencies.writeFileImpl ?? writeFile
  const now = dependencies.now?.() ?? Date.now()
  let cache = await readUpdateCache(layout.updateCachePath, readFileImpl)
  let result = cachedResult(cache, now)

  if (!result) {
    try {
      result = await checkForUpdate({ timeoutMs: CHECK_TIMEOUT_MS }, dependencies)
      cache = {
        schemaVersion: 1,
        checkedAt: new Date(now).toISOString(),
        result,
        notifiedAt: cache?.notifiedAt ?? null,
        notifiedVersion: cache?.notifiedVersion ?? null,
      }
    } catch {
      cache = {
        schemaVersion: 1,
        checkedAt: new Date(now).toISOString(),
        result: null,
        notifiedAt: cache?.notifiedAt ?? null,
        notifiedVersion: cache?.notifiedVersion ?? null,
      }
      await writeCacheBestEffort(layout.updateCachePath, cache, writeFileImpl)
      return null
    }
  }

  if (result.status !== 'available') {
    await writeCacheBestEffort(layout.updateCachePath, cache, writeFileImpl)
    return result
  }
  const lastNotified = Date.parse(cache?.notifiedAt ?? '')
  const alreadyRecent = cache?.notifiedVersion === result.latestVersion
    && Number.isFinite(lastNotified)
    && now - lastNotified < CHECK_INTERVAL_MS
  if (!alreadyRecent) {
    stderr.write(
      `\nOpenAlice ${result.latestVersion} is available (current ${result.currentVersion}). `
      + 'Run "openalice update" to review and install it.\n\n',
    )
    cache.notifiedAt = new Date(now).toISOString()
    cache.notifiedVersion = result.latestVersion
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
  openalice update --check [--json]
  openalice update [--yes]

Checks the stable release manifest. Applying an update downloads the
release-owned installer, verifies its SHA-256, and runs the ordinary atomic
installer transaction for this install root.

Options:
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
  const installer = value?.installer
  if (
    !value
    || typeof value.version !== 'string'
    || !isVersion(value.version)
    || typeof value.releaseNotesUrl !== 'string'
    || !isHttpUrl(value.releaseNotesUrl)
    || !installer
    || typeof installer.url !== 'string'
    || !isHttpUrl(installer.url)
    || typeof installer.versionedUrl !== 'string'
    || !isHttpUrl(installer.versionedUrl)
    || typeof installer.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(installer.sha256)
  ) {
    throw new Error('release manifest does not contain a valid CLI installer')
  }
  return {
    version: value.version,
    releaseNotesUrl: value.releaseNotesUrl,
    installer: {
      url: installer.url,
      versionedUrl: installer.versionedUrl,
      sha256: installer.sha256,
    },
  }
}

export async function downloadAndRunInstaller(result, context) {
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
    const args = [
      installerPath,
      '--install-dir', context.layout.installRoot,
      '--no-modify-path',
      ...(context.yes ? ['--yes'] : []),
    ]
    return await runProcess(context.spawnImpl ?? spawn, 'bash', args, {
      stdio: 'inherit',
      env: {
        ...context.env,
        OPENALICE_EXPECTED_CLI_VERSION: result.latestVersion,
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

function cachedResult(cache, now) {
  const checkedAt = Date.parse(cache?.checkedAt ?? '')
  if (
    cache?.schemaVersion !== 1
    || !Number.isFinite(checkedAt)
    || now - checkedAt >= CHECK_INTERVAL_MS
  ) {
    return null
  }
  return cache.result ?? null
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
