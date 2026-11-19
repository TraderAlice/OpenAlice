import type { ExecutionOrigin } from '../session-execution-manager.js'
import type { AgentConversationDispatch } from '../agent-conversation-log.js'
import type { IssueCommentRequest } from '../dispatch-communication.js'
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
 * Then `computeNextRun(when, base) <= now`. The last-fired marker is written
 * only AFTER a successful dispatch. Pure transient skips (capacity, busy,
 * takeover declined) retry on the next tick (with cron catch-up / calendar-only
 * cursor handling). Timed cooldowns and backoff errors defer dispatch in an
 * in-memory DispatchGate without mutating schedule markers; structural/permanent
 * blockers park automatic dispatch until the Issue changes, a Session block
 * lifts, or a manual run succeeds.
 */

import { computeNextRun, scheduleCatchesUp, type Schedule } from '../../core/schedule-expr.js'
import type { CliAdapter } from '../cli-adapter.js'
import type { SessionRuntimeSelection } from '../session-runtime-binding.js'
import { SessionAdmissionError } from '../session-admission.js'
import type { Logger } from '../logger.js'
import type { WorkspaceMeta, WorkspaceRegistry } from '../workspace-registry.js'
import type { HeadlessTaskInquiry, HeadlessTaskTrigger } from '../headless-task-registry.js'
import type { SessionCreatedBy } from '../session-metadata.js'

import {
  isFireable,
  isConnectorDeskIssue,
  issueAssigneeClaimsFirstSession,
  issueAssigneeResumeId,
  issueFirePrompt,
  issueTimeoutMs,
  readWorkspaceIssues,
  type IssueRecord,
} from '../issues/declaration.js'
import {
  extraConnectorDeskKeys,
  findConnectorDesks,
} from '../issues/connector-desk.js'

import {
  fireBase,
  snapshotScheduledIssue,
  type ScheduleSkipState,
  type ScheduleSnapshot,
  type ScheduleSnapshotTask,
  type ScheduleSnapshotWorkspace,
} from './declaration.js'

export const DEFAULT_INTERVAL_MS = 60_000

/** Capped exponential backoff ladder for `not_ready` and unrecognized errors. */
export const BACKOFF_STEPS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const

export type ScheduledIssueRunNowErrorCode =
  | 'not_found'
  | 'invalid'
  | 'not_scheduled'
  | 'not_retryable'
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

export type ScheduleDispatchErrorCode =
  | 'dispatch_in_progress'
  | 'issue_not_found'
  | 'no_agent_owner'
  | 'assignee_workspace_unavailable'
  | 'adapter_no_headless'
  | 'workspace_not_active'
  | 'invalid_runtime_settings'
  | 'claim_persistence_unsupported'
  | 'service_shutting_down'

/** Typed error for schedule dispatch pre-flight / structural conditions so
 *  `classifyScheduleSkip` classifies by stable code instead of message strings. */
export class ScheduleDispatchError extends Error {
  constructor(
    public readonly code: ScheduleDispatchErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ScheduleDispatchError'
  }
}

export type ScheduleSkipDisposition = 'retry_next_tick' | 'defer' | 'park'

export type ScheduleSkipDecision =
  | { disposition: 'retry_next_tick'; code: string; reason: string }
  | { disposition: 'defer'; code: string; reason: string; retryAtMs: number; sessionBlocked?: boolean }
  | { disposition: 'defer'; code: string; reason: string; backoff: true }
  | { disposition: 'park'; code: string; reason: string; sessionBlocked?: boolean }

const RETRY_NEXT_TICK_CODES: Readonly<Record<string, true>> = {
  headless_capacity: true,
  busy: true,
  takeover_declined: true,
  already_running: true,
  dispatch_in_progress: true,
}

const PARK_ERROR_CODES: Readonly<Record<string, true>> = {
  // HeadlessResumeError permanent states
  not_found: true,
  wrong_workspace: true,
  wrong_agent: true,
  retired: true,
  deleted: true,
  // ScheduledIssueRunNowError non-transient states
  invalid: true,
  not_scheduled: true,
  not_fireable: true,
  not_retryable: true,
  // ScheduleDispatchError structural blockers
  issue_not_found: true,
  no_agent_owner: true,
  assignee_workspace_unavailable: true,
  adapter_no_headless: true,
  workspace_not_active: true,
  invalid_runtime_settings: true,
  claim_persistence_unsupported: true,
  service_shutting_down: true,
}

/** Classify a schedule dispatch failure structurally (`instanceof` / `code`).
 *  Unrecognized errors safely fall back to capped exponential backoff (`defer`). */
export function classifyScheduleSkip(err: unknown, nowMs: number): ScheduleSkipDecision {
  const reason = err instanceof Error ? err.message : String(err)
  const rawCode = typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: unknown }).code
    : undefined
  const code = typeof rawCode === 'string' && rawCode.length > 0 ? rawCode : undefined

  if (err instanceof SessionAdmissionError || code === 'session_blocked') {
    const retryAt = err instanceof SessionAdmissionError
      ? err.retryAt
      : (typeof err === 'object' && err !== null && 'retryAt' in err
          ? (err as { retryAt?: unknown }).retryAt
          : undefined)
    if (typeof retryAt === 'number' && Number.isFinite(retryAt)) {
      return {
        disposition: 'defer',
        code: 'session_blocked',
        reason,
        retryAtMs: Math.max(nowMs, retryAt),
        sessionBlocked: true,
      }
    }
    return {
      disposition: 'park',
      code: 'session_blocked',
      reason,
      sessionBlocked: true,
    }
  }

  if (code && RETRY_NEXT_TICK_CODES[code]) {
    return { disposition: 'retry_next_tick', code, reason }
  }
  if (err instanceof Error && err.name === 'HeadlessCapacityError') {
    return { disposition: 'retry_next_tick', code: 'headless_capacity', reason }
  }
  if (code === 'not_ready') {
    return { disposition: 'defer', code: 'not_ready', reason, backoff: true }
  }
  if (code && PARK_ERROR_CODES[code]) {
    return { disposition: 'park', code, reason }
  }

  return {
    disposition: 'defer',
    code: code ?? 'unknown_error',
    reason,
    backoff: true,
  }
}

type DispatchGate =
  | {
      kind: 'deferred'
      code: string
      reason: string
      retryAtMs: number
      sinceMs: number
      streak: number
      fingerprint: string
      resumeId?: string
      sessionBlocked?: boolean
    }
  | {
      kind: 'parked'
      code: string
      reason: string
      sinceMs: number
      fingerprint: string
      resumeId?: string
      sessionBlocked?: boolean
    }

function toScheduleSkipState(gate: DispatchGate | undefined): ScheduleSkipState | undefined {
  if (!gate) return undefined
  if (gate.kind === 'deferred') {
    return {
      kind: 'deferred',
      code: gate.code,
      reason: gate.reason,
      retryAtMs: gate.retryAtMs,
      sinceMs: gate.sinceMs,
    }
  }
  return {
    kind: 'parked',
    code: gate.code,
    reason: gate.reason,
    sinceMs: gate.sinceMs,
  }
}

function issueDependencyFingerprint(
  issue: IssueRecord,
  when: Schedule,
  resumeId: string | undefined,
): string {
  const whenKey = when.kind === 'at'
    ? { kind: 'at', at: when.at }
    : when.kind === 'every'
      ? { kind: 'every', every: when.every }
      : { kind: 'cron', cron: when.cron, timezone: when.timezone ?? null, catchUp: when.catchUp ?? null }
  return JSON.stringify({
    assignee: issue.assignee,
    agent: issue.agent ?? null,
    when: whenKey,
    credential: issue.credential ?? null,
    credentialSource: issue.credentialSource ?? null,
    model: issue.model ?? null,
    effort: issue.effort ?? null,
    resumeId: resumeId ?? null,
  })
}

/** The slice of ScheduleMarkerStore the scanner needs (structural, for testing). */
export interface MarkerStore {
  key(wsId: string, taskId: string): string
  get(wsId: string, taskId: string): number | undefined
  getHeld(wsId: string, taskId: string): number | undefined
  set(wsId: string, taskId: string, ts: number): Promise<void>
  hold(wsId: string, taskId: string, ts: number): Promise<void>
  prune(seenKeys: Set<string>): Promise<void>
}

export interface ScheduleScannerDeps {
  registry: WorkspaceRegistry
  /** Resolve the execution Workspace for an exact signed Session owner. */
  resolveResumeWorkspace?: (resumeId: string) => WorkspaceMeta | undefined
  canRetryIssueRun?: (wsId: string, issueId: string, runId: string) => boolean
  isIssueRunning?: (wsId: string, issueId: string) => boolean
  /** Lightweight in-memory check for whether a Session still has an active admission block. */
  isSessionBlocked?: (resumeId: string, nowMs: number) => boolean
  resolveAdapter: (meta: WorkspaceMeta, agentId?: string, resumeId?: string) => CliAdapter | Promise<CliAdapter>
  dispatch: (
    meta: WorkspaceMeta,
    adapter: CliAdapter,
    prompt: string,
    origin: ExecutionOrigin,
    timeoutMs?: number,
    /** Composite source of the dispatch. Execution may happen elsewhere. */
    trigger?: HeadlessTaskTrigger,
    /** Product Session to continue. Omitted means allocate a fresh Session. */
    resumeId?: string,
    /** Optional reverse-link metadata; scheduler leaves this absent. */
    inquiry?: HeadlessTaskInquiry,
    /** Fresh-Session credential/model/effort selection inherited from Issue frontmatter. */
    selection?: SessionRuntimeSelection,
    conversation?: AgentConversationDispatch,
    /** Birth stamp when this fire allocates a new product Session. */
    createdBy?: SessionCreatedBy,
  ) => Promise<{ taskId: string; resumeId: string }>
  /** Persist @new-then-resume -> exact @resumeId after the first fresh dispatch. */
  claimFreshSession?: (input: {
    issueWorkspace: WorkspaceMeta
    issueId: string
    taskId: string
    resumeId: string
    agent: string
  }) => Promise<void>
  /** Observe direct Issue file edits during the scanner's normal live read. */
  observeIssues?: (workspace: WorkspaceMeta, issues: readonly IssueRecord[]) => Promise<void>
  /** Reconcile Workspace-owned Session config files on the infrastructure tick. */
  reconcileSessionRuntimeBindings?: () => Promise<void>
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
  private readonly pendingFires = new Map<string, Promise<void>>()
  /** In-memory dispatch gate per Issue (keyed by `markers.key(wsId, taskId)`). */
  private readonly dispatchGates = new Map<string, DispatchGate>()
  /** Last `schedule.fire_skipped` key `(disposition, code, reason)` per Issue. */
  private readonly lastSkippedLogs = new Map<string, string>()

  async waitForDispatches(): Promise<void> { await Promise.allSettled(this.pendingFires.values()) }
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
   * marker. This is the authoritative manual-run / retry path: it re-reads the
   * live Issue and reuses the exact prompt, owner, runtime, and optional timeout used by
   * the scanner, while preserving the next scheduled occurrence. */
  async runIssueNow(wsId: string, issueId: string, retryOfTaskId?: string): Promise<{ taskId: string }> {
    const ws = this.deps.registry.get(wsId)
    if (!ws) throw new ScheduledIssueRunNowError('not_found', 'Workspace not found.')

    const res = await readWorkspaceIssues(ws.dir)
    if (!res.ok) {
      if (res.reason === 'invalid') {
        throw new ScheduledIssueRunNowError('invalid', `Issue declaration is invalid: ${res.error}`)
      }
      throw new ScheduledIssueRunNowError('not_found', 'Issue not found.')
    }
    const issue = res.issues.find((candidate) => candidate.id === issueId)
    if (!issue) {
      const invalid = res.invalid.find((candidate) => candidate.id === issueId)
      if (invalid) {
        throw new ScheduledIssueRunNowError('invalid', `Issue "${issueId}" is invalid: ${invalid.error}`)
      }
      throw new ScheduledIssueRunNowError('not_found', 'Issue not found.')
    }
    if (!issue.when) {
      throw new ScheduledIssueRunNowError('not_scheduled', 'Only scheduled Issues can be run now.')
    }
    if (!isFireable(issue)) {
      throw new ScheduledIssueRunNowError(
        'not_fireable',
        `This Issue is ${issue.status}; reopen it before running.`,
      )
    }
    if (isConnectorDeskIssue(issue)) {
      const extras = extraConnectorDeskKeys(
        await findConnectorDesks(
          this.deps.registry.list().map((item) => ({ id: item.id, dir: item.dir })),
        ),
      )
      if (extras.has(`${ws.id}:${issue.id}`)) {
        throw new ScheduledIssueRunNowError(
          'not_fireable',
          `Only one ${issue.connectorDesk} phone-desk Issue may fire in this Alice Project.`,
        )
      }
    }

    const result = await this.dispatchIssue(
      ws,
      issue.id,
      issueFirePrompt(issue),
      issue.agent,
      issueRunOverrides(issue),
      issueAssigneeResumeId(issue.assignee) ?? undefined,
      issueAssigneeClaimsFirstSession(issue.assignee),
      issueTimeoutMs(issue.timeout),
      issue.connectorDesk,
      true,
      undefined,
      retryOfTaskId,
    )
    this.clearDispatchGate(this.deps.markers.key(ws.id, issue.id), ws.id, issue.id)
    return { taskId: result.taskId }
  }

  /** Comments share the scheduler's dispatch/claim exclusion, without advancing its clock. */
  async runIssueComment(input: IssueCommentRequest): Promise<{ taskId: string; resumeId: string }> {
    const ws = this.deps.registry.get(input.workspaceId)
    if (!ws) throw new Error('Workspace not found.')
    return this.dispatchIssue(ws, input.issueId, input.prompt, undefined, undefined, undefined,
      false, undefined, undefined, true, input.commentId, undefined, input.source)
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
      await this.scan(false)
    } catch (err) {
      this.deps.logger.warn('schedule.scan_failed', { err })
    }
    if (!this.stopped) this.arm()
  }

  /** One full pass over all workspaces. Public for tests / a future "scan now". */
  async scan(waitForDispatch = true): Promise<void> {
    if (this.scanning) {
      this.deps.logger.info('schedule.scan_overlap_skipped', {})
      return
    }
    this.scanning = true
    const nowMs = this.now()
    const seen = new Set<string>()
    try {
      await this.deps.reconcileSessionRuntimeBindings?.()
      // registry.list() order is preserved by Promise.all → stable display order.
      const extraDesks = extraConnectorDeskKeys(
        await findConnectorDesks(
          this.deps.registry.list().map((ws) => ({ id: ws.id, dir: ws.dir })),
        ),
      )
      const workspaces = await Promise.all(
        this.deps.registry.list().map((ws) => this.scanWorkspace(ws, nowMs, seen, extraDesks, waitForDispatch)),
      )
      await this.deps.markers.prune(seen)
      for (const key of [...this.dispatchGates.keys()]) {
        if (!seen.has(key)) this.dispatchGates.delete(key)
      }
      for (const key of [...this.lastSkippedLogs.keys()]) {
        if (!seen.has(key)) this.lastSkippedLogs.delete(key)
      }
      // Reconcile each task's skipState against live dispatchGates right before
      // publishing lastSnapshot so async fire() calls launched by scan(false)
      // that settled while awaiting other workspaces or prune() are never lost.
      for (const ws of workspaces) {
        for (const task of ws.tasks) {
          const skipState = toScheduleSkipState(this.dispatchGates.get(this.deps.markers.key(ws.wsId, task.id)))
          if (skipState) {
            task.skipState = skipState
          } else {
            delete task.skipState
          }
        }
      }
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
    extraDesks: ReadonlySet<string>,
    waitForDispatch: boolean,
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
      if (isConnectorDeskIssue(issue) && extraDesks.has(`${ws.id}:${issue.id}`)) continue
      const markerKey = this.deps.markers.key(ws.id, issue.id)
      seen.add(markerKey)
      const fireKey = `${ws.id}:${issue.id}`
      const resumeId = issueAssigneeResumeId(issue.assignee) ?? undefined
      const fingerprint = issueDependencyFingerprint(issue, when, resumeId)
      let gate = this.dispatchGates.get(markerKey)

      if (!isFireable(issue)) {
        if (gate || this.lastSkippedLogs.has(markerKey)) {
          this.clearDispatchGate(markerKey)
          gate = undefined
        }
      } else if (gate) {
        const recoveredByEdit = gate.fingerprint !== fingerprint
        const recoveredBySessionRelease = Boolean(
          gate.sessionBlocked
          && gate.resumeId
          && this.deps.isSessionBlocked
          && !this.deps.isSessionBlocked(gate.resumeId, nowMs),
        )
        if (recoveredByEdit || recoveredBySessionRelease) {
          this.clearDispatchGate(markerKey)
          gate = undefined
        }
      }

      const gated = gate !== undefined && (gate.kind === 'parked' || nowMs < gate.retryAtMs)
      const due = !gated && isFireable(issue) && this.isDue(ws.id, issue.id, when, nowMs)
      if (!gated && gate?.kind === 'deferred' && !due) {
        this.clearDispatchGate(markerKey)
      }
      if (!this.pendingFires.has(fireKey) && due) {
        const firing = this.fire(
          ws,
          issue.id,
          when,
          issueFirePrompt(issue),
          issue.agent,
          issueRunOverrides(issue),
          resumeId,
          issueAssigneeClaimsFirstSession(issue.assignee),
          issueTimeoutMs(issue.timeout),
          issue.connectorDesk,
          fingerprint,
          nowMs,
        ).catch(err => this.deps.logger.warn('schedule.fire_failed', { wsId: ws.id, issueId: issue.id, err }))
          .finally(() => { this.pendingFires.delete(fireKey) })
        this.pendingFires.set(fireKey, firing)
        if (waitForDispatch) await firing
      }
      // Read the marker and gate AFTER any fire so last/next/skipState reflect a just-fired or just-gated run.
      const last = this.deps.markers.get(ws.id, issue.id) ?? null
      const held = this.deps.markers.getHeld(ws.id, issue.id) ?? null
      const skipState = toScheduleSkipState(this.dispatchGates.get(markerKey))
      tasks.push(snapshotScheduledIssue(issue, when, last, nowMs, this.intervalMs, held, skipState))
    }
    return { wsId: ws.id, tag: ws.tag, status: 'ok', tasks }
  }

  private isDue(wsId: string, taskId: string, when: Schedule, nowMs: number): boolean {
    const last = this.deps.markers.get(wsId, taskId) ?? null
    const held = this.deps.markers.getHeld(wsId, taskId) ?? null
    const next = computeNextRun(when, fireBase(when, last, nowMs, this.intervalMs, held))
    return next !== null && next <= nowMs
  }

  private clearDispatchGate(markerKey: string, wsId?: string, taskId?: string): void {
    this.dispatchGates.delete(markerKey)
    this.lastSkippedLogs.delete(markerKey)
    if (wsId && taskId) this.syncSnapshotSkipState(wsId, taskId, undefined)
  }

  private syncSnapshotSkipState(
    wsId: string,
    taskId: string,
    skipState: ScheduleSkipState | undefined,
  ): void {
    if (!this.lastSnapshot) return
    const ws = this.lastSnapshot.workspaces.find((entry) => entry.wsId === wsId)
    const task = ws?.tasks.find((entry) => entry.id === taskId)
    if (!task) return
    if (skipState) {
      task.skipState = skipState
    } else {
      delete task.skipState
    }
  }

  private async fire(
    issueWorkspace: WorkspaceMeta,
    taskId: string,
    when: Schedule,
    what: string,
    agentId: string | undefined,
    selection: SessionRuntimeSelection | undefined,
    resumeId: string | undefined,
    claimFreshSession: boolean,
    timeoutMs: number | undefined,
    connectorDesk: string | undefined,
    fingerprint: string,
    nowMs: number,
  ): Promise<void> {
    const markerKey = this.deps.markers.key(issueWorkspace.id, taskId)
    try {
      const { taskId: runId } = await this.dispatchIssue(
        issueWorkspace,
        taskId,
        what,
        agentId,
        selection,
        resumeId,
        claimFreshSession,
        timeoutMs,
        connectorDesk,
      )
      await this.deps.markers.set(issueWorkspace.id, taskId, nowMs)
      this.clearDispatchGate(markerKey, issueWorkspace.id, taskId)
      this.deps.logger.info('schedule.fired', {
        wsId: issueWorkspace.id,
        taskId,
        runId,
        owner: resumeId ? 'session' : 'workspace',
        ...(resumeId ? { resumeId } : {}),
      })
    } catch (err) {
      const decision = classifyScheduleSkip(err, nowMs)
      const prevGate = this.dispatchGates.get(markerKey)
      let retryAtMs: number | undefined

      if (decision.disposition === 'retry_next_tick') {
        // Capacity / busy: every/at stays due with no marker or gate. Cron catch-up
        // holds the occurrence; calendar-only cron consumes it.
        if (prevGate) {
          this.dispatchGates.delete(markerKey)
          this.syncSnapshotSkipState(issueWorkspace.id, taskId, undefined)
        }
        await this.noteCronMiss(issueWorkspace.id, taskId, when, nowMs)
      } else if (decision.disposition === 'defer') {
        const sameCode = prevGate?.kind === 'deferred' && prevGate.code === decision.code
        let streak = 0
        if ('backoff' in decision) {
          streak = sameCode ? prevGate.streak + 1 : 1
          const delayMs = BACKOFF_STEPS_MS[Math.min(streak - 1, BACKOFF_STEPS_MS.length - 1)]
          retryAtMs = nowMs + delayMs
        } else {
          retryAtMs = decision.retryAtMs
        }
        const blockedResumeId = resumeId ?? (err instanceof SessionAdmissionError ? err.blocks[0]?.resumeId : undefined)
        const gate: DispatchGate = {
          kind: 'deferred',
          code: decision.code,
          reason: decision.reason,
          retryAtMs,
          sinceMs: sameCode ? prevGate.sinceMs : nowMs,
          streak,
          fingerprint,
          ...(blockedResumeId ? { resumeId: blockedResumeId } : {}),
          ...('sessionBlocked' in decision && decision.sessionBlocked ? { sessionBlocked: true } : {}),
        }
        this.dispatchGates.set(markerKey, gate)
        this.syncSnapshotSkipState(issueWorkspace.id, taskId, toScheduleSkipState(gate))
      } else {
        const sameCode = prevGate?.kind === 'parked' && prevGate.code === decision.code
        const blockedResumeId = resumeId ?? (err instanceof SessionAdmissionError ? err.blocks[0]?.resumeId : undefined)
        const gate: DispatchGate = {
          kind: 'parked',
          code: decision.code,
          reason: decision.reason,
          sinceMs: sameCode ? prevGate.sinceMs : nowMs,
          fingerprint,
          ...(blockedResumeId ? { resumeId: blockedResumeId } : {}),
          ...(decision.sessionBlocked ? { sessionBlocked: true } : {}),
        }
        this.dispatchGates.set(markerKey, gate)
        this.syncSnapshotSkipState(issueWorkspace.id, taskId, toScheduleSkipState(gate))
      }

      const logKey = JSON.stringify([decision.disposition, decision.code, decision.reason])
      if (this.lastSkippedLogs.get(markerKey) !== logKey) {
        this.lastSkippedLogs.set(markerKey, logKey)
        this.deps.logger.info('schedule.fire_skipped', {
          wsId: issueWorkspace.id,
          taskId,
          disposition: decision.disposition,
          code: decision.code,
          reason: decision.reason,
          ...(retryAtMs !== undefined ? { retryAtMs } : {}),
        })
      }
    }
  }

  private async noteCronMiss(
    wsId: string,
    taskId: string,
    when: Schedule,
    nowMs: number,
  ): Promise<void> {
    if (when.kind !== 'cron') return
    const last = this.deps.markers.get(wsId, taskId) ?? null
    const held = this.deps.markers.getHeld(wsId, taskId) ?? null
    const dueAt = computeNextRun(when, fireBase(when, last, nowMs, this.intervalMs, held))
    if (dueAt === null || dueAt > nowMs) return
    if (!scheduleCatchesUp(when)) {
      // Calendar-only means "the next future calendar occurrence", not "walk
      // every stale slot one scanner tick at a time". Advancing only to dueAt
      // would replay an entire backlog after sleep/downtime whenever admission
      // remained blocked. Use the current scan time as the consumed cursor.
      await this.deps.markers.hold(wsId, taskId, nowMs)
      return
    }
    if (last === null) await this.deps.markers.hold(wsId, taskId, dueAt - 1)
  }

  private async dispatchIssue(
    issueWorkspace: WorkspaceMeta,
    issueId: string,
    what: string,
    agentId?: string,
    selection?: SessionRuntimeSelection,
    resumeId?: string,
    claimFreshSession = false,
    timeoutMs?: number,
    connectorDesk?: string,
    manual = false,
    commentId?: string,
    retryOfTaskId?: string,
    commentSource?: IssueCommentRequest['source'],
  ): Promise<{ taskId: string; resumeId: string }> {
    const dispatchKey = `${issueWorkspace.id}:${issueId}`
    if (this.dispatchingIssues.has(dispatchKey)) {
      if (manual) {
        throw new ScheduledIssueRunNowError(
          'already_running',
          'This Issue is already being dispatched.',
        )
      }
      throw new ScheduleDispatchError('dispatch_in_progress', `Issue dispatch already in progress: ${dispatchKey}`)
    }
    this.dispatchingIssues.add(dispatchKey)
    try {
      if (this.deps.isIssueRunning?.(issueWorkspace.id, issueId)) {
        throw new ScheduledIssueRunNowError('already_running', 'This Issue already has a run in progress.')
      }
      if (retryOfTaskId && this.deps.canRetryIssueRun && !this.deps.canRetryIssueRun(issueWorkspace.id, issueId, retryOfTaskId)) {
        throw new ScheduledIssueRunNowError('not_retryable', 'The failed run is no longer this Issue’s latest occurrence.')
      }
      // A scan or comment may have read the file before another dispatch claimed it.
      // Resolve ownership again while holding the shared dispatch exclusion.
      if (claimFreshSession || commentId) {
        const read = await readWorkspaceIssues(issueWorkspace.dir)
        const live = read.ok ? read.issues.find((issue) => issue.id === issueId) : undefined
        if (!live) throw new ScheduleDispatchError('issue_not_found', 'Issue not found.')
        resumeId = issueAssigneeResumeId(live.assignee) ?? undefined
        claimFreshSession = issueAssigneeClaimsFirstSession(live.assignee)
        if (!resumeId && !claimFreshSession && live.assignee !== '@new-each-run') {
          throw new ScheduleDispatchError('no_agent_owner', 'Issue ownership changed; no Agent owner is selected.')
        }
        agentId = live.agent
        selection = issueRunOverrides(live)
        timeoutMs = issueTimeoutMs(live.timeout)
        if (commentId && !resumeId) {
          what = `Issue ${issueId}: ${live.title}\n${live.what}\n\nHistory: .alice/issues/${issueId}.comments.json\n\n${what}`
        }
      }
      const executionWorkspace = resumeId
        ? this.resolveResumeWorkspace(resumeId)
        : issueWorkspace
      if (!executionWorkspace) {
        throw new ScheduleDispatchError('assignee_workspace_unavailable', `assigned Session Workspace is unavailable: ${resumeId}`)
      }
      const adapter = await this.deps.resolveAdapter(executionWorkspace, agentId, resumeId)
      if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
        throw new ScheduleDispatchError('adapter_no_headless', `agent runtime does not support headless work: ${adapter.id}`)
      }
      const trigger: HeadlessTaskTrigger | undefined = commentId ? undefined : {
        kind: 'issue',
        ...(retryOfTaskId ? { retryOfTaskId } : {}),
        workspaceId: issueWorkspace.id,
        issueId,
        ...(connectorDesk
          ? {
              metadata: {
                kind: 'connector-cron-issue' as const,
                connectorId: connectorDesk,
              },
            }
          : {}),
      }
      // Fresh recruits only: exact @resumeId continues an existing Session.
      const createdBy: SessionCreatedBy | undefined = resumeId
        ? undefined
        : {
            kind: 'issue',
            workspaceId: issueWorkspace.id,
            issueId,
            policy: claimFreshSession ? 'new-then-resume' : 'new-each-run',
            fire: commentId ? 'comment' : manual ? (retryOfTaskId ? 'retry' : 'manual') : 'schedule',
          }
      const inquiry: HeadlessTaskInquiry | undefined = commentId ? {
        subject: { kind: 'issue', workspaceId: issueWorkspace.id, issueId, relation: 'owner', commentId },
        question: what,
        resolution: { mode: resumeId ? 'exact' : 'reconstructed' },
      } : undefined
      const conversation: AgentConversationDispatch | undefined = inquiry ? {
        source: commentSource ?? { kind: 'human' },
        requestedTarget: resumeId ? { kind: 'resume', resumeId } : { kind: 'workspace', workspaceId: executionWorkspace.id },
        originalPrompt: what, deliveredPrompt: what, promptMode: 'plain', subject: inquiry.subject,
        resolution: resumeId
          ? { mode: 'exact', origin: { kind: 'session', workspaceId: executionWorkspace.id, resumeId, agent: adapter.id } }
          : { mode: 'reconstructed', workspaceId: executionWorkspace.id, reason: 'explicit-workspace' },
      } : undefined
      const origin: ExecutionOrigin = {
        kind: manual ? 'issue' : 'schedule',
        entry: commentId ? 'issue-comment' : manual ? (retryOfTaskId ? 'issue-retry' : 'issue-manual') : 'issue-schedule',
        workspaceId: issueWorkspace.id, issueId,
        ...(trigger?.metadata ? { connectorId: trigger.metadata.connectorId } : {}),
        ...(commentSource?.kind === 'session' ? { resumeId: commentSource.resumeId } : {}),
      }
      const result = inquiry
        ? await this.deps.dispatch(executionWorkspace, adapter, what, origin, timeoutMs, undefined,
            resumeId, inquiry, selection, conversation, createdBy)
        : resumeId
        ? selection
          ? await this.deps.dispatch(
              executionWorkspace,
              adapter,
              what,
              origin,
              timeoutMs,
              trigger,
              resumeId,
              undefined,
              selection,
            )
          : await this.deps.dispatch(
              executionWorkspace,
              adapter,
              what,
              origin,
              timeoutMs,
              trigger,
              resumeId,
            )
        : selection
          ? await this.deps.dispatch(
              executionWorkspace,
              adapter,
              what,
              origin,
              timeoutMs,
              trigger,
              undefined,
              undefined,
              selection,
              undefined,
              createdBy,
            )
          : await this.deps.dispatch(
              executionWorkspace,
              adapter,
              what,
              origin,
              timeoutMs,
              trigger,
              undefined,
              undefined,
              undefined,
              undefined,
              createdBy,
            )
      if (claimFreshSession) {
        if (!this.deps.claimFreshSession) {
          throw new ScheduleDispatchError('claim_persistence_unsupported', 'Issue @new-then-resume ownership cannot be persisted in this runtime')
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
      return result
    } finally {
      this.dispatchingIssues.delete(dispatchKey)
    }
  }

  private resolveResumeWorkspace(resumeId: string): WorkspaceMeta | undefined {
    return this.deps.resolveResumeWorkspace?.(resumeId)
  }
}

function issueRunOverrides(issue: IssueRecord): SessionRuntimeSelection | undefined {
  if (!issue.credential && !issue.credentialSource && !issue.model && !issue.effort) return undefined
  return {
    ...(issue.credentialSource === 'native' ? { credentialSource: 'native' as const } : {}),
    ...(issue.credential ? { credentialSlug: issue.credential } : {}),
    ...(issue.model ? { model: issue.model } : {}),
    ...(issue.effort ? { reasoningEffort: issue.effort } : {}),
  }
}
