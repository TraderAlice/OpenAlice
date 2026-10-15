import type { AgentRuntimeCause, AgentRuntimeEvent } from './activity-journal-types.js'

const RECENT_SIGNAL_MS = 12_000
const FAILURE_SIGNAL_MS = 12_000
// Runtime logs are append-only, but a hard process exit can omit the matching
// stopped event. Do not let that historical gap leave the global affordance
// claiming that a delegated request is still active forever.
const ACTIVE_STALE_MS = 24 * 60 * 60 * 1_000
export const GLOBAL_ACTIVITY_REFRESH_EVENT = 'openalice:activity-refresh'

/**
 * A signal is a deliberately small, user-facing fact selected from a larger
 * log stream. It is not a second runtime state machine. Each filter owns the
 * semantics needed to decide whether its source event is globally notable.
 */
export type AgentActivityKind =
  | 'conversation'
  | 'conversation-failed'
  | 'conversation-completed'
  | 'conversation-interrupted'
  | 'conversation-paused'
  | 'inbox'
  | 'news'
  | 'sonner-test-running'
  | 'sonner-test-success'
  | 'sonner-test-error'

export interface AgentActivitySignal {
  readonly id: string
  readonly kind: AgentActivityKind
  readonly workspaceId?: string
  readonly agent?: string
  readonly resumeId?: string
  readonly sessionRecordId?: string
  readonly taskId?: string
  readonly inboxEntryId?: string
  readonly newsItemId?: number
  readonly source?: string
  readonly image?: string
  readonly operationId?: string
  readonly failureKind?: 'spawn' | 'rejected' | 'failed'
  readonly cause?: AgentRuntimeCause
  readonly detail?: string
  readonly occurredAt: number
  /** Monotonic revision within a source, used to animate a newly notable fact once. */
  readonly revision: number
}

export interface GlobalActivitySources {
  readonly runtimeEvents: readonly AgentRuntimeEvent[]
}

/** Extend global activity projection by registering another narrow source filter here. */
export interface GlobalActivityFilter {
  readonly id: string
  project(sources: GlobalActivitySources, now: number): readonly AgentActivitySignal[]
}

export interface AgentActivitySummary {
  readonly primary: AgentActivitySignal | null
  readonly count: number
  readonly hasFailure: boolean
}

export interface GlobalAgentActivityData {
  readonly signals: readonly AgentActivitySignal[]
  readonly summary: AgentActivitySummary
  readonly loading: boolean
  readonly error: string | null
  refresh(): Promise<void>
}

function runtimeOperationId(event: AgentRuntimeEvent): string {
  if (event.payload.taskId) return `task:${event.payload.taskId}`
  if (event.payload.workspaceId && event.payload.resumeId) return `session:${event.payload.workspaceId}:${event.payload.resumeId}`
  return `event:${event.seq}`
}

interface ConversationProjection {
  readonly id: string
  readonly workspaceId: string
  readonly resumeId: string
  readonly agent: string
  readonly sessionRecordId?: string
  readonly taskId?: string
  readonly cause: Extract<AgentRuntimeCause, { kind: 'conversation' }>
  readonly startedAt: number
  readonly startRevision: number
  readonly updatedAt: number
  readonly revision: number
  readonly failed?: string
  readonly closed: boolean
  readonly status?: 'done' | 'interrupted' | 'paused'
  readonly failureKind?: 'spawn' | 'rejected' | 'failed'
}

function conversationFailure(event: AgentRuntimeEvent): string | undefined {
  if (event.type === 'runtime.spawn_failed') {
    return event.payload.error ?? event.payload.launchErrorCode ?? 'Agent request could not start'
  }
  if (event.type === 'runtime.rejected') return event.payload.reason ?? 'Agent request was rejected'
  if (event.type === 'runtime.stopped' && event.payload.status === 'failed') {
    return event.payload.error ?? 'Agent request failed'
  }
  return undefined
}

export const conversationActivityFilter: GlobalActivityFilter = {
  id: 'agent-conversation',
  project({ runtimeEvents }, now) {
    const projected = new Map<string, ConversationProjection>()
    for (const event of [...runtimeEvents].sort((a, b) => a.seq - b.seq)) {
      const id = runtimeOperationId(event)
      const previous = projected.get(id)
      const cause = event.payload.cause?.kind === 'conversation'
        ? event.payload.cause
        : previous?.cause
      if (!cause || cause.from?.kind === 'human') continue

      const failure = conversationFailure(event)
      const closed = event.type === 'runtime.stopped' && event.payload.status !== 'failed'
      const restarted = event.type === 'runtime.started'
      projected.set(id, {
        id,
        workspaceId: event.payload.workspaceId || previous?.workspaceId || '',
        resumeId: event.payload.resumeId || previous?.resumeId || '',
        agent: event.payload.agent || previous?.agent || '',
        ...(event.payload.sessionRecordId || previous?.sessionRecordId
          ? { sessionRecordId: event.payload.sessionRecordId ?? previous?.sessionRecordId }
          : {}),
        ...(event.payload.taskId || previous?.taskId
          ? { taskId: event.payload.taskId ?? previous?.taskId }
          : {}),
        cause,
        startedAt: restarted ? event.ts : previous?.startedAt ?? event.ts,
        startRevision: restarted ? event.seq : previous?.startRevision ?? event.seq,
        updatedAt: event.ts,
        // Tool-level progress can update the underlying conversation without
        // becoming a new global announcement. Only the conversation boundary
        // (start, failure, or close) advances the projected revision.
        revision: failure || closed || restarted ? event.seq : previous?.revision ?? event.seq,
        ...(failure ? { failed: failure, failureKind: event.type === 'runtime.spawn_failed' ? 'spawn' as const : event.type === 'runtime.rejected' ? 'rejected' as const : 'failed' as const } : !restarted && previous?.failed ? { failed: previous.failed, failureKind: previous.failureKind } : {}),
        ...(closed ? { status: event.payload.status as 'done' | 'interrupted' | 'paused' } : {}),
        closed: restarted || failure ? false : closed || previous?.closed === true,
      })
    }

    return [...projected.values()].flatMap((item): AgentActivitySignal[] => {
      const operationId = item.taskId ? item.id : `${item.id}:run:${item.startRevision}`
      const age = Math.max(0, now - item.updatedAt)
      if (item.failed) {
        if (age > FAILURE_SIGNAL_MS) return []
        return [{
          id: `conversation-failed:${item.id}`,
          kind: 'conversation-failed',
          operationId,
          failureKind: item.failureKind,
          workspaceId: item.workspaceId,
          agent: item.agent,
          resumeId: item.resumeId,
          ...(item.sessionRecordId ? { sessionRecordId: item.sessionRecordId } : {}),
          ...(item.taskId ? { taskId: item.taskId } : {}),
          cause: item.cause,
          detail: item.failed,
          occurredAt: item.updatedAt,
          revision: item.revision,
        }]
      }
      if (item.closed) {
        if (age > RECENT_SIGNAL_MS) return []
        const kind: AgentActivityKind = item.status === 'paused' ? 'conversation-paused' : item.status === 'interrupted' ? 'conversation-interrupted' : 'conversation-completed'
        return [{
          id: `${kind}:${item.id}`, kind, operationId, workspaceId: item.workspaceId,
          agent: item.agent, resumeId: item.resumeId, sessionRecordId: item.sessionRecordId, taskId: item.taskId,
          occurredAt: item.updatedAt, revision: item.revision,
        }]
      }
      if (now - item.startedAt > ACTIVE_STALE_MS) return []
      return [{
        id: `conversation:${item.id}`,
        kind: 'conversation',
        operationId,
        workspaceId: item.workspaceId,
        agent: item.agent,
        resumeId: item.resumeId,
        ...(item.sessionRecordId ? { sessionRecordId: item.sessionRecordId } : {}),
        ...(item.taskId ? { taskId: item.taskId } : {}),
        cause: item.cause,
        occurredAt: item.startedAt,
        revision: item.revision,
      }]
    })
  },
}

export const inboxActivityFilter: GlobalActivityFilter = {
  id: 'agent-inbox',
  project({ runtimeEvents }, now) {
    return runtimeEvents.flatMap((event): AgentActivitySignal[] => {
      if (event.type !== 'inbox.received' || !event.payload.inboxEntryId) return []
      if (!event.payload.agent || event.payload.originKind === 'manual') return []
      if (Math.max(0, now - event.ts) > RECENT_SIGNAL_MS) return []
      return [{
        id: `inbox:${event.payload.inboxEntryId}`,
        kind: 'inbox',
        workspaceId: event.payload.workspaceId,
        agent: event.payload.agent,
        ...(event.payload.resumeId ? { resumeId: event.payload.resumeId } : {}),
        ...(event.payload.sessionRecordId ? { sessionRecordId: event.payload.sessionRecordId } : {}),
        ...(event.payload.taskId ? { taskId: event.payload.taskId } : {}),
        inboxEntryId: event.payload.inboxEntryId,
        detail: event.payload.summary,
        occurredAt: event.ts,
        revision: event.seq,
      }]
    })
  },
}

export const newsActivityFilter: GlobalActivityFilter = {
  id: 'product-news',
  project({ runtimeEvents }, now) {
    return runtimeEvents.flatMap((event): AgentActivitySignal[] => {
      if (event.type !== 'news.ingested' || event.payload.newsItemId === undefined) return []
      if (Math.max(0, now - event.ts) > RECENT_SIGNAL_MS) return []
      return [{
        id: `news:${event.payload.newsItemId}`,
        kind: 'news',
        newsItemId: event.payload.newsItemId,
        source: event.payload.source,
        detail: event.payload.title,
        image: event.payload.image,
        occurredAt: event.ts,
        revision: event.seq,
      }]
    })
  },
}

export const sonnerTestActivityFilter: GlobalActivityFilter = {
  id: 'dev-sonner-test',
  project({ runtimeEvents }, now) {
    return runtimeEvents.flatMap((event): AgentActivitySignal[] => {
      if (event.type !== 'dev.sonner_test' || !event.payload.testState) return []
      if (Math.max(0, now - event.ts) > RECENT_SIGNAL_MS) return []
      return [{
        id: `sonner-test:${event.seq}`,
        kind: `sonner-test-${event.payload.testState}` as AgentActivityKind,
        workspaceId: event.payload.workspaceId,
        agent: event.payload.agent,
        detail: event.payload.message,
        occurredAt: event.ts,
        revision: event.seq,
      }]
    })
  },
}

export const globalActivityFilters: readonly GlobalActivityFilter[] = [
  conversationActivityFilter,
  inboxActivityFilter,
  newsActivityFilter,
  sonnerTestActivityFilter,
]

export function projectGlobalActivity(
  sources: GlobalActivitySources,
  now = Date.now(),
  filters: readonly GlobalActivityFilter[] = globalActivityFilters,
): AgentActivitySignal[] {
  return filters
    .flatMap((filter) => filter.project(sources, now))
    .sort((a, b) => Number(b.kind === 'conversation-failed') - Number(a.kind === 'conversation-failed')
      || b.occurredAt - a.occurredAt)
}

export function summarizeAgentActivity(
  signals: readonly AgentActivitySignal[],
): AgentActivitySummary {
  return {
    primary: signals[0] ?? null,
    count: signals.length,
    hasFailure: signals.some((signal) => signal.kind === 'conversation-failed'),
  }
}
