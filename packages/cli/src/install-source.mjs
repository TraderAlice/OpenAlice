import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

export const DEFAULT_INSTALL_SOURCE = Object.freeze({
  schemaVersion: 1,
  repository: 'TraderAlice/OpenAlice',
  cliVersion: CLI_VERSION,
  selector: Object.freeze({ kind: 'branch', value: 'master' }),
  installerUrl: 'https://openalice.ai/install',
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
  if (
    value.schemaVersion !== 1
    || repository !== 'TraderAlice/OpenAlice'
    || cliVersion.length < 1
    || !['branch', 'version'].includes(kind)
    || typeof ref !== 'string'
    || ref.length < 1
    || ref.length > 128
    || ref.includes('..')
    || !/^[A-Za-z0-9._/-]+$/.test(ref)
    || !isHttpUrl(installerUrl)
  ) {
    return null
  }
  return {
    schemaVersion: 1,
    repository,
    cliVersion,
    selector: { kind, value: ref },
    installerUrl,
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
}

export function formatInstallSelector(source) {
  const normalized = normalizeInstallSource(source)
  return `${normalized.selector.kind} ${normalized.selector.value}`
}

function cloneInstallSource(source) {
  return {
    schemaVersion: 1,
    repository: source.repository,
    cliVersion: source.cliVersion,
    selector: { ...source.selector },
    installerUrl: source.installerUrl,
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
