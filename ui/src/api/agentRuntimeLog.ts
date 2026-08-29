import { fetchJson, headers } from './client'

export type AgentRuntimeEventType =
  | 'session.born'
  | 'runtime.started'
  | 'runtime.spawn_failed'
  | 'runtime.stopped'
  | 'runtime.rejected'
  | 'runtime.turn.text'
  | 'runtime.turn.tool'
  | 'runtime.turn.error'
  | 'dev.sonner_test'
  | 'inbox.received'
  | 'news.ingested'

export type AgentRuntimeSurface = 'terminal' | 'webpi' | 'headless'

export type AgentRuntimeCause =
  | { kind: 'issue'; workspaceId: string; issueId: string }
  | {
      kind: 'conversation'
      from?: {
        kind: 'session' | 'workspace' | 'human'
        resumeId?: string
        workspaceId?: string
        agent?: string
      }
      resolution?: 'exact' | 'reconstructed'
    }
  | { kind: 'ui' }
  | { kind: 'http' }

export interface AgentRuntimePayload {
  workspaceId?: string
  resumeId?: string
  agent?: string
  sessionRecordId?: string
  taskId?: string
  surface?: AgentRuntimeSurface
  cause?: AgentRuntimeCause
  status?: 'done' | 'failed' | 'interrupted' | 'paused'
  launchErrorCode?: string
  reason?: string
  error?: string
  exitCode?: number | null
  text?: string
  toolId?: string
  toolName?: string
  toolStatus?: 'running' | 'completed' | 'failed'
  message?: string
  assistantText?: string
  metrics?: {
    textBlocks: number
    toolCalls: number
    toolFailures: number
  }
  truncated?: boolean
  testState?: 'running' | 'success' | 'error'
  inboxEntryId?: string
  workspaceLabel?: string
  originKind?: 'headless' | 'interactive' | 'manual'
  summary?: string
  documentCount?: number
  newsItemId?: number
  dedupKey?: string
  title?: string
  source?: string
  link?: string
  publishedAt?: number
  ingestSource?: string
}

export interface AgentRuntimeEvent {
  seq: number
  ts: number
  type: AgentRuntimeEventType
  causedBy?: number
  payload: AgentRuntimePayload
}

export interface AgentRuntimePage {
  entries: AgentRuntimeEvent[]
  lastSeq: number
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
}

export const agentRuntimeLogApi = {
  async query(opts: {
    page?: number
    pageSize?: number
    afterSeq?: number
    limit?: number
    type?: AgentRuntimeEventType
    family?: string
  } = {}): Promise<AgentRuntimePage> {
    const params = new URLSearchParams()
    if (opts.afterSeq !== undefined) params.set('afterSeq', String(opts.afterSeq))
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.page) params.set('page', String(opts.page))
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize))
    if (opts.type) params.set('type', opts.type)
    if (opts.family) params.set('family', opts.family)
    const qs = params.toString()
    return fetchJson<AgentRuntimePage>(`/api/agent-runtime${qs ? `?${qs}` : ''}`)
  },
  async triggerSonnerTest(state: 'running' | 'success' | 'error'): Promise<void> {
    await fetchJson('/api/agent-runtime/sonner-test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ state }),
    })
  },
  async triggerProductActivityTest(family: 'inbox' | 'news'): Promise<void> {
    await fetchJson('/api/agent-runtime/product-test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ family }),
    })
  },
}

/** Product name; the older export remains for compatibility. */
export const productActivityJournalApi = agentRuntimeLogApi
