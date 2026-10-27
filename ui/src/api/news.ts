import { fetchJson, headers } from './client'
import type { InstalledModule, ModuleStatus, NewsCollectorCollectResult, NewsCollectorStatusResponse, NewsListResponse, NewsModuleArtifact, NewsModuleCredential, RssHubKeyStatus, NewsReadStatus, NewsReaderPatch, NewsReaderState, NewsStoryDetail, NewsStoryPreview } from './types'

export interface NewsQuery {
  country?: string
  industry?: string
  asset?: string
  eventId?: string
  readStatus?: NewsReadStatus
  includeStories?: boolean
  readingView?: 'selected' | 'events'
  storyTopics?: string
  storyOffset?: number
  storyOrder?: 'recent' | 'heat' | 'relevance'
  bookmarked?: boolean
  important?: boolean
  lookback?: string
  limit?: number
  source?: string
  startTime?: string
  endTime?: string
  keyword?: string
  symbol?: string
  categories?: string
}

export interface NewsAutomation {
  workspaces: Array<{ id: string; tag: string }>
  automations: Array<{ workspaceId: string; issueId: string; status: string; enabled: boolean; scheduled: boolean }>
}
export interface NewsProcessing {
  items: Array<Omit<import('./types').NewsStoryDetail['reports'][number], 'content' | 'image' | 'quote' | 'media'> & { processing?: { status: 'pending' | 'review' | 'failed'; reason: string; attempts: number; retryAt?: number } }>
  counts: { pending: number; review: number; failed: number; ready: number }
  nextOffset: number | null
}

export const newsApi = {
  followedTopics(signal?: AbortSignal): Promise<{ topics: string[] }> {
    return fetchJson('/api/news/following/topics', { signal })
  },
  setTopicFollow(topic: string, following: boolean): Promise<{ topics: string[] }> {
    return fetchJson('/api/news/following/topics', { method: 'PUT', headers, body: JSON.stringify({ topic, following }) })
  },
  async list(params?: NewsQuery, signal?: AbortSignal): Promise<NewsListResponse> {
    const qs = new URLSearchParams()
    if (params?.country) qs.set('country', params.country)
    if (params?.industry) qs.set('industry', params.industry)
    if (params?.asset) qs.set('asset', params.asset)
    if (params?.eventId) qs.set('eventId', params.eventId)
    if (params?.includeStories) qs.set('includeStories', 'true')
    if (params?.readStatus) qs.set('readStatus', params.readStatus)
    if (params?.readingView) qs.set('readingView', params.readingView)
    if (params?.storyTopics) qs.set('storyTopics', params.storyTopics)
    if (params?.storyOffset) qs.set('storyOffset', String(params.storyOffset))
    if (params?.storyOrder) qs.set('storyOrder', params.storyOrder)
    if (params?.bookmarked) qs.set('bookmarked', 'true')
    if (params?.important) qs.set('important', 'true')
    if (params?.lookback) qs.set('lookback', params.lookback)
    if (params?.limit != null) qs.set('limit', String(params.limit))
    // Publisher names may contain commas; the legacy source field is a CSV list.
    if (params?.source) qs.set('sourceExact', params.source)
    if (params?.startTime) qs.set('startTime', params.startTime)
    if (params?.endTime) qs.set('endTime', params.endTime)
    if (params?.keyword) qs.set('keyword', params.keyword)
    if (params?.symbol) qs.set('symbol', params.symbol)
    if (params?.categories) qs.set('categories', params.categories)
    const query = qs.toString()
    return fetchJson(`/api/news${query ? `?${query}` : ''}`, signal ? { signal } : undefined)
  },

  async getStory(id: string, signal?: AbortSignal): Promise<NewsStoryDetail> {
    return fetchJson(`/api/news/stories/${encodeURIComponent(id)}`, signal ? { signal } : undefined)
  },

  async getRelatedStories(id: string, signal?: AbortSignal): Promise<NewsStoryPreview[]> {
    const result = await fetchJson<{ stories: NewsStoryPreview[] }>(`/api/news/stories?${new URLSearchParams({ relatedTo: id })}`, signal ? { signal } : undefined)
    return result.stories.slice(0, 5)
  },
  setReader(id: string, patch: NewsReaderPatch): Promise<NewsReaderState> {
    return fetchJson(`/api/news/stories/${encodeURIComponent(id)}/reader`, { method: 'PATCH', headers, body: JSON.stringify(patch) })
  },
  getProcessing(status: 'pending' | 'review' | 'failed' = 'pending', offset = 0, signal?: AbortSignal): Promise<NewsProcessing> {
    return fetchJson(`/api/news/processing?status=${status}&offset=${offset}`, { signal })
  },
  getOriginal(id: number, signal?: AbortSignal): Promise<NewsStoryDetail['reports'][number]> {
    return fetchJson(`/api/news/processing/${id}`, { signal })
  },
  retryReport(id: number, note = ''): Promise<unknown> {
    return fetchJson(`/api/news/processing/${id}/retry`, { method: 'POST', headers, body: JSON.stringify({ note }) })
  },
  getAutomation(signal?: AbortSignal): Promise<NewsAutomation> {
    return fetchJson('/api/news/automation', { signal })
  },
  setAutomation(workspaceId: string, enabled: boolean): Promise<NewsAutomation> {
    return fetchJson('/api/news/automation', { method: 'PUT', headers, body: JSON.stringify({ workspaceId, enabled }) })
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

  async getModuleCredentials(hash: string, signal?: AbortSignal): Promise<{ credentials: NewsModuleCredential[] }> {
    return fetchJson(`/api/news/modules/${encodeURIComponent(hash)}/credentials`, { signal })
  },
  async updateModuleCredential(hash: string, key: string, operation: 'set' | 'clear', value?: string): Promise<{ credentials: NewsModuleCredential[] }> {
    return fetchJson(`/api/news/modules/${encodeURIComponent(hash)}/credentials`, { method: 'PUT', headers, body: JSON.stringify({ key, operation, ...(operation === 'set' ? { value } : {}) }) })
  },

  async updateRssHubKey(operation: 'set' | 'clear', key?: string, signal?: AbortSignal): Promise<RssHubKeyStatus> {
    return fetchJson('/api/news/rsshub-key', { method: 'PUT', headers, body: JSON.stringify({ operation, key }), signal })
  },
}
