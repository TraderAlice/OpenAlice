/**
 * News Collector — Archive tools (globNews / grepNews / readNews)
 *
 * Creates AI tools that query the persistent news store.
 * Delegates to the pure functions in archive-analysis/tools/news.tool.ts.
 * Uses endTime = new Date() (real-time mode, not backtesting).
 */

import { tool } from 'ai'
import { z } from 'zod'
import { globNews, grepNews, readNews } from '../archive-analysis/tools/news.tool.js'
import type { INewsProvider } from '../archive-analysis/data/interfaces.js'

const NEWS_LIMIT = 500

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
