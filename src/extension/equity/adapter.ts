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
 *
 * equityGetProfile / equityGetFinancials / equityGetRatios / equityGetEstimates /
 * equityGetEarningsCalendar / equityGetInsiderTrading / equityDiscover:
 *   透传到 OpenBB equity API，为 AI 提供基本面和市场发现能力。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { SymbolIndex } from '@/openbb/equity/SymbolIndex'
import type { OpenBBEquityClient } from '@/openbb/equity/client'

export function createEquityTools(symbolIndex: SymbolIndex, equityClient: OpenBBEquityClient) {
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

    equityGetProfile: tool({
      description: `Get company profile and key valuation metrics for a stock.

Returns company overview (name, sector, industry, description, website, CEO, employees)
combined with key metrics (market cap, PE ratio, PB ratio, EV/EBITDA, dividend yield, etc.).

Use equitySearch first to resolve the correct symbol.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL", "MSFT"'),
      }),
      execute: async ({ symbol }) => {
        const [profile, metrics] = await Promise.all([
          equityClient.getProfile({ symbol, provider: 'yfinance' }).catch(() => []),
          equityClient.getKeyMetrics({ symbol, limit: 1, provider: 'yfinance' }).catch(() => []),
        ])
        return { profile: profile[0] ?? null, metrics: metrics[0] ?? null }
      },
    }),

    equityGetFinancials: tool({
      description: `Get financial statements for a company.

Returns income statement, balance sheet, or cash flow statement depending on the "type" parameter.
Each entry is one fiscal period (quarterly or annual).

Use equitySearch first to resolve the correct symbol.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
        type: z.enum(['income', 'balance', 'cash']).describe('Statement type: "income" for income statement, "balance" for balance sheet, "cash" for cash flow'),
        period: z.enum(['annual', 'quarter']).optional().describe('Fiscal period (default: annual)'),
        limit: z.number().int().positive().optional().describe('Number of periods to return (default: 5)'),
      }),
      execute: async ({ symbol, type, period, limit }) => {
        const params: Record<string, unknown> = { symbol, provider: 'yfinance' }
        if (period) params.period = period
        if (limit) params.limit = limit

        switch (type) {
          case 'income':
            return await equityClient.getIncomeStatement(params)
          case 'balance':
            return await equityClient.getBalanceSheet(params)
          case 'cash':
            return await equityClient.getCashFlow(params)
        }
      },
    }),

    equityGetRatios: tool({
      description: `Get financial ratios for a company.

Returns profitability ratios (ROE, ROA, gross margin, net margin, operating margin),
liquidity ratios (current ratio, quick ratio), leverage ratios (debt/equity),
and efficiency ratios (asset turnover, inventory turnover).

Use equitySearch first to resolve the correct symbol.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
        period: z.enum(['annual', 'quarter']).optional().describe('Fiscal period (default: annual)'),
        limit: z.number().int().positive().optional().describe('Number of periods to return (default: 5)'),
      }),
      execute: async ({ symbol, period, limit }) => {
        const params: Record<string, unknown> = { symbol, provider: 'fmp' }
        if (period) params.period = period
        if (limit) params.limit = limit
        return await equityClient.getFinancialRatios(params)
      },
    }),

    equityGetEstimates: tool({
      description: `Get analyst consensus estimates for a stock.

Returns consensus rating (buy/hold/sell counts), average target price, and EPS estimates.
Useful for understanding how the market views a stock's prospects.

Use equitySearch first to resolve the correct symbol.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
      }),
      execute: async ({ symbol }) => {
        return await equityClient.getEstimateConsensus({ symbol, provider: 'yfinance' })
      },
    }),

    equityGetEarningsCalendar: tool({
      description: `Get upcoming and recent earnings release dates.

Returns a list of companies with their expected earnings dates.
IMPORTANT: Check this before holding positions — earnings events carry significant risk.

Can be queried by symbol (specific company) or by date range (market-wide).`,
      inputSchema: z.object({
        symbol: z.string().optional().describe('Ticker symbol to check (omit for market-wide calendar)'),
        start_date: z.string().optional().describe('Start date in YYYY-MM-DD format'),
        end_date: z.string().optional().describe('End date in YYYY-MM-DD format'),
      }),
      execute: async ({ symbol, start_date, end_date }) => {
        const params: Record<string, unknown> = { provider: 'fmp' }
        if (symbol) params.symbol = symbol
        if (start_date) params.start_date = start_date
        if (end_date) params.end_date = end_date
        return await equityClient.getCalendarEarnings(params)
      },
    }),

    equityGetInsiderTrading: tool({
      description: `Get insider trading activity for a company.

Returns recent buy/sell transactions by company executives, directors, and major shareholders.
Insider buying is often a strong bullish signal; large insider selling may warrant caution.

Use equitySearch first to resolve the correct symbol.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
        limit: z.number().int().positive().optional().describe('Number of transactions to return (default: 20)'),
      }),
      execute: async ({ symbol, limit }) => {
        const params: Record<string, unknown> = { symbol, provider: 'fmp' }
        if (limit) params.limit = limit
        return await equityClient.getInsiderTrading(params)
      },
    }),

    equityDiscover: tool({
      description: `Discover trending stocks in the market right now.

Returns top gainers, losers, or most actively traded stocks.
Use this to get a pulse on what the market is trading today.`,
      inputSchema: z.object({
        type: z.enum(['gainers', 'losers', 'active']).describe('"gainers" for top price gainers, "losers" for top losers, "active" for most actively traded by volume'),
      }),
      execute: async ({ type }) => {
        switch (type) {
          case 'gainers':
            return await equityClient.getGainers()
          case 'losers':
            return await equityClient.getLosers()
          case 'active':
            return await equityClient.getActive()
        }
      },
    }),
  }
}
