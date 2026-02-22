/**
 * Currency AI Tools
 *
 * currencySearch:
 *   透传 query 给 yfinance 在线搜索，只返回 XXXUSD 交易对。
 *   统一以美元计价，方便比较各币种相对美元的升贬值。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { OpenBBCurrencyClient } from '@/openbb/currency/client'

export function createCurrencyTools(currencyClient: OpenBBCurrencyClient) {
  return {
    currencySearch: tool({
      description: `Search for currency pairs by keyword. Only returns XXXUSD pairs (priced in USD).

Examples: "EUR" → EURUSD; "JPY" → JPYUSD; "GBP" → GBPUSD.
The price represents how many USD one unit of the currency is worth — rising means appreciation against USD.

Use this FIRST to find the correct symbol before querying any currency data.`,
      inputSchema: z.object({
        query: z.string().describe('Currency keyword to search, e.g. "EUR", "JPY", "pound"'),
      }),
      execute: async ({ query }) => {
        const all = await currencyClient.search({ query, provider: 'yfinance' })
        const results = all.filter((r) => {
          const sym = (r as Record<string, unknown>).symbol as string | undefined
          return sym?.endsWith('USD')
        })
        if (results.length === 0) {
          return { results: [], message: `No USD pairs matching "${query}". Try a different keyword.` }
        }
        return { results, count: results.length }
      },
    }),
  }
}
