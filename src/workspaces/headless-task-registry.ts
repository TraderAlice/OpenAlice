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
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ModelReasoningEffort } from '../ai-providers/model-semantics.js'
import type { Logger } from './logger.js'

export type HeadlessTaskStatus = 'running' | 'done' | 'failed' | 'interrupted'

const TASK_ID_BYTES = 6

function randomTaskId(): string {
  return `run-${randomBytes(TASK_ID_BYTES).toString('base64url')}`
}

export interface HeadlessTaskOutputSummary {
  readonly hasAssistantReply: boolean
  readonly assistantPreview?: string
  readonly blockCount: number
  readonly toolCalls: number
  readonly toolFailures: number
}

/** The business object that caused an execution. This is intentionally
 * independent from `wsId`: an exact signed Session may execute in Workspace B
 * while answering a scheduled Issue whose source of truth remains Workspace A. */
export type HeadlessTaskTrigger = {
  readonly kind: 'issue'
  readonly workspaceId: string
  readonly issueId: string
}

/** Business object that requested a headless follow-up. Product provenance
 * only: adapter-native session ids never cross into this record. */
export type HeadlessInquirySubject =
  | { readonly kind: 'inbox'; readonly entryId: string }
  | {
      readonly kind: 'issue'
      readonly workspaceId: string
      readonly issueId: string
      readonly relation: 'creator' | 'owner' | 'run'
      readonly runId?: string
      /** Present when this inquiry is the automatic reply to an Issue comment. */
      readonly commentId?: string
    }

/** Reverse-index scope used to load every inquiry attached to one object. */
export type HeadlessInquiryScope =
  | { readonly kind: 'inbox'; readonly entryId: string }
  | { readonly kind: 'issue'; readonly workspaceId: string; readonly issueId: string }

export interface HeadlessTaskInquiry {
  readonly subject: HeadlessInquirySubject
  /** Original user-facing question, before reconstruction instructions wrap it. */
  readonly question: string
  readonly resolution: {
    readonly mode: 'exact' | 'reconstructed'
    readonly reason?: string
  }
}

export interface HeadlessTaskRecord {
  readonly taskId: string
  /**
   * OpenAlice-owned identity of the resumable runtime conversation. Unlike
   * taskId (one execution), resumeId stays stable across every headless turn
   * that continues the same native agent session.
   */
  readonly resumeId: string
  /** The immediately preceding execution in this resumed conversation. */
  readonly parentTaskId?: string
  readonly wsId: string
  /**
   * The workspace ISSUE that triggered this run, when it was fired by the
   * ScheduleScanner from a scheduled `.alice/issues/<id>.md` (the issue id ==
   * the filename stem). Absent on MANUAL/external dispatches (the workspace
   * "run task" route) and on runs that predate the field — those have no owning
   * issue. This is the run↔issue link the issue detail's Activity feed joins on.
   */
  readonly trigger?: HeadlessTaskTrigger
  /** Durable reverse link for Inbox/Issue follow-up UI. */
  readonly inquiry?: HeadlessTaskInquiry
  readonly agent: string
  /** Explicit one-run selections requested by the dispatching Issue. */
  readonly model?: string
  readonly effort?: ModelReasoningEffort
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

export class HeadlessTaskRegistry {
  private tasks: HeadlessTaskRecord[] = [] // newest-last in memory
  /** Mutations may finish concurrently; serialize tmp→rename writes. */
  private flushChain: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  static async load(
    path: string,
    logger: Logger,
  ): Promise<HeadlessTaskRegistry> {
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
    model?: string
    effort?: ModelReasoningEffort
    prompt: string
    startedAt: number
    /** Product identity allocated by ResumeRegistry; reused across continued turns. */
    resumeId: string
    /** Previous execution in the same resume chain, when continuing. */
    parentTaskId?: string
    /** Set only when an Issue fired this run; omitted for manual/external runs. */
    trigger?: HeadlessTaskTrigger
    /** Business follow-up metadata; omitted for automation/manual runs. */
    inquiry?: HeadlessTaskInquiry
  }): Promise<HeadlessTaskRecord> {
    let taskId = randomTaskId()
    while (this.tasks.some((task) => task.taskId === taskId)) taskId = randomTaskId()
    const rec: HeadlessTaskRecord = {
      taskId,
      resumeId: input.resumeId,
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      wsId: input.wsId,
      agent: input.agent,
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      prompt: input.prompt,
      status: 'running',
      startedAt: input.startedAt,
      // Keep the field absent (not `undefined`) on manual runs so the JSON stays clean.
      ...(input.trigger ? { trigger: input.trigger } : {}),
      ...(input.inquiry ? { inquiry: input.inquiry } : {}),
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

  /** Latest execution for one OpenAlice-owned resumable conversation. */
  latestForResumeId(resumeId: string): HeadlessTaskRecord | null {
    for (let index = this.tasks.length - 1; index >= 0; index -= 1) {
      const task = this.tasks[index]
      if (task?.resumeId === resumeId) return task
    }
    return null
  }

  /** Records newest-first, optionally filtered. */
  list(
    opts: {
      wsId?: string
      issue?: { workspaceId: string; issueId: string }
      status?: HeadlessTaskStatus
      inquiry?: HeadlessInquiryScope
      /** Return records older than this task in the filtered newest-first view. */
      cursor?: string
      limit?: number
    } = {},
  ): HeadlessTaskRecord[] {
    let out = this.tasks.filter(
      (t) =>
        (!opts.wsId || t.wsId === opts.wsId) &&
        (!opts.issue || (
          t.trigger?.kind === 'issue' &&
          t.trigger.workspaceId === opts.issue.workspaceId &&
          t.trigger.issueId === opts.issue.issueId
        )) &&
        (!opts.inquiry || inquirySubjectMatches(t.inquiry?.subject, opts.inquiry)) &&
        (!opts.status || t.status === opts.status),
    )
    out = out.slice().reverse() // newest-first
    if (opts.cursor) {
      const cursorIndex = out.findIndex((task) => task.taskId === opts.cursor)
      // A cursor can still be unknown after data restoration or a client typo.
      // Returning an empty page is safer than silently restarting at page one.
      out = cursorIndex === -1 ? [] : out.slice(cursorIndex + 1)
    }
    return opts.limit && opts.limit > 0 ? out.slice(0, opts.limit) : out
  }

  /** Count filtered records without materializing them over the HTTP boundary. */
  count(opts: { wsId?: string; issue?: { workspaceId: string; issueId: string }; status?: HeadlessTaskStatus; inquiry?: HeadlessInquiryScope } = {}): number {
    return this.tasks.reduce(
      (count, task) => count + (
        (!opts.wsId || task.wsId === opts.wsId) &&
        (!opts.issue || (
          task.trigger?.kind === 'issue' &&
          task.trigger.workspaceId === opts.issue.workspaceId &&
          task.trigger.issueId === opts.issue.issueId
        )) &&
        (!opts.inquiry || inquirySubjectMatches(task.inquiry?.subject, opts.inquiry)) &&
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
    try {
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      await writeFile(tmp, JSON.stringify({ version: 3, tasks: this.tasks }, null, 2), 'utf8')
      await rename(tmp, this.path)
    } catch (err) {
      this.logger.warn('headless_registry.flush_failed', { err })
    }
  }
}

function inquirySubjectMatches(
  actual: HeadlessInquirySubject | undefined,
  expected: HeadlessInquiryScope,
): boolean {
  if (!actual || actual.kind !== expected.kind) return false
  if (actual.kind === 'inbox' && expected.kind === 'inbox') {
    return actual.entryId === expected.entryId
  }
  if (actual.kind === 'issue' && expected.kind === 'issue') {
    return actual.workspaceId === expected.workspaceId && actual.issueId === expected.issueId
  }
  return false
}
