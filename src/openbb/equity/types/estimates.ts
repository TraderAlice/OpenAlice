/**
 * Equity Estimates types — mirrors OpenBB standard_models:
 *   price_target.py, price_target_consensus.py, analyst_estimates.py,
 *   analyst_search.py, forward_*_estimates.py
 */

// ==================== Price Target ====================

export interface PriceTargetQuery {
  symbol: string
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface PriceTargetData {
  symbol: string
  published_date: string
  news_url: string | null
  news_title: string | null
  analyst_name: string | null
  analyst_company: string | null
  grade_action: string | null
  price_target: number | null
  adj_price_target: number | null
  price_when_posted: number | null
  [key: string]: unknown
}

// ==================== Price Target Consensus ====================

export interface PriceTargetConsensusQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface PriceTargetConsensusData {
  symbol: string
  name: string | null
  target_high: number | null
  target_low: number | null
  target_consensus: number | null
  target_median: number | null
  [key: string]: unknown
}

// ==================== Analyst Estimates ====================

export interface AnalystEstimatesQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface AnalystEstimatesData {
  symbol: string
  date: string
  estimated_revenue_low: number | null
  estimated_revenue_high: number | null
  estimated_revenue_avg: number | null
  estimated_ebitda_low: number | null
  estimated_ebitda_high: number | null
  estimated_ebitda_avg: number | null
  estimated_ebit_low: number | null
  estimated_ebit_high: number | null
  estimated_ebit_avg: number | null
  estimated_net_income_low: number | null
  estimated_net_income_high: number | null
  estimated_net_income_avg: number | null
  estimated_sga_expense_low: number | null
  estimated_sga_expense_high: number | null
  estimated_sga_expense_avg: number | null
  estimated_eps_avg: number | null
  estimated_eps_high: number | null
  estimated_eps_low: number | null
  number_analyst_estimated_revenue: number | null
  number_analysts_estimated_eps: number | null
  [key: string]: unknown
}

// ==================== Analyst Search ====================

export interface AnalystSearchQuery {
  analyst_name?: string
  firm_name?: string
  provider?: string
  [key: string]: unknown
}

export interface AnalystSearchData {
  analyst_name: string | null
  firm_name: string | null
  [key: string]: unknown
}

// ==================== Forward Estimates (Sales, EBITDA, EPS, PE) ====================

export interface ForwardEstimatesQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface ForwardSalesEstimatesData {
  symbol: string
  name: string | null
  date: string
  fiscal_year: number | null
  fiscal_period: string | null
  [key: string]: unknown
}

export interface ForwardEbitdaEstimatesData {
  symbol: string
  name: string | null
  date: string
  fiscal_year: number | null
  fiscal_period: string | null
  [key: string]: unknown
}

export interface ForwardEpsEstimatesData {
  symbol: string
  name: string | null
  date: string
  fiscal_year: number | null
  fiscal_period: string | null
  [key: string]: unknown
}

export interface ForwardPeEstimatesData {
  symbol: string
  name: string | null
  date: string
  fiscal_year: number | null
  fiscal_period: string | null
  [key: string]: unknown
}
