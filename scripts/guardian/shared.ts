/**
 * Guardian shared module — L2 process supervisor.
 *
 * Guardian is OpenAlice's L2 authority (see memory:port-architecture-3-layers).
 * Three carriers, one set of L2 responsibilities:
 *   - dev:    `scripts/guardian/dev.ts`, spawned by `pnpm dev`
 *   - prod:   `scripts/guardian/prod.mjs`, container CMD (Step 7)
 *   - desktop: Electron `main` process (future)
 *
 * Responsibilities (this module):
 *   - port probing
 *   - child-process spawning (UTA / Alice / Vite) with env injection
 *   - HTTP readiness gates (`waitForHttp`)
 *   - signal forwarding + cascade shutdown
 *   - log line prefixing (dev only)
 *
 * Step 4 will add: watching `data/control/restart-uta.flag` so Guardian
 * SIGTERMs + respawns UTA without restarting Alice.
 */

import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { watch, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, basename, resolve } from 'node:path'
import { probeFreePort } from '../probe-port.js'

export interface GuardianPorts {
  webPort: number
  mcpPort: number
  utaPort: number
  /** Vite dev-server port — resolved by Guardian (dev only; prod has no Vite). */
  uiPort: number
}

// ── Port configuration (L1 → L2) ────────────────────────────
//
// Ports are spawn-time-fixed: Guardian (L2) resolves them once and injects
// them into the children via env (see memory:port-architecture-3-layers).
// User-facing configuration lives in L1 — `data/config/ports.json`:
//
//   { "web": 47331, "mcp": 47332, "uta": 47333, "ui": 5173 }   (all keys optional)
//
// Deliberately a data/config file and NOT a dotenv file: the data dir is the
// one location every topology agrees on (dev repo, docker volume, Electron
// userData), and OpenAlice does not want an env file that invites API keys —
// those belong in the credential vault UI.
//
// Precedence per port: explicit env (OPENALICE_*_PORT) > ports.json > default.
// An EXPLICITLY configured port that is already taken fails loud — silently
// drifting off a value the user pinned would be worse than aborting. Only
// unconfigured ports keep the probe-upward-from-default behavior.

const PORT_DEFAULTS = { web: 47331, mcp: 47332, uta: 47333, ui: 5173 } as const

export type PortName = keyof typeof PORT_DEFAULTS

export interface PortChoice {
  value: number
  /** Where the value came from — only 'default' ports may drift via probing. */
  source: 'env' | 'file' | 'default'
}

export type PortConfig = Record<PortName, PortChoice>

const ENV_KEYS: Record<PortName, string> = {
  web: 'OPENALICE_WEB_PORT',
  mcp: 'OPENALICE_MCP_PORT',
  uta: 'OPENALICE_UTA_PORT',
  ui: 'OPENALICE_UI_PORT',
}

function parsePort(raw: unknown, origin: string): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`[guardian] invalid port ${JSON.stringify(raw)} from ${origin} — expected an integer in 1..65535`)
  }
  return n
}

/**
 * Read `data/config/ports.json` under `userDataHome`. Missing file → {}.
 * Present-but-broken (bad JSON / non-integer values) fails loud — a typo in
 * explicit config should abort the boot, not silently fall back to defaults.
 */
export async function readPortsFile(userDataHome: string): Promise<Partial<Record<PortName, number>>> {
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
    throw new Error(`[guardian] ${filePath} must be a JSON object like {"web":47331,"mcp":47332,"uta":47333,"ui":5173}`)
  }
  const out: Partial<Record<PortName, number>> = {}
  for (const name of Object.keys(PORT_DEFAULTS) as PortName[]) {
    const v = (parsed as Record<string, unknown>)[name]
    if (v !== undefined) out[name] = parsePort(v, `${filePath} ("${name}")`)
  }
  return out
}

/** Resolve each port's value + source: env > ports.json > default. */
export function resolvePortConfig(
  env: NodeJS.ProcessEnv,
  file: Partial<Record<PortName, number>>,
): PortConfig {
  const pick = (name: PortName): PortChoice => {
    const envRaw = env[ENV_KEYS[name]]
    if (envRaw !== undefined && envRaw !== '') {
      return { value: parsePort(envRaw, ENV_KEYS[name]), source: 'env' }
    }
    const fromFile = file[name]
    if (fromFile !== undefined) return { value: fromFile, source: 'file' }
    return { value: PORT_DEFAULTS[name], source: 'default' }
  }
  return { web: pick('web'), mcp: pick('mcp'), uta: pick('uta'), ui: pick('ui') }
}

/**
 * Turn a resolved PortConfig into bindable ports. Explicit (env/file) ports
 * assert-free and fail loud when taken; default ports probe upward (web from
 * 47331, mcp from web+1, uta from max(47333, mcp+1), ui from 5173) — the
 * historical collision-dodging behavior. The ui port is resolved here too
 * (not left to Vite's own auto-increment) so Guardian can print the real
 * URL and inject the value into Alice for the WS-origin allowlist.
 */
export async function planPorts(cfg: PortConfig): Promise<GuardianPorts> {
  const claim = async (name: PortName, choice: PortChoice, probeStart: number): Promise<number> => {
    if (choice.source === 'default') return probeFreePort(probeStart)
    try {
      return await probeFreePort(choice.value, choice.value)
    } catch {
      throw new Error(
        `[guardian] port ${choice.value} (${name}, from ${choice.source === 'env' ? ENV_KEYS[name] : 'data/config/ports.json'}) is already in use — free it or configure another port`,
      )
    }
  }
  const webPort = await claim('web', cfg.web, PORT_DEFAULTS.web)
  const mcpPort = await claim('mcp', cfg.mcp, webPort + 1)
  const utaPort = await claim('uta', cfg.uta, Math.max(PORT_DEFAULTS.uta, mcpPort + 1))
  const uiPort = await claim('ui', cfg.ui, PORT_DEFAULTS.ui)
  return { webPort, mcpPort, utaPort, uiPort }
}

export interface SpawnSpec {
  name: 'uta' | 'alice' | 'vite'
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  /** When true, pipe stdout/stderr through this process with a `[name] `
   *  prefix on every line. Default true in dev, false in prod. */
  prefixLogs: boolean
}

/**
 * Resolve a dev bin command to its absolute Windows `.CMD` shim when one
 * exists locally.
 *
 * On Windows the dev commands (`tsx`, `pnpm`) are `.CMD` shims in
 * `node_modules/.bin`. Guardian spawns children through cmd.exe (shell:true),
 * which would resolve them via PATH — but a Git-Bash / MSYS PATH (or a
 * service-account environment in a self-hosted deploy) frequently doesn't
 * carry the project's `.bin` dir, so a bare `tsx` throws ENOENT. Handing
 * cmd.exe the absolute `.CMD` path removes that PATH dependency.
 *
 * Two guards the naive "always rewrite to .bin\<cmd>.CMD" form needs:
 *   - Only rewrite when the shim actually exists — a globally-installed `pnpm`
 *     (the Vite child) has no local `node_modules\.bin\pnpm.CMD`; for it we
 *     fall through to the bare command so cmd.exe's PATH lookup still finds the
 *     global install.
 *   - Quote the path when it contains a space (`C:\Program Files\…`): under
 *     shell:true the command line is parsed by cmd.exe (`/s /c`), which would
 *     otherwise split the path at the space.
 *
 * No-op off Windows — POSIX resolves `.bin` directly with shell off. Reported
 * by @2233admin (#378), reimplemented here.
 *
 * `platform` / `binDir` / `exists` are injectable so the Windows branch is
 * unit-testable on any OS (it never runs on the POSIX boxes CI mostly uses).
 */
export function resolveWindowsBin(
  command: string,
  platform: NodeJS.Platform = process.platform,
  binDir: string = resolve(process.cwd(), 'node_modules', '.bin'),
  exists: (p: string) => boolean = existsSync,
): string {
  if (platform !== 'win32') return command
  const shim = `${binDir}\\${command}.CMD`
  if (!exists(shim)) return command
  return shim.includes(' ') ? `"${shim}"` : shim
}

export function spawnChild(spec: SpawnSpec): ChildProcess {
  const child = spawn(resolveWindowsBin(spec.command), spec.args, {
    env: spec.env,
    stdio: spec.prefixLogs ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    // On Windows the dev commands (`tsx`, `pnpm`) are `.cmd` shims in
    // node_modules/.bin. Node's spawn won't apply PATHEXT resolution to find
    // them without a shell, so a bare `spawn('tsx', …)` throws ENOENT — and a
    // Git-Bash PATH may not even carry .bin, so the command is resolved to its
    // absolute shim above. POSIX resolves the bin dir directly, so keep shell
    // off there. Args here have no spaces, so shell quoting isn't a concern.
    shell: process.platform === 'win32',
  } satisfies SpawnOptions)

  if (spec.prefixLogs) {
    const tag = `[${spec.name}] `
    child.stdout?.on('data', (buf: Buffer) => writePrefixed(process.stdout, buf, tag))
    child.stderr?.on('data', (buf: Buffer) => writePrefixed(process.stderr, buf, tag))
  }
  return child
}

/**
 * Kill a child *and its descendants*, cross-platform.
 *
 * On Windows the dev children spawn through a shell (see spawnChild), so the
 * ChildProcess handle points at the `cmd.exe` wrapper — `child.kill()` reaps
 * the wrapper but orphans the real `node`/`tsx` grandchild, which keeps
 * holding its port. That breaks UTA restart (the fresh UTA can't bind the
 * still-occupied port) and leaves zombies on shutdown. `taskkill /T` walks
 * the whole process tree; `/F` is the only reliable kill for a detached
 * console child. POSIX has no wrapper, so a direct signal is correct and
 * keeps graceful SIGTERM (which taskkill /F can't offer anyway).
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.pid == null) return
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']) } catch { /* already gone */ }
  } else {
    try { child.kill(signal) } catch { /* already gone */ }
  }
}

function writePrefixed(stream: NodeJS.WriteStream, buf: Buffer, tag: string): void {
  const lines = buf.toString('utf8').split('\n')
  // Last element is "" when buf ended with \n; preserve that the right way
  // so partial mid-line writes aren't mangled with mid-stream prefixes.
  for (let i = 0; i < lines.length - 1; i++) {
    stream.write(tag + lines[i] + '\n')
  }
  // Trailing partial line (no terminating \n) goes through without prefix —
  // it'll get prefixed when the next chunk completes the line. Good enough
  // for dev orchestration; not a contract.
  if (lines[lines.length - 1] !== '') {
    stream.write(tag + lines[lines.length - 1])
  }
}

/**
 * Poll an HTTP URL until it returns 200, or until timeout. Returns true
 * if the URL became ready, false on timeout. Used by Guardian to gate
 * Alice startup on UTA `/__uta/health` being live.
 */
export async function waitForHttp(url: string, opts: {
  timeoutMs: number
  intervalMs?: number
}): Promise<boolean> {
  const interval = opts.intervalMs ?? 100
  const deadline = Date.now() + opts.timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch { /* not ready yet */ }
    await sleep(interval)
  }
  return false
}

/** Cascade-shutdown supervisor — kills all tracked children on signal or
 *  unexpected child exit, then exits itself. Idempotent (safe to call
 *  twice on rapid SIGINT or child crash + signal race).
 *
 *  `children` is the initial set; `trackReplacement(old, next)` rewires
 *  exit-listeners when UTAController respawns its child. */
export interface CascadeOpts {
  children: ChildProcess[]
  /** Grace period before SIGKILL fallback. */
  graceMs?: number
  /** Set true on children whose exit should NOT cascade — UTA during a
   *  Guardian-initiated restart. */
  expectedExits?: Set<ChildProcess>
}

export interface CascadeControl {
  shutdown: () => void
  /** Mark this child's upcoming exit as expected — Guardian is intentionally
   *  killing it (UTA restart). Call before sending SIGTERM. */
  expectExit: (child: ChildProcess) => void
  /** Track a freshly-spawned replacement so its unexpected exit cascades. */
  trackReplacement: (old: ChildProcess, next: ChildProcess) => void
}

export function installCascadeShutdown(opts: CascadeOpts): CascadeControl {
  let stopping = false
  const graceMs = opts.graceMs ?? 5_000
  const expected = opts.expectedExits ?? new Set<ChildProcess>()
  const children = [...opts.children]

  const shutdown = (): void => {
    if (stopping) return
    stopping = true
    for (const c of children) {
      if (c.exitCode === null && !c.killed) {
        killTree(c, 'SIGTERM')
      }
    }
    setTimeout(() => {
      for (const c of children) {
        if (c.exitCode === null && !c.killed) {
          killTree(c, 'SIGKILL')
        }
      }
      process.exit(0)
    }, graceMs).unref()
  }

  const attachExitListener = (child: ChildProcess): void => {
    child.once('exit', (code, signal) => {
      if (stopping) return
      if (expected.has(child)) {
        expected.delete(child)
        return
      }
      console.log(`[guardian] ${childTag(child, children)} exited (code=${code}, signal=${signal}) — cascading shutdown`)
      shutdown()
    })
  }

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, shutdown)
  }
  for (const child of children) attachExitListener(child)

  return {
    shutdown,
    expectExit: (child) => { expected.add(child) },
    trackReplacement: (old, next) => {
      const idx = children.indexOf(old)
      if (idx >= 0) children[idx] = next
      else children.push(next)
      attachExitListener(next)
    },
  }
}

function childTag(c: ChildProcess, _all: ChildProcess[]): string {
  // Minimal tagging — argv hint when available. Refined naming requires
  // wrapping spawnChild + tracking spec metadata; not worth it for log lines.
  const cmd = c.spawnargs[0] ?? '?'
  return cmd
}

// ==================== UTA controller ====================

/**
 * Holder for the UTA child process with restart support. Guardian uses this
 * to swap UTA out from under Alice on config changes — Alice stays up,
 * UTA gets a fresh process with re-read accounts.json.
 *
 * Restart path = startup path: SIGTERM the old, wait exit, re-spawn with
 * same spec, gate Alice's BFF on the new health endpoint.
 */
export class UTAController {
  private child: ChildProcess
  private restarting = false
  /** Optional cascade hooks. UTA respawn must inform cascade so SIGINT
   *  still finds the live child, and the intentional kill of the old
   *  child isn't mistaken for a crash. */
  cascade?: { expectExit: (c: ChildProcess) => void; trackReplacement: (old: ChildProcess, next: ChildProcess) => void }

  constructor(
    private readonly spec: SpawnSpec,
    private readonly healthUrl: string,
    initial: ChildProcess,
  ) {
    this.child = initial
  }

  get process(): ChildProcess {
    return this.child
  }

  async restart(): Promise<void> {
    if (this.restarting) {
      console.log(`[guardian] UTA restart already in progress, skipping`)
      return
    }
    this.restarting = true
    try {
      console.log(`[guardian] restarting UTA`)
      const old = this.child
      this.cascade?.expectExit(old)
      const exited = new Promise<void>((resolve) => old.once('exit', () => resolve()))
      killTree(old, 'SIGTERM')
      await Promise.race([exited, sleep(8_000)])
      if (old.exitCode === null) {
        killTree(old, 'SIGKILL')
        await exited
      }

      const next = spawnChild(this.spec)
      this.child = next
      this.cascade?.trackReplacement(old, next)

      const ready = await waitForHttp(this.healthUrl, { timeoutMs: 15_000 })
      if (!ready) {
        console.error(`[guardian] UTA failed to come back up after restart`)
        return
      }
      console.log(`[guardian] UTA back online`)
    } finally {
      this.restarting = false
    }
  }
}

// ==================== restart-flag watcher ====================

/**
 * Watch a control flag file. When it changes (Alice writes it after
 * accounts.json mutation), call `onTrigger`. Debounced — multiple writes
 * within `debounceMs` collapse to one call.
 *
 * fs.watch is event-driven on macOS/Linux. The flag file may not exist
 * yet when watch starts — we ensure the parent directory exists and start
 * a per-second poll fallback to handle the bootstrap-time case where the
 * file is created after watch attaches (rename events on some FSes).
 */
export interface FlagWatchOpts {
  flagPath: string
  onTrigger: () => void
  debounceMs?: number
}

export async function startFlagWatcher(opts: FlagWatchOpts): Promise<() => void> {
  const debounceMs = opts.debounceMs ?? 100
  await mkdir(dirname(opts.flagPath), { recursive: true })

  const abort = new AbortController()
  let pending: NodeJS.Timeout | undefined

  const fire = (): void => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      try { opts.onTrigger() } catch (err) {
        console.error(`[guardian] flag-watcher onTrigger threw:`, err)
      }
    }, debounceMs)
  }

  ;(async () => {
    try {
      const watcher = watch(dirname(opts.flagPath), { signal: abort.signal })
      for await (const evt of watcher) {
        if (evt.filename === basename(opts.flagPath)) fire()
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      console.error(`[guardian] flag watcher errored:`, err)
    }
  })().catch(() => { /* swallow — already logged */ })

  return () => abort.abort()
}
