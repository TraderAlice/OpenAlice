import { describe, it, expect } from 'vitest';
import { RealMarketDataProvider } from './RealMarketDataProvider';
import { KlineStore } from '../kline/KlineStore';
import { MarketData } from './interfaces';
import ohlcvFixture from './fixtures/btc-usd-1h.json';

/**
 * Load OHLCV fixture as historicalData (same transform as DataLoader)
 */
function loadOHLCVFixture(): Record<string, MarketData[]> {
  return {
    'BTC/USD': ohlcvFixture.data.map((candle) => ({
      symbol: 'BTC/USD',
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })),
  };
}


describe('RealMarketDataProvider', () => {
  describe('with fixture data', () => {
    it('should load and query historical data', async () => {
      const historicalData = loadOHLCVFixture();
      const dataProvider = new RealMarketDataProvider(historicalData);

      const stats = dataProvider.getCacheStats();

      expect(stats.symbols).toContain('BTC/USD');
      expect(stats.totalDataPoints).toBe(96);

      // Query a specific time point
      const queryTime = new Date('2025-10-02T12:00:00Z');
      const data = await dataProvider.getMarketData(queryTime, 'BTC/USD');

      expect(data.symbol).toBe('BTC/USD');
      expect(typeof data.time).toBe('number');
      expect(data.open).toBeGreaterThan(0);
      expect(data.high).toBeGreaterThanOrEqual(data.low);
    });

    it('should work with KlineStore integration', async () => {
      const historicalData = loadOHLCVFixture();

      const marketDataProvider = new RealMarketDataProvider(historicalData);

      const klineStore = new KlineStore(
        { timeframe: '1h' },
        marketDataProvider,
      );

      // Set playhead to a time within the fixture data range
      klineStore.setPlayheadTime(new Date('2025-10-02T12:00:00Z'));

      const [btcData] = await klineStore.getLatestOHLCV(['BTC/USD']);

      expect(btcData.open).toBeGreaterThan(0);
      expect(btcData.high).toBeGreaterThanOrEqual(btcData.low);
      expect(btcData.interval).toBe('1h');
    });
  });

  describe('error handling', () => {
    it('should throw error for missing symbol data', async () => {
      const dataProvider = new RealMarketDataProvider({
        'BTC/USD': [
          {
            symbol: 'BTC/USD',
            time: 1704067200,
            open: 42000,
            high: 42500,
            low: 41800,
            close: 42200,
            volume: 100,
          },
        ],
      });

      await expect(
        dataProvider.getMarketData(
          new Date('2024-01-01'),
          'ETH/USD',
        ),
      ).rejects.toThrow('No historical data found');
    });

    it('should throw error for time before data range', async () => {
      const dataProvider = new RealMarketDataProvider({
        'BTC/USD': [
          {
            symbol: 'BTC/USD',
            time: 1704067200,
            open: 42000,
            high: 42500,
            low: 41800,
            close: 42200,
            volume: 100,
          },
        ],
      });

      await expect(
        dataProvider.getMarketData(
          new Date('2023-12-31T23:00:00Z'),
          'BTC/USD',
        ),
      ).rejects.toThrow('No data available');
    });
  });

  describe('getMarketDataRange', () => {
    it('should return data within time range', async () => {
      const dataProvider = new RealMarketDataProvider({
        'BTC/USD': [
          {
            symbol: 'BTC/USD',
            time: 1704067200,
            open: 42000,
            high: 42500,
            low: 41800,
            close: 42200,
            volume: 100,
          },
          {
            symbol: 'BTC/USD',
            time: 1704070800,
            open: 42200,
            high: 42800,
            low: 42100,
            close: 42600,
            volume: 150,
          },
          {
            symbol: 'BTC/USD',
            time: 1704074400,
            open: 42600,
            high: 43000,
            low: 42400,
            close: 42900,
            volume: 200,
          },
        ],
      });

      const result = await dataProvider.getMarketDataRange(
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T02:00:00Z'),
        'BTC/USD',
      );

      expect(result).toHaveLength(2);
      expect(result[0].time).toBe(1704070800);
      expect(result[1].time).toBe(1704074400);
    });

    it('should return empty array when no data in range', async () => {
      const dataProvider = new RealMarketDataProvider({
        'BTC/USD': [
          {
            symbol: 'BTC/USD',
            time: 1704067200,
            open: 42000,
            high: 42500,
            low: 41800,
            close: 42200,
            volume: 100,
          },
        ],
      });

      const result = await dataProvider.getMarketDataRange(
        new Date('2024-01-02T00:00:00Z'),
        new Date('2024-01-02T12:00:00Z'),
        'BTC/USD',
      );

      expect(result).toHaveLength(0);
    });

    it('should throw error for missing symbol', async () => {
      const dataProvider = new RealMarketDataProvider({
        'BTC/USD': [
          {
            symbol: 'BTC/USD',
            time: 1704067200,
            open: 42000,
            high: 42500,
            low: 41800,
            close: 42200,
            volume: 100,
          },
        ],
      });

      await expect(
        dataProvider.getMarketDataRange(
          new Date('2024-01-01T00:00:00Z'),
          new Date('2024-01-01T12:00:00Z'),
          'ETH/USD',
        ),
      ).rejects.toThrow('No historical data found');
    });
  });
});
