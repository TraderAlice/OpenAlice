import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

export const DEFAULT_INSTALL_SOURCE = Object.freeze({
  schemaVersion: 2,
  repository: 'TraderAlice/OpenAlice',
  cliVersion: CLI_VERSION,
  selector: Object.freeze({ kind: 'branch', value: 'master' }),
  installerUrl: 'https://openalice.ai/install',
  updateChannel: 'stable',
})

export async function readInstallSource(options = {}) {
  const metadataUrl = options.metadataUrl ?? new URL('../install-source.json', import.meta.url)
  try {
    return requireInstallSource(JSON.parse(await readFile(metadataUrl, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return cloneInstallSource(DEFAULT_INSTALL_SOURCE)
    throw error
  }
}

export function installedContentIdentity(moduleUrl = import.meta.url) {
  const releaseDirectory = basename(dirname(dirname(fileURLToPath(moduleUrl))))
  return /-([a-f0-9]{16})$/.exec(releaseDirectory)?.[1] ?? null
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
  const updateChannel = schemaVersion === 2
    ? value.updateChannel
    : inferLegacyUpdateChannel({ selector, installerUrl })
  if (
    ![1, 2].includes(schemaVersion)
    || repository !== 'TraderAlice/OpenAlice'
    || cliVersion.length < 1
    || !['branch', 'version'].includes(kind)
    || typeof ref !== 'string'
    || ref.length < 1
    || ref.length > 128
    || ref.includes('..')
    || !/^[A-Za-z0-9._/-]+$/.test(ref)
    || !isHttpUrl(installerUrl)
    || !['stable', 'pinned', 'development', 'custom'].includes(updateChannel)
  ) {
    return null
  }
  return {
    schemaVersion,
    repository,
    cliVersion,
    selector: { kind, value: ref },
    installerUrl,
    ...(schemaVersion === 2 ? { updateChannel } : {}),
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
  return normalized.schemaVersion === 2
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
    ...(source.schemaVersion === 2 ? { updateChannel: source.updateChannel } : {}),
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
