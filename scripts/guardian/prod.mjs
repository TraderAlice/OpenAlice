#!/usr/bin/env node
/**
 * Guardian — built-runtime entry, used by Docker and the local CLI.
 *
 * tini runs as PID 1 (signal forwarding + zombie reaping); this script is
 * the orchestrator tini supervises. It spawns the long-lived Node services
 * that make up a built OpenAlice Runtime:
 *
 *   1. UTA service  (services/uta/dist/uta.js, bind 127.0.0.1:47333)
 *   2. Connector Service (optional, bind 127.0.0.1:47334)
 *   3. Alice main   (dist/main.js, bind OPENALICE_BIND_HOST:47331)
 *
 * Lifecycle:
 *   - spawn UTA, poll /__uta/health for observability (Alice still boots if
 *     UTA is offline). OPENALICE_LITE_MODE=1 skips UTA entirely.
 *   - spawn Alice with OPENALICE_UTA_URL pointing at the local UTA, or
 *     OPENALICE_LITE_MODE=1 when the carrier is intentionally disabled
 *   - watch `${OPENALICE_HOME}/data/control/restart-uta.flag`
 *     for UI-triggered broker config changes; SIGTERM + respawn UTA
 *     when it changes (debounced 100ms)
 *   - SIGTERM/SIGINT from tini cascades to both children, then exit
 *   - Alice exiting unintentionally cascades shutdown; UTA exiting marks
 *     trading offline but does not take down the app
 *
 * Mirrors `scripts/guardian/dev.ts` minus the Vite child and watch-mode
 * spawns. Kept as `.mjs` so the runtime image needs no TS tooling.
 */

import { spawn } from 'node:child_process'
import { createDecipheriv, randomUUID } from 'node:crypto'
import { mkdir, readFile, watch } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  acquireGuardianRuntime,
  startGuardianControlServer,
  currentProcessStartedAt,
  buildGuardianRuntimeStatus,
  aliceProjectEnvironment,
  resolveAliceProjectIdentity,
  readAliceProjectProduct,
  normalizeProcessExitCode,
  resolveRailwayRuntimeFence,
  resolveRuntimeLockOwnerAuthority,
  RestartBackoff,
  takeoverRequested,
} from '@traderalice/guardian-runtime'
import {
  planProdPorts,
  readProdPortsFile,
  resolveProdPortConfig,
} from './prod-ports.mjs'
import { runtimeProcessSpec } from './runtime-process-spec.mjs'

const DATA_HOME = process.env.OPENALICE_HOME
  ?? process.env.OPENALICE_USER_DATA_HOME // deprecated alias, one-release courtesy
  ?? '/data'
const RAILWAY_FENCE_CLAIMED = Boolean(
  process.env.OPENALICE_RAILWAY_FENCE_FD
  || process.env.OPENALICE_RAILWAY_ENTRYPOINT_OWNER,
)
const RAILWAY_RUNTIME_REQUIRED = process.env.OPENALICE_SERVICE_MANAGER?.trim() === 'railway'
const RUNTIME_LOCK_OWNER_AUTHORITY = resolveRuntimeLockOwnerAuthority(process.env)
const RAILWAY_RUNTIME_FENCE = RUNTIME_LOCK_OWNER_AUTHORITY === 'railway-fenced-handoff'
  ? resolveRailwayRuntimeFence(process.env)
  : null
delete process.env.OPENALICE_RAILWAY_FENCE_FD
delete process.env.OPENALICE_RAILWAY_ENTRYPOINT_OWNER
const LAUNCHER_ROOT = process.env.AQ_LAUNCHER_ROOT ?? resolve(DATA_HOME, 'workspaces')
const LAUNCHER = process.env.OPENALICE_LAUNCHER?.trim() || 'docker'
const GUARDIAN_LAUNCHER = LAUNCHER.startsWith('guardian-') ? LAUNCHER : `guardian-${LAUNCHER}`
const NODE_BINARY = process.env.OPENALICE_NODE_BINARY?.trim() || process.execPath
const RUNTIME_EXECUTABLE = process.env.OPENALICE_RUNTIME_EXECUTABLE?.trim() || process.execPath
const BIND_HOST = process.env.OPENALICE_BIND_HOST?.trim() || '127.0.0.1'
const GUARDIAN_STARTED_AT = currentProcessStartedAt()
const TAKEOVER = takeoverRequested()
const SERVER_MODE = process.env.OPENALICE_SERVER_MODE?.trim() || 'foreground'
const GUARDIAN_INSTANCE_ID = randomUUID()
const RUNTIME_PROVIDER = resolveRuntimeProvider()
const RUNTIME_CONTENT_IDENTITY = normalizeContentIdentity(
  process.env.OPENALICE_RUNTIME_CONTENT_IDENTITY,
)
const ALICE_PROJECT = resolveAliceProjectIdentity({
  home: DATA_HOME,
  appRoot: process.env.OPENALICE_APP_HOME ?? process.cwd(),
  env: process.env,
  key: process.env.OPENALICE_PROJECT ?? 'default',
})
const ALICE_PROJECT_ENV = aliceProjectEnvironment(ALICE_PROJECT)

function truthyEnv(raw) {
  if (raw === undefined || raw === '') return false
  const normalized = String(raw).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function resolveRuntimeProvider() {
  const explicit = process.env.OPENALICE_RUNTIME_PROVIDER?.trim()
  if (['source', 'bundle', 'bun', 'docker', 'remote'].includes(explicit)) return explicit
  return LAUNCHER === 'docker' ? 'docker' : 'source'
}

function normalizeContentIdentity(value) {
  const normalized = String(value ?? '').trim()
  return /^[A-Za-z0-9._-]{1,128}$/.test(normalized) ? normalized : null
}

function pendingActivation() {
  const productVersion = String(
    process.env.OPENALICE_PENDING_ACTIVATION_VERSION ?? '',
  ).trim()
  if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(productVersion)) return null
  return {
    productVersion,
    restartRequired: true,
    reason: 'A staged OpenAlice release is waiting for this Runtime to restart',
  }
}

function isLiteModeEnv(env) {
  return truthyEnv(env.OPENALICE_LITE_MODE) || truthyEnv(env.OPENALICE_UTA_DISABLED)
}

function parseTradingModeEnv(env) {
  const raw = String(env.OPENALICE_TRADING_MODE ?? '').trim().toLowerCase()
  if (raw === 'lite' || raw === 'readonly' || raw === 'pro') return raw
  return isLiteModeEnv(env) ? 'lite' : null
}

async function readPersistedTradingMode(userDataHome) {
  try {
    const raw = JSON.parse(await readFile(resolve(userDataHome, 'data', 'config', 'trading.json'), 'utf8'))
    return raw.mode === 'lite' || raw.mode === 'readonly' || raw.mode === 'pro' ? raw.mode : null
  } catch {
    return null
  }
}

function isSealedEnvelope(value) {
  return (
    typeof value === 'object' && value !== null &&
    value.$sealed === 1 &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.data === 'string'
  )
}

async function unsealAccounts(userDataHome, envelope) {
  if (envelope.alg !== 'aes-256-gcm') return []
  const keyRaw = (await readFile(resolve(userDataHome, 'sealing.key'), 'utf8')).trim()
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyRaw, 'base64'), Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8'))
}

async function hasPersistedUTAs(userDataHome) {
  try {
    const raw = JSON.parse(await readFile(resolve(userDataHome, 'data', 'config', 'accounts.json'), 'utf8'))
    const accounts = isSealedEnvelope(raw) ? await unsealAccounts(userDataHome, raw) : raw
    return Array.isArray(accounts) && accounts.length > 0
  } catch {
    return false
  }
}

async function resolveTradingMode(env, userDataHome) {
  const envMode = parseTradingModeEnv(env)
  const configuredMode = await readPersistedTradingMode(userDataHome)
  const hasUTAConfig = await hasPersistedUTAs(userDataHome)
  if (envMode) return { mode: envMode, source: 'env', envLocked: true, hasUTAConfig }
  if (configuredMode) return { mode: configuredMode, source: 'config', envLocked: false, hasUTAConfig }
  return { mode: hasUTAConfig ? 'pro' : 'lite', source: 'auto', envLocked: false, hasUTAConfig }
}

// Port precedence and collision behavior mirror scripts/guardian/shared.ts:
// explicit env/file values fail if occupied, while defaults probe upward.
// The built Guardian keeps this logic in runnable ESM because source-backed
// and Docker production paths do not ship a TypeScript loader.
let TRADING_MODE
let PROJECT_PRODUCT
let SKIP_UTA
let WEB_PORT
let MCP_PORT
let UTA_PORT
let CONNECTOR_PORT
let FLAG_PATH
let CONNECTOR_FLAG_PATH
let UTA_URL
let CONNECTOR_URL
let stopping = false
let shutdownExitCode = 0
let utaChild = null
let connectorChild = null
let aliceChild = null
let restartingUTA = false
let restartingConnector = false
let guardianRuntimeLock = null
let guardianControlServer = null
let aliceStatus = 'starting'
let utaStatus = 'starting'
let connectorStatus = 'disabled'
const connectorRecovery = new RestartBackoff({
  onScheduled: (delayMs, attempt) => {
    connectorStatus = 'offline'
    console.warn(`[guardian/prod] Connector recovery attempt ${attempt} in ${delayMs}ms`)
  },
})
let RUNTIME_VERSION = 'dev'

async function readRuntimeVersion() {
  try {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : 'dev'
  } catch {
    return 'dev'
  }
}

function runtimeStatus() {
  const owner = guardianRuntimeLock?.owner
  const capabilities = LAUNCHER === 'cli-server' ? ['runtime.stop'] : []
  return buildGuardianRuntimeStatus({
    productVersion: RUNTIME_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    state: stopping ? 'stopping' : aliceStatus === 'ready' ? 'running' : 'starting',
    home: resolve(DATA_HOME),
    aliceProject: ALICE_PROJECT,
    owner: {
      surface: LAUNCHER,
      pid: process.pid,
      instanceId: GUARDIAN_INSTANCE_ID,
      startedAt: owner?.acquiredAt ?? new Date(GUARDIAN_STARTED_AT).toISOString(),
      launchRoot: resolve(process.env.OPENALICE_APP_HOME ?? process.cwd()),
      mode: SERVER_MODE,
    },
    endpoints: {
      web: `http://${BIND_HOST}:${WEB_PORT}`,
    },
    provider: {
      kind: RUNTIME_PROVIDER,
      ...(RUNTIME_PROVIDER === 'source'
        ? { root: resolve(process.env.OPENALICE_APP_HOME ?? process.cwd()) }
        : {}),
      ...(RUNTIME_PROVIDER === 'bun'
        ? { root: resolve(process.env.OPENALICE_APP_HOME ?? process.cwd()) }
        : {}),
      ...(RUNTIME_CONTENT_IDENTITY
        ? { contentIdentity: RUNTIME_CONTENT_IDENTITY }
        : {}),
    },
    pendingActivation: pendingActivation(),
    startedAtMs: GUARDIAN_STARTED_AT,
    components: {
      alice: aliceStatus,
      uta: utaStatus,
      connector: connectorStatus,
    },
    componentDetail: {
      alice: {
        state: aliceStatus,
        required: true,
        ...(aliceChild?.pid ? { pid: aliceChild.pid } : {}),
      },
      uta: {
        state: utaStatus,
        required: false,
        ...(utaChild?.pid ? { pid: utaChild.pid } : {}),
      },
      connector: {
        state: connectorStatus,
        required: false,
        ...(connectorChild?.pid ? { pid: connectorChild.pid } : {}),
      },
    },
    capabilities,
  })
}

async function readConnectorEnabled() {
  try {
    const raw = JSON.parse(await readFile(resolve(DATA_HOME, 'data/config/connector-service.json'), 'utf8'))
    return raw.enabled === true
  } catch {
    return false
  }
}

function makeUTASpec() {
  const processSpec = runtimeProcessSpec({
    role: 'uta',
    legacyPath: 'services/uta/dist/uta.js',
    provider: RUNTIME_PROVIDER,
    executable: RUNTIME_EXECUTABLE,
    nodeBinary: NODE_BINARY,
  })
  return {
    ...processSpec,
    env: {
      ...process.env,
      ...ALICE_PROJECT_ENV,
      OPENALICE_UTA_PORT: String(UTA_PORT),
      OPENALICE_HOME: DATA_HOME,
      AQ_LAUNCHER_ROOT: LAUNCHER_ROOT,
      OPENALICE_LAUNCHER: LAUNCHER,
      OPENALICE_GUARDIAN_PID: String(process.pid),
      OPENALICE_GUARDIAN_STARTED_AT: String(GUARDIAN_STARTED_AT),
      ...(TAKEOVER ? { OPENALICE_TAKEOVER: '1' } : {}),
    },
  }
}

function spawnUTA() {
  const spec = makeUTASpec()
  const child = spawn(spec.cmd, spec.args, trustedRailwayChildOptions(spec.env))
  child.once('exit', (code, signal) => {
    if (utaChild === child) utaChild = null
    if (stopping || restartingUTA) return
    utaStatus = 'offline'
    console.error(`[guardian/prod] UTA exited unexpectedly (code=${code}, signal=${signal}) — trading offline, Alice stays up`)
  })
  return child
}

function spawnConnector() {
  const spec = runtimeProcessSpec({
    role: 'connector',
    legacyPath: 'services/connector/dist/connector.cjs',
    provider: RUNTIME_PROVIDER,
    executable: RUNTIME_EXECUTABLE,
    nodeBinary: NODE_BINARY,
  })
  const child = spawn(spec.cmd, spec.args, {
    ...trustedRailwayChildOptions({
      ...process.env,
      ...ALICE_PROJECT_ENV,
      OPENALICE_CONNECTOR_PORT: String(CONNECTOR_PORT),
      OPENALICE_HOME: DATA_HOME,
      AQ_LAUNCHER_ROOT: LAUNCHER_ROOT,
      OPENALICE_LAUNCHER: LAUNCHER,
      OPENALICE_GUARDIAN_PID: String(process.pid),
      OPENALICE_GUARDIAN_STARTED_AT: String(GUARDIAN_STARTED_AT),
      ...(TAKEOVER ? { OPENALICE_TAKEOVER: '1' } : {}),
    }),
  })
  child.once('exit', (code, signal) => {
    if (connectorChild === child) connectorChild = null
    if (stopping || restartingConnector) return
    connectorStatus = 'offline'
    console.error(`[guardian/prod] Connector exited unexpectedly (code=${code}, signal=${signal}) — external notifications offline, Alice stays up`)
    scheduleConnectorRecovery()
  })
  return child
}

function spawnAlice() {
  const spec = runtimeProcessSpec({
    role: 'alice',
    legacyPath: 'dist/main.js',
    provider: RUNTIME_PROVIDER,
    executable: RUNTIME_EXECUTABLE,
    nodeBinary: NODE_BINARY,
  })
  const child = spawn(spec.cmd, spec.args, {
    ...trustedRailwayChildOptions({
      ...process.env,
      ...ALICE_PROJECT_ENV,
      OPENALICE_WEB_PORT: String(WEB_PORT),
      OPENALICE_MCP_PORT: String(MCP_PORT),
      OPENALICE_TOOL_BASE_URL: `http://127.0.0.1:${MCP_PORT}/cli`,
      OPENALICE_UTA_URL: UTA_URL,
      OPENALICE_CONNECTOR_URL: CONNECTOR_URL,
      OPENALICE_HOME: DATA_HOME,
      AQ_LAUNCHER_ROOT: LAUNCHER_ROOT,
      OPENALICE_LAUNCHER: LAUNCHER,
      OPENALICE_GUARDIAN_PID: String(process.pid),
      OPENALICE_GUARDIAN_STARTED_AT: String(GUARDIAN_STARTED_AT),
      ...(TAKEOVER ? { OPENALICE_TAKEOVER: '1' } : {}),
      ...(PROJECT_PRODUCT === 'nano'
        ? { OPENALICE_PROJECT_PRODUCT: 'nano', OPENALICE_UTA_DISABLED: '1' }
        : {}),
    }),
  })
  child.once('exit', (code, signal) => {
    if (stopping) return
    aliceStatus = 'offline'
    console.error(`[guardian/prod] Alice exited unexpectedly (code=${code}, signal=${signal})`)
    shutdown(typeof code === 'number' && code !== 0 ? code : 1)
  })
  return child
}

function trustedRailwayChildOptions(env) {
  if (!RAILWAY_RUNTIME_FENCE) return { env, stdio: 'inherit' }
  return {
    env: {
      ...env,
      OPENALICE_RAILWAY_FENCE_FD: '3',
    },
    stdio: ['inherit', 'inherit', 'inherit', RAILWAY_RUNTIME_FENCE.fd],
  }
}

async function waitForUTA() {
  const url = `${UTA_URL}/__uta/health`
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch { /* not ready */ }
    await sleep(200)
  }
  return false
}

async function waitForAlice() {
  const url = `http://127.0.0.1:${WEB_PORT}/api/auth/status`
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const body = await res.json()
        if (typeof body?.authed === 'boolean' && typeof body?.tokenConfigured === 'boolean') return true
      }
    } catch { /* not ready */ }
    await sleep(200)
  }
  return false
}

async function waitForConnector() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${CONNECTOR_URL}/__connector/health`)
      if (res.ok) return true
    } catch { /* not ready */ }
    await sleep(200)
  }
  return false
}

async function restartConnector({ recovery = false } = {}) {
  if (stopping) return false
  if (!recovery) connectorRecovery.reset()
  const enabled = await readConnectorEnabled()
  if (!enabled) {
    if (connectorChild && connectorChild.exitCode === null) {
      console.log('[guardian/prod] Connector disabled — stopping service')
      restartingConnector = true
      try { connectorChild.kill('SIGTERM') } catch { /* noop */ }
      restartingConnector = false
      connectorChild = null
    }
    connectorStatus = 'disabled'
    return true
  }
  if (restartingConnector) return false
  restartingConnector = true
  connectorStatus = 'starting'
  try {
    const old = connectorChild
    if (old && old.exitCode === null) {
      const exited = new Promise((resolveExit) => old.once('exit', resolveExit))
      try { old.kill('SIGTERM') } catch { /* noop */ }
      await Promise.race([exited, sleep(8_000)])
      if (old.exitCode === null) {
        try { old.kill('SIGKILL') } catch { /* noop */ }
        await exited
      }
    }
    connectorChild = spawnConnector()
    const ready = await waitForConnector()
    connectorStatus = ready ? 'ready' : 'offline'
    if (!ready) {
      console.error('[guardian/prod] Connector did not become ready')
      scheduleConnectorRecovery()
    }
    else {
      connectorRecovery.reset()
      console.log('[guardian/prod] Connector ready')
    }
    return ready
  } catch (error) {
    connectorStatus = 'offline'
    scheduleConnectorRecovery()
    throw error
  } finally {
    restartingConnector = false
  }
}

function scheduleConnectorRecovery() {
  connectorRecovery.schedule(() => restartConnector({ recovery: true }))
}

async function restartUTA() {
  if (stopping) return
  TRADING_MODE = await resolveTradingMode(process.env, DATA_HOME)
  const product = await readAliceProjectProduct(DATA_HOME)
  if (product === 'nano' || TRADING_MODE.mode === 'lite') {
    if (utaChild && utaChild.exitCode === null) {
      console.log(`[guardian/prod] ${product === 'nano' ? 'NanoAlice' : 'trading mode lite'} — stopping UTA`)
      restartingUTA = true
      try { utaChild.kill('SIGTERM') } catch { /* noop */ }
      restartingUTA = false
      utaChild = null
    } else {
      console.warn(`[guardian/prod] restart-uta.flag ignored — ${product === 'nano' ? 'NanoAlice' : 'trading mode lite'} disables UTA`)
    }
    utaStatus = 'disabled'
    return
  }
  if (restartingUTA) return
  restartingUTA = true
  utaStatus = 'starting'
  try {
    if (!utaChild) {
      console.log(`[guardian/prod] trading mode ${TRADING_MODE.mode} — starting UTA`)
      utaChild = spawnUTA()
      const ready = await waitForUTA()
      utaStatus = ready ? 'ready' : 'offline'
      if (!ready) console.error('[guardian/prod] UTA did not come up')
      else console.log('[guardian/prod] UTA ready')
      return
    }
    console.log('[guardian/prod] restart-uta.flag triggered — restarting UTA')
    const old = utaChild
    if (old && old.exitCode === null) {
      const exited = new Promise((r) => old.once('exit', () => r()))
      try { old.kill('SIGTERM') } catch { /* noop */ }
      await Promise.race([exited, sleep(8_000)])
      if (old.exitCode === null) {
        try { old.kill('SIGKILL') } catch { /* noop */ }
        await exited
      }
    }
    utaChild = spawnUTA()
    const ready = await waitForUTA()
    utaStatus = ready ? 'ready' : 'offline'
    if (!ready) {
      console.error('[guardian/prod] UTA did not come back up after restart')
    } else {
      console.log('[guardian/prod] UTA back online')
    }
  } finally {
    restartingUTA = false
  }
}

function shutdown(exitCode = 0) {
  shutdownExitCode = Math.max(shutdownExitCode, normalizeProcessExitCode(exitCode))
  if (stopping) return
  stopping = true
  connectorRecovery.stop()
  if (aliceChild) aliceStatus = 'stopping'
  if (utaChild) utaStatus = 'stopping'
  if (connectorChild) connectorStatus = 'stopping'
  console.log('[guardian/prod] shutting down')
  for (const c of [utaChild, connectorChild, aliceChild]) {
    if (c && c.exitCode === null && !c.killed) {
      try { c.kill('SIGTERM') } catch { /* noop */ }
    }
  }
  setTimeout(() => {
    for (const c of [utaChild, connectorChild, aliceChild]) {
      if (c && c.exitCode === null) {
        try { c.kill('SIGKILL') } catch { /* noop */ }
      }
    }
    const currentControl = guardianControlServer
    guardianControlServer = null
    const current = guardianRuntimeLock
    guardianRuntimeLock = null
    void Promise.resolve(currentControl?.close())
      .catch((err) => console.error('[guardian/prod] control endpoint close failed:', err))
      .then(() => current?.release())
      .catch((err) => console.error('[guardian/prod] runtime lock release failed:', err))
      .finally(() => process.exit(shutdownExitCode))
  }, 5_000)
}

async function startFlagWatcher() {
  await mkdir(dirname(FLAG_PATH), { recursive: true })
  let pending
  const fire = (kind) => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      const action = kind === 'connector' ? restartConnector() : restartUTA()
      action.catch((err) => {
        console.error(`[guardian/prod] restart ${kind} threw:`, err)
      })
    }, 100)
  }
  ;(async () => {
    try {
      const watcher = watch(dirname(FLAG_PATH))
      const flagName = FLAG_PATH.slice(FLAG_PATH.lastIndexOf('/') + 1)
      const connectorFlagName = CONNECTOR_FLAG_PATH.slice(CONNECTOR_FLAG_PATH.lastIndexOf('/') + 1)
      for await (const evt of watcher) {
        if (evt.filename === flagName) fire('uta')
        if (evt.filename === connectorFlagName) fire('connector')
      }
    } catch (err) {
      console.error('[guardian/prod] flag watcher errored:', err)
    }
  })().catch(() => { /* swallow — already logged */ })
}

async function initializeRuntimeState() {
  const portsFile = await readProdPortsFile(DATA_HOME)
  const portConfig = resolveProdPortConfig(process.env, portsFile)
  TRADING_MODE = await resolveTradingMode(process.env, DATA_HOME)
  PROJECT_PRODUCT = await readAliceProjectProduct(DATA_HOME)
  SKIP_UTA = PROJECT_PRODUCT === 'nano' || TRADING_MODE.mode === 'lite'
  const plannedPorts = await planProdPorts(portConfig, { skipUta: SKIP_UTA })
  WEB_PORT = plannedPorts.web
  MCP_PORT = plannedPorts.mcp
  UTA_PORT = plannedPorts.uta
  CONNECTOR_PORT = plannedPorts.connector
  FLAG_PATH = resolve(DATA_HOME, 'data/control/restart-uta.flag')
  CONNECTOR_FLAG_PATH = resolve(DATA_HOME, 'data/control/restart-connector.flag')
  UTA_URL = `http://127.0.0.1:${UTA_PORT}`
  CONNECTOR_URL = `http://127.0.0.1:${CONNECTOR_PORT}`
  utaStatus = SKIP_UTA ? 'disabled' : 'starting'
  RUNTIME_VERSION = await readRuntimeVersion()
}

export async function startGuardianRuntime() {
  process.on('SIGINT', () => shutdown())
  process.on('SIGTERM', () => shutdown())
  process.on('SIGHUP', () => shutdown())

  if ((RAILWAY_FENCE_CLAIMED || RAILWAY_RUNTIME_REQUIRED) && !RAILWAY_RUNTIME_FENCE) {
    throw new Error('invalid inherited Railway lifecycle fence; refusing to start Guardian')
  }
  await initializeRuntimeState()
  if (!process.env.OPENALICE_HOME && process.env.OPENALICE_USER_DATA_HOME) {
    console.warn('[guardian/prod] OPENALICE_USER_DATA_HOME is deprecated — set OPENALICE_HOME instead')
  }
  console.log('[guardian/prod] starting')
  console.log(`[guardian/prod] mode  → ${TRADING_MODE.mode} (${TRADING_MODE.source}${TRADING_MODE.envLocked ? ', env-locked' : ''})`)
  console.log(`[guardian/prod] data  → ${DATA_HOME}`)
  console.log(`[guardian/prod] project → ${ALICE_PROJECT.displayName} (${ALICE_PROJECT.id})`)
  console.log(`[guardian/prod] product → ${PROJECT_PRODUCT}`)
  console.log(`[guardian/prod] UTA   → ${SKIP_UTA ? (PROJECT_PRODUCT === 'nano' ? 'disabled (NanoAlice)' : 'disabled (trading mode lite)') : UTA_URL}`)
  console.log(`[guardian/prod] Connector → ${CONNECTOR_URL} (optional)`)
  console.log(`[guardian/prod] Alice → http://${BIND_HOST}:${WEB_PORT}`)
  console.log(`[guardian/prod] Tools → http://127.0.0.1:${MCP_PORT}/cli`)
  console.log(`[guardian/prod] MCP   → optional on http://127.0.0.1:${MCP_PORT}/mcp`)
  console.log(`[guardian/prod] flags → ${FLAG_PATH}, ${CONNECTOR_FLAG_PATH}`)

  guardianRuntimeLock = await acquireGuardianRuntime({
    userDataHome: DATA_HOME,
    launcherRoot: LAUNCHER_ROOT,
    launcher: GUARDIAN_LAUNCHER,
    takeover: TAKEOVER,
    processStartedAt: GUARDIAN_STARTED_AT,
    ownerAuthority: RUNTIME_LOCK_OWNER_AUTHORITY,
    onOwnershipLost: (err) => {
      console.error('[guardian/prod] runtime ownership lost:', err)
      shutdown()
    },
  })
  if (TAKEOVER) console.log('[guardian/prod] takeover → previous OpenAlice runtime stopped')

  guardianControlServer = await startGuardianControlServer({
    homeRoot: DATA_HOME,
    allowStop: LAUNCHER === 'cli-server',
    getStatus: runtimeStatus,
    onStop: () => shutdown(),
  })
  console.log(`[guardian/prod] Control → ${guardianControlServer.endpoint}`)

  if (!SKIP_UTA) {
    utaStatus = 'starting'
    utaChild = spawnUTA()
    void waitForUTA().then((ready) => {
      utaStatus = ready ? 'ready' : 'offline'
      if (ready) console.log('[guardian/prod] UTA ready')
      else console.warn('[guardian/prod] UTA did not become ready within 15s — continuing with trading offline')
    })
  }

  if (await readConnectorEnabled()) {
    connectorStatus = 'starting'
    connectorChild = spawnConnector()
    void waitForConnector().then((ready) => {
      connectorStatus = ready ? 'ready' : 'offline'
      if (ready) {
        connectorRecovery.reset()
        console.log('[guardian/prod] Connector ready')
      } else {
        console.warn('[guardian/prod] Connector did not become ready within 15s — external notifications offline')
        scheduleConnectorRecovery()
      }
    })
  }

  aliceStatus = 'starting'
  aliceChild = spawnAlice()
  void waitForAlice().then((ready) => {
    aliceStatus = ready ? 'ready' : 'offline'
    if (ready) console.log('[guardian/prod] Alice ready')
    else console.error('[guardian/prod] Alice did not become ready within 60s')
  })
  // Alice may create connector-service.json while applying the migration from
  // the retired Telegram config. Reconcile once after its startup path.
  void (async () => {
    await sleep(2_000)
    if (!connectorChild && await readConnectorEnabled()) await restartConnector()
  })()
  await startFlagWatcher()
}

if (!globalThis.__OPENALICE_INTERNAL_ROLE_DISPATCH__) {
  startGuardianRuntime().catch((err) => {
    console.error('[guardian/prod] fatal:', err)
    shutdown(1)
  })
}
