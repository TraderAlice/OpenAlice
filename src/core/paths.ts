/**
 * Centralized filesystem path resolution.
 *
 * Two roots, distinguished by lifecycle owner:
 *
 *   USER_DATA_HOME    user-produced state (config, sessions, broker
 *                     git-like commits, brain files, etc.). Survives
 *                     app upgrades and reinstalls. In production, set by
 *                     the guardian (electron/main.ts) to a platform-
 *                     standard location like ~/Library/Application
 *                     Support/OpenAlice/. In dev (pnpm dev / pnpm
 *                     electron:dev), unset → falls back to repo root
 *                     so contributors see their working data.
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

/** Effective USER_DATA_HOME — exported for diagnostics / migration logic. */
export const userDataHome = USER_DATA_HOME

/** Effective APP_RESOURCES_HOME — exported for diagnostics. */
export const appResourcesHome = APP_RESOURCES_HOME
