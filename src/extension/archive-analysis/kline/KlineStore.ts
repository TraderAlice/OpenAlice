import type { IMarketDataProvider } from '../data/interfaces';

/**
 * K-line (candlestick) data store with time isolation.
 *
 * Wraps an IMarketDataProvider and enforces that all queries
 * are bounded by playheadTime (cannot see future data).
 */
export class KlineStore {
  private playheadTime: Date;
  private timeframe: string;
  readonly marketDataProvider: IMarketDataProvider;

  constructor(
    config: { timeframe: string },
    marketDataProvider: IMarketDataProvider,
  ) {
    this.timeframe = config.timeframe;
    this.playheadTime = new Date();
    this.marketDataProvider = marketDataProvider;
  }

  // ==================== Time management ====================

  getPlayheadTime(): Date {
    return new Date(this.playheadTime);
  }

  setPlayheadTime(time: Date): void {
    this.playheadTime = new Date(time);
  }

  // ==================== Market data ====================

  /**
   * Batch fetch the latest OHLCV candlesticks
   */
  async getLatestOHLCV(symbols: string[]) {
    return await Promise.all(
      symbols.map(async (symbol) => {
        const marketData = await this.marketDataProvider.getMarketData(
          this.playheadTime,
          symbol,
        );
        return { ...marketData, interval: this.timeframe };
      }),
    );
  }

  /**
   * Return all available symbols in the dataset (asset/currency format)
   */
  getAvailableSymbols(): string[] {
    return this.marketDataProvider.getAvailableSymbols();
  }

  /**
   * Search symbols by asset name
   * e.g. "BTC" -> ["BTC/USD"], "BTC/USD" -> ["BTC/USD"]
   */
  searchSymbols(query: string): string[] {
    const q = query.toUpperCase();
    return this.marketDataProvider.getAvailableSymbols().filter(s => {
      const asset = s.split('/')[0];
      return asset === q || s === q;
    });
  }

  // ==================== Utility methods ====================

  /**
   * Calculate the start time for looking back N candlesticks based on timeframe
   */
  calculatePreviousTime(lookback: number): Date {
    const startTime = new Date(this.playheadTime);

    if (this.timeframe.endsWith('d')) {
      const days = parseInt(this.timeframe.replace('d', ''));
      startTime.setDate(startTime.getDate() - lookback * days);
    } else if (this.timeframe.endsWith('h')) {
      const hours = parseInt(this.timeframe.replace('h', ''));
      startTime.setHours(startTime.getHours() - lookback * hours);
    } else if (this.timeframe.endsWith('m')) {
      const minutes = parseInt(this.timeframe.replace('m', ''));
      startTime.setMinutes(startTime.getMinutes() - lookback * minutes);
    } else {
      throw new Error(`Unsupported timeframe: ${this.timeframe}`);
    }

    return startTime;
  }
}
