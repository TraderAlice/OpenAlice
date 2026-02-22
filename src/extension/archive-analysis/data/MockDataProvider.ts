import {
  GetNewsV2Options,
  IMarketDataProvider,
  INewsProvider,
  MarketData,
  NewsItem,
} from './interfaces';

/**
 * Mock data source (for testing)
 *
 * Fully simulates the RealDataProvider interface behavior, generating pseudo-random but deterministic OHLCV data.
 * Production should use RealMarketDataProvider + RealNewsProvider to load real data.
 */
export class MockDataProvider
  implements IMarketDataProvider, INewsProvider
{
  constructor(private availableSymbols: string[] = ['BTC/USD', 'ETH/USD', 'SOL/USD']) {}

  getAvailableSymbols(): string[] {
    return this.availableSymbols;
  }

  async getMarketData(time: Date, symbol: string): Promise<MarketData> {
    // Simulate latency
    await this.sleep(50);

    // Generate pseudo-random prices based on time (ensures same time point returns same data)
    const seed = time.getTime() + this.hashString(symbol);
    const basePrice = 50000 + (this.seededRandom(seed) - 0.5) * 10000;

    // Generate OHLCV data
    const open = basePrice;
    const high = basePrice * (1 + this.seededRandom(seed + 1) * 0.02);
    const low = basePrice * (1 - this.seededRandom(seed + 2) * 0.02);
    const close = low + (high - low) * this.seededRandom(seed + 3);

    return {
      symbol,
      time: Math.floor(time.getTime() / 1000), // Unix timestamp (seconds)
      open,
      high,
      low,
      close,
      volume: this.seededRandom(seed + 4) * 1000,
    };
  }

  async getMarketDataRange(
    startTime: Date,
    endTime: Date,
    symbol: string,
  ): Promise<MarketData[]> {
    // Mock data: simply generate hourly candlesticks within the time range
    const result: MarketData[] = [];
    const current = new Date(startTime);
    current.setHours(current.getHours() + 1); // Start from the next hour after startTime

    while (current <= endTime) {
      const candle = await this.getMarketData(current, symbol);
      result.push(candle);
      current.setHours(current.getHours() + 1);
    }

    return result;
  }

  async getNews(startTime: Date, endTime: Date): Promise<NewsItem[]> {
    await this.sleep(30);

    // Mock data: simply return an empty array
    // Real usage should use RealDataProvider
    return [];
  }

  async getNewsV2(_options: GetNewsV2Options): Promise<NewsItem[]> {
    await this.sleep(30);

    // Mock data: simply return an empty array
    return [];
  }

  // ==================== Utility methods ====================

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }
}
