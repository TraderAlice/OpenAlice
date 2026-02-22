import { describe, it, expect, beforeEach } from 'vitest';
import { NewsStore } from './NewsStore';
import { MockDataProvider } from '../data/MockDataProvider';

describe('NewsStore', () => {
  let store: NewsStore;
  let mockDataProvider: MockDataProvider;

  beforeEach(() => {
    mockDataProvider = new MockDataProvider();
  });

  describe('playhead time', () => {
    beforeEach(() => {
      store = new NewsStore(mockDataProvider);
    });

    it('should set and get playhead time', () => {
      const fixedTime = new Date('2025-06-01T12:00:00Z');
      store.setPlayheadTime(fixedTime);
      expect(store.getPlayheadTime()).toEqual(fixedTime);
    });

    it('should return a copy of playhead time', () => {
      const fixedTime = new Date('2025-06-01T12:00:00Z');
      store.setPlayheadTime(fixedTime);

      const t1 = store.getPlayheadTime();
      const t2 = store.getPlayheadTime();
      expect(t1).toEqual(t2);
      expect(t1).not.toBe(t2); // different object
    });
  });

  describe('news', () => {
    beforeEach(() => {
      store = new NewsStore(mockDataProvider);
      store.setPlayheadTime(new Date('2025-01-01T00:00:00Z'));
    });

    it('should return news from provider', async () => {
      const news = await store.getNewsV2({});
      expect(Array.isArray(news)).toBe(true);
    });
  });
});
