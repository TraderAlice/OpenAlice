/**
 * Guardian dev smoke test.
 *
 * Boots the full `pnpm dev` stack (UTA → Alice → Vite) as a black box,
 * verifies all three children actually spawned and bound their ports, then
 * exercises the UTA restart path and checks for orphaned processes on
 * teardown.
 *
 * Why this exists: Guardian spawns its children with bare commands (`tsx`,
 * `pnpm`). On Windows those are `.cmd` shims that Node's spawn won't resolve
 * without a shell — a regression there throws `spawn tsx ENOENT` at boot and
 * is invisible to `pnpm test` (esbuild transpile, no real spawn). This runs
 * the real spawn path on a real OS in CI. See scripts/guardian/shared.ts
 * `spawnChild`.
 *
 * Two tiers of check:
 *   - HARD (gates exit code): all three children boot, no ENOENT. This is the
 *     contract a cross-platform spawn fix must keep.
 *   - SOFT (logged, never fails the run): UTA restart re-spawns cleanly, and
 *     teardown leaves no orphan processes holding ports. These probe the
 *     known-fragile Windows kill path (killing a shell-wrapped child kills the
 *     wrapper, not the grandchild). We want the signal in CI logs without
 *     blocking the boot fix on a separately-scoped teardown concern.
 *
 * Runnable locally on POSIX too (`pnpm test:smoke`) — there it's the control
 * case where everything already works, useful for validating the harness
 * itself when you can't run Windows.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { appendFileSync } from 'node:fs'
import { resolveLaunchCommand } from '../../src/workspaces/win-command.js'

const IS_WIN = process.platform === 'win32'
const BOOT_TIMEOUT_MS = 120_000
const RESTART_TIMEOUT_MS = 30_000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// CI (GitHub Actions) forces color, so child output carries ANSI SGR codes
// even through a pipe — e.g. `http://localhost:\x1b[1m5173`. Strip them before
// matching or readiness regexes break (a `localhost:\d+` won't see the digit).
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g
function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

/** Append a line to the GitHub step summary if running in Actions. No-op locally. */
function summary(line: string): void {
  const f = process.env['GITHUB_STEP_SUMMARY']
  if (f) {
    try { appendFileSync(f, line + '\n') } catch { /* best effort */ }
  }
}

/** True if something is listening on the port (connection accepted). */
function portBound(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((res) => {
    const sock = connect({ port, host })
    const done = (bound: boolean) => {
      sock.destroy()
      res(bound)
    }
    sock.setTimeout(1_000)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await portBound(port))) return true
    await sleep(500)
  }
  return false
}

interface UtaHealth { ok: boolean; startedAt: string; utas: number }

async function fetchHealth(utaPort: number): Promise<UtaHealth | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${utaPort}/__uta/health`)
    if (!r.ok) return null
    return (await r.json()) as UtaHealth
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const root = process.cwd()
  // Every Guardian smoke gets a disposable data root. Startup and recovery
  // tests must never mutate the contributor's real ~/.openalice store or
  // leave runtime locks in the checkout under test.
  const dataHome = await mkdtemp(join(tmpdir(), 'openalice-guardian-smoke-'))
  const launcherRoot = resolve(dataHome, 'workspaces')
  const flagPath = resolve(dataHome, 'data/control/restart-uta.flag')

  // ── Spawn the full stack ──────────────────────────────────
  // POSIX: detached so the whole process group can be force-killed on cleanup.
  // Windows: shell so the `pnpm` .cmd shim resolves (this outer spawn is the
  // harness, not the code under test — the code under test is what Guardian
  // does internally).
  const childEnv = {
    ...process.env,
    OPENALICE_HOME: dataHome,
    AQ_LAUNCHER_ROOT: launcherRoot,
  }
  // The product auto-defaults a fresh data home to Lite mode, but this smoke
  // harness is intentionally the full-stack Guardian spawn test. Keep UTA in
  // the hard path unless a caller explicitly asks to exercise Lite.
  if (
    !childEnv['OPENALICE_TRADING_MODE'] &&
    !childEnv['OPENALICE_LITE_MODE'] &&
    !childEnv['OPENALICE_UTA_DISABLED']
  ) {
    childEnv['OPENALICE_TRADING_MODE'] = 'pro'
  }
  const resolvedDev = resolveLaunchCommand(['pnpm', 'dev'], { env: childEnv, nodeExecPath: process.execPath })
  const [devCommand, ...devArgs] = resolvedDev.argv
  if (!devCommand) throw new Error('guardian smoke: empty dev command')
  const child: ChildProcess = spawn(devCommand, devArgs, {
    cwd: root,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WIN,
    shell: IS_WIN && resolvedDev.viaShell,
  })

  // `out` holds ANSI-stripped text for matching; raw output is mirrored to the
  // CI log so colors are still readable there.
  let out = ''
  const onData = (buf: Buffer) => {
    const s = buf.toString('utf8')
    out += stripAnsi(s)
    process.stdout.write(s)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)

  let childExited = false
  child.once('exit', () => { childExited = true })

  // Force-kill the whole tree. On Windows taskkill /T walks the process tree
  // (the orphan-prone case); on POSIX kill the process group.
  const forceCleanup = () => {
    if (childExited || child.pid == null) return
    try {
      if (IS_WIN) {
        // spawnSync so the tree is actually reaped before process.exit().
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      } else {
        process.kill(-child.pid, 'SIGKILL')
      }
    } catch { /* already gone */ }
  }

  const fail = (msg: string): never => {
    console.error(`\n❌ SMOKE FAIL: ${msg}`)
    summary(`❌ **Guardian smoke failed (${process.platform})**: ${msg}`)
    forceCleanup()
    process.exit(1)
  }

  // ── HARD: wait for boot, no ENOENT ────────────────────────
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  const waitFor = async (label: string, ok: () => boolean | Promise<boolean>): Promise<void> => {
    while (Date.now() < deadline) {
      if (/spawn .* ENOENT/.test(out)) fail(`ENOENT during boot — a child failed to spawn:\n${out.slice(-600)}`)
      if (childExited) fail(`stack exited before "${label}":\n${out.slice(-600)}`)
      if (await ok()) { console.log(`✓ ${label}`); return }
      await sleep(500)
    }
    fail(`timed out waiting for "${label}" (${BOOT_TIMEOUT_MS / 1000}s):\n${out.slice(-600)}`)
  }

  // Parse the ports Guardian prints in its banner (robust to port-probe shifts).
  await waitFor('guardian banner printed', () => /Alice\s+→\s+http:\/\/localhost:\d+/.test(out))
  const utaPort = Number(/UTA\s+→\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[1])
  const webPort = Number(/Alice\s+→\s+http:\/\/localhost:(\d+)/.exec(out)?.[1])
  if (!utaPort || !webPort) fail(`could not parse ports from banner:\n${out.slice(-600)}`)
  console.log(`  parsed ports → UTA:${utaPort} Alice:${webPort}`)

  // UTA tsx spawn worked → health responds.
  let health: UtaHealth | null = null
  await waitFor('UTA health 200 (uta child spawned)', async () => {
    health = await fetchHealth(utaPort)
    return health !== null
  })
  const startedAt0 = health!.startedAt

  // Alice tsx spawn worked → web plugin bound its port.
  await waitFor('Alice listening (alice child spawned)', () => portBound(webPort))

  // Vite pnpm spawn worked → it announces a Local URL.
  await waitFor('Vite dev server up (vite child spawned)', () => /\[vite\][^\n]*localhost:\d+/i.test(out))

  console.log('\n✅ HARD checks passed — all three children spawned and bound.')
  summary(`✅ **Guardian boot smoke passed (${process.platform})** — UTA/Alice/Vite all spawned.`)

  // ── SOFT: UTA restart (never fails the run) ───────────────
  // Triggers the same flag Alice touches after a broker-config change. On
  // Windows this is the path most likely to expose the shell-wrapper kill
  // problem: old UTA orphaned holding the port → new UTA can't bind.
  console.log('\n— SOFT checks (logged, do not affect exit code) —')
  let restartOk = false
  try {
    await mkdir(dirname(flagPath), { recursive: true })
    await writeFile(flagPath, `smoke ${startedAt0}`)
    const rDeadline = Date.now() + RESTART_TIMEOUT_MS
    while (Date.now() < rDeadline) {
      const h = await fetchHealth(utaPort)
      if (h && h.startedAt !== startedAt0) { restartOk = true; break }
      await sleep(500)
    }
  } catch { /* reported below */ }
  if (restartOk) {
    console.log('✓ UTA restarted cleanly (startedAt changed)')
    summary(`✅ UTA restart on ${process.platform}: clean re-spawn.`)
  } else {
    console.warn('⚠️  UTA did NOT re-spawn within timeout after the restart flag. Either the flag watcher never fired or the old UTA was not reaped (port still held). This is the broker-config restart path — see scripts/guardian/shared.ts startFlagWatcher + UTAController.restart.')
    summary(`⚠️ UTA restart on ${process.platform}: did not re-spawn — broker-config restart path is broken.`)
  }

  // ── SOFT: teardown orphan check ───────────────────────────
  // Tree-kill the whole stack, then check the ports actually freed. A port
  // still bound after a tree-kill means a process escaped the tree (e.g. a
  // shell-wrapped grandchild detached from its wrapper on Windows).
  console.log('\n— teardown orphan check —')
  forceCleanup()
  await sleep(5_000)
  const stillUta = await portBound(utaPort)
  const stillWeb = await portBound(webPort)
  if (stillUta || stillWeb) {
    const which = [stillUta && `UTA:${utaPort}`, stillWeb && `Alice:${webPort}`].filter(Boolean).join(', ')
    console.warn(`⚠️  Ports still bound after tree-kill (a process escaped the tree): ${which}`)
    summary(`⚠️ Teardown on ${process.platform}: ${which} still bound after tree-kill.`)
  } else {
    console.log('✓ Clean teardown — no orphaned ports')
    summary(`✅ Teardown on ${process.platform}: clean, no orphans.`)
  }

  // Ensure the CI runner is left clean regardless of the above.
  forceCleanup()
  await waitForPortFree(utaPort, 10_000)
  await rm(dataHome, { recursive: true, force: true })
  console.log('\n✅ Smoke complete (HARD checks passed).')
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error('smoke harness error:', err)
  process.exit(1)
})
