/**
 * Equity Fundamental types — mirrors OpenBB standard_models for financial statements,
 * ratios, metrics, dividends, EPS, filings, splits, transcripts, etc.
 *
 * Note: OpenBB standard models define minimal fields (period_ending, fiscal_period,
 * fiscal_year). Actual financial detail fields (revenue, total_assets, etc.) are
 * provider-specific and captured by the index signature.
 */

// ==================== Common Query Pattern ====================

export interface SymbolLimitQuery {
  symbol: string
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface SymbolQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

// ==================== Financial Statement Base ====================

export interface FinancialStatementData {
  period_ending: string
  fiscal_period: string | null
  fiscal_year: number | null
  [key: string]: unknown
}

// Balance Sheet, Income Statement, Cash Flow all share this shape.
// Provider-specific fields (revenue, total_assets, etc.) come via index signature.
export type BalanceSheetData = FinancialStatementData
export type IncomeStatementData = FinancialStatementData
export type CashFlowStatementData = FinancialStatementData

// Growth variants share the same base shape
export type BalanceSheetGrowthData = FinancialStatementData
export type IncomeStatementGrowthData = FinancialStatementData
export type CashFlowStatementGrowthData = FinancialStatementData

// ==================== Financial Ratios ====================

export interface FinancialRatiosData {
  symbol: string | null
  period_ending: string | null
  fiscal_period: string | null
  fiscal_year: number | null
  [key: string]: unknown
}

// ==================== Key Metrics ====================

export interface KeyMetricsData {
  symbol: string
  period_ending: string | null
  fiscal_year: number | null
  fiscal_period: string | null
  currency: string | null
  market_cap: number | null
  [key: string]: unknown
}

// ==================== Key Executives ====================

export interface KeyExecutivesQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface KeyExecutivesData {
  title: string
  name: string
  pay: number | null
  currency_pay: string | null
  gender: string | null
  year_born: number | null
  title_since: string | null
  [key: string]: unknown
}

// ==================== Executive Compensation ====================

export interface ExecutiveCompensationData {
  symbol: string
  cik: string | null
  filing_date: string | null
  accepted_date: string | null
  name_and_position: string | null
  year: number | null
  salary: number | null
  bonus: number | null
  stock_award: number | null
  incentive_plan_compensation: number | null
  all_other_compensation: number | null
  total: number | null
  [key: string]: unknown
}

// ==================== Historical Dividends ====================

export interface HistoricalDividendsQuery {
  symbol: string
  start_date?: string
  end_date?: string
  provider?: string
  [key: string]: unknown
}

export interface HistoricalDividendsData {
  symbol: string | null
  ex_dividend_date: string
  amount: number
  [key: string]: unknown
}

// ==================== Historical EPS ====================

export interface HistoricalEpsData {
  symbol: string
  date: string
  eps_actual: number | null
  eps_estimated: number | null
  [key: string]: unknown
}

// ==================== Historical Employees ====================

export interface HistoricalEmployeesData {
  symbol: string
  cik: number
  acceptance_time: string
  period_of_report: string
  company_name: string
  form_type: string
  filing_date: string
  employee_count: number
  source: string
  [key: string]: unknown
}

// ==================== Historical Splits ====================

export interface HistoricalSplitsData {
  date: string
  numerator: number
  denominator: number
  [key: string]: unknown
}

// ==================== Company Filings ====================

export interface CompanyFilingsQuery {
  symbol?: string
  provider?: string
  [key: string]: unknown
}

export interface CompanyFilingsData {
  filing_date: string
  report_type: string | null
  report_url: string
  [key: string]: unknown
}

// ==================== Earnings Call Transcript ====================

export interface EarningsCallTranscriptQuery {
  symbol: string
  year?: number
  quarter?: 1 | 2 | 3 | 4
  provider?: string
  [key: string]: unknown
}

export interface EarningsCallTranscriptData {
  symbol: string
  year: number
  quarter: string
  date: string
  content: string
  [key: string]: unknown
}

// ==================== Revenue Geographic ====================

export interface RevenueGeographicData {
  period_ending: string
  fiscal_period: string | null
  fiscal_year: number | null
  [key: string]: unknown
}

// ==================== Revenue Business Line ====================

export interface RevenueBusinessLineData {
  period_ending: string
  fiscal_period: string | null
  fiscal_year: number | null
  [key: string]: unknown
}

// ==================== Reported Financials ====================

export interface ReportedFinancialsQuery {
  symbol: string
  period?: string
  statement_type?: string
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface ReportedFinancialsData {
  period_ending: string
  fiscal_period: string | null
  fiscal_year: number | null
  [key: string]: unknown
}

// ==================== Trailing Dividend Yield ====================

export interface TrailingDividendYieldData {
  symbol: string | null
  name: string | null
  trailing_dividend_yield: number | null
  [key: string]: unknown
}

// ==================== ESG Score ====================

export interface EsgScoreData {
  symbol: string
  cik: string | null
  company_name: string | null
  [key: string]: unknown
}

// ==================== Search/Latest/Historical Attributes ====================

export interface SearchAttributesQuery {
  query: string
  provider?: string
  [key: string]: unknown
}

export interface SearchAttributesData {
  id: string
  name: string
  tag: string
  [key: string]: unknown
}

export interface LatestAttributesQuery {
  symbol: string
  tag: string
  provider?: string
  [key: string]: unknown
}

export interface LatestAttributesData {
  symbol: string | null
  tag: string | null
  value: number | null
  [key: string]: unknown
}

export interface HistoricalAttributesQuery {
  symbol: string
  tag: string
  start_date?: string
  end_date?: string
  provider?: string
  [key: string]: unknown
}

export interface HistoricalAttributesData {
  date: string
  symbol: string | null
  tag: string | null
  value: number | null
  [key: string]: unknown
}
