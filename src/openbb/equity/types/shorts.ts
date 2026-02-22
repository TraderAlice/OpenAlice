/**
 * Equity Shorts types — mirrors OpenBB standard_models:
 *   equity_ftd.py, short_volume.py, equity_short_interest.py
 */

// ==================== Fails to Deliver ====================

export interface EquityFtdQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface EquityFtdData {
  settlement_date: string | null
  symbol: string | null
  cusip: string | null
  quantity: number | null
  price: number | null
  description: string | null
  [key: string]: unknown
}

// ==================== Short Volume ====================

export interface ShortVolumeQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface ShortVolumeData {
  date: string | null
  market: string | null
  short_volume: number | null
  short_exempt_volume: number | null
  total_volume: number | null
  [key: string]: unknown
}

// ==================== Short Interest ====================

export interface ShortInterestQuery {
  symbol: string
  provider?: string
  [key: string]: unknown
}

export interface ShortInterestData {
  settlement_date: string
  symbol: string
  issue_name: string
  market_class: string
  current_short_position: number
  previous_short_position: number
  avg_daily_volume: number
  days_to_cover: number
  change: number
  change_pct: number
  [key: string]: unknown
}
