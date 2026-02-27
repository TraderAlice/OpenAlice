/**
 * News Collector — Archive tools (globNews / grepNews / readNews)
 *
 * Creates AI tools that query the persistent news store.
 * Uses endTime = new Date() (real-time mode, not backtesting).
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { INewsProvider, NewsItem } from './types.js'

const NEWS_LIMIT = 500

// ==================== Pure functions (testable) ====================

/** Context injected into pure functions */
export interface NewsToolContext {
  getNews: () => Promise<NewsItem[]>
}

export interface GlobNewsResult {
  index: number
  title: string
  contentLength: number
  metadata: string
}

export interface GrepNewsResult {
  index: number
  title: string
  matchedText: string
  contentLength: number
  metadata: string
}

function truncateMetadata(metadata: Record<string, string | null>, maxLength: number = 40): string {
  const str = JSON.stringify(metadata)
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

function matchesMetadataFilter(metadata: Record<string, string | null>, filter: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false
  }
  return true
}

/** Match news by title regex (like "ls" / "glob") */
export async function globNews(
  context: NewsToolContext,
  options: {
    pattern: string
    metadataFilter?: Record<string, string>
    limit?: number
  },
): Promise<GlobNewsResult[]> {
  const news = await context.getNews()
  const regex = new RegExp(options.pattern, 'i')
  const results: GlobNewsResult[] = []

  for (let i = 0; i < news.length; i++) {
    const item = news[i]
    if (options.metadataFilter && !matchesMetadataFilter(item.metadata, options.metadataFilter)) continue
    if (!regex.test(item.title)) continue

    results.push({
      index: i,
      title: item.title,
      contentLength: item.content.length,
      metadata: truncateMetadata(item.metadata),
    })

    if (options.limit && results.length >= options.limit) break
  }

  return results
}

/** Search news content by pattern (like "grep") */
export async function grepNews(
  context: NewsToolContext,
  options: {
    pattern: string
    contextChars?: number
    metadataFilter?: Record<string, string>
    limit?: number
  },
): Promise<GrepNewsResult[]> {
  const news = await context.getNews()
  const regex = new RegExp(options.pattern, 'gi')
  const contextChars = options.contextChars ?? 50
  const results: GrepNewsResult[] = []

  for (let i = 0; i < news.length; i++) {
    const item = news[i]
    if (options.metadataFilter && !matchesMetadataFilter(item.metadata, options.metadataFilter)) continue

    const searchText = `${item.title}\n${item.content}`
    const match = regex.exec(searchText)
    if (!match) continue

    const matchStart = match.index
    const matchEnd = matchStart + match[0].length
    const contextStart = Math.max(0, matchStart - contextChars)
    const contextEnd = Math.min(searchText.length, matchEnd + contextChars)

    let matchedText = ''
    if (contextStart > 0) matchedText += '...'
    matchedText += searchText.slice(contextStart, contextEnd)
    if (contextEnd < searchText.length) matchedText += '...'

    results.push({
      index: i,
      title: item.title,
      matchedText,
      contentLength: item.content.length,
      metadata: truncateMetadata(item.metadata),
    })

    regex.lastIndex = 0

    if (options.limit && results.length >= options.limit) break
  }

  return results
}

/** Read full news content by index (like "cat") */
export async function readNews(
  context: NewsToolContext,
  options: { index: number },
): Promise<NewsItem | null> {
  const news = await context.getNews()
  if (options.index < 0 || options.index >= news.length) return null
  return news[options.index]
}

// ==================== AI Tool factory ====================

export function createNewsArchiveTools(provider: INewsProvider) {
  return {
    globNews: tool({
      description: `Search collected news archive by title pattern (like "ls" / "glob").

Returns matching headlines with index, title, content length, and metadata preview.
Use this to quickly scan what's been happening in the market.

Time range control:
- lookback: "1h", "2h", "12h", "1d", "7d" (default: all available news)

Example: globNews({ pattern: "BTC|Bitcoin", lookback: "1d" })`,
      inputSchema: z.object({
        pattern: z.string().describe('Regex to match against news titles'),
        lookback: z.string().optional().describe('Time range: "1h", "12h", "1d", "7d"'),
        metadataFilter: z.record(z.string(), z.string()).optional().describe('Filter by metadata key-value'),
        limit: z.number().int().positive().optional().describe('Max results'),
      }),
      execute: async ({ pattern, lookback, metadataFilter, limit }) => {
        return globNews(
          { getNews: () => provider.getNewsV2({ endTime: new Date(), lookback, limit: NEWS_LIMIT }) },
          { pattern, metadataFilter, limit },
        )
      },
    }),

    grepNews: tool({
      description: `Search collected news archive content by pattern (like "grep").

Returns matched text with surrounding context.
Use this to find specific mentions in news articles.

Example: grepNews({ pattern: "interest rate", lookback: "2d" })`,
      inputSchema: z.object({
        pattern: z.string().describe('Regex to search in title and content'),
        lookback: z.string().optional().describe('Time range: "1h", "12h", "1d", "7d"'),
        contextChars: z.number().int().positive().optional().describe('Context chars around match (default: 50)'),
        metadataFilter: z.record(z.string(), z.string()).optional().describe('Filter by metadata key-value'),
        limit: z.number().int().positive().optional().describe('Max results'),
      }),
      execute: async ({ pattern, lookback, contextChars, metadataFilter, limit }) => {
        return grepNews(
          { getNews: () => provider.getNewsV2({ endTime: new Date(), lookback, limit: NEWS_LIMIT }) },
          { pattern, contextChars, metadataFilter, limit },
        )
      },
    }),

    readNews: tool({
      description: `Read full content of a collected news item by index (like "cat").

Use after globNews/grepNews to read a specific article.
Use the same lookback as your previous query for consistent indices.`,
      inputSchema: z.object({
        index: z.number().int().nonnegative().describe('News index from globNews/grepNews results'),
        lookback: z.string().optional().describe('Match the lookback from your prior globNews/grepNews call'),
      }),
      execute: async ({ index, lookback }) => {
        const result = await readNews(
          { getNews: () => provider.getNewsV2({ endTime: new Date(), lookback, limit: NEWS_LIMIT }) },
          { index },
        )
        return result ?? { error: `News index ${index} not found` }
      },
    }),
  }
}
