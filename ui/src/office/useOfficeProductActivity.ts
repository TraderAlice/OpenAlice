import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import { GLOBAL_ACTIVITY_REFRESH_EVENT } from '../hooks/useGlobalAgentActivity'

const POLL_MS = 4_000
const EVENT_LIMIT = 100
const FRESH_MS = 12_000

export interface OfficeActivityLandmark {
  readonly seq: number
  readonly occurredAt: number
  readonly detail?: string
  readonly source?: string
  readonly inboxEntryId?: string
}

export interface OfficeProductActivity {
  readonly inbox: OfficeActivityLandmark | null
  readonly news: OfficeActivityLandmark | null
  readonly freshKind: 'inbox' | 'news' | null
}

export function projectOfficeProductActivity(
  events: readonly AgentRuntimeEvent[],
): Omit<OfficeProductActivity, 'freshKind'> {
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

/** Office-specific projection: persistent landmark copy plus a short new-event lamp. */
export function useOfficeProductActivity(): OfficeProductActivity {
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([])
  const [freshKind, setFreshKind] = useState<'inbox' | 'news' | null>(null)
  const initializedRef = useRef(false)
  const cursorRef = useRef(0)
  const freshTimerRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    const activityApi = api.productActivity ?? api.agentRuntime
    const result = await (initializedRef.current
      ? activityApi.query({ afterSeq: cursorRef.current, limit: EVENT_LIMIT })
      : activityApi.query({ page: 1, pageSize: EVENT_LIMIT })).catch(() => null)
    if (!result) return
    const incoming = [...result.entries].sort((a, b) => a.seq - b.seq)

    if (initializedRef.current) {
      const notable = [...incoming]
        .reverse()
        .find((event) => event.type === 'inbox.received' || event.type === 'news.ingested')
      if (notable) {
        setFreshKind(notable.type === 'inbox.received' ? 'inbox' : 'news')
        if (freshTimerRef.current != null) window.clearTimeout(freshTimerRef.current)
        freshTimerRef.current = window.setTimeout(() => {
          freshTimerRef.current = null
          setFreshKind(null)
        }, FRESH_MS)
      }
    }

    setEvents((current) => {
      const bySeq = new Map(current.map((event) => [event.seq, event]))
      for (const event of incoming) bySeq.set(event.seq, event)
      return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-EVENT_LIMIT)
    })
    cursorRef.current = Math.max(cursorRef.current, result.lastSeq, ...incoming.map((event) => event.seq))
    initializedRef.current = true
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
  return { ...projected, freshKind }
}
