/**
 * Read-only active-Workspace + global Commander Agent Dispatch observability projection.
 *
 * Joins HeadlessTaskRegistry, OrchestrationManager, AgentConversationLog,
 * SessionMailbox (scheduled-issue reports to Commander), ProductActivityJournal
 * (interactive turns), ScheduleScanner, InboxStore, and ArtifactProvenanceStore
 * inside a bounded `[fromMs, toMs]` time window.
 *
 * Hard boundary: ONLY currently active business Workspaces (`listActiveWorkspaces`)
 * plus the global control-plane Commander (`commander`, when initialized or active
 * in the window) appear in lanes, spans, edges, schedules, and artifacts. Standby
 * business Workspaces are excluded as inactive. Native runtime session ids never
 * cross this boundary.
 */
import { inboxFiles } from '@traderalice/connector-protocol'

import { workspaceTemplateSlot } from './active-workspace-slots.js'
import type {
  AgentRuntimeCause,
  AgentRuntimeEvent,
  AgentRuntimeStopStatus,
  AgentRuntimeSubject,
  AgentRuntimeSurface,
} from './agent-runtime-log.js'
import type {
  OrchestrationDeliverable,
  OrchestrationMessageKind,
  OrchestrationMessageMetadata,
  OrchestrationMessageStatus,
  OrchestrationTask,
  OrchestrationTaskOutcome,
  OrchestrationTaskStatus,
} from './orchestration/types.js'
import type { ScheduleSkipState } from './schedule/declaration.js'
import { sessionPreferredTitle } from './session-registry.js'
import { readWorkspaceMetadata } from './workspace-metadata.js'
import type { WorkspaceService } from './service.js'
import type { WorkspaceMeta } from './workspace-registry.js'

const DEFAULT_WINDOW_MS = 60 * 60_000
const MIN_WINDOW_MS = 60_000
const MAX_WINDOW_MS = 7 * 24 * 60 * 60_000
const MAX_SPANS = 300
const MAX_INBOX_PAGES = 3
const JOURNAL_FAST_LIMIT = 500

export const COMMANDER_LANE_ID = 'commander'
const COMMANDER_LANE_TAG = 'Commander'
const COMMANDER_LANE_LABEL = 'Commander'

export type DispatchTemplateKind = 'commander' | 'chat' | 'auto-quant' | 'prediction' | 'custom'

interface DispatchMailboxReportSource {
  readonly kind: 'scheduled-issue'
  readonly workspaceId: string
  readonly workspaceTag?: string
  readonly issueId: string
  readonly issueTitle?: string
  readonly fire?: 'schedule' | 'manual' | 'retry'
}

interface DispatchMailboxMessageLike {
  readonly id: string
  readonly recipientResumeId: string
  readonly recipientWorkspaceId: string
  readonly taskId: string
  readonly childResumeId: string
  readonly childWorkspaceId: string
  readonly childAgent: string
  readonly taskStatus: 'done' | 'failed' | 'interrupted'
  readonly assistantPreview: string | null
  readonly error?: string
  readonly durationMs?: number
  readonly createdAt: number
  readonly status: 'unread' | 'notified' | 'acked'
  readonly notifiedAt?: number
  readonly ackedAt?: number
  readonly reportSource?: DispatchMailboxReportSource
}

interface DispatchSessionMailboxLike {
  listRecent?(opts?: { sinceMs?: number; recipientResumeId?: string }): readonly DispatchMailboxMessageLike[]
  pendingFor?(recipientResumeId: string): readonly DispatchMailboxMessageLike[]
}

interface DispatchCommanderPointerLike {
  readonly version?: number
  readonly resumeId: string
  readonly createdAt?: number
  readonly updatedAt?: number
}

interface DispatchCommanderHost {
  readonly commanderWorkspace?: WorkspaceMeta
  readonly commanderMailbox?: DispatchSessionMailboxLike
  readonly sessionMailbox?: DispatchSessionMailboxLike
  readonly getCommanderPointer?: () => Promise<DispatchCommanderPointerLike | null>
}

export interface DispatchLane {
  readonly workspaceId: string
  readonly tag: string
  readonly label: string
  readonly template?: string
  readonly templateKind: DispatchTemplateKind
}

export type DispatchSpanTrigger =
  | {
      readonly kind: 'scheduled-issue'
      readonly workspaceId: string
      readonly issueId: string
      readonly issueTitle?: string
      readonly connectorId?: string
    }
  | {
      readonly kind: 'inquiry'
      readonly subjectKind: 'issue' | 'inbox'
      readonly workspaceId?: string
      readonly issueId?: string
      readonly inboxEntryId?: string
      readonly question: string
    }
  | {
      readonly kind: 'orchestration'
      readonly dispatchId: string
      readonly parentWorkspaceId: string
      readonly parentResumeId: string
    }
  | {
      readonly kind: 'conversation'
      readonly callerKind: 'session' | 'workspace' | 'human'
      readonly callerWorkspaceId?: string
      readonly callerResumeId?: string
    }
  | { readonly kind: 'interactive'; readonly surface: AgentRuntimeSurface }
  | { readonly kind: 'manual' }

export type DispatchSpanDelivery =
  | {
      readonly kind: 'connector'
      readonly connectorId: string
      readonly source: 'conversation' | 'automation'
      readonly state: 'pending' | 'accepted' | 'uncertain' | 'closed'
      readonly error?: string
    }
  | {
      readonly kind: 'issue-comment' | 'issue-run'
      readonly workspaceId: string
      readonly issueId: string
    }

export interface DispatchSpan {
  readonly id: string
  readonly kind: 'headless' | 'interactive'
  readonly workspaceId: string
  readonly resumeId: string
  readonly sessionLabel?: string
  readonly agent: string
  readonly model?: string
  readonly status: 'running' | 'done' | 'failed' | 'interrupted'
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly durationMs: number
  readonly trigger: DispatchSpanTrigger
  readonly prompt?: string
  readonly originalPrompt?: string
  readonly assistantPreview?: string
  readonly toolCalls: number
  readonly toolFailures: number
  readonly error?: string
  readonly delivery?: DispatchSpanDelivery
}

export type DispatchEdgeKind =
  | 'dispatch'
  | OrchestrationMessageKind
  | 'conversation'

export interface DispatchEdge {
  readonly id: string
  readonly kind: DispatchEdgeKind
  readonly messageKind?: 'scheduled_report'
  readonly fromWorkspaceId: string
  readonly fromResumeId?: string
  readonly toWorkspaceId: string
  readonly toResumeId: string
  readonly at: number
  readonly taskId?: string
  readonly dispatchId?: string
  readonly taskStatus?: OrchestrationTaskStatus
  readonly turnCount?: number
  readonly deliveryStatus?: OrchestrationMessageStatus
  readonly leasedAt?: number
  readonly ackedAt?: number
  readonly subject?: string
  readonly body?: string
  readonly spec?: string
  readonly outcome?: OrchestrationTaskOutcome
  readonly summary?: string
  readonly evidence?: string
  readonly deliverables?: readonly OrchestrationDeliverable[]
  readonly stopReason?: string
  readonly metadata?: OrchestrationMessageMetadata
  readonly originalPrompt?: string
  readonly deliveredPrompt?: string
  readonly promptMode?: 'plain' | 'reconstruction'
  readonly resolution?: {
    readonly mode: 'exact' | 'reconstructed'
    readonly reason?: string
  }
  readonly assistantText?: string | null
  readonly durationMs?: number
}

export type DispatchArtifact =
  | {
      readonly id: string
      readonly kind: 'inbox'
      readonly entryId: string
      readonly workspaceId: string
      readonly at: number
      readonly title: string
      readonly body: string
      readonly files: readonly string[]
      readonly unread: boolean
      readonly runId?: string
      readonly resumeId?: string
      readonly issueId?: string
    }
  | {
      readonly id: string
      readonly kind: 'report'
      readonly workspaceId: string
      readonly at: number
      readonly path: string
      readonly action: string
      readonly summary?: string
      readonly runId?: string
      readonly resumeId?: string
    }

export interface DispatchScheduleMarker {
  readonly workspaceId: string
  readonly issueId: string
  readonly title: string
  readonly nextDueAtMs: number | null
  readonly lastFiredAtMs: number | null
  readonly skipState?: ScheduleSkipState
}

export interface DispatchBoardSummary {
  readonly activeWorkspaceCount: number
  readonly runningSpanCount: number
  readonly totalSpanCount: number
  readonly edgeCount: number
  readonly artifactCount: number
  readonly errorSpanCount: number
}

export interface DispatchBoardSnapshot {
  readonly fromMs: number
  readonly toMs: number
  readonly generatedAt: number
  readonly lanes: readonly DispatchLane[]
  readonly spans: readonly DispatchSpan[]
  readonly edges: readonly DispatchEdge[]
  readonly artifacts: readonly DispatchArtifact[]
  readonly scheduleMarkers: readonly DispatchScheduleMarker[]
  readonly summary: DispatchBoardSummary
}

function normalizeWindow(input: {
  fromMs?: number
  toMs?: number
  nowMs?: number
}): { fromMs: number; toMs: number; nowMs: number } {
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now()
  const rawTo = Number.isFinite(input.toMs) ? Number(input.toMs) : nowMs
  const toMs = Math.max(MIN_WINDOW_MS, rawTo)
  let fromMs = Number.isFinite(input.fromMs) ? Number(input.fromMs) : toMs - DEFAULT_WINDOW_MS
  if (fromMs >= toMs) {
    fromMs = toMs - DEFAULT_WINDOW_MS
  }
  if (toMs - fromMs > MAX_WINDOW_MS) {
    fromMs = toMs - MAX_WINDOW_MS
  }
  if (toMs - fromMs < MIN_WINDOW_MS) {
    fromMs = toMs - MIN_WINDOW_MS
  }
  return { fromMs, toMs, nowMs }
}

function classifyTemplateKind(template?: string): DispatchTemplateKind {
  const slot = workspaceTemplateSlot(template)
  if (slot === 'chat') return 'chat'
  if (slot === 'auto-quant-v2') return 'auto-quant'
  if (slot === 'auto-prediction') return 'prediction'
  return 'custom'
}

const TEMPLATE_SORT_ORDER: Record<DispatchTemplateKind, number> = {
  commander: 0,
  chat: 1,
  'auto-quant': 2,
  prediction: 3,
  custom: 4,
}

function firstHeadingOrLine(markdown: string): string {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    return trimmed.replace(/^#{1,6}\s+/, '').slice(0, 120)
  }
  return 'Inbox update'
}

function resolveSessionLabel(
  svc: WorkspaceService,
  workspaceId: string,
  resumeId: string,
): string | undefined {
  const identity = svc.resumeRegistry?.get?.(resumeId)
  if (identity?.displayName) return identity.displayName
  const sessionRecord = svc.sessionRegistry?.findByResumeId?.(workspaceId, resumeId)
  return sessionRecord ? sessionPreferredTitle(sessionRecord) : undefined
}

function resolveWorkspaceForResume(
  svc: WorkspaceService,
  resumeId: string,
  taskByResume?: ReadonlyMap<string, OrchestrationTask>,
): string | undefined {
  const identityWs = svc.resumeRegistry?.get?.(resumeId)?.wsId
  if (identityWs) return identityWs
  const orch = taskByResume?.get(resumeId)
  if (!orch) return undefined
  if (orch.parentResumeId === resumeId) return orch.parentWorkspaceId
  if (orch.workerResumeId === resumeId) return orch.workerWorkspaceId
  return undefined
}

function normalizeStopStatus(status: AgentRuntimeStopStatus | undefined): DispatchSpan['status'] {
  if (status === 'failed') return 'failed'
  if (status === 'interrupted') return 'interrupted'
  return 'done'
}

function triggerFromCause(
  cause: AgentRuntimeCause | undefined,
  surface: AgentRuntimeSurface,
  issueTitleByKey: ReadonlyMap<string, string>,
): DispatchSpanTrigger {
  if (cause?.kind === 'issue') {
    const issueTitle = issueTitleByKey.get(`${cause.workspaceId}\0${cause.issueId}`)
    return {
      kind: 'scheduled-issue',
      workspaceId: cause.workspaceId,
      issueId: cause.issueId,
      ...(issueTitle ? { issueTitle } : {}),
    }
  }
  if (cause?.kind === 'conversation' && cause.from) {
    return {
      kind: 'conversation',
      callerKind: cause.from.kind,
      ...(cause.from.workspaceId ? { callerWorkspaceId: cause.from.workspaceId } : {}),
      ...(cause.from.resumeId ? { callerResumeId: cause.from.resumeId } : {}),
    }
  }
  return { kind: 'interactive', surface }
}

async function readInteractiveRuntimeEvents(
  svc: WorkspaceService,
  fromMs: number,
): Promise<AgentRuntimeEvent[]> {
  const journal = svc.activityJournal ?? svc.agentRuntimeLog
  if (!journal) return []

  const runtimeTypes = ['runtime.started', 'runtime.stopped', 'runtime.spawn_failed'] as const
  if (typeof journal.query === 'function') {
    const firstPage = await journal.query({
      types: [...runtimeTypes],
      page: 1,
      pageSize: JOURNAL_FAST_LIMIT,
    })
    const entries = firstPage.entries as AgentRuntimeEvent[]
    const oldestReturned = entries[entries.length - 1]
    if (entries.length < firstPage.total && oldestReturned && oldestReturned.ts > fromMs) {
      if (typeof journal.read === 'function') {
        const all = await journal.read()
        return all.filter((event) =>
          event.type === 'runtime.started'
          || event.type === 'runtime.stopped'
          || event.type === 'runtime.spawn_failed',
        )
      }
    }
    return entries
  }

  if (typeof journal.read === 'function') {
    const all = await journal.read()
    return all.filter((event) =>
      event.type === 'runtime.started'
      || event.type === 'runtime.stopped'
      || event.type === 'runtime.spawn_failed',
    )
  }
  return []
}

function buildInteractiveSpans(
  svc: WorkspaceService,
  events: readonly AgentRuntimeEvent[],
  visibleIds: ReadonlySet<string>,
  issueTitleByKey: ReadonlyMap<string, string>,
  fromMs: number,
  toMs: number,
  nowMs: number,
): DispatchSpan[] {
  const chronological = [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq)
  type OpenStart = {
    seq: number
    ts: number
    payload: AgentRuntimeSubject
    surface: AgentRuntimeSurface
  }
  const openByKey = new Map<string, OpenStart>()
  const spans: DispatchSpan[] = []

  const pushSpan = (
    id: string,
    start: OpenStart,
    finishedAt: number | null,
    status: DispatchSpan['status'],
    endPayload?: {
      error?: string
      assistantText?: string
      metrics?: { toolCalls?: number; toolFailures?: number }
    },
  ) => {
    const endMs = finishedAt ?? nowMs
    if (start.ts > toMs || endMs < fromMs) return
    const sessionLabel = resolveSessionLabel(svc, start.payload.workspaceId, start.payload.resumeId)
    spans.push({
      id,
      kind: 'interactive',
      workspaceId: start.payload.workspaceId,
      resumeId: start.payload.resumeId,
      ...(sessionLabel ? { sessionLabel } : {}),
      agent: start.payload.agent,
      status,
      startedAt: start.ts,
      finishedAt,
      durationMs: Math.max(0, endMs - start.ts),
      trigger: triggerFromCause(start.payload.cause, start.surface, issueTitleByKey),
      ...(endPayload?.assistantText ? { assistantPreview: endPayload.assistantText } : {}),
      toolCalls: endPayload?.metrics?.toolCalls ?? 0,
      toolFailures: endPayload?.metrics?.toolFailures ?? 0,
      ...(endPayload?.error ? { error: endPayload.error } : {}),
    })
  }

  for (const event of chronological) {
    const payload = event.payload as AgentRuntimeSubject & {
      status?: AgentRuntimeStopStatus
      error?: string
      assistantText?: string
      metrics?: { toolCalls?: number; toolFailures?: number }
    }
    if (!payload?.workspaceId || !payload?.resumeId) continue
    if (!visibleIds.has(payload.workspaceId)) continue

    const key = `${payload.workspaceId}\0${payload.resumeId}\0${payload.sessionRecordId ?? ''}`
    if (event.type === 'runtime.started') {
      if (payload.surface !== 'terminal' && payload.surface !== 'webpi') continue
      const existing = openByKey.get(key)
      if (existing) {
        pushSpan(`int-${existing.seq}`, existing, event.ts, 'done')
      }
      openByKey.set(key, {
        seq: event.seq,
        ts: event.ts,
        payload,
        surface: payload.surface,
      })
      continue
    }

    if (event.type === 'runtime.stopped' || event.type === 'runtime.spawn_failed') {
      const open = openByKey.get(key)
      if (!open) continue
      openByKey.delete(key)
      const status: DispatchSpan['status'] = event.type === 'runtime.spawn_failed'
        ? 'failed'
        : normalizeStopStatus(payload.status)
      pushSpan(`int-${open.seq}`, open, event.ts, status, {
        error: payload.error,
        assistantText: payload.assistantText,
        metrics: payload.metrics,
      })
    }
  }

  for (const open of openByKey.values()) {
    const sessionRecordId = open.payload.sessionRecordId
    const hasLivenessInspectors = Boolean(svc.pool || svc.web || svc.isResumeActive)
    const live = !hasLivenessInspectors || Boolean(
      (sessionRecordId && (svc.pool?.get?.(sessionRecordId) || svc.web?.get?.(sessionRecordId)))
      || svc.isResumeActive?.(open.payload.resumeId),
    )
    pushSpan(
      `int-${open.seq}`,
      open,
      live ? null : open.ts,
      live ? 'running' : 'interrupted',
    )
  }

  return spans
}

export async function buildDispatchBoardSnapshot(
  svc: WorkspaceService,
  input: {
    fromMs?: number
    toMs?: number
    nowMs?: number
  } = {},
): Promise<DispatchBoardSnapshot> {
  const { fromMs, toMs, nowMs } = normalizeWindow(input)

  const activeWorkspaces = typeof svc.listActiveWorkspaces === 'function'
    ? await svc.listActiveWorkspaces()
    : []
  const activeById = new Map<string, WorkspaceMeta>(
    activeWorkspaces.map((ws) => [ws.id, ws]),
  )
  const visibleIds = new Set<string>(activeById.keys())
  visibleIds.add(COMMANDER_LANE_ID)

  const commanderHost = svc as unknown as DispatchCommanderHost
  const commanderPointerPromise = typeof commanderHost.getCommanderPointer === 'function'
    ? commanderHost.getCommanderPointer().catch(() => null)
    : Promise.resolve(null)

  const [lanes, issuesSnap, scheduleSnap, conversationRecords, runtimeEvents, commanderPointer] = await Promise.all([
    Promise.all(
      activeWorkspaces.map(async (ws): Promise<DispatchLane> => {
        const meta = ws.dir ? await readWorkspaceMetadata(ws.dir).catch(() => null) : null
        const label = meta?.ok && meta.metadata.displayName ? meta.metadata.displayName : ws.tag
        return {
          workspaceId: ws.id,
          tag: ws.tag,
          label,
          ...(ws.template ? { template: ws.template } : {}),
          templateKind: classifyTemplateKind(ws.template),
        }
      }),
    ),
    typeof svc.issuesSnapshot === 'function'
      ? svc.issuesSnapshot().catch(() => ({ workspaces: [], duplicateNames: [] }))
      : Promise.resolve({ workspaces: [], duplicateNames: [] }),
    typeof svc.scheduleSnapshot === 'function'
      ? svc.scheduleSnapshot().catch(() => ({ workspaces: [] }))
      : Promise.resolve({ workspaces: [] }),
    svc.agentConversationLog?.queryWindow
      ? svc.agentConversationLog.queryWindow({ fromMs, toMs, limit: MAX_SPANS }).catch(() => [])
      : Promise.resolve([]),
    readInteractiveRuntimeEvents(svc, fromMs).catch(() => []),
    commanderPointerPromise,
  ])

  const commanderSessions = typeof svc.sessionRegistry?.listFor === 'function'
    ? svc.sessionRegistry.listFor(COMMANDER_LANE_ID)
    : []
  const commanderInitialized = Boolean(
    commanderPointer?.resumeId
    || commanderSessions.length > 0,
  )

  lanes.sort((a, b) => {
    const orderDiff = TEMPLATE_SORT_ORDER[a.templateKind] - TEMPLATE_SORT_ORDER[b.templateKind]
    if (orderDiff !== 0) return orderDiff
    return a.label.localeCompare(b.label)
  })

  const issueTitleByKey = new Map<string, string>()
  for (const ws of issuesSnap.workspaces) {
    if (!activeById.has(ws.wsId)) continue
    for (const issue of ws.issues) {
      issueTitleByKey.set(`${ws.wsId}\0${issue.id}`, issue.title)
    }
  }

  const scheduleMarkers: DispatchScheduleMarker[] = []
  const upcomingHorizonMs = Math.max(toMs, nowMs + 60 * 60_000)
  for (const ws of scheduleSnap.workspaces) {
    if (!activeById.has(ws.wsId)) continue
    for (const task of ws.tasks) {
      if (!task.enabled) continue
      const dueInWindow =
        task.nextDueAtMs !== null
        && task.nextDueAtMs >= fromMs
        && task.nextDueAtMs <= upcomingHorizonMs
      const firedInWindow =
        task.lastFiredAtMs !== null
        && task.lastFiredAtMs >= fromMs
        && task.lastFiredAtMs <= toMs
      if (!dueInWindow && !firedInWindow && !task.skipState) continue
      scheduleMarkers.push({
        workspaceId: ws.wsId,
        issueId: task.id,
        title: task.issue,
        nextDueAtMs: task.nextDueAtMs,
        lastFiredAtMs: task.lastFiredAtMs,
        ...(task.skipState ? { skipState: task.skipState } : {}),
      })
    }
  }

  const allOrchestrationTasks: OrchestrationTask[] = svc.orchestration?.listTasks
    ? svc.orchestration.listTasks()
    : []
  const orchestrationByHeadlessId = new Map<string, OrchestrationTask>()
  const orchestrationByWorkerResumeId = new Map<string, OrchestrationTask>()
  const orchestrationByDispatchId = new Map<string, OrchestrationTask>()
  const orchestrationByAnyResumeId = new Map<string, OrchestrationTask>()

  for (const task of allOrchestrationTasks) {
    orchestrationByDispatchId.set(task.dispatchId, task)
    if (task.headlessTaskId) {
      orchestrationByHeadlessId.set(task.headlessTaskId, task)
    }
    if (!orchestrationByWorkerResumeId.has(task.workerResumeId)) {
      orchestrationByWorkerResumeId.set(task.workerResumeId, task)
    }
    if (!orchestrationByAnyResumeId.has(task.workerResumeId)) {
      orchestrationByAnyResumeId.set(task.workerResumeId, task)
    }
    if (!orchestrationByAnyResumeId.has(task.parentResumeId)) {
      orchestrationByAnyResumeId.set(task.parentResumeId, task)
    }
  }

  const headlessRaw = svc.headlessTasks?.list ? svc.headlessTasks.list() : []
  const headlessByTaskId = new Map(headlessRaw.map((t) => [t.taskId, t]))
  const activeConvRecords = conversationRecords.filter((rec) => {
    const task = headlessByTaskId.get(rec.taskId)
    const effectiveEnd = rec.completedAt ?? (
      task
        ? (task.status === 'running' ? nowMs : (task.finishedAt ?? rec.dispatchedAt))
        : rec.dispatchedAt
    )
    return rec.dispatchedAt <= toMs && effectiveEnd >= fromMs
  })
  const conversationByTaskId = new Map(activeConvRecords.map((rec) => [rec.taskId, rec]))

  const headlessSpans: DispatchSpan[] = []
  for (const task of headlessRaw) {
    if (!visibleIds.has(task.wsId)) continue
    const endMs = task.finishedAt ?? nowMs
    if (task.startedAt > toMs || endMs < fromMs) continue
    if (headlessSpans.length >= MAX_SPANS) break

    const orchTask =
      orchestrationByHeadlessId.get(task.taskId)
      ?? orchestrationByWorkerResumeId.get(task.resumeId)
    const conv = conversationByTaskId.get(task.taskId)

    let trigger: DispatchSpanTrigger
    if (task.trigger?.kind === 'issue') {
      const issueTitle = issueTitleByKey.get(`${task.trigger.workspaceId}\0${task.trigger.issueId}`)
      trigger = {
        kind: 'scheduled-issue',
        workspaceId: task.trigger.workspaceId,
        issueId: task.trigger.issueId,
        ...(issueTitle ? { issueTitle } : {}),
        ...(task.trigger.metadata?.connectorId ? { connectorId: task.trigger.metadata.connectorId } : {}),
      }
    } else if (task.inquiry) {
      const subj = task.inquiry.subject
      trigger = {
        kind: 'inquiry',
        subjectKind: subj.kind,
        ...(subj.kind === 'issue' ? { workspaceId: subj.workspaceId, issueId: subj.issueId } : {}),
        ...(subj.kind === 'inbox' ? { inboxEntryId: subj.entryId } : {}),
        question: task.inquiry.question,
      }
    } else if (orchTask && visibleIds.has(orchTask.parentWorkspaceId)) {
      trigger = {
        kind: 'orchestration',
        dispatchId: orchTask.dispatchId,
        parentWorkspaceId: orchTask.parentWorkspaceId,
        parentResumeId: orchTask.parentResumeId,
      }
    } else if (conv) {
      trigger = {
        kind: 'conversation',
        callerKind: conv.source.kind,
        ...(conv.source.kind === 'workspace' ? { callerWorkspaceId: conv.source.workspaceId } : {}),
        ...(conv.source.kind === 'session'
          ? { callerWorkspaceId: conv.source.workspaceId, callerResumeId: conv.source.resumeId }
          : {}),
      }
    } else {
      trigger = { kind: 'manual' }
    }

    let delivery: DispatchSpanDelivery | undefined
    if (task.communication?.delivery && task.terminalDelivery) {
      delivery = {
        kind: 'connector',
        connectorId: task.communication.delivery.connectorId,
        source: task.communication.delivery.source,
        state: task.terminalDelivery.state,
        ...(task.terminalDelivery.error ? { error: task.terminalDelivery.error } : {}),
      }
    } else if (
      task.communication?.reply.kind === 'issue-comment'
      || task.communication?.reply.kind === 'issue-run'
    ) {
      delivery = {
        kind: task.communication.reply.kind,
        workspaceId: task.communication.reply.workspaceId,
        issueId: task.communication.reply.issueId,
      }
    }

    const sessionLabel = resolveSessionLabel(svc, task.wsId, task.resumeId)
    const originalPrompt =
      conv && conv.prompt.original !== task.prompt ? conv.prompt.original : undefined
    const assistantPreview = task.output?.assistantPreview ?? conv?.assistantText ?? undefined

    headlessSpans.push({
      id: task.taskId,
      kind: 'headless',
      workspaceId: task.wsId,
      resumeId: task.resumeId,
      ...(sessionLabel ? { sessionLabel } : {}),
      agent: task.agent,
      ...(task.model ? { model: task.model } : {}),
      status: task.status,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt ?? null,
      durationMs: task.durationMs ?? Math.max(0, endMs - task.startedAt),
      trigger,
      prompt: task.prompt,
      ...(originalPrompt ? { originalPrompt } : {}),
      ...(assistantPreview ? { assistantPreview } : {}),
      toolCalls: task.output?.toolCalls ?? 0,
      toolFailures: task.output?.toolFailures ?? 0,
      ...(task.error ? { error: task.error } : {}),
      ...(delivery ? { delivery } : {}),
    })
  }

  const interactiveSpans = buildInteractiveSpans(
    svc,
    runtimeEvents,
    visibleIds,
    issueTitleByKey,
    fromMs,
    toMs,
    nowMs,
  )

  const spans = [...headlessSpans, ...interactiveSpans]
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(0, MAX_SPANS)

  // Edges: orchestration dispatches, orchestration messages, cross-agent conversations,
  // and scheduled-issue completion reports targeting the global Commander.
  const edges: DispatchEdge[] = []
  const orchestrationWorkerHeadlessIds = new Set<string>()
  for (const task of allOrchestrationTasks) {
    if (task.headlessTaskId) orchestrationWorkerHeadlessIds.add(task.headlessTaskId)
    if (!visibleIds.has(task.parentWorkspaceId) || !visibleIds.has(task.workerWorkspaceId)) {
      continue
    }
    const endAt = task.settledAt ?? task.updatedAt
    if (task.createdAt > toMs || endAt < fromMs) continue
    edges.push({
      id: `dsp-${task.dispatchId}`,
      kind: 'dispatch',
      fromWorkspaceId: task.parentWorkspaceId,
      fromResumeId: task.parentResumeId,
      toWorkspaceId: task.workerWorkspaceId,
      toResumeId: task.workerResumeId,
      at: task.createdAt,
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      taskStatus: task.status,
      turnCount: task.turnCount,
      spec: task.spec,
      ...(task.outcome ? { outcome: task.outcome } : {}),
      ...(task.summary ? { summary: task.summary } : {}),
      ...(task.evidence ? { evidence: task.evidence } : {}),
      ...(task.deliverables?.length ? { deliverables: task.deliverables } : {}),
      ...(task.stopReason ? { stopReason: task.stopReason } : {}),
    })
  }

  const orchMessages = svc.orchestration?.listMessages
    ? svc.orchestration.listMessages({ sinceMs: fromMs, untilMs: toMs })
    : []
  for (const msg of orchMessages) {
    const ownerTask = orchestrationByDispatchId.get(msg.dispatchId)
    const fromWorkspaceId =
      ownerTask && msg.fromResumeId === ownerTask.parentResumeId
        ? ownerTask.parentWorkspaceId
        : ownerTask && msg.fromResumeId === ownerTask.workerResumeId
          ? ownerTask.workerWorkspaceId
          : resolveWorkspaceForResume(svc, msg.fromResumeId, orchestrationByAnyResumeId)
    const toWorkspaceId =
      ownerTask && msg.toResumeId === ownerTask.parentResumeId
        ? ownerTask.parentWorkspaceId
        : ownerTask && msg.toResumeId === ownerTask.workerResumeId
          ? ownerTask.workerWorkspaceId
          : resolveWorkspaceForResume(svc, msg.toResumeId, orchestrationByAnyResumeId)

    if (!fromWorkspaceId || !toWorkspaceId) continue
    if (!visibleIds.has(fromWorkspaceId) || !visibleIds.has(toWorkspaceId)) continue

    edges.push({
      id: msg.id,
      kind: msg.kind,
      fromWorkspaceId,
      fromResumeId: msg.fromResumeId,
      toWorkspaceId,
      toResumeId: msg.toResumeId,
      at: msg.createdAt,
      taskId: msg.taskId,
      dispatchId: msg.dispatchId,
      deliveryStatus: msg.status,
      ...(msg.leasedAt !== undefined ? { leasedAt: msg.leasedAt } : {}),
      ...(msg.ackedAt !== undefined ? { ackedAt: msg.ackedAt } : {}),
      ...(msg.subject ? { subject: msg.subject } : {}),
      body: msg.body,
      ...(msg.metadata ? { metadata: msg.metadata } : {}),
    })
  }

  for (const rec of activeConvRecords) {
    if (orchestrationWorkerHeadlessIds.has(rec.taskId)) continue
    if (rec.dispatchedAt < fromMs || rec.dispatchedAt > toMs) continue
    if (rec.source.kind !== 'session' && rec.source.kind !== 'workspace') continue
    if (!visibleIds.has(rec.source.workspaceId) || !visibleIds.has(rec.target.workspaceId)) continue
    edges.push({
      id: `conv-${rec.taskId}`,
      kind: 'conversation',
      fromWorkspaceId: rec.source.workspaceId,
      ...(rec.source.kind === 'session' ? { fromResumeId: rec.source.resumeId } : {}),
      toWorkspaceId: rec.target.workspaceId,
      toResumeId: rec.target.resumeId,
      at: rec.dispatchedAt,
      taskId: rec.taskId,
      originalPrompt: rec.prompt.original,
      deliveredPrompt: rec.prompt.delivered,
      promptMode: rec.prompt.mode,
      resolution: rec.resolution,
      assistantText: rec.assistantText,
      ...(rec.durationMs !== undefined ? { durationMs: rec.durationMs } : {}),
    })
  }

  // Scheduled-issue completion reports delivered to Commander via SessionMailbox.
  const commanderMailbox = commanderHost.commanderMailbox ?? commanderHost.sessionMailbox
  if (commanderMailbox) {
    let mailboxMessages: readonly DispatchMailboxMessageLike[] = []
    if (typeof commanderMailbox.listRecent === 'function') {
      mailboxMessages = commanderMailbox.listRecent({ sinceMs: fromMs })
    } else if (typeof commanderMailbox.pendingFor === 'function') {
      const candidateResumeIds = new Set<string>()
      if (commanderPointer?.resumeId) candidateResumeIds.add(commanderPointer.resumeId)
      for (const rec of commanderSessions) {
        if (rec.resumeId) candidateResumeIds.add(rec.resumeId)
      }
      for (const span of spans) {
        if (span.workspaceId === COMMANDER_LANE_ID && span.resumeId) {
          candidateResumeIds.add(span.resumeId)
        }
      }
      const collected: DispatchMailboxMessageLike[] = []
      for (const resumeId of candidateResumeIds) {
        collected.push(...commanderMailbox.pendingFor(resumeId))
      }
      mailboxMessages = collected
    }

    const seenMailboxIds = new Set<string>()
    for (const msg of mailboxMessages) {
      if (seenMailboxIds.has(msg.id)) continue
      seenMailboxIds.add(msg.id)
      if (msg.recipientWorkspaceId !== COMMANDER_LANE_ID) continue
      if (!activeById.has(msg.childWorkspaceId)) continue
      if (msg.createdAt < fromMs || msg.createdAt > toMs) continue

      const childTask = headlessByTaskId.get(msg.taskId)
      const isScheduledReport =
        msg.reportSource?.kind === 'scheduled-issue'
        || (!msg.reportSource && childTask?.trigger?.kind === 'issue')
      if (!isScheduledReport) continue

      const issueId =
        msg.reportSource?.issueId
        ?? (childTask?.trigger?.kind === 'issue' ? childTask.trigger.issueId : undefined)
      const issueTitle =
        msg.reportSource?.issueTitle
        ?? (issueId ? issueTitleByKey.get(`${msg.childWorkspaceId}\0${issueId}`) : undefined)
      const issueLabel = issueTitle || (issueId ? `#${issueId}` : 'Scheduled run')
      const deliveryStatus: OrchestrationMessageStatus =
        msg.status === 'acked'
          ? 'acked'
          : msg.status === 'notified'
            ? 'leased'
            : 'unread'
      const body = msg.error ?? msg.assistantPreview ?? undefined
      const outcome: OrchestrationTaskOutcome =
        msg.taskStatus === 'done'
          ? 'completed'
          : msg.taskStatus === 'failed'
            ? 'failed'
            : 'inconclusive'

      edges.push({
        id: `report-${msg.id}`,
        kind: 'conversation',
        messageKind: 'scheduled_report',
        fromWorkspaceId: msg.childWorkspaceId,
        fromResumeId: msg.childResumeId,
        toWorkspaceId: COMMANDER_LANE_ID,
        toResumeId: msg.recipientResumeId,
        at: msg.createdAt,
        taskId: msg.taskId,
        deliveryStatus,
        ...(msg.notifiedAt !== undefined ? { leasedAt: msg.notifiedAt } : {}),
        ...(msg.ackedAt !== undefined ? { ackedAt: msg.ackedAt } : {}),
        subject: issueLabel,
        ...(body ? { body } : {}),
        outcome,
        summary: `${issueLabel} (${msg.taskStatus})`,
        ...(msg.durationMs !== undefined ? { durationMs: msg.durationMs } : {}),
      })
    }
  }

  edges.sort((a, b) => a.at - b.at)

  // Artifacts: Inbox pushes + Provenance reports + Orchestration deliverables.
  const artifacts: DispatchArtifact[] = []
  const seenReportKeys = new Set<string>()

  if (svc.inboxStore) {
    let before: string | undefined
    for (let page = 0; page < MAX_INBOX_PAGES; page += 1) {
      const batch = await svc.inboxStore.read({ limit: 100, before }).catch(() => ({
        entries: [],
        hasMore: false,
        unreadCount: 0,
      }))
      if (batch.entries.length === 0) break
      for (const entry of batch.entries) {
        if (entry.ts > toMs) continue
        if (entry.ts < fromMs) continue
        const laneWsId = visibleIds.has(entry.workspaceId)
          ? entry.workspaceId
          : entry.origin?.issueWorkspaceId && visibleIds.has(entry.origin.issueWorkspaceId)
            ? entry.origin.issueWorkspaceId
            : null
        if (!laneWsId) continue
        artifacts.push({
          id: `inbox-${entry.id}`,
          kind: 'inbox',
          entryId: entry.id,
          workspaceId: laneWsId,
          at: entry.ts,
          title: firstHeadingOrLine(entry.body),
          body: entry.body,
          files: inboxFiles(entry).map((f) => f.path),
          unread: !entry.readAt,
          ...(entry.origin?.runId ? { runId: entry.origin.runId } : {}),
          ...(entry.origin?.resumeId ? { resumeId: entry.origin.resumeId } : {}),
          ...(entry.origin?.issueId ? { issueId: entry.origin.issueId } : {}),
        })
      }
      const oldest = batch.entries[batch.entries.length - 1]
      if (!batch.hasMore || !oldest || oldest.ts < fromMs) break
      before = oldest.id
    }
  }

  const provenanceRecords = svc.provenanceStore?.list
    ? svc.provenanceStore.list({ limit: MAX_SPANS })
    : []
  for (const record of provenanceRecords) {
    if (record.artifact.kind !== 'report') continue
    if (record.at < fromMs || record.at > toMs) continue
    if (!visibleIds.has(record.artifact.workspaceId)) continue
    seenReportKeys.add(`${record.artifact.workspaceId}\0${record.artifact.path}`)
    artifacts.push({
      id: `prov-${record.id}`,
      kind: 'report',
      workspaceId: record.artifact.workspaceId,
      at: record.at,
      path: record.artifact.path,
      action: record.action,
      ...(record.origin.kind === 'session' ? { resumeId: record.origin.resumeId } : {}),
      ...(record.origin.kind === 'session' && record.origin.execution?.kind === 'headless'
        ? { runId: record.origin.execution.taskId }
        : {}),
    })
  }

  for (const task of allOrchestrationTasks) {
    if (!task.deliverables?.length) continue
    const settledAt = task.settledAt ?? task.updatedAt
    if (settledAt < fromMs || settledAt > toMs) continue
    for (const del of task.deliverables) {
      const wsId = del.workspaceId ?? task.workerWorkspaceId
      if (!visibleIds.has(wsId)) continue
      const key = `${wsId}\0${del.path}`
      if (seenReportKeys.has(key)) continue
      seenReportKeys.add(key)
      artifacts.push({
        id: `deliv-${task.dispatchId}-${del.path}`,
        kind: 'report',
        workspaceId: wsId,
        at: settledAt,
        path: del.path,
        action: 'delivered',
        ...(del.summary ? { summary: del.summary } : {}),
        ...(task.headlessTaskId ? { runId: task.headlessTaskId } : {}),
        resumeId: task.workerResumeId,
      })
    }
  }

  artifacts.sort((a, b) => a.at - b.at)

  const hasCommanderActivity =
    spans.some((span) => span.workspaceId === COMMANDER_LANE_ID)
    || edges.some(
      (edge) =>
        edge.fromWorkspaceId === COMMANDER_LANE_ID
        || edge.toWorkspaceId === COMMANDER_LANE_ID,
    )
    || artifacts.some((art) => art.workspaceId === COMMANDER_LANE_ID)

  const finalLanes: DispatchLane[] =
    (commanderInitialized || hasCommanderActivity)
    && !lanes.some((lane) => lane.workspaceId === COMMANDER_LANE_ID)
      ? [
          {
            workspaceId: COMMANDER_LANE_ID,
            tag: commanderHost.commanderWorkspace?.tag || COMMANDER_LANE_TAG,
            label: COMMANDER_LANE_LABEL,
            template: COMMANDER_LANE_ID,
            templateKind: 'commander',
          },
          ...lanes,
        ]
      : lanes

  const summary: DispatchBoardSummary = {
    activeWorkspaceCount: activeWorkspaces.length,
    runningSpanCount: spans.filter((span) => span.status === 'running').length,
    totalSpanCount: spans.length,
    edgeCount: edges.length,
    artifactCount: artifacts.length,
    errorSpanCount: spans.filter(
      (span) => span.status === 'failed' || span.status === 'interrupted',
    ).length,
  }

  return {
    fromMs,
    toMs,
    generatedAt: nowMs,
    lanes: finalLanes,
    spans,
    edges,
    artifacts,
    scheduleMarkers,
    summary,
  }
}
