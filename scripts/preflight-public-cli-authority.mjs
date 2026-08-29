#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const NPM_PACKAGE_NAMES = Object.freeze([
  'openalice',
  'openalice-darwin-arm64',
  'openalice-darwin-x64',
  'openalice-linux-arm64',
  'openalice-linux-x64',
])

const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'
const DEFAULT_TAP_API = 'https://api.github.com/repos/TraderAlice/homebrew-tap'
const DEFAULT_AUR_REPOSITORY = 'ssh://aur@aur.archlinux.org/openalice-bin.git'

export async function preflightPublicCliAuthority({
  env = process.env,
  fetchImpl = fetch,
  verifyAur = verifyAurRepository,
  logger = console,
} = {}) {
  const enabled = {
    npm: env.OPENALICE_PUBLISH_NPM === 'true',
    homebrew: env.OPENALICE_PUBLISH_HOMEBREW === 'true',
    aur: env.OPENALICE_PUBLISH_AUR === 'true',
  }
  const selected = Object.entries(enabled).filter(([, value]) => value).map(([name]) => name)
  if (selected.length === 0) {
    logger.log('[public-cli-authority] no external CLI channels are enabled')
    return { enabled: selected, npmUsername: null }
  }

  const failures = []
  let npmUsername = null

  if (enabled.npm) {
    try {
      npmUsername = await verifyNpmAuthority({ env, fetchImpl })
      logger.log(`[public-cli-authority] npm authority verified for ${npmUsername}`)
    } catch (error) {
      failures.push(message(error))
    }
  }

  if (enabled.homebrew) {
    try {
      await verifyHomebrewAuthority({ env, fetchImpl })
      logger.log('[public-cli-authority] Homebrew tap write authority verified')
    } catch (error) {
      failures.push(message(error))
    }
  }

  if (enabled.aur) {
    try {
      requireSecret(env, 'AUR_SSH_PRIVATE_KEY', 'AUR publication')
      requireSecret(env, 'AUR_KNOWN_HOSTS', 'AUR publication')
      await verifyAur({ env })
      logger.log('[public-cli-authority] AUR repository authority verified')
    } catch (error) {
      failures.push(message(error))
    }
  }

  if (failures.length > 0) {
    throw new Error(`public CLI channel authority preflight failed:\n- ${failures.join('\n- ')}`)
  }

  return { enabled: selected, npmUsername }
}

async function verifyNpmAuthority({ env, fetchImpl }) {
  const token = requireSecret(env, 'NPM_TOKEN', 'npm publication')
  const registry = trimTrailingSlash(env.OPENALICE_NPM_REGISTRY_URL || DEFAULT_NPM_REGISTRY)
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  }
  const whoami = await fetchJson(fetchImpl, `${registry}/-/whoami`, { headers }, 'npm token identity')
  const username = typeof whoami.username === 'string' ? whoami.username.trim() : ''
  if (!username) throw new Error('npm token identity did not return a username')

  for (const packageName of NPM_PACKAGE_NAMES) {
    const metadata = await fetchJson(
      fetchImpl,
      `${registry}/${encodeURIComponent(packageName)}`,
      { headers },
      `npm package ${packageName}`,
      `npm package name ${packageName} is not reserved`,
    )
    const maintainers = Array.isArray(metadata.maintainers)
      ? metadata.maintainers.map((entry) => typeof entry?.name === 'string' ? entry.name : '')
      : []
    if (!maintainers.includes(username)) {
      throw new Error(`npm token identity ${username} is not a maintainer of ${packageName}`)
    }
  }

  return username
}

async function verifyHomebrewAuthority({ env, fetchImpl }) {
  const token = requireSecret(env, 'HOMEBREW_TAP_TOKEN', 'Homebrew publication')
  const endpoint = env.OPENALICE_HOMEBREW_REPOSITORY_API || DEFAULT_TAP_API
  const repository = await fetchJson(
    fetchImpl,
    endpoint,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    },
    'TraderAlice/homebrew-tap repository',
    'TraderAlice/homebrew-tap does not exist or is not visible to HOMEBREW_TAP_TOKEN',
  )
  if (repository.permissions?.push !== true) {
    throw new Error('HOMEBREW_TAP_TOKEN does not have push authority for TraderAlice/homebrew-tap')
  }
}

export function verifyAurRepository({ env }) {
  const key = requireSecret(env, 'AUR_SSH_PRIVATE_KEY', 'AUR publication')
  const knownHosts = requireSecret(env, 'AUR_KNOWN_HOSTS', 'AUR publication')
  const repository = env.OPENALICE_AUR_REPOSITORY || DEFAULT_AUR_REPOSITORY
  const root = mkdtempSync(join(tmpdir(), 'openalice-aur-preflight-'))
  const keyPath = join(root, 'id_ed25519')
  const knownHostsPath = join(root, 'known_hosts')
  try {
    writeFileSync(keyPath, `${key.trim()}\n`, { mode: 0o600 })
    writeFileSync(knownHostsPath, `${knownHosts.trim()}\n`, { mode: 0o600 })
    const result = spawnSync('git', ['ls-remote', repository], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: [
          'ssh',
          '-o', 'BatchMode=yes',
          '-o', 'IdentitiesOnly=yes',
          '-o', 'StrictHostKeyChecking=yes',
          '-o', `UserKnownHostsFile=${knownHostsPath}`,
          '-i', keyPath,
        ].join(' '),
      },
      timeout: 30_000,
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      const detail = result.stderr.trim().split('\n').at(-1) || `git exited ${result.status}`
      throw new Error(`AUR_SSH_PRIVATE_KEY cannot read ${repository}: ${detail}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function fetchJson(fetchImpl, url, options, label, notFoundMessage) {
  const response = await fetchImpl(url, options)
  if (!response.ok) {
    if (response.status === 404 && notFoundMessage) throw new Error(notFoundMessage)
    throw new Error(`${label} request failed with HTTP ${response.status}`)
  }
  try {
    return await response.json()
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
}

function requireSecret(env, name, purpose) {
  const value = typeof env[name] === 'string' ? env[name].trim() : ''
  if (!value) throw new Error(`${purpose} is enabled but ${name} is missing`)
  return value
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preflightPublicCliAuthority().catch((error) => {
    console.error(message(error))
    process.exitCode = 1
  })
}
