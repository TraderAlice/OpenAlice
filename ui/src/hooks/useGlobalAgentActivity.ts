import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import type { AgentRuntimeCause, AgentRuntimeEvent } from '../api/agentRuntimeLog'
import type { InboxEntry } from '../api/inbox'

const POLL_MS = 4_000
const INITIAL_EVENT_LIMIT = 100
const EVENT_CACHE_LIMIT = 500
const INBOX_LIMIT = 25
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
  | 'inbox'
  | 'sonner-test-running'
  | 'sonner-test-success'
  | 'sonner-test-error'

export interface AgentActivitySignal {
  readonly id: string
  readonly kind: AgentActivityKind
  readonly workspaceId: string
  readonly agent?: string
  readonly resumeId?: string
  readonly sessionRecordId?: string
  readonly taskId?: string
  readonly inboxEntryId?: string
  readonly cause?: AgentRuntimeCause
  readonly detail?: string
  readonly occurredAt: number
  /** Monotonic revision within a source, used to animate a newly notable fact once. */
  readonly revision: number
}

export interface GlobalActivitySources {
  readonly runtimeEvents: readonly AgentRuntimeEvent[]
  readonly inboxEntries: readonly InboxEntry[]
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
  return `session:${event.payload.workspaceId}:${event.payload.resumeId}`
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
  readonly updatedAt: number
  readonly revision: number
  readonly failed?: string
  readonly closed: boolean
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
        startedAt: previous?.startedAt ?? event.ts,
        updatedAt: event.ts,
        // Tool-level progress can update the underlying conversation without
        // becoming a new global announcement. Only the conversation boundary
        // (start, failure, or close) advances the projected revision.
        revision: failure || closed ? event.seq : previous?.revision ?? event.seq,
        ...(failure ? { failed: failure } : previous?.failed ? { failed: previous.failed } : {}),
        closed: failure ? false : closed || previous?.closed === true,
      })
    }

    return [...projected.values()].flatMap((item): AgentActivitySignal[] => {
      const age = Math.max(0, now - item.updatedAt)
      if (item.failed) {
        if (age > FAILURE_SIGNAL_MS) return []
        return [{
          id: `conversation-failed:${item.id}`,
          kind: 'conversation-failed',
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
      if (item.closed || now - item.startedAt > ACTIVE_STALE_MS) return []
      return [{
        id: `conversation:${item.id}`,
        kind: 'conversation',
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
  project({ inboxEntries }, now) {
    return inboxEntries.flatMap((entry): AgentActivitySignal[] => {
      if (!entry.origin?.agent || entry.origin.kind === 'manual') return []
      if (Math.max(0, now - entry.ts) > RECENT_SIGNAL_MS) return []
      return [{
        id: `inbox:${entry.id}`,
        kind: 'inbox',
        workspaceId: entry.workspaceId,
        agent: entry.origin.agent,
        ...(entry.origin.resumeId ? { resumeId: entry.origin.resumeId } : {}),
        ...(entry.origin.sessionId ? { sessionRecordId: entry.origin.sessionId } : {}),
        ...(entry.origin.runId ? { taskId: entry.origin.runId } : {}),
        inboxEntryId: entry.id,
        occurredAt: entry.ts,
        revision: entry.ts,
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

/**
 * Global projection of significant cross-Agent scheduling and delivery facts.
 * Office owns the complete runtime state machine; this hook intentionally
 * exposes only signals selected by the registered high-level filters.
 */
export function useGlobalAgentActivity(): GlobalAgentActivityData {
  const [runtimeEvents, setRuntimeEvents] = useState<AgentRuntimeEvent[]>([])
  const [inboxEntries, setInboxEntries] = useState<InboxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const cursorRef = useRef(0)
  const initializedRef = useRef(false)

  const refresh = useCallback(async () => {
    const runtimeRequest = initializedRef.current
      ? api.agentRuntime.query({ afterSeq: cursorRef.current, limit: INITIAL_EVENT_LIMIT })
      : api.agentRuntime.query({ page: 1, pageSize: INITIAL_EVENT_LIMIT })
    const [runtimeResult, inboxResult] = await Promise.allSettled([
      runtimeRequest,
      api.inbox.history({ limit: INBOX_LIMIT }),
    ])

    const errors: string[] = []
    if (runtimeResult.status === 'fulfilled') {
      const incoming = [...runtimeResult.value.entries].sort((a, b) => a.seq - b.seq)
      setRuntimeEvents((current) => {
        const bySeq = new Map(current.map((event) => [event.seq, event]))
        for (const event of incoming) bySeq.set(event.seq, event)
        return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-EVENT_CACHE_LIMIT)
      })
      cursorRef.current = Math.max(
        cursorRef.current,
        runtimeResult.value.lastSeq,
        ...incoming.map((event) => event.seq),
      )
      initializedRef.current = true
    } else {
      errors.push(runtimeResult.reason instanceof Error
        ? runtimeResult.reason.message
        : String(runtimeResult.reason))
    }

    if (inboxResult.status === 'fulfilled') {
      setInboxEntries(inboxResult.value.entries)
    } else {
      errors.push(inboxResult.reason instanceof Error
        ? inboxResult.reason.message
        : String(inboxResult.reason))
    }

    setNow(Date.now())
    setError(errors.length > 0 ? errors.join('; ') : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    const refreshFromActivity = () => void refresh()
    window.addEventListener(GLOBAL_ACTIVITY_REFRESH_EVENT, refreshFromActivity)
    return () => {
      window.clearInterval(id)
      window.removeEventListener(GLOBAL_ACTIVITY_REFRESH_EVENT, refreshFromActivity)
    }
  }, [refresh])

  const signals = useMemo(() => projectGlobalActivity(
    { runtimeEvents, inboxEntries },
    now,
    globalActivityFilters,
  ), [inboxEntries, now, runtimeEvents])
  const summary = useMemo(() => summarizeAgentActivity(signals), [signals])

  return { signals, summary, loading, error, refresh }
}
