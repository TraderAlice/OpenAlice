#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const suffix = `${process.pid}-${Date.now().toString(36)}`
const image = `openalice-install-channel-smoke:${suffix}`
const args = process.argv.slice(2)
const keepImage = args.includes('--keep-image')
const installerUrl = optionValue('--installer-url')
  ?? 'https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install'
const branch = optionValue('--branch') ?? 'dev'
let imageBuilt = false

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: pnpm test:install:dev-channel [--installer-url <url>] [--branch <name>] [--keep-image]

Build a clean container, download the installer from the live dev channel, and
install the matching branch through the real network path. The default pair is
raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install plus --branch dev.

Options:
  --installer-url <url>  Installer endpoint to exercise
  --branch <name>        Matching payload branch (default: dev)
  --keep-image           Preserve the temporary image for investigation
  -h, --help             Show this help
`)
  process.exit(0)
}

const valuedOptions = new Set(['--installer-url', '--branch'])
const flagOptions = new Set(['--keep-image'])
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (valuedOptions.has(arg)) {
    if (!args[index + 1] || args[index + 1].startsWith('--')) {
      console.error(`install channel smoke: ${arg} requires a value`)
      process.exit(1)
    }
    index += 1
    continue
  }
  if (!flagOptions.has(arg)) {
    console.error(`install channel smoke: unknown option: ${arg}`)
    process.exit(1)
  }
}

if (!/^https:\/\//.test(installerUrl)) {
  console.error('install channel smoke: --installer-url must use https://')
  process.exit(1)
}
if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('/') || branch.endsWith('/')) {
  console.error('install channel smoke: --branch is invalid')
  process.exit(1)
}

function optionValue(option) {
  const index = args.indexOf(option)
  return index === -1 ? null : args[index + 1]
}

function docker(dockerArgs, { allowFailure = false } = {}) {
  const result = spawnSync('docker', dockerArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`docker ${dockerArgs[0]} failed (${result.status ?? result.signal ?? 'unknown'})`)
  }
}

try {
  console.log(`[install-channel-smoke] building ${image}`)
  docker([
    'build',
    '--file', 'scripts/install-channel-smoke/Dockerfile',
    '--tag', image,
    '.',
  ])
  imageBuilt = true

  console.log(`[install-channel-smoke] exercising ${installerUrl} with branch ${branch}`)
  docker([
    'run', '--rm',
    '--env', `OPENALICE_CHANNEL_INSTALLER_URL=${installerUrl}`,
    '--env', `OPENALICE_CHANNEL_BRANCH=${branch}`,
    image,
  ])
} catch (error) {
  console.error(`[install-channel-smoke] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (keepImage && imageBuilt) {
    console.log(`[install-channel-smoke] kept image ${image}`)
  } else if (imageBuilt) {
    docker(['image', 'rm', '--force', image], { allowFailure: true })
  }
}
