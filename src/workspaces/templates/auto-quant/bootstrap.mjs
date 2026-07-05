/**
 * Bootstrap an Auto-Quant workspace — cross-platform Node port of the old
 * `bootstrap.sh`. Runs on the Electron-bundled Node (no bash) and the bundled
 * git via `_common.mjs` (no system git / Git-for-Windows).
 *
 *   argv:  process.argv[2] = tag, process.argv[3] = outDir (absolute)
 *   env:   AQ_TEMPLATE_DIR  — optional power-user override pointing at an
 *                             existing Auto-Quant clone. If unset/invalid we
 *                             manage our own mirror clone of
 *                             https://github.com/TraderAlice/Auto-Quant under
 *                             $AQ_LAUNCHER_ROOT/auto-quant-mirror.
 *          AQ_LAUNCHER_ROOT — optional; defaults to ~/.openalice/workspaces.
 *
 * Zero-config by default: a fresh install clones the public Auto-Quant repo on
 * the first workspace creation; subsequent creations reuse the local mirror via
 * `git clone --local` (fast hardlinks; falls back to copy where the filesystem
 * doesn't support hardlinks). The launcher makes the initial commit after this
 * script. Each workspace owns its own real `user_data/data/` (not a shared
 * symlink) — Auto-Quant's data schema may evolve between releases, so a shared
 * cache would silently mix incompatible files across generations.
 */

import { existsSync, mkdirSync, rmSync, readdirSync, cpSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { setupGitExcludes, git } from '../_common.mjs'

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

// ── Resolve Auto-Quant source ───────────────────────────────────────────────
const AUTO_QUANT_UPSTREAM = 'https://github.com/TraderAlice/Auto-Quant.git'
const launcherRoot = process.env.AQ_LAUNCHER_ROOT || join(homedir(), '.openalice', 'workspaces')
const mirror = join(launcherRoot, 'auto-quant-mirror')

let source = ''
const override = process.env.AQ_TEMPLATE_DIR
if (override && existsSync(join(override, '.git'))) {
  // Power-user override: use the user's pre-existing Auto-Quant clone as-is.
  source = override
} else {
  // Default path: maintain our own mirror under the launcher root.
  if (!existsSync(join(mirror, '.git'))) {
    console.error(`[auto-quant] no local mirror at ${mirror}; cloning ${AUTO_QUANT_UPSTREAM} ...`)
    mkdirSync(dirname(mirror), { recursive: true })
    await git(['clone', '--quiet', AUTO_QUANT_UPSTREAM, mirror], dirname(mirror))
  }
  source = mirror
}

if (!existsSync(join(source, '.git'))) {
  console.error(`[auto-quant] no Auto-Quant source available at ${source}`)
  process.exit(3)
}

// ── Materialise the workspace ───────────────────────────────────────────────

// 1. local clone — hardlinks .git/objects, fast and disk-cheap. We clone only
//    for the working tree; history + remote are scrubbed below.
await git(['clone', '--local', source, outDir], dirname(outDir))

// 2. Scrub to a fresh local repo (no upstream history, no pushable remote), on
//    the autoresearch branch. A Harness is always a fresh-git workspace with a
//    clean initial commit; carrying Auto-Quant's whole history + an origin
//    pointing at the public GitHub repo violates that. The launcher makes the
//    initial commit after this script returns.
rmSync(join(outDir, '.git'), { recursive: true, force: true })
await git(['init', '-q'], outDir)
await git(['checkout', '-b', `autoresearch/${tag}`], outDir)

// Agent-config excludes — defense-in-depth: keep any later workspace-specific
// AI provider secrets out of a push to upstream Auto-Quant.
setupGitExcludes(outDir)

// 3. user_data/data is a real per-workspace directory. Auto-Quant's .gitignore
//    already excludes user_data/data/, so prepare.py's output is untracked. If
//    the SOURCE ships pre-fetched data, copy it in so the user need not re-fetch.
const wsData = join(outDir, 'user_data', 'data')
mkdirSync(wsData, { recursive: true })
const srcData = join(source, 'user_data', 'data')
if (existsSync(srcData) && readdirSync(srcData).length > 0) {
  console.error(`[auto-quant] copying pre-fetched data from ${srcData}`)
  cpSync(srcData, wsData, { recursive: true })
}

// 4. results.tsv header — the agent appends rows from here on out.
writeFileSync(join(outDir, 'results.tsv'), 'commit\tevent\tstrategy_name\tsharpe\tmax_dd\tnote\n')

// NOTE: intentionally no copyReadme here — the workspace IS an Auto-Quant clone,
// so its working tree already carries Auto-Quant's own README.md, which is the
// right one for the agent / user opening the folder.

console.log(`bootstrapped autoresearch/${tag} at ${outDir}`)
