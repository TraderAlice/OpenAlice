import { describe, expect, it, vi } from 'vitest'
import { createNewsRoutes } from './news.js'
import type { EngineContext } from '../../core/types.js'
import type { GetNewsV2Options, INewsProvider, NewsItem } from '../../domain/news/types.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = new Date('2026-02-27T00:00:00Z').getTime()

function item(index: number, fields: Partial<NewsItem> = {}): NewsItem {
  return {
    id: index,
    time: new Date(BASE + index * 3_600_000),
    title: `Headline ${index}`,
    content: `Content ${index}`,
    metadata: { source: 'feed-a', categories: 'markets' },
    ...fields,
  }
}

function routes(getNewsV2: INewsProvider['getNewsV2']) {
  return createNewsRoutes({ newsProvider: { getNewsV2 } } as unknown as EngineContext)
}

describe('news routes', { timeout: process.platform === 'win32' ? 60_000 : 5_000 }, () => {
  it('filters explicit source importance before the raw limit, composes categories and validates input', async () => {
    const getNewsV2 = vi.fn(async (options: GetNewsV2Options) => {
      expect(options.limit).toBeUndefined()
      return [item(1, { metadata: { categories: 'macro; URGENT' } }), item(2, { metadata: { categories: 'important,crypto' } }), item(3)]
    })
    const app = routes(getNewsV2)
    expect(await (await app.request('/?important=true&categories=macro&limit=1')).json()).toMatchObject({ items: [{ id: 1, important: true }], count: 1 })
    expect((await app.request('/?important=maybe')).status).toBe(400)
    expect((await app.request('/stories?important=maybe')).status).toBe(400)
  })
  it('renders archived RSS headline formatting without changing the stored report or literal module titles', async () => {
    const rss = item(1, { title: '<b>Market close</b><br/><span>Risk <5%</span>', metadata: { source: 'jin10', ingestSource: 'rss' } })
    const module = item(2, { title: 'Use <b> literally', metadata: { source: 'module', ingestSource: 'module' } })
    const response = await routes(async () => [rss, module]).request('/?lookback=30d')
    expect((await response.json()).items.map((entry: { title: string }) => entry.title)).toEqual(['Market close Risk <5%', 'Use <b> literally'])
    expect(rss.title).toBe('<b>Market close</b><br/><span>Risk <5%</span>')
  })

  it('filters exact category tags before the result limit and preserves collection-time provenance', async () => {
    const getNewsV2 = vi.fn(async (options: GetNewsV2Options) => {
      expect(options.limit).toBeUndefined()
      return [item(1, { metadata: { source: 'official-ai', categories: 'ai,tech', timeBasis: 'collection' } }), item(2, { metadata: { categories: 'markets' } }), item(3, { metadata: { categories: 'retail' } }), item(4, { title: '', content: '', metadata: { categories: 'ai' } })]
    })
    const response = await routes(getNewsV2).request('/?categories=AI,llm&limit=1')
    expect(await response.json()).toMatchObject({ count: 1, items: [{ id: 1, timeBasis: 'collection', source: 'official-ai' }] })
  })
  it('publishes evidence-linked stories and exposes them independently of the report window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'alice-news-route-'))
    try {
      const app = createNewsRoutes({ newsProvider: { getNewsV2: async () => [], getNewsById: async (id: number) => id === 1 ? item(1) : null } } as unknown as EngineContext, { storyDirectory: directory })
      const story = { version: 1, id: 'policy', revision: 1, title: 'Policy event', summary: 'What happened', reason: 'Why follow it', topics: ['macro'], symbols: [], selected: true, status: 'watching', updatedAt: '2026-10-21T09:00:00Z', preparedBy: 'Native CLI', overviewReportIds: [1], developments: [{ id: 'statement', time: '2026-02-27T01:00:00Z', title: 'Statement', summary: 'Original fact', reportIds: [1] }] }
      const publish = () => app.request('/stories/policy', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(story) })
      expect((await publish()).status).toBe(200)
      expect((await publish()).status).toBe(409)
      expect(await (await app.request('/?lookback=1h')).json()).not.toHaveProperty('stories')
      const response = await app.request('/?lookback=1h&includeStories=true')
      expect(await response.json()).toMatchObject({ items: [], stories: [{ id: 'policy', reports: [{ id: 1, title: 'Headline 1' }] }] })
      const preview = await (await app.request('/stories')).json()
      expect(preview.stories[0].reports[0]).not.toHaveProperty('content')
      expect(await (await app.request('/stories/policy')).json()).toMatchObject({ reports: [{ content: 'Content 1' }] })
      expect(await (await app.request('/following/topics', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'MACRO', following: true }) })).json()).toEqual({ topics: ['macro'] })
      expect(await (await app.request('/following/topics')).json()).toEqual({ topics: ['macro'] })
      expect((await app.request('/following/topics', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'unknown', following: true }) })).status).toBe(400)
      expect(await (await app.request('/stories?eventId=other')).json()).toMatchObject({ stories: [] })
      expect((await app.request('/stories?eventId=../policy')).status).toBe(400)
      expect(await (await app.request('/stories/policy/reader', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ following: true }) })).json()).toMatchObject({ following: true })
      const read = (readRevision: unknown) => app.request('/stories/policy/reader', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ readRevision }) })
      expect((await read(0)).status).toBe(400)
      expect((await read('1')).status).toBe(400)
      expect((await read(2)).status).toBe(409)
      expect(await (await read(1)).json()).toMatchObject({ readProgress: { revision: 1, developmentIds: ['statement'] } })
      expect(await (await app.request('/stories?readStatus=unread')).json()).toMatchObject({ stories: [] })
      expect(await (await app.request('/?includeStories=true&readStatus=unread')).json()).toMatchObject({ stories: [] })
      expect((await app.request('/stories?readStatus=unknown')).status).toBe(400)
      expect((await app.request('/?includeStories=true&readStatus=unknown')).status).toBe(400)
      expect(await (await app.request('/stories')).json()).toMatchObject({ stories: [{ reading: { readProgress: { revision: 1 } } }] })
      expect(await (await read(null)).json()).toMatchObject({ readProgress: null })
      expect((await app.request('/stories?relatedTo=../policy')).status).toBe(400)
      expect((await (await app.request('/stories?relatedTo=policy')).json()).stories).toEqual([])
      expect((await (await app.request('/stories?important=true')).json()).stories).toEqual([])
      const mark = (important: unknown) => app.request('/stories/policy/reader', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ important }) })
      expect((await mark('yes')).status).toBe(400)
      expect((await mark(true)).status).toBe(200)
      expect(await (await app.request('/?includeStories=true&important=true')).json()).toMatchObject({ stories: [{ id: 'policy', reading: { important: true } }] })
      expect((await mark(false)).status).toBe(200)
      expect((await (await app.request('/stories?important=true')).json()).stories).toEqual([])
      expect((await app.request('/stories/another', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(story) })).status).toBe(400)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('filters a literal publisher containing commas without treating it as multiple sources', async () => {
    const getNewsV2 = vi.fn(async () => [item(1, { metadata: { publisher: 'Example, Inc.', source: 'x-provider' } }), item(2, { metadata: { publisher: 'Example', source: 'other' } })])
    const response = await routes(getNewsV2).request('/?sourceExact=Example%2C%20Inc.')
    expect(await response.json()).toMatchObject({ count: 1, items: [{ source: 'Example, Inc.' }] })
  })
  it('projects original publishers, quoted posts and explicit symbols from v2 archive metadata', async () => {
    const quote = { author: '@other', text: 'Quoted original', url: 'https://x.com/other/status/1' }
    const getNewsV2 = vi.fn(async () => [item(1, { metadata: { source: 'fmp-subscription', publisher: 'Original Media', author: '@example', kind: 'social', symbols: '["NASDAQ:EXAMPLE"]', quote: JSON.stringify(quote) } })])
    const response = await routes(getNewsV2).request('/?source=Original%20Media&symbol=EXAMPLE')
    expect(await response.json()).toMatchObject({ count: 1, items: [{ source: 'Original Media', author: '@example', symbols: ['NASDAQ:EXAMPLE'], quote }] })
  })
  it('uses explicit timestamps instead of lookback and returns a nullable lookback', async () => {
    const getNewsV2 = vi.fn(async () => [item(1)])
    const app = routes(getNewsV2)
    const res = await app.request('/?startTime=2026-02-27T01:00:00.000Z&endTime=2026-02-27T05:00:00.000Z&lookback=bad')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lookback).toBeNull()
    expect(getNewsV2).toHaveBeenCalledWith({
      startTime: new Date('2026-02-27T01:00:00.000Z'),
      endTime: new Date('2026-02-27T05:00:00.000Z'),
      limit: 50,
    })
  })

  it.each([
    ['/?startTime=not-a-date', 'startTime'],
    ['/?endTime=not-a-date', 'endTime'],
    ['/?startTime=2026-02-27T05:00:00.000Z&endTime=2026-02-27T01:00:00.000Z', 'startTime'],
  ])('rejects invalid timestamp query (%s)', async (path) => {
    const res = await routes(vi.fn(async () => [])).request(path)
    expect(res.status).toBe(400)
  })

  it('applies literal keyword and symbol filters before the result limit', async () => {
    const getNewsV2 = vi.fn(async (options: GetNewsV2Options) => {
      expect(options.limit).toBeUndefined()
      return [
        item(1, { title: 'Older target report', content: 'alpha' }),
        item(2, { title: 'Noise', content: 'target' }),
        item(3, { title: 'Target headline', content: 'AAPL outlook', metadata: { source: 'feed-a', categories: 'markets,us' } }),
        item(4, { title: 'Newest target', content: 'AAPL update', metadata: { source: 'feed-a', categories: 'markets' } }),
      ]
    })
    const res = await routes(getNewsV2).request('/?keyword=TARGET&symbol=aapl&limit=1')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.items[0].title).toBe('Newest target')
  })

  it('filters sources before limiting and only returns safe image URLs', async () => {
    const getNewsV2 = vi.fn(async () => [
      item(1, { metadata: { source: 'other', image: 'https://example.com/old.jpg' } }),
      item(2, { metadata: { source: 'feed-a', image: 'javascript:alert(1)' } }),
      item(3, { metadata: { source: 'feed-a', image: 'https://example.com/news.png' } }),
    ])
    const res = await routes(getNewsV2).request('/?source=FEED-A&limit=1')

    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].title).toBe('Headline 3')
    expect(body.items[0].image).toBe('https://example.com/news.png')
  })

  it('normalizes limits and orders filtered results newest-last', async () => {
    const getNewsV2 = vi.fn(async () => [item(4), item(2), item(3)])
    const res = await routes(getNewsV2).request('/?keyword=headline&limit=1.9')

    expect(res.status).toBe(200)
    expect((await res.json()).items.map((entry: { title: string }) => entry.title)).toEqual(['Headline 4'])
    expect(getNewsV2).toHaveBeenCalledWith({ endTime: expect.any(Date), lookback: '24h' })
  })

  it('treats an empty source list as no source filter', async () => {
    const getNewsV2 = vi.fn(async () => [item(1), item(2)])
    const res = await routes(getNewsV2).request('/?source=,%20,')

    expect(res.status).toBe(200)
    expect((await res.json()).count).toBe(2)
    expect(getNewsV2).toHaveBeenCalledWith({ endTime: expect.any(Date), lookback: '24h', limit: 50 })
  })
})
