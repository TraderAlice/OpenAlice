import { materialSchema } from './modules/contract.js'
import type { NewsItem } from './types.js'
import { cleanRssHeadline } from './collector/rss-parser.js'

const originalSchema = materialSchema.pick({ publisher: true, author: true, kind: true, role: true, language: true, symbols: true, media: true, quote: true })

export function isImportantReport(item: Pick<NewsItem, 'metadata'>): boolean {
  return (item.metadata.categories ?? '').split(/[;,]/).some(tag => ['important', 'breaking', 'urgent', 'top'].includes(tag.trim().toLowerCase()))
}

export function newsReport(item: NewsItem) {
  const contentBasis = item.metadata.contentBasis
  const value: Record<string, unknown> = {}
  for (const key of ['publisher', 'author', 'kind', 'role', 'language']) if (item.metadata[key] != null) value[key] = item.metadata[key]
  for (const key of ['symbols', 'media', 'quote']) {
    try { if (item.metadata[key]) value[key] = JSON.parse(item.metadata[key]!) } catch { /* Historical metadata can be incomplete. */ }
  }
  const parsed = originalSchema.safeParse(value)
  let image: string | null = null
  try {
    const url = new URL(item.metadata.image ?? '')
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) image = item.metadata.image!.trim()
  } catch { /* An original need not have an image. */ }
  return { id: item.id, time: item.time.toISOString(), title: item.metadata.ingestSource === 'rss' ? cleanRssHeadline(item.title) : item.title, content: item.content,
    ...(isImportantReport(item) ? { important: true } : {}),
    ...(item.metadata.timeBasis === 'collection' ? { timeBasis: 'collection' as const } : {}),
    ...(contentBasis === 'feed-content' || contentBasis === 'feed-summary' || contentBasis === 'missing' ? { contentBasis } : {}),
    ...(parsed.success ? parsed.data : {}), source: item.metadata.publisher ?? item.metadata.source ?? null,
    link: item.metadata.link ?? null, categories: item.metadata.categories ?? null, image,
  }
}
