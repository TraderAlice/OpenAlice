/**
 * Electron main process — OpenAlice's desktop guardian.
 *
 * Supervises the same two-process topology as scripts/guardian/prod.mjs:
 *   1. UTA service  (services/uta/dist/uta.js, bind 127.0.0.1)
 *   2. Alice main   (dist/main.js)
 * plus the desktop-only concerns: data relocation, BrowserWindow, quit UX.
 *
 * Lifecycle:
 *   relocate data → resolve ports → spawn UTA → poll /__uta/health
 *   → spawn Alice (OPENALICE_UTA_URL injected) → wait Alice ready
 *   → open window. Watch `data/control/restart-uta.flag` → respawn UTA.
 *   On quit or unexpected child exit: cascade tree-kill both children.
 *
 * The port + supervision logic is an inline mirror of
 * scripts/guardian/{shared.ts,prod.mjs} — the desktop package is a separate
 * release surface with no TS-dev-tooling dependency, the same reason
 * probe-port.ts is duplicated rather than imported.
 *
 * Out of scope (future iterations): tray icon, multi-window, native menus.
 */

import { app, BrowserWindow, dialog, Menu, protocol } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, watch } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { probeFreePort } from './probe-port.js'
import { relocateLegacyData } from './relocate-data.js'
import { configureAutoUpdate } from './auto-update.js'
import { fetchAliceWebRequest, handleOpenAliceIpcMessage, registerOpenAliceIpc } from './ipc.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let uta: ChildProcess | null = null
let alice: ChildProcess | null = null
let appQuitting = false
let restartingUTA = false

const DEFAULT_WEB_PORT_START = 47331
const READY_TIMEOUT_MS = 30_000
const UTA_READY_TIMEOUT_MS = 15_000
const SIGTERM_GRACE_MS = 5_000
const UTA_RESTART_GRACE_MS = 8_000

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// ── Cross-platform process-tree kill ─────────────────────────
// Inline mirror of scripts/guardian/shared.ts:killTree. UTA and Alice each
// spawn grandchildren (node-pty terminals, workspace CLIs). On Windows
// `child.kill()` reaps only the direct child and orphans those grandchildren
// — they keep holding their ports, breaking UTA restart and leaving zombies
// on quit. `taskkill /T` walks the whole tree; `/F` is the only reliable kill
// for a detached console child. POSIX has no wrapper, so a direct signal is
// correct and preserves graceful SIGTERM.
function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.pid == null) return
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']) } catch { /* already gone */ }
  } else {
    try { child.kill(signal) } catch { /* already gone */ }
  }
}

// ── Port configuration ──────────────────────────────────────
// Inline mirror of scripts/guardian/shared.ts (the desktop package is a
// separate release surface — same reason probe-port.ts is duplicated).
// Keep semantics in sync: env > data/config/ports.json > default; broken
// or in-use explicit config fails loud.

function parsePort(raw: unknown, origin: string): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`[guardian] invalid port ${JSON.stringify(raw)} from ${origin} — expected an integer in 1..65535`)
  }
  return n
}

async function readPortsFile(userDataHome: string): Promise<Partial<Record<'web' | 'mcp' | 'uta', number>>> {
  const filePath = resolve(userDataHome, 'data', 'config', 'ports.json')
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`[guardian] ${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`[guardian] ${filePath} must be a JSON object like {"web":47331,"mcp":47332,"uta":47333}`)
  }
  const out: Partial<Record<'web' | 'mcp' | 'uta', number>> = {}
  for (const name of ['web', 'mcp', 'uta'] as const) {
    const v = (parsed as Record<string, unknown>)[name]
    if (v !== undefined) out[name] = parsePort(v, `${filePath} ("${name}")`)
  }
  return out
}

async function readMcpConfigFile(userDataHome: string): Promise<{ enabled: boolean; port?: number }> {
  const filePath = resolve(userDataHome, 'data', 'config', 'mcp.json')
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return { enabled: false }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`[guardian] ${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`[guardian] ${filePath} must be a JSON object like {"enabled":false,"port":47332}`)
  }
  const rec = parsed as Record<string, unknown>
  return {
    enabled: rec['enabled'] === true,
    ...(rec['port'] !== undefined ? { port: parsePort(rec['port'], `${filePath} ("port")`) } : {}),
  }
}

function parseEnabledEnv(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === '') return null
  return raw === '1' || raw.toLowerCase() === 'true'
}

/** Explicit (env/file) port → assert free or throw; unset → probe upward. */
async function claimPort(
  name: string,
  envKey: string,
  fileValue: number | undefined,
  probeStart: number,
): Promise<number> {
  const envRaw = process.env[envKey]
  const explicit =
    envRaw !== undefined && envRaw !== ''
      ? { value: parsePort(envRaw, envKey), origin: envKey }
      : fileValue !== undefined
        ? { value: fileValue, origin: 'data/config/ports.json' }
        : null
  if (explicit === null) return probeFreePort(probeStart)
  try {
    return await probeFreePort(explicit.value, explicit.value)
  } catch {
    throw new Error(
      `[guardian] port ${explicit.value} (${name}, from ${explicit.origin}) is already in use — free it or configure another port`,
    )
  }
}

async function waitForAliceReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      // 5xx still means the app is reachable; only transport errors mean not-ready.
      const res = await fetchAliceWebRequest(new Request('app://openalice/api/version'), alice, 1_000)
      if (res.status < 500) return
    } catch {
      // child not listening on its IPC web transport yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Alice did not become ready over Electron IPC within ${timeoutMs}ms`)
}

async function waitForUTA(utaUrl: string, timeoutMs = UTA_READY_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${utaUrl}/__uta/health`)
      if (res.ok) return true
    } catch {
      // not bound yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

async function runRendererPtySmoke(win: BrowserWindow): Promise<void> {
  const keepWorkspace = process.env['OPENALICE_ELECTRON_SMOKE_KEEP_WORKSPACE'] === '1'
  const result = await win.webContents.executeJavaScript(`(async () => {
    const bridge = window.openAlice?.pty
    if (!bridge) throw new Error('window.openAlice.pty missing')
    const tag = 'electron-smoke-' + Date.now().toString(36)
    const json = async (res) => {
      const text = await res.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      if (!res.ok) throw new Error(res.status + ' ' + text)
      return body
    }
    let workspaceId = ''
    let sessionId = ''
    let connectionId = ''
    try {
      const created = await json(await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag, template: 'chat', agents: ['shell'] }),
      }))
      workspaceId = created.workspace.id
      const spawned = await json(await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/sessions/spawn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: 'shell' }),
      }))
      sessionId = spawned.sessionId
      const attached = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('PTY attached timeout')), 10000)
        connectionId = bridge.connect({ sessionId, cols: 80, rows: 24 })
        const offMessage = bridge.onMessage(connectionId, (msg) => {
          if (msg.type !== 'control') return
          const text = typeof msg.data === 'string' ? msg.data : String(msg.data ?? '')
          try {
            const control = JSON.parse(text)
            if (control.type === 'attached') {
              clearTimeout(timer)
              offMessage()
              offClose()
              resolve(control)
            }
          } catch {
            // Ignore non-JSON terminal control frames.
          }
        })
        const offClose = bridge.onClose(connectionId, (ev) => {
          clearTimeout(timer)
          offMessage()
          offClose()
          reject(new Error('PTY closed before attach: ' + ev.code))
        })
      })
      return { ok: true, workspaceId, sessionId, attached }
    } finally {
      if (connectionId) bridge.close(connectionId)
      if (!${keepWorkspace ? 'true' : 'false'}) {
        if (workspaceId && sessionId) {
          await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/sessions/' + encodeURIComponent(sessionId) + '/pause', { method: 'POST' }).catch(() => {})
        }
        if (workspaceId) {
          await fetch('/api/workspaces/' + encodeURIComponent(workspaceId), { method: 'DELETE' }).catch(() => {})
        }
      }
    }
  })()`, true) as { ok?: boolean; workspaceId?: string; sessionId?: string }
  console.log(`[guardian] electron smoke pty → ok workspace=${result.workspaceId ?? ''} session=${result.sessionId ?? ''}`)
}

app.whenReady().then(async () => {
  // Build output lives at <repo>/dist/electron/main.js, <repo>/dist/main.js
  // (Alice), and <repo>/services/uta/dist/uta.js (UTA). The desktop package
  // source is at apps/desktop/src/ but tsconfig.outDir is ../../dist/electron,
  // so these repo-relative resolves are unchanged from the pre-split layout.
  const repoRoot = resolve(__dirname, '..', '..')
  const aliceEntry = resolve(__dirname, '..', 'main.js')
  const utaEntry = resolve(repoRoot, 'services', 'uta', 'dist', 'uta.js')

  // Two homes — user data vs app resources. See src/core/paths.ts for why
  // they're split. User data lives at ~/.openalice by default in BOTH branches
  // — one store shared with `pnpm dev` and bare `pnpm start`, so accounts are
  // configured once, not per topology. An explicit OPENALICE_HOME is honored
  // for local packaged smoke tests, where we need app.isPackaged=true without
  // touching the user's real store. App resources stay lifecycle-owned:
  // .app/Contents/Resources when packaged, the repo in dev.
  const explicitUserDataHome = process.env['OPENALICE_HOME']?.trim()
  const userDataHome = explicitUserDataHome || join(homedir(), '.openalice')
  const homeEnv = app.isPackaged
    ? {
        OPENALICE_HOME: userDataHome,
        // The app dir itself (Contents/Resources/app with asar:false) — it's
        // what *contains* default/, ui/dist, src/workspaces, services/uta/dist,
        // matching how src/core/paths.ts resolves resources (APP_HOME/<dir>).
        // NOT dirname() — that points one level above the shipped files.
        OPENALICE_APP_HOME: app.getAppPath(),
      }
    : {
        OPENALICE_HOME: userDataHome,
        OPENALICE_APP_HOME: repoRoot,
      }

  // Pre-global-root installs kept user data under Electron's userData dir.
  // Move it once, BEFORE ports.json is read from the new root and before the
  // backend boots (it would run migrations against an empty store). On
  // failure: surface and quit — booting beside the user's real data would
  // fork their trading history.
  if (app.isPackaged && !explicitUserDataHome) {
    try {
      await relocateLegacyData(app.getPath('userData'), userDataHome)
    } catch (err) {
      dialog.showErrorBox(
        'OpenAlice — data relocation failed',
        `Could not move the user data store from\n${app.getPath('userData')}/data\nto\n${userDataHome}/data\n\n` +
          `${err instanceof Error ? err.message : String(err)}\n\nNothing was deleted. Please move the directory manually, then relaunch.`,
      )
      app.quit()
      return
    }
  }

  // Port precedence: env (OPENALICE_*_PORT) > data/config/ports.json (under
  // the user-data home, same L1 file the dev/prod guardians read) > probe
  // from the default. Explicitly configured ports fail loud when taken —
  // the user pinned them; silently drifting would break their bookmarks /
  // firewall rules. Unconfigured ports keep the probe-upward behavior.
  const portsFile = await readPortsFile(homeEnv.OPENALICE_HOME)
  const mcpFile = await readMcpConfigFile(homeEnv.OPENALICE_HOME)
  const mcpEnabled = parseEnabledEnv(process.env['OPENALICE_MCP_ENABLED']) ?? mcpFile.enabled
  const mcpPort = mcpEnabled
    ? await claimPort('mcp', 'OPENALICE_MCP_PORT', portsFile.mcp ?? mcpFile.port, DEFAULT_WEB_PORT_START + 1)
    : null
  const utaPort = await claimPort('uta', 'OPENALICE_UTA_PORT', portsFile.uta, mcpPort !== null ? mcpPort + 1 : DEFAULT_WEB_PORT_START + 1)
  const utaUrl = `http://127.0.0.1:${utaPort}`
  const launcherMode = app.isPackaged ? 'electron-packaged' : 'electron-dev'
  const toolBaseUrl = '/cli'
  const toolSocketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\openalice-${process.pid}-tools`
    : join(app.getPath('temp'), `openalice-${process.pid}-tools.sock`)

  // ── Child spawns ────────────────────────────────────────────
  // Both children run as pure Node, not nested Electron main processes —
  // ELECTRON_RUN_AS_NODE flips process.execPath (the Electron binary) into
  // Node runtime mode. Without it each spawn would open a new app window.

  const spawnUTA = (): ChildProcess => {
    const child = spawn(process.execPath, [utaEntry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OPENALICE_UTA_PORT: String(utaPort),
        OPENALICE_LAUNCHER: 'electron',
        ...homeEnv,
      },
      stdio: 'inherit',
    })
    child.once('exit', (code, signal) => {
      if (appQuitting || restartingUTA) return
      console.error(`[guardian] UTA exited unexpectedly code=${code} signal=${signal}`)
      shutdown()
    })
    return child
  }

  const spawnAlice = (): ChildProcess => {
    const child = spawn(process.execPath, [aliceEntry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OPENALICE_WEB_TRANSPORT: 'ipc',
        ...(mcpPort !== null ? { OPENALICE_MCP_PORT: String(mcpPort) } : {}),
        OPENALICE_MCP_ENABLED: mcpEnabled ? '1' : '0',
        OPENALICE_LOCAL_CLI_ON_WEB: '1',
        OPENALICE_TOOL_BASE_URL: toolBaseUrl,
        OPENALICE_TOOL_SOCKET: toolSocketPath,
        // The fix: Alice hard-requires OPENALICE_UTA_URL at boot
        // (src/main.ts) and throws without it. The pre-UTA desktop shell
        // never set it, so the packaged app crashed on launch.
        OPENALICE_UTA_URL: utaUrl,
        OPENALICE_LAUNCHER: 'electron',
        ...homeEnv,
      },
      // The fourth fd opens Node child_process IPC. Electron app mode uses it
      // as the local PTY transport between BrowserWindow/preload and Alice's
      // WorkspaceService, while HTTP/WS remains the browser/dev/Docker plane.
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      serialization: 'advanced',
    })
    child.on('message', (msg) => {
      if (!handleOpenAliceIpcMessage(msg)) {
        // No-op today; keeps the IPC pipe extensible without silently hiding
        // malformed messages while we build out app-mode transports.
      }
    })
    child.once('exit', (code, signal) => {
      if (appQuitting) return
      console.error(`[guardian] Alice exited unexpectedly code=${code} signal=${signal}`)
      shutdown()
    })
    return child
  }

  // ── Boot order: UTA first, then Alice pointed at it ─────────
  // Keep this banner explicit: desktop logs are often the only thing a user
  // sees when debugging startup, and "Electron app loading local HTTP" looks
  // deceptively similar to Docker/prod unless the launcher mode is named.
  console.log('')
  console.log(`[guardian] mode     →  ${launcherMode}`)
  console.log(`[guardian] data     →  ${homeEnv.OPENALICE_HOME}`)
  console.log(`[guardian] app      →  ${homeEnv.OPENALICE_APP_HOME}`)
  console.log(`[guardian] UTA      →  ${utaUrl}`)
  console.log(`[guardian] Alice    →  app://openalice (Electron IPC)`)
  console.log(`[guardian] Tools    →  ${toolSocketPath}`)
  console.log(`[guardian] MCP      →  ${mcpPort !== null ? `http://127.0.0.1:${mcpPort}/mcp` : 'disabled'}`)
  console.log('')
  registerOpenAliceIpc({
    mode: launcherMode,
    userDataHome: homeEnv.OPENALICE_HOME,
    appHome: homeEnv.OPENALICE_APP_HOME,
    webPort: null,
    mcpPort,
    utaPort,
    getAliceProcess: () => alice,
  })
  protocol.handle('app', async (request) => {
    try {
      return await fetchAliceWebRequest(request, alice)
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 503 })
    }
  })
  uta = spawnUTA()
  const utaReady = await waitForUTA(utaUrl)
  if (!utaReady) {
    dialog.showErrorBox(
      'OpenAlice — trading service failed to start',
      `The UTA trading service did not become ready within ${UTA_READY_TIMEOUT_MS / 1000}s.\n\n` +
        `OpenAlice can't start without it. Check the logs at ${join(userDataHome, 'logs')} and relaunch.`,
    )
    shutdown()
    return
  }
  console.log(`[guardian] UTA ready pid=${uta.pid}`)

  alice = spawnAlice()
  console.log(`[guardian] Alice pid=${alice.pid} web=ipc mcpPort=${mcpPort ?? 'disabled'}`)
  await waitForAliceReady()

  // ── Restart-flag watcher: broker config changes touch the flag; SIGTERM
  // + respawn UTA without restarting Alice (mirrors prod.mjs). ────────────
  void startFlagWatcher(homeEnv.OPENALICE_HOME, utaUrl, spawnUTA)

  // No in-window menu bar on Windows/Linux — Electron's default
  // File/Edit/View/Window/Help renders *inside* the window there and is
  // meaningless for a single-window web-UI app (it never shows on macOS,
  // where menus live in the system bar). macOS keeps a minimal menu so the
  // app menu + copy/paste/select-all accelerators still work.
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      : null,
  )

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'OpenAlice',
    webPreferences: {
      preload: resolve(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep preload in Electron's full preload environment. The renderer page
      // stays isolated and has no Node globals, but the preload itself imports
      // Electron modules and exposes the app-mode transport bridge.
      sandbox: false,
    },
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[guardian] renderer preload failed path=${preloadPath}: ${error.message}`)
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[guardian] renderer load failed code=${errorCode} url=${validatedURL}: ${errorDescription}`)
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return
    console.log(`[renderer] ${sourceId}:${line} ${message}`)
  })
  win.webContents.on('did-finish-load', () => {
    void win.webContents.executeJavaScript('Boolean(window.openAlice?.pty && window.openAlice?.runtime)', true)
      .then((ready) => {
        console.log(`[guardian] renderer bridge → ${ready ? 'ready' : 'missing'}`)
        if (ready && process.env['OPENALICE_ELECTRON_SMOKE_PTY'] === '1') {
          void runRendererPtySmoke(win)
            .then(() => {
              if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') shutdown()
            })
            .catch((err) => {
              console.error(`[guardian] electron smoke pty → failed: ${err instanceof Error ? err.message : String(err)}`)
              if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') {
                process.exitCode = 1
                shutdown()
              }
            })
        }
      })
      .catch((err) => {
        console.error(`[guardian] renderer bridge probe failed: ${err instanceof Error ? err.message : String(err)}`)
      })
  })
  win.loadURL('app://openalice/')

  configureAutoUpdate(win, { beforeInstall: stopChildren })
})

async function restartUTA(utaUrl: string, spawnUTA: () => ChildProcess): Promise<void> {
  if (restartingUTA || appQuitting) return
  restartingUTA = true
  try {
    console.log('[guardian] restart-uta.flag triggered — restarting UTA')
    const old = uta
    if (old && old.exitCode === null) {
      const exited = new Promise<void>((r) => old.once('exit', () => r()))
      killTree(old, 'SIGTERM')
      await Promise.race([exited, new Promise((r) => setTimeout(r, UTA_RESTART_GRACE_MS))])
      if (old.exitCode === null) {
        killTree(old, 'SIGKILL')
        await exited
      }
    }
    uta = spawnUTA()
    const ready = await waitForUTA(utaUrl)
    console.log(ready ? '[guardian] UTA back online' : '[guardian] UTA did not come back up after restart')
  } finally {
    restartingUTA = false
  }
}

async function startFlagWatcher(
  dataHome: string,
  utaUrl: string,
  spawnUTA: () => ChildProcess,
): Promise<void> {
  const flagPath = resolve(dataHome, 'data', 'control', 'restart-uta.flag')
  const flagDir = dirname(flagPath)
  const flagName = 'restart-uta.flag'
  await mkdir(flagDir, { recursive: true })
  let pending: ReturnType<typeof setTimeout> | undefined
  const fire = (): void => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      restartUTA(utaUrl, spawnUTA).catch((err) => console.error('[guardian] restartUTA threw:', err))
    }, 100)
  }
  try {
    const watcher = watch(flagDir)
    for await (const evt of watcher) {
      if (evt.filename === flagName) fire()
    }
  } catch (err) {
    console.error('[guardian] flag watcher errored:', err)
  }
}

/** Cascade tree-kill both children. */
async function stopChildren(): Promise<void> {
  appQuitting = true
  const children = [uta, alice].filter((c): c is ChildProcess => c != null && c.exitCode === null && !c.killed)
  if (children.length === 0) return
  console.log(`[guardian] shutting down — SIGTERM → ${children.length} child(ren)`)
  await Promise.all(
    children.map(async (c) => {
      const exited = new Promise<void>((r) => c.once('exit', () => r()))
      killTree(c, 'SIGTERM')
      await Promise.race([exited, new Promise((r) => setTimeout(r, SIGTERM_GRACE_MS))])
      if (c.exitCode === null && !c.killed) {
        console.warn(`[guardian] child pid=${c.pid} did not exit after ${SIGTERM_GRACE_MS}ms → SIGKILL`)
        killTree(c, 'SIGKILL')
        await exited
      }
    }),
  )
}

/** Cascade tree-kill both children, then exit once they're gone. */
function shutdown(): void {
  if (appQuitting) return
  void stopChildren().finally(() => app.exit(0))
}

app.on('before-quit', (e) => {
  if (appQuitting) return
  e.preventDefault()
  shutdown()
})

app.on('window-all-closed', () => {
  // MVP: quit on last-window-close everywhere (including macOS).
  // Future: tray icon + macOS "stay alive in background" semantics so the
  // user can close the window without killing in-flight cron jobs.
  app.quit()
})
