import { describe, expect, it } from 'vitest'
import { newsCategoryScope, newsTags, newsTagKey, normalizeNewsTagFilter } from './tags.js'

describe('news category provenance and dimensions', () => {
  it('only identifies feed coverage from the stored collector marker', () => {
    expect(newsCategoryScope({ ingestSource: 'rss', source: 'Reuters' })).toBe('source')
    expect(newsCategoryScope({ source: 'Reuters', categories: 'us' })).toBe('unknown')
    expect(newsCategoryScope({ source: 'MarketWatch', categoryScope: 'article' })).toBe('unknown')
  })
  it('deduplicates real aliases without equating country, exchange or sector', () => {
    expect(newsTags('US,usa,cn,China,a-share,us-stocks,tech,technology,earnings,Unmapped', 'source').map(newsTagKey)).toEqual([
      'source:region:us', 'source:region:cn', 'source:market:a-shares', 'source:market:us-stocks',
      'source:industry:technology', 'source:topic:earnings', 'source:unknown:unmapped',
    ])
  })
  it('labels existing feed topics without equating rates with bonds or crypto with equities', () => {
    expect(newsTags('markets,news,crypto,rates,bonds', 'source').map(newsTagKey)).toEqual([
      'source:topic:markets', 'source:topic:news', 'source:topic:crypto', 'source:topic:rates', 'source:topic:bonds',
    ])
  })
  it('retains unproven tags as raw information without guessing or folding aliases', () => {
    expect(newsTags('US,USA,Legacy', 'unknown')).toEqual([
      { scope: 'unknown', dimension: 'unknown', value: 'US' },
      { scope: 'unknown', dimension: 'unknown', value: 'USA' },
      { scope: 'unknown', dimension: 'unknown', value: 'Legacy' },
    ])
  })
  it('validates the complete filter identity and normalizes only true aliases', () => {
    expect(normalizeNewsTagFilter('SOURCE:REGION:USA')).toBe('source:region:us')
    expect(normalizeNewsTagFilter('article:market:us')).toBeNull()
    expect(normalizeNewsTagFilter('region:us')).toBeNull()
    expect(normalizeNewsTagFilter('unknown:unknown:US')).toBe('unknown:unknown:us')
  })
})
