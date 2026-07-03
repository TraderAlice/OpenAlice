/**
 * Centralized filesystem path resolution.
 *
 * Two roots, distinguished by lifecycle owner:
 *
 *   USER_DATA_HOME    user-produced state (config, sessions, broker
 *                     git-like commits, brain files, etc.). Survives
 *                     app upgrades and reinstalls. Default: ~/.openalice —
 *                     ONE store shared by every topology (pnpm dev, pnpm
 *                     start, packaged Electron), so broker credentials and
 *                     trading state are configured once, not per checkout.
 *                     Guardians still inject OPENALICE_HOME explicitly so
 *                     parent and children never derive the root twice;
 *                     `OPENALICE_HOME=$PWD pnpm dev` pins a checkout-local
 *                     store when an experiment shouldn't touch real data.
 *                     The `data/` subtree under it is the portable part
 *                     (back up / migrate / share THAT); machine-bound
 *                     secrets like sealing.key live beside it, not in it.
 *
 *   APP_RESOURCES_HOME   files shipped with the app (default templates,
 *                        the UI bundle). Replaced wholesale on app
 *                        upgrade. In production: .app/Contents/Resources/.
 *                        In dev: unset → repo root.
 *
 * Why two homes: user data must survive .app deletion and version
 * upgrades, while app resources must be replaced cleanly on upgrade.
 * Conflating them either loses user data on upgrade or keeps stale
 * default templates around forever.
 */

import { resolve } from 'node:path'
import { homedir } from 'node:os'

/** Default user-data root when OPENALICE_HOME is unset. Shared with the
 *  workspace launcher (~/.openalice/workspaces) and the global provider-key
 *  store (~/.openalice/provider-keys.json) — one OpenAlice home. */
const DEFAULT_USER_DATA_HOME = resolve(homedir(), '.openalice')

const USER_DATA_HOME = process.env['OPENALICE_HOME'] ?? DEFAULT_USER_DATA_HOME
const APP_RESOURCES_HOME = process.env['OPENALICE_APP_HOME'] ?? process.cwd()

/** Path under `data/` — user-produced state. */
export function dataPath(...parts: string[]): string {
  return resolve(USER_DATA_HOME, 'data', ...parts)
}

/** Path under `default/` — shipped templates (persona, heartbeat, skills). */
export function defaultPath(...parts: string[]): string {
  return resolve(APP_RESOURCES_HOME, 'default', ...parts)
}

/** Path to the UI bundle root (served via Hono's serveStatic). */
export function uiBundlePath(): string {
  return resolve(APP_RESOURCES_HOME, 'ui', 'dist')
}

/**
 * Path to the workspace bootstrap templates (chat / auto-quant / etc).
 *
 * Previously resolved via `import.meta.url` from src/workspaces/config.ts,
 * which only worked under tsx because the bundled dist/main.js has
 * import.meta.url pointing at the bundle file (the templates aren't next
 * to it). Routing through APP_RESOURCES_HOME makes this work the same way
 * default/ does: dev points to repo source, packaged points to wherever
 * the bundler copied the templates inside .app/Contents/Resources/.
 *
 * `build.files` in package.json ships `src/workspaces/templates/**`, so the
 * `.mjs` bootstraps + their READMEs land in the packaged .app.
 */
export function templatesPath(): string {
  return resolve(APP_RESOURCES_HOME, 'src', 'workspaces', 'templates')
}

/**
 * Dir holding the workspace-local `alice` CLI shim, prepended to each PTY's
 * PATH so a native agent can run `alice ...` from its shell. A single shared,
 * env-driven script (it reads OPENALICE_TOOL_URL + AQ_WS_ID at runtime), so it
 * is NOT written into individual workspaces and never enters their git repos.
 *
 * Rides APP_RESOURCES_HOME exactly like templatesPath(): repo source in dev,
 * the bundler-copied location in a packaged .app. The same packaging caveat
 * applies — build.files in package.json must ship `src/workspaces/cli/**`.
 */
export function cliBinPath(): string {
  return resolve(APP_RESOURCES_HOME, 'src', 'workspaces', 'cli', 'bin')
}

/** Effective USER_DATA_HOME — exported for diagnostics / migration logic. */
export const userDataHome = USER_DATA_HOME

/** The built-in default home (~/.openalice), independent of env overrides.
 *  Used by legacy-data adoption notices to phrase "where data lives now". */
export const defaultUserDataHome = DEFAULT_USER_DATA_HOME

/** Effective APP_RESOURCES_HOME — exported for diagnostics. */
export const appResourcesHome = APP_RESOURCES_HOME
