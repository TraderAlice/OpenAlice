import { getProductVersion } from '@traderalice/update-lifecycle/node'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseInstallSource, requireInstallSource, installSourceUpdateChannel, releaseChannelMatchesVersion, releaseChannelForVersion } from '@traderalice/update-lifecycle'
export { parseInstallSource, requireInstallSource, installSourceUpdateChannel } from '@traderalice/update-lifecycle'

import {
  bunInstallSourceLocations,
  isBunStandalone,
  resolveBunContentIdentity,
  resolveBunResourceRoot,
} from './bun-standalone.mjs'

export const CLI_VERSION = getProductVersion()

const SOURCE_INSTALL_SOURCE = Object.freeze({
  schemaVersion: 2,
  repository: 'TraderAlice/OpenAlice',
  cliVersion: CLI_VERSION,
  selector: Object.freeze({ kind: 'branch', value: 'dev' }),
  installerUrl: 'https://openalice.ai/install',
  updateChannel: 'development',
})

export function installSourceChannelVersionError(source) {
  const normalized = requireInstallSource(source)
  const channel = installSourceUpdateChannel(normalized)
  if (channel === 'stable' && !releaseChannelMatchesVersion('stable', normalized.cliVersion)) {
    return `CLI ${normalized.cliVersion} is marked stable, but the installer requires a stable version. Refresh this client's install-source metadata before upgrading a remote Machine.`
  }
  if (channel === 'beta' && !releaseChannelMatchesVersion('beta', normalized.cliVersion)) {
    return `CLI ${normalized.cliVersion} is marked beta, but the installer requires a beta version. Refresh this client's install-source metadata before upgrading a remote Machine.`
  }
  return null
}

export async function readInstallSource(options = {}) {
  const env = options.env ?? process.env
  const standalone = options.bunStandalone ?? isBunStandalone()
  const profile = standalone ? undefined : env.OPENALICE_RUNTIME_PROFILE || env.OPENALICE_LAUNCHER
  if (profile === 'electron-packaged') {
    return { ...SOURCE_INSTALL_SOURCE, selector: { kind: 'version', value: `v${CLI_VERSION}` },
      updateChannel: releaseChannelForVersion(CLI_VERSION) ?? 'custom' }
  }
  if (['dev', 'electron-dev', 'electron'].includes(profile)) {
    return { ...SOURCE_INSTALL_SOURCE, selector: { ...SOURCE_INSTALL_SOURCE.selector } }
  }
  const metadataLocations = options.metadataUrl
    ? [options.metadataUrl]
    : env['OPENALICE_INSTALL_SOURCE']
      ? [env['OPENALICE_INSTALL_SOURCE']]
      : nativeInstallSourceLocations(options, env)
  for (const metadataUrl of metadataLocations) {
    try {
      return requireInstallSource(JSON.parse(await readFile(metadataUrl, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT' && !options.metadataUrl && !env['OPENALICE_INSTALL_SOURCE']) continue
      throw error
    }
  }
  if (standalone) return null
  return { ...SOURCE_INSTALL_SOURCE, selector: { ...SOURCE_INSTALL_SOURCE.selector } }
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

export function formatInstallSelector(source) {
  const normalized = requireInstallSource(source)
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
