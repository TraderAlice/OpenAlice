/**
 * Crypto AI Tools
 *
 * cryptoSearch:
 *   直接透传 query 给 yfinance 的在线搜索，不需要本地缓存。
 *   yfinance 自带模糊匹配，同时保证搜索结果和 K 线数据源一致。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { OpenBBCryptoClient } from '@/openbb/crypto/client'

export function createCryptoTools(cryptoClient: OpenBBCryptoClient) {
  return {
    cryptoSearch: tool({
      description: `Search for cryptocurrency symbols by keyword.

Matches against symbol, name, and exchange via Yahoo Finance fuzzy search.
Examples: "BTC" → BTCUSD, BTCEUR; "ethereum" → ETHUSD; "sol" → SOLUSD.

Use this FIRST to find the correct symbol before querying any crypto data.`,
      inputSchema: z.object({
        query: z.string().describe('Keyword to search, e.g. "BTC", "ethereum", "solana"'),
      }),
      execute: async ({ query }) => {
        const results = await cryptoClient.search({ query, provider: 'yfinance' })
        if (results.length === 0) {
          return { results: [], message: `No crypto matching "${query}". Try a different keyword.` }
        }
        return { results, count: results.length }
      },
    }),
  }
}
