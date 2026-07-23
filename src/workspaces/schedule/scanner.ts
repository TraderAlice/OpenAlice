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
import type { CliAdapter, HeadlessRunOverrides } from '../cli-adapter.js'
import type { Logger } from '../logger.js'
import type { WorkspaceMeta, WorkspaceRegistry } from '../workspace-registry.js'
import type { HeadlessTaskTrigger } from '../headless-task-registry.js'

import {
  isFireable,
  issueAssigneeClaimsFirstSession,
  issueAssigneeResumeId,
  issueFirePrompt,
  readWorkspaceIssues,
  type IssueRecord,
} from '../issues/declaration.js'
import { SCHEDULED_ISSUE_RUN_TIMEOUT_MS } from '../issues/run-failure.js'

import {
  fireBase,
  snapshotScheduledIssue,
  type ScheduleSnapshot,
  type ScheduleSnapshotTask,
  type ScheduleSnapshotWorkspace,
} from './declaration.js'

export const DEFAULT_INTERVAL_MS = 60_000

export type ScheduledIssueRunNowErrorCode =
  | 'not_found'
  | 'not_scheduled'
  | 'not_fireable'
  | 'already_running'

/** Stable domain error for the manual retry path. The scheduler's automatic
 * path still catches and logs dispatch failures without advancing its marker. */
export class ScheduledIssueRunNowError extends Error {
  constructor(
    public readonly code: ScheduledIssueRunNowErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ScheduledIssueRunNowError'
  }
}

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
    /** Optional reverse-link metadata; scheduler leaves this absent. */
    inquiry?: undefined,
    /** One-run model/effort selection inherited from Issue frontmatter. */
    overrides?: HeadlessRunOverrides,
  ) => Promise<{ taskId: string; resumeId: string }>
  /** Persist @new -> exact @resumeId after the first fresh dispatch. */
  claimFreshSession?: (input: {
    issueWorkspace: WorkspaceMeta
    issueId: string
    taskId: string
    resumeId: string
    agent: string
  }) => Promise<void>
  /** Observe direct Issue file edits during the scanner's normal live read. */
  observeIssues?: (workspace: WorkspaceMeta, issues: readonly IssueRecord[]) => Promise<void>
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
  /** Close the tiny manual-retry vs schedule-tick race for one Issue. This is
   * only a dispatch-start lock, not a per-Workspace execution lock. */
  private readonly dispatchingIssues = new Set<string>()
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

  /** Dispatch one scheduled Issue immediately without touching its firing
   * marker. This is the authoritative manual-retry path: it re-reads the live
   * Issue and reuses the exact prompt, owner, runtime, and timeout used by the
   * scanner, while preserving the next scheduled occurrence. */
  async runIssueNow(wsId: string, issueId: string): Promise<{ taskId: string }> {
    const ws = this.deps.registry.get(wsId)
    if (!ws) throw new ScheduledIssueRunNowError('not_found', 'Workspace not found.')

    const res = await readWorkspaceIssues(ws.dir)
    if (!res.ok) throw new ScheduledIssueRunNowError('not_found', 'Issue not found.')
    const issue = res.issues.find((candidate) => candidate.id === issueId)
    if (!issue) throw new ScheduledIssueRunNowError('not_found', 'Issue not found.')
    if (!issue.when) {
      throw new ScheduledIssueRunNowError('not_scheduled', 'Only scheduled Issues can be retried.')
    }
    if (!isFireable(issue)) {
      throw new ScheduledIssueRunNowError(
        'not_fireable',
        `This Issue is ${issue.status}; reopen it before retrying.`,
      )
    }

    return this.dispatchIssue(
      ws,
      issue.id,
      issueFirePrompt(issue),
      issue.agent,
      issueRunOverrides(issue),
      issueAssigneeResumeId(issue.assignee) ?? undefined,
      issueAssigneeClaimsFirstSession(issue.assignee),
      true,
    )
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
    await this.deps.observeIssues?.(ws, res.issues)

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
          issueRunOverrides(issue),
          issueAssigneeResumeId(issue.assignee) ?? undefined,
          issueAssigneeClaimsFirstSession(issue.assignee),
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
    overrides: HeadlessRunOverrides | undefined,
    resumeId: string | undefined,
    claimFreshSession: boolean,
    nowMs: number,
  ): Promise<void> {
    try {
      const { taskId: runId } = await this.dispatchIssue(
        issueWorkspace,
        taskId,
        what,
        agentId,
        overrides,
        resumeId,
        claimFreshSession,
      )
      await this.deps.markers.set(issueWorkspace.id, taskId, nowMs)
      this.deps.logger.info('schedule.fired', {
        wsId: issueWorkspace.id,
        taskId,
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

  private async dispatchIssue(
    issueWorkspace: WorkspaceMeta,
    issueId: string,
    what: string,
    agentId?: string,
    overrides?: HeadlessRunOverrides,
    resumeId?: string,
    claimFreshSession = false,
    manual = false,
  ): Promise<{ taskId: string }> {
    const dispatchKey = `${issueWorkspace.id}:${issueId}`
    if (this.dispatchingIssues.has(dispatchKey)) {
      if (manual) {
        throw new ScheduledIssueRunNowError(
          'already_running',
          'This Issue is already being dispatched.',
        )
      }
      throw new Error(`Issue dispatch already in progress: ${dispatchKey}`)
    }
    this.dispatchingIssues.add(dispatchKey)
    try {
      const executionWorkspace = resumeId
        ? this.resolveResumeWorkspace(resumeId)
        : issueWorkspace
      if (!executionWorkspace) {
        throw new Error(`assigned Session Workspace is unavailable: ${resumeId}`)
      }
      const adapter = await this.deps.resolveAdapter(executionWorkspace, agentId, resumeId)
      if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
        throw new Error(`agent runtime does not support headless work: ${adapter.id}`)
      }
      const trigger: HeadlessTaskTrigger = {
        kind: 'issue',
        workspaceId: issueWorkspace.id,
        issueId,
      }
      const result = resumeId
        ? overrides
          ? await this.deps.dispatch(
              executionWorkspace,
              adapter,
              what,
              SCHEDULED_ISSUE_RUN_TIMEOUT_MS,
              trigger,
              resumeId,
              undefined,
              overrides,
            )
          : await this.deps.dispatch(
              executionWorkspace,
              adapter,
              what,
              SCHEDULED_ISSUE_RUN_TIMEOUT_MS,
              trigger,
              resumeId,
            )
        : overrides
          ? await this.deps.dispatch(
              executionWorkspace,
              adapter,
              what,
              SCHEDULED_ISSUE_RUN_TIMEOUT_MS,
              trigger,
              undefined,
              undefined,
              overrides,
            )
          : await this.deps.dispatch(
              executionWorkspace,
              adapter,
              what,
              SCHEDULED_ISSUE_RUN_TIMEOUT_MS,
              trigger,
            )
      if (claimFreshSession) {
        if (!this.deps.claimFreshSession) {
          throw new Error('Issue @new ownership cannot be persisted in this runtime')
        }
        try {
          await this.deps.claimFreshSession({
            issueWorkspace,
            issueId,
            taskId: result.taskId,
            resumeId: result.resumeId,
            agent: adapter.id,
          })
        } catch (err) {
          // The worker is already running. Treat a claim-write failure as a
          // separate control-plane fault so the due loop cannot immediately
          // recruit a second worker for the same occurrence.
          this.deps.logger.warn('schedule.first_session_claim_failed', {
            wsId: issueWorkspace.id,
            issueId,
            taskId: result.taskId,
            resumeId: result.resumeId,
            err,
          })
        }
      }
      this.deps.logger.info('schedule.issue_dispatched', {
        wsId: issueWorkspace.id,
        executionWsId: executionWorkspace.id,
        issueId,
        agent: adapter.id,
        runId: result.taskId,
        manual,
      })
      return { taskId: result.taskId }
    } finally {
      this.dispatchingIssues.delete(dispatchKey)
    }
  }

  private resolveResumeWorkspace(resumeId: string): WorkspaceMeta | undefined {
    return this.deps.resolveResumeWorkspace?.(resumeId)
  }
}

function issueRunOverrides(issue: IssueRecord): HeadlessRunOverrides | undefined {
  if (!issue.model && !issue.effort) return undefined
  return {
    ...(issue.model ? { model: issue.model } : {}),
    ...(issue.effort ? { reasoningEffort: issue.effort } : {}),
  }
}
