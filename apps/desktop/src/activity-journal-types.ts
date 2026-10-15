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
  image?: string
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
