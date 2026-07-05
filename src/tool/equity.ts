/**
 * Equity AI Tools
 *
 * equityGetProfile / equityGetFinancials / equityGetRatios / equityGetEstimates /
 * equityGetEarningsCalendar / equityGetInsiderTrading / equityDiscover:
 *   透传到 OpenBB equity API，为 AI 提供基本面和市场发现能力。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EquityClientLike } from '@/domain/market-data/client/types'
import type { EquityDiscoveryData } from '@traderalice/opentypebb'

export function createEquityTools(equityClient: EquityClientLike) {
  return {
    equityGetProfile: tool({
      description: `Get company profile and key valuation metrics for a stock.

Returns company overview (name, sector, industry, description, website, CEO, employees)
combined with key metrics (market cap, PE ratio, PB ratio, EV/EBITDA, dividend yield, etc.).

If unsure about the symbol, use marketSearchForResearch to find it.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL", "MSFT"'),
      }).meta({ examples: [{ symbol: 'AAPL' }] }),
      execute: async ({ symbol }) => {
        // For Taiwan tickers (2330.TW / 6488.TWO), metrics route to the official
        // twse vendor first (official P/E·殖利率·股價淨值比), then yfinance.
        // Profile stays yfinance-first (richer description/sector), with twse as a
        // backstop. Routes by symbol DOMAIN (the ticker is itself a TW security),
        // not by a hardcoded asset-class → vendor map.
        const isTW = /\d{3,6}[A-Z]?\.(TW|TWO)$/i.test(symbol)
        const profileProviders = isTW ? ['yfinance', 'twse'] : ['yfinance']
        const metricProviders = isTW ? ['twse', 'yfinance'] : ['yfinance']
        const firstHit = async <T,>(providers: string[], call: (p: string) => Promise<T[]>): Promise<T | null> => {
          for (const p of providers) {
            const rows = await call(p).catch(() => [] as T[])
            if (rows[0]) return rows[0]
          }
          return null
        }
        const [profile, metrics] = await Promise.all([
          firstHit(profileProviders, (p) => equityClient.getProfile({ symbol, provider: p })),
          firstHit(metricProviders, (p) => equityClient.getKeyMetrics({ symbol, limit: 1, provider: p })),
        ])
        return { profile, metrics }
      },
    }),

    equityGetFinancials: tool({
      description: `Get financial statements for a company.

Returns income statement, balance sheet, or cash flow statement depending on the "type" parameter.
Each entry is one fiscal period (quarterly or annual).

If unsure about the symbol, use marketSearchForResearch to find it.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
        type: z.enum(['income', 'balance', 'cash']).describe('Statement type: "income" for income statement, "balance" for balance sheet, "cash" for cash flow'),
        period: z.enum(['annual', 'quarter']).optional().describe('Fiscal period (default: annual)'),
        limit: z.number().int().positive().optional().describe('Number of periods to return (default: 5)'),
      }).meta({ examples: [{ symbol: 'AAPL', type: 'income', period: 'annual', limit: 5 }] }),
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

Returns profitability ratios (ROE, ROA, gross/net/operating margin),
liquidity ratios (current ratio, quick ratio), leverage ratios (debt/equity,
debt/assets), valuation (P/E, P/B, P/S, dividend yield), and more (a curated
set with clean names, plus any extra ratios the provider returns passed
through under their raw names).

By default returns the trailing-twelve-month (TTM) snapshot PLUS \`limit\`
historical periods. Use \`ttm\` to change that: "include" (default, TTM + the
historical series), "exclude" (historical series only, no TTM), "only" (just
the single TTM snapshot — \`period\`/\`limit\` are ignored in this mode).

If unsure about the symbol, use marketSearchForResearch to find it.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
        period: z.enum(['annual', 'quarter']).optional().describe('Fiscal period for the historical series (default: annual)'),
        limit: z.number().int().positive().optional().describe('Number of historical periods to return (default: 5; ignored when ttm="only")'),
        ttm: z.enum(['include', 'exclude', 'only']).optional().describe('TTM handling: "include" (default — TTM + history), "exclude" (history only), "only" (TTM snapshot only)'),
      }).meta({ examples: [{ symbol: 'AAPL', period: 'annual', limit: 5 }] }),
      execute: async ({ symbol, period, limit, ttm }) => {
        // The FMP fetcher defaults ttm to "only" (a single TTM row, with
        // period/limit dead). Default to "include" here so the historical
        // series — and therefore period/limit — actually come through.
        const params: Record<string, unknown> = { symbol, provider: 'fmp', ttm: ttm ?? 'include' }
        if (period) params.period = period
        if (limit) params.limit = limit
        return await equityClient.getFinancialRatios(params)
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
      }).meta({ examples: [{ symbol: 'AAPL' }] }),
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

If unsure about the symbol, use marketSearchForResearch to find it.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
        limit: z.number().int().positive().optional().describe('Number of transactions to return (default: 20)'),
      }).meta({ examples: [{ symbol: 'AAPL', limit: 20 }] }),
      execute: async ({ symbol, limit }) => {
        const params: Record<string, unknown> = { symbol }
        if (limit) params.limit = limit
        // FMP first (CIKs + filing dates); keyless Yahoo Form-4 rows as
        // fallback so the tool degrades instead of going dark.
        try {
          return await equityClient.getInsiderTrading({ ...params, provider: 'fmp' })
        } catch {
          return await equityClient.getInsiderTrading({ ...params, provider: 'yfinance' })
        }
      },
    }),

    equityGetShortInterest: tool({
      description: `Get share statistics and short interest for a stock (Yahoo, keyless).

Returns shares outstanding, float, shares short (current + prior month),
short % of float, and days-to-cover. The squeeze/positioning read: rising
short interest with high days-to-cover = crowded short.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
      }).meta({ examples: [{ symbol: 'GME' }] }),
      execute: async ({ symbol }) => {
        return await equityClient.getShareStatistics({ symbol, provider: 'yfinance' })
      },
    }),

    equityGetEstimates: tool({
      description: `Get the analyst price-target consensus for a stock.

Returns target high / low / consensus / median from sell-side analysts
(Yahoo Finance, keyless). Compare the consensus to the current price for the
street's implied upside; the high-low spread reads as disagreement.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL"'),
      }).meta({ examples: [{ symbol: 'AAPL' }] }),
      execute: async ({ symbol }) => {
        return await equityClient.getEstimateConsensus({ symbol, provider: 'yfinance' })
      },
    }),

    equityDiscover: tool({
      description: `Discover trending stocks in the market right now.

Returns top gainers, losers, or most actively traded stocks. Use this to get a
pulse on what the market is trading today.

Each row carries volume-context fields beyond raw price/volume. Volume has two
orthogonal readings — use the one that fits the question:
- relative_volume — today's volume / its 3-month average. The RELATIVE,
  intra-ticker read: "is this name unusual for itself?". raw "most active" is
  just the usual mega-caps (AAPL, TSLA always trade billions); relative_volume
  >2 surfaces genuine anomalies. Use for event/spike detection.
- dollar_volume — price × volume (traded notional). The ABSOLUTE,
  cross-ticker-comparable read: "how much money is actually here?". This is the
  unit that compares across tickers and aggregates to a sector (raw share
  volume can't — 1M shares is different money at $5 vs $500). Use for capital
  weight / cross-sector work / tradability.
- turnover — volume / shares outstanding (more sensitive for small caps).
- avg_volume — the 3-month baseline.

Set sortBy to re-rank: "relative_volume" for unusual volume, "dollar_volume"
for where the money is. Default keeps the provider ranking (price move for
gainers/losers, absolute share volume for active). Volume-context fields are
populated on the default yfinance data only.`,
      inputSchema: z.object({
        type: z.enum(['gainers', 'losers', 'active', 'undervalued_growth', 'growth_tech', 'aggressive_small_caps', 'undervalued_large_caps']).describe('"gainers"/"losers" by price move, "active" by absolute volume; screener lenses: "undervalued_growth" (low PE + growth), "growth_tech" (revenue/earnings growth tech), "aggressive_small_caps" (high-beta small caps), "undervalued_large_caps" (low-PE large caps)'),
        sortBy: z.enum(['default', 'relative_volume', 'dollar_volume']).optional().describe('"default" keeps the provider ranking; "relative_volume" re-ranks by unusual volume (today vs 3-month avg); "dollar_volume" re-ranks by traded notional (price × volume) — where the money actually is'),
      }).meta({ examples: [{ type: 'active', sortBy: 'relative_volume' }] }),
      execute: async ({ type, sortBy }) => {
        let rows: EquityDiscoveryData[]
        switch (type) {
          case 'gainers':
            rows = await equityClient.getGainers()
            break
          case 'losers':
            rows = await equityClient.getLosers()
            break
          case 'active':
            rows = await equityClient.getActive()
            break
          case 'undervalued_growth':
            rows = await equityClient.getUndervaluedGrowth()
            break
          case 'growth_tech':
            rows = await equityClient.getGrowthTech()
            break
          case 'aggressive_small_caps':
            rows = await equityClient.getAggressiveSmallCaps()
            break
          case 'undervalued_large_caps':
            rows = await equityClient.getUndervaluedLargeCaps()
            break
        }

        if (sortBy === 'relative_volume' || sortBy === 'dollar_volume') {
          // Re-rank by the chosen volume axis; rows missing it sink to the bottom.
          rows = [...rows].sort(
            (a, b) => (b[sortBy] ?? -Infinity) - (a[sortBy] ?? -Infinity),
          )
        }

        return rows
      },
    }),
  }
}
