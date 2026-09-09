/**
 * Market Search AI Tool
 *
 * marketSearchForResearch:
 *   统一的市场数据 symbol 搜索入口，跨 equity / crypto / currency / commodity 四个资产类别。
 *   实际聚合逻辑位于 domain/market-data/aggregate-search，HTTP 层（/api/market/search）
 *   也复用同一个函数——AI 与 UI 看到的是同一份结果。
 */

import { tool } from 'ai'
import { z } from 'zod'
import {
  aggregateSymbolSearch,
  type MarketSearchDeps,
} from '@/domain/market-data/aggregate-search.js'

export function createMarketSearchTools(deps: MarketSearchDeps) {
  return {
    marketSearchForResearch: tool({
      description: `Search for symbols across all asset classes (equities, crypto, currencies, commodities) for market data research.

Returns matching symbols with assetClass attribution ("equity", "crypto", "currency", or "commodity").
Equity results come from SEC/TMX listings (~13k US/CA stocks); crypto and currency results
come from Yahoo Finance fuzzy search; commodity results come from a canonical catalog (~25 items).
Currency results include USD-base pairs and cross pairs.

For commodities, use the canonical id (e.g. "gold", "crude_oil", "copper") with calculateIndicator
and other tools — provider-specific tickers (GC=F, GCUSD) are resolved automatically.

If unsure about the symbol, use this to find the correct one for market data tools
(equityGetProfile, equityGetFinancials, calculateIndicator, etc.).
This is NOT for trading — use searchContracts to find broker-tradeable contracts.`,
      inputSchema: z.object({
        query: z.string().describe('Keyword to search, e.g. "AAPL", "bitcoin", "EUR"'),
        limit: z.number().int().positive().optional().describe('Max results per asset class (default: 20)'),
      }).meta({ examples: [{ query: 'apple' }] }),
      execute: async ({ query, limit }) => {
        const results = await aggregateSymbolSearch(deps, query, limit ?? 20)
        if (results.length === 0) {
          return { results: [], message: `No symbols matching "${query}". Try a different keyword.` }
        }
        return { results, count: results.length }
      },
    }),
  }
}
