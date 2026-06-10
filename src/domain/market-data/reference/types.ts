/**
 * Reference-data contract — OpenAlice's OWN low-frequency data standard.
 *
 * This is the seam that replaces the OpenBB-compatible passthrough
 * (`/api/market-data-v1`, OBBject envelope, widgets.json). The contract is
 * shaped by what OpenAlice actually consumes (boards + detail panels), not
 * by what any provider happens to expose. Two implementations are planned:
 * in-process (this module, user's own keys) and the hosted OpenAlice hub
 * (same shapes over HTTP, shared cache) — clients must not be able to tell
 * the difference except through `meta`.
 *
 * Row shapes reuse the opentypebb standard models (they are ours — the TS
 * port owns them); what this contract adds is the board grouping and the
 * explicit `meta` envelope.
 */

import type {
  EquityDiscoveryData, CalendarEarningsData, CalendarIpoData, CalendarDividendData,
} from '@traderalice/opentypebb'
// Type-only circular import (term-structure.ts imports ReferenceMeta) — fine in TS.
import type { TermStructureBoard } from './term-structure.js'

/** Envelope on every reference payload. Provider is an explicit label —
 *  same philosophy as the bar layer's sourceId: annotate the source,
 *  never bury it in an internal rule. */
export interface ReferenceMeta {
  /** Upstream(s) that produced this payload, e.g. 'yfinance' or 'fred+bls+eia'. */
  provider: string
  /** Server time the payload was assembled (ISO). */
  asOf: string
  /** Set by the hub when a payload is served from cache. */
  cachedAt?: string
}

// ==================== Movers board ====================

export interface MoversBoard {
  gainers: EquityDiscoveryData[]
  losers: EquityDiscoveryData[]
  active: EquityDiscoveryData[]
  meta: ReferenceMeta
}

// ==================== Calendar board ====================

export interface CalendarBoard {
  earnings: CalendarEarningsData[]
  ipos: CalendarIpoData[]
  dividends: CalendarDividendData[]
  /** Window the board covers (YYYY-MM-DD, inclusive). */
  window: { start: string; end: string }
  /** Per-list upstream failures. A list can fail (e.g. FMP tier/suspension
   *  rejects one endpoint) while siblings succeed — surface it loudly
   *  instead of rendering a silently empty list. */
  errors?: Partial<Record<'earnings' | 'ipos' | 'dividends', string>>
  meta: ReferenceMeta
}

// ==================== Macro board ====================

export type MacroUnit = 'percent' | 'usd' | 'index' | 'count'

export interface MacroPoint {
  date: string
  value: number
}

/** One dashboard card — a curated FRED series (or a derived one, e.g.
 *  CPI YoY computed from the CPIAUCSL index). */
export interface MacroSeriesCard {
  /** FRED series id, or a derived id like 'CPI_YOY'. The UI maps known ids
   *  to localized labels; `label` is the English fallback. */
  id: string
  label: string
  unit: MacroUnit
  /** Recent observations for the sparkline (nulls dropped, ≤90 points). */
  points: MacroPoint[]
  latest: number | null
  latestDate: string | null
  /** Latest minus previous observation (same unit as the series). */
  change: number | null
}

export interface MacroBoard {
  cards: MacroSeriesCard[]
  meta: ReferenceMeta
}

// ==================== Service ====================

/** Board-shaped reference-data access. The webui routes are thin adapters
 *  over this; the AI tools that overlap (equityDiscover, ...) keep calling
 *  the clients directly for now and converge here as the contract grows. */
export interface ReferenceDataService {
  movers(): Promise<MoversBoard>
  /** Upcoming earnings / IPOs / ex-dividend dates. Requires an FMP key —
   *  fails loud with an actionable message when it's missing. */
  calendar(opts?: { days?: number }): Promise<CalendarBoard>
  /** Curated macro regime dashboard (rates, labor, inflation, oil, dollar).
   *  FRED-only by design — one key, one multi-series call. Fails loud when
   *  the FRED key is missing. */
  macro(): Promise<MacroBoard>
  /** BTC/ETH futures term structure from Deribit (keyless), with
   *  annualized basis vs the perpetual. Requires the typebb-sdk backend
   *  (the derivatives client has no openbb-api twin). */
  termStructure(): Promise<TermStructureBoard>
}
