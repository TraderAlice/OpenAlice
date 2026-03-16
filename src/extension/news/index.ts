/**
 * News — Public exports
 */

export { NewsCollectorStore, computeDedupKey, parseLookback } from './store.js'
export type { NewsCollectorStoreOpts } from './store.js'
export { NewsCollector } from './collector/rss.js'
export type { CollectorOpts } from './collector/rss.js'
export { createNewsArchiveTools } from './query/archive.js'
export { newsCollectorSchema } from './config.js'
export type { NewsCollectorConfig } from './config.js'
export type { NewsRecord, RSSFeedConfig, IngestSource, NewsItem, INewsProvider, GetNewsV2Options } from './types.js'
