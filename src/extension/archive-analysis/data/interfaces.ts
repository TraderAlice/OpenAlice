/**
 * Market data provider interface (candlestick data)
 */
export interface IMarketDataProvider {
  /**
   * Get market data at a specific point in time
   *
   * @param time - Current sandbox time
   * @param symbol - Trading pair
   * @returns Market data (can only retrieve data before time)
   */
  getMarketData(time: Date, symbol: string): Promise<MarketData>;

  /**
   * Get all candlestick data within a time range
   *
   * @param startTime - Start time (exclusive)
   * @param endTime - End time (inclusive)
   * @param symbol - Trading pair
   * @returns All candlesticks within the time range (ascending by time)
   */
  getMarketDataRange(
    startTime: Date,
    endTime: Date,
    symbol: string,
  ): Promise<MarketData[]>;

  /**
   * Return all available symbols in the dataset
   *
   * Format: standard asset/currency pairs, e.g. ['BTC/USD', 'ETH/USD']
   */
  getAvailableSymbols(): string[];
}

/**
 * Query options for getNewsV2
 *
 * Supports two head truncation methods (choose one):
 * - startTime: Exact timestamp
 * - lookback: Semantic time, e.g. "1h", "2d", "7d"
 *
 * limit is independent of head truncation, takes the most recent N items from the tail
 */
export interface GetNewsV2Options {
  /** Tail truncation time (required, cannot see news after this time) */
  endTime: Date;
  /** Head truncation: exact timestamp (mutually exclusive with lookback) */
  startTime?: Date;
  /** Head truncation: semantic time, e.g. "1h", "12h", "1d", "7d" (mutually exclusive with startTime) */
  lookback?: string;
  /** Count limit: take the most recent N items from the tail (takes priority over time range) */
  limit?: number;
}

/**
 * News data provider interface
 */
export interface INewsProvider {
  /**
   * Get news within a time range
   *
   * @param startTime - Start time (exclusive)
   * @param endTime - End time (inclusive)
   * @returns News within the time range (ascending by time)
   */
  getNews(startTime: Date, endTime: Date): Promise<NewsItem[]>;

  /**
   * Get news (V2, supports semantic time and count limit)
   *
   * Features:
   * 1. Parameters passed via destructuring
   * 2. Supports exact timestamp or semantic time (e.g. "1h", "2d") for head truncation
   * 3. Supports limit to take the most recent N items from the tail
   * 4. endTime is a hard constraint -- can never see future news
   *
   * @param options - Query options
   * @returns News list (ascending by time, newest last)
   */
  getNewsV2(options: GetNewsV2Options): Promise<NewsItem[]>;
}

/**
 * @deprecated Use IMarketDataProvider and INewsProvider instead
 */
export interface IDataProvider extends IMarketDataProvider, INewsProvider {}

/**
 * OHLCV market data (consistent with CCXT format)
 */
export interface MarketData {
  symbol: string;
  time: number; // Unix timestamp (seconds)
  open: number; // Open price
  high: number; // High price
  low: number; // Low price
  close: number; // Close price
  volume: number; // Volume
}

export interface NewsItem {
  time: Date;
  title: string;
  content: string;
  metadata: Record<string, string | null>;
}
