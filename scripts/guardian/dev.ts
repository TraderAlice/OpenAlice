/**
 * Guardian — dev entry.
 *
 * Spawns optional services + Alice + Vite. UTA is an optional carrier: OPENALICE_LITE_MODE=1
 * skips it entirely; if a normal UTA boot fails, Alice still starts and
 * `/api/trading/*` reports UTA unavailable. Vite comes last because it only
 * needs Alice's port for its dev proxy target.
 *
 * Restart protocol: Guardian watches `data/control/restart-uta.flag`. When
 * Alice touches it (after broker config changes), Guardian SIGTERMs UTA,
 * waits for graceful exit, respawns. Alice stays up the whole time — its
 * BFF proxy returns 502 for `/api/trading/*` until the new UTA is ready.
 *
 * Replaces the previous `scripts/dev.ts`. Same `pnpm dev` UX.
 */

import { delimiter, resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import {
  RuntimeAlreadyRunningError,
  acquireGuardianRuntime,
  currentProcessStartedAt,
  takeoverRequested,
  type RuntimeProcessLock,
} from '../../packages/guardian-runtime/src/index.js'
import {
  readPortsFile,
  resolvePortConfig,
  planPorts,
  spawnChild,
  waitForHttp,
  installCascadeShutdown,
  OptionalServiceController,
  startFlagWatcher,
  readConnectorServiceEnabled,
  resolveGuardianTradingMode,
  type SpawnSpec,
} from './shared.js'
import {
  ALICE_BACKEND_WATCH_INCLUDES,
  UTA_BACKEND_WATCH_INCLUDES,
  CONNECTOR_BACKEND_WATCH_INCLUDES,
  buildTsxWatchArgs,
  isBackendHotReloadEnabled,
} from './dev-hot-reload.js'
import { parseDevGuardianOptions } from './dev-options.js'

let guardianRuntimeLock: RuntimeProcessLock | null = null

async function releaseGuardianRuntimeLock(): Promise<void> {
  const current = guardianRuntimeLock
  guardianRuntimeLock = null
  await current?.release()
}

async function main(): Promise<void> {
  const options = parseDevGuardianOptions(process.argv.slice(2))
  // One global store by default (~/.openalice) — shared with the packaged
  // app. --home is the ergonomic per-checkout override; OPENALICE_HOME stays
  // available for scripts and automation.
  const dataHome = options.home ?? process.env['OPENALICE_HOME'] ?? resolve(homedir(), '.openalice')
  const explicitDataHome = options.home !== null || Boolean(process.env['OPENALICE_HOME'])
  const launcherRoot = process.env['AQ_LAUNCHER_ROOT'] ?? resolve(dataHome, 'workspaces')
  const takeover = takeoverRequested()
  const guardianStartedAt = currentProcessStartedAt()

  try {
    guardianRuntimeLock = await acquireGuardianRuntime({
      userDataHome: dataHome,
      launcherRoot,
      launcher: 'guardian-dev',
      takeover,
      processStartedAt: guardianStartedAt,
      onOwnershipLost: (err) => {
        console.error('[guardian] runtime ownership lost:', err)
        try { process.kill(process.pid, 'SIGTERM') } catch { process.exit(1) }
      },
    })
  } catch (err) {
    if (err instanceof RuntimeAlreadyRunningError) {
      const owner = err.inspection.owner
      console.error(`[guardian] ${err.message}`)
      if (owner) {
        console.error(`[guardian] owner     → ${owner.launcher} pid=${owner.pid} heartbeat=${owner.heartbeatAt}`)
      }
      console.error('[guardian] keep the existing instance, use `pnpm dev -- --home <path>` for an isolated checkout, or run `pnpm dev --takeover` to replace it')
      process.exitCode = 2
      return
    }
    throw err
  }
  if (takeover) console.log('[guardian] takeover → previous OpenAlice runtime stopped')

  // Legacy adoption notice: this checkout has a pre-global-root data/ store
  // and the global one is still virgin. Never auto-move — multiple worktrees
  // may each carry a ./data and only the user knows which is canonical.
  if (
    !explicitDataHome &&
    existsSync(resolve(process.cwd(), 'data', 'config')) &&
    !existsSync(resolve(dataHome, 'data', 'config'))
  ) {
    console.warn('[guardian] ──────────────────────────────────────────────────────')
    console.warn(`[guardian] Found existing data/ in this checkout (${resolve(process.cwd(), 'data')}).`)
    console.warn(`[guardian] OpenAlice now stores user data in ${dataHome}/data.`)
    console.warn(`[guardian] To adopt this checkout's data, stop the stack and run:`)
    console.warn(`[guardian]   mv "$PWD/data" "${dataHome}/data"`)
    console.warn('[guardian] Continuing with a fresh store. (Old behavior: OPENALICE_HOME="$PWD" pnpm dev)')
    console.warn('[guardian] ──────────────────────────────────────────────────────')
  }

  const initialMode = await resolveGuardianTradingMode(process.env, dataHome)
  const liteMode = initialMode.mode === 'lite'
  let connectorEnabled = await readConnectorServiceEnabled(dataHome)

  // env (OPENALICE_*_PORT) > data/config/ports.json > default+probe.
  const ports = await planPorts(resolvePortConfig(process.env, await readPortsFile(dataHome)), {
    skipUta: liteMode,
    skipConnector: !connectorEnabled,
  })
  const flagPath = resolve(dataHome, 'data/control/restart-uta.flag')
  const connectorFlagPath = resolve(dataHome, 'data/control/restart-connector.flag')
  const utaUrl = `http://127.0.0.1:${ports.utaPort}`
  const connectorUrl = `http://127.0.0.1:${ports.connectorPort}`
  const backendHotReload = isBackendHotReloadEnabled(process.env)
  const managedSearchToolsBin = resolve(
    process.cwd(),
    'vendor',
    'tools',
    `${process.platform}-${process.arch}`,
    'bin',
  )
  const searchToolSuffix = process.platform === 'win32' ? '.exe' : ''
  const hasManagedSearchTools = ['fd', 'rg'].every((name) => (
    existsSync(resolve(managedSearchToolsBin, `${name}${searchToolSuffix}`))
  ))
  const managedToolchainPath = [
    ...(hasManagedSearchTools ? [managedSearchToolsBin] : []),
    ...(process.env['OPENALICE_MANAGED_TOOLCHAIN_PATH'] ?? '').split(delimiter).filter(Boolean),
  ].join(delimiter)

  console.log('')
  console.log(`[guardian] mode     →  ${initialMode.mode} (${initialMode.source}${initialMode.envLocked ? ', env-locked' : ''})`)
  console.log(`[guardian] data     →  ${dataHome}`)
  console.log(`[guardian] app      →  ${process.cwd()}`)
  console.log(`[guardian] UTA      →  ${liteMode ? 'disabled (trading mode lite)' : utaUrl}`)
  console.log(`[guardian] Connector→  ${connectorEnabled ? connectorUrl : 'disabled'}`)
  console.log(`[guardian] Alice    →  http://localhost:${ports.webPort}`)
  console.log(`[guardian] Tools    →  http://127.0.0.1:${ports.mcpPort}/cli`)
  console.log(`[guardian] MCP      →  optional on http://127.0.0.1:${ports.mcpPort}/mcp`)
  console.log(`[guardian] UI       →  http://localhost:${ports.uiPort}`)
  console.log(`[guardian] reload   →  ${backendHotReload ? 'backend watch enabled' : 'backend watch disabled'}`)
  console.log(`[guardian] flags    →  ${flagPath}, ${connectorFlagPath}`)
  console.log('')

  const baseEnv = {
    ...process.env,
    NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --conditions=openalice-source`.trim(),
    // Children must resolve the same user-data root the Guardian watches —
    // src/core/paths.ts reads OPENALICE_HOME; never rely on cwd inheritance.
    OPENALICE_HOME: dataHome,
    AQ_LAUNCHER_ROOT: launcherRoot,
    OPENALICE_LAUNCHER: 'dev',
    OPENALICE_GUARDIAN_PID: String(process.pid),
    OPENALICE_GUARDIAN_STARTED_AT: String(guardianStartedAt),
    ...(managedToolchainPath ? { OPENALICE_MANAGED_TOOLCHAIN_PATH: managedToolchainPath } : {}),
    ...(takeover ? { OPENALICE_TAKEOVER: '1' } : {}),
  }

  // ── UTA spec (re-used by Guardian for restart) ────────────
  const utaSpec: SpawnSpec = {
    name: 'uta',
    command: 'tsx',
    args: buildTsxWatchArgs('services/uta/src/main.ts', UTA_BACKEND_WATCH_INCLUDES, process.env),
    env: { ...baseEnv, OPENALICE_UTA_PORT: String(ports.utaPort) },
    prefixLogs: true,
  }

  let uta: OptionalServiceController | null = null
  const spawnUTAController = () => {
    const utaInitial = spawnChild(utaSpec)
    void waitForHttp(`${utaUrl}/__uta/health`, { timeoutMs: 15_000 })
      .then((ready) => {
        if (ready) console.log(`[guardian] UTA ready`)
        else console.warn(`[guardian] UTA did not become ready within 15s — continuing with trading offline`)
      })
    return new OptionalServiceController(utaSpec, `${utaUrl}/__uta/health`, utaInitial)
  }
  if (!liteMode) {
    uta = spawnUTAController()
  }

  const connectorSpec: SpawnSpec = {
    name: 'connector',
    command: 'tsx',
    args: buildTsxWatchArgs('services/connector/src/main.ts', CONNECTOR_BACKEND_WATCH_INCLUDES, process.env),
    env: { ...baseEnv, OPENALICE_CONNECTOR_PORT: String(ports.connectorPort) },
    prefixLogs: true,
  }
  let connector: OptionalServiceController | null = null
  const spawnConnectorController = () => {
    const initial = spawnChild(connectorSpec)
    void waitForHttp(`${connectorUrl}/__connector/health`, { timeoutMs: 15_000 })
      .then((ready) => {
        if (ready) console.log('[guardian] Connector ready')
        else console.warn('[guardian] Connector did not become ready within 15s — continuing without external notifications')
      })
    return new OptionalServiceController(connectorSpec, `${connectorUrl}/__connector/health`, initial)
  }
  if (connectorEnabled) connector = spawnConnectorController()

  // ── Alice ─────────────────────────────────────────────────
  const alice: ChildProcess = spawnChild({
    name: 'alice',
    command: 'tsx',
    args: buildTsxWatchArgs('src/main.ts', ALICE_BACKEND_WATCH_INCLUDES, process.env),
    env: {
      ...baseEnv,
      OPENALICE_WEB_PORT: String(ports.webPort),
      OPENALICE_MCP_PORT: String(ports.mcpPort),
      OPENALICE_TOOL_BASE_URL: `http://127.0.0.1:${ports.mcpPort}/cli`,
      // Where the UI actually lives — consumed by the workspace WS-origin
      // allowlist (src/workspaces/config.ts buildDefaultOrigins).
      OPENALICE_UI_PORT: String(ports.uiPort),
      OPENALICE_UTA_URL: utaUrl,
      OPENALICE_CONNECTOR_URL: connectorUrl,
    },
    prefixLogs: true,
  })

  const aliceReady = await waitForHttp(`http://127.0.0.1:${ports.webPort}/api/version`, { timeoutMs: 20_000 })
  if (!aliceReady) {
    console.error(`[guardian] Alice failed to come up within 20s — aborting before Vite starts`)
    console.error('[guardian] If another process won a startup race, rerun with --takeover or use `pnpm dev -- --home <path>`.')
    try { alice.kill('SIGTERM') } catch { /* noop */ }
    try { uta?.process.kill('SIGTERM') } catch { /* noop */ }
    try { connector?.process.kill('SIGTERM') } catch { /* noop */ }
    await releaseGuardianRuntimeLock().catch(() => undefined)
    process.exit(1)
  }
  console.log(`[guardian] Alice ready`)

  // ── Vite ──────────────────────────────────────────────────
  const vite: ChildProcess = spawnChild({
    name: 'vite',
    command: 'pnpm',
    args: ['--filter', 'open-alice-ui', 'dev'],
    env: {
      ...baseEnv,
      OPENALICE_BACKEND_PORT: String(ports.webPort),
      // Guardian is the port authority: Vite binds exactly this (strictPort).
      OPENALICE_UI_PORT: String(ports.uiPort),
    },
    prefixLogs: true,
  })

  const cascade = installCascadeShutdown({
    children: [...(uta ? [uta.process] : []), ...(connector ? [connector.process] : []), alice, vite],
    ...((uta || connector) ? {
      nonCriticalChildren: new Set([
        ...(uta ? [uta.process] : []),
        ...(connector ? [connector.process] : []),
      ]),
    } : {}),
    onShutdown: releaseGuardianRuntimeLock,
  })

  // UTA restart cooperates with cascade — old SIGTERM is "expected", new
  // child is tracked for unexpected exit + signal forwarding.
  const attachServiceCascade = (controller: OptionalServiceController) => {
    controller.cascade = {
      expectExit: cascade.expectExit,
      trackReplacement: cascade.trackReplacement,
    }
  }
  if (uta) attachServiceCascade(uta)
  if (connector) attachServiceCascade(connector)

  // Alice applies migrations before becoming ready. Re-read the service flag
  // here so an upgraded legacy Telegram install starts Connector Service on
  // the same boot even when connector-service.json did not exist at Guardian
  // planning time.
  connectorEnabled = await readConnectorServiceEnabled(dataHome)
  if (connectorEnabled && !connector) {
    connector = spawnConnectorController()
    cascade.trackChild(connector.process, { nonCritical: true })
    attachServiceCascade(connector)
  }

  // ── Flag watch ────────────────────────────────────────────
  // Triggered by Alice after `accounts.json` mutations. Guardian restarts
  // UTA — Alice and Vite untouched.
  await startFlagWatcher({
    flagPath,
    onTrigger: () => {
      void (async () => {
        const mode = await resolveGuardianTradingMode(process.env, dataHome)
        if (mode.mode === 'lite') {
          if (uta) {
            console.log('[guardian] trading mode lite — stopping UTA')
            cascade.expectExit(uta.process)
            try { uta.process.kill('SIGTERM') } catch { /* noop */ }
            uta = null
          }
          return
        }
        if (!uta) {
          console.log(`[guardian] trading mode ${mode.mode} — starting UTA`)
          uta = spawnUTAController()
          cascade.trackChild(uta.process, { nonCritical: true })
          attachServiceCascade(uta)
          return
        }
        void uta.restart()
      })()
    },
  })

  await startFlagWatcher({
    flagPath: connectorFlagPath,
    onTrigger: () => {
      void (async () => {
        connectorEnabled = await readConnectorServiceEnabled(dataHome)
        if (!connectorEnabled) {
          if (connector) {
            console.log('[guardian] Connector disabled — stopping service')
            cascade.expectExit(connector.process)
            try { connector.process.kill('SIGTERM') } catch { /* noop */ }
            connector = null
          }
          return
        }
        if (!connector) {
          console.log('[guardian] Connector enabled — starting service')
          connector = spawnConnectorController()
          cascade.trackChild(connector.process, { nonCritical: true })
          attachServiceCascade(connector)
          return
        }
        await connector.restart()
      })()
    },
  })
}

main().catch(async (err: unknown) => {
  await releaseGuardianRuntimeLock().catch(() => undefined)
  console.error('[guardian] fatal:', err)
  process.exit(1)
})
