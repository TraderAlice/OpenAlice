import { GetNewsV2Options, INewsProvider, NewsItem } from './interfaces';

/**
 * Parse a semantic time string into milliseconds
 *
 * Supported formats:
 * - Hours: 1h, 2h, 12h, 24h
 * - Days: 1d, 2d, 7d, 30d
 *
 * @param lookback - Semantic time string
 * @returns Milliseconds, or null if parsing fails
 */
export function parseLookback(lookback: string): number | null {
  const match = lookback.match(/^(\d+)(h|d)$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (unit === 'h') {
    return value * 60 * 60 * 1000; // Hours to milliseconds
  } else if (unit === 'd') {
    return value * 24 * 60 * 60 * 1000; // Days to milliseconds
  }

  return null;
}

/**
 * Real news data provider
 *
 * Based on preloaded news data
 */
export class RealNewsProvider implements INewsProvider {
  // News cache: preloaded news list (ascending by time)
  private newsCache: NewsItem[] = [];

  /**
   * Constructor: takes preloaded news data
   *
   * @param newsData - Preloaded news data
   */
  constructor(newsData: NewsItem[]) {
    this.newsCache = newsData;
    console.log(
      `[RealNewsProvider] Loaded ${newsData.length} news items to cache`,
    );
  }

  /**
   * Hot-reload cache data
   */
  reload(newsData: NewsItem[]): void {
    this.newsCache = newsData;
  }

  /**
   * Get news data within a time range (from preloaded cache)
   *
   * @param startTime - Start time (exclusive)
   * @param endTime - End time (inclusive)
   * @returns News within the time range (ascending by time)
   */
  async getNews(startTime: Date, endTime: Date): Promise<NewsItem[]> {
    // Filter from cache: startTime < newsTime <= endTime
    const filtered = this.newsCache.filter(
      (item) => item.time > startTime && item.time <= endTime,
    );

    // Already in ascending order, but sort again for safety
    filtered.sort((a, b) => a.time.getTime() - b.time.getTime());

    return filtered;
  }

  /**
   * Get news (V2)
   *
   * Supports semantic time (lookback) and count limit (limit)
   */
  async getNewsV2(options: GetNewsV2Options): Promise<NewsItem[]> {
    const { endTime, startTime, lookback, limit } = options;

    // 1. Determine head truncation time
    let effectiveStartTime: Date | null = null;

    if (startTime) {
      effectiveStartTime = startTime;
    } else if (lookback) {
      const ms = parseLookback(lookback);
      if (ms !== null) {
        effectiveStartTime = new Date(endTime.getTime() - ms);
      }
    }
    // If neither is provided, effectiveStartTime is null, meaning start from the earliest

    // 2. Filter by time range: (startTime, endTime]
    let filtered = this.newsCache.filter((item) => {
      if (item.time > endTime) return false; // Tail truncation
      if (effectiveStartTime && item.time <= effectiveStartTime) return false; // Head truncation
      return true;
    });

    // 3. Sort in ascending order by time (ensure correct order)
    filtered.sort((a, b) => a.time.getTime() - b.time.getTime());

    // 4. Apply limit (take the most recent N items from the tail)
    if (limit && filtered.length > limit) {
      filtered = filtered.slice(-limit);
    }

    return filtered;
  }

  /**
   * Get the number of cached news items
   */
  getNewsCount(): number {
    return this.newsCache.length;
  }
}
