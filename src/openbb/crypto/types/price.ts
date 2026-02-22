/**
 * Crypto Price types — mirrors OpenBB standard_models:
 *   crypto_historical.py, crypto_search.py
 */

// ==================== Historical OHLCV ====================

export interface CryptoHistoricalQuery {
  symbol: string           // e.g. 'BTCUSD', 'ETH-USD'
  start_date?: string      // YYYY-MM-DD
  end_date?: string        // YYYY-MM-DD
  interval?: string        // '1d', '1h', '5m' etc.
  provider?: string
  [key: string]: unknown
}

export interface CryptoHistoricalData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  vwap: number | null
  [key: string]: unknown
}

// ==================== Search ====================

export interface CryptoSearchQuery {
  query?: string
  provider?: string
  [key: string]: unknown
}

export interface CryptoSearchData {
  symbol: string
  name: string | null
  [key: string]: unknown
}
