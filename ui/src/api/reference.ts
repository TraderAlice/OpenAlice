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
  /** Which path served: the hosted hub or a local build with your keys. */
  origin?: 'hub' | 'local'
  /** Upstream refresh failed; this is the last good payload. */
  stale?: boolean
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
  /** Yahoo screeners — value/growth/size lenses, same row shape. */
  undervaluedGrowth: MoverRow[]
  growthTech: MoverRow[]
  smallCaps: MoverRow[]
  undervaluedLarge: MoverRow[]
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

export interface ValuationStrip {
  cards: MacroSeriesCard[]
  meta: ReferenceMeta
}

export interface GlobalMacroCell {
  value: number | null
  date: string | null
  error?: string
}

export interface GlobalMacroRow {
  country: string
  label: string
  cpiYoy: GlobalMacroCell
  shortRate: GlobalMacroCell
  cli: GlobalMacroCell
  /** Real house price index, 2015 = 100. */
  housePrice: GlobalMacroCell
  /** Share price index, 2015 = 100. */
  sharePrice: GlobalMacroCell
}

export interface GlobalMacroBoard {
  rows: GlobalMacroRow[]
  meta: ReferenceMeta
}

export interface ShippingPoint {
  date: string
  tons: number | null
  vessels: number | null
}

export interface ShippingCurve {
  key: string
  name: string
  points: ShippingPoint[]
  latest: ShippingPoint | null
}

export interface ShippingBoard {
  curves: ShippingCurve[]
  errors?: Record<string, string>
  meta: ReferenceMeta
}

export interface FedDocument {
  date: string
  title: string
  type: string
  url: string
}

export interface FedBoard {
  cards: MacroSeriesCard[]
  documents: FedDocument[]
  errors?: Partial<Record<'balanceSheet' | 'dealers' | 'documents', string>>
  meta: ReferenceMeta
}

export interface CnIndexCard {
  id: string
  code: string
  label: string
  source: 'CSI' | 'CNI'
  tradeDate: string
  close: number | null
  /** Percent units (0.16 = +0.16%), matching CSI changePct. */
  changePct: number | null
  amount: number | null
  pe: number | null
  quality: 'A' | 'B' | 'C'
  domain: 'market' | 'flow'
  dataType: 'official_close' | 'exchange_day_end'
}

export interface CnConnectTopName {
  rank: number
  code: string
  name: string
  turnover: number | null
}

export interface CnConnectLeg {
  market: string
  tradeDate: string
  turnover: number | null
  tradeCount: number | null
  etfTurnover: number | null
  buyTurnover: number | null
  sellTurnover: number | null
  top10: CnConnectTopName[]
  source: 'HKEX'
  quality: 'A' | 'B' | 'C'
  domain: 'market' | 'flow'
  dataType: 'official_close' | 'exchange_day_end'
  turnoverUnit: 'RMB_million' | 'HKD_million' | 'unknown'
}

export interface CnAshareBoard {
  sessionDate: string | null
  indexes: CnIndexCard[]
  connect: {
    sse: CnConnectLeg | null
    szse: CnConnectLeg | null
    hkex: {
      sseSouthbound: CnConnectLeg | null
      szseSouthbound: CnConnectLeg | null
    }
  }
  errors?: {
    indexes?: string
    connect?: string
    sse?: string
    szse?: string
    hkex?: string
  }
  meta: ReferenceMeta
}

export const referenceApi = {
  movers: () => fetchJson<MoversBoard>('/api/reference/movers'),
  calendar: () => fetchJson<CalendarBoard>('/api/reference/calendar'),
  macro: () => fetchJson<MacroBoard>('/api/reference/macro'),
  termStructure: () => fetchJson<TermStructureBoard>('/api/reference/term-structure'),
  valuation: () => fetchJson<ValuationStrip>('/api/reference/valuation'),
  globalMacro: () => fetchJson<GlobalMacroBoard>('/api/reference/global-macro'),
  shipping: () => fetchJson<ShippingBoard>('/api/reference/shipping'),
  fed: () => fetchJson<FedBoard>('/api/reference/fed'),
  cnAshare: () => fetchJson<CnAshareBoard>('/api/reference/cn-ashare'),
}
