export interface AlpacaBrokerConfig {
  id?: string
  label?: string
  apiKey: string
  secretKey: string
  paper: boolean
}

// ==================== Alpaca SDK raw shapes ====================

export interface AlpacaBrokerRaw {
  cash: string
  portfolio_value: string
  equity: string
  buying_power: string
  daytrade_count: number
  daytrading_buying_power: string
}

export interface AlpacaPositionRaw {
  symbol: string
  side: string
  qty: string
  avg_entry_price: string
  current_price: string
  market_value: string
  unrealized_pl: string
  unrealized_plpc: string
  cost_basis: string
}

export interface AlpacaOrderRaw {
  id: string
  symbol: string
  side: string
  type: string
  qty: string | null
  notional: string | null
  limit_price: string | null
  stop_price: string | null
  time_in_force: string
  extended_hours: boolean
  status: string
  filled_avg_price: string | null
  filled_qty: string | null
  filled_at: string | null
  created_at: string
  reject_reason: string | null
}

export interface AlpacaSnapshotRaw {
  LatestTrade: { Price: number; Timestamp: string }
  LatestQuote: { BidPrice: number; AskPrice: number; Timestamp: string }
  DailyBar: { Volume: number }
}

export interface AlpacaFillActivityRaw {
  activity_type: 'FILL'
  symbol: string
  side: string
  qty: string
  price: string
  cum_qty: string
  leaves_qty: string
  transaction_time: string
  order_id: string
  type: string // 'fill' | 'partial_fill'
}

export interface AlpacaClockRaw {
  is_open: boolean
  next_open: string
  next_close: string
  timestamp: string
}
