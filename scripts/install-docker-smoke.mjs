#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const suffix = `${process.pid}-${Date.now().toString(36)}`
const image = `openalice-install-smoke:${suffix}`
const args = process.argv.slice(2)
const keepImage = args.includes('--keep-image')
let imageBuilt = false

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: pnpm test:install:docker [--keep-image]

Build a clean local container and execute the OpenAlice curl installer through
its real HTTP download path. The smoke is a manual pre-release gate and is not
wired into PR CI.

Options:
  --keep-image  Preserve the temporary image for investigation
  -h, --help    Show this help
`)
  process.exit(0)
}

const unknownArgs = args.filter((arg) => arg !== '--keep-image')
if (unknownArgs.length > 0) {
  console.error(`install docker smoke: unknown option: ${unknownArgs[0]}`)
  process.exit(1)
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
  return result.status === 0
}

try {
  console.log(`[install-docker-smoke] building ${image}`)
  docker([
    'build',
    '--file', 'scripts/install-smoke/Dockerfile',
    '--tag', image,
    '.',
  ])
  imageBuilt = true
  console.log('[install-docker-smoke] running clean installer acceptance')
  docker(['run', '--rm', '--network', 'none', image])
} catch (error) {
  console.error(`[install-docker-smoke] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (keepImage && imageBuilt) {
    console.log(`[install-docker-smoke] kept image ${image}`)
  } else if (imageBuilt) {
    docker(['image', 'rm', '--force', image], { allowFailure: true })
  }
}
