import type { IMarketDataProvider, NewsItem } from '../analysis-kit/data/interfaces';

/**
 * Narrow context interface for analysis tools.
 *
 * Abstracts away Sandbox internals -- tools only see what they need.
 * The Sandbox class structurally satisfies this interface.
 */
export interface IAnalysisContext {
  /** Current playhead time */
  getPlayheadTime(): Date;

  /** Batch-fetch latest OHLCV for given symbols */
  getLatestOHLCV(symbols: string[]): Promise<Array<{
    symbol: string;
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    interval: string;
  }>>;

  /** Get news with time/lookback filtering */
  getNewsV2(options: { lookback?: string; limit?: number }): Promise<NewsItem[]>;

  /** Get available trading symbols */
  getAvailableSymbols(): string[];

  /** Calculate start time for N-candlestick lookback */
  calculatePreviousTime(lookback: number): Date;

  /** Market data provider (for indicator engine) */
  readonly marketDataProvider: IMarketDataProvider;
}
