export interface CurrencyHistoricalQuery {
  symbol: string
  start_date?: string
  end_date?: string
  interval?: string
  provider?: string
  [key: string]: unknown
}

export interface CurrencyHistoricalData {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
  vwap: number | null
  [key: string]: unknown
}

export interface CurrencySearchQuery {
  query?: string
  provider?: string
  [key: string]: unknown
}

export interface CurrencySearchData {
  symbol: string
  name: string | null
  [key: string]: unknown
}

export interface CurrencyReferenceRatesQuery {
  provider?: string
  [key: string]: unknown
}

export interface CurrencyReferenceRatesData {
  date: string
  [key: string]: unknown
}

export interface CurrencySnapshotsQuery {
  base?: string
  quote_type?: 'direct' | 'indirect'
  counter_currencies?: string
  provider?: string
  [key: string]: unknown
}

export interface CurrencySnapshotsData {
  base_currency: string
  counter_currency: string
  last_rate: number
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  prev_close: number | null
  [key: string]: unknown
}
