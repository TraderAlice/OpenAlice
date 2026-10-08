import { fetchJson, headers } from './client'
import type { InstalledModule, ModuleStatus, NewsCollectorCollectResult, NewsCollectorStatusResponse, NewsListResponse, NewsModuleArtifact, RssHubKeyStatus } from './types'

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

  async getCollectorStatus(signal?: AbortSignal): Promise<NewsCollectorStatusResponse> {
    return fetchJson<NewsCollectorStatusResponse>('/api/news/collector', signal ? { signal } : undefined)
  },

  async collect(signal?: AbortSignal): Promise<NewsCollectorCollectResult> {
    return fetchJson<NewsCollectorCollectResult>('/api/news/collect', { method: 'POST', signal })
  },

  async getModules(signal?: AbortSignal): Promise<{ modules: ModuleStatus[] }> {
    return fetchJson('/api/news/modules', signal ? { signal } : undefined)
  },

  async importModule(artifact: NewsModuleArtifact, signal?: AbortSignal): Promise<InstalledModule> {
    return fetchJson('/api/news/modules', { method: 'POST', headers, body: JSON.stringify({ artifact }), signal })
  },

  async approveModule(hash: string, signal?: AbortSignal): Promise<InstalledModule> {
    return fetchJson(`/api/news/modules/${encodeURIComponent(hash)}/approve`, { method: 'POST', signal })
  },

  async retryModule(hash: string, signal?: AbortSignal): Promise<{ modules: ModuleStatus[] }> {
    return fetchJson(`/api/news/modules/${encodeURIComponent(hash)}/retry`, { method: 'POST', signal })
  },

  async uninstallModule(hash: string, signal?: AbortSignal): Promise<{ ok: true }> {
    return fetchJson(`/api/news/modules/${encodeURIComponent(hash)}`, { method: 'DELETE', signal })
  },

  async getRssHubKeyStatus(signal?: AbortSignal): Promise<RssHubKeyStatus> {
    return fetchJson('/api/news/rsshub-key', signal ? { signal } : undefined)
  },

  async updateRssHubKey(operation: 'set' | 'clear', key?: string, signal?: AbortSignal): Promise<RssHubKeyStatus> {
    return fetchJson('/api/news/rsshub-key', { method: 'PUT', headers, body: JSON.stringify({ operation, key }), signal })
  },
}
