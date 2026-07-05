/**
 * Bootstrap a chat workspace: a bare git repo + README, nothing more.
 * Cross-platform Node port of the old `bootstrap.sh` — runs on the Electron-
 * bundled Node (no bash) and the bundled git via `_common.mjs` (no system git).
 *
 * Context injection — Alice persona into CLAUDE.md / AGENTS.md plus the per-CLI
 * skills — and the initial commit are done by the launcher AFTER this script,
 * gated by template.json flags (see context-injector.ts). This script just
 * lays down the bare workspace and inits git.
 *
 *   argv:  process.argv[2] = tag, process.argv[3] = outDir
 *   env:   AQ_TEMPLATE_ROOT — abs path to this template's root (for README)
 */

import { initWorkspaceDir, copyReadme, setupGitExcludes, git } from '../_common.mjs'

const tag = process.argv[2]
const outDir = process.argv[3]
if (!tag || !outDir) {
  console.error('usage: bootstrap.mjs <tag> <outDir>')
  process.exit(1)
}

initWorkspaceDir(outDir)
copyReadme(outDir)

await git(['init', '-q'], outDir)
setupGitExcludes(outDir)

console.log(`bootstrapped chat workspace '${tag}' at ${outDir}`)
