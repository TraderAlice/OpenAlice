import { describe, it, expect } from 'vitest'
import { globRss, grepRss, readRss, windowRss, type NewsToolContext } from './archive'
import type { NewsItem } from '../types'

describe('news tools (pure functions)', () => {
  // Mock news data
  // Non-sequential ids on purpose: proves addressing is by stable id, not
  // by position in the returned list.
  const mockNews: NewsItem[] = [
    {
      id: 10,
      time: new Date('2025-01-01T08:00:00Z'),
      title: 'BTC breaks 50k resistance',
      content:
        'Bitcoin has broken the 50k resistance level after weeks of consolidation. Analysts predict further upside.',
      metadata: { source: 'official', category: 'crypto' },
    },
    {
      id: 20,
      time: new Date('2025-01-01T10:00:00Z'),
      title: 'ETH upgrade announcement',
      content:
        'Ethereum announces new upgrade scheduled for Q2. Gas fees expected to decrease significantly.',
      metadata: { source: 'official', category: 'crypto' },
    },
    {
      id: 30,
      time: new Date('2025-01-01T12:00:00Z'),
      title: 'Market analysis report',
      content:
        'Analysts predict bullish trend for Bitcoin and altcoins. Interest rate decisions may impact crypto.',
      metadata: { source: 'analyst', category: 'analysis' },
    },
    {
      id: 40,
      time: new Date('2025-01-02T06:00:00Z'),
      title: '', // Empty title - simulates untitled news
      content:
        'Asian markets show positive sentiment. BTC trading volume surges in Korea.',
      metadata: { source: 'news', category: 'market' },
    },
  ]

  const createContext = (news: NewsItem[] = mockNews): NewsToolContext => ({
    getNews: async () => news,
  })

  describe('globRss', () => {
    it('should find news by title pattern', async () => {
      const results = await globRss(createContext(), { pattern: 'BTC' })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe(10)
      expect(results[0].title).toBe('BTC breaks 50k resistance')
    })

    it('should be case insensitive', async () => {
      const results = await globRss(createContext(), { pattern: 'btc' })

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('BTC breaks 50k resistance')
    })

    it('should support regex patterns', async () => {
      const results = await globRss(createContext(), {
        pattern: 'BTC|ETH',
      })

      expect(results).toHaveLength(2)
      expect(results[0].title).toContain('BTC')
      expect(results[1].title).toContain('ETH')
    })

    it('should return empty array when no matches', async () => {
      const results = await globRss(createContext(), { pattern: 'DOGE' })

      expect(results).toHaveLength(0)
    })

    it('should filter by metadata', async () => {
      const results = await globRss(createContext(), {
        pattern: '.*',
        metadataFilter: { source: 'official' },
      })

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.metadata.includes('official'))).toBe(true)
    })

    it('should respect limit', async () => {
      const results = await globRss(createContext(), {
        pattern: '.*',
        limit: 2,
      })

      expect(results).toHaveLength(2)
    })

    it('should include content length', async () => {
      const results = await globRss(createContext(), { pattern: 'BTC' })

      expect(results[0].contentLength).toBe(mockNews[0].content.length)
    })

    it('should truncate long metadata', async () => {
      const newsWithLongMetadata: NewsItem[] = [
        {
          id: 1,
          time: new Date(),
          title: 'Test',
          content: 'Content',
          metadata: {
            key1: 'very long value that should be truncated',
            key2: 'another long value',
          },
        },
      ]

      const results = await globRss(createContext(newsWithLongMetadata), {
        pattern: '.*',
      })

      expect(results[0].metadata.length).toBeLessThanOrEqual(40)
      expect(results[0].metadata.endsWith('...')).toBe(true)
    })

    it('should handle empty title (untitled news)', async () => {
      const results = await globRss(createContext(), { pattern: '.*' })

      // Empty title should match '.*' pattern
      expect(results).toHaveLength(4)
    })
  })

  describe('grepRss', () => {
    it('should search in content', async () => {
      const results = await grepRss(createContext(), {
        pattern: 'interest rate',
      })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe(30)
      expect(results[0].matchedText).toContain('Interest rate')
    })

    it('should search in both title and content', async () => {
      const results = await grepRss(createContext(), { pattern: 'Bitcoin' })

      expect(results).toHaveLength(2)
    })

    it('should be case insensitive', async () => {
      const results = await grepRss(createContext(), { pattern: 'BITCOIN' })

      expect(results).toHaveLength(2)
    })

    it('should include context around match', async () => {
      const results = await grepRss(createContext(), {
        pattern: 'broken',
        contextChars: 20,
      })

      expect(results).toHaveLength(1)
      expect(results[0].matchedText).toContain('broken')
      // Should have context before and after
      expect(results[0].matchedText.length).toBeGreaterThan('broken'.length)
    })

    it('should add ellipsis when context is truncated', async () => {
      const results = await grepRss(createContext(), {
        pattern: 'resistance',
        contextChars: 10,
      })

      expect(results[0].matchedText).toContain('...')
    })

    it('should filter by metadata', async () => {
      const results = await grepRss(createContext(), {
        pattern: '.*',
        metadataFilter: { category: 'analysis' },
      })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe(30)
    })

    it('should respect limit', async () => {
      const results = await grepRss(createContext(), {
        pattern: '.*',
        limit: 1,
      })

      expect(results).toHaveLength(1)
    })

    it('should find matches in untitled news content', async () => {
      const results = await grepRss(createContext(), { pattern: 'Korea' })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe(40)
      expect(results[0].title).toBe('')
    })

    it('should use default contextChars of 50', async () => {
      const results = await grepRss(createContext(), { pattern: 'BTC' })

      // matchedText should have content around the match
      expect(results[0].matchedText.length).toBeGreaterThan(3)
    })
  })

  describe('readRss', () => {
    it('should read news by stable id', async () => {
      const result = await readRss(createContext(), { id: 20 })

      expect(result).not.toBeNull()
      expect(result!.title).toBe('ETH upgrade announcement')
      expect(result!.content).toContain('Ethereum')
    })

    it('should resolve by id regardless of position in the list', async () => {
      // id 40 is the last item; a positional index of 40 would be out of range,
      // proving addressing is by id, not by position.
      const result = await readRss(createContext(), { id: 40 })

      expect(result).not.toBeNull()
      expect(result!.content).toContain('Korea')
    })

    it('should return null for unknown id', async () => {
      const result = await readRss(createContext(), { id: 99999 })

      expect(result).toBeNull()
    })

    it('should return full news item with all fields', async () => {
      const result = await readRss(createContext(), { id: 10 })

      expect(result).toEqual(mockNews[0])
      expect(result!.time).toBeInstanceOf(Date)
      expect(result!.metadata).toEqual({ source: 'official', category: 'crypto' })
    })
  })

  describe('empty news list', () => {
    const emptyContext = createContext([])

    it('globRss should return empty array', async () => {
      const results = await globRss(emptyContext, { pattern: '.*' })
      expect(results).toHaveLength(0)
    })

    it('grepRss should return empty array', async () => {
      const results = await grepRss(emptyContext, { pattern: '.*' })
      expect(results).toHaveLength(0)
    })

    it('readRss should return null', async () => {
      const result = await readRss(emptyContext, { id: 0 })
      expect(result).toBeNull()
    })
  })

  describe('metadata filter edge cases', () => {
    it('should match multiple metadata keys', async () => {
      const results = await globRss(createContext(), {
        pattern: '.*',
        metadataFilter: { source: 'official', category: 'crypto' },
      })

      expect(results).toHaveLength(2)
    })

    it('should not match if any key is missing', async () => {
      const results = await globRss(createContext(), {
        pattern: '.*',
        metadataFilter: { source: 'official', nonexistent: 'value' },
      })

      expect(results).toHaveLength(0)
    })

    it('should handle empty metadata filter', async () => {
      const results = await globRss(createContext(), {
        pattern: 'BTC',
        metadataFilter: {},
      })

      expect(results).toHaveLength(1)
    })
  })

  describe('result dates + windowRss', () => {
    it('glob/grep results carry an ISO publish time (timeline without re-reading)', async () => {
      const g = await globRss(createContext(), { pattern: 'BTC' })
      expect(g[0].time).toBe('2025-01-01T08:00:00.000Z')
      const gr = await grepRss(createContext(), { pattern: 'Ethereum' })
      expect(gr[0].time).toBe('2025-01-01T10:00:00.000Z')
    })

    it('windowRss returns OLDEST-first for timeline alignment', async () => {
      const out = await windowRss(createContext(), {})
      expect(out.map((r) => r.id)).toEqual([10, 20, 30, 40]) // ascending by time
      expect(out[0].time).toBe('2025-01-01T08:00:00.000Z')
    })

    it('windowRss with a pattern filters + attaches matched text', async () => {
      const out = await windowRss(createContext(), { pattern: 'Bitcoin' })
      expect(out.map((r) => r.id)).toEqual([10, 30]) // both mention Bitcoin, oldest-first
      expect(out[0].matchedText).toMatch(/Bitcoin/)
    })
  })
})
