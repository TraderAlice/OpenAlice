#!/usr/bin/env node
/**
 * Guardian — production entry, used as the Docker container CMD.
 *
 * tini runs as PID 1 (signal forwarding + zombie reaping); this script is
 * the orchestrator tini supervises. It spawns the two long-lived Node
 * processes that make up a self-hosted OpenAlice deployment:
 *
 *   1. UTA service  (services/uta/dist/uta.js, bind 127.0.0.1:47333)
 *   2. Alice main   (dist/main.js,             bind 0.0.0.0:47331)
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
import { createDecipheriv } from 'node:crypto'
import { mkdir, readFile, watch } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  acquireGuardianRuntime,
  currentProcessStartedAt,
  takeoverRequested,
} from '@traderalice/guardian-runtime'

const DATA_HOME = process.env.OPENALICE_HOME
  ?? process.env.OPENALICE_USER_DATA_HOME // deprecated alias, one-release courtesy
  ?? '/data'
const LAUNCHER_ROOT = process.env.AQ_LAUNCHER_ROOT ?? resolve(DATA_HOME, 'workspaces')
const GUARDIAN_STARTED_AT = currentProcessStartedAt()
const TAKEOVER = takeoverRequested()
if (!process.env.OPENALICE_HOME && process.env.OPENALICE_USER_DATA_HOME) {
  console.warn('[guardian/prod] OPENALICE_USER_DATA_HOME is deprecated — set OPENALICE_HOME instead')
}

// Port precedence: env (OPENALICE_*_PORT) > data/config/ports.json > default.
// Mirrors scripts/guardian/shared.ts (kept inline — the runtime image ships
// no TS tooling). Broken explicit config fails loud rather than silently
// falling back; an in-use port fails at bind, also loud.
function parsePort(raw, origin) {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`[guardian/prod] invalid port ${JSON.stringify(raw)} from ${origin} — expected an integer in 1..65535`)
  }
  return n
}

function truthyEnv(raw) {
  if (raw === undefined || raw === '') return false
  const normalized = String(raw).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
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

async function readPortsFile(userDataHome) {
  const filePath = resolve(userDataHome, 'data', 'config', 'ports.json')
  let raw
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return {}
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`[guardian/prod] ${filePath} is not valid JSON: ${err?.message ?? err}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`[guardian/prod] ${filePath} must be a JSON object like {"web":47331,"mcp":47332,"uta":47333}`)
  }
  const out = {}
  for (const name of ['web', 'mcp', 'uta']) {
    if (parsed[name] !== undefined) out[name] = parsePort(parsed[name], `${filePath} ("${name}")`)
  }
  return out
}

const portsFile = await readPortsFile(DATA_HOME)
const pickPort = (envKey, fileValue, fallback) => {
  const envRaw = process.env[envKey]
  if (envRaw !== undefined && envRaw !== '') return parsePort(envRaw, envKey)
  return fileValue ?? fallback
}
const WEB_PORT = pickPort('OPENALICE_WEB_PORT', portsFile.web, 47331)
const MCP_PORT = pickPort('OPENALICE_MCP_PORT', portsFile.mcp, 47332)
const UTA_PORT = pickPort('OPENALICE_UTA_PORT', portsFile.uta, 47333)
const FLAG_PATH = resolve(DATA_HOME, 'data/control/restart-uta.flag')
const UTA_URL = `http://127.0.0.1:${UTA_PORT}`
let TRADING_MODE = await resolveTradingMode(process.env, DATA_HOME)
const LITE_MODE = TRADING_MODE.mode === 'lite'

let stopping = false
let utaChild = null
let aliceChild = null
let restartingUTA = false
let guardianRuntimeLock = null

console.log('[guardian/prod] starting')
console.log(`[guardian/prod] mode  → ${TRADING_MODE.mode} (${TRADING_MODE.source}${TRADING_MODE.envLocked ? ', env-locked' : ''})`)
console.log(`[guardian/prod] data  → ${DATA_HOME}`)
console.log(`[guardian/prod] UTA   → ${LITE_MODE ? 'disabled (trading mode lite)' : UTA_URL}`)
console.log(`[guardian/prod] Alice → http://0.0.0.0:${WEB_PORT}`)
console.log(`[guardian/prod] Tools → http://127.0.0.1:${MCP_PORT}/cli`)
console.log(`[guardian/prod] MCP   → optional on http://127.0.0.1:${MCP_PORT}/mcp`)
console.log(`[guardian/prod] flag  → ${FLAG_PATH}`)

function makeUTASpec() {
  return {
    cmd: 'node',
    args: ['services/uta/dist/uta.js'],
    env: {
      ...process.env,
      OPENALICE_UTA_PORT: String(UTA_PORT),
      OPENALICE_HOME: DATA_HOME,
      AQ_LAUNCHER_ROOT: LAUNCHER_ROOT,
      OPENALICE_LAUNCHER: 'docker',
      OPENALICE_GUARDIAN_PID: String(process.pid),
      OPENALICE_GUARDIAN_STARTED_AT: String(GUARDIAN_STARTED_AT),
      ...(TAKEOVER ? { OPENALICE_TAKEOVER: '1' } : {}),
    },
  }
}

function spawnUTA() {
  const spec = makeUTASpec()
  const child = spawn(spec.cmd, spec.args, { env: spec.env, stdio: 'inherit' })
  child.once('exit', (code, signal) => {
    if (stopping || restartingUTA) return
    console.error(`[guardian/prod] UTA exited unexpectedly (code=${code}, signal=${signal}) — trading offline, Alice stays up`)
  })
  return child
}

function spawnAlice() {
  const child = spawn('node', ['dist/main.js'], {
    env: {
      ...process.env,
      OPENALICE_WEB_PORT: String(WEB_PORT),
      OPENALICE_MCP_PORT: String(MCP_PORT),
      OPENALICE_TOOL_BASE_URL: `http://127.0.0.1:${MCP_PORT}/cli`,
      OPENALICE_UTA_URL: UTA_URL,
      OPENALICE_HOME: DATA_HOME,
      AQ_LAUNCHER_ROOT: LAUNCHER_ROOT,
      OPENALICE_LAUNCHER: 'docker',
      OPENALICE_GUARDIAN_PID: String(process.pid),
      OPENALICE_GUARDIAN_STARTED_AT: String(GUARDIAN_STARTED_AT),
      ...(TAKEOVER ? { OPENALICE_TAKEOVER: '1' } : {}),
    },
    stdio: 'inherit',
  })
  child.once('exit', (code, signal) => {
    if (stopping) return
    console.error(`[guardian/prod] Alice exited unexpectedly (code=${code}, signal=${signal})`)
    shutdown()
  })
  return child
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

async function restartUTA() {
  TRADING_MODE = await resolveTradingMode(process.env, DATA_HOME)
  if (TRADING_MODE.mode === 'lite') {
    if (utaChild && utaChild.exitCode === null) {
      console.log('[guardian/prod] trading mode lite — stopping UTA')
      restartingUTA = true
      try { utaChild.kill('SIGTERM') } catch { /* noop */ }
      restartingUTA = false
      utaChild = null
    } else {
      console.warn('[guardian/prod] restart-uta.flag ignored — trading mode lite disables UTA')
    }
    return
  }
  if (restartingUTA) return
  restartingUTA = true
  try {
    if (!utaChild) {
      console.log(`[guardian/prod] trading mode ${TRADING_MODE.mode} — starting UTA`)
      utaChild = spawnUTA()
      const ready = await waitForUTA()
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
    if (!ready) {
      console.error('[guardian/prod] UTA did not come back up after restart')
    } else {
      console.log('[guardian/prod] UTA back online')
    }
  } finally {
    restartingUTA = false
  }
}

function shutdown() {
  if (stopping) return
  stopping = true
  console.log('[guardian/prod] shutting down')
  for (const c of [utaChild, aliceChild]) {
    if (c && c.exitCode === null && !c.killed) {
      try { c.kill('SIGTERM') } catch { /* noop */ }
    }
  }
  setTimeout(() => {
    for (const c of [utaChild, aliceChild]) {
      if (c && c.exitCode === null && !c.killed) {
        try { c.kill('SIGKILL') } catch { /* noop */ }
      }
    }
    const current = guardianRuntimeLock
    guardianRuntimeLock = null
    void Promise.resolve(current?.release())
      .catch((err) => console.error('[guardian/prod] runtime lock release failed:', err))
      .finally(() => process.exit(0))
  }, 5_000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGHUP', shutdown)

async function startFlagWatcher() {
  await mkdir(dirname(FLAG_PATH), { recursive: true })
  let pending
  const fire = () => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      restartUTA().catch((err) => {
        console.error('[guardian/prod] restartUTA threw:', err)
      })
    }, 100)
  }
  ;(async () => {
    try {
      const watcher = watch(dirname(FLAG_PATH))
      const flagName = FLAG_PATH.slice(FLAG_PATH.lastIndexOf('/') + 1)
      for await (const evt of watcher) {
        if (evt.filename === flagName) fire()
      }
    } catch (err) {
      console.error('[guardian/prod] flag watcher errored:', err)
    }
  })().catch(() => { /* swallow — already logged */ })
}

async function main() {
  guardianRuntimeLock = await acquireGuardianRuntime({
    userDataHome: DATA_HOME,
    launcherRoot: LAUNCHER_ROOT,
    launcher: 'guardian-docker',
    takeover: TAKEOVER,
    processStartedAt: GUARDIAN_STARTED_AT,
    onOwnershipLost: (err) => {
      console.error('[guardian/prod] runtime ownership lost:', err)
      shutdown()
    },
  })
  if (TAKEOVER) console.log('[guardian/prod] takeover → previous OpenAlice runtime stopped')

  if (TRADING_MODE.mode !== 'lite') {
    utaChild = spawnUTA()
    void waitForUTA().then((ready) => {
      if (ready) console.log('[guardian/prod] UTA ready')
      else console.warn('[guardian/prod] UTA did not become ready within 15s — continuing with trading offline')
    })
  }

  aliceChild = spawnAlice()
  await startFlagWatcher()
}

main().catch((err) => {
  console.error('[guardian/prod] fatal:', err)
  shutdown()
  process.exit(1)
})
