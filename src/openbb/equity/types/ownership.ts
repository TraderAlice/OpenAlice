/**
 * Equity Ownership types — mirrors OpenBB standard_models:
 *   equity_ownership.py, institutional_ownership.py, insider_trading.py,
 *   share_statistics.py, form13_FHR.py, government_trades.py
 */

// ==================== Major Holders ====================

export interface EquityOwnershipQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface EquityOwnershipData {
  investor_name: string
  cik: string | null
  date: string
  filing_date: string | null
  symbol: string
  [key: string]: unknown
}

// ==================== Institutional Ownership ====================

export interface InstitutionalOwnershipQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface InstitutionalOwnershipData {
  symbol: string
  cik: string | null
  date: string
  [key: string]: unknown
}

// ==================== Insider Trading ====================

export interface InsiderTradingQuery {
  symbol: string
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface InsiderTradingData {
  symbol: string
  filing_date: string
  transaction_date: string | null
  owner_cik: number | string | null
  owner_name: string | null
  owner_title: string | null
  transaction_type: string | null
  acquisition_or_disposition: string | null
  securities_owned: number | null
  securities_transacted: number | null
  price: number | null
  [key: string]: unknown
}

// ==================== Share Statistics ====================

export interface ShareStatisticsQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface ShareStatisticsData {
  symbol: string
  date: string | null
  [key: string]: unknown
}

// ==================== Form 13F ====================

export interface Form13FQuery {
  symbol: string
  date?: string
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface Form13FData {
  period_of_report: string
  [key: string]: unknown
}

// ==================== Government Trades ====================

export interface GovernmentTradesQuery {
  symbol?: string
  name?: string
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface GovernmentTradesData {
  date: string
  symbol: string | null
  [key: string]: unknown
}
