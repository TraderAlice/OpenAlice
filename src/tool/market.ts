/**
 * Market Search AI Tool
 *
 * marketSearchForResearch:
 *   统一的市场数据 symbol 搜索入口，跨 equity / crypto / currency 三个资产类别。
 *   - equity: 本地 SEC/TMX 缓存，正则匹配，零延迟
 *   - crypto: yfinance 在线模糊搜索
 *   - currency: yfinance 在线模糊搜索，只返回 XXXUSD 对
 *   返回值带 assetClass 字段归属。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { SymbolIndex } from '@/domain/market-data/equity/symbol-index'
import type { CryptoClientLike, CurrencyClientLike } from '@/domain/market-data/client/types'

export function createMarketSearchTools(
  symbolIndex: SymbolIndex,
  cryptoClient: CryptoClientLike,
  currencyClient: CurrencyClientLike,
) {
  return {
    marketSearchForResearch: tool({
      description: `Search for symbols across all asset classes (equities, crypto, currencies) for market data research.

Returns matching symbols with assetClass attribution ("equity", "crypto", or "currency").
Equity results come from SEC/TMX listings (~13k US/CA stocks); crypto and currency results
come from Yahoo Finance fuzzy search. Currency results are filtered to XXXUSD pairs only.

If unsure about the symbol, use this to find the correct one for market data tools
(equityGetProfile, equityGetFinancials, calculateIndicator, etc.).
This is NOT for trading — use searchContracts to find broker-tradeable contracts.`,
      inputSchema: z.object({
        query: z.string().describe('Keyword to search, e.g. "AAPL", "bitcoin", "EUR"'),
        limit: z.number().int().positive().optional().describe('Max results per asset class (default: 20)'),
      }),
      execute: async ({ query, limit }) => {
        const cap = limit ?? 20

        // equity: 本地同步搜索
        const equityResults = symbolIndex.search(query, cap).map((r) => ({ ...r, assetClass: 'equity' as const }))

        // crypto + currency: yfinance 在线搜索，并行，容错
        const [cryptoSettled, currencySettled] = await Promise.allSettled([
          cryptoClient.search({ query, provider: 'yfinance' }),
          currencyClient.search({ query, provider: 'yfinance' }),
        ])

        const cryptoResults = (cryptoSettled.status === 'fulfilled' ? cryptoSettled.value : []).map((r) => ({
          ...r,
          assetClass: 'crypto' as const,
        }))

        const currencyResults = (currencySettled.status === 'fulfilled' ? currencySettled.value : [])
          .filter((r) => {
            const sym = (r as Record<string, unknown>).symbol as string | undefined
            return sym?.endsWith('USD')
          })
          .map((r) => ({ ...r, assetClass: 'currency' as const }))

        const results = [...equityResults, ...cryptoResults, ...currencyResults]
        if (results.length === 0) {
          return { results: [], message: `No symbols matching "${query}". Try a different keyword.` }
        }
        return { results, count: results.length }
      },
    }),
  }
}
