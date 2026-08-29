import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import { GLOBAL_ACTIVITY_REFRESH_EVENT } from '../hooks/useGlobalAgentActivity'

const POLL_MS = 4_000
const EVENT_LIMIT = 100
const FRESH_MS = 12_000
const ACK_STORAGE_PREFIX = 'openalice:office-product-activity:ack:'
type OfficeActivityKind = 'inbox' | 'news'

export interface OfficeActivityLandmark {
  readonly seq: number
  readonly occurredAt: number
  readonly detail?: string
  readonly source?: string
  readonly inboxEntryId?: string
}

export interface OfficeProductActivityState {
  readonly inbox: OfficeActivityLandmark | null
  readonly news: OfficeActivityLandmark | null
  readonly attention: Readonly<Record<OfficeActivityKind, boolean>>
  readonly freshKind: 'inbox' | 'news' | null
}

export interface OfficeProductActivity extends OfficeProductActivityState {
  acknowledge(kind: OfficeActivityKind): void
}

export function projectOfficeProductActivity(
  events: readonly AgentRuntimeEvent[],
): Pick<OfficeProductActivityState, 'inbox' | 'news'> {
  const ordered = [...events].sort((a, b) => b.seq - a.seq)
  const inbox = ordered.find((event) => event.type === 'inbox.received')
  const news = ordered.find((event) => event.type === 'news.ingested')

  return {
    inbox: inbox
      ? {
          seq: inbox.seq,
          occurredAt: inbox.ts,
          detail: inbox.payload.summary,
          source: inbox.payload.agent ?? inbox.payload.workspaceLabel,
          inboxEntryId: inbox.payload.inboxEntryId,
        }
      : null,
    news: news
      ? {
          seq: news.seq,
          occurredAt: news.ts,
          detail: news.payload.title,
          source: news.payload.source,
        }
      : null,
  }
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
  const [freshKind, setFreshKind] = useState<'inbox' | 'news' | null>(null)
  const [attention, setAttention] = useState<Record<OfficeActivityKind, boolean>>({
    inbox: false,
    news: false,
  })
  const initializedRef = useRef(false)
  const cursorRef = useRef(0)
  const freshTimerRef = useRef<number | null>(null)
  const freshKindRef = useRef<OfficeActivityKind | null>(null)
  const eventsRef = useRef<AgentRuntimeEvent[]>([])
  const acknowledgedSeqRef = useRef<Record<OfficeActivityKind, number>>({ inbox: 0, news: 0 })
  const latestSeqRef = useRef<Record<OfficeActivityKind, number>>({ inbox: 0, news: 0 })

  const refresh = useCallback(async () => {
    const activityApi = api.productActivity ?? api.agentRuntime
    const result = await (initializedRef.current
      ? activityApi.query({ afterSeq: cursorRef.current, limit: EVENT_LIMIT })
      : activityApi.query({ page: 1, pageSize: EVENT_LIMIT })).catch(() => null)
    if (!result) return
    const incoming = [...result.entries].sort((a, b) => a.seq - b.seq)
    const bySeq = new Map(eventsRef.current.map((event) => [event.seq, event]))
    for (const event of incoming) bySeq.set(event.seq, event)
    const nextEvents = [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-EVENT_LIMIT)
    const nextProjected = projectOfficeProductActivity(nextEvents)
    latestSeqRef.current = {
      inbox: nextProjected.inbox?.seq ?? 0,
      news: nextProjected.news?.seq ?? 0,
    }

    if (!initializedRef.current) {
      const nextAttention = { inbox: false, news: false }
      for (const kind of ['inbox', 'news'] as const) {
        const stored = readAcknowledgedSeq(kind)
        const latest = latestSeqRef.current[kind]
        const acknowledged = stored == null || stored > result.lastSeq ? latest : stored
        acknowledgedSeqRef.current[kind] = acknowledged
        writeAcknowledgedSeq(kind, acknowledged)
        nextAttention[kind] = latest > acknowledged
      }
      setAttention(nextAttention)
    } else {
      setAttention((current) => ({
        inbox: current.inbox
          || latestSeqRef.current.inbox > acknowledgedSeqRef.current.inbox,
        news: current.news
          || latestSeqRef.current.news > acknowledgedSeqRef.current.news,
      }))
      const notable = [...incoming]
        .reverse()
        .find((event) => event.type === 'inbox.received' || event.type === 'news.ingested')
      if (notable) {
        const nextFreshKind = notable.type === 'inbox.received' ? 'inbox' : 'news'
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

    eventsRef.current = nextEvents
    setEvents(nextEvents)
    cursorRef.current = Math.max(cursorRef.current, result.lastSeq, ...incoming.map((event) => event.seq))
    initializedRef.current = true
  }, [])

  const acknowledge = useCallback((kind: OfficeActivityKind) => {
    const seq = latestSeqRef.current[kind]
    acknowledgedSeqRef.current[kind] = seq
    writeAcknowledgedSeq(kind, seq)
    setAttention((current) => ({ ...current, [kind]: false }))
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
  return { ...projected, attention, freshKind, acknowledge }
}
