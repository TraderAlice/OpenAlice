import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import type { AgentRuntimeEvent, AgentRuntimePage } from '../api/agentRuntimeLog'
import { GLOBAL_ACTIVITY_REFRESH_EVENT } from '../hooks/useGlobalAgentActivity'
import { officeActivityExcerpt } from './activity-text'
import type { OfficeDutySourceStatus } from './duty-registry'

const POLL_MS = 4_000
const FRESH_MS = 12_000
const PENDING_COUNT_CAP = 9
const ACK_STORAGE_PREFIX = 'openalice:office-product-activity:ack:'
const OFFICE_ACTIVITY_KINDS = ['agent', 'inbox', 'news'] as const
export type OfficeActivityKind = typeof OFFICE_ACTIVITY_KINDS[number]

export interface OfficeActivitySessionSubject {
  readonly kind: 'session'
  readonly workspaceId: string
  readonly resumeId: string
}

export interface OfficeActivityInboxSubject {
  readonly kind: 'inbox-entry'
  readonly workspaceId: string
  readonly inboxEntryId: string
  /** Event-time attachment count. `null` means the producer did not supply a valid count. */
  readonly documentCount: number | null
}

export type OfficeActivitySubject = OfficeActivitySessionSubject | OfficeActivityInboxSubject

const OFFICE_AGENT_REVIEW_TYPES = [
  'runtime.spawn_failed',
  'runtime.stopped',
  'runtime.rejected',
  'runtime.turn.error',
] as const satisfies readonly AgentRuntimeEvent['type'][]
const OFFICE_AGENT_REVIEW_TYPE_SET = new Set<AgentRuntimeEvent['type']>(
  OFFICE_AGENT_REVIEW_TYPES,
)

export interface OfficeActivityLandmark {
  readonly seq: number
  readonly occurredAt: number
  readonly detail?: string
  readonly source?: string
  readonly eventType?: AgentRuntimeEvent['type']
  readonly status?: AgentRuntimeEvent['payload']['status']
  readonly subject?: OfficeActivitySubject
}

export interface OfficeProductActivityState {
  readonly agent: OfficeActivityLandmark | null
  readonly inbox: OfficeActivityLandmark | null
  readonly news: OfficeActivityLandmark | null
  readonly attention: Readonly<Record<OfficeActivityKind, boolean>>
  readonly pending: Readonly<Record<OfficeActivityKind, number>>
  readonly freshKind: OfficeActivityKind | null
  /** Agent-review authority only; raw Inbox/News journal health must not fence Agent duty. */
  readonly agentSourceStatus?: OfficeDutySourceStatus
  /** Aggregate raw journal status. Optional for fixture compatibility; the live hook reports it. */
  readonly sourceStatus?: OfficeDutySourceStatus
}

export interface OfficeProductActivity extends OfficeProductActivityState {
  acknowledgeThrough(kind: OfficeActivityKind, seq: number): void
}

export function projectOfficeProductActivity(
  events: readonly AgentRuntimeEvent[],
): Pick<OfficeProductActivityState, 'agent' | 'inbox' | 'news'> {
  const ordered = [...events].sort((a, b) => b.seq - a.seq)
  const agent = ordered.find((event) => OFFICE_AGENT_REVIEW_TYPE_SET.has(event.type))
  const inbox = ordered.find((event) => event.type === 'inbox.received')
  const news = ordered.find((event) => event.type === 'news.ingested')

  return {
    agent: agent
      ? {
          seq: agent.seq,
          occurredAt: agent.ts,
          detail: officeActivityExcerpt(
            agent.payload.error
              ?? agent.payload.message
              ?? agent.payload.reason
              ?? agent.payload.assistantText,
          ),
          source: agent.payload.agent
            ?? agent.payload.workspaceLabel
            ?? agent.payload.workspaceId,
          eventType: agent.type,
          status: agent.payload.status,
          ...(agent.payload.workspaceId && agent.payload.resumeId
            ? {
                subject: {
                  kind: 'session' as const,
                  workspaceId: agent.payload.workspaceId,
                  resumeId: agent.payload.resumeId,
                },
              }
            : {}),
        }
      : null,
    inbox: inbox
      ? {
          seq: inbox.seq,
          occurredAt: inbox.ts,
          detail: officeActivityExcerpt(inbox.payload.summary),
          source: inbox.payload.agent ?? inbox.payload.workspaceLabel,
          ...(inbox.payload.workspaceId && inbox.payload.inboxEntryId
            ? {
                subject: {
                  kind: 'inbox-entry' as const,
                  workspaceId: inbox.payload.workspaceId,
                  inboxEntryId: inbox.payload.inboxEntryId,
                  documentCount: Number.isSafeInteger(inbox.payload.documentCount)
                    && inbox.payload.documentCount! >= 0
                    ? inbox.payload.documentCount!
                    : null,
                },
              }
            : {}),
        }
      : null,
    news: news
      ? {
          seq: news.seq,
          occurredAt: news.ts,
          detail: officeActivityExcerpt(news.payload.title),
          source: news.payload.source,
        }
      : null,
  }
}

function activityKindForEvent(event: AgentRuntimeEvent): OfficeActivityKind | null {
  if (event.type === 'inbox.received') return 'inbox'
  if (event.type === 'news.ingested') return 'news'
  return OFFICE_AGENT_REVIEW_TYPE_SET.has(event.type) ? 'agent' : null
}

function readAcknowledgedSeq(kind: OfficeActivityKind): number | null {
  try {
    const value = window.sessionStorage.getItem(`${ACK_STORAGE_PREFIX}${kind}`)
    if (value == null) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
  } catch {
    return null
  }
}

function writeAcknowledgedSeq(kind: OfficeActivityKind, seq: number) {
  try {
    window.sessionStorage.setItem(`${ACK_STORAGE_PREFIX}${kind}`, String(seq))
  } catch {
    // Activity affordances remain useful even when session storage is unavailable.
  }
}

/** Office-specific projection: persistent landmark copy, attention, and fresh-event motion. */
export function useOfficeProductActivity(): OfficeProductActivity {
  const [eventsByKind, setEventsByKind] = useState<
    Record<OfficeActivityKind, readonly AgentRuntimeEvent[]>
  >({ agent: [], inbox: [], news: [] })
  const [sourceStatus, setSourceStatus] = useState<OfficeDutySourceStatus>('loading')
  const [agentSourceStatus, setAgentSourceStatus] = useState<OfficeDutySourceStatus>('loading')
  const [freshKind, setFreshKind] = useState<OfficeActivityKind | null>(null)
  const [attention, setAttention] = useState<Record<OfficeActivityKind, boolean>>({
    agent: false,
    inbox: false,
    news: false,
  })
  const [pending, setPending] = useState<Record<OfficeActivityKind, number>>({
    agent: 0,
    inbox: 0,
    news: 0,
  })
  const initializedByKindRef = useRef<Record<OfficeActivityKind, boolean>>({
    agent: false,
    inbox: false,
    news: false,
  })
  const freshTimerRef = useRef<number | null>(null)
  const lifecycleGenerationRef = useRef(0)
  const issuedRequestRef = useRef<Record<OfficeActivityKind, number>>({ agent: 0, inbox: 0, news: 0 })
  const settledRequestRef = useRef<Record<OfficeActivityKind, number>>({ agent: 0, inbox: 0, news: 0 })
  const sourceStatusByKindRef = useRef<Record<OfficeActivityKind, OfficeDutySourceStatus>>({
    agent: 'loading',
    inbox: 'loading',
    news: 'loading',
  })
  const freshKindRef = useRef<OfficeActivityKind | null>(null)
  const freshSeqRef = useRef(0)
  const acknowledgedSeqRef = useRef<Record<OfficeActivityKind, number>>({ agent: 0, inbox: 0, news: 0 })
  const latestSeqRef = useRef<Record<OfficeActivityKind, number>>({ agent: 0, inbox: 0, news: 0 })
  const entriesByKindRef = useRef<Record<OfficeActivityKind, readonly AgentRuntimeEvent[]>>({
    agent: [],
    inbox: [],
    news: [],
  })

  const updateSourceStatus = useCallback((
    kind: OfficeActivityKind,
    status: OfficeDutySourceStatus,
  ) => {
    sourceStatusByKindRef.current = { ...sourceStatusByKindRef.current, [kind]: status }
    if (kind === 'agent') setAgentSourceStatus(status)
    const statuses = OFFICE_ACTIVITY_KINDS.map((family) => sourceStatusByKindRef.current[family])
    setSourceStatus(statuses.includes('error')
      ? 'error'
      : statuses.includes('loading') ? 'loading' : 'ready')
  }, [])

  const applyActivityPage = useCallback((kind: OfficeActivityKind, page: AgentRuntimePage) => {
    const entries = [...page.entries].sort((left, right) => left.seq - right.seq)
    const previousLatest = latestSeqRef.current[kind]
    const latest = projectOfficeProductActivity(entries)[kind]?.seq ?? 0
    latestSeqRef.current[kind] = latest
    entriesByKindRef.current[kind] = entries

    if (!initializedByKindRef.current[kind]) {
      const stored = readAcknowledgedSeq(kind)
      const acknowledged = stored == null || stored > page.lastSeq ? latest : stored
      acknowledgedSeqRef.current[kind] = acknowledged
      writeAcknowledgedSeq(kind, acknowledged)
      initializedByKindRef.current[kind] = true
      setAttention((current) => ({ ...current, [kind]: latest > acknowledged }))
    } else {
      setAttention((current) => ({
        ...current,
        [kind]: current[kind] || latest > acknowledgedSeqRef.current[kind],
      }))
      const notable = [...entries]
        .reverse()
        .find((event) => event.seq > previousLatest && activityKindForEvent(event) === kind)
      if (notable && notable.seq > freshSeqRef.current) {
        freshSeqRef.current = notable.seq
        freshKindRef.current = kind
        setFreshKind(kind)
        if (freshTimerRef.current != null) window.clearTimeout(freshTimerRef.current)
        freshTimerRef.current = window.setTimeout(() => {
          freshTimerRef.current = null
          freshKindRef.current = null
          setFreshKind(null)
        }, FRESH_MS)
      }
    }

    setPending((current) => ({
      ...current,
      [kind]: Math.min(PENDING_COUNT_CAP, entries
        .filter((event) => event.seq > acknowledgedSeqRef.current[kind]).length),
    }))
    setEventsByKind((current) => ({ ...current, [kind]: entries }))
  }, [])

  const refreshSource = useCallback(async (
    kind: OfficeActivityKind,
    query: () => Promise<AgentRuntimePage>,
  ) => {
    const lifecycleGeneration = lifecycleGenerationRef.current
    const request = ++issuedRequestRef.current[kind]
    try {
      const page = await query()
      if (lifecycleGeneration !== lifecycleGenerationRef.current
        || request < settledRequestRef.current[kind]) return
      settledRequestRef.current[kind] = request
      applyActivityPage(kind, page)
      updateSourceStatus(kind, 'ready')
    } catch {
      if (lifecycleGeneration !== lifecycleGenerationRef.current
        || request < settledRequestRef.current[kind]) return
      settledRequestRef.current[kind] = request
      updateSourceStatus(kind, 'error')
    }
  }, [applyActivityPage, updateSourceStatus])

  const refresh = useCallback(() => {
    const activityApi = api.productActivity ?? api.agentRuntime
    void refreshSource('agent', () => activityApi.query({
      page: 1,
      pageSize: PENDING_COUNT_CAP,
      types: [...OFFICE_AGENT_REVIEW_TYPES],
    }))
    void refreshSource('inbox', () => activityApi.query({
      page: 1,
      pageSize: PENDING_COUNT_CAP,
      family: 'inbox',
    }))
    void refreshSource('news', () => activityApi.query({
      page: 1,
      pageSize: PENDING_COUNT_CAP,
      family: 'news',
    }))
  }, [refreshSource])

  const acknowledgeThrough = useCallback((kind: OfficeActivityKind, requestedSeq: number) => {
    const latest = latestSeqRef.current[kind]
    const seq = Math.max(
      acknowledgedSeqRef.current[kind],
      Math.min(Math.max(0, requestedSeq), latest),
    )
    acknowledgedSeqRef.current[kind] = seq
    writeAcknowledgedSeq(kind, seq)
    const pendingCount = Math.min(PENDING_COUNT_CAP, entriesByKindRef.current[kind]
      .filter((event) => event.seq > seq).length)
    setAttention((current) => ({ ...current, [kind]: latest > seq }))
    setPending((current) => ({ ...current, [kind]: pendingCount }))
    if (freshKindRef.current === kind && latest <= seq) {
      freshKindRef.current = null
      setFreshKind(null)
      if (freshTimerRef.current != null) {
        window.clearTimeout(freshTimerRef.current)
        freshTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
    const poll = window.setInterval(() => void refresh(), POLL_MS)
    const refreshFromActivity = () => void refresh()
    window.addEventListener(GLOBAL_ACTIVITY_REFRESH_EVENT, refreshFromActivity)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener(GLOBAL_ACTIVITY_REFRESH_EVENT, refreshFromActivity)
      lifecycleGenerationRef.current += 1
      if (freshTimerRef.current != null) window.clearTimeout(freshTimerRef.current)
    }
  }, [refresh])

  const projected = useMemo(() => projectOfficeProductActivity(
    OFFICE_ACTIVITY_KINDS.flatMap((kind) => eventsByKind[kind]),
  ), [eventsByKind])
  return {
    ...projected,
    attention,
    pending,
    freshKind,
    agentSourceStatus,
    sourceStatus,
    acknowledgeThrough,
  }
}
