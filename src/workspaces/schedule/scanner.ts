/**
 * ScheduleScanner - the dumb external scheduler for workspace self-declared
 * issues. Each tick it enumerates every workspace, reads that workspace's own
 * `.alice/issues/<id>.md` files live, and for every SCHEDULED + due issue (one
 * that carries a `when`) fires a headless run via the workspace's automation
 * interface. Issues without a `when` are pure board work items and are ignored
 * here. It interprets NOTHING about the work - the fire prompt (`what`, else
 * title+body) is handed straight to `dispatchHeadlessTask`.
 *
 * The ~1-min tick is the scheduler's OWN control loop (a plain timer), NOT a
 * scheduled task - infrastructure periodicity never enters the self-description
 * system. There is deliberately NO per-workspace lock: if a fire collides with a
 * still-running run or a live interactive session in the same checkout, the
 * coding agent absorbs it (it lives in multi-AI-on-one-repo all day). The only
 * bound is the global headless concurrency cap inside `dispatch`.
 *
 * Due-ness carries no external schedule state (see `fireBase`): from the last
 * fire, or a never-fired baseline — `every`/`at` from epoch (fire on first
 * sight), `cron` from `now - interval` (catches an occurrence that just passed,
 * without firing immediately on creation OR never firing at all — seeding cron
 * from `now` makes `computeNextRun` always strictly future, i.e. never due).
 * Then `computeNextRun(when, base) <= now`. The marker is written only AFTER a
 * successful dispatch, so a capacity-rejected `every`/`at` fire retries next
 * tick; a `cron` fire rejected at its exact occurrence may skip to the next
 * occurrence (rare — needs the pool full at that minute).
 */

import { computeNextRun, type Schedule } from '../../core/schedule-expr.js'
import type { CliAdapter } from '../cli-adapter.js'
import type { Logger } from '../logger.js'
import type { WorkspaceMeta, WorkspaceRegistry } from '../workspace-registry.js'
import type { HeadlessTaskTrigger } from '../headless-task-registry.js'

import { isFireable, issueAssigneeResumeId, issueFirePrompt, readWorkspaceIssues } from '../issues/declaration.js'

import {
  fireBase,
  snapshotScheduledIssue,
  type ScheduleSnapshot,
  type ScheduleSnapshotTask,
  type ScheduleSnapshotWorkspace,
} from './declaration.js'

export const DEFAULT_INTERVAL_MS = 60_000
/** Matches the legacy cron-router's headless dispatch timeout. */
const RUN_TIMEOUT_MS = 30 * 60_000

/** The slice of ScheduleMarkerStore the scanner needs (structural, for testing). */
export interface MarkerStore {
  key(wsId: string, taskId: string): string
  get(wsId: string, taskId: string): number | undefined
  set(wsId: string, taskId: string, ts: number): Promise<void>
  prune(seenKeys: Set<string>): Promise<void>
}

export interface ScheduleScannerDeps {
  registry: WorkspaceRegistry
  /** Resolve the execution Workspace for an exact signed Session owner. */
  resolveResumeWorkspace?: (resumeId: string) => WorkspaceMeta | undefined
  resolveAdapter: (meta: WorkspaceMeta, agentId?: string, resumeId?: string) => CliAdapter | Promise<CliAdapter>
  dispatch: (
    meta: WorkspaceMeta,
    adapter: CliAdapter,
    prompt: string,
    timeoutMs: number,
    /** Composite source of the dispatch. Execution may happen elsewhere. */
    trigger?: HeadlessTaskTrigger,
    /** Product Session to continue. Omitted means allocate a fresh Session. */
    resumeId?: string,
  ) => Promise<{ taskId: string }>
  markers: MarkerStore
  logger: Logger
  /** Injectable clock for tests. */
  now?: () => number
  /** Injectable tick interval for tests. */
  intervalMs?: number
}

export class ScheduleScanner {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private scanning = false
  /** Snapshot built as a side-effect of each scan; null until the first scan. */
  private lastSnapshot: ScheduleSnapshot | null = null
  private readonly now: () => number
  private readonly intervalMs: number

  constructor(private readonly deps: ScheduleScannerDeps) {
    this.now = deps.now ?? Date.now
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS
  }

  /** Begin ticking. First scan happens after one interval (never on construct). */
  start(): void {
    if (this.timer || this.stopped) return
    this.arm()
    this.deps.logger.info('schedule.scanner_started', { intervalMs: this.intervalMs })
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** The snapshot built by the last scan (warm cache for GET /api/schedule), or
   *  null before the first tick. The scanner already reads every declaration each
   *  tick, so this is free — the route serves it instead of re-walking disk. */
  snapshot(): ScheduleSnapshot | null {
    return this.lastSnapshot
  }

  private arm(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => void this.tickAndRearm(), this.intervalMs)
    // Don't hold the event loop / a test runner open on the scheduler's timer.
    this.timer.unref?.()
  }

  private async tickAndRearm(): Promise<void> {
    this.timer = null
    if (this.stopped) return
    try {
      await this.scan()
    } catch (err) {
      this.deps.logger.warn('schedule.scan_failed', { err })
    }
    if (!this.stopped) this.arm()
  }

  /** One full pass over all workspaces. Public for tests / a future "scan now". */
  async scan(): Promise<void> {
    if (this.scanning) {
      this.deps.logger.info('schedule.scan_overlap_skipped', {})
      return
    }
    this.scanning = true
    const nowMs = this.now()
    const seen = new Set<string>()
    try {
      // registry.list() order is preserved by Promise.all → stable display order.
      const workspaces = await Promise.all(
        this.deps.registry.list().map((ws) => this.scanWorkspace(ws, nowMs, seen)),
      )
      await this.deps.markers.prune(seen)
      this.lastSnapshot = { workspaces }
    } finally {
      this.scanning = false
    }
  }

  /** Read one workspace's issues, fire its due SCHEDULED issues, and return its
   *  snapshot row (only scheduled issues — unscheduled board items never reach
   *  this layer). Reads issues ONCE — firing and the dashboard view come from the
   *  same read. Per-file-invalid issues isolate (they're surfaced to the board
   *  elsewhere); a workspace stays 'ok' as long as its issues dir read at all. */
  private async scanWorkspace(
    ws: WorkspaceMeta,
    nowMs: number,
    seen: Set<string>,
  ): Promise<ScheduleSnapshotWorkspace> {
    let res
    try {
      res = await readWorkspaceIssues(ws.dir)
    } catch (err) {
      this.deps.logger.warn('schedule.read_failed', { wsId: ws.id, err })
      return { wsId: ws.id, tag: ws.tag, status: 'invalid', error: 'failed to read issues', tasks: [] }
    }
    if (!res.ok) {
      if (res.reason === 'invalid') {
        this.deps.logger.warn('schedule.declaration_invalid', { wsId: ws.id, error: res.error })
        return { wsId: ws.id, tag: ws.tag, status: 'invalid', error: res.error, tasks: [] }
      }
      return { wsId: ws.id, tag: ws.tag, status: 'absent', tasks: [] }
    }
    if (res.invalid.length > 0) {
      this.deps.logger.warn('schedule.issue_files_invalid', {
        wsId: ws.id,
        invalid: res.invalid.map((i) => i.id),
      })
    }

    const tasks: ScheduleSnapshotTask[] = []
    for (const issue of res.issues) {
      // No `when` ⇒ pure board work item; the scanner does not touch it.
      const when = issue.when
      if (!when) continue
      seen.add(this.deps.markers.key(ws.id, issue.id))
      if (isFireable(issue) && this.isDue(ws.id, issue.id, when, nowMs)) {
        await this.fire(
          ws,
          issue.id,
          issueFirePrompt(issue),
          issue.agent,
          issueAssigneeResumeId(issue.assignee) ?? undefined,
          nowMs,
        )
      }
      // Read the marker AFTER any fire so last/next reflect a just-fired run.
      const last = this.deps.markers.get(ws.id, issue.id) ?? null
      tasks.push(snapshotScheduledIssue(issue, when, last, nowMs, this.intervalMs))
    }
    return { wsId: ws.id, tag: ws.tag, status: 'ok', tasks }
  }

  private isDue(wsId: string, taskId: string, when: Schedule, nowMs: number): boolean {
    const last = this.deps.markers.get(wsId, taskId) ?? null
    const next = computeNextRun(when, fireBase(when, last, nowMs, this.intervalMs))
    return next !== null && next <= nowMs
  }

  private async fire(
    issueWorkspace: WorkspaceMeta,
    taskId: string,
    what: string,
    agentId: string | undefined,
    resumeId: string | undefined,
    nowMs: number,
  ): Promise<void> {
    try {
      const executionWorkspace = resumeId
        ? this.resolveResumeWorkspace(resumeId)
        : issueWorkspace
      if (!executionWorkspace) {
        this.deps.logger.warn('schedule.resume_workspace_missing', {
          wsId: issueWorkspace.id, taskId, resumeId,
        })
        return
      }
      const adapter = await this.deps.resolveAdapter(executionWorkspace, agentId, resumeId)
      if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
        this.deps.logger.warn('schedule.adapter_not_headless', { wsId: executionWorkspace.id, taskId, agent: adapter.id })
        return
      }
      const trigger: HeadlessTaskTrigger = {
        kind: 'issue',
        workspaceId: issueWorkspace.id,
        issueId: taskId,
      }
      const { taskId: runId } = resumeId
        ? await this.deps.dispatch(executionWorkspace, adapter, what, RUN_TIMEOUT_MS, trigger, resumeId)
        : await this.deps.dispatch(executionWorkspace, adapter, what, RUN_TIMEOUT_MS, trigger)
      await this.deps.markers.set(issueWorkspace.id, taskId, nowMs)
      this.deps.logger.info('schedule.fired', {
        wsId: issueWorkspace.id,
        executionWsId: executionWorkspace.id,
        taskId,
        agent: adapter.id,
        runId,
        owner: resumeId ? 'session' : 'workspace',
        ...(resumeId ? { resumeId } : {}),
      })
    } catch (err) {
      // Capacity full (or transient) - do NOT mark; the task stays due and
      // retries on the next tick once a headless slot frees.
      this.deps.logger.info('schedule.fire_skipped', {
        wsId: issueWorkspace.id,
        taskId,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private resolveResumeWorkspace(resumeId: string): WorkspaceMeta | undefined {
    return this.deps.resolveResumeWorkspace?.(resumeId)
  }
}
