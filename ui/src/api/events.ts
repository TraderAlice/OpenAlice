import type { EventLogEntry } from './types'

export interface EventQueryResult {
  entries: EventLogEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const eventsApi = {
  async query(opts: { page?: number; pageSize?: number; type?: string } = {}): Promise<EventQueryResult> {
    const params = new URLSearchParams()
    if (opts.page) params.set('page', String(opts.page))
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize))
    if (opts.type) params.set('type', opts.type)
    const qs = params.toString()
    const res = await fetch(`/api/events${qs ? `?${qs}` : ''}`)
    if (!res.ok) throw new Error('Failed to query events')
    return res.json()
  },

  async recent(opts: { afterSeq?: number; limit?: number; type?: string } = {}): Promise<{ entries: EventLogEntry[]; lastSeq: number }> {
    const params = new URLSearchParams()
    if (opts.afterSeq) params.set('afterSeq', String(opts.afterSeq))
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.type) params.set('type', opts.type)
    const qs = params.toString()
    const res = await fetch(`/api/events/recent${qs ? `?${qs}` : ''}`)
    if (!res.ok) throw new Error('Failed to load events')
    return res.json()
  },

  connectSSE(onEvent: (entry: EventLogEntry) => void): EventSource {
    const es = new EventSource('/api/events/stream')
    es.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data)
        onEvent(entry)
      } catch { /* ignore */ }
    }
    return es
  },
}
