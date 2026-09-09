import { describe, expect, it, vi } from 'vitest'
import { createNewsRoutes } from './news.js'
import type { EngineContext } from '../../core/types.js'
import type { GetNewsV2Options, INewsProvider, NewsItem } from '../../domain/news/types.js'

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

describe('news routes', () => {
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
