/**
 * Equity Discovery types — mirrors OpenBB standard_models:
 *   equity_gainers.py, equity_losers.py, equity_active.py,
 *   equity_undervalued_large_caps.py, equity_undervalued_growth.py,
 *   equity_aggressive_small_caps.py, growth_tech_equities.py,
 *   top_retail.py, discovery_filings.py, latest_financial_reports.py
 */

// ==================== Gainers / Losers / Active ====================
// These share the same shape (EquityPerformance standard model)

export interface EquityPerformanceQuery {
  sort?: 'asc' | 'desc'
  provider?: string
  [key: string]: unknown
}

export interface EquityPerformanceData {
  symbol: string
  name: string | null
  price: number
  change: number
  percent_change: number
  volume: number | null
  [key: string]: unknown
}

// Gainers, Losers, Active, UndervaluedLargeCaps, UndervaluedGrowth,
// AggressiveSmallCaps, GrowthTech all use EquityPerformanceData
export type EquityGainersData = EquityPerformanceData
export type EquityLosersData = EquityPerformanceData
export type EquityActiveData = EquityPerformanceData
export type EquityUndervaluedLargeCapsData = EquityPerformanceData
export type EquityUndervaluedGrowthData = EquityPerformanceData
export type EquityAggressiveSmallCapsData = EquityPerformanceData
export type GrowthTechEquitiesData = EquityPerformanceData

// ==================== Top Retail ====================

export interface TopRetailQuery {
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface TopRetailData {
  date: string
  symbol: string
  activity: number
  sentiment: number
  [key: string]: unknown
}

// ==================== Discovery Filings ====================

export interface DiscoveryFilingsQuery {
  start_date?: string
  end_date?: string
  form_type?: string
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface DiscoveryFilingsData {
  symbol: string
  cik: string
  title: string
  date: string
  form_type: string
  link: string
  [key: string]: unknown
}

// ==================== Latest Financial Reports ====================

export interface LatestFinancialReportsQuery {
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface LatestFinancialReportsData {
  symbol: string | null
  name: string | null
  cik: string | null
  filing_date: string | null
  report_type: string | null
  report_url: string | null
  [key: string]: unknown
}
