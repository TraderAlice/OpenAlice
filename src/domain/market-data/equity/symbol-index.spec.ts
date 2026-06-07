/**
 * SymbolIndex — cache freshness contract.
 *
 * The cache envelope records which SOURCES produced it. When the SOURCES
 * list changes between releases (e.g. adding `twse`), a time-fresh cache
 * is still stale by content — load() must refetch instead of serving the
 * old source set for up to 24h.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { SymbolIndex } from './symbol-index.js'
import type { EquityClientLike } from '../client/types.js'

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

const mockedReadFile = vi.mocked(readFile)

/** Client that returns one symbol per provider it is asked for. */
function fakeClient(): EquityClientLike & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    search: vi.fn(async (params: Record<string, unknown>) => {
      const provider = params.provider as string
      calls.push(provider)
      if (provider === 'sec') return [{ symbol: 'AAPL', name: 'Apple Inc.' }]
      if (provider === 'twse') return [{ symbol: '2330.TW', name: '台積電 (TSMC)' }]
      return []
    }),
  } as unknown as EquityClientLike & { calls: string[] }
}

function envelope(sources: string[], cachedAt = new Date().toISOString()) {
  const entries = sources.map((s) => ({ symbol: `${s}-SYM`, name: s, source: s }))
  return JSON.stringify({ cachedAt, sources, count: entries.length, entries })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SymbolIndex.load — cache source matching', () => {
  it('serves a fresh cache whose sources match the current SOURCES', async () => {
    mockedReadFile.mockResolvedValue(envelope(['sec', 'twse']))
    const client = fakeClient()
    const index = new SymbolIndex()
    await index.load(client)

    expect(client.calls).toEqual([])
    expect(index.size).toBe(2)
  })

  it('refetches when the cached source list no longer matches SOURCES', async () => {
    // Time-fresh cache, but built before `twse` was added.
    mockedReadFile.mockResolvedValue(envelope(['sec']))
    const client = fakeClient()
    const index = new SymbolIndex()
    await index.load(client)

    expect(client.calls).toContain('sec')
    expect(client.calls).toContain('twse')
    expect(index.resolve('2330.TW')).toMatchObject({ source: 'twse' })
    expect(writeFile).toHaveBeenCalled()
    expect(mkdir).toHaveBeenCalled()
  })

  it('refetches when the cache is expired even if sources match', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    mockedReadFile.mockResolvedValue(envelope(['sec', 'twse'], old))
    const client = fakeClient()
    const index = new SymbolIndex()
    await index.load(client)

    expect(client.calls.length).toBeGreaterThan(0)
    expect(index.resolve('AAPL')).toBeDefined()
  })

  it('includes twse entries in search results after a fetch', async () => {
    mockedReadFile.mockRejectedValue(new Error('no cache'))
    const client = fakeClient()
    const index = new SymbolIndex()
    await index.load(client)

    const hits = index.search('TSMC')
    expect(hits.map((h) => h.symbol)).toContain('2330.TW')
  })
})
