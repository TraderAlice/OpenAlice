import { describe, it, expect } from 'vitest';
import { RealNewsProvider } from './RealNewsProvider';
import { NewsItem } from './interfaces';
import newsFixture from './fixtures/panews.json';

/**
 * Load news fixture as NewsItem[] (same transform as DjiraiClient)
 */
function loadNewsFixture(): NewsItem[] {
  return newsFixture.data.map((record) => ({
    time: new Date(record.createdAt),
    title: record.title,
    content: record.content,
    metadata: record.metadata as Record<string, string | null>,
  }));
}

describe('RealNewsProvider', () => {
  describe('with fixture data', () => {
    it('should filter news by time range', async () => {
      const newsData = loadNewsFixture();
      const newsProvider = new RealNewsProvider(newsData);

      const startTime = new Date('2025-10-02T00:00:00Z');
      const endTime = new Date('2025-10-02T12:00:00Z');
      const news = await newsProvider.getNews(startTime, endTime);

      // Verify all news are within range
      for (const item of news) {
        expect(item.time.getTime()).toBeGreaterThan(startTime.getTime());
        expect(item.time.getTime()).toBeLessThanOrEqual(endTime.getTime());
      }

      expect(news.length).toBeGreaterThan(0);
    });

    it('should return news count', async () => {
      const newsData = loadNewsFixture();
      const newsProvider = new RealNewsProvider(newsData);
      const count = newsProvider.getNewsCount();

      expect(count).toBe(newsData.length);
      expect(count).toBe(14);
    });
  });

  describe('with mock data', () => {
    const mockNewsData: NewsItem[] = [
      {
        time: new Date('2025-01-01T08:00:00Z'),
        title: 'BTC breaks 50k',
        content: 'Bitcoin has broken the 50k resistance level',
        metadata: {},
      },
      {
        time: new Date('2025-01-01T10:00:00Z'),
        title: 'ETH upgrade announcement',
        content: 'Ethereum announces new upgrade',
        metadata: {},
      },
      {
        time: new Date('2025-01-01T12:00:00Z'),
        title: 'Market analysis',
        content: 'Analysts predict bullish trend',
        metadata: {},
      },
      {
        time: new Date('2025-01-02T06:00:00Z'),
        title: 'Asian markets open',
        content: 'Asian markets show positive sentiment',
        metadata: {},
      },
    ];

    it('should return empty array for no matching news', async () => {
      const newsProvider = new RealNewsProvider([]);
      const news = await newsProvider.getNews(
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      );
      expect(news).toEqual([]);
    });

    it('should filter news correctly with startTime exclusive and endTime inclusive', async () => {
      const newsProvider = new RealNewsProvider(mockNewsData);

      // startTime < newsTime <= endTime
      const news = await newsProvider.getNews(
        new Date('2025-01-01T08:00:00Z'), // exclude 08:00
        new Date('2025-01-01T12:00:00Z'), // include 12:00
      );

      expect(news).toHaveLength(2);
      expect(news[0].title).toBe('ETH upgrade announcement'); // 10:00
      expect(news[1].title).toBe('Market analysis'); // 12:00
    });

    it('should return news sorted by time ascending', async () => {
      const unorderedNews: NewsItem[] = [
        mockNewsData[2], // 12:00
        mockNewsData[0], // 08:00
        mockNewsData[1], // 10:00
      ];

      const newsProvider = new RealNewsProvider(unorderedNews);
      const news = await newsProvider.getNews(
        new Date('2025-01-01T00:00:00Z'),
        new Date('2025-01-01T23:59:59Z'),
      );

      expect(news).toHaveLength(3);
      expect(news[0].time.getTime()).toBeLessThan(news[1].time.getTime());
      expect(news[1].time.getTime()).toBeLessThan(news[2].time.getTime());
    });

    it('should return correct news count', async () => {
      const newsProvider = new RealNewsProvider(mockNewsData);
      expect(newsProvider.getNewsCount()).toBe(4);
    });

    it('should handle boundary conditions', async () => {
      const newsProvider = new RealNewsProvider(mockNewsData);

      const news1 = await newsProvider.getNews(
        new Date('2025-01-01T09:59:59Z'),
        new Date('2025-01-01T10:00:00Z'),
      );
      expect(news1).toHaveLength(1);
      expect(news1[0].title).toBe('ETH upgrade announcement');

      const news2 = await newsProvider.getNews(
        new Date('2025-01-01T10:00:00Z'),
        new Date('2025-01-01T11:00:00Z'),
      );
      expect(news2).toHaveLength(0);
    });

    it('should return empty when time range has no news', async () => {
      const newsProvider = new RealNewsProvider(mockNewsData);

      const news = await newsProvider.getNews(
        new Date('2025-01-01T13:00:00Z'),
        new Date('2025-01-01T23:59:59Z'),
      );

      expect(news).toHaveLength(0);
    });
  });
});
