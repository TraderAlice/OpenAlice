/**
 * HeadlessTaskRegistry — the management plane for headless (automation) runs.
 *
 * A global, disk-backed log of every headless dispatch so the operator can see
 * "what are the workers doing" (status, which agent, how long) across ALL
 * workspaces — not per-workspace like SessionRegistry, because the panel is one
 * cross-workspace view. Versioned JSON, atomic tmp→rename (same posture as
 * SessionRegistry).
 *
 * v1 liveness is EPHEMERAL: a headless task is an in-process child, so it dies
 * when Alice restarts. `reconcile()` on boot marks any leftover `running` record
 * `interrupted` (its process is gone) — so the panel never shows a zombie
 * "running" from a previous Alice life. (Durable/detached runs are a later
 * upgrade; see project_workspace_automation_design.)
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Logger } from './logger.js'

export type HeadlessTaskStatus = 'running' | 'done' | 'failed' | 'interrupted'

export interface HeadlessTaskRecord {
  readonly taskId: string
  readonly wsId: string
  readonly agent: string
  /** The task prompt (the run's instruction) — shown collapsible in the panel. */
  readonly prompt: string
  status: HeadlessTaskStatus
  readonly startedAt: number
  finishedAt?: number
  durationMs?: number
  exitCode?: number | null
  signal?: string | null
  killed?: boolean
  error?: string
}

const MAX_RECORDS = 200 // prune oldest FINISHED records past this (bounds the file)

export class HeadlessTaskRegistry {
  private tasks: HeadlessTaskRecord[] = [] // newest-last in memory

  private constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  static async load(path: string, logger: Logger): Promise<HeadlessTaskRegistry> {
    const reg = new HeadlessTaskRegistry(path, logger)
    await reg.read()
    await reg.reconcile()
    return reg
  }

  private async read(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as {
        tasks?: HeadlessTaskRecord[]
      }
      this.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
    } catch {
      this.tasks = [] // missing or corrupt → start clean
    }
  }

  /** Boot fixup: a leftover `running` task is a zombie from a dead Alice (v1 in-process). */
  private async reconcile(): Promise<void> {
    let changed = false
    for (const t of this.tasks) {
      if (t.status === 'running') {
        t.status = 'interrupted'
        t.finishedAt = t.finishedAt ?? t.startedAt
        changed = true
      }
    }
    if (changed) await this.flush()
  }

  async create(input: {
    wsId: string
    agent: string
    prompt: string
    startedAt: number
  }): Promise<HeadlessTaskRecord> {
    const rec: HeadlessTaskRecord = {
      taskId: randomUUID(),
      wsId: input.wsId,
      agent: input.agent,
      prompt: input.prompt,
      status: 'running',
      startedAt: input.startedAt,
    }
    this.tasks.push(rec)
    await this.flush()
    return rec
  }

  async complete(
    taskId: string,
    patch: Partial<
      Pick<
        HeadlessTaskRecord,
        'status' | 'finishedAt' | 'durationMs' | 'exitCode' | 'signal' | 'killed' | 'error'
      >
    >,
  ): Promise<void> {
    const rec = this.tasks.find((t) => t.taskId === taskId)
    if (!rec) return
    Object.assign(rec, patch)
    await this.flush()
  }

  get(taskId: string): HeadlessTaskRecord | null {
    return this.tasks.find((t) => t.taskId === taskId) ?? null
  }

  /** Records newest-first, optionally filtered. */
  list(opts: { wsId?: string; status?: HeadlessTaskStatus; limit?: number } = {}): HeadlessTaskRecord[] {
    let out = this.tasks.filter(
      (t) => (!opts.wsId || t.wsId === opts.wsId) && (!opts.status || t.status === opts.status),
    )
    out = out.slice().reverse() // newest-first
    return opts.limit && opts.limit > 0 ? out.slice(0, opts.limit) : out
  }

  runningCount(): number {
    return this.tasks.reduce((n, t) => (t.status === 'running' ? n + 1 : n), 0)
  }

  private async flush(): Promise<void> {
    if (this.tasks.length > MAX_RECORDS) {
      // Drop the OLDEST finished records; never drop a `running` one.
      const dropCount = this.tasks.length - MAX_RECORDS
      const toDrop = new Set(
        this.tasks
          .filter((t) => t.status !== 'running')
          .slice(0, dropCount)
          .map((t) => t.taskId),
      )
      if (toDrop.size) this.tasks = this.tasks.filter((t) => !toDrop.has(t.taskId))
    }
    try {
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      await writeFile(tmp, JSON.stringify({ version: 1, tasks: this.tasks }, null, 2), 'utf8')
      await rename(tmp, this.path)
    } catch (err) {
      this.logger.warn('headless_registry.flush_failed', { err })
    }
  }
}
