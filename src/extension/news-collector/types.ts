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
