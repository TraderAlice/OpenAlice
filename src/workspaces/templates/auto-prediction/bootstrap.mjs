/**
 * Materialize one exact Auto Prediction snapshot as an OpenAlice Workspace.
 *
 * OpenAlice verifies the launcher-approved repository/version/commit tuple,
 * retains upstream ancestry, and starts a local research branch. Dependency
 * preparation and every later repository change remain owned by the Coding
 * Agent working inside the desk.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { git, setupGitExcludes } from '../_common.mjs'

const tag = process.argv[2]
const outDir = process.argv[3]
if (!tag || !outDir) {
  console.error('usage: bootstrap.mjs <tag> <outDir>')
  process.exit(1)
}
if (existsSync(outDir)) {
  console.error(`outDir already exists: ${outDir}`)
  process.exit(2)
}

const repository = process.env.OPENALICE_TEMPLATE_SOURCE_REPOSITORY
const version = process.env.OPENALICE_TEMPLATE_SOURCE_VERSION
const commit = process.env.OPENALICE_TEMPLATE_SOURCE_COMMIT?.toLowerCase()
if (!repository || !version || !commit || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error('Auto Prediction requires an approved repository, version, and full commit')
  process.exit(3)
}

const launcherRoot = process.env.AQ_LAUNCHER_ROOT
  || join(homedir(), '.openalice', 'workspaces')
const mirror = join(launcherRoot, 'auto-prediction-mirror')
const override = process.env.AUTO_PREDICTION_TEMPLATE_DIR
let source

if (override && existsSync(join(override, '.git'))) {
  source = override
} else {
  if (!existsSync(join(mirror, '.git'))) {
    console.error(`[auto-prediction] cloning ${repository} at ${mirror}`)
    mkdirSync(dirname(mirror), { recursive: true })
    await git(['clone', '--quiet', repository, mirror], dirname(mirror))
  } else {
    console.error('[auto-prediction] refreshing approved source refs')
    await git(['fetch', '--quiet', '--tags', '--prune', 'origin'], mirror)
  }
  source = mirror
}

const resolved = (await git(['rev-parse', `${commit}^{commit}`], source)).stdout.trim().toLowerCase()
if (resolved !== commit) {
  console.error(`[auto-prediction] ${version} resolved to ${resolved || 'nothing'}, expected ${commit}`)
  process.exit(4)
}

await git(['clone', '--quiet', '--local', '--no-checkout', source, outDir], dirname(outDir))
await git(['remote', 'set-url', 'origin', repository], outDir)
await git(['checkout', '--quiet', '-b', `research/${tag}`, commit], outDir)
setupGitExcludes(outDir)

const receiptDir = join(outDir, '.alice')
mkdirSync(receiptDir, { recursive: true })
writeFileSync(
  join(receiptDir, 'harness-source.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    template: 'auto-prediction',
    repository,
    version,
    commit,
  }, null, 2)}\n`,
)

console.log(`bootstrapped Auto Prediction ${version} (${commit.slice(0, 12)}) at ${outDir}`)
