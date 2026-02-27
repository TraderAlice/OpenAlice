/**
 * News Collector — Type definitions
 */

/** On-disk JSONL record for a single news article */
export interface NewsRecord {
  /** Monotonic sequence number (for ordering / recovery) */
  seq: number
  /** Ingestion timestamp (epoch ms) — when we received it */
  ts: number
  /** Publication timestamp (epoch ms) — from RSS pubDate or API date */
  pubTs: number
  /** Dedup key (guid:..., link:..., or hash:...) */
  dedupKey: string
  /** Article title / headline */
  title: string
  /** Article content / summary */
  content: string
  /** Extensible metadata: source, link, guid, ingestSource, category, etc. */
  metadata: Record<string, string | null>
}

/** RSS feed configuration entry */
export interface RSSFeedConfig {
  /** Human-readable name, e.g. "CoinDesk" */
  name: string
  /** RSS / Atom feed URL */
  url: string
  /** Source tag stored in metadata.source */
  source: string
  /** Optional category tags */
  categories?: string[]
}

/** Discriminator for how a news item was ingested */
export type IngestSource = 'rss' | 'openbb-world' | 'openbb-company'

// ==================== News Provider Interface ====================

/** A single news article (in-memory representation) */
export interface NewsItem {
  time: Date
  title: string
  content: string
  metadata: Record<string, string | null>
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
  endTime: Date
  /** Head truncation: exact timestamp (mutually exclusive with lookback) */
  startTime?: Date
  /** Head truncation: semantic time, e.g. "1h", "12h", "1d", "7d" (mutually exclusive with startTime) */
  lookback?: string
  /** Count limit: take the most recent N items from the tail (takes priority over time range) */
  limit?: number
}

/** News data provider interface */
export interface INewsProvider {
  /**
   * Get news within a time range
   *
   * @param startTime - Start time (exclusive)
   * @param endTime - End time (inclusive)
   * @returns News within the time range (ascending by time)
   */
  getNews(startTime: Date, endTime: Date): Promise<NewsItem[]>

  /**
   * Get news (V2, supports semantic time and count limit)
   *
   * @param options - Query options
   * @returns News list (ascending by time, newest last)
   */
  getNewsV2(options: GetNewsV2Options): Promise<NewsItem[]>
}
