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
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Logger } from './logger.js'

export type HeadlessTaskStatus = 'running' | 'done' | 'failed' | 'interrupted'

export interface HeadlessTaskOutputSummary {
  readonly hasAssistantReply: boolean
  readonly assistantPreview?: string
  readonly blockCount: number
  readonly toolCalls: number
  readonly toolFailures: number
}

export interface HeadlessTaskRecord {
  readonly taskId: string
  readonly wsId: string
  /**
   * The workspace ISSUE that triggered this run, when it was fired by the
   * ScheduleScanner from a scheduled `.alice/issues/<id>.md` (the issue id ==
   * the filename stem). Absent on MANUAL/external dispatches (the workspace
   * "run task" route) and on runs that predate the field — those have no owning
   * issue. This is the run↔issue link the issue detail's Activity feed joins on.
   */
  readonly issueId?: string
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
  /**
   * The agent CLI's OWN session id, captured from the run's stdout (adapter's
   * `extractHeadlessSessionId`). This is what makes a headless run REOPENABLE:
   * spawn an interactive session with `resume: { sessionId }` and the user
   * lands inside the run's full conversation. Absent on runs that died before
   * announcing (spawn failure) or predate the field.
   */
  agentSessionId?: string
  /** Compact list-view projection; full normalized blocks stay in the log API. */
  output?: HeadlessTaskOutputSummary
}

/** Task-log file paths — shared by the writer (service) and reader (route). */
export function headlessLogPaths(
  logsDir: string,
  taskId: string,
): { stdout: string; stderr: string; structured: string } {
  return {
    stdout: join(logsDir, `${taskId}.stdout.log`),
    stderr: join(logsDir, `${taskId}.stderr.log`),
    structured: join(logsDir, `${taskId}.structured.json`),
  }
}

const MAX_RECORDS = 200 // prune oldest FINISHED records past this (bounds the file)

export class HeadlessTaskRegistry {
  private tasks: HeadlessTaskRecord[] = [] // newest-last in memory
  /** Mutations may finish concurrently; serialize tmp→rename writes. */
  private flushChain: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private readonly logger: Logger,
    /** Where task logs live; pruned records get their log files deleted too. */
    private readonly logsDir: string | null,
  ) {}

  static async load(
    path: string,
    logger: Logger,
    opts: { logsDir?: string } = {},
  ): Promise<HeadlessTaskRegistry> {
    const reg = new HeadlessTaskRegistry(path, logger, opts.logsDir ?? null)
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
    /** Set only when an issue fired this run (scheduled scan); omitted for manual/external runs. */
    issueId?: string
  }): Promise<HeadlessTaskRecord> {
    const rec: HeadlessTaskRecord = {
      taskId: randomUUID(),
      wsId: input.wsId,
      agent: input.agent,
      prompt: input.prompt,
      status: 'running',
      startedAt: input.startedAt,
      // Keep the field absent (not `undefined`) on manual runs so the JSON stays clean.
      ...(input.issueId ? { issueId: input.issueId } : {}),
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
        'status' | 'finishedAt' | 'durationMs' | 'exitCode' | 'signal' | 'killed' | 'error' | 'output'
      >
    >,
  ): Promise<void> {
    const rec = this.tasks.find((t) => t.taskId === taskId)
    if (!rec) return
    Object.assign(rec, patch)
    await this.flush()
  }

  /** Record the agent's own session id, captured from stdout while running. */
  async setAgentSessionId(taskId: string, agentSessionId: string): Promise<void> {
    const rec = this.tasks.find((t) => t.taskId === taskId)
    if (!rec || rec.agentSessionId === agentSessionId) return
    rec.agentSessionId = agentSessionId
    await this.flush()
  }

  get(taskId: string): HeadlessTaskRecord | null {
    return this.tasks.find((t) => t.taskId === taskId) ?? null
  }

  /** Records newest-first, optionally filtered. */
  list(
    opts: {
      wsId?: string
      issueId?: string
      status?: HeadlessTaskStatus
      /** Return records older than this task in the filtered newest-first view. */
      cursor?: string
      limit?: number
    } = {},
  ): HeadlessTaskRecord[] {
    let out = this.tasks.filter(
      (t) =>
        (!opts.wsId || t.wsId === opts.wsId) &&
        (!opts.issueId || t.issueId === opts.issueId) &&
        (!opts.status || t.status === opts.status),
    )
    out = out.slice().reverse() // newest-first
    if (opts.cursor) {
      const cursorIndex = out.findIndex((task) => task.taskId === opts.cursor)
      // A cursor can disappear when the bounded registry prunes old records.
      // Returning an empty page is safer than silently restarting at page one
      // and duplicating rows in a polling client.
      out = cursorIndex === -1 ? [] : out.slice(cursorIndex + 1)
    }
    return opts.limit && opts.limit > 0 ? out.slice(0, opts.limit) : out
  }

  /** Count filtered records without materializing them over the HTTP boundary. */
  count(opts: { wsId?: string; issueId?: string; status?: HeadlessTaskStatus } = {}): number {
    return this.tasks.reduce(
      (count, task) => count + (
        (!opts.wsId || task.wsId === opts.wsId) &&
        (!opts.issueId || task.issueId === opts.issueId) &&
        (!opts.status || task.status === opts.status)
          ? 1
          : 0
      ),
      0,
    )
  }

  runningCount(): number {
    return this.tasks.reduce((n, t) => (t.status === 'running' ? n + 1 : n), 0)
  }

  private async flush(): Promise<void> {
    const next = this.flushChain.then(() => this.flushNow())
    this.flushChain = next.catch(() => undefined)
    await next
  }

  private async flushNow(): Promise<void> {
    if (this.tasks.length > MAX_RECORDS) {
      // Drop the OLDEST finished records; never drop a `running` one.
      const dropCount = this.tasks.length - MAX_RECORDS
      const toDrop = new Set(
        this.tasks
          .filter((t) => t.status !== 'running')
          .slice(0, dropCount)
          .map((t) => t.taskId),
      )
      if (toDrop.size) {
        this.tasks = this.tasks.filter((t) => !toDrop.has(t.taskId))
        // Best-effort: a pruned record's task logs go with it (bounds disk).
        if (this.logsDir) {
          for (const taskId of toDrop) {
            const paths = headlessLogPaths(this.logsDir, taskId)
            void rm(paths.stdout, { force: true }).catch(() => undefined)
            void rm(paths.stderr, { force: true }).catch(() => undefined)
            void rm(paths.structured, { force: true }).catch(() => undefined)
          }
        }
      }
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
