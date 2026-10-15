import { fetchJson, headers } from './client'

export type { AgentRuntimeEventType, AgentRuntimeCause, AgentRuntimePayload, AgentRuntimeEvent, AgentRuntimePage, AgentRuntimeSurface } from '../../../apps/desktop/src/activity-journal-types'
import type { AgentRuntimeEventType, AgentRuntimePage } from '../../../apps/desktop/src/activity-journal-types'

export const agentRuntimeLogApi = {
  async query(opts: {
    page?: number
    pageSize?: number
    afterSeq?: number
    limit?: number
    type?: AgentRuntimeEventType
    types?: AgentRuntimeEventType[]
    family?: string
  } = {}): Promise<AgentRuntimePage> {
    const params = new URLSearchParams()
    if (opts.afterSeq !== undefined) params.set('afterSeq', String(opts.afterSeq))
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.page) params.set('page', String(opts.page))
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize))
    if (opts.type) params.set('type', opts.type)
    if (opts.types?.length) params.set('types', opts.types.join(','))
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
  async triggerProductActivityTest(family: 'inbox' | 'news', preview?: 'image' | 'plain' | 'grouped' | 'broken'): Promise<void> {
    await fetchJson('/api/agent-runtime/product-test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ family, ...(preview ? { preview } : {}) }),
    })
  },
}

/** Product name; the older export remains for compatibility. */
export const productActivityJournalApi = agentRuntimeLogApi
