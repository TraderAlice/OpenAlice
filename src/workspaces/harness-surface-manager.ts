import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'

import { terminateProcessTree } from '@traderalice/guardian-runtime'

import { buildSpawnEnv } from './spawn-env.js'
import { resolveLaunchCommand } from './win-command.js'
import { readHarnessManifest, HarnessManifestError } from './harness-manifest.js'
import type { WorkspaceRegistry } from './workspace-registry.js'
import { logger as launcherLogger } from './logger.js'

const BIND_HOST = '127.0.0.1'
const READINESS_TIMEOUT_MS = 60_000
const LOG_LIMIT = 64 * 1024

export type HarnessSurfacePhase = 'stopped' | 'starting' | 'ready' | 'failed' | 'stopping'

export interface HarnessSurfaceSnapshot {
  readonly workspaceId: string
  readonly capability: string
  readonly manifestVersion?: number
  readonly harnessVersion?: string
  readonly phase: HarnessSurfacePhase
  readonly generation: number
  readonly routeHost?: string
  readonly startedAt?: string
  readonly readyAt?: string
  readonly error?: string
  readonly logs: string
}

interface SurfaceRuntime {
  readonly key: string
  readonly workspaceId: string
  readonly capability: string
  readonly generation: number
  readonly routeHost: string
  readonly ports: Readonly<Record<string, number>>
  readonly entryPort: number
  phase: HarnessSurfacePhase
  child: ChildProcess | null
  manifestVersion: number
  harnessVersion: string
  startedAt: string
  readyAt?: string
  error?: string
  logs: string
  stopping: boolean
}

export interface HarnessSurfaceTarget {
  readonly host: string
  readonly port: number
  readonly generation: number
}

export class HarnessSurfaceManager {
  private readonly runtimes = new Map<string, SurfaceRuntime>()
  private readonly routes = new Map<string, SurfaceRuntime>()
  private readonly operations = new Map<string, Promise<unknown>>()
  private generation = 0
  private disposed = false

  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly options: { readinessTimeoutMs?: number } = {},
  ) {}

  snapshot(workspaceId: string, capability: string): HarnessSurfaceSnapshot {
    const runtime = this.runtimes.get(keyOf(workspaceId, capability))
    if (!runtime) {
      return { workspaceId, capability, phase: 'stopped', generation: 0, logs: '' }
    }
    return project(runtime)
  }

  hasWorkspace(workspaceId: string): boolean {
    return [...this.runtimes.values()].some((runtime) =>
      runtime.workspaceId === workspaceId
      && runtime.phase !== 'stopped'
      && runtime.phase !== 'failed')
  }

  resolveHost(hostHeader: string | null | undefined): HarnessSurfaceTarget | null {
    const host = normalizeHost(hostHeader)
    if (!host) return null
    const runtime = this.routes.get(host)
    if (!runtime || runtime.phase !== 'ready') return null
    return { host: BIND_HOST, port: runtime.entryPort, generation: runtime.generation }
  }

  async start(workspaceId: string, capability: string): Promise<HarnessSurfaceSnapshot> {
    return this.serialize(keyOf(workspaceId, capability), () => this.startRuntime(workspaceId, capability))
  }

  async restart(workspaceId: string, capability: string): Promise<HarnessSurfaceSnapshot> {
    const key = keyOf(workspaceId, capability)
    return this.serialize(key, async () => {
      const existing = this.runtimes.get(key)
      if (existing) await this.stopRuntime(existing)
      return this.startRuntime(workspaceId, capability)
    })
  }

  async stop(workspaceId: string, capability: string): Promise<HarnessSurfaceSnapshot> {
    return this.serialize(keyOf(workspaceId, capability), async () => {
      const runtime = this.runtimes.get(keyOf(workspaceId, capability))
      if (!runtime) return this.snapshot(workspaceId, capability)
      await this.stopRuntime(runtime)
      return project(runtime)
    })
  }

  async stopWorkspace(workspaceId: string): Promise<void> {
    const runtimes = [...this.runtimes.values()].filter((runtime) => runtime.workspaceId === workspaceId)
    await Promise.all(runtimes.map((runtime) => this.stop(runtime.workspaceId, runtime.capability)))
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([...this.runtimes.values()].map((runtime) => this.stopRuntime(runtime)))
    this.routes.clear()
  }

  private async startRuntime(workspaceId: string, capability: string): Promise<HarnessSurfaceSnapshot> {
    if (this.disposed) throw new Error('Harness surface manager is shutting down')
    const existing = this.runtimes.get(keyOf(workspaceId, capability))
    if (existing && (existing.phase === 'starting' || existing.phase === 'ready')) {
      return project(existing)
    }
    if (existing && existing.phase !== 'stopped') await this.stopRuntime(existing)

    const workspace = this.registry.get(workspaceId)
    if (!workspace) throw namedError('WorkspaceNotFound', `workspace not found: ${workspaceId}`)
    const manifest = await readHarnessManifest(workspace.dir)
    const declared = manifest.capabilities[capability]
    if (!declared) throw namedError('HarnessCapabilityNotFound', `Harness capability not found: ${capability}`)

    const ports = await allocatePorts(declared.ports)
    const generation = ++this.generation
    const routeHost = `oa-surface-${randomBytes(12).toString('hex')}.localhost`
    const runtime: SurfaceRuntime = {
      key: keyOf(workspaceId, capability),
      workspaceId,
      capability,
      generation,
      routeHost,
      ports,
      entryPort: ports[declared.entryPort]!,
      phase: 'starting',
      child: null,
      manifestVersion: manifest.manifestVersion,
      harnessVersion: manifest.version,
      startedAt: new Date().toISOString(),
      logs: '',
      stopping: false,
    }
    this.runtimes.set(runtime.key, runtime)

    const env = buildSpawnEnv(process.env, {
      HARNESS_CAPABILITY: capability,
      HARNESS_HOST: BIND_HOST,
      HARNESS_PORTS: JSON.stringify(ports),
      HARNESS_NO_OPEN: '1',
    }, workspace.dir)
    const resolved = resolveLaunchCommand(declared.command, { env, cwd: workspace.dir })
    const [file, ...args] = resolved.argv
    if (!file) throw new Error('Harness capability command is empty')

    launcherLogger.info('harness_surface.starting', {
      workspaceId,
      capability,
      generation,
      command: declared.command[0],
      launchMode: resolved.mode,
      portNames: Object.keys(ports),
    })
    try {
      const child = spawn(file, args, {
        cwd: workspace.dir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      runtime.child = child
      child.stdout?.on('data', (chunk: Buffer) => appendLog(runtime, chunk))
      child.stderr?.on('data', (chunk: Buffer) => appendLog(runtime, chunk))
      child.once('error', (err) => {
        appendLog(runtime, Buffer.from(`${err.message}\n`))
        this.fail(runtime, `Could not start ${declared.command[0]}`)
      })
      child.once('exit', (code, signal) => {
        if (!this.isCurrent(runtime) || runtime.stopping || runtime.phase === 'failed') return
        const suffix = signal ? `signal ${signal}` : `exit ${code ?? 'unknown'}`
        this.fail(runtime, `Studio stopped before it was closed (${suffix})`)
      })
    } catch (err) {
      runtime.phase = 'failed'
      runtime.error = err instanceof Error ? err.message : String(err)
      return project(runtime)
    }

    void this.waitForReady(runtime, declared.readinessPath)
    return project(runtime)
  }

  private async waitForReady(runtime: SurfaceRuntime, readinessPath: string): Promise<void> {
    const readinessTimeoutMs = this.options.readinessTimeoutMs ?? READINESS_TIMEOUT_MS
    const deadline = Date.now() + readinessTimeoutMs
    const url = `http://${BIND_HOST}:${runtime.entryPort}${readinessPath}`
    while (this.isCurrent(runtime) && runtime.phase === 'starting' && Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
        if (response.ok) {
          runtime.phase = 'ready'
          runtime.readyAt = new Date().toISOString()
          this.routes.set(runtime.routeHost, runtime)
          launcherLogger.info('harness_surface.ready', {
            workspaceId: runtime.workspaceId,
            capability: runtime.capability,
            generation: runtime.generation,
          })
          return
        }
      } catch {
        // Listener may not exist yet. Child exit is handled independently.
      }
      await delay(250)
    }
    if (this.isCurrent(runtime) && runtime.phase === 'starting') {
      this.fail(runtime, `Studio readiness timed out after ${formatDuration(readinessTimeoutMs)}`)
      await this.stopChild(runtime)
    }
  }

  private async stopRuntime(runtime: SurfaceRuntime): Promise<void> {
    if (runtime.phase === 'stopped') return
    runtime.stopping = true
    runtime.phase = 'stopping'
    this.routes.delete(runtime.routeHost)
    await this.stopChild(runtime)
    runtime.phase = 'stopped'
    runtime.stopping = false
    runtime.error = undefined
    launcherLogger.info('harness_surface.stopped', {
      workspaceId: runtime.workspaceId,
      capability: runtime.capability,
      generation: runtime.generation,
    })
  }

  private async stopChild(runtime: SurfaceRuntime): Promise<void> {
    const child = runtime.child
    runtime.child = null
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
    try {
      await terminateProcessTree(child.pid, { gracefulMs: 4_000, forceMs: 4_000 })
    } catch (err) {
      appendLog(runtime, Buffer.from(`OpenAlice cleanup: ${err instanceof Error ? err.message : String(err)}\n`))
    }
  }

  private fail(runtime: SurfaceRuntime, message: string): void {
    if (!this.isCurrent(runtime) || runtime.phase === 'failed') return
    runtime.phase = 'failed'
    runtime.error = message
    this.routes.delete(runtime.routeHost)
    launcherLogger.warn('harness_surface.failed', {
      workspaceId: runtime.workspaceId,
      capability: runtime.capability,
      generation: runtime.generation,
      error: message,
    })
  }

  private isCurrent(runtime: SurfaceRuntime): boolean {
    return this.runtimes.get(runtime.key)?.generation === runtime.generation
  }

  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.operations.set(key, next)
    void next.finally(() => {
      if (this.operations.get(key) === next) this.operations.delete(key)
    }).catch(() => undefined)
    return next
  }
}

function project(runtime: SurfaceRuntime): HarnessSurfaceSnapshot {
  return {
    workspaceId: runtime.workspaceId,
    capability: runtime.capability,
    manifestVersion: runtime.manifestVersion,
    harnessVersion: runtime.harnessVersion,
    phase: runtime.phase,
    generation: runtime.generation,
    ...(runtime.phase === 'ready' ? { routeHost: runtime.routeHost } : {}),
    startedAt: runtime.startedAt,
    ...(runtime.readyAt ? { readyAt: runtime.readyAt } : {}),
    ...(runtime.error ? { error: runtime.error } : {}),
    logs: runtime.logs,
  }
}

function appendLog(runtime: SurfaceRuntime, chunk: Buffer): void {
  const safe = chunk.toString('utf8')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_ -]?key|token|secret|password)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
    .replace(/\b(?:127\.0\.0\.1|localhost):\d+\b/gi, '[HARNESS_LOOPBACK]')
    .replace(/\[::1\]:\d+/g, '[HARNESS_LOOPBACK]')
  runtime.logs = `${runtime.logs}${safe}`.slice(-LOG_LIMIT)
}

function keyOf(workspaceId: string, capability: string): string {
  return `${workspaceId}\u0000${capability}`
}

function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null
  const host = value.trim().toLowerCase().replace(/:\d+$/, '')
  return /^oa-surface-[a-f0-9]{24}\.localhost$/.test(host) ? host : null
}

async function allocatePorts(names: readonly string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  const used = new Set<number>()
  for (const name of names) {
    let port = 0
    do port = await allocatePort()
    while (used.has(port))
    used.add(port)
    result[name] = port
  }
  return result
}

function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, BIND_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((err) => err ? reject(err) : resolve(port))
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatDuration(ms: number): string {
  return ms % 1_000 === 0 ? `${ms / 1_000} seconds` : `${ms}ms`
}

function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

export { HarnessManifestError }
