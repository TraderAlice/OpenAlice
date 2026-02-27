/**
 * News Collector — Public exports
 */

export { NewsCollectorStore, computeDedupKey } from './store.js'
export type { NewsCollectorStoreOpts } from './store.js'
export { NewsCollector } from './collector.js'
export type { CollectorOpts } from './collector.js'
export { wrapNewsToolsForPiggyback } from './piggyback.js'
export { createNewsArchiveTools } from './tools.js'
export { newsCollectorSchema } from './config.js'
export type { NewsCollectorConfig } from './config.js'
export type { NewsRecord, RSSFeedConfig, IngestSource } from './types.js'
