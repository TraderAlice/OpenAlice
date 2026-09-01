import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  bunInstallSourceLocations,
  isBunStandalone,
  resolveBunContentIdentity,
  resolveBunResourceRoot,
} from './bun-standalone.mjs'

const compiledCliVersion = globalThis.__OPENALICE_BUILD_VERSION__

export const CLI_VERSION = typeof compiledCliVersion === 'string' && compiledCliVersion.length > 0
  ? compiledCliVersion
  : JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

export const DEFAULT_INSTALL_SOURCE = Object.freeze({
  schemaVersion: 2,
  repository: 'TraderAlice/OpenAlice',
  cliVersion: CLI_VERSION,
  selector: Object.freeze({ kind: 'branch', value: 'master' }),
  installerUrl: 'https://openalice.ai/install',
  updateChannel: 'stable',
})

export async function readInstallSource(options = {}) {
  const env = options.env ?? process.env
  const metadataLocations = options.metadataUrl
    ? [options.metadataUrl]
    : env['OPENALICE_INSTALL_SOURCE']
      ? [env['OPENALICE_INSTALL_SOURCE']]
      : nativeInstallSourceLocations(options, env)
  for (const metadataUrl of metadataLocations) {
    try {
      return requireInstallSource(JSON.parse(await readFile(metadataUrl, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
  }
  return cloneInstallSource(DEFAULT_INSTALL_SOURCE)
}

export function installedContentIdentity(moduleUrl = import.meta.url, options = {}) {
  const env = options.env ?? process.env
  const explicit = env['OPENALICE_CONTENT_IDENTITY']?.trim()
  if (/^[a-f0-9]{16}$/.test(explicit ?? '')) return explicit
  const bunStandalone = options.bunStandalone ?? isBunStandalone()
  if (bunStandalone) {
    return resolveBunContentIdentity(
      resolveBunResourceRoot(env, options.executable ?? process.execPath),
      env,
      options.readFileSync ?? readFileSync,
    )
  }
  const releaseDirectory = basename(dirname(dirname(fileURLToPath(moduleUrl))))
  return /-([a-f0-9]{16})$/.exec(releaseDirectory)?.[1] ?? null
}

function nativeInstallSourceLocations(options, env) {
  const bunStandalone = options.bunStandalone ?? isBunStandalone()
  if (!bunStandalone) return [new URL('../install-source.json', import.meta.url)]
  const executable = options.executable ?? process.execPath
  return bunInstallSourceLocations(
    env,
    executable,
    resolveBunResourceRoot(env, executable),
  )
}

export function normalizeInstallSource(value, fallback = DEFAULT_INSTALL_SOURCE) {
  return parseInstallSource(value) ?? cloneInstallSource(fallback)
}

export function parseInstallSource(value) {
  if (!value || typeof value !== 'object') return null
  const repository = typeof value.repository === 'string' ? value.repository : ''
  const cliVersion = typeof value.cliVersion === 'string' ? value.cliVersion : ''
  const selector = value.selector
  const kind = selector?.kind
  const ref = selector?.value
  const installerUrl = typeof value.installerUrl === 'string' ? value.installerUrl : ''
  const schemaVersion = value.schemaVersion
  const updateChannel = schemaVersion === 2 || schemaVersion === 3
    ? value.updateChannel
    : inferLegacyUpdateChannel({ selector, installerUrl })
  const method = value.method
  const artifact = value.artifact
  const installedAt = value.installedAt
  const validV3 = schemaVersion !== 3 || (
    ['direct', 'npm', 'bun', 'brew', 'aur'].includes(method)
    && artifact
    && typeof artifact === 'object'
    && ['darwin', 'linux'].includes(artifact.platform)
    && ['arm64', 'x64'].includes(artifact.arch)
    && typeof artifact.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(artifact.sha256)
    && typeof installedAt === 'string'
    && Number.isFinite(Date.parse(installedAt))
  )
  if (
    ![1, 2, 3].includes(schemaVersion)
    || repository !== 'TraderAlice/OpenAlice'
    || cliVersion.length < 1
    || !['branch', 'version'].includes(kind)
    || typeof ref !== 'string'
    || ref.length < 1
    || ref.length > 128
    || ref.includes('..')
    || !/^[A-Za-z0-9._/-]+$/.test(ref)
    || !isHttpUrl(installerUrl)
    || !['stable', 'beta', 'pinned', 'development', 'custom'].includes(updateChannel)
    || !validV3
  ) {
    return null
  }
  return {
    schemaVersion,
    repository,
    cliVersion,
    selector: { kind, value: ref },
    installerUrl,
    ...(schemaVersion >= 2 ? { updateChannel } : {}),
    ...(schemaVersion === 3 ? {
      method,
      artifact: {
        platform: artifact.platform,
        arch: artifact.arch,
        sha256: artifact.sha256,
      },
      installedAt,
    } : {}),
  }
}

export function requireInstallSource(value) {
  const parsed = parseInstallSource(value)
  if (!parsed) throw new Error('OpenAlice install-source metadata is invalid')
  return parsed
}

export function installSourcesMatch(left, right) {
  const normalizedLeft = parseInstallSource(left)
  const normalizedRight = parseInstallSource(right)
  if (!normalizedLeft || !normalizedRight) return false
  return normalizedLeft.repository === normalizedRight.repository
    && normalizedLeft.cliVersion === normalizedRight.cliVersion
    && normalizedLeft.selector.kind === normalizedRight.selector.kind
    && normalizedLeft.selector.value === normalizedRight.selector.value
    && normalizedLeft.installerUrl === normalizedRight.installerUrl
    && installSourceUpdateChannel(normalizedLeft) === installSourceUpdateChannel(normalizedRight)
}

export function installSourceUpdateChannel(source) {
  const normalized = requireInstallSource(source)
  return normalized.schemaVersion >= 2
    ? normalized.updateChannel
    : inferLegacyUpdateChannel(normalized)
}

export function formatInstallSelector(source) {
  const normalized = normalizeInstallSource(source)
  return `${normalized.selector.kind} ${normalized.selector.value}`
}

export function managedSourceKey(source) {
  const normalized = requireInstallSource(source)
  const readable = `${normalized.selector.kind}-${normalized.selector.value}`
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 48) || 'source'
  const digest = createHash('sha256')
    .update(`${normalized.selector.kind}:${normalized.selector.value}`)
    .digest('hex')
    .slice(0, 8)
  return `${readable}-${digest}`
}

function cloneInstallSource(source) {
  return {
    schemaVersion: source.schemaVersion,
    repository: source.repository,
    cliVersion: source.cliVersion,
    selector: { ...source.selector },
    installerUrl: source.installerUrl,
    ...(source.schemaVersion >= 2 ? { updateChannel: source.updateChannel } : {}),
    ...(source.schemaVersion === 3 && source.method ? { method: source.method } : {}),
    ...(source.schemaVersion === 3 && source.artifact ? { artifact: { ...source.artifact } } : {}),
    ...(source.schemaVersion === 3 && source.installedAt ? { installedAt: source.installedAt } : {}),
  }
}

function inferLegacyUpdateChannel(source) {
  if (source?.selector?.kind === 'version') return 'pinned'
  if (
    source?.selector?.kind === 'branch'
    && source.selector.value === 'master'
    && source.installerUrl === 'https://openalice.ai/install'
  ) {
    return 'stable'
  }
  if (source?.selector?.kind === 'branch' && source.selector.value === 'master') return 'custom'
  return 'development'
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
