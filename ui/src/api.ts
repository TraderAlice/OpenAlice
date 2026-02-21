// API client — all fetch calls to the backend.
// In dev mode, Vite proxies /api to the backend.
// In production, same-origin.

export interface ChatMessage {
  role: 'user' | 'assistant' | 'notification'
  text: string
  timestamp?: number | null
}

export interface ChatResponse {
  text: string
  media: Array<{ type: 'image'; url: string }>
}

export interface AppConfig {
  aiProvider: string
  engine: Record<string, unknown>
  model: { provider: string; model: string }
  agent: { evolutionMode: boolean; claudeCode: Record<string, unknown> }
  compaction: { maxContextTokens: number; maxOutputTokens: number }
  heartbeat: { enabled: boolean; every: string; prompt: string }
  [key: string]: unknown
}

// ==================== Event Log Types ====================

export interface EventLogEntry {
  seq: number
  ts: number
  type: string
  payload: unknown
}

// ==================== Cron Types ====================

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; every: string }
  | { kind: 'cron'; cron: string }

export interface CronJobState {
  nextRunAtMs: number | null
  lastRunAtMs: number | null
  lastStatus: 'ok' | 'error' | null
  consecutiveErrors: number
}

export interface CronJob {
  id: string
  name: string
  enabled: boolean
  schedule: CronSchedule
  payload: string
  state: CronJobState
  createdAt: number
}

const headers = { 'Content-Type': 'application/json' }

export const api = {
  chat: {
    async send(message: string): Promise<ChatResponse> {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || res.statusText)
      }
      return res.json()
    },

    async history(limit = 100): Promise<{ messages: ChatMessage[] }> {
      const res = await fetch(`/api/chat/history?limit=${limit}`)
      if (!res.ok) throw new Error('Failed to load history')
      return res.json()
    },

    connectSSE(onMessage: (data: { type: string; text: string }) => void): EventSource {
      const es = new EventSource('/api/chat/events')
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          onMessage(data)
        } catch { /* ignore */ }
      }
      return es
    },
  },

  config: {
    async load(): Promise<AppConfig> {
      const res = await fetch('/api/config')
      if (!res.ok) throw new Error('Failed to load config')
      return res.json()
    },

    async setProvider(provider: string): Promise<void> {
      const res = await fetch('/api/config/ai-provider', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) throw new Error('Failed to switch provider')
    },

    async updateSection(section: string, data: unknown): Promise<unknown> {
      const res = await fetch(`/api/config/${section}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Save failed' }))
        throw new Error(err.error || 'Save failed')
      }
      return res.json()
    },
  },

  events: {
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
  },

  cron: {
    async list(): Promise<{ jobs: CronJob[] }> {
      const res = await fetch('/api/cron/jobs')
      if (!res.ok) throw new Error('Failed to load cron jobs')
      return res.json()
    },

    async add(params: { name: string; payload: string; schedule: CronSchedule; enabled?: boolean }): Promise<{ id: string }> {
      const res = await fetch('/api/cron/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Create failed' }))
        throw new Error(err.error || 'Create failed')
      }
      return res.json()
    },

    async update(id: string, patch: Partial<{ name: string; payload: string; schedule: CronSchedule; enabled: boolean }>): Promise<void> {
      const res = await fetch(`/api/cron/jobs/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Update failed' }))
        throw new Error(err.error || 'Update failed')
      }
    },

    async remove(id: string): Promise<void> {
      const res = await fetch(`/api/cron/jobs/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Delete failed' }))
        throw new Error(err.error || 'Delete failed')
      }
    },

    async runNow(id: string): Promise<void> {
      const res = await fetch(`/api/cron/jobs/${id}/run`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Run failed' }))
        throw new Error(err.error || 'Run failed')
      }
    },
  },

  heartbeat: {
    async status(): Promise<{ enabled: boolean }> {
      const res = await fetch('/api/heartbeat/status')
      if (!res.ok) throw new Error('Failed to get heartbeat status')
      return res.json()
    },

    async trigger(): Promise<void> {
      const res = await fetch('/api/heartbeat/trigger', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Trigger failed' }))
        throw new Error(err.error || 'Trigger failed')
      }
    },

    async setEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
      const res = await fetch('/api/heartbeat/enabled', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Update failed' }))
        throw new Error(err.error || 'Update failed')
      }
      return res.json()
    },
  },
}
