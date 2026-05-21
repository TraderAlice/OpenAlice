/**
 * Electron main process — OpenAlice's guardian.
 *
 * Responsibilities (MVP):
 *   1. Probe free ports for backend web + MCP (starts at 47331 to dodge the
 *      crowded 3000s range; auto-fallback if taken — local user never sees
 *      "Alice can't start" for a port collision).
 *   2. Spawn the backend (`dist/main.js`) as a child process with the
 *      chosen ports injected as env (`OPENALICE_WEB_PORT` /
 *      `OPENALICE_MCP_PORT` — picked up by `src/core/config.ts`'s
 *      env override). Single source of truth lives on the env channel for
 *      spawn-time-fixed values; runtime-mutable config still flows via
 *      file-reread.
 *   3. Wait for backend HTTP readiness, then open a BrowserWindow pointed
 *      at the same port (same-origin, no CORS surface).
 *   4. On quit: SIGTERM the backend, SIGKILL after 5s if it hangs.
 *
 * Out of scope (future iterations): tray icon, auto-update, code signing,
 * graceful-shutdown UX polish, multi-window, native menu integration.
 */

import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { probeFreePort } from './probe-port.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let backend: ChildProcess | null = null
let appQuitting = false

const DEFAULT_WEB_PORT_START = 47331
const READY_TIMEOUT_MS = 30_000
const SIGTERM_GRACE_MS = 5_000

async function waitForBackendReady(port: number, timeoutMs = READY_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      // 5xx still means the server is up; only treat connect errors as not-ready.
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' })
      if (res.status < 500) return
    } catch {
      // ECONNREFUSED etc. — backend not bound yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`backend did not become ready on port ${port} within ${timeoutMs}ms`)
}

app.whenReady().then(async () => {
  const webPort = await probeFreePort(DEFAULT_WEB_PORT_START)
  const mcpPort = await probeFreePort(webPort + 1)

  // After build: electron/main.ts → dist/electron/main.js; backend bundle
  // → dist/main.js. So one level up from __dirname is the backend entry.
  const backendEntry = resolve(__dirname, '..', 'main.js')

  // Two homes — user data vs app resources. See src/core/paths.ts for why
  // they're split. Only inject in packaged builds: in dev (pnpm electron:
  // dev with app.isPackaged === false) the backend should fall back to
  // process.cwd() so contributors see their working repo state, same as
  // `pnpm dev`.
  const homeEnv = app.isPackaged
    ? {
        // ~/Library/Application Support/<productName>/ on macOS
        OPENALICE_HOME: app.getPath('userData'),
        // .app/Contents/Resources/ — sibling of app.asar
        OPENALICE_APP_HOME: dirname(app.getAppPath()),
      }
    : {}

  backend = spawn(process.execPath, [backendEntry], {
    env: {
      ...process.env,
      // CRITICAL: without this, the spawned process tries to start as
      // another Electron "main process" (opens a new app instance) rather
      // than executing the JS file as Node. `process.execPath` is the
      // Electron binary in main-process context; only this env switches
      // it to pure-Node runtime mode.
      ELECTRON_RUN_AS_NODE: '1',
      OPENALICE_WEB_PORT: String(webPort),
      OPENALICE_MCP_PORT: String(mcpPort),
      // Hint for the backend (future use): we're under Electron, not a
      // bare `node dist/main.js`. Today nothing reads this; future
      // graceful-shutdown / update-flow code can branch on it.
      OPENALICE_LAUNCHER: 'electron',
      ...homeEnv,
    },
    stdio: 'inherit',
  })

  backend.once('exit', (code, signal) => {
    console.log(`[guardian] backend exited code=${code} signal=${signal}`)
    if (!appQuitting) app.quit()
  })

  console.log(`[guardian] backend pid=${backend.pid} webPort=${webPort} mcpPort=${mcpPort}`)

  await waitForBackendReady(webPort)

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'OpenAlice',
    webPreferences: {
      preload: resolve(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadURL(`http://localhost:${webPort}/`)
})

app.on('before-quit', (e) => {
  if (appQuitting) return
  if (!backend || backend.killed || backend.exitCode !== null) return
  appQuitting = true
  e.preventDefault()
  console.log(`[guardian] SIGTERM → backend pid=${backend.pid}`)
  backend.kill('SIGTERM')
  const sigkill = setTimeout(() => {
    if (backend && !backend.killed) {
      console.warn(`[guardian] backend did not exit after ${SIGTERM_GRACE_MS}ms → SIGKILL`)
      backend.kill('SIGKILL')
    }
  }, SIGTERM_GRACE_MS)
  backend.once('exit', () => {
    clearTimeout(sigkill)
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  // MVP: quit on last-window-close everywhere (including macOS).
  // Future: tray icon + macOS "stay alive in background" semantics so the
  // user can close the window without killing in-flight cron jobs.
  app.quit()
})
