/**
 * Equity Price types — mirrors OpenBB standard_models:
 *   equity_historical.py, equity_quote.py, equity_nbbo.py, price_performance.py
 */

// ==================== Historical OHLCV ====================

export interface EquityHistoricalQuery {
  symbol: string
  start_date?: string  // YYYY-MM-DD
  end_date?: string    // YYYY-MM-DD
  provider?: string
  [key: string]: unknown
}

export interface EquityHistoricalData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  vwap: number | null
  [key: string]: unknown
}

// ==================== Quote ====================

export interface EquityQuoteQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface EquityQuoteData {
  symbol: string
  asset_type: string | null
  name: string | null
  exchange: string | null
  bid: number | null
  bid_size: number | null
  bid_exchange: string | null
  ask: number | null
  ask_size: number | null
  ask_exchange: string | null
  quote_conditions: string | number | string[] | number[] | null
  quote_indicators: string | number | string[] | number[] | null
  sales_conditions: string | number | string[] | number[] | null
  sequence_number: number | null
  market_center: string | null
  participant_timestamp: string | null
  trf_timestamp: string | null
  sip_timestamp: string | null
  last_price: number | null
  last_tick: string | null
  last_size: number | null
  last_timestamp: string | null
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  exchange_volume: number | null
  prev_close: number | null
  change: number | null
  change_percent: number | null
  year_high: number | null
  year_low: number | null
  [key: string]: unknown
}

// ==================== NBBO ====================

export interface EquityNBBOQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface EquityNBBOData {
  ask_exchange: string
  ask: number
  ask_size: number
  bid_size: number
  bid: number
  bid_exchange: string
  [key: string]: unknown
}

// ==================== Price Performance ====================

export interface PricePerformanceQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface PricePerformanceData {
  symbol: string
  name: string | null
  price: number
  change: number
  percent_change: number
  volume: number | null
  [key: string]: unknown
}
