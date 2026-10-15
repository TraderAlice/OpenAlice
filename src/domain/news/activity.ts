import type { NewsRecord } from './types.js'
import { safeHttpImageUrl } from './collector/rss-parser.js'

/** Bounded product fact, recorded only after the article's durable ingest. */
export function newsActivityPayload(record: NewsRecord) {
  const image = safeHttpImageUrl(record.metadata.image ?? null)
  return {
    newsItemId: record.seq,
    dedupKey: record.dedupKey,
    title: record.title,
    ...(record.metadata.source ? { source: record.metadata.source } : {}),
    ...(record.metadata.link ? { link: record.metadata.link } : {}),
    publishedAt: record.pubTs,
    ingestSource: record.metadata.ingestSource ?? 'rss',
    ...(image ? { image } : {}),
  }
}
