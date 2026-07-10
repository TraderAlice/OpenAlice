/**
 * Electron main process — OpenAlice's desktop guardian.
 *
 * Supervises the same two-process topology as scripts/guardian/prod.mjs:
 *   1. UTA service  (services/uta/dist/uta.js, bind 127.0.0.1)
 *   2. Alice main   (dist/main.js)
 * plus the desktop-only concerns: data relocation, BrowserWindow, quit UX.
 *
 * Lifecycle:
 *   relocate data → resolve ports → spawn UTA unless lite mode disables it
 *   → spawn Alice (UTA URL or lite env injected) → wait Alice ready
 *   → open window. Watch `data/control/restart-uta.flag` → respawn UTA.
 *   On quit or unexpected Alice exit: cascade tree-kill both children.
 *
 * The port + supervision logic is an inline mirror of
 * scripts/guardian/{shared.ts,prod.mjs} — the desktop package is a separate
 * release surface with no TS-dev-tooling dependency, the same reason
 * probe-port.ts is duplicated rather than imported.
 *
 * Out of scope (future iterations): tray icon, multi-window, native menus.
 */

import { app, BrowserWindow, dialog, Menu, protocol, session } from 'electron'
import { runRendererTradingModeSmoke } from './trading-mode-smoke.js'
import { planUTATransition } from './uta-lifecycle.js'
import {
  acquireGuardianRuntime,
  currentProcessStartedAt,
  inspectOpenAliceInstance,
  resolveGuardianTradingMode,
  takeoverRequested,
  type GuardianTradingModePlan,
  type RuntimeProcessLock,
} from '@traderalice/guardian-runtime'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, watch } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { probeFreePort } from './probe-port.js'
import { relocateLegacyData } from './relocate-data.js'
import { configureAutoUpdate } from './auto-update.js'
import { fetchAliceWebRequest, handleOpenAliceIpcMessage, registerOpenAliceIpc } from './ipc.js'
import { proxyEnvFromRules } from './proxy-env.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let uta: ChildProcess | null = null
let alice: ChildProcess | null = null
let appQuitting = false
let restartingUTA = false
let pendingUTAMode: GuardianTradingModePlan | null = null
let rendererOnboardingSmokeStarted = false
let rendererTradingModeSmokeStarted = false
let guardianRuntimeLock: RuntimeProcessLock | null = null

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

function existingFile(path: string): string | null {
  try {
    return existsSync(path) && statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}

function existingDir(path: string): string | null {
  try {
    return existsSync(path) && statSync(path).isDirectory() ? path : null
  } catch {
    return null
  }
}

function resolveManagedRuntimeEnv(opts: {
  readonly appHome: string
  readonly launcherMode: 'electron-dev' | 'electron-packaged'
}): Record<string, string> {
  const out: Record<string, string> = {
    OPENALICE_RUNTIME_PROFILE: opts.launcherMode,
  }
  const platformArch = `${process.platform}-${process.arch}`

  const managedPiCli = existingFile(join(
    opts.appHome,
    'vendor',
    'pi',
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'dist',
    'cli.js',
  ))
  const managedPiBinary = existingFile(join(
    opts.appHome,
    'vendor',
    'pi',
    platformArch,
    process.platform === 'win32' ? 'pi.exe' : 'pi',
  ))
  if (managedPiCli) {
    out.OPENALICE_MANAGED_PI_PATH = managedPiCli
    out.OPENALICE_MANAGED_PI_NODE_PATH = process.execPath
  } else if (managedPiBinary) {
    out.OPENALICE_MANAGED_PI_PATH = managedPiBinary
  }

  const toolchainPaths: string[] = []
  if (process.platform === 'win32') {
    const gitDir = existingDir(join(opts.appHome, 'vendor', 'git', platformArch))
    if (gitDir) {
      out.OPENALICE_MANAGED_GIT_DIR = gitDir
      out.LOCAL_GIT_DIRECTORY = gitDir

      const gitBin =
        existingFile(join(gitDir, 'cmd', 'git.exe')) ??
        existingFile(join(gitDir, 'bin', 'git.exe')) ??
        existingFile(join(gitDir, 'mingw64', 'bin', 'git.exe')) ??
        existingFile(join(gitDir, 'clangarm64', 'bin', 'git.exe'))
      if (gitBin) out.OPENALICE_MANAGED_GIT_BIN = gitBin

      const shellPath =
        existingFile(join(gitDir, 'bin', 'bash.exe')) ??
        existingFile(join(gitDir, 'usr', 'bin', 'bash.exe'))
      if (shellPath) out.OPENALICE_MANAGED_SHELL_PATH = shellPath

      for (const rel of ['cmd', 'bin', 'usr/bin', 'mingw64/bin', 'clangarm64/bin']) {
        const dir = existingDir(join(gitDir, ...rel.split('/')))
        if (dir) toolchainPaths.push(dir)
      }
    }
  } else if (opts.launcherMode === 'electron-packaged') {
    const shellPath = existingFile('/bin/bash') ?? existingFile('/bin/sh')
    if (shellPath) out.OPENALICE_MANAGED_SHELL_PATH = shellPath
  }

  if (toolchainPaths.length > 0) {
    out.OPENALICE_MANAGED_TOOLCHAIN_PATH = toolchainPaths.join(delimiter)
  }

  return out
}

async function resolveChildProxyEnv(): Promise<Record<string, string>> {
  // Existing env is authoritative on every platform. Electron 39 embeds Node
  // 22.22, whose fetch stack consumes it only when NODE_USE_ENV_PROXY is set.
  const explicit = proxyEnvFromRules('', process.env)
  if (Object.keys(explicit).length > 0 || process.env['HTTPS_PROXY'] || process.env['HTTP_PROXY'] || process.env['ALL_PROXY']) {
    return explicit
  }
  if (process.platform !== 'win32') return {}

  try {
    // Chromium already understands Windows Internet Options, including PAC.
    // Resolve one representative HTTPS API URL and pass a concrete proxy to
    // the pure-Node Alice/UTA children, whose fetch does not consult Chromium.
    const rules = await session.defaultSession.resolveProxy('https://api.openai.com/')
    return proxyEnvFromRules(rules, process.env)
  } catch (err) {
    console.warn(`[guardian] could not resolve Windows system proxy: ${err instanceof Error ? err.message : String(err)}`)
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

async function runRendererOnboardingSmoke(win: BrowserWindow): Promise<void> {
  const result = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const json = async (res) => {
      const text = await res.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      if (!res.ok) throw new Error(res.status + ' ' + text)
      return body
    }
    const waitFor = async (label, predicate, timeoutMs = 12000) => {
      const deadline = Date.now() + timeoutMs
      let last = null
      while (Date.now() < deadline) {
        try {
          const value = await predicate()
          if (value) return value
        } catch (err) {
          last = err
        }
        await sleep(100)
      }
      throw new Error('Timed out waiting for ' + label + (last ? ': ' + (last.message || String(last)) : ''))
    }
    const activeStep = () => document
      .querySelector('[data-testid="first-run-guide-step"]')
      ?.getAttribute('data-onboarding-step') || null
    const clickPrimary = () => {
      const button = document.querySelector('[data-testid="first-run-guide-primary"]')
      if (!button) throw new Error('first-run primary button missing')
      button.click()
    }

    await waitFor('Electron preload bridge', () => Boolean(window.openAlice?.runtime && window.openAlice?.pty))

    const agents = await json(await fetch('/api/workspaces/agents'))
    const pi = agents.agents?.find((agent) => agent.id === 'pi')
    if (!pi?.installed) throw new Error('managed Pi was not detected by packaged /agents')

    const tradingStatus = await json(await fetch('/api/trading/status'))
    if (tradingStatus.mode !== 'lite') {
      throw new Error('expected fresh onboarding trading mode to be lite, got ' + tradingStatus.mode)
    }

    await waitFor('first-run guide', () => document.querySelector('[data-testid="first-run-guide"]'))
    await waitFor('language step', () => activeStep() === 'language' ? true : false)
    clickPrimary()
    await waitFor('welcome step', () => activeStep() === 'lite' ? true : false)
    clickPrimary()
    await waitFor('AI access step', () => activeStep() === 'ai' ? true : false)

    const readiness = await waitFor('Pi runtime readiness', async () => {
      const snapshot = await json(await fetch('/api/workspaces/agent-runtime-readiness'))
      const row = snapshot.agents?.pi
      if (row?.ready && row.status === 'ready') return snapshot
      if (row && row.status !== 'unknown' && row.status !== 'checking') {
        throw new Error('Pi readiness was ' + row.status + ': ' + (row.message || 'no detail'))
      }
      return null
    }, 60000)
    const piReady = readiness.agents.pi

    await waitFor('AI ready primary button', async () => {
      const snapshot = await json(await fetch('/api/workspaces/agent-runtime-readiness'))
      const row = snapshot.agents?.pi
      const button = document.querySelector('[data-testid="first-run-guide-primary"]')
      return activeStep() === 'ai' && row?.ready === true && button && !button.disabled
    }, 60000)
    clickPrimary()
    await waitFor('broker step', () => activeStep() === 'broker' ? true : false)

    return {
      ok: true,
      step: activeStep(),
      piPath: pi.binPath || null,
      runtimeStatus: piReady.status,
      runtimeSource: piReady.source,
      tradingMode: tradingStatus.mode,
    }
  })()`, true) as {
    ok?: boolean
    step?: string
    piPath?: string | null
    runtimeStatus?: string
    runtimeSource?: string
    tradingMode?: string
  }
  console.log(
    `[guardian] electron smoke onboarding → ok step=${result.step ?? ''} mode=${result.tradingMode ?? ''} pi=${result.piPath ?? 'managed'} runtime=${result.runtimeStatus ?? ''}/${result.runtimeSource ?? ''}`,
  )
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

  // Resolve duplicate ownership before relocation, port reads, or any child
  // process can mutate the selected store.
  const launcherRoot = process.env['AQ_LAUNCHER_ROOT']?.trim() || join(userDataHome, 'workspaces')
  let takeover = takeoverRequested()
  const guardianStartedAt = currentProcessStartedAt()
  const runtimeInspections = await inspectOpenAliceInstance({
    userDataHome,
    launcherRoot,
  })
  const activeRuntime = runtimeInspections.find((row) => row.state === 'active' && row.owner)
  if (activeRuntime && !takeover) {
    const owner = activeRuntime.owner!
    const staleDetail = activeRuntime.heartbeatStale
      ? '\n\nThe process is still present, but its health heartbeat is stale.'
      : ''
    const { response } = await dialog.showMessageBox({
      type: activeRuntime.heartbeatStale ? 'warning' : 'question',
      title: 'OpenAlice is already running',
      message: `Another OpenAlice ${owner.launcher} instance is using this data.`,
      detail: `PID ${owner.pid}\nData: ${userDataHome}\nLast heartbeat: ${owner.heartbeatAt}${staleDetail}`,
      buttons: ['Keep existing instance', 'Stop it and start this OpenAlice'],
      defaultId: activeRuntime.heartbeatStale ? 1 : 0,
      cancelId: 0,
      noLink: true,
    })
    if (response !== 1) {
      app.quit()
      return
    }
    takeover = true
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
  let tradingMode = await resolveGuardianTradingMode(process.env, homeEnv.OPENALICE_HOME)
  const mcpPort = mcpEnabled
    ? await claimPort('mcp', 'OPENALICE_MCP_PORT', portsFile.mcp ?? mcpFile.port, DEFAULT_WEB_PORT_START + 1)
    : null
  const utaPortFallback = mcpPort !== null ? mcpPort + 1 : DEFAULT_WEB_PORT_START + 1
  const utaPort = tradingMode.mode === 'lite'
    ? selectPort('OPENALICE_UTA_PORT', portsFile.uta, utaPortFallback).value
    : await claimPort('uta', 'OPENALICE_UTA_PORT', portsFile.uta, utaPortFallback)
  const utaUrl = `http://127.0.0.1:${utaPort}`
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
        ...(takeover ? { OPENALICE_TAKEOVER: '1' } : {}),
        ...homeEnv,
        ...runtimeEnv,
        ...proxyEnv,
      },
      stdio: 'inherit',
    })
    child.once('exit', (code, signal) => {
      if (appQuitting || restartingUTA) return
      console.error(`[guardian] UTA exited unexpectedly code=${code} signal=${signal} — trading offline, app stays up`)
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
        OPENALICE_UTA_URL: utaUrl,
        OPENALICE_LAUNCHER: 'electron',
        OPENALICE_GUARDIAN_PID: String(process.pid),
        OPENALICE_GUARDIAN_STARTED_AT: String(guardianStartedAt),
        AQ_LAUNCHER_ROOT: launcherRoot,
        ...(takeover ? { OPENALICE_TAKEOVER: '1' } : {}),
        ...homeEnv,
        ...runtimeEnv,
        ...proxyEnv,
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
  console.log(`[guardian] mode     →  ${launcherMode}; trading=${tradingMode.mode} (${tradingMode.source}${tradingMode.envLocked ? ', env-locked' : ''})`)
  console.log(`[guardian] data     →  ${homeEnv.OPENALICE_HOME}`)
  console.log(`[guardian] app      →  ${homeEnv.OPENALICE_APP_HOME}`)
  console.log(`[guardian] runtime  →  ${piRuntime}`)
  console.log(`[guardian] UTA      →  ${tradingMode.mode === 'lite' ? 'disabled (trading mode lite)' : utaUrl}`)
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
  if (tradingMode.mode !== 'lite') {
    uta = spawnUTA()
    void waitForUTA(utaUrl).then((ready) => {
      if (ready) console.log(`[guardian] UTA ready pid=${uta?.pid ?? ''}`)
      else console.warn(`[guardian] UTA did not become ready within ${UTA_READY_TIMEOUT_MS / 1000}s — continuing with trading offline`)
    })
  }

  alice = spawnAlice()
  console.log(`[guardian] Alice pid=${alice.pid} web=ipc mcpPort=${mcpPort ?? 'disabled'}`)
  await waitForAliceReady()

  // ── Restart-flag watcher: broker config changes touch the flag; SIGTERM
  // + respawn UTA without restarting Alice (mirrors prod.mjs). ────────────
  void startFlagWatcher(homeEnv.OPENALICE_HOME, () => {
    void (async () => {
      tradingMode = await resolveGuardianTradingMode(process.env, homeEnv.OPENALICE_HOME)
      await reconcileUTA(tradingMode, utaUrl, spawnUTA)
    })().catch((err) => console.error('[guardian] UTA mode reconcile failed:', err))
  })

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
        if (process.env['OPENALICE_ELECTRON_SMOKE_ONBOARDING'] === '1' && !rendererOnboardingSmokeStarted) {
          rendererOnboardingSmokeStarted = true
          void runRendererOnboardingSmoke(win)
            .then(() => {
              if (process.env['OPENALICE_ELECTRON_SMOKE_EXIT'] === '1') shutdown()
            })
            .catch((err) => {
              console.error(`[guardian] electron smoke onboarding → failed: ${err instanceof Error ? err.message : String(err)}`)
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
      })
      .catch((err) => {
        console.error(`[guardian] renderer bridge probe failed: ${err instanceof Error ? err.message : String(err)}`)
      })
  })
  win.loadURL('app://openalice/')

  configureAutoUpdate(win, { beforeInstall: stopChildren })
})

async function stopUTAProcess(child: ChildProcess): Promise<void> {
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
  if (appQuitting) return
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
        if (old) await stopUTAProcess(old)
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

async function startFlagWatcher(
  dataHome: string,
  onTrigger: () => void,
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
      onTrigger()
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
  void stopChildren().finally(async () => {
    const current = guardianRuntimeLock
    guardianRuntimeLock = null
    await current?.release().catch((err) => console.error('[guardian] runtime lock release failed:', err))
    const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0
    app.exit(exitCode)
  })
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
