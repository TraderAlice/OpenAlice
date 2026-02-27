import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NewsCollectorStore, computeDedupKey } from './store'
import { unlink, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const TEST_LOG_PATH = resolve('data/test-news-collector/news.jsonl')

describe('computeDedupKey', () => {
  it('prefers guid', () => {
    const key = computeDedupKey({ guid: 'abc-123', link: 'https://example.com', title: 'T', content: 'C' })
    expect(key).toBe('guid:abc-123')
  })

  it('falls back to link when no guid', () => {
    const key = computeDedupKey({ link: 'https://example.com/article', title: 'T', content: 'C' })
    expect(key).toBe('link:https://example.com/article')
  })

  it('falls back to content hash when no guid or link', () => {
    const key = computeDedupKey({ title: 'Test Title', content: 'Test Content' })
    expect(key).toMatch(/^hash:[a-f0-9]{16}$/)
  })

  it('produces same hash for same content', () => {
    const a = computeDedupKey({ title: 'Same', content: 'Content' })
    const b = computeDedupKey({ title: 'Same', content: 'Content' })
    expect(a).toBe(b)
  })

  it('produces different hashes for different content', () => {
    const a = computeDedupKey({ title: 'A', content: 'Content A' })
    const b = computeDedupKey({ title: 'B', content: 'Content B' })
    expect(a).not.toBe(b)
  })
})

describe('NewsCollectorStore', () => {
  let store: NewsCollectorStore

  beforeEach(async () => {
    // Clean up test file
    try { await unlink(TEST_LOG_PATH) } catch { /* ignore */ }
    store = new NewsCollectorStore({ logPath: TEST_LOG_PATH, maxInMemory: 100, retentionDays: 7 })
    await store.init()
  })

  afterEach(async () => {
    await store.close()
    try { await unlink(TEST_LOG_PATH) } catch { /* ignore */ }
  })

  it('starts empty', () => {
    expect(store.count).toBe(0)
    expect(store.dedupCount).toBe(0)
  })

  it('ingests a new item and returns true', async () => {
    const result = await store.ingest({
      title: 'BTC at $90k',
      content: 'Bitcoin surges past $90k.',
      pubTime: new Date('2026-02-27T10:00:00Z'),
      dedupKey: 'guid:article-1',
      metadata: { source: 'coindesk' },
    })
    expect(result).toBe(true)
    expect(store.count).toBe(1)
    expect(store.dedupCount).toBe(1)
  })

  it('rejects duplicate items', async () => {
    const item = {
      title: 'BTC at $90k',
      content: 'Bitcoin surges.',
      pubTime: new Date('2026-02-27T10:00:00Z'),
      dedupKey: 'guid:article-1',
      metadata: { source: 'coindesk' },
    }
    expect(await store.ingest(item)).toBe(true)
    expect(await store.ingest(item)).toBe(false)
    expect(store.count).toBe(1)
    expect(store.dedupCount).toBe(1)
  })

  it('persists to JSONL and recovers on init', async () => {
    await store.ingest({
      title: 'Article 1',
      content: 'Content 1',
      pubTime: new Date('2026-02-27T10:00:00Z'),
      dedupKey: 'guid:1',
      metadata: { source: 'test' },
    })
    await store.ingest({
      title: 'Article 2',
      content: 'Content 2',
      pubTime: new Date('2026-02-27T11:00:00Z'),
      dedupKey: 'guid:2',
      metadata: { source: 'test' },
    })
    await store.close()

    // Recreate and recover
    const store2 = new NewsCollectorStore({ logPath: TEST_LOG_PATH, maxInMemory: 100, retentionDays: 7 })
    await store2.init()

    expect(store2.count).toBe(2)
    expect(store2.dedupCount).toBe(2)
    expect(store2.has('guid:1')).toBe(true)
    expect(store2.has('guid:2')).toBe(true)

    // Dedup still works after recovery
    const dup = await store2.ingest({
      title: 'Article 1',
      content: 'Content 1',
      pubTime: new Date('2026-02-27T10:00:00Z'),
      dedupKey: 'guid:1',
      metadata: { source: 'test' },
    })
    expect(dup).toBe(false)

    await store2.close()
  })

  it('ingestBatch returns count of new items', async () => {
    const items = [
      { title: 'A', content: 'Ca', pubTime: new Date(), dedupKey: 'guid:a', metadata: { source: 'test' } },
      { title: 'B', content: 'Cb', pubTime: new Date(), dedupKey: 'guid:b', metadata: { source: 'test' } },
      { title: 'A dup', content: 'Ca', pubTime: new Date(), dedupKey: 'guid:a', metadata: { source: 'test' } },
    ]
    const count = await store.ingestBatch(items)
    expect(count).toBe(2)
    expect(store.count).toBe(2)
  })

  it('respects maxInMemory', async () => {
    const smallStore = new NewsCollectorStore({ logPath: TEST_LOG_PATH, maxInMemory: 3, retentionDays: 7 })
    await smallStore.init()

    for (let i = 0; i < 5; i++) {
      await smallStore.ingest({
        title: `Article ${i}`,
        content: `Content ${i}`,
        pubTime: new Date(Date.now() + i * 1000),
        dedupKey: `guid:${i}`,
        metadata: { source: 'test' },
      })
    }

    expect(smallStore.count).toBe(3)
    expect(smallStore.dedupCount).toBe(5) // All dedup keys retained
    await smallStore.close()
  })

  describe('INewsProvider', () => {
    beforeEach(async () => {
      // Insert items at different times
      const base = new Date('2026-02-27T00:00:00Z').getTime()
      for (let i = 0; i < 10; i++) {
        await store.ingest({
          title: `News ${i}`,
          content: `Content for news ${i}`,
          pubTime: new Date(base + i * 3600_000), // 1 hour apart
          dedupKey: `guid:news-${i}`,
          metadata: { source: i < 5 ? 'coindesk' : 'cointelegraph' },
        })
      }
    })

    it('getNews filters by time range', async () => {
      const base = new Date('2026-02-27T00:00:00Z').getTime()
      const items = await store.getNews(
        new Date(base + 2 * 3600_000), // after news 2
        new Date(base + 5 * 3600_000), // up to news 5
      )
      expect(items).toHaveLength(3) // news 3, 4, 5
      expect(items[0].title).toBe('News 3')
      expect(items[2].title).toBe('News 5')
    })

    it('getNewsV2 with lookback', async () => {
      const endTime = new Date('2026-02-27T09:00:00Z') // = news 9
      const items = await store.getNewsV2({ endTime, lookback: '3h' })
      // 3 hours back from 09:00 = 06:00, so news 7, 8, 9 (pubTs > 06:00 && <= 09:00)
      expect(items).toHaveLength(3)
      expect(items[0].title).toBe('News 7')
      expect(items[2].title).toBe('News 9')
    })

    it('getNewsV2 with limit', async () => {
      const endTime = new Date('2026-02-27T09:00:00Z')
      const items = await store.getNewsV2({ endTime, limit: 3 })
      expect(items).toHaveLength(3)
      // Most recent 3
      expect(items[0].title).toBe('News 7')
      expect(items[2].title).toBe('News 9')
    })

    it('getNewsV2 with lookback and limit', async () => {
      const endTime = new Date('2026-02-27T09:00:00Z')
      const items = await store.getNewsV2({ endTime, lookback: '12h', limit: 2 })
      expect(items).toHaveLength(2)
      expect(items[0].title).toBe('News 8')
      expect(items[1].title).toBe('News 9')
    })

    it('getNewsV2 returns items sorted ascending', async () => {
      const endTime = new Date('2026-02-27T09:00:00Z')
      const items = await store.getNewsV2({ endTime })
      for (let i = 1; i < items.length; i++) {
        expect(items[i].time.getTime()).toBeGreaterThanOrEqual(items[i - 1].time.getTime())
      }
    })
  })
})
