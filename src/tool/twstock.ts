/**
 * Taiwan Stock Market AI Tools (twstock)
 *
 * Thin bridge to the remote twstock MCP server, exposing TWSE data as
 * OpenAlice tools for the AI agent. Covers company fundamentals, trading
 * data, market indices, foreign investment, warrants, and ESG.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { TwstockMcpClient } from '@/domain/twstock/client'

export function createTwstockTools(client: TwstockMcpClient) {
  // Helper: wrap callTool with error handling matching project conventions
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    try {
      return await client.callTool(name, args)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  return {
    // ==================== Company Info ====================

    twstockGetCompanyProfile: tool({
      description: 'Get basic information of a TWSE-listed company (name, industry, capital, chairman, etc.) by stock code.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330" for TSMC'),
      }),
      execute: async ({ code }) => call('get_company_profile', { code }),
    }),

    twstockGetCompanyBalanceSheet: tool({
      description: 'Get balance sheet for a TWSE-listed company. Auto-detects industry format (general, financial, insurance, etc.).',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_company_balance_sheet', { code }),
    }),

    twstockGetCompanyIncomeStatement: tool({
      description: 'Get comprehensive income statement for a TWSE-listed company. Auto-detects industry format.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_company_income_statement', { code }),
    }),

    twstockGetCompanyMonthlyRevenue: tool({
      description: 'Get monthly revenue information for a TWSE-listed company.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_company_monthly_revenue', { code }),
    }),

    twstockGetCompanyDividend: tool({
      description: 'Get dividend distribution history for a TWSE-listed company.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_company_dividend', { code }),
    }),

    twstockGetCompanyMajorNews: tool({
      description: 'Get daily major announcements from TWSE-listed companies. Material information disclosures that may impact stock prices.',
      inputSchema: z.object({
        code: z.string().optional().describe('Stock code to filter. Omit to get all major announcements.'),
      }),
      execute: async ({ code }) => call('get_company_major_news', code ? { code } : {}),
    }),

    // ==================== ESG / Governance ====================

    twstockGetCompanyGovernanceInfo: tool({
      description: 'Get corporate governance information for a TWSE-listed company.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_company_governance_info', { code }),
    }),

    twstockGetCompanyClimateManagement: tool({
      description: 'Get climate-related management information for a TWSE-listed company.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_company_climate_management', { code }),
    }),

    twstockGetCompanyRiskManagement: tool({
      description: 'Get risk management policy information for a TWSE-listed company.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_company_risk_management', { code }),
    }),

    twstockGetCompanyInfoSecurity: tool({
      description: 'Get information security data for a TWSE-listed company.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_company_info_security', { code }),
    }),

    twstockGetCompanySupplyChainManagement: tool({
      description: 'Get supply chain management information for a TWSE-listed company.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_company_supply_chain_management', { code }),
    }),

    // ==================== Trading Data ====================

    twstockGetStockDailyTrading: tool({
      description: 'Get daily trading information (open, high, low, close, volume) for a TWSE-listed stock.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_stock_daily_trading', { code }),
    }),

    twstockGetStockMonthlyTrading: tool({
      description: 'Get monthly trading information for a TWSE-listed stock.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_stock_monthly_trading', { code }),
    }),

    twstockGetStockYearlyTrading: tool({
      description: 'Get yearly trading information for a TWSE-listed stock.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_stock_yearly_trading', { code }),
    }),

    twstockGetStockMonthlyAverage: tool({
      description: 'Get daily closing price and monthly average price for a TWSE-listed stock.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_stock_monthly_average', { code }),
    }),

    twstockGetStockValuationRatios: tool({
      description: 'Get P/E ratio, dividend yield, and P/B ratio for a TWSE-listed stock.',
      inputSchema: z.object({
        code: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ code }) => call('get_stock_valuation_ratios', { code }),
    }),

    twstockGetRealTimeTradingStats: tool({
      description: 'Get real-time 5-second trading statistics including order volumes and transaction counts for the TWSE market.',
      inputSchema: z.object({}),
      execute: async () => call('get_real_time_trading_stats'),
    }),

    // ==================== Market Indices ====================

    twstockGetMarketIndexInfo: tool({
      description: `Get daily market closing information and index statistics for TWSE.

Categories: "major" (main indices), "sector" (industry), "esg", "leverage", "return" (total return), "thematic", "dividend", "all".`,
      inputSchema: z.object({
        category: z.string().optional().describe('Index category (default: "major")'),
        count: z.number().int().optional().describe('Max indices to return (default: 20, max: 50)'),
        format: z.string().optional().describe('Output format: "detailed", "summary", "simple" (default: "detailed")'),
      }),
      execute: async ({ category, count, format }) => {
        const args: Record<string, unknown> = {}
        if (category) args.category = category
        if (count) args.count = count
        if (format) args.format = format
        return call('get_market_index_info', args)
      },
    }),

    twstockGetMarketHistoricalIndex: tool({
      description: 'Get historical TAIEX (Taiwan Capitalization Weighted Stock Index) data for long-term trend analysis.',
      inputSchema: z.object({}),
      execute: async () => call('get_market_historical_index'),
    }),

    // ==================== Foreign Investment ====================

    twstockGetTopForeignHoldings: tool({
      description: 'Get top 20 companies by foreign and mainland China investment holdings ranking.',
      inputSchema: z.object({}),
      execute: async () => call('get_top_foreign_holdings'),
    }),

    twstockGetForeignInvestmentByIndustry: tool({
      description: 'Get foreign and mainland China investment holding ratios by industry category.',
      inputSchema: z.object({}),
      execute: async () => call('get_foreign_investment_by_industry'),
    }),

    // ==================== Margin Trading ====================

    twstockGetMarginTradingInfo: tool({
      description: 'Get margin trading and short selling balance information for the TWSE market.',
      inputSchema: z.object({}),
      execute: async () => call('get_margin_trading_info'),
    }),

    // ==================== Dividends / Corporate Actions ====================

    twstockGetDividendRightsSchedule: tool({
      description: 'Get ex-dividend and ex-rights schedule for TWSE-listed stocks, including dates, stock/cash dividends, and rights offerings.',
      inputSchema: z.object({
        code: z.string().optional().describe('Stock code to filter. Omit to get all upcoming schedules.'),
      }),
      execute: async ({ code }) => call('get_dividend_rights_schedule', code ? { code } : {}),
    }),

    twstockGetEtfRegularInvestmentRanking: tool({
      description: 'Get top 10 securities and ETFs by number of regular investment (定期定額) accounts.',
      inputSchema: z.object({}),
      execute: async () => call('get_etf_regular_investment_ranking'),
    }),

    // ==================== TWSE News & Events ====================

    twstockGetTwseNews: tool({
      description: 'Get latest news from Taiwan Stock Exchange with optional date filtering.',
      inputSchema: z.object({
        start_date: z.string().optional().describe('Start date (YYYYMMDD). Defaults to current month start.'),
        end_date: z.string().optional().describe('End date (YYYYMMDD). Defaults to current month end.'),
      }),
      execute: async ({ start_date, end_date }) => {
        const args: Record<string, unknown> = {}
        if (start_date) args.start_date = start_date
        if (end_date) args.end_date = end_date
        return call('get_twse_news', args)
      },
    }),

    twstockGetTwseEvents: tool({
      description: 'Get Taiwan Stock Exchange event announcements, seminars, and activities.',
      inputSchema: z.object({
        top: z.number().int().optional().describe('Number of events to return (default: 10, 0 for all)'),
      }),
      execute: async ({ top }) => call('get_twse_events', top ? { top } : {}),
    }),

    // ==================== Warrants ====================

    twstockGetWarrantBasicInfo: tool({
      description: 'Get basic information of TWSE-listed warrants (type, exercise period, underlying asset, etc.).',
      inputSchema: z.object({
        code: z.string().optional().describe('Warrant code to filter. Omit for all warrants.'),
      }),
      execute: async ({ code }) => call('get_warrant_basic_info', code ? { code } : {}),
    }),

    twstockGetWarrantDailyTrading: tool({
      description: 'Get daily trading data (volume, value) for TWSE-listed warrants.',
      inputSchema: z.object({
        code: z.string().optional().describe('Warrant code to filter. Omit for all warrants.'),
      }),
      execute: async ({ code }) => call('get_warrant_daily_trading', code ? { code } : {}),
    }),

    twstockGetWarrantTraderCount: tool({
      description: 'Get daily number of individual warrant traders on the TWSE.',
      inputSchema: z.object({}),
      execute: async () => call('get_warrant_trader_count'),
    }),
  }
}
