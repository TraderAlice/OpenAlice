import { describe, it, expect, beforeEach } from 'vitest';
import { KlineStore } from './KlineStore';
import { MockDataProvider } from '../data/MockDataProvider';

describe('KlineStore', () => {
  let store: KlineStore;
  let mockDataProvider: MockDataProvider;

  beforeEach(() => {
    mockDataProvider = new MockDataProvider();
  });

  describe('constructor', () => {
    it('should create store with valid config', () => {
      store = new KlineStore({ timeframe: '1h' }, mockDataProvider);

      expect(store).toBeDefined();
      expect(store.getPlayheadTime()).toBeInstanceOf(Date);
    });

    it('should discover available symbols from data provider', () => {
      store = new KlineStore({ timeframe: '1h' }, mockDataProvider);
      const symbols = store.getAvailableSymbols();
      expect(symbols).toContain('BTC/USD');
      expect(symbols).toContain('ETH/USD');
    });

    it('should search symbols by asset name', () => {
      store = new KlineStore({ timeframe: '1h' }, mockDataProvider);
      expect(store.searchSymbols('BTC')).toEqual(['BTC/USD']);
      expect(store.searchSymbols('btc')).toEqual(['BTC/USD']);
      expect(store.searchSymbols('UNKNOWN')).toEqual([]);
    });
  });

  describe('playhead time', () => {
    beforeEach(() => {
      store = new KlineStore({ timeframe: '1h' }, mockDataProvider);
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

  describe('market data', () => {
    beforeEach(() => {
      store = new KlineStore({ timeframe: '1h' }, mockDataProvider);
      store.setPlayheadTime(new Date('2025-01-01T00:00:00Z'));
    });

    it('should get latest OHLCV data', async () => {
      const data = await store.getLatestOHLCV(['BTC/USD']);

      expect(data).toHaveLength(1);
      expect(data[0]).toHaveProperty('symbol', 'BTC/USD');
      expect(data[0]).toHaveProperty('open');
      expect(data[0]).toHaveProperty('high');
      expect(data[0]).toHaveProperty('low');
      expect(data[0]).toHaveProperty('close');
      expect(data[0]).toHaveProperty('volume');
      expect(data[0]).toHaveProperty('interval', '1h');
    });

    it('should get available symbols from data provider', () => {
      const symbols = store.getAvailableSymbols();
      expect(symbols).toContain('BTC/USD');
    });
  });
});
