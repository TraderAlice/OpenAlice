/**
 * Centralized filesystem path resolution.
 *
 * Two roots, distinguished by lifecycle owner:
 *
 *   USER_DATA_HOME    user-produced state (config, sessions, broker
 *                     git-like commits, brain files, etc.). Survives
 *                     app upgrades and reinstalls. In production, set by
 *                     the guardian (apps/desktop/src/main.ts) to a
 *                     platform-standard location like ~/Library/Application
 *                     Support/OpenAlice/. In dev (pnpm dev / pnpm
 *                     electron:dev), the guardian pins it to the repo
 *                     root so contributors see their working data.
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

const USER_DATA_HOME = process.env['OPENALICE_HOME'] ?? process.cwd()
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
 * NOTE: For packaged .app distribution, build.files in package.json must
 * include `src/workspaces/templates/**` (currently DOES NOT — workspace
 * spawning will fail until that's added; tracked in TODO).
 */
export function templatesPath(): string {
  return resolve(APP_RESOURCES_HOME, 'src', 'workspaces', 'templates')
}

/**
 * Dir holding the workspace-local `alice` CLI shim, prepended to each PTY's
 * PATH so a native agent can run `alice ...` from its shell. A single shared,
 * env-driven script (it reads OPENALICE_MCP_URL + AQ_WS_ID at runtime), so it
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

/** Effective APP_RESOURCES_HOME — exported for diagnostics. */
export const appResourcesHome = APP_RESOURCES_HOME
