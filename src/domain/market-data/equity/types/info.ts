/**
 * Equity Info types — mirrors OpenBB standard_models:
 *   equity_info.py, equity_search.py, equity_screener.py, market_snapshots.py
 */

// ==================== Company Info / Profile ====================

export interface EquityInfoQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface EquityInfoData {
  symbol: string
  name: string | null
  cik: string | null
  cusip: string | null
  isin: string | null
  lei: string | null
  legal_name: string | null
  stock_exchange: string | null
  sic: number | null
  short_description: string | null
  long_description: string | null
  ceo: string | null
  company_url: string | null
  business_address: string | null
  mailing_address: string | null
  business_phone_no: string | null
  hq_address1: string | null
  hq_address2: string | null
  hq_address_city: string | null
  hq_address_postal_code: string | null
  hq_state: string | null
  hq_country: string | null
  inc_state: string | null
  inc_country: string | null
  employees: number | null
  entity_legal_form: string | null
  entity_status: string | null
  latest_filing_date: string | null
  irs_number: string | null
  sector: string | null
  industry_category: string | null
  industry_group: string | null
  template: string | null
  standardized_active: boolean | null
  first_fundamental_date: string | null
  last_fundamental_date: string | null
  first_stock_price_date: string | null
  last_stock_price_date: string | null
  [key: string]: unknown
}

// ==================== Search ====================

export interface EquitySearchQuery {
  query?: string
  is_symbol?: boolean
  provider?: string
  [key: string]: unknown
}

export interface EquitySearchData {
  symbol: string | null
  name: string | null
  [key: string]: unknown
}

// ==================== Screener ====================

export interface EquityScreenerQuery {
  provider?: string
  [key: string]: unknown
}

export interface EquityScreenerData {
  symbol: string
  name: string | null
  [key: string]: unknown
}

// ==================== Market Snapshots ====================

export interface MarketSnapshotsQuery {
  provider?: string
  [key: string]: unknown
}

export interface MarketSnapshotsData {
  symbol: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  prev_close: number | null
  change: number | null
  change_percent: number | null
  [key: string]: unknown
}

// ==================== Historical Market Cap ====================

export interface HistoricalMarketCapQuery {
  symbol: string
  start_date?: string
  end_date?: string
  provider?: string
  [key: string]: unknown
}

export interface HistoricalMarketCapData {
  date: string
  symbol: string
  market_cap: number
  [key: string]: unknown
}
