/**
 * News AI Tools
 *
 * newsGetWorld:  全球新闻，用于宏观面判断。
 * newsGetCompany: 个股新闻，用于事件驱动和异动归因。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { OpenBBNewsClient } from '@/openbb/news/client'

export function createNewsTools(newsClient: OpenBBNewsClient) {
  return {
    newsGetWorld: tool({
      description: `Get world news headlines.

Returns recent global news articles with title, date, source, and URL.
Useful for understanding macro sentiment, geopolitical events, and market-moving headlines.`,
      inputSchema: z.object({
        limit: z.number().int().positive().optional().describe('Number of articles to return (default: 20)'),
      }),
      execute: async ({ limit }) => {
        const params: Record<string, unknown> = {}
        if (limit) params.limit = limit
        return await newsClient.getWorldNews(params)
      },
    }),

    newsGetCompany: tool({
      description: `Get news for a specific company.

Returns recent news articles related to the given stock symbol.
Essential for understanding price movements, earnings reactions, and corporate events.

Use equitySearch first to resolve the correct symbol.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL", "TSLA"'),
        limit: z.number().int().positive().optional().describe('Number of articles to return (default: 20)'),
      }),
      execute: async ({ symbol, limit }) => {
        const params: Record<string, unknown> = { symbol }
        if (limit) params.limit = limit
        return await newsClient.getCompanyNews(params)
      },
    }),
  }
}
