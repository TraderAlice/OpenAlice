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
 *   - spawn UTA, poll /__uta/health until 200 (≤ 15s) or abort
 *   - spawn Alice with OPENALICE_UTA_URL pointing at the local UTA
 *   - watch `${OPENALICE_HOME}/data/control/restart-uta.flag`
 *     for UI-triggered broker config changes; SIGTERM + respawn UTA
 *     when it changes (debounced 100ms)
 *   - SIGTERM/SIGINT from tini cascades to both children, then exit
 *   - any child exiting non-zero unintentionally cascades shutdown
 *
 * Mirrors `scripts/guardian/dev.ts` minus the Vite child and watch-mode
 * spawns. Kept as `.mjs` so the runtime image needs no TS tooling.
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, watch } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const DATA_HOME = process.env.OPENALICE_HOME
  ?? process.env.OPENALICE_USER_DATA_HOME // deprecated alias, one-release courtesy
  ?? '/data'
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

let stopping = false
let utaChild = null
let aliceChild = null
let restartingUTA = false

console.log('[guardian/prod] starting')
console.log('[guardian/prod] mode  → docker/prod')
console.log(`[guardian/prod] data  → ${DATA_HOME}`)
console.log(`[guardian/prod] UTA   → ${UTA_URL}`)
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
      OPENALICE_LAUNCHER: 'docker',
    },
  }
}

function spawnUTA() {
  const spec = makeUTASpec()
  const child = spawn(spec.cmd, spec.args, { env: spec.env, stdio: 'inherit' })
  child.once('exit', (code, signal) => {
    if (stopping || restartingUTA) return
    console.error(`[guardian/prod] UTA exited unexpectedly (code=${code}, signal=${signal})`)
    shutdown()
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
      OPENALICE_LAUNCHER: 'docker',
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
  if (restartingUTA) return
  restartingUTA = true
  try {
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
    process.exit(0)
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
  utaChild = spawnUTA()
  const utaReady = await waitForUTA()
  if (!utaReady) {
    console.error('[guardian/prod] UTA failed to come up within 15s — aborting')
    shutdown()
    return
  }
  console.log('[guardian/prod] UTA ready')

  aliceChild = spawnAlice()
  await startFlagWatcher()
}

main().catch((err) => {
  console.error('[guardian/prod] fatal:', err)
  shutdown()
  process.exit(1)
})
