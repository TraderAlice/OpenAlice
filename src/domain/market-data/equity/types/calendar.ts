/**
 * Equity Calendar types — mirrors OpenBB standard_models:
 *   calendar_ipo.py, calendar_dividend.py, calendar_splits.py,
 *   calendar_earnings.py, calendar_events.py
 */

// ==================== Calendar IPO ====================

export interface CalendarIpoQuery {
  symbol?: string
  start_date?: string
  end_date?: string
  limit?: number
  provider?: string
  [key: string]: unknown
}

export interface CalendarIpoData {
  symbol: string | null
  ipo_date: string | null
  [key: string]: unknown
}

// ==================== Calendar Dividend ====================

export interface CalendarDividendQuery {
  start_date?: string
  end_date?: string
  provider?: string
  [key: string]: unknown
}

export interface CalendarDividendData {
  ex_dividend_date: string
  symbol: string
  amount: number | null
  name: string | null
  record_date: string | null
  payment_date: string | null
  declaration_date: string | null
  [key: string]: unknown
}

// ==================== Calendar Splits ====================

export interface CalendarSplitsQuery {
  start_date?: string
  end_date?: string
  provider?: string
  [key: string]: unknown
}

export interface CalendarSplitsData {
  date: string
  symbol: string
  numerator: number
  denominator: number
  [key: string]: unknown
}

// ==================== Calendar Earnings ====================

export interface CalendarEarningsQuery {
  start_date?: string
  end_date?: string
  provider?: string
  [key: string]: unknown
}

export interface CalendarEarningsData {
  report_date: string
  symbol: string
  name: string | null
  eps_previous: number | null
  eps_consensus: number | null
  [key: string]: unknown
}

// ==================== Calendar Events ====================

export interface CalendarEventsQuery {
  start_date?: string
  end_date?: string
  provider?: string
  [key: string]: unknown
}

export interface CalendarEventsData {
  date: string | null
  name: string | null
  description: string | null
  [key: string]: unknown
}
