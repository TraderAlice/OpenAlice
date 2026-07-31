export type AgentConversationSource =
  | { kind: 'human' }
  | { kind: 'workspace'; workspaceId: string }
  | {
      kind: 'session'
      workspaceId: string
      resumeId: string
      agent: string
    }

export type AgentConversationTarget =
  | { kind: 'resume'; resumeId: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'harness'; harness: 'chat' | 'autoquant' }
  | { kind: 'inbox'; inboxEntryId: string; workspaceId?: string }
  | { kind: 'issue'; workspaceId: string; issueId: string; action?: string }
  | { kind: 'report'; workspaceId: string; path: string; revision?: string; action?: string }
  | { kind: 'trade-decision'; accountId: string; decisionId: string; workspaceId?: string }

export interface AgentConversationRecord {
  taskId: string
  parentTaskId?: string
  dispatchedAt: number
  completedAt?: number
  status: 'running' | 'done' | 'failed' | 'interrupted'
  source: AgentConversationSource
  target: {
    workspaceId: string
    resumeId: string
    agent: string
  }
  requestedTarget: AgentConversationTarget
  resolution: {
    mode: 'exact' | 'reconstructed'
    reason?: string
  }
  prompt: {
    original: string
    delivered: string
    mode: 'plain' | 'reconstruction'
  }
  assistantText: string | null
  durationMs?: number
  error?: string
}

export interface AgentConversationQueryResult {
  entries: AgentConversationRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const agentConversationsApi = {
  async query(opts: { page?: number; pageSize?: number } = {}): Promise<AgentConversationQueryResult> {
    const params = new URLSearchParams()
    if (opts.page) params.set('page', String(opts.page))
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize))
    const query = params.toString()
    const response = await fetch(`/api/agent-conversations${query ? `?${query}` : ''}`)
    if (!response.ok) throw new Error('Failed to query Agent conversations')
    return response.json()
  },
}
