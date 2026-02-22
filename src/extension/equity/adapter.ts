/**
 * Equity AI Tools
 *
 * equitySearch:
 *   为了实现正则搜索，我们在启动时从 OpenBB API 拉取全量 symbol 列表并缓存到
 *   data/cache/equity/symbols.json。搜索在本地内存中进行，不依赖 API。
 *   当前缓存的数据源（免费，不需要 API key）：
 *   - SEC (sec): ~10,000 美股上市公司，来自 SEC EDGAR
 *   - TMX (tmx): ~3,600 加拿大上市公司，来自多伦多交易所
 *   扩展方法：在 SymbolIndex 的 SOURCES 数组中添加新的 provider 即可。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { SymbolIndex } from '@/openbb/equity/SymbolIndex'

export function createEquityTools(symbolIndex: SymbolIndex) {
  return {
    equitySearch: tool({
      description: `Search for equity symbols by regex pattern or keyword.

Matches against both ticker symbol and company name (case-insensitive).
Supports full regex syntax: "^BRK\\." for BRK.A/BRK.B, "semiconductor" for all semiconductor companies, "^AA" for all tickers starting with AA.

If the regex is invalid, falls back to simple substring matching.

Use this FIRST to find the correct symbol before querying any equity data.`,
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern or keyword to match against symbol and company name'),
        limit: z.number().int().positive().optional().describe('Max results to return (default: 20)'),
      }),
      execute: ({ pattern, limit }) => {
        const results = symbolIndex.search(pattern, limit)
        if (results.length === 0) {
          return { results: [], message: `No symbols matching "${pattern}". Try a broader pattern.` }
        }
        return { results, count: results.length }
      },
    }),
  }
}
