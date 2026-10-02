/** Category interpretation shared by the HTTP list, demo and news reader.
 * RSS categories describe the feed. A missing provenance marker proves nothing.
 * Stored records remain untouched; this is a read-time interpretation.
 */
export type NewsCategoryScope = 'source' | 'article' | 'unknown'
export type NewsTagDimension = 'region' | 'market' | 'industry' | 'topic' | 'unknown'

const DEFINITIONS = [
  { value: 'us', dimension: 'region', labelKey: 'news.regionUs', aliases: ['usa', 'united-states'] },
  { value: 'cn', dimension: 'region', labelKey: 'news.regionChina', aliases: ['china'] },
  { value: 'hk', dimension: 'region', labelKey: 'news.regionHk', aliases: ['hong-kong', 'hong kong'] },
  { value: 'asia', dimension: 'region', labelKey: 'news.regionAsia', aliases: [] },
  { value: 'world', dimension: 'region', labelKey: 'news.regionWorld', aliases: [] },
  { value: 'a-shares', dimension: 'market', labelKey: 'news.categoryAShares', aliases: ['a-share', 'ashare'] },
  { value: 'us-stocks', dimension: 'market', labelKey: 'news.categoryUs', aliases: ['us-equities'] },
  { value: 'hk-stocks', dimension: 'market', labelKey: 'news.categoryHk', aliases: ['hk-equities'] },
  { value: 'chinext', dimension: 'market', labelKey: 'news.categoryChiNext', aliases: [] },
  { value: 'star-market', dimension: 'market', labelKey: 'news.categoryStar', aliases: ['sci-tech-innovation-board'] },
  { value: 'bse', dimension: 'market', labelKey: 'news.categoryBse', aliases: ['beijing-stock-exchange'] },
  { value: 'neeq', dimension: 'market', labelKey: 'news.categoryNeeq', aliases: ['new-third-board'] },
  { value: 'technology', dimension: 'industry', labelKey: 'news.industryTechnology', aliases: ['tech'] },
  { value: 'financials', dimension: 'industry', labelKey: 'news.industryFinancials', aliases: [] },
  { value: 'industrials', dimension: 'industry', labelKey: 'news.industryIndustrials', aliases: [] },
  { value: 'crypto', dimension: 'topic', labelKey: 'news.topicCrypto', aliases: [] },
  { value: 'markets', dimension: 'topic', labelKey: 'news.topicMarkets', aliases: [] },
  { value: 'news', dimension: 'topic', labelKey: 'news.topicNews', aliases: [] },
  { value: 'rates', dimension: 'topic', labelKey: 'news.topicRates', aliases: [] },
  { value: 'fx', dimension: 'topic', labelKey: 'news.categoryFx', aliases: ['forex'] },
  { value: 'bonds', dimension: 'topic', labelKey: 'news.categoryBonds', aliases: ['bond'] },
  { value: 'futures', dimension: 'topic', labelKey: 'news.categoryFutures', aliases: [] },
  { value: 'funds', dimension: 'topic', labelKey: 'news.categoryFunds', aliases: ['fund'] },
  { value: 'options', dimension: 'topic', labelKey: 'news.categoryOptions', aliases: [] },
  { value: 'warrants', dimension: 'topic', labelKey: 'news.categoryWarrants', aliases: [] },
  { value: 'wealth', dimension: 'topic', labelKey: 'news.categoryWealth', aliases: ['wealth-management'] },
  { value: 'themes', dimension: 'topic', labelKey: 'news.categoryThemes', aliases: ['theme'] },
  { value: 'earnings', dimension: 'topic', labelKey: 'news.topicEarnings', aliases: [] },
  { value: 'ipo', dimension: 'topic', labelKey: 'news.categoryIpo', aliases: [] },
  { value: 'macro', dimension: 'topic', labelKey: 'news.categoryMacro', aliases: [] },
  { value: 'important', dimension: 'topic', labelKey: 'news.viewImportant', aliases: [] },
  { value: 'positive', dimension: 'topic', labelKey: 'news.viewPositive', aliases: ['bullish'] },
  { value: 'negative', dimension: 'topic', labelKey: 'news.viewNegative', aliases: ['bearish'] },
] as const

export interface NewsTag {
  value: string
  scope: NewsCategoryScope
  dimension: NewsTagDimension
}

export function newsCategoryScope(metadata: Record<string, string | null>): NewsCategoryScope {
  return metadata.ingestSource === 'rss' ? 'source' : 'unknown'
}

export function newsTagDefinition(value: string) {
  return DEFINITIONS.find((entry) => entry.value === value || (entry.aliases as readonly string[]).includes(value))
}

export function newsTags(categories: string | null | undefined, scope: NewsCategoryScope = 'unknown'): NewsTag[] {
  const tags = new Map<string, NewsTag>()
  for (const raw of (categories ?? '').split(/[;,]/)) {
    const value = raw.trim().toLowerCase()
    if (!value) continue
    const definition = scope === 'unknown' ? undefined : newsTagDefinition(value)
    const tag: NewsTag = { scope, dimension: definition?.dimension ?? 'unknown', value: definition?.value ?? raw.trim() }
    tags.set(newsTagKey(tag), tag)
  }
  return [...tags.values()]
}

export function newsTagKey(tag: NewsTag): string {
  return `${tag.scope}:${tag.dimension}:${tag.value.toLowerCase()}`
}

/** Reject mismatched dimensions; normalize only actual aliases within an origin. */
export function normalizeNewsTagFilter(raw: string): string | null {
  const match = raw.trim().toLowerCase().match(/^(source|article|unknown):([^:]+):(.+)$/)
  if (!match) return null
  const tags = newsTags(match[3], match[1] as NewsCategoryScope)
  return tags.length === 1 && tags[0].dimension === match[2] ? newsTagKey(tags[0]) : null
}
