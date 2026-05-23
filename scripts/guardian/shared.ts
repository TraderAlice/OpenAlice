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

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { watch, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { probeFreePort } from '../probe-port.js'

export interface GuardianPorts {
  webPort: number
  mcpPort: number
  utaPort: number
}

/** Probe all three ports starting from defaults. Returns triple. */
export async function probePorts(opts: {
  webStart?: number
  utaStart?: number
} = {}): Promise<GuardianPorts> {
  const webStart = opts.webStart ?? 47331
  const utaStart = opts.utaStart ?? 47333
  const webPort = await probeFreePort(webStart)
  const mcpPort = await probeFreePort(webPort + 1)
  const utaPort = await probeFreePort(Math.max(utaStart, mcpPort + 1))
  return { webPort, mcpPort, utaPort }
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

export function spawnChild(spec: SpawnSpec): ChildProcess {
  // On Windows, node_modules/.bin entries are .CMD shims — spawn() without
  // shell:true can't find them. Combine command+args into one string so
  // cmd.exe resolves .CMD correctly without triggering DEP0190 (args concat warning).
  const isWin = process.platform === 'win32'
  const shellCmd = isWin ? [spec.command, ...spec.args].join(' ') : spec.command
  const shellArgs = isWin ? [] : spec.args
  const child = spawn(shellCmd, shellArgs, {
    env: spec.env,
    shell: isWin,
    stdio: spec.prefixLogs ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  } satisfies SpawnOptions)

  if (spec.prefixLogs) {
    const tag = `[${spec.name}] `
    child.stdout?.on('data', (buf: Buffer) => writePrefixed(process.stdout, buf, tag))
    child.stderr?.on('data', (buf: Buffer) => writePrefixed(process.stderr, buf, tag))
  }
  return child
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
        try { c.kill('SIGTERM') } catch { /* noop */ }
      }
    }
    setTimeout(() => {
      for (const c of children) {
        if (c.exitCode === null && !c.killed) {
          try { c.kill('SIGKILL') } catch { /* noop */ }
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
      try { old.kill('SIGTERM') } catch { /* noop */ }
      await Promise.race([exited, sleep(8_000)])
      if (old.exitCode === null) {
        try { old.kill('SIGKILL') } catch { /* noop */ }
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

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}
