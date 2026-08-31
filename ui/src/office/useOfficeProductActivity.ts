import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import { GLOBAL_ACTIVITY_REFRESH_EVENT } from '../hooks/useGlobalAgentActivity'
import { officeActivityExcerpt } from './activity-text'

const POLL_MS = 4_000
const FRESH_MS = 12_000
const PENDING_COUNT_CAP = 9
const ACK_STORAGE_PREFIX = 'openalice:office-product-activity:ack:'
const OFFICE_ACTIVITY_KINDS = ['agent', 'inbox', 'news'] as const
export type OfficeActivityKind = typeof OFFICE_ACTIVITY_KINDS[number]

const OFFICE_AGENT_MILESTONE_TYPES = [
  'session.born',
  'runtime.started',
  'runtime.spawn_failed',
  'runtime.stopped',
  'runtime.rejected',
  'runtime.turn.error',
  'dev.sonner_test',
] as const satisfies readonly AgentRuntimeEvent['type'][]
const OFFICE_AGENT_MILESTONE_TYPE_SET = new Set<AgentRuntimeEvent['type']>(
  OFFICE_AGENT_MILESTONE_TYPES,
)

export interface OfficeActivityLandmark {
  readonly seq: number
  readonly occurredAt: number
  readonly detail?: string
  readonly source?: string
  readonly inboxEntryId?: string
  readonly eventType?: AgentRuntimeEvent['type']
  readonly status?: AgentRuntimeEvent['payload']['status']
}

export interface OfficeProductActivityState {
  readonly agent: OfficeActivityLandmark | null
  readonly inbox: OfficeActivityLandmark | null
  readonly news: OfficeActivityLandmark | null
  readonly attention: Readonly<Record<OfficeActivityKind, boolean>>
  readonly pending: Readonly<Record<OfficeActivityKind, number>>
  readonly freshKind: OfficeActivityKind | null
}

export interface OfficeProductActivity extends OfficeProductActivityState {
  acknowledge(kind: OfficeActivityKind): void
}

export function projectOfficeProductActivity(
  events: readonly AgentRuntimeEvent[],
): Pick<OfficeProductActivityState, 'agent' | 'inbox' | 'news'> {
  const ordered = [...events].sort((a, b) => b.seq - a.seq)
  const agent = ordered.find((event) => OFFICE_AGENT_MILESTONE_TYPE_SET.has(event.type))
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
        }
      : null,
    inbox: inbox
      ? {
          seq: inbox.seq,
          occurredAt: inbox.ts,
          detail: officeActivityExcerpt(inbox.payload.summary),
          source: inbox.payload.agent ?? inbox.payload.workspaceLabel,
          inboxEntryId: inbox.payload.inboxEntryId,
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
  return OFFICE_AGENT_MILESTONE_TYPE_SET.has(event.type) ? 'agent' : null
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
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([])
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
  const initializedRef = useRef(false)
  const freshTimerRef = useRef<number | null>(null)
  const freshKindRef = useRef<OfficeActivityKind | null>(null)
  const acknowledgedSeqRef = useRef<Record<OfficeActivityKind, number>>({ agent: 0, inbox: 0, news: 0 })
  const latestSeqRef = useRef<Record<OfficeActivityKind, number>>({ agent: 0, inbox: 0, news: 0 })

  const refresh = useCallback(async () => {
    const activityApi = api.productActivity ?? api.agentRuntime
    const pages = await Promise.all([
      activityApi.query({ page: 1, pageSize: PENDING_COUNT_CAP, types: [...OFFICE_AGENT_MILESTONE_TYPES] }),
      activityApi.query({ page: 1, pageSize: PENDING_COUNT_CAP, family: 'inbox' }),
      activityApi.query({ page: 1, pageSize: PENDING_COUNT_CAP, family: 'news' }),
    ]).catch(() => null)
    if (!pages) return
    const nextEvents = pages.flatMap((page) => page.entries).sort((a, b) => a.seq - b.seq)
    const journalLastSeq = Math.max(0, ...pages.map((page) => page.lastSeq))
    const previousLatest = { ...latestSeqRef.current }
    const nextProjected = projectOfficeProductActivity(nextEvents)
    latestSeqRef.current = {
      agent: nextProjected.agent?.seq ?? 0,
      inbox: nextProjected.inbox?.seq ?? 0,
      news: nextProjected.news?.seq ?? 0,
    }
    const entriesByKind: Record<OfficeActivityKind, readonly AgentRuntimeEvent[]> = {
      agent: pages[0].entries,
      inbox: pages[1].entries,
      news: pages[2].entries,
    }

    if (!initializedRef.current) {
      const nextAttention = { agent: false, inbox: false, news: false }
      for (const kind of OFFICE_ACTIVITY_KINDS) {
        const stored = readAcknowledgedSeq(kind)
        const latest = latestSeqRef.current[kind]
        const acknowledged = stored == null || stored > journalLastSeq ? latest : stored
        acknowledgedSeqRef.current[kind] = acknowledged
        writeAcknowledgedSeq(kind, acknowledged)
        nextAttention[kind] = latest > acknowledged
      }
      setAttention(nextAttention)
    } else {
      setAttention((current) => ({
        agent: current.agent
          || latestSeqRef.current.agent > acknowledgedSeqRef.current.agent,
        inbox: current.inbox
          || latestSeqRef.current.inbox > acknowledgedSeqRef.current.inbox,
        news: current.news
          || latestSeqRef.current.news > acknowledgedSeqRef.current.news,
      }))
      const notable = [...nextEvents]
        .reverse()
        .find((event) => {
          const kind = activityKindForEvent(event)
          return kind != null && event.seq > previousLatest[kind]
        })
      if (notable) {
        const nextFreshKind = activityKindForEvent(notable) as OfficeActivityKind
        freshKindRef.current = nextFreshKind
        setFreshKind(nextFreshKind)
        if (freshTimerRef.current != null) window.clearTimeout(freshTimerRef.current)
        freshTimerRef.current = window.setTimeout(() => {
          freshTimerRef.current = null
          freshKindRef.current = null
          setFreshKind(null)
        }, FRESH_MS)
      }
    }

    setPending({
      agent: Math.min(PENDING_COUNT_CAP, entriesByKind.agent
        .filter((event) => event.seq > acknowledgedSeqRef.current.agent).length),
      inbox: Math.min(PENDING_COUNT_CAP, entriesByKind.inbox
        .filter((event) => event.seq > acknowledgedSeqRef.current.inbox).length),
      news: Math.min(PENDING_COUNT_CAP, entriesByKind.news
        .filter((event) => event.seq > acknowledgedSeqRef.current.news).length),
    })

    setEvents(nextEvents)
    initializedRef.current = true
  }, [])

  const acknowledge = useCallback((kind: OfficeActivityKind) => {
    const seq = latestSeqRef.current[kind]
    acknowledgedSeqRef.current[kind] = seq
    writeAcknowledgedSeq(kind, seq)
    setAttention((current) => ({ ...current, [kind]: false }))
    setPending((current) => ({ ...current, [kind]: 0 }))
    if (freshKindRef.current === kind) {
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
      if (freshTimerRef.current != null) window.clearTimeout(freshTimerRef.current)
    }
  }, [refresh])

  const projected = useMemo(() => projectOfficeProductActivity(events), [events])
  return { ...projected, attention, pending, freshKind, acknowledge }
}
