/**
 * News Search — Seltz-powered web news search
 *
 * Provides a `searchNews` AI tool that queries the live web for news articles
 * using the Seltz search API with scope: "news". Complements the RSS-based
 * archive tools (globNews/grepNews/readNews) with on-demand semantic search.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { Seltz } from 'seltz'

export function createNewsSearchTools() {
  const client = new Seltz()

  return {
    searchNews: tool({
      description: `Search the live web for news articles using semantic search (powered by Seltz).

Unlike globNews/grepNews which search the local RSS archive, this tool queries the
full web for current and recent news. Use it when:
- You need news on a topic not covered by the RSS feeds
- You want broader coverage than the local archive
- You need to find news from a specific date range or domain

Returns documents with URL, content summary, and publication date.`,
      inputSchema: z.object({
        query: z.string().describe('Search query — keep concise for best results'),
        maxResults: z.number().int().positive().max(20).optional().default(10)
          .describe('Max results to return (default: 10, max: 20)'),
        includeDomains: z.array(z.string()).optional()
          .describe('Only include results from these domains (e.g. ["reuters.com", "bloomberg.com"])'),
        excludeDomains: z.array(z.string()).optional()
          .describe('Exclude results from these domains'),
        fromDate: z.string().optional()
          .describe('Only results published on or after this date (ISO 8601, e.g. "2025-10-28")'),
        toDate: z.string().optional()
          .describe('Only results published on or before this date (ISO 8601, e.g. "2026-05-07")'),
      }),
      execute: async ({ query, maxResults, includeDomains, excludeDomains, fromDate, toDate }) => {
        const response = await client.search({
          query,
          maxResults,
          scope: 'news',
          includeDomains,
          excludeDomains,
          fromDate,
          toDate,
        })

        return response.documents.map((doc) => ({
          url: doc.url ?? null,
          content: doc.content ?? null,
          publishedDate: doc.publishedDate ?? null,
        }))
      },
    }),
  }
}
