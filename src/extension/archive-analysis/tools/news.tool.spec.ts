import { describe, it, expect } from 'vitest';
import { globNews, grepNews, readNews, NewsToolContext } from './news.tool';
import type { NewsItem } from '../data/interfaces';

describe('news.tool', () => {
  // Mock news data
  const mockNews: NewsItem[] = [
    {
      time: new Date('2025-01-01T08:00:00Z'),
      title: 'BTC breaks 50k resistance',
      content:
        'Bitcoin has broken the 50k resistance level after weeks of consolidation. Analysts predict further upside.',
      metadata: { source: 'official', category: 'crypto' },
    },
    {
      time: new Date('2025-01-01T10:00:00Z'),
      title: 'ETH upgrade announcement',
      content:
        'Ethereum announces new upgrade scheduled for Q2. Gas fees expected to decrease significantly.',
      metadata: { source: 'official', category: 'crypto' },
    },
    {
      time: new Date('2025-01-01T12:00:00Z'),
      title: 'Market analysis report',
      content:
        'Analysts predict bullish trend for Bitcoin and altcoins. Interest rate decisions may impact crypto.',
      metadata: { source: 'analyst', category: 'analysis' },
    },
    {
      time: new Date('2025-01-02T06:00:00Z'),
      title: '', // Empty title - simulates untitled news
      content:
        'Asian markets show positive sentiment. BTC trading volume surges in Korea.',
      metadata: { source: 'news', category: 'market' },
    },
  ];

  const createContext = (news: NewsItem[] = mockNews): NewsToolContext => ({
    getNews: async () => news,
  });

  describe('globNews', () => {
    it('should find news by title pattern', async () => {
      const results = await globNews(createContext(), { pattern: 'BTC' });

      expect(results).toHaveLength(1);
      expect(results[0].index).toBe(0);
      expect(results[0].title).toBe('BTC breaks 50k resistance');
    });

    it('should be case insensitive', async () => {
      const results = await globNews(createContext(), { pattern: 'btc' });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('BTC breaks 50k resistance');
    });

    it('should support regex patterns', async () => {
      const results = await globNews(createContext(), {
        pattern: 'BTC|ETH',
      });

      expect(results).toHaveLength(2);
      expect(results[0].title).toContain('BTC');
      expect(results[1].title).toContain('ETH');
    });

    it('should return empty array when no matches', async () => {
      const results = await globNews(createContext(), { pattern: 'DOGE' });

      expect(results).toHaveLength(0);
    });

    it('should filter by metadata', async () => {
      const results = await globNews(createContext(), {
        pattern: '.*',
        metadataFilter: { source: 'official' },
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.metadata.includes('official'))).toBe(true);
    });

    it('should respect limit', async () => {
      const results = await globNews(createContext(), {
        pattern: '.*',
        limit: 2,
      });

      expect(results).toHaveLength(2);
    });

    it('should include content length', async () => {
      const results = await globNews(createContext(), { pattern: 'BTC' });

      expect(results[0].contentLength).toBe(mockNews[0].content.length);
    });

    it('should truncate long metadata', async () => {
      const newsWithLongMetadata: NewsItem[] = [
        {
          time: new Date(),
          title: 'Test',
          content: 'Content',
          metadata: {
            key1: 'very long value that should be truncated',
            key2: 'another long value',
          },
        },
      ];

      const results = await globNews(createContext(newsWithLongMetadata), {
        pattern: '.*',
      });

      expect(results[0].metadata.length).toBeLessThanOrEqual(40);
      expect(results[0].metadata.endsWith('...')).toBe(true);
    });

    it('should handle empty title (untitled news)', async () => {
      const results = await globNews(createContext(), { pattern: '.*' });

      // Empty title should match '.*' pattern
      expect(results).toHaveLength(4);
    });
  });

  describe('grepNews', () => {
    it('should search in content', async () => {
      const results = await grepNews(createContext(), {
        pattern: 'interest rate',
      });

      expect(results).toHaveLength(1);
      expect(results[0].index).toBe(2);
      expect(results[0].matchedText).toContain('Interest rate');
    });

    it('should search in both title and content', async () => {
      const results = await grepNews(createContext(), { pattern: 'Bitcoin' });

      expect(results).toHaveLength(2);
    });

    it('should be case insensitive', async () => {
      const results = await grepNews(createContext(), { pattern: 'BITCOIN' });

      expect(results).toHaveLength(2);
    });

    it('should include context around match', async () => {
      const results = await grepNews(createContext(), {
        pattern: 'broken',
        contextChars: 20,
      });

      expect(results).toHaveLength(1);
      expect(results[0].matchedText).toContain('broken');
      // Should have context before and after
      expect(results[0].matchedText.length).toBeGreaterThan('broken'.length);
    });

    it('should add ellipsis when context is truncated', async () => {
      const results = await grepNews(createContext(), {
        pattern: 'resistance',
        contextChars: 10,
      });

      expect(results[0].matchedText).toContain('...');
    });

    it('should filter by metadata', async () => {
      const results = await grepNews(createContext(), {
        pattern: '.*',
        metadataFilter: { category: 'analysis' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].index).toBe(2);
    });

    it('should respect limit', async () => {
      const results = await grepNews(createContext(), {
        pattern: '.*',
        limit: 1,
      });

      expect(results).toHaveLength(1);
    });

    it('should find matches in untitled news content', async () => {
      const results = await grepNews(createContext(), { pattern: 'Korea' });

      expect(results).toHaveLength(1);
      expect(results[0].index).toBe(3);
      expect(results[0].title).toBe('');
    });

    it('should use default contextChars of 50', async () => {
      const results = await grepNews(createContext(), { pattern: 'BTC' });

      // matchedText should have content around the match
      expect(results[0].matchedText.length).toBeGreaterThan(3);
    });
  });

  describe('readNews', () => {
    it('should read news by index', async () => {
      const result = await readNews(createContext(), { index: 1 });

      expect(result).not.toBeNull();
      expect(result!.title).toBe('ETH upgrade announcement');
      expect(result!.content).toContain('Ethereum');
    });

    it('should return null for invalid index', async () => {
      const result = await readNews(createContext(), { index: 100 });

      expect(result).toBeNull();
    });

    it('should return null for negative index', async () => {
      const result = await readNews(createContext(), { index: -1 });

      expect(result).toBeNull();
    });

    it('should return full news item with all fields', async () => {
      const result = await readNews(createContext(), { index: 0 });

      expect(result).toEqual(mockNews[0]);
      expect(result!.time).toBeInstanceOf(Date);
      expect(result!.metadata).toEqual({ source: 'official', category: 'crypto' });
    });
  });

  describe('empty news list', () => {
    const emptyContext = createContext([]);

    it('globNews should return empty array', async () => {
      const results = await globNews(emptyContext, { pattern: '.*' });
      expect(results).toHaveLength(0);
    });

    it('grepNews should return empty array', async () => {
      const results = await grepNews(emptyContext, { pattern: '.*' });
      expect(results).toHaveLength(0);
    });

    it('readNews should return null', async () => {
      const result = await readNews(emptyContext, { index: 0 });
      expect(result).toBeNull();
    });
  });

  describe('metadata filter edge cases', () => {
    it('should match multiple metadata keys', async () => {
      const results = await globNews(createContext(), {
        pattern: '.*',
        metadataFilter: { source: 'official', category: 'crypto' },
      });

      expect(results).toHaveLength(2);
    });

    it('should not match if any key is missing', async () => {
      const results = await globNews(createContext(), {
        pattern: '.*',
        metadataFilter: { source: 'official', nonexistent: 'value' },
      });

      expect(results).toHaveLength(0);
    });

    it('should handle empty metadata filter', async () => {
      const results = await globNews(createContext(), {
        pattern: 'BTC',
        metadataFilter: {},
      });

      expect(results).toHaveLength(1);
    });
  });
});
