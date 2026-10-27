import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewsCollector } from './rss.js'
import type { NewsCollectorStore } from '../store.js'
import type { NewsModuleManager } from '../modules/manager.js'

const row = { id: 'x', moduleId: 'example.news', sourceKey: 'x', name: 'X', source: 'x-provider', enabled: true, params: {}, categories: [] }
const item = { externalId: 'x:123', title: 'Original headline', content: 'Original post', url: 'https://x.com/example/status/123', publishedAt: '2026-10-21T01:00:00Z', publisher: 'Example company', author: '@example', kind: 'social', role: 'official', symbols: ['NASDAQ:EXAMPLE'], media: [{ type: 'image', url: 'https://example.test/media.png' }], quote: { author: '@other', text: 'Quoted original', url: 'https://x.com/other/status/1' } }
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const ingestRecord = vi.fn().mockResolvedValue(null)
  const commitCheckpoint = vi.fn().mockResolvedValue(undefined)
  const manager = { collect: vi.fn().mockResolvedValue({ items: [item], checkpoint: { sinceId: '123' } }), identity: vi.fn().mockResolvedValue({ moduleId: row.moduleId, version: '2', contentHash: 'a'.repeat(64) }), commitCheckpoint }
  const collector = new NewsCollector({ store: { ingestRecord } as unknown as NewsCollectorStore, manager: manager as unknown as NewsModuleManager, feeds: [], intervalMs: 60000, modules: [{ moduleId: row.moduleId, contentHash: 'a'.repeat(64), enabled: true }], subscriptions: [row] })
  return { collector, ingestRecord, manager, commitCheckpoint }
}
describe('collector v2 result handling', () => {
  it('distinguishes feed publication freshness from a successful request and missing dates', async () => {
    const response = vi.fn().mockImplementation(async () => new Response('<rss><channel><item><title>Dated</title><pubDate>Mon, 27 Jan 2025 19:26:00 GMT</pubDate><description>Original summary</description></item><item><title>Undated</title></item><item></item></channel></rss>'))
    vi.stubGlobal('fetch', response)
    const ingestRecord = vi.fn().mockResolvedValue(null)
    const collector = new NewsCollector({ store: { ingestRecord } as unknown as NewsCollectorStore, feeds: [{ name: 'Wire', source: 'wire', url: 'https://example.test/rss' }], intervalMs: 60000 })
    await collector.fetchAll()
    expect(collector.getStatus()[0]).toMatchObject({ state: 'healthy', lastItemCount: 3, lastPublishedAt: Date.parse('2025-01-27T19:26:00Z'), lastUndatedItemCount: 1, lastEmptyContentCount: 1, lastEmptyItemCount: 1 })
    expect(ingestRecord).toHaveBeenCalledTimes(2)
    expect(collector.getStatus()[0].lastDurationMs).toBeGreaterThanOrEqual(0)
    expect(ingestRecord.mock.calls[1][0].metadata.timeBasis).toBe('collection')
    response.mockImplementation(async () => new Response('<rss><channel></channel></rss>'))
    await collector.fetchAll()
    expect(collector.getStatus()[0]).toMatchObject({ lastItemCount: 0, lastPublishedAt: null, lastUndatedItemCount: 0, lastEmptyContentCount: 0 })
    await collector.close()
  })
  it('preserves rich originals and acknowledges after archive writes, including replayed duplicates', async () => {
    const { collector, ingestRecord, commitCheckpoint } = setup()
    expect(await collector.fetchAll()).toEqual({ total: 1, new: 0 })
    expect(ingestRecord).toHaveBeenCalledWith(expect.objectContaining({ content: item.content, metadata: expect.objectContaining({ publisher: item.publisher, author: item.author, kind: 'social', role: 'official', symbols: JSON.stringify(item.symbols), media: JSON.stringify(item.media), quote: JSON.stringify(item.quote), image: item.media[0].url }) }))
    expect(commitCheckpoint).toHaveBeenCalledWith(row, { sinceId: '123' })
    expect(ingestRecord.mock.invocationCallOrder[0]).toBeLessThan(commitCheckpoint.mock.invocationCallOrder[0])
  })
  it('does not advance a checkpoint after a partial archive failure and retries the whole batch', async () => {
    const { collector, ingestRecord, manager, commitCheckpoint } = setup()
    manager.collect.mockResolvedValue({ items: [item, { ...item, externalId: 'x:124' }], checkpoint: { sinceId: '124' } })
    ingestRecord.mockResolvedValueOnce({ seq: 1 }).mockRejectedValueOnce(new Error('Disk full'))
    expect(await collector.fetchAll()).toEqual({ total: 2, new: 1 })
    expect(commitCheckpoint).not.toHaveBeenCalled()
    expect(collector.getStatus()[0].state).toBe('error')
    expect(await collector.fetchAll()).toEqual({ total: 2, new: 0 })
    expect(commitCheckpoint).toHaveBeenCalledWith(row, { sinceId: '124' })
  })
})
