/**
 * Reference-data service — in-process implementation of the reference
 * contract (see types.ts). Aggregates the opentypebb SDK clients into
 * board-shaped payloads with the explicit meta envelope.
 */

import type { DerivativesClientLike, EconomyClientLike, EquityClientLike } from '../client/types.js'
import type { CalendarBoard, MacroBoard, MoversBoard, ReferenceDataService } from './types.js'
import { fetchMacroBoard } from './macro.js'
import { fetchTermStructure, type TermStructureBoard } from './term-structure.js'

export interface ReferenceDataDeps {
  equityClient: EquityClientLike
  economyClient: EconomyClientLike
  /** Only on the typebb-sdk backend — the openbb-api client set has no
   *  derivatives twin. Term structure fails loud without it. */
  derivativesClient?: DerivativesClientLike
  /** Configured default equity provider — the meta label. On the SDK backend
   *  the client routes by its constructed default, so the label is the
   *  REQUESTED provider (same caveat as the bar layer's vendor meta). */
  equityProvider: string
}

/** Rows per movers list — enough for a board, small enough to stay snappy. */
const MOVERS_LIMIT = 25

/** Default forward window for the calendar board (days). */
const CALENDAR_DAYS = 14

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function createReferenceData(deps: ReferenceDataDeps): ReferenceDataService {
  return {
    async movers(): Promise<MoversBoard> {
      // One list failing must not kill the board — same resilience rule as
      // the federated search fan-out.
      const [gainers, losers, active] = await Promise.allSettled([
        deps.equityClient.getGainers(),
        deps.equityClient.getLosers(),
        deps.equityClient.getActive(),
      ])
      const rows = (r: PromiseSettledResult<MoversBoard['gainers']>) =>
        r.status === 'fulfilled' ? r.value.slice(0, MOVERS_LIMIT) : []
      return {
        gainers: rows(gainers),
        losers: rows(losers),
        active: rows(active),
        meta: { provider: deps.equityProvider, asOf: new Date().toISOString() },
      }
    },

    async calendar(opts): Promise<CalendarBoard> {
      const days = opts?.days ?? CALENDAR_DAYS
      const start = new Date()
      const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000)
      const window = { start: isoDay(start), end: isoDay(end) }
      // Calendars are FMP-only in the provider catalog — explicit, same as
      // the equityGetEarningsCalendar tool.
      const params = { provider: 'fmp', start_date: window.start, end_date: window.end }
      const [earnings, ipos, dividends] = await Promise.allSettled([
        deps.equityClient.getCalendarEarnings(params),
        deps.equityClient.getCalendarIpo(params),
        deps.equityClient.getCalendarDividend(params),
      ])
      // All three down = the key is missing/invalid — fail loud with the
      // upstream message instead of rendering a silently empty board.
      if (earnings.status === 'rejected' && ipos.status === 'rejected' && dividends.status === 'rejected') {
        throw earnings.reason instanceof Error
          ? earnings.reason
          : new Error(String(earnings.reason))
      }
      const rows = <T>(r: PromiseSettledResult<T[]>) => (r.status === 'fulfilled' ? r.value : [])
      // Partial failures stay loud too: a suspended/limited FMP tier can
      // reject one endpoint while siblings return 200 — annotate per list.
      const errors: NonNullable<CalendarBoard['errors']> = {}
      const note = (key: keyof NonNullable<CalendarBoard['errors']>, r: PromiseSettledResult<unknown>) => {
        if (r.status === 'rejected') {
          errors[key] = r.reason instanceof Error ? r.reason.message : String(r.reason)
        }
      }
      note('earnings', earnings)
      note('ipos', ipos)
      note('dividends', dividends)
      return {
        earnings: rows(earnings),
        ipos: rows(ipos),
        dividends: rows(dividends),
        window,
        ...(Object.keys(errors).length ? { errors } : {}),
        meta: { provider: 'fmp', asOf: new Date().toISOString() },
      }
    },

    async macro(): Promise<MacroBoard> {
      // Single upstream (FRED) — a failure IS the board failing; let it
      // throw so the route returns the actionable key-missing message.
      return fetchMacroBoard(deps.economyClient)
    },

    async termStructure(): Promise<TermStructureBoard> {
      if (!deps.derivativesClient) {
        throw new Error('Term structure requires the typebb-sdk market-data backend (derivatives client unavailable).')
      }
      return fetchTermStructure(deps.derivativesClient)
    },
  }
}
