import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewsCollector } from './rss.js'
import { GELONGHUI_API_URL, GELONGHUI_SOURCE_PAGE_URL } from './gelonghui.js'
import type { NewsCollectorStore } from '../store.js'
import type { NewsRecord, RSSFeedConfig } from '../types.js'

type IngestInput = Parameters<NewsCollectorStore['ingestRecord']>[0]

function createCaptureStore() {
  const inputs: IngestInput[] = []
  const ingestRecord = vi.fn(async (input: IngestInput): Promise<NewsRecord> => {
    inputs.push(input)
    return {
      seq: inputs.length,
      ts: 0,
      pubTs: input.pubTime.getTime(),
      dedupKey: input.dedupKey,
      title: input.title,
      content: input.content,
      metadata: input.metadata,
    }
  })

  return {
    store: { ingestRecord } as unknown as NewsCollectorStore,
    inputs,
    ingestRecord,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('NewsCollector', () => {
  it('routes Gelonghui through its API and ingests provider metadata', async () => {
    const configuredUrl = GELONGHUI_SOURCE_PAGE_URL
    const publishedAt = new Date('2026-09-24T05:17:00.000Z')
    const payload = {
      statusCode: 200,
      result: [{
        id: 'live-42001',
        title: 'Central bank rate outlook improves',
        content: 'Analysts expect the central bank to cut rates soon.',
        createTimestamp: publishedAt.getTime() / 1000,
        route: 'https://www.gelonghui.com/live/brief/live-42001',
      }],
    }
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => payload,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { store, inputs, ingestRecord } = createCaptureStore()
    const feed: RSSFeedConfig = {
      name: 'Gelonghui live',
      url: configuredUrl,
      source: 'gelonghui',
      enabled: true,
    }
    const collector = new NewsCollector({ store, feeds: [feed], intervalMs: 60_000 })

    await expect(collector.fetchAll()).resolves.toEqual({ total: 1, new: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(GELONGHUI_API_URL)
    expect(fetchMock.mock.calls[0]?.[0]).not.toBe(configuredUrl)
    expect(ingestRecord).toHaveBeenCalledTimes(1)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.title).toBe('Central bank rate outlook improves')
    expect(inputs[0]?.content).toBe('Analysts expect the central bank to cut rates soon.')
    expect(inputs[0]?.pubTime).toEqual(publishedAt)
    expect(inputs[0]?.metadata).toMatchObject({
      source: 'gelonghui',
      ingestSource: 'provider',
      guid: 'live-42001',
      link: 'https://www.gelonghui.com/live/brief/live-42001',
    })
  })

  it('keeps generic sources on their configured RSS URL', async () => {
    const configuredUrl = 'https://news.example.test/feed.xml'
    const xml = '<rss version="2.0"><channel><title>Example</title><item><title>RSS market update</title><link>https://news.example.test/story/1</link><guid>rss-1</guid><pubDate>Thu, 24 Sep 2026 05:17:00 GMT</pubDate><description>Markets opened higher today.</description></item></channel></rss>'
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      text: async () => xml,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { store, inputs, ingestRecord } = createCaptureStore()
    const feed: RSSFeedConfig = {
      name: 'Example RSS',
      url: configuredUrl,
      source: 'example-rss',
      enabled: true,
    }
    const collector = new NewsCollector({ store, feeds: [feed], intervalMs: 60_000 })

    await expect(collector.fetchAll()).resolves.toEqual({ total: 1, new: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(configuredUrl)
    expect(ingestRecord).toHaveBeenCalledTimes(1)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.title).toBe('RSS market update')
    expect(inputs[0]?.content).toBe('Markets opened higher today.')
    expect(inputs[0]?.metadata).toMatchObject({
      source: 'example-rss',
      ingestSource: 'rss',
      guid: 'rss-1',
      link: 'https://news.example.test/story/1',
    })
  })

  it('keeps a custom RSS feed with Gelonghui as its source tag on the configured URL', async () => {
    const configuredUrl = 'https://news.example.test/custom.xml'
    const xml = '<rss version="2.0"><channel><title>Custom</title><item><title>Custom update</title><link>https://news.example.test/story/2</link><guid>custom-2</guid><description>Custom content.</description></item></channel></rss>'
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, text: async () => xml }))
    vi.stubGlobal('fetch', fetchMock)
    const { store, inputs } = createCaptureStore()
    const feed: RSSFeedConfig = { name: 'Custom feed', url: configuredUrl, source: 'gelonghui', enabled: true }
    const collector = new NewsCollector({ store, feeds: [feed], intervalMs: 60_000 })

    await expect(collector.fetchAll()).resolves.toEqual({ total: 1, new: 1 })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(configuredUrl)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.title).toBe('Custom update')
    expect(inputs[0]?.metadata).toMatchObject({ source: 'gelonghui', ingestSource: 'rss' })
  })
})
