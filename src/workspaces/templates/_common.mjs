/**
 * Shared helpers for the Node workspace bootstrap scripts — the cross-platform
 * port of `_common.sh`.
 *
 * Plain ESM, run by the Electron-bundled Node or by the Bun standalone's
 * internal bootstrap role. So: NO TypeScript syntax, only `node:*` builtins
 * plus the launcher-owned dugite executor. Node resolves dugite through the
 * packaged dependency tree; the compiled Bun role injects its bundled copy.
 *
 * This is the SOLE importer of `dugite` among the templates: all git goes
 * through `git()` so workspace creation uses OpenAlice's bundled git — no
 * system git, no Git-for-Windows, no bash. Bootstrap scripts call these
 * helpers, never dugite directly (same shape as `_common.sh`'s sourced
 * helpers).
 */

import { existsSync, mkdirSync, copyFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
const injectedGitExec = globalThis.__OPENALICE_BOOTSTRAP_GIT_EXEC__
const exec = typeof injectedGitExec === 'function'
  ? injectedGitExec
  : (await import('dugite')).exec

/**
 * Run a git command via the bundled git, rooted at `cwd`. Throws on a non-zero
 * exit — dugite resolves with `exitCode` rather than throwing, and only rejects
 * when git itself fails to launch. Mirrors the launcher's `runGit` contract.
 */
export async function git(args, cwd) {
  const r = await exec(args, cwd)
  if (r.exitCode !== 0) {
    throw new Error(`git ${args[0] ?? ''} exited ${r.exitCode}: ${String(r.stderr).slice(0, 500)}`)
  }
  return r
}

/**
 * Verify `outDir` doesn't yet exist, then create it. Does NOT chdir — callers
 * build absolute paths off `outDir` (a spawned bootstrap can't rely on
 * `process.cwd()`). Exit-2 semantics of the old bash helper become a throw.
 */
export function initWorkspaceDir(outDir) {
  if (existsSync(outDir)) {
    throw new Error(`outDir already exists: ${outDir}`)
  }
  mkdirSync(outDir, { recursive: true })
}

/**
 * Copy `<templateRoot>/README.md` into the workspace root so it's self-
 * describing on disk. No-op when `templateRoot` is unset or has no README.
 * `templateRoot` defaults to `AQ_TEMPLATE_ROOT` (injected by the launcher).
 */
export function copyReadme(outDir, templateRoot = process.env.AQ_TEMPLATE_ROOT) {
  if (!templateRoot) return
  const src = join(templateRoot, 'README.md')
  if (!existsSync(src)) return
  copyFileSync(src, join(outDir, 'README.md'))
}

const DEFAULT_EXCLUDES = [
  '.claude/settings.local.json',
  '.claude/openalice-provider.json',
  '.codex/auth.json',
  '.codex/env.json',
  '.codex/config.toml',
  '.codex/openalice-provider.json',
  '.codex/openalice-home/',
  'opencode.json',
  'tui.json',
  '.opencode/openalice-provider.json',
  '.pi/settings.json',
  '.pi/openalice-provider.json',
  '.pi/extensions/openalice-provider.ts',
  // Pre-#662 compatibility: never commit an old redirected Pi agent home
  // before the runtime migration has reconciled and removed it.
  '.pi-agent/',
]

/**
 * Append defensive entries to `<outDir>/.git/info/exclude` (per-clone,
 * untracked). Most can carry a per-workspace API key; Pi's local files carry
 * provider selection, local registration, and reversible injection metadata.
 * None should reach a commit. `extra` paths are
 * appended too. Caller must have run `git init`/`clone` first (`.git/` must
 * exist).
 */
export function setupGitExcludes(outDir, ...extra) {
  if (!existsSync(join(outDir, '.git'))) {
    throw new Error(`setupGitExcludes: no .git/ in ${outDir}`)
  }
  const lines = [...DEFAULT_EXCLUDES, ...extra].join('\n') + '\n'
  appendFileSync(join(outDir, '.git', 'info', 'exclude'), lines)
}
