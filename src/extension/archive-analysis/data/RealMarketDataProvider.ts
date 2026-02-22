import { IMarketDataProvider, MarketData } from './interfaces';

/**
 * Real candlestick data provider
 *
 * Based on preloaded historical OHLCV data
 */
export class RealMarketDataProvider implements IMarketDataProvider {
  // Candlestick cache: { symbol: { timestamp: MarketData } }
  private dataCache: Map<string, Map<number, MarketData>> = new Map();

  /**
   * Constructor: takes preloaded historical data
   *
   * @param historicalData - Historical OHLCV data fetched from CCXT
   *                         Format: { 'BTC/USDT': [{ time, open, high, low, close, volume }] }
   */
  constructor(historicalData: Record<string, MarketData[]>) {
    this.loadDataToCache(historicalData);
  }

  /**
   * Hot-reload cache data (clear and reload)
   */
  reload(data: Record<string, MarketData[]>): void {
    this.dataCache.clear();
    this.loadDataToCache(data);
  }

  /**
   * Load historical data into memory cache
   */
  private loadDataToCache(historicalData: Record<string, MarketData[]>): void {
    for (const symbol in historicalData) {
      const dataArray = historicalData[symbol];
      const symbolCache = new Map<number, MarketData>();

      for (const data of dataArray) {
        symbolCache.set(data.time, {
          ...data,
          symbol, // Ensure the symbol field is correct
        });
      }

      this.dataCache.set(symbol, symbolCache);
    }

    // loaded data silently
  }

  /**
   * Get market data at a specific point in time
   *
   * Strategy: find the most recent data point <= time
   */
  async getMarketData(time: Date, symbol: string): Promise<MarketData> {
    const symbolCache = this.dataCache.get(symbol);

    if (!symbolCache || symbolCache.size === 0) {
      throw new Error(
        `No historical data found for symbol: ${symbol}. Please preload data before running backtest.`,
      );
    }

    // Convert Date to Unix timestamp (seconds)
    const queryTimestamp = Math.floor(time.getTime() / 1000);

    // Find the most recent data point <= queryTimestamp
    let closestData: MarketData | null = null;
    let closestTimeDiff = Infinity;

    for (const [timestamp, data] of symbolCache.entries()) {
      if (timestamp <= queryTimestamp) {
        const timeDiff = queryTimestamp - timestamp;
        if (timeDiff < closestTimeDiff) {
          closestTimeDiff = timeDiff;
          closestData = data;
        }
      }
    }

    if (!closestData) {
      throw new Error(
        `No data available for ${symbol} at or before ${time.toISOString()}. ` +
          `Data range starts from ${new Date(Math.min(...symbolCache.keys()) * 1000).toISOString()}`,
      );
    }

    return closestData;
  }

  /**
   * Get all candlestick data within a time range
   *
   * @param startTime - Start time (exclusive)
   * @param endTime - End time (inclusive)
   * @param symbol - Trading pair
   * @returns All candlesticks within the time range (ascending by time)
   */
  async getMarketDataRange(
    startTime: Date,
    endTime: Date,
    symbol: string,
  ): Promise<MarketData[]> {
    const symbolCache = this.dataCache.get(symbol);

    if (!symbolCache || symbolCache.size === 0) {
      throw new Error(
        `No historical data found for symbol: ${symbol}. Please preload data before running backtest.`,
      );
    }

    const startTimestamp = Math.floor(startTime.getTime() / 1000);
    const endTimestamp = Math.floor(endTime.getTime() / 1000);

    const result: MarketData[] = [];

    for (const [timestamp, data] of symbolCache.entries()) {
      // startTime < timestamp <= endTime
      if (timestamp > startTimestamp && timestamp <= endTimestamp) {
        result.push(data);
      }
    }

    // Sort in ascending order by time
    result.sort((a, b) => a.time - b.time);

    return result;
  }

  getAvailableSymbols(): string[] {
    return Array.from(this.dataCache.keys());
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    symbols: string[];
    totalDataPoints: number;
    timeRange: Record<string, { start: Date; end: Date }>;
  } {
    const stats = {
      symbols: Array.from(this.dataCache.keys()),
      totalDataPoints: 0,
      timeRange: {} as Record<string, { start: Date; end: Date }>,
    };

    for (const [symbol, cache] of this.dataCache.entries()) {
      stats.totalDataPoints += cache.size;

      const timestamps = Array.from(cache.keys()).sort((a, b) => a - b);
      if (timestamps.length > 0) {
        stats.timeRange[symbol] = {
          start: new Date(timestamps[0] * 1000),
          end: new Date(timestamps[timestamps.length - 1] * 1000),
        };
      }
    }

    return stats;
  }
}
