/**
 * Reference-data API — `/api/reference/*`.
 *
 * OpenAlice's own low-frequency data contract (boards: movers, macro,
 * calendar, …). New market surfaces consume THIS namespace — never the
 * legacy OpenBB-compatible `/api/market-data-v1` passthrough.
 */

import { fetchJson } from './client'

/** Envelope on every reference payload — provider is an explicit label,
 *  shown in the UI (same disambiguation philosophy as bar sources). */
export interface ReferenceMeta {
  provider: string
  asOf: string
  cachedAt?: string
}

/** One row of a movers list (gainers / losers / active). */
export interface MoverRow {
  symbol: string
  name: string | null
  price: number | null
  change: number | null
  percent_change: number | null
  volume: number | null
  avg_volume: number | null
  /** Today's volume / 3-month average — the "unusual for itself?" read. */
  relative_volume: number | null
  turnover: number | null
  /** Price × volume — the cross-ticker-comparable "where is the money" read. */
  dollar_volume: number | null
}

export interface MoversBoard {
  gainers: MoverRow[]
  losers: MoverRow[]
  active: MoverRow[]
  meta: ReferenceMeta
}

/** One earnings-calendar row (FMP). */
export interface EarningsEvent {
  report_date: string
  symbol: string
  name: string | null
  eps_previous: number | null
  eps_consensus: number | null
}

export interface IpoEvent {
  symbol: string | null
  ipo_date: string | null
  [k: string]: unknown
}

export interface DividendEvent {
  ex_dividend_date: string
  symbol: string
  amount: number | null
  name: string | null
  record_date: string | null
  payment_date: string | null
}

export interface CalendarBoard {
  earnings: EarningsEvent[]
  ipos: IpoEvent[]
  dividends: DividendEvent[]
  window: { start: string; end: string }
  /** Per-list upstream failures (e.g. FMP tier rejects one endpoint). */
  errors?: Partial<Record<'earnings' | 'ipos' | 'dividends', string>>
  meta: ReferenceMeta
}

export type MacroUnit = 'percent' | 'usd' | 'index' | 'count'

export interface MacroPoint {
  date: string
  value: number
}

export interface MacroSeriesCard {
  id: string
  label: string
  unit: MacroUnit
  points: MacroPoint[]
  latest: number | null
  latestDate: string | null
  change: number | null
}

export interface MacroBoard {
  cards: MacroSeriesCard[]
  meta: ReferenceMeta
}

export interface TermPoint {
  expiration: string
  price: number | null
  daysToExpiry: number | null
  /** Annualized basis vs the perpetual, percent. */
  annualizedBasis: number | null
}

export interface TermCurve {
  symbol: string
  spot: number | null
  points: TermPoint[]
}

export interface TermStructureBoard {
  curves: TermCurve[]
  errors?: Record<string, string>
  meta: ReferenceMeta
}

export const referenceApi = {
  movers: () => fetchJson<MoversBoard>('/api/reference/movers'),
  calendar: () => fetchJson<CalendarBoard>('/api/reference/calendar'),
  macro: () => fetchJson<MacroBoard>('/api/reference/macro'),
  termStructure: () => fetchJson<TermStructureBoard>('/api/reference/term-structure'),
}
