import { fetchJson } from './client'
import type { NewsListResponse } from './types'

export const newsApi = {
  async list(params?: { lookback?: string; limit?: number; source?: string }): Promise<NewsListResponse> {
    const qs = new URLSearchParams()
    if (params?.lookback) qs.set('lookback', params.lookback)
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.source) qs.set('source', params.source)
    return fetchJson(`/api/news?${qs}`)
  },
}
