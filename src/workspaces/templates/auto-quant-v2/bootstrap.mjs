/**
 * Materialize one exact AutoQuant V2 release as an OpenAlice Workspace.
 *
 * OpenAlice supplies the approved repository/version/commit through the
 * template-source contract. The upstream tree is verified before it is copied,
 * then the resulting desk keeps that upstream history and canonical remote.
 * OpenAlice creates a local research branch at the approved commit so the
 * Coding Agent can later fetch and merge another approved AutoQuant release.
 *
 * Dependency installation is intentionally absent. AutoQuant's Coding Agent
 * owns `uv`/Python setup and every later research commit inside the desk.
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
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
  console.error('AutoQuant V2 requires an approved repository, version, and full commit')
  process.exit(3)
}

const launcherRoot = process.env.AQ_LAUNCHER_ROOT
  || join(homedir(), '.openalice', 'workspaces')
const mirror = join(launcherRoot, 'auto-quant-v2-mirror')
const override = process.env.AQ_TEMPLATE_DIR
let source

if (override && existsSync(join(override, '.git'))) {
  source = override
} else {
  if (!existsSync(join(mirror, '.git'))) {
    console.error(`[auto-quant-v2] cloning ${repository} at ${mirror}`)
    mkdirSync(dirname(mirror), { recursive: true })
    await git(['clone', '--quiet', repository, mirror], dirname(mirror))
  } else {
    console.error(`[auto-quant-v2] refreshing approved release refs in ${mirror}`)
    await git(['fetch', '--quiet', '--tags', '--prune', 'origin'], mirror)
  }
  source = mirror
}

const resolved = (await git(['rev-parse', `${version}^{commit}`], source)).stdout.trim().toLowerCase()
if (resolved !== commit) {
  console.error(
    `[auto-quant-v2] ${version} resolved to ${resolved || 'nothing'}, expected ${commit}`,
  )
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
    template: 'auto-quant-v2',
    repository,
    version,
    commit,
  }, null, 2)}\n`,
)

console.log(`bootstrapped AutoQuant V2 ${version} (${commit.slice(0, 12)}) at ${outDir}`)
