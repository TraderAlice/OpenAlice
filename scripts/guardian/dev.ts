/**
 * Guardian — dev entry.
 *
 * Spawns UTA → Alice → Vite. UTA must hit `/__uta/health` 200 before Alice
 * is spawned (Alice fails fast if `OPENALICE_UTA_URL` doesn't respond on
 * boot). Vite comes last because it only needs Alice's port for its dev
 * proxy target.
 *
 * Restart protocol: Guardian watches `data/control/restart-uta.flag`. When
 * Alice touches it (after broker config changes), Guardian SIGTERMs UTA,
 * waits for graceful exit, respawns. Alice stays up the whole time — its
 * BFF proxy returns 502 for `/api/trading/*` until the new UTA is ready.
 *
 * Replaces the previous `scripts/dev.ts`. Same `pnpm dev` UX.
 */

import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import {
  readPortsFile,
  resolvePortConfig,
  planPorts,
  spawnChild,
  waitForHttp,
  installCascadeShutdown,
  UTAController,
  startFlagWatcher,
  type SpawnSpec,
} from './shared.js'

async function main(): Promise<void> {
  // One global store by default (~/.openalice) — shared with the packaged
  // app. `OPENALICE_HOME=$PWD pnpm dev` pins a checkout-local store for
  // experiments that shouldn't touch real data.
  const dataHome = process.env['OPENALICE_HOME'] ?? resolve(homedir(), '.openalice')

  // Legacy adoption notice: this checkout has a pre-global-root data/ store
  // and the global one is still virgin. Never auto-move — multiple worktrees
  // may each carry a ./data and only the user knows which is canonical.
  if (
    !process.env['OPENALICE_HOME'] &&
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

  // env (OPENALICE_*_PORT) > data/config/ports.json > default+probe.
  const ports = await planPorts(resolvePortConfig(process.env, await readPortsFile(dataHome)))
  const flagPath = resolve(dataHome, 'data/control/restart-uta.flag')

  console.log('')
  console.log(`[guardian] mode     →  dev (Guardian + UTA + Alice + Vite)`)
  console.log(`[guardian] data     →  ${dataHome}`)
  console.log(`[guardian] app      →  ${process.cwd()}`)
  console.log(`[guardian] UTA      →  http://127.0.0.1:${ports.utaPort}`)
  console.log(`[guardian] Alice    →  http://localhost:${ports.webPort}`)
  console.log(`[guardian] Tools    →  http://127.0.0.1:${ports.mcpPort}/cli`)
  console.log(`[guardian] MCP      →  optional on http://127.0.0.1:${ports.mcpPort}/mcp`)
  console.log(`[guardian] UI       →  http://localhost:${ports.uiPort}`)
  console.log(`[guardian] flag     →  ${flagPath}`)
  console.log('')

  const baseEnv = {
    ...process.env,
    NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --conditions=openalice-source`.trim(),
    // Children must resolve the same user-data root the Guardian watches —
    // src/core/paths.ts reads OPENALICE_HOME; never rely on cwd inheritance.
    OPENALICE_HOME: dataHome,
    OPENALICE_LAUNCHER: 'dev',
  }

  // ── UTA spec (re-used by Guardian for restart) ────────────
  const utaSpec: SpawnSpec = {
    name: 'uta',
    command: 'tsx',
    args: ['watch', 'services/uta/src/main.ts'],
    env: { ...baseEnv, OPENALICE_UTA_PORT: String(ports.utaPort) },
    prefixLogs: true,
  }
  const utaUrl = `http://127.0.0.1:${ports.utaPort}`

  const utaInitial = spawnChild(utaSpec)
  const utaReady = await waitForHttp(`${utaUrl}/__uta/health`, { timeoutMs: 15_000 })
  if (!utaReady) {
    console.error(`[guardian] UTA failed to come up within 15s — aborting`)
    try { utaInitial.kill('SIGTERM') } catch { /* noop */ }
    process.exit(1)
  }
  console.log(`[guardian] UTA ready`)
  const uta = new UTAController(utaSpec, `${utaUrl}/__uta/health`, utaInitial)

  // ── Alice ─────────────────────────────────────────────────
  const alice: ChildProcess = spawnChild({
    name: 'alice',
    command: 'tsx',
    args: ['watch', 'src/main.ts'],
    env: {
      ...baseEnv,
      OPENALICE_WEB_PORT: String(ports.webPort),
      OPENALICE_MCP_PORT: String(ports.mcpPort),
      OPENALICE_TOOL_BASE_URL: `http://127.0.0.1:${ports.mcpPort}/cli`,
      // Where the UI actually lives — consumed by the workspace WS-origin
      // allowlist (src/workspaces/config.ts buildDefaultOrigins).
      OPENALICE_UI_PORT: String(ports.uiPort),
      OPENALICE_UTA_URL: utaUrl,
    },
    prefixLogs: true,
  })

  const aliceReady = await waitForHttp(`http://127.0.0.1:${ports.webPort}/api/version`, { timeoutMs: 20_000 })
  if (!aliceReady) {
    console.error(`[guardian] Alice failed to come up within 20s — aborting before Vite starts`)
    console.error(`[guardian] If another OpenAlice/Electron instance is running on the same data root, stop it or run dev with an isolated OPENALICE_HOME/AQ_LAUNCHER_ROOT.`)
    try { alice.kill('SIGTERM') } catch { /* noop */ }
    try { uta.process.kill('SIGTERM') } catch { /* noop */ }
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
    children: [uta.process, alice, vite],
  })

  // UTA restart cooperates with cascade — old SIGTERM is "expected", new
  // child is tracked for unexpected exit + signal forwarding.
  uta.cascade = {
    expectExit: cascade.expectExit,
    trackReplacement: cascade.trackReplacement,
  }

  // ── Flag watch ────────────────────────────────────────────
  // Triggered by Alice after `accounts.json` mutations. Guardian restarts
  // UTA — Alice and Vite untouched.
  await startFlagWatcher({
    flagPath,
    onTrigger: () => {
      void uta.restart()
    },
  })
}

main().catch((err: unknown) => {
  console.error('[guardian] fatal:', err)
  process.exit(1)
})
