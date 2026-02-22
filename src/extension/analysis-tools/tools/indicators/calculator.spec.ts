/**
 * Technical indicator calculator unit tests
 */
import { describe, it, expect } from 'vitest';
import { IndicatorCalculator } from './calculator';
import { FunctionContext } from './types';
import type { MarketData } from '../../../analysis-kit/data/interfaces';

describe('IndicatorCalculator', () => {
  // Mock historical data: 50 candlesticks, price incrementing from 100 to 149
  const mockHistoricalData: MarketData[] = Array.from(
    { length: 50 },
    (_, i) => ({
      symbol: 'BTC/USD',
      time: Date.now() / 1000 - (49 - i) * 3600, // One per hour
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 1000 + i * 10,
    }),
  );

  const mockContext: FunctionContext = {
    getHistoricalData: async (symbol: string, lookback: number) => {
      // Return the most recent lookback candlesticks
      return mockHistoricalData.slice(-lookback);
    },
  };

  const currentTime = new Date();

  describe('data access functions', () => {
    it('should correctly get close price array', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate("CLOSE('BTC/USD', 10)");

      expect(Array.isArray(result)).toBe(true);
      expect((result as number[]).length).toBe(10);
      // Close prices of the last 10 candlesticks should be 140-149
      expect(result).toEqual([
        140, 141, 142, 143, 144, 145, 146, 147, 148, 149,
      ]);
    });

    it('should correctly get high price array', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate("HIGH('BTC/USD', 5)");

      expect(Array.isArray(result)).toBe(true);
      expect((result as number[]).length).toBe(5);
      // High prices of the last 5 candlesticks should be 147-151
      expect(result).toEqual([147, 148, 149, 150, 151]);
    });

    it('should correctly get volume array', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate("VOLUME('BTC/USD', 3)");

      expect(Array.isArray(result)).toBe(true);
      expect((result as number[]).length).toBe(3);
      // Volume of the last 3 candlesticks should be 1470, 1480, 1490
      expect(result).toEqual([1470, 1480, 1490]);
    });
  });

  describe('statistics functions', () => {
    it('should correctly calculate Simple Moving Average (SMA)', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate(
        "SMA(CLOSE('BTC/USD', 20), 10)",
      );

      expect(typeof result).toBe('number');
      // Average of the last 10 candlesticks: (140+141+...+149) / 10 = 144.5
      expect(result).toBe(144.5);
    });

    it('should correctly calculate Standard Deviation (STDEV)', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate(
        "STDEV(CLOSE('BTC/USD', 10))",
      );

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
      // Standard deviation should be approximately 2.87 (stdev of 0,1,2...9)
      expect(result).toBeCloseTo(2.87, 1);
    });

    it('should correctly calculate max and min values', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);

      const max = await calculator.calculate("MAX(CLOSE('BTC/USD', 10))");
      const min = await calculator.calculate("MIN(CLOSE('BTC/USD', 10))");

      expect(max).toBe(149);
      expect(min).toBe(140);
    });
  });

  describe('technical indicator functions', () => {
    it('should correctly calculate RSI', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate(
        "RSI(CLOSE('BTC/USD', 30), 14)",
      );

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
      // Price is continuously rising, RSI should be close to 100
      expect(result).toBeGreaterThan(90);
    });

    it('should correctly calculate Bollinger Bands (BBANDS)', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate(
        "BBANDS(CLOSE('BTC/USD', 30), 20, 2)",
      );

      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('upper');
      expect(result).toHaveProperty('middle');
      expect(result).toHaveProperty('lower');

      const bands = result as { upper: number; middle: number; lower: number };
      expect(bands.upper).toBeGreaterThan(bands.middle);
      expect(bands.middle).toBeGreaterThan(bands.lower);
    });

    it('should correctly calculate MACD', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate(
        "MACD(CLOSE('BTC/USD', 50), 12, 26, 9)",
      );

      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('macd');
      expect(result).toHaveProperty('signal');
      expect(result).toHaveProperty('histogram');

      const macd = result as {
        macd: number;
        signal: number;
        histogram: number;
      };
      expect(typeof macd.macd).toBe('number');
      expect(typeof macd.signal).toBe('number');
      expect(typeof macd.histogram).toBe('number');
    });
  });

  describe('array access', () => {
    it('should support positive index access', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate(
        "CLOSE('BTC/USD', 10)[0]",
      );

      expect(typeof result).toBe('number');
      expect(result).toBe(140); // First element
    });

    it('should support negative index access', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate(
        "CLOSE('BTC/USD', 10)[-1]",
      );

      expect(typeof result).toBe('number');
      expect(result).toBe(149); // Last element
    });
  });

  describe('complex expressions', () => {
    it('should support arithmetic operations', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);

      // (latest close price - 10-period MA) / 10-period MA * 100
      const result = await calculator.calculate(
        "(CLOSE('BTC/USD', 1)[0] - SMA(CLOSE('BTC/USD', 10), 10)) / SMA(CLOSE('BTC/USD', 10), 10) * 100",
      );

      expect(typeof result).toBe('number');
      // 149 vs 144.5, deviation approximately 3.1%
      expect(result).toBeCloseTo(3.11, 1);
    });

    it('should support nested function calls', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);

      // 5-period MA of 20-period MA (double smoothing)
      const result = await calculator.calculate(
        "SMA(CLOSE('BTC/USD', 25), 20)",
      );

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('should support parentheses changing operator precedence', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);

      const result1 = await calculator.calculate('2 + 3 * 4');
      const result2 = await calculator.calculate('(2 + 3) * 4');

      expect(result1).toBe(14); // 2 + 12 = 14
      expect(result2).toBe(20); // 5 * 4 = 20
    });
  });

  describe('error handling', () => {
    it('should reject string results', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);

      // Returning a string directly should throw an error
      await expect(calculator.calculate("'BTC/USD'")).rejects.toThrow(
        'result cannot be a string',
      );
    });

    it('should handle division by zero', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);

      await expect(calculator.calculate('10 / 0')).rejects.toThrow(
        'Division by zero',
      );
    });

    it('should handle array out of bounds', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);

      await expect(
        calculator.calculate("CLOSE('BTC/USD', 10)[100]"),
      ).rejects.toThrow('Array index out of bounds');
    });

    it('should handle unknown functions', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);

      await expect(
        calculator.calculate("UNKNOWN_FUNC('BTC/USD', 10)"),
      ).rejects.toThrow('Unknown function: UNKNOWN_FUNC');
    });

    it('should handle syntax errors', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);

      // Missing closing parenthesis
      await expect(
        calculator.calculate("SMA(CLOSE('BTC/USD', 10), 20"),
      ).rejects.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle single candlestick case', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate("CLOSE('BTC/USD', 1)[0]");

      expect(typeof result).toBe('number');
      expect(result).toBe(149); // Last candlestick
    });

    it('should handle all candlesticks case', async () => {
      const calculator = new IndicatorCalculator(mockContext, currentTime);
      const result = await calculator.calculate("CLOSE('BTC/USD', 50)");

      expect(Array.isArray(result)).toBe(true);
      expect((result as number[]).length).toBe(50);
    });
  });
});
