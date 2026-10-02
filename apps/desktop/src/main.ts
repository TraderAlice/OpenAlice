import { runRendererCredentialPiSmoke } from './credential-pi-smoke.js'
/**
 * Electron main process — OpenAlice's desktop guardian.
 *
 * Supervises the same optional-service topology as scripts/guardian/prod.mjs:
 *   1. UTA service  (services/uta/dist/uta.js, bind 127.0.0.1)
 *   2. Connector Service (services/connector/dist/connector.js, optional)
 *   3. Alice main   (dist/main.js)
 * plus the desktop-only concerns: data relocation, BrowserWindow, quit UX.
 *
 * Lifecycle:
 *   relocate data → resolve ports → spawn UTA unless lite mode disables it
 *   → spawn Alice (UTA URL or lite env injected) → wait Alice ready
 *   → open window and tray. Closing the window hides it; Quit or an
 *   unexpected Alice exit cascades child shutdown. Watch
 *   `data/control/restart-uta.flag` → respawn UTA.
 *
 * The port + supervision logic is an inline mirror of
 * scripts/guardian/{shared.ts,prod.mjs} — the desktop package is a separate
 * release surface with no TS-dev-tooling dependency, the same reason
 * probe-port.ts is duplicated rather than imported.
 *
 * Out of scope (future iterations): multi-window, native menus.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, protocol, session, shell, Tray } from 'electron'
import { runRendererTradingModeSmoke } from './trading-mode-smoke.js'
import { runRendererDataHomeSmoke } from './data-home-smoke.js'
import { runRendererWorkspaceAcceptanceSmoke } from './workspace-acceptance-smoke.js'
import { planUTATransition } from './uta-lifecycle.js'
import {
  acquireGuardianRuntime,
  currentProcessStartedAt,
  resolveGuardianTradingMode,
  takeoverRequested,
  proxyEnvFromRules,
  resolveAliceProjectIdentity,
  type GuardianTradingModePlan,
  type RuntimeProcessLock,
} from '@traderalice/guardian-runtime'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, watch, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { probeFreePort } from './probe-port.js'
import { relocateLegacyData } from './relocate-data.js'
import { configureAutoUpdate } from './auto-update.js'
import { BoundedTextTail, conciseDiagnosticTail, DesktopDiagnostics } from './desktop-diagnostics.js'
import { cancelOpenAliceWebRequests, fetchAliceWebRequest, handleOpenAliceIpcMessage, registerOpenAliceIpc } from './ipc.js'
import { resolveManagedRuntimeEnv } from './managed-runtime.js'
import { defaultDataHomePreferences } from './data-home.js'
import {
  createDesktopDataHomeController,
  dataHomeErrorDetail,
  resolveDesktopDataHome,
  type ResolvedDesktopDataHome,
} from './data-home-desktop.js'
import { existingOwnerSmokeMode, resolveExistingOwnerStartup } from './existing-owner-startup.js'
import { DesktopUpdateLifecycle } from './update-lifecycle.js'
import { inspectPreviousUpdateAttempt, recordUpdateAttempt } from './update-attempt.js'
import { childIsRunning, stopChild } from './child-shutdown.js'
import { exitDesktopProcess } from './app-exit.js'
import { createAppWindow } from './app-window.js'
import { configureWindowLifecycle, showAppWindow } from './window-lifecycle.js'
import type { CompanionHandle } from './companion.js'
import { CLI_VERSION, UpdateControlService, ClientUpdateService, WebRelay, readStartupTarget, writeStartupTarget, resolveLocalStartupHome, inspectLocalMachine } from './web-relay.js'

// The desktop launcher owns its mode for both relay and child Runtime readers.
process.env.OPENALICE_RUNTIME_PROFILE = app.isPackaged ? 'electron-packaged' : 'electron-dev'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let uta: ChildProcess | null = null
let connector: ChildProcess | null = null
let alice: ChildProcess | null = null
let appQuitting = false
let tray: Tray | null = null
let restartingUTA = false
let restartingConnector = false
let pendingUTAMode: GuardianTradingModePlan | null = null
let rendererCredentialPiSmokeStarted = false
let rendererDataHomeSmokeStarted = false
let rendererTradingModeSmokeStarted = false
let rendererWorkspaceAcceptanceSmokeStarted = false
let guardianRuntimeLock: RuntimeProcessLock | null = null
let desktopDiagnostics: DesktopDiagnostics | null = null
let aliceStderrTail = new BoundedTextTail()
let aliceBecameReady = false
let fatalDesktopErrorShown = false
let localRuntimeSuspended = false
let desktopRelay: WebRelay | null = null

const DEFAULT_WEB_PORT_START = 47331
const READY_TIMEOUT_MS = 30_000
const UTA_READY_TIMEOUT_MS = 15_000
const SIGTERM_GRACE_MS = 5_000
const UTA_RESTART_GRACE_MS = 8_000
const DATA_HOME_PREFERENCES_FILE = 'openalice-data-home.json'
const UPDATE_ATTEMPT_FILE = 'openalice-update-attempt.json'

function showFatalDesktopError(title: string, message: string): void {
  if (fatalDesktopErrorShown) return
  fatalDesktopErrorShown = true
  const childDetail = conciseDiagnosticTail(aliceStderrTail.text())
  const logDetail = desktopDiagnostics ? `\n\nDiagnostic log:\n${desktopDiagnostics.path}` : ''
  dialog.showErrorBox(
    title,
    `${message}${childDetail ? `\n\nLast Alice output:\n${childDetail}` : ''}${logDetail}`,
  )
}

async function releaseGuardianRuntimeLock(): Promise<void> {
  const current = guardianRuntimeLock
  guardianRuntimeLock = null
  await current?.release().catch((error) => {
    console.error('[guardian] runtime lock release failed:', error)
    desktopDiagnostics?.write(
      'guardian',
      `runtime lock release failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    )
  })
}

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

const smokeUserData = process.env['OPENALICE_ELECTRON_SMOKE_USER_DATA']?.trim()
if (smokeUserData) app.setPath('userData', smokeUserData)
if (existingOwnerSmokeMode() || process.env['OPENALICE_ELECTRON_SMOKE_STARTUP'] === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.disableHardwareAcceleration()
}

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

type DesktopPortName = 'web' | 'mcp' | 'uta' | 'connector'

async function readPortsFile(userDataHome: string): Promise<Partial<Record<DesktopPortName, number>>> {
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
    throw new Error(`[guardian] ${filePath} must be a JSON object like {"web":47331,"mcp":47332,"uta":47333,"connector":47334}`)
  }
  const out: Partial<Record<DesktopPortName, number>> = {}
  for (const name of ['web', 'mcp', 'uta', 'connector'] as const) {
    const v = (parsed as Record<string, unknown>)[name]
    if (v !== undefined) out[name] = parsePort(v, `${filePath} ("${name}")`)
  }
  return out
}

async function readConnectorServiceEnabled(userDataHome: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(resolve(userDataHome, 'data', 'config', 'connector-service.json'), 'utf8')) as { enabled?: unknown }
    return value.enabled === true
  } catch {
    return false
  }
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

function selectPort(
  envKey: string,
  fileValue: number | undefined,
  fallback: number,
): { value: number; explicitOrigin: string | null } {
  const envRaw = process.env[envKey]
  if (envRaw !== undefined && envRaw !== '') {
    return { value: parsePort(envRaw, envKey), explicitOrigin: envKey }
  }
  if (fileValue !== undefined) {
    return { value: fileValue, explicitOrigin: 'data/config/ports.json' }
  }
  return { value: fallback, explicitOrigin: null }
}

function parseEnabledEnv(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === '') return null
  return raw === '1' || raw.toLowerCase() === 'true'
}

function truthyEnv(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false
  const normalized = raw.toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

async function resolveChildProxyEnv(): Promise<Record<string, string>> {
  // Existing env is authoritative on every platform. Electron 39 embeds Node
  // 22.22, whose fetch stack consumes it only when NODE_USE_ENV_PROXY is set.
  const explicit = proxyEnvFromRules('', process.env)
  if (Object.keys(explicit).length > 0) {
    return explicit
  }

  try {
    // Chromium already understands the host system proxy, including PAC.
    // Resolve one representative HTTPS API URL and pass a concrete proxy to
    // the pure-Node Alice/UTA children, whose fetch does not consult Chromium.
    const rules = await session.defaultSession.resolveProxy('https://api.openai.com/')
    return proxyEnvFromRules(rules, process.env)
  } catch (err) {
    console.warn(`[guardian] could not resolve system proxy: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  }
}

function isLiteModeEnv(env: NodeJS.ProcessEnv): boolean {
  return truthyEnv(env['OPENALICE_LITE_MODE']) || truthyEnv(env['OPENALICE_UTA_DISABLED'])
}

/** Explicit (env/file) port → assert free or throw; unset → probe upward. */
async function claimPort(
  name: string,
  envKey: string,
  fileValue: number | undefined,
  probeStart: number,
): Promise<number> {
  const selected = selectPort(envKey, fileValue, probeStart)
  if (selected.explicitOrigin === null) return probeFreePort(selected.value)
  try {
    return await probeFreePort(selected.value, selected.value)
  } catch {
    throw new Error(
      `[guardian] port ${selected.value} (${name}, from ${selected.explicitOrigin}) is already in use — free it or configure another port`,
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
  const expectedVersion = JSON.parse(await readFile(resolve(__dirname, '../../package.json'), 'utf8')).version
  const result = await win.webContents.executeJavaScript(`(async () => {
    const stage = (value) => console.warn('[desktop-pty-smoke] renderer stage=' + value)
    stage('bridge')
    const bridge = window.openAlice?.pty
    if (!bridge) throw new Error('window.openAlice.pty missing')
    const client = await window.openAlice.clientUpdates.status()
    const backend = await fetch('/api/version?currentOnly=1').then(response => response.json())
    if (client.currentVersion !== ${JSON.stringify(expectedVersion)} || backend.current !== client.currentVersion) throw new Error('Integrated product versions disagree')
    stage('product-version=' + client.currentVersion)
    const keyboard = window.openAlice?.keyboard
    if (!keyboard?.getInputSourceId) throw new Error('window.openAlice.keyboard missing')
    const keyboardInputSourceId = await keyboard.getInputSourceId()
    if (keyboardInputSourceId !== null && typeof keyboardInputSourceId !== 'string') {
      throw new Error('keyboard input source bridge returned an invalid value')
    }
    const tag = 'electron-smoke-' + Date.now().toString(36)
    const json = async (res) => {
      stage('response-headers status=' + res.status)
      const text = await res.text()
      stage('response-body')
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      if (!res.ok) throw new Error(res.status + ' ' + text)
      return body
    }
    let workspaceId = ''
    let sessionId = ''
    let connectionId = ''
    try {
      stage('create-workspace')
      const created = await json(await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag, template: 'chat' }),
      }))
      workspaceId = created.workspace.id
      stage('spawn-shell')
      const spawned = await json(await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/sessions/spawn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: 'shell' }),
      }))
      sessionId = spawned.sessionId
      stage('connect-pty')
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
      if (typeof attached.kittyKeyboardFlags !== 'number') {
        throw new Error('PTY attach omitted Kitty keyboard flags')
      }
      stage('attached')
      return { ok: true, workspaceId, sessionId, attached, keyboardInputSourceId }
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
  })()`, true) as {
    ok?: boolean
    workspaceId?: string
    sessionId?: string
    keyboardInputSourceId?: string | null
  }
  console.log(
    `[guardian] electron smoke pty → ok workspace=${result.workspaceId ?? ''} session=${result.sessionId ?? ''} inputSource=${result.keyboardInputSourceId ?? 'unknown'}`,
  )
}


function configureDesktopUpdates(win: BrowserWindow, updateAttemptPath: string): ClientUpdateService {
  const lifecycle = new DesktopUpdateLifecycle(app.getPath('userData'), () => CLI_VERSION)
  const ready = async () => {
    if (win.isDestroyed()) return false
    if (!await win.webContents.executeJavaScript(`Boolean(window.openAlice?.updater && document.querySelector('[data-testid="activity-bar"]'))`, true)) return false
    if (win.webContents.getURL().startsWith('app://')) {
      const response = await fetchAliceWebRequest(new Request('app://openalice/api/version?currentOnly=1'), alice)
      return response.ok && (await response.json()).current === CLI_VERSION
    }
    return true
  }
  let updateStoppedServices = false
  const nativeUpdates = configureAutoUpdate(win, {
    executeInstall: async (version, prepare, handoff, parentOperationId) => {
      const result = await lifecycle.install(version, prepare, handoff, parentOperationId)
      if (['failed', 'blocked', 'recovery'].includes(result.phase)) throw new Error(result.error ?? 'Desktop update requires recovery')
    },
    beforeInstall: async (version, report) => {
      await recordUpdateAttempt(updateAttemptPath, {
        fromVersion: CLI_VERSION,
        toVersion: version,
      })
      desktopDiagnostics?.write('updater', `starting ${CLI_VERSION} -> ${version}`)
      report('stopping-services')
      await stopChildren()
      updateStoppedServices = true
      report('releasing-runtime')
      await releaseGuardianRuntimeLock()
    },
    onInstallHandoff: (version) => {
      desktopDiagnostics?.write('updater', `handing ${version} to the native installer`)
      if (Notification.isSupported()) {
        new Notification({
          title: 'OpenAlice is updating',
          body: `Installing ${version}. OpenAlice will reopen automatically; this can take up to a minute.`,
        }).show()
      }
    },
    onInstallFailure: (error) => {
      desktopDiagnostics?.write('updater', `installer handoff failed: ${error.stack ?? error.message}`)
      const recoveryMessage = appQuitting || updateStoppedServices
        ? 'OpenAlice will restart on the current version.'
        : 'OpenAlice is still running on the current version.'
      dialog.showErrorBox(
        'OpenAlice update failed',
        `${error.message}\n\n${recoveryMessage}\n\nDiagnostic log:\n${desktopDiagnostics?.path ?? app.getPath('logs')}`,
      )
      if (appQuitting || updateStoppedServices) {
        app.relaunch()
        app.exit(1)
      }
    },
  }, CLI_VERSION)
  const control = new UpdateControlService({
    root: app.getPath('userData'),
    scope: () => win.webContents.getURL().startsWith('app://') ? `integrated:${process.env['OPENALICE_HOME'] ?? 'local'}` : `${desktopRelay?.status.target?.machine ?? 'none'}:${desktopRelay?.status.target?.project ?? 'none'}`,
    project: async (path, body) => {
      const request = { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }
      const response = win.webContents.getURL().startsWith('app://')
        ? await fetchAliceWebRequest(new Request(`app://openalice${path}`, request), alice)
        : await win.webContents.session.fetch(`${desktopRelay!.originUrl}${path}`, { ...request, credentials: 'include' })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    },
    backend: { plan: () => { const target = desktopRelay?.status.target; if (!target || target.machine === 'local') throw new Error('This backend updates with its installation owner'); return desktopRelay!.planMachine({ mode: 'upgrade', machineKey: target.machine, projectKey: target.project }) }, apply: id => desktopRelay!.applyMachine(id) },
    client: { current: () => CLI_VERSION, downloaded: nativeUpdates.downloaded, install: nativeUpdates.install, ready,
      recovery: { status: () => lifecycle.snapshot(), resume: () => lifecycle.resume(ready), abandon: () => lifecycle.journal.abandon() } },
  })
  const resume = () => {
    void control.status().then(current => current ? control.resume() : null).then(async result => {
      if (result?.phase === 'succeeded') await inspectPreviousUpdateAttempt(updateAttemptPath, CLI_VERSION)
    }).catch(error => console.warn('[updates] recovery:', error))
  }
  win.webContents.on('did-finish-load', resume)
  resume()
  ipcMain.removeHandler('openalice:updates:operation')
  ipcMain.handle('openalice:updates:operation', () => control.status())
  ipcMain.handle('openalice:updates:abandon', () => control.abandon())
  ipcMain.handle('openalice:updates:status', () => control.status())
  ipcMain.handle('openalice:updates:review', (_event, selection) => control.review(selection))
  ipcMain.handle('openalice:updates:approve', (_event, plan, fingerprint) => control.approve(plan, fingerprint))
  ipcMain.handle('openalice:updates:resume', () => { resume(); return { accepted: true } })
  const clientUpdates = new ClientUpdateService({
    kind: 'desktop',
    path: join(app.getPath('userData'), 'client-updates.json'),
    discover: nativeUpdates.discover,
  })
  ipcMain.handle('openalice:client-updates:status', () => clientUpdates.snapshot())
  ipcMain.handle('openalice:client-updates:check', () => clientUpdates.check())
  ipcMain.handle('openalice:client-updates:activate', () => { clientUpdates.activate(); resume() })
  ipcMain.handle('openalice:client-updates:preferences', (_event, input: unknown) => clientUpdates.savePreferences(input))
  win.once('closed', () => clientUpdates.stop())
  return clientUpdates
}

/** Before any local home is selected or locked, the desktop can be a client
 * shell. Its launcher uses the same relay as web/TUI, with only native chrome
 * and update IPC. Project-owned file/PT Y capabilities are never registered. */
async function startDesktopLauncher(repoRoot: string, updateAttemptPath: string, startupError?: unknown): Promise<void> {
  localRuntimeSuspended = true
  const { window: win, companion } = createAppWindow(resolve(__dirname, 'preload.js'))
  const clientUpdates = configureDesktopUpdates(win, updateAttemptPath)
  const relay = new WebRelay({ clientUpdates, uiRoot: app.isPackaged ? join(process.resourcesPath, 'runtime', 'ui', 'dist') : join(repoRoot, 'ui', 'dist') })
  desktopRelay = relay
  await relay.listen()
  createTray(win, companion)
  companion?.configureActivity({
    identity: () => !relay.status.switching && relay.status.target ? JSON.stringify([relay.originUrl, relay.status.generation, relay.status.target.machine, relay.status.target.project]) : null,
    read: async (query, signal) => { const response = await win.webContents.session.fetch(`${relay.originUrl}/api/agent-runtime${query}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error('Activity unavailable'); return response.json() },
  })
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)
  configureWindowLifecycle(app, win, () => appQuitting)
  win.webContents.on('will-navigate', (event, destination) => {
    if (new URL(destination).origin === relay.originUrl) return
    event.preventDefault()
    if (/^https:\/\//i.test(destination)) void shell.openExternal(destination)
  })
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  const assertSender = (senderId: number) => {
    if (win.isDestroyed() || senderId !== win.webContents.id) throw new Error('Startup controls are only available in the main window.')
  }
  // Keep navigation and saving Default in the same serialized operation.
  // Relay attachment alone finishes before loadURL; a second IPC request in
  // that gap must not replace the target that this window is about to remember.
  let launcherSwitching = false
  let launcherGeneration = 0
  const switchLauncher = async (action: (current: () => boolean) => Promise<unknown>) => {
    if (launcherSwitching) throw new Error('A startup operation is already in progress.')
    const generation = ++launcherGeneration
    launcherSwitching = true
    try { return await action(() => generation === launcherGeneration && !appQuitting && !win.isDestroyed()) } finally { launcherSwitching = false }
  }
  const integrate = async (project: string) => {
    await resolveLocalStartupHome(project) // revalidate key/home before relaunch
    const args = process.argv.slice(1).filter(arg => !arg.startsWith('--openalice-integrated-project='))
    app.relaunch({ args: [...args, `--openalice-integrated-project=${project}`] })
    shutdown()
  }
  ipcMain.handle('openalice:desktop-connection:status', event => { assertSender(event.sender.id); return relay.status })
  ipcMain.handle('openalice:desktop-connection:startup-target', event => { assertSender(event.sender.id); return relay.startupPreference() })
  ipcMain.handle('openalice:desktop-connection:fleet', async event => { assertSender(event.sender.id); const response = await fetch(`${relay.originUrl}/relay/v1/fleet`); if (!response.ok) throw new Error('Could not discover Machines.'); return response.json() })
  ipcMain.handle('openalice:desktop-machine:plan', (event, input: unknown) => { assertSender(event.sender.id); return relay.planMachine(input as Parameters<WebRelay['planMachine']>[0]) })
  ipcMain.handle('openalice:desktop-machine:apply', (event, id: string) => { assertSender(event.sender.id); return relay.applyMachine(id) })
  ipcMain.handle('openalice:desktop-machine:operation', event => { assertSender(event.sender.id); return relay.machineOperation })
  ipcMain.handle('openalice:desktop-connection:connect', async (event, machine: string, project: string) => switchLauncher(async (current) => {
    assertSender(event.sender.id)
    if (machine === 'local') {
      const inventory = await inspectLocalMachine()
      const selected = inventory.machine.projects.find(entry => entry.key === project)
      if (!selected?.runtime.webEndpoint) return integrate(project)
    }
    await relay.connect(machine, project, { current, present: () => win.loadURL(`${relay.originUrl}/settings`) })
  }))
  ipcMain.handle('openalice:desktop-connection:project-control', async (event, input: { machine: string; project: string; action: string }) => switchLauncher(async (current) => {
    assertSender(event.sender.id)
    if (input?.machine === 'local' && input.action === 'start') return integrate(input.project)
    await relay.controlProject(input)
  }))
  ipcMain.handle('openalice:desktop-connection:return-integrated', async event => switchLauncher(async (current) => {
    assertSender(event.sender.id)
    relay.disconnect()
    await win.loadURL(relay.originUrl)
  }))
  if (startupError) relay.setStartupError(startupError)
  else {
    const recent = await relay.startupPreference()
    if (recent.target) await relay.connect(recent.target.machine, recent.target.project, { remember: false }).catch(error => relay.setStartupError(error))
  }
  if (process.env['OPENALICE_ACCEPTANCE_CONNECTED'] === '1') await relay.connect('local', 'default', { remember: false })
  await win.loadURL(relay.originUrl)
  console.log(`[guardian] desktop client shell ready → ${relay.originUrl}`)
  if (process.env['OPENALICE_ELECTRON_SMOKE_STARTUP'] === '1') {
    try {
      const expectedVersion = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')).version
      const result = await win.webContents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 15000
        while (!document.querySelector('h1') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
        const bridge = window.openAlice
        if (!document.querySelector('h1') || !bridge?.desktopConnection || !bridge?.desktopMachine) throw new Error('Startup chooser or client controls missing')
        if (bridge.runtime || bridge.pty || bridge.dataHome) throw new Error('Project-owned IPC leaked into startup shell')
        const client = await bridge.clientUpdates.savePreferences({ autoCheck: false })
        const httpClient = await fetch('/relay/v1/updates').then(response => response.json())
        if (client.kind !== 'desktop' || client.currentVersion !== ${JSON.stringify(expectedVersion)}) throw new Error('Desktop product identity differs from its package')
        if (httpClient.kind !== client.kind || httpClient.currentVersion !== client.currentVersion || httpClient.preferences.autoCheck !== false) throw new Error('HTTP and IPC client owners diverged')
        const connected = ${JSON.stringify(process.env['OPENALICE_ACCEPTANCE_CONNECTED'] === '1')}
        const status = await bridge.desktopConnection.status()
        const recent = await bridge.desktopConnection.startupTarget()
        if (!connected && status.target) throw new Error('Unexpected project attachment')
        let backendVersion = null
        if (connected) {
          if (status.target?.machine !== 'local' || status.target?.project !== 'default') throw new Error('Separated connection missing')
          const backend = await fetch('/api/version').then(r => r.json())
          if (typeof backend.current !== 'string' || !backend.current) throw new Error('Separated backend identity missing')
          backendVersion = backend.current
          const native = await bridge.clientUpdates.operation()
          if (native && native.phase !== 'succeeded') throw new Error('Separated native readiness not verified')
        }
        if (document.querySelector('[data-testid="first-run-guide"]')) throw new Error('Legacy wizard mounted')
        return { heading: document.querySelector('h1').textContent, recent, version: client.currentVersion, backendVersion }
      })()`)
      if (alice || uta || connector || guardianRuntimeLock) throw new Error('Startup shell acquired local project ownership')
      console.log('[guardian] renderer startup smoke passed ' + JSON.stringify(result))
    } catch (error) {
      console.error('[guardian] renderer startup smoke failed:', error)
      process.exitCode = 1
    } finally { shutdown() }
  }
}

app.whenReady().then(async () => {
  desktopDiagnostics = new DesktopDiagnostics(join(app.getPath('logs'), 'desktop.log'))
  desktopDiagnostics.write('desktop', `starting OpenAlice ${CLI_VERSION} pid=${process.pid}`)
  const updateAttemptPath = join(app.getPath('userData'), UPDATE_ATTEMPT_FILE)
  try {
    const previousUpdate = await inspectPreviousUpdateAttempt(updateAttemptPath, CLI_VERSION, { ready: false })
    if (previousUpdate.kind === 'succeeded') {
      desktopDiagnostics.write(
        'updater',
        `completed ${previousUpdate.attempt.fromVersion} -> ${previousUpdate.attempt.toVersion}`,
      )
    } else if (previousUpdate.kind === 'failed') {
      desktopDiagnostics.write(
        'updater',
        `handoff did not complete ${previousUpdate.attempt.fromVersion} -> ${previousUpdate.attempt.toVersion}; evidence=${previousUpdate.archivedPath}`,
      )
      dialog.showErrorBox(
        'OpenAlice update did not finish',
        `The previous update to OpenAlice ${previousUpdate.attempt.toVersion} did not complete. ` +
          `OpenAlice is still running ${CLI_VERSION}.\n\n` +
          `You can retry from Settings, or install the release manually.\n\nDiagnostic log:\n${desktopDiagnostics.path}`,
      )
    }
  } catch (error) {
    desktopDiagnostics.write(
      'updater',
      `could not inspect previous update attempt: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    )
  }

  // Build output lives at <repo>/dist/electron/main.js, <repo>/dist/main.js
  // (Alice), <repo>/services/uta/dist/uta.js (UTA), and the optional
  // <repo>/services/connector/dist/connector.js. The desktop package
  // source is at apps/desktop/src/ but tsconfig.outDir is ../../dist/electron,
  // so these repo-relative resolves are unchanged from the pre-split layout.
  const repoRoot = resolve(__dirname, '..', '..')
  const aliceEntry = resolve(__dirname, '..', 'main.js')
  const utaEntry = resolve(repoRoot, 'services', 'uta', 'dist', 'uta.js')
  const connectorEntry = resolve(repoRoot, 'services', 'connector', 'dist', 'connector.cjs')

  // User state and app resources have independent lifecycles. The desktop
  // resolves Default from the shared client Supervisor registry. The legacy
  // data-home preference is read only by the one-time migration.
  // OPENALICE_HOME remains authoritative for automation and
  // packaged smokes. App resources stay in the package (or repo in dev).
  let explicitUserDataHome = process.env['OPENALICE_HOME']?.trim()
  let localStartupProject: string | null = null
  const integratedSwitch = '--openalice-integrated-project='
  const integratedProject = process.argv.find(arg => arg.startsWith(integratedSwitch))?.slice(integratedSwitch.length)
  // Consume the successful-switch handoff; subsequent relaunches resolve the
  // shared Default instead of retaining an invocation override indefinitely.
  for (let index = process.argv.length - 1; index >= 0; index--) {
    if (process.argv[index]?.startsWith(integratedSwitch)) process.argv.splice(index, 1)
  }
  app.commandLine.removeSwitch('openalice-integrated-project')
  const smokeStartup = Object.keys(process.env).some(key => key.startsWith('OPENALICE_ELECTRON_SMOKE_') && key !== 'OPENALICE_ELECTRON_SMOKE_STARTUP' && process.env[key] === '1')
  if (!explicitUserDataHome && !smokeStartup) {
    try {
      const recent = integratedProject ? { machine: 'local', project: integratedProject } : await readStartupTarget({ legacyDesktopPreferencePath: join(app.getPath('userData'), DATA_HOME_PREFERENCES_FILE) })
      if (recent?.machine === 'local') {
        const inventory = await inspectLocalMachine()
        const selected = inventory.machine.projects.find(project => project.key === recent.project)
        if (!integratedProject && (!selected?.available || selected.runtime.webEndpoint)) { await startDesktopLauncher(repoRoot, updateAttemptPath, !selected?.available ? new Error('The default local AliceProject data folder is unavailable.') : undefined); return }
        explicitUserDataHome = await resolveLocalStartupHome(recent.project)
        localStartupProject = recent.project
      }
      else { await startDesktopLauncher(repoRoot, updateAttemptPath); return }
    } catch (error) { await startDesktopLauncher(repoRoot, updateAttemptPath, error); return }
  }
  const defaultUserDataHome = join(homedir(), '.openalice')
  const preferencePath = join(app.getPath('userData'), DATA_HOME_PREFERENCES_FILE)
  let resolvedDataHome: ResolvedDesktopDataHome | null
  try {
    resolvedDataHome = await resolveDesktopDataHome({
      defaultHome: defaultUserDataHome,
      ...(explicitUserDataHome ? { explicitHome: explicitUserDataHome } : {}),
      legacyDataPresent: app.isPackaged && existsSync(join(app.getPath('userData'), 'data')),
      preferencePath,
    })
  } catch (error) {
    dialog.showErrorBox(
      'OpenAlice — data location failed',
      `${dataHomeErrorDetail(error)}\n\nOpenAlice did not start or modify another data location.`,
    )
    app.quit()
    return
  }
  if (!resolvedDataHome) {
    app.quit()
    return
  }

  let userDataHome = resolvedDataHome.home
  let dataHomeSource = resolvedDataHome.source
  let dataHomePreferences = resolvedDataHome.preferences
  let selectedDefaultHome = resolvedDataHome.selectedDefault
  const selectionLock = resolvedDataHome.selectionLock

  // Resolve duplicate ownership before relocation, port reads, or any child
  // process can mutate the selected store. An unlocked desktop launch can
  // choose a different complete home instead of killing the existing owner.
  let launcherRoot = process.env['AQ_LAUNCHER_ROOT']?.trim() || join(userDataHome, 'workspaces')
  let takeover = takeoverRequested()
  const guardianStartedAt = currentProcessStartedAt()
  while (!takeover) {
    let existingOwner
    desktopDiagnostics.write(
      'existing-owner',
      `inspect home=${userDataHome} launcherRoot=${launcherRoot}`,
    )
    try {
      existingOwner = await resolveExistingOwnerStartup({
        userDataHome,
        launcherRoot,
        canChooseAnother: selectionLock === null,
        takeoverRequested: false,
      })
    } catch (error) {
      desktopDiagnostics.write(
        'existing-owner',
        `inspection failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
      )
      dialog.showErrorBox(
        'OpenAlice — existing AliceProject',
        `${error instanceof Error ? error.message : String(error)}\n\nOpenAlice did not take over the running AliceProject.`,
      )
      app.quit()
      return
    }
    desktopDiagnostics.write(
      'existing-owner',
      `resolved action=${existingOwner.action}${existingOwner.action === 'continue' ? ` takeover=${existingOwner.takeover}` : ''}`,
    )
    if (existingOwner.action === 'quit') {
      app.quit()
      return
    }
    if (existingOwner.action === 'continue') {
      takeover = existingOwner.takeover
      break
    }

    await startDesktopLauncher(repoRoot, updateAttemptPath)
    return
  }

  const homeEnv = {
    ...(localStartupProject ? { OPENALICE_PROJECT_KEY: localStartupProject } : {}),
    ...(app.isPackaged
    ? {
        OPENALICE_HOME: userDataHome,
        // External tools need real paths. Code and dependencies stay in
        // app.asar; shipped Workspace assets/toolchains live beside it.
        OPENALICE_APP_HOME: join(process.resourcesPath, 'runtime'),
      }
    : {
        OPENALICE_HOME: userDataHome,
        OPENALICE_APP_HOME: repoRoot,
      }),
  }
  try {
    guardianRuntimeLock = await acquireGuardianRuntime({
      userDataHome,
      launcherRoot,
      launcher: app.isPackaged ? 'guardian-electron-packaged' : 'guardian-electron-dev',
      takeover,
      processStartedAt: guardianStartedAt,
      onOwnershipLost: (err) => {
        console.error('[guardian] runtime ownership lost:', err)
        shutdown()
      },
    })
    if (takeover) console.log('[guardian] takeover → previous OpenAlice runtime stopped')
  } catch (err) {
    dialog.showErrorBox(
      'OpenAlice — recovery failed',
      `${err instanceof Error ? err.message : String(err)}\n\nThe previous writer was not confirmed stopped, so OpenAlice did not unlock the data directory.`,
    )
    app.quit()
    return
  }

  // Pre-global-root installs kept user data under Electron's userData dir.
  // Move it once, BEFORE ports.json is read from the new root and before the
  // backend boots (it would run migrations against an empty store). On
  // failure: surface and quit — booting beside the user's real data would
  // fork their trading history.
  if (app.isPackaged && ((!explicitUserDataHome && selectedDefaultHome) || localStartupProject === 'default' && userDataHome === defaultUserDataHome)) {
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
  let tradingMode = await resolveGuardianTradingMode(process.env, homeEnv.OPENALICE_HOME)
  const mcpPort = mcpEnabled
    ? await claimPort('mcp', 'OPENALICE_MCP_PORT', portsFile.mcp ?? mcpFile.port, DEFAULT_WEB_PORT_START + 1)
    : null
  const utaPortFallback = mcpPort !== null ? mcpPort + 1 : DEFAULT_WEB_PORT_START + 1
  const utaPort = tradingMode.mode === 'lite'
    ? selectPort('OPENALICE_UTA_PORT', portsFile.uta, utaPortFallback).value
    : await claimPort('uta', 'OPENALICE_UTA_PORT', portsFile.uta, utaPortFallback)
  const utaUrl = `http://127.0.0.1:${utaPort}`
  const connectorPortFallback = Math.max(47334, utaPort + 1)
  const connectorPort = await claimPort('connector', 'OPENALICE_CONNECTOR_PORT', portsFile.connector, connectorPortFallback)
  const connectorUrl = `http://127.0.0.1:${connectorPort}`
  const launcherMode = app.isPackaged ? 'electron-packaged' : 'electron-dev'
  const runtimeEnv = resolveManagedRuntimeEnv({
    appHome: homeEnv.OPENALICE_APP_HOME,
    launcherMode,
  })
  const proxyEnv = await resolveChildProxyEnv()
  const piRuntime = runtimeEnv.OPENALICE_MANAGED_PI_PATH
    ? runtimeEnv.OPENALICE_MANAGED_PI_NODE_PATH
      ? `pi=${runtimeEnv.OPENALICE_MANAGED_PI_NODE_PATH} ${runtimeEnv.OPENALICE_MANAGED_PI_PATH}`
      : `pi=${runtimeEnv.OPENALICE_MANAGED_PI_PATH}`
    : 'managed pi unavailable'
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
        OPENALICE_GUARDIAN_PID: String(process.pid),
        OPENALICE_GUARDIAN_STARTED_AT: String(guardianStartedAt),
        AQ_LAUNCHER_ROOT: launcherRoot,
        ...(takeover && !localRuntimeSuspended ? { OPENALICE_TAKEOVER: '1' } : {}),
        ...homeEnv,
        ...runtimeEnv,
        ...proxyEnv,
      },
      stdio: 'inherit',
    })
    child.once('exit', (code, signal) => {
      if (appQuitting || localRuntimeSuspended || restartingUTA) return
      console.error(`[guardian] UTA exited unexpectedly code=${code} signal=${signal} — trading offline, app stays up`)
    })
    return child
  }

  const spawnConnector = (): ChildProcess => {
    const child = spawn(process.execPath, [connectorEntry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OPENALICE_CONNECTOR_PORT: String(connectorPort),
        OPENALICE_TOOL_SOCKET: toolSocketPath,
        OPENALICE_LAUNCHER: 'electron',
        OPENALICE_GUARDIAN_PID: String(process.pid),
        OPENALICE_GUARDIAN_STARTED_AT: String(guardianStartedAt),
        AQ_LAUNCHER_ROOT: launcherRoot,
        ...(takeover && !localRuntimeSuspended ? { OPENALICE_TAKEOVER: '1' } : {}),
        ...homeEnv,
        ...runtimeEnv,
        ...proxyEnv,
      },
      stdio: 'inherit',
    })
    child.once('exit', (code, signal) => {
      if (appQuitting || localRuntimeSuspended || restartingConnector) return
      console.error(`[guardian] Connector exited unexpectedly code=${code} signal=${signal} — external notifications offline, app stays up`)
    })
    return child
  }

  const spawnAlice = (): ChildProcess => {
    aliceStderrTail = new BoundedTextTail()
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
        OPENALICE_UTA_URL: utaUrl,
        OPENALICE_CONNECTOR_URL: connectorUrl,
        OPENALICE_LAUNCHER: 'electron',
        OPENALICE_GUARDIAN_PID: String(process.pid),
        OPENALICE_GUARDIAN_STARTED_AT: String(guardianStartedAt),
        AQ_LAUNCHER_ROOT: launcherRoot,
        ...(takeover && !localRuntimeSuspended ? { OPENALICE_TAKEOVER: '1' } : {}),
        ...homeEnv,
        ...runtimeEnv,
        ...proxyEnv,
      },
      // The fourth fd opens Node child_process IPC. Electron app mode uses it
      // as the local PTY transport between BrowserWindow/preload and Alice's
      // WorkspaceService, while HTTP/WS remains the browser/dev/Docker plane.
      stdio: ['inherit', 'inherit', 'pipe', 'ipc'],
      serialization: 'advanced',
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      aliceStderrTail.append(chunk)
      desktopDiagnostics?.write('alice:stderr', chunk)
    })
    child.on('message', (msg) => {
      if (!handleOpenAliceIpcMessage(msg)) {
        // No-op today; keeps the IPC pipe extensible without silently hiding
        // malformed messages while we build out app-mode transports.
      }
    })
    child.once('exit', (code, signal) => {
      cancelOpenAliceWebRequests('The local Alice process exited before its IPC request completed.')
      if (appQuitting || localRuntimeSuspended) return
      const message = `Alice exited unexpectedly code=${code} signal=${signal}`
      console.error(`[guardian] ${message}`)
      desktopDiagnostics?.write('guardian', message)
      showFatalDesktopError(
        aliceBecameReady ? 'OpenAlice stopped unexpectedly' : 'OpenAlice could not start',
        aliceBecameReady
          ? 'The local Alice service stopped, so OpenAlice must close.'
          : 'The local Alice service exited before the desktop window was ready.',
      )
      process.exitCode = 1
      shutdown()
    })
    return child
  }

  // ── Boot order: UTA first, then Alice pointed at it ─────────
  // Keep this banner explicit: desktop logs are often the only thing a user
  // sees when debugging startup, and "Electron app loading local HTTP" looks
  // deceptively similar to Docker/prod unless the launcher mode is named.
  console.log('')
  console.log(`[guardian] mode     →  ${launcherMode}; trading=${tradingMode.mode} (${tradingMode.source}${tradingMode.envLocked ? ', env-locked' : ''})`)
  console.log(`[guardian] data     →  ${homeEnv.OPENALICE_HOME}`)
  console.log(`[guardian] app      →  ${homeEnv.OPENALICE_APP_HOME}`)
  console.log(`[guardian] runtime  →  ${piRuntime}`)
  console.log(`[guardian] UTA      →  ${tradingMode.mode === 'lite' ? 'disabled (trading mode lite)' : utaUrl}`)
  console.log(`[guardian] Connector→  ${connectorUrl} (optional)`)
  console.log(`[guardian] Alice    →  app://openalice (Electron IPC)`)
  console.log(`[guardian] Tools    →  ${toolSocketPath}`)
  console.log(`[guardian] MCP      →  ${mcpPort !== null ? `http://127.0.0.1:${mcpPort}/mcp` : 'disabled'}`)
  console.log('')
  let dataHomeRelaunchScheduled = false
  const scheduleDataHomeRelaunch = (): void => {
    if (dataHomeRelaunchScheduled) return
    dataHomeRelaunchScheduled = true
    setTimeout(() => {
      if (appQuitting) return
      app.relaunch()
      shutdown()
    }, 150)
  }
  registerOpenAliceIpc({
    mode: launcherMode,
    userDataHome: homeEnv.OPENALICE_HOME,
    appHome: homeEnv.OPENALICE_APP_HOME,
    webPort: null,
    mcpPort,
    utaPort,
    getAliceProcess: () => alice,
    dataHome: createDesktopDataHomeController({
      currentHome: userDataHome,
      defaultHome: defaultUserDataHome,
      source: dataHomeSource,
      selectionLock,
      preferencePath,
      initialPreferences: defaultDataHomePreferences(),
      requestRelaunch: scheduleDataHomeRelaunch,
    }),
  })
  protocol.handle('app', async (request) => {
    const smokeTrace = process.env['OPENALICE_ELECTRON_SMOKE_PTY'] === '1'
      && request.method === 'POST'
      && new URL(request.url).pathname.startsWith('/api/workspaces')
    if (smokeTrace) console.log('[desktop-pty-smoke] main stage=web-request')
    try {
      const response = await fetchAliceWebRequest(request, alice)
      if (smokeTrace) console.log('[desktop-pty-smoke] main stage=web-response status=' + response.status)
      return response
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 503 })
    }
  })
  if (tradingMode.mode !== 'lite') {
    uta = spawnUTA()
    void waitForUTA(utaUrl).then((ready) => {
      if (ready) console.log(`[guardian] UTA ready pid=${uta?.pid ?? ''}`)
      else console.warn(`[guardian] UTA did not become ready within ${UTA_READY_TIMEOUT_MS / 1000}s — continuing with trading offline`)
    })
  }
  if (await readConnectorServiceEnabled(homeEnv.OPENALICE_HOME)) {
    connector = spawnConnector()
    void waitForConnector(connectorUrl).then((ready) => {
      if (ready) console.log(`[guardian] Connector ready pid=${connector?.pid ?? ''}`)
      else console.warn('[guardian] Connector did not become ready within 15s — external notifications offline')
    })
  }

  alice = spawnAlice()
  console.log(`[guardian] Alice pid=${alice.pid} web=ipc mcpPort=${mcpPort ?? 'disabled'}`)
  await waitForAliceReady()
  aliceBecameReady = true

  // Alice migrations can create connector-service.json from the retired
  // Telegram config. Reconcile after readiness so this upgrade starts the
  // independent service without requiring a second app launch.
  if (!connector && await readConnectorServiceEnabled(homeEnv.OPENALICE_HOME)) {
    await reconcileConnector(true, connectorUrl, spawnConnector)
  }

  // ── Restart-flag watcher: broker config changes touch the flag; SIGTERM
  // + respawn UTA without restarting Alice (mirrors prod.mjs). ────────────
  let flagWatchAbort = new AbortController()
  const watchLocalFlags = (): void => { void startFlagWatcher(homeEnv.OPENALICE_HOME, {
    uta: () => { void (async () => {
      tradingMode = await resolveGuardianTradingMode(process.env, homeEnv.OPENALICE_HOME)
      await reconcileUTA(tradingMode, utaUrl, spawnUTA)
    })().catch((err) => console.error('[guardian] UTA mode reconcile failed:', err)) },
    connector: () => { void (async () => {
      await reconcileConnector(
        await readConnectorServiceEnabled(homeEnv.OPENALICE_HOME),
        connectorUrl,
        spawnConnector,
      )
    })().catch((err) => console.error('[guardian] Connector reconcile failed:', err)) },
  }, flagWatchAbort.signal) }
  watchLocalFlags()

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

  let modeSwitching = false
  const { window: win, companion } = createAppWindow(resolve(__dirname, 'preload.js'))
  createTray(win, companion)
  companion?.configureActivity({
    identity: () => {
      if (modeSwitching) return null
      if (!localRuntimeSuspended && win.webContents.getURL().startsWith('app://openalice/')) return `integrated:${userDataHome}`
      const relay = desktopRelay
      return relay && !relay.status.switching && relay.status.target && win.webContents.getURL().startsWith(relay.originUrl)
        ? JSON.stringify([relay.originUrl, relay.status.generation, relay.status.target.machine, relay.status.target.project]) : null
    },
    read: async (query, signal) => {
      const response = !localRuntimeSuspended && win.webContents.getURL().startsWith('app://openalice/')
        ? await fetchAliceWebRequest(new Request(`app://openalice/api/agent-runtime${query}`), alice)
        : await win.webContents.session.fetch(`${desktopRelay!.originUrl}/api/agent-runtime${query}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error('Activity unavailable')
      return response.json()
    },
  })
  configureWindowLifecycle(app, win, () => appQuitting)
  const mayNavigate = (destination: string): boolean => {
    try {
      const url = new URL(destination)
      return (url.protocol === 'app:' && url.host === 'openalice') || url.origin === desktopRelay?.originUrl
    } catch { return false }
  }
  win.webContents.on('will-navigate', (event, destination) => {
    if (mayNavigate(destination)) return
    event.preventDefault()
    if (/^https:\/\//i.test(destination)) void shell.openExternal(destination)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const localProject = resolveAliceProjectIdentity({
    home: userDataHome,
    appRoot: homeEnv.OPENALICE_APP_HOME,
    env: { ...process.env, ...homeEnv },
  })
  let startupMemoryError: string | null = null
  let modeSwitchGeneration = 0
  const rememberLocalSelection = async (current: () => boolean = () => true) => {
    if (smokeStartup || process.env['OPENALICE_HOME']?.trim() || win.isDestroyed() || appQuitting) return
    // An explicit automation home is not necessarily a registered project.
    // Never replace the user's real Default with a disposable smoke identity.
    try {
      if (await resolveLocalStartupHome(localProject.key) !== userDataHome) return
      await writeStartupTarget({ machine: 'local', project: localProject.key }, { current: () => current() && !win.isDestroyed() && !appQuitting })
      startupMemoryError = null
    } catch (error) {
      startupMemoryError = `Connected, but Default was not saved: ${error instanceof Error ? error.message : String(error)}`
      desktopDiagnostics?.write('startup', startupMemoryError)
    }
  }
  const clientUpdates = configureDesktopUpdates(win, updateAttemptPath)
  let relayOpening: Promise<WebRelay> | null = null
  const ensureRelay = (): Promise<WebRelay> => {
    if (!relayOpening) {
      relayOpening = (async () => {
        const uiRoot = app.isPackaged
          ? join(process.resourcesPath, 'runtime', 'ui', 'dist')
          : join(repoRoot, 'ui', 'dist')
        const relay = new WebRelay({ uiRoot, clientUpdates })
        await relay.listen()
        desktopRelay = relay
        return relay
      })().catch((error) => {
        relayOpening = null
        throw error
      })
    }
    return relayOpening
  }
  const assertSwitchResources = (): void => {
    const uiRoot = app.isPackaged
      ? join(process.resourcesPath, 'runtime', 'ui', 'dist')
      : join(repoRoot, 'ui', 'dist')
    if (!existsSync(resolve(__dirname, 'preload.js')) || !existsSync(join(uiRoot, 'index.html'))) {
      throw new Error('Desktop app files are unavailable. Restart from a complete, persistent OpenAlice installation before changing connections.')
    }
  }
  const fromMainWindow = (senderId: number): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed() || senderId !== win.webContents.id) {
      throw new Error('Connection controls are only available in the main window.')
    }
  }
  ipcMain.handle('openalice:desktop-connection:status', async (event) => {
    fromMainWindow(event.sender.id)
    if (localRuntimeSuspended) return (await ensureRelay()).status
    return {
      schemaVersion: 1 as const,
      generation: 0,
      target: {
        machine: 'local', machineName: 'This computer',
        project: '@electron-current', projectName: localProject.displayName,
      },
      switching: modeSwitching,
    }
  })
  ipcMain.handle('openalice:desktop-connection:fleet', async (event) => {
    fromMainWindow(event.sender.id)
    const relay = await ensureRelay()
    const response = await fetch(`${relay.originUrl}/relay/v1/fleet`)
    if (!response.ok) throw new Error(`Machine discovery failed (HTTP ${response.status}).`)
    const fleet = await response.json() as { machines?: Array<{ key: string; projects: unknown[] }> }
    const local = fleet.machines?.find((machine) => machine.key === 'local')
    if (!localRuntimeSuspended && local) {
      local.projects = local.projects.filter((project) => (project as { id?: string }).id !== localProject.id)
      local.projects.unshift({
        key: '@electron-current',
        id: localProject.id,
        displayName: localProject.displayName,
        available: true,
        runtime: { class: 'electron-ipc', state: 'running', webEndpoint: null },
      })
    }
    return fleet
  })
  ipcMain.handle('openalice:desktop-connection:startup-target', async (event) => {
    fromMainWindow(event.sender.id)
    if (localRuntimeSuspended) return (await ensureRelay()).startupPreference()
    try { return { target: await readStartupTarget(), error: startupMemoryError } }
    catch (error) { return { target: null, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('openalice:desktop-connection:project-control', async (event, input: unknown) => {
    fromMainWindow(event.sender.id)
    await (await ensureRelay()).controlProject(input)
  })
  ipcMain.handle('openalice:desktop-machine:plan', async (event, input: unknown) => {
    fromMainWindow(event.sender.id)
    if (!input || typeof input !== 'object') throw new Error('Machine plan input is required.')
    return (await ensureRelay()).planMachine(input as Parameters<WebRelay['planMachine']>[0])
  })
  ipcMain.handle('openalice:desktop-machine:apply', async (event, id: unknown) => {
    fromMainWindow(event.sender.id)
    if (typeof id !== 'string') throw new Error('A reviewed Machine plan is required.')
    return (await ensureRelay()).applyMachine(id)
  })
  ipcMain.handle('openalice:desktop-machine:operation', async (event) => {
    fromMainWindow(event.sender.id)
    return (await ensureRelay()).machineOperation
  })
  ipcMain.handle('openalice:desktop-connection:connect', async (event, machine: unknown, project: unknown) => {
    fromMainWindow(event.sender.id)
    if (modeSwitching) throw new Error('A connection switch is already in progress.')
    const generation = ++modeSwitchGeneration
    if (typeof machine !== 'string' || typeof project !== 'string') {
      throw new Error('Choose a running AliceProject.')
    }
    modeSwitching = true
    try {
      if (localRuntimeSuspended) {
        const relay = await ensureRelay()
        if (typeof machine !== 'string' || typeof project !== 'string') throw new Error('Choose a running AliceProject.')
        await relay.connect(machine, project, {
          current: () => generation === modeSwitchGeneration && !appQuitting && !win.isDestroyed(),
          present: () => win.loadURL(`${relay.originUrl}/settings`),
        })
        return relay.status
      }
      const relay = await ensureRelay()
      // The old local Runtime remains fully owned until the remote candidate
      // has passed the relay's SSH, endpoint, and Project identity checks.
      await relay.connect(machine, project, {
        current: () => generation === modeSwitchGeneration && !appQuitting && !win.isDestroyed(),
        present: async () => {
          assertSwitchResources()
          desktopDiagnostics?.write('guardian', 'remote target verified; loading relay window')
          // Keep the local Runtime until its replacement page is usable.
          await win.loadURL(`${relay.originUrl}/settings`)
        },
      })
      desktopDiagnostics?.write('guardian', 'relay window loaded; retiring local runtime')
      localRuntimeSuspended = true
      flagWatchAbort.abort()
      cancelOpenAliceWebRequests('The desktop window is changing its backend connection.')
      const children = [uta, connector, alice].filter((child): child is ChildProcess => child !== null && childIsRunning(child))
      await Promise.all(children.map((child) => stopChild(child, {
        graceMs: SIGTERM_GRACE_MS,
        sendSignal: (signal) => killTree(child, signal),
      })))
      uta = null
      connector = null
      alice = null
      desktopDiagnostics?.write('guardian', 'local services stopped; releasing local ownership')
      await releaseGuardianRuntimeLock()
      desktopDiagnostics?.write('guardian', 'local ownership released')
      console.log(`[guardian] desktop connection → separated ${machine}/${project}`)
      return relay.status
    } catch (error) {
      // Candidate failure leaves integrated ownership untouched. Once the
      // local Runtime has been retired, keep the verified relay target visible
      // even if loading its first page failed.
      if (!localRuntimeSuspended) {
        desktopRelay?.disconnect()
        if (!win.isDestroyed() && !win.webContents.getURL().startsWith('app://')) {
          await win.loadURL('app://openalice/settings').catch((loadError) => {
            console.error('[guardian] could not restore integrated connection:', loadError)
          })
        }
      }
      else if (desktopRelay && win.webContents.getURL().startsWith('app://')) {
        await win.loadURL(`${desktopRelay.originUrl}/settings`).catch((loadError) => {
          console.error('[guardian] could not show separated connection:', loadError)
        })
      }
      throw error
    } finally {
      modeSwitching = false
    }
  })
  ipcMain.handle('openalice:desktop-connection:return-integrated', async (event) => {
    fromMainWindow(event.sender.id)
    const generation = ++modeSwitchGeneration
    if (!localRuntimeSuspended) return
    if (modeSwitching) throw new Error('A connection switch is already in progress.')
    modeSwitching = true
    try {
      guardianRuntimeLock = await acquireGuardianRuntime({
        userDataHome,
        launcherRoot,
        launcher: app.isPackaged ? 'guardian-electron-packaged' : 'guardian-electron-dev',
        takeover: false,
        processStartedAt: guardianStartedAt,
        onOwnershipLost: (error) => {
          console.error('[guardian] runtime ownership lost:', error)
          shutdown()
        },
      })
      tradingMode = await resolveGuardianTradingMode(process.env, homeEnv.OPENALICE_HOME)
      if (tradingMode.mode !== 'lite') uta = spawnUTA()
      if (await readConnectorServiceEnabled(homeEnv.OPENALICE_HOME)) connector = spawnConnector()
      alice = spawnAlice()
      await waitForAliceReady()
      aliceBecameReady = true
      await win.loadURL('app://openalice/settings')
      localRuntimeSuspended = false
      flagWatchAbort = new AbortController()
      watchLocalFlags()
      desktopRelay?.disconnect()
      await rememberLocalSelection(() => generation === modeSwitchGeneration)
      console.log('[guardian] desktop connection → integrated')
    } catch (error) {
      flagWatchAbort.abort()
      const children = [uta, connector, alice].filter((child): child is ChildProcess => child !== null && childIsRunning(child))
      await Promise.all(children.map((child) => stopChild(child, {
        graceMs: SIGTERM_GRACE_MS,
        sendSignal: (signal) => killTree(child, signal),
      })))
      uta = null
      connector = null
      alice = null
      await releaseGuardianRuntimeLock()
      if (desktopRelay && win.webContents.getURL().startsWith('app://')) {
        await win.loadURL(`${desktopRelay.originUrl}/settings`).catch((loadError) => {
          console.error('[guardian] could not restore separated connection:', loadError)
        })
      }
      throw error
    } finally {
      modeSwitching = false
    }
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
    void win.webContents.executeJavaScript('Boolean(window.openAlice?.pty && window.openAlice?.runtime && window.openAlice?.dataHome && window.openAlice?.keyboard && window.openAlice?.updater)', true)
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
        if (ready && process.env['OPENALICE_ELECTRON_SMOKE_DATA_HOME'] === '1' && !rendererDataHomeSmokeStarted) {
          rendererDataHomeSmokeStarted = true
          void runRendererDataHomeSmoke(win)
            .then((result) => {
              console.log(
                `[guardian] electron smoke data home → ok source=${result.source} lock=${result.selectionLock ?? 'none'} data=${result.currentHome}`,
              )
              if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') shutdown()
            })
            .catch((err) => {
              console.error(`[guardian] electron smoke data home → failed: ${err instanceof Error ? err.message : String(err)}`)
              if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') {
                process.exitCode = 1
                shutdown()
              }
            })
        }
        if (process.env['OPENALICE_ELECTRON_SMOKE_CREDENTIAL_PI'] === '1' && !rendererCredentialPiSmokeStarted) {
          rendererCredentialPiSmokeStarted = true
          void runRendererCredentialPiSmoke(win)
            .then(() => {
              if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') shutdown()
            })
            .catch((err) => {
              console.error(`[guardian] electron smoke credential-pi → failed: ${err instanceof Error ? err.message : String(err)}`)
              if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') {
                process.exitCode = 1
                shutdown()
              }
            })
        }
        if (ready && process.env['OPENALICE_ELECTRON_SMOKE_TRADING_MODE'] === '1' && !rendererTradingModeSmokeStarted) {
          rendererTradingModeSmokeStarted = true
          void runRendererTradingModeSmoke(win)
            .then((result) => {
              console.log(
                `[guardian] electron smoke trading mode → ok ${result.initialMode} -> ${result.activeMode} -> ${result.finalMode}`,
              )
              if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') shutdown()
            })
            .catch((err) => {
              console.error(`[guardian] electron smoke trading mode → failed: ${err instanceof Error ? err.message : String(err)}`)
              if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') {
                process.exitCode = 1
                shutdown()
              }
            })
        }
        if (
          ready &&
          process.env['OPENALICE_ELECTRON_SMOKE_WORKSPACE_ACCEPTANCE'] === '1' &&
          !rendererWorkspaceAcceptanceSmokeStarted
        ) {
          rendererWorkspaceAcceptanceSmokeStarted = true
          const aiBaseUrl = process.env['OPENALICE_WORKSPACE_ACCEPTANCE_AI_BASE_URL']?.trim()
          const receiptPath = process.env['OPENALICE_SMOKE_RECEIPT_PATH']?.trim()
          if (!aiBaseUrl || !receiptPath) {
            console.error('[guardian] electron smoke workspace acceptance → failed: AI base URL or receipt path missing')
            process.exitCode = 1
            if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') shutdown()
          } else {
            void runRendererWorkspaceAcceptanceSmoke(win, aiBaseUrl)
              .then(async (result) => {
                await writeFile(receiptPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
                const failedChecks = Object.entries(result.checks)
                  .filter(([, ok]) => ok !== true)
                  .map(([name]) => name)
                if (failedChecks.length > 0) {
                  throw new Error(
                    `${result.error ?? 'Workspace acceptance failed'}; failed checks: ${failedChecks.join(', ')}`,
                  )
                }
                console.log(`[guardian] electron smoke workspace acceptance → ok ${JSON.stringify(result)}`)
                if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') shutdown()
              })
              .catch((err) => {
                console.error(`[guardian] electron smoke workspace acceptance → failed: ${err instanceof Error ? err.message : String(err)}`)
                if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') {
                  process.exitCode = 1
                  shutdown()
                }
              })
          }
        }
      })
      .catch((err) => {
        console.error(`[guardian] renderer bridge probe failed: ${err instanceof Error ? err.message : String(err)}`)
      })
  })
  await win.loadURL('app://openalice/')
  if (integratedProject) await rememberLocalSelection()

}).catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error('[guardian] desktop startup failed:', error)
  desktopDiagnostics?.write('guardian', `desktop startup failed: ${message}`)
  showFatalDesktopError('OpenAlice could not start', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
  shutdown()
})

async function stopManagedProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
  killTree(child, 'SIGTERM')
  await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, UTA_RESTART_GRACE_MS))])
  if (child.exitCode === null) {
    killTree(child, 'SIGKILL')
    await exited
  }
}

async function reconcileUTA(
  mode: GuardianTradingModePlan,
  utaUrl: string,
  spawnUTA: () => ChildProcess,
): Promise<void> {
  if (appQuitting || localRuntimeSuspended) return
  pendingUTAMode = mode
  if (restartingUTA) return

  restartingUTA = true
  try {
    while (pendingUTAMode && !appQuitting) {
      const targetMode = pendingUTAMode
      pendingUTAMode = null
      const running = uta !== null && uta.exitCode === null
      const action = planUTATransition(targetMode.mode, running)
      if (action === 'none') {
        if (uta?.exitCode !== null) uta = null
        continue
      }

      if (action === 'stop' || action === 'restart') {
        console.log(action === 'stop'
          ? '[guardian] trading mode lite — stopping UTA'
          : `[guardian] trading mode ${targetMode.mode} — restarting UTA`)
        const old = uta
        if (old) await stopManagedProcess(old)
        if (uta === old) uta = null
      }

      if (action === 'start' || action === 'restart') {
        if (action === 'start') console.log(`[guardian] trading mode ${targetMode.mode} — starting UTA`)
        uta = spawnUTA()
        const ready = await waitForUTA(utaUrl)
        console.log(ready ? '[guardian] UTA online' : '[guardian] UTA did not become ready')
      }
    }
  } finally {
    restartingUTA = false
  }
}

async function waitForConnector(connectorUrl: string): Promise<boolean> {
  const deadline = Date.now() + UTA_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${connectorUrl}/__connector/health`)
      if (response.ok) return true
    } catch { /* not ready */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  return false
}

async function reconcileConnector(
  enabled: boolean,
  connectorUrl: string,
  spawnConnector: () => ChildProcess,
): Promise<void> {
  if (appQuitting || localRuntimeSuspended || restartingConnector) return
  restartingConnector = true
  try {
    const running = connector !== null && connector.exitCode === null
    if (!enabled) {
      if (running && connector) {
        console.log('[guardian] Connector disabled — stopping service')
        const old = connector
        await stopManagedProcess(old)
        if (connector === old) connector = null
      }
      return
    }
    if (running && connector) {
      console.log('[guardian] Connector configuration changed — restarting service')
      const old = connector
      await stopManagedProcess(old)
      if (connector === old) connector = null
    } else if (connector?.exitCode !== null) {
      connector = null
    }
    connector = spawnConnector()
    const ready = await waitForConnector(connectorUrl)
    console.log(ready ? '[guardian] Connector online' : '[guardian] Connector did not become ready')
  } finally {
    restartingConnector = false
  }
}

async function startFlagWatcher(
  dataHome: string,
  onTrigger: { uta: () => void; connector: () => void },
  signal?: AbortSignal,
): Promise<void> {
  const flagDir = resolve(dataHome, 'data', 'control')
  const handlers = new Map([
    ['restart-uta.flag', onTrigger.uta],
    ['restart-connector.flag', onTrigger.connector],
  ])
  await mkdir(flagDir, { recursive: true })
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  const fire = (name: string, handler: () => void): void => {
    const prior = pending.get(name)
    if (prior) clearTimeout(prior)
    pending.set(name, setTimeout(() => {
      pending.delete(name)
      handler()
    }, 100))
  }
  try {
    const watcher = watch(flagDir, { signal })
    for await (const evt of watcher) {
      if (!evt.filename) continue
      const handler = handlers.get(evt.filename)
      if (handler) fire(evt.filename, handler)
    }
  } catch (err) {
    if (!signal?.aborted) console.error('[guardian] flag watcher errored:', err)
  } finally {
    for (const timer of pending.values()) clearTimeout(timer)
  }
}

/** Cascade tree-kill every managed child. */
async function stopChildren(): Promise<void> {
  appQuitting = true
  const children = [uta, connector, alice].filter((c): c is ChildProcess => c != null && childIsRunning(c))
  if (children.length === 0) return
  console.log(`[guardian] shutting down — SIGTERM → ${children.length} child(ren)`)
  await Promise.all(
    children.map((c) => stopChild(c, {
      graceMs: SIGTERM_GRACE_MS,
      sendSignal: (signal) => killTree(c, signal),
      onForce: () => {
        console.warn(`[guardian] child pid=${c.pid} did not exit after ${SIGTERM_GRACE_MS}ms → SIGKILL`)
      },
    })),
  )
}

/** Cascade tree-kill both children, then exit once they're gone. */
function shutdown(): void {
  if (appQuitting) return
  void stopChildren().finally(async () => {
    await desktopRelay?.close().catch((error) => console.error('[guardian] relay close failed:', error))
    desktopRelay = null
    await releaseGuardianRuntimeLock()
    const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0
    console.log(`[guardian] shutdown complete → exit ${exitCode}`)
    exitDesktopProcess(exitCode, {
      appExit: (code) => app.exit(code),
      processExit: (code) => process.exit(code),
    })
  })
}

function resolveTrayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'runtime/ui/dist/companion/alice.png')
    : resolve(__dirname, '../../ui/public/companion/alice.png')
}

function createTray(win: BrowserWindow, companion?: CompanionHandle): void {
  const image = nativeImage.createFromPath(resolveTrayIconPath())
  tray = new Tray(image.resize({ width: 22, height: 22 }))
  tray.setToolTip('OpenAlice')

  const show = () => {
    if (!appQuitting) showAppWindow(win)
  }
  const trayMenu = () => Menu.buildFromTemplate([
    { label: 'Show OpenAlice', click: show },
    ...(companion && !companion.window.isDestroyed()
      ? [{ label: 'Pet', submenu: companion.trayMenuItems() }]
      : []),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
  tray.on('click', show)
  tray.on('right-click', () => tray?.popUpContextMenu(trayMenu()))
  if (process.platform === 'linux') tray.setContextMenu(trayMenu())
}

app.on('before-quit', (e) => {
  if (appQuitting) return
  e.preventDefault()
  shutdown()
})

app.on('window-all-closed', () => {
  // Closing a window never shuts down the runtime. The tray Quit action or
  // macOS Cmd+Q/app menu owns explicit shutdown through before-quit.
})
