/**
 * calculateIndicator tool function tests
 *
 * Tests how calculateIndicator integrates dataProvider and IndicatorCalculator
 */
import { describe, it, expect } from 'vitest';
import {
  calculateIndicator,
  CalculateIndicatorContext,
} from './calculate-indicator.tool';
import type { IDataProvider } from '../data/interfaces';
import type { MarketData } from '../data/interfaces';

describe('calculateIndicator', () => {
  // Mock historical data: 20 candlesticks, price incrementing from 100 to 119
  const mockMarketData: MarketData[] = Array.from({ length: 20 }, (_, i) => ({
    symbol: 'BTC/USD',
    time: Date.now() / 1000 - (19 - i) * 3600,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 1000 + i * 10,
  }));

  const mockDataProvider: IDataProvider = {
    getMarketData: async (_time: Date, _symbol: string): Promise<MarketData> => {
      return mockMarketData[mockMarketData.length - 1];
    },
    getMarketDataRange: async (
      _startTime: Date,
      _endTime: Date,
      _symbol: string,
    ): Promise<MarketData[]> => {
      return mockMarketData;
    },
    getNews: async () => [],
    getNewsV2: async () => [],
  };

  const createContext = (): CalculateIndicatorContext => ({
    currentTime: new Date(),
    dataProvider: mockDataProvider,
    calculatePreviousTime: (lookback: number) => {
      const time = new Date();
      time.setHours(time.getHours() - lookback);
      return time;
    },
  });

  describe('basic functionality', () => {
    it('should correctly calculate close price array', async () => {
      const ctx = createContext();
      const result = await calculateIndicator(ctx, "CLOSE('BTC/USD', 20)");

      expect(Array.isArray(result)).toBe(true);
      expect((result as number[]).length).toBe(20);
    });

    it('should correctly calculate SMA', async () => {
      const ctx = createContext();
      const result = await calculateIndicator(
        ctx,
        "SMA(CLOSE('BTC/USD', 20), 10)",
      );

      expect(typeof result).toBe('number');
      // Average of last 10 candlesticks: (110+111+...+119) / 10 = 114.5
      expect(result).toBe(114.5);
    });

    it('should correctly calculate RSI', async () => {
      const ctx = createContext();
      const result = await calculateIndicator(
        ctx,
        "RSI(CLOSE('BTC/USD', 20), 14)",
      );

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('should correctly calculate Bollinger Bands', async () => {
      const ctx = createContext();
      const result = await calculateIndicator(
        ctx,
        "BBANDS(CLOSE('BTC/USD', 20), 20, 2)",
      );

      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('upper');
      expect(result).toHaveProperty('middle');
      expect(result).toHaveProperty('lower');
    });
  });

  describe('array access', () => {
    it('should support getting the latest price', async () => {
      const ctx = createContext();
      const result = await calculateIndicator(
        ctx,
        "CLOSE('BTC/USD', 20)[-1]",
      );

      expect(typeof result).toBe('number');
      expect(result).toBe(119); // Close price of the last candlestick
    });

    it('should support getting the first price', async () => {
      const ctx = createContext();
      const result = await calculateIndicator(
        ctx,
        "CLOSE('BTC/USD', 20)[0]",
      );

      expect(typeof result).toBe('number');
      expect(result).toBe(100); // Close price of the first candlestick
    });
  });

  describe('complex expressions', () => {
    it('should support price deviation calculation', async () => {
      const ctx = createContext();
      // (latest price - 10-period MA) / 10-period MA * 100
      const result = await calculateIndicator(
        ctx,
        "(CLOSE('BTC/USD', 20)[-1] - SMA(CLOSE('BTC/USD', 20), 10)) / SMA(CLOSE('BTC/USD', 20), 10) * 100",
      );

      expect(typeof result).toBe('number');
      // 119 vs 114.5, deviation approximately 3.93%
      expect(result).toBeCloseTo(3.93, 1);
    });
  });

  describe('error handling', () => {
    it('should handle unknown functions', async () => {
      const ctx = createContext();
      await expect(
        calculateIndicator(ctx, "UNKNOWN('BTC/USD', 10)"),
      ).rejects.toThrow('Unknown function');
    });

    it('should handle array out of bounds', async () => {
      const ctx = createContext();
      await expect(
        calculateIndicator(ctx, "CLOSE('BTC/USD', 5)[100]"),
      ).rejects.toThrow('Array index out of bounds');
    });
  });
});
