import { fetchJson } from './client'
import type { NewsListResponse } from './types'

export interface NewsQuery {
  lookback?: string
  limit?: number
  source?: string
  startTime?: string
  endTime?: string
  keyword?: string
  symbol?: string
}

export const newsApi = {
  async list(params?: NewsQuery, signal?: AbortSignal): Promise<NewsListResponse> {
    const qs = new URLSearchParams()
    if (params?.lookback) qs.set('lookback', params.lookback)
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.source) qs.set('source', params.source)
    if (params?.startTime) qs.set('startTime', params.startTime)
    if (params?.endTime) qs.set('endTime', params.endTime)
    if (params?.keyword) qs.set('keyword', params.keyword)
    if (params?.symbol) qs.set('symbol', params.symbol)
    const query = qs.toString()
    return fetchJson(`/api/news${query ? `?${query}` : ''}`, signal ? { signal } : undefined)
  },
}
