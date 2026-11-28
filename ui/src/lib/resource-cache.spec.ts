import { describe, expect, it, vi } from 'vitest'

import { createPrefetchScheduler } from './prefetch-scheduler'
import { createResourceCache } from './resource-cache'

describe('createResourceCache', () => {
  it('evicts least-recently-used entries by entry count and byte budget', () => {
    let clock = 1_000
    const scheduler = createPrefetchScheduler({ maxConcurrent: 2, isHidden: () => false })
    const cache = createResourceCache({ maxEntries: 3, maxBytes: 2048, scheduler, now: () => clock })

    cache.set('a', 'A', { bytes: 500 })
    cache.set('b', 'B', { bytes: 500 })
    cache.set('c', 'C', { bytes: 500 })
    // Touch 'a' so 'b' becomes LRU.
    expect(cache.peek('a')).toBe('A')
    cache.set('d', 'D', { bytes: 500 })
    expect(cache.peek('b')).toBeUndefined()
    expect(cache.peek('a')).toBe('A')
    expect(cache.peek('c')).toBe('C')
    expect(cache.peek('d')).toBe('D')

    // Byte budget eviction: inserting a 1600-byte entry evicts oldest entries.
    cache.set('big', 'BIG', { bytes: 1600 })
    expect(cache.stats().bytes).toBeLessThanOrEqual(2048)
    expect(cache.peek('big')).toBe('BIG')

    clock += 100
    scheduler.dispose()
  })

  it('refreshes updatedAt on 304 notModified without replacing data and dedupes concurrent fetches', async () => {
    let clock = 1_000
    const scheduler = createPrefetchScheduler({ maxConcurrent: 2, isHidden: () => false })
    const cache = createResourceCache({ scheduler, now: () => clock })

    const payload = { files: ['a.md'] }
    const fetcher = vi.fn(async ({ etag }: { etag?: string }) => {
      if (etag === 'W/"v1"') return { notModified: true as const, etag: 'W/"v1"' }
      return { data: payload, etag: 'W/"v1"' }
    })

    // Concurrent calls dedupe to one fetch.
    const [r1, r2] = await Promise.all([
      cache.fetch('entry:1', fetcher, { priority: 'high', staleTimeMs: 5_000 }),
      cache.fetch('entry:1', fetcher, { priority: 'high', staleTimeMs: 5_000 }),
    ])
    expect(r1).toBe(payload)
    expect(r2).toBe(payload)
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Still fresh -> zero fetches.
    clock += 1_000
    expect(await cache.fetch('entry:1', fetcher, { staleTimeMs: 5_000 })).toBe(payload)
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Stale -> sends ETag, handles 304 notModified, preserves object identity and freshens timestamp.
    clock += 10_000
    const r3 = await cache.fetch('entry:1', fetcher, { staleTimeMs: 5_000 })
    expect(r3).toBe(payload)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ etag: 'W/"v1"' }))
    expect(cache.get('entry:1', 5_000)?.stale).toBe(false)
    scheduler.dispose()
  })

  it('does not cache rejected fetches so retries succeed', async () => {
    const scheduler = createPrefetchScheduler({ maxConcurrent: 2, isHidden: () => false })
    const cache = createResourceCache({ scheduler })
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({ ok: true })

    await expect(cache.fetch('retry-key', fetcher)).rejects.toThrow('network blip')
    expect(cache.peek('retry-key')).toBeUndefined()
    expect(await cache.fetch('retry-key', fetcher)).toEqual({ ok: true })
    scheduler.dispose()
  })
})
