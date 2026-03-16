import type { ToolCallRecord } from './types'

export interface ToolCallQueryResult {
  entries: ToolCallRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const agentStatusApi = {
  async query(opts: { page?: number; pageSize?: number; name?: string } = {}): Promise<ToolCallQueryResult> {
    const params = new URLSearchParams()
    if (opts.page) params.set('page', String(opts.page))
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize))
    if (opts.name) params.set('name', opts.name)
    const qs = params.toString()
    const res = await fetch(`/api/agent-status${qs ? `?${qs}` : ''}`)
    if (!res.ok) throw new Error('Failed to query tool calls')
    return res.json()
  },

  async recent(opts: { afterSeq?: number; limit?: number; name?: string } = {}): Promise<{ entries: ToolCallRecord[]; lastSeq: number }> {
    const params = new URLSearchParams()
    if (opts.afterSeq) params.set('afterSeq', String(opts.afterSeq))
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.name) params.set('name', opts.name)
    const qs = params.toString()
    const res = await fetch(`/api/agent-status/recent${qs ? `?${qs}` : ''}`)
    if (!res.ok) throw new Error('Failed to load tool calls')
    return res.json()
  },
}
