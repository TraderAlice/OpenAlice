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
import { readdirSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import {
  probePorts,
  spawnChild,
  waitForHttp,
  installCascadeShutdown,
  UTAController,
  startFlagWatcher,
  type SpawnSpec,
} from './shared.js'

async function main(): Promise<void> {
  const ports = await probePorts()
  const dataHome = process.cwd()
  const flagPath = resolve(dataHome, 'data/control/restart-uta.flag')

  console.log('')
  console.log(`[guardian] UTA      →  http://127.0.0.1:${ports.utaPort}`)
  console.log(`[guardian] Alice    →  http://localhost:${ports.webPort}`)
  console.log(`[guardian] MCP      →  http://localhost:${ports.mcpPort}/mcp`)
  console.log(`[guardian] UI       →  http://localhost:5173  (Vite picks +1 if taken)`)
  console.log(`[guardian] flag     →  ${flagPath}`)
  console.log('')

  // On Windows, the Claude Code CLI (claude.exe) lives in a versioned AppData
  // subdirectory that isn't on the system PATH. Agent SDK spawns `claude` as a
  // subprocess, so we inject the directory here so every child process can find it.
  const claudeCodeDir =
    process.platform === 'win32' && process.env['APPDATA']
      ? (() => {
          const base = `${process.env['APPDATA']}\\Claude\\claude-code`
          try {
            const entries = readdirSync(base) as string[]
            const latest = entries.filter((e) => /^\d/.test(e)).sort().at(-1)
            return latest ? `${base}\\${latest}` : undefined
          } catch {
            return undefined
          }
        })()
      : undefined

  const baseEnv = {
    ...process.env,
    NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --conditions=openalice-source`.trim(),
    OPENALICE_USER_DATA_HOME: dataHome,
    ...(claudeCodeDir
      ? { PATH: `${claudeCodeDir}${process.platform === 'win32' ? ';' : ':'}${process.env['PATH'] ?? ''}` }
      : {}),
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
      OPENALICE_UTA_URL: utaUrl,
    },
    prefixLogs: true,
  })

  // ── Vite ──────────────────────────────────────────────────
  const vite: ChildProcess = spawnChild({
    name: 'vite',
    command: 'pnpm',
    args: ['--filter', 'open-alice-ui', 'dev'],
    env: { ...baseEnv, OPENALICE_BACKEND_PORT: String(ports.webPort) },
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
