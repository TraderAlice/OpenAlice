import { afterEach, expect, it, vi } from 'vitest'
import { newsApi } from './news'
afterEach(() => vi.unstubAllGlobals())
it('sends reading status alongside existing event filters and pagination', async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ items: [], count: 0 }))
  vi.stubGlobal('fetch', fetch)
  await newsApi.list({ includeStories: true, readStatus: 'updated', bookmarked: true, storyOffset: 50 })
  const [url] = fetch.mock.calls[0]
  const params = new URL(url, 'http://localhost').searchParams
  expect(params.get('readStatus')).toBe('updated')
  expect(params.get('bookmarked')).toBe('true')
  expect(params.get('storyOffset')).toBe('50')
})
it('sends an exact read revision or explicit clearing and fetches bounded related previews with cancellation', async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ stories: [] }))
  vi.stubGlobal('fetch', fetch)
  await newsApi.setReader('policy', { readRevision: 3 })
  expect(fetch).toHaveBeenLastCalledWith('/api/news/stories/policy/reader', expect.objectContaining({ method: 'PATCH', body: '{"readRevision":3}' }))
  await newsApi.setReader('policy', { readRevision: null })
  expect(fetch).toHaveBeenLastCalledWith('/api/news/stories/policy/reader', expect.objectContaining({ body: '{"readRevision":null}' }))
  const controller = new AbortController()
  expect(await newsApi.getRelatedStories('policy', controller.signal)).toEqual([])
  expect(fetch).toHaveBeenLastCalledWith('/api/news/stories?relatedTo=policy', { signal: controller.signal })
})
it('sends server-side heat, topics and persistent-bookmark filters together', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ items: [], count: 0, lookback: '24h' }))
  vi.stubGlobal('fetch', fetch)
  await newsApi.list({ includeStories: true, storyOrder: 'heat', storyTopics: 'shipping', bookmarked: true })
  expect(fetch).toHaveBeenCalledWith('/api/news?includeStories=true&storyTopics=shipping&storyOrder=heat&bookmarked=true', undefined)
})
it('sends one literal publisher name rather than a comma-delimited source list', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ items: [], count: 0, lookback: '24h' }))
  vi.stubGlobal('fetch', fetch)
  await newsApi.list({ source: 'Example, Inc.' })
  expect(fetch).toHaveBeenCalledWith('/api/news?sourceExact=Example%2C+Inc.', undefined)
})
it('sends category tags to the backend before the result limit is applied', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ items: [], count: 0, lookback: '24h' }))
  vi.stubGlobal('fetch', fetch)
  await newsApi.list({ categories: 'ai,llm', limit: 200 })
  expect(fetch).toHaveBeenCalledWith('/api/news?limit=200&categories=ai%2Cllm', undefined)
})

it('sends importance separately from heat and preserves explicit clearing in reader changes', async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ items: [], count: 0 }))
  vi.stubGlobal('fetch', fetch)
  await newsApi.list({ important: true, includeStories: true })
  expect(fetch).toHaveBeenLastCalledWith('/api/news?includeStories=true&important=true', undefined)
  await newsApi.setReader('policy', { important: false })
  expect(fetch).toHaveBeenLastCalledWith('/api/news/stories/policy/reader', expect.objectContaining({ method: 'PATCH', body: '{"important":false}' }))
})
