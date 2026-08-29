#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export const LINUXBREW_IMAGES = Object.freeze({
  arm64: {
    platform: 'linux/arm64',
    image: 'ghcr.io/homebrew/brew@sha256:bfeda232fd598c5b445ef75dc05b828c1037e50b4fdade546714280a2cb5c7c2',
  },
  x64: {
    platform: 'linux/amd64',
    image: 'ghcr.io/homebrew/brew@sha256:1c42d9bcdb1ff1a017dca941a87c041e5b7a20c6f75ba022c367bd838865f6b7',
  },
})

export function runLinuxbrewSmoke(options) {
  const target = LINUXBREW_IMAGES[options.arch]
  if (!target) throw new Error(`unsupported Linuxbrew architecture: ${options.arch}`)
  const previousPackage = containerPath(options.previousPackage)
  const currentPackage = containerPath(options.currentPackage)
  const command = [
    'sudo apt-get update -qq',
    'sudo apt-get install -y -qq nodejs >/dev/null',
    [
      'exec /usr/bin/node /work/scripts/cli-system-package-manager-smoke.mjs',
      '--manager brew',
      '--previous-version "$PREVIOUS_VERSION"',
      '--current-version "$CURRENT_VERSION"',
      '--previous-content-identity "$PREVIOUS_CONTENT_IDENTITY"',
      '--current-content-identity "$CURRENT_CONTENT_IDENTITY"',
      '--previous-package "$PREVIOUS_PACKAGE"',
      '--current-package "$CURRENT_PACKAGE"',
      '--brew /home/linuxbrew/.linuxbrew/bin/brew',
    ].join(' '),
  ].join(' && ')
  const args = [
    'run', '--rm',
    '--platform', target.platform,
    '--env', `PREVIOUS_VERSION=${options.previousVersion}`,
    '--env', `CURRENT_VERSION=${options.currentVersion}`,
    '--env', `PREVIOUS_CONTENT_IDENTITY=${options.previousContentIdentity}`,
    '--env', `CURRENT_CONTENT_IDENTITY=${options.currentContentIdentity}`,
    '--env', `PREVIOUS_PACKAGE=${previousPackage}`,
    '--env', `CURRENT_PACKAGE=${currentPackage}`,
    '--volume', `${repositoryRoot}:/work:ro`,
    target.image,
    'bash', '-lc', command,
  ]
  const result = spawnSync(options.docker, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    timeout: 15 * 60_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Linuxbrew lifecycle smoke failed (${result.status})`)
}

export function parseArgs(argv) {
  const result = { docker: 'docker' }
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (![
      '--arch', '--previous-version', '--current-version',
      '--previous-content-identity', '--current-content-identity',
      '--previous-package', '--current-package', '--docker',
    ].includes(name) || !value) {
      throw new Error(usage())
    }
    result[name.slice(2).replaceAll('-', '')] = value
  }
  if (!['arm64', 'x64'].includes(result.arch)) throw new Error('--arch must be arm64 or x64')
  for (const field of [
    'previousversion', 'currentversion', 'previouscontentidentity',
    'currentcontentidentity', 'previouspackage', 'currentpackage',
  ]) {
    if (!result[field]) throw new Error(`missing required Linuxbrew option: ${field}`)
  }
  for (const field of ['previousversion', 'currentversion']) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(result[field])) {
      throw new Error(`invalid OpenAlice version: ${result[field]}`)
    }
  }
  for (const field of ['previouscontentidentity', 'currentcontentidentity']) {
    if (!/^[a-f0-9]{16}$/.test(result[field])) throw new Error(`invalid content identity: ${result[field]}`)
  }
  return {
    arch: result.arch,
    previousVersion: result.previousversion,
    currentVersion: result.currentversion,
    previousContentIdentity: result.previouscontentidentity,
    currentContentIdentity: result.currentcontentidentity,
    previousPackage: result.previouspackage,
    currentPackage: result.currentpackage,
    docker: result.docker,
  }
}

function containerPath(input) {
  const absolute = resolve(repositoryRoot, input)
  const local = relative(repositoryRoot, absolute)
  if (!local || local === '..' || local.startsWith(`..${sep}`) || !existsSync(absolute)) {
    throw new Error(`Linuxbrew package must exist inside the repository: ${input}`)
  }
  return `/work/${local.split(sep).join('/')}`
}

function usage() {
  return 'Usage: cli-linuxbrew-smoke.mjs --arch <arm64|x64> --previous-version <version> --current-version <version> --previous-content-identity <hash> --current-content-identity <hash> --previous-package <formula> --current-package <formula> [--docker <command>]'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runLinuxbrewSmoke(parseArgs(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`Linuxbrew smoke: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
