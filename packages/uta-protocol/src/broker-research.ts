import { z } from 'zod'
import type { Contract } from '@traderalice/ibkr'
import type { ExecutableSpread, MidSpread } from './contract-pairing.js'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const optionResearchSchema = z.object({
  aliceId: z.string().min(1).describe('Underlying stock aliceId from contract search'),
  expiration: date.optional(), expirationFrom: date.optional(), expirationTo: date.optional(),
  right: z.enum(['call', 'put']).optional(),
  strikeMin: z.number().nonnegative().optional(), strikeMax: z.number().nonnegative().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  pageToken: z.string().optional().describe('Continue with the returned nextPageToken and the same filters'),
  feed: z.enum(['indicative', 'opra']).optional().describe('Snapshots only; defaults to indicative (modified quotes, delayed trades). OPRA needs entitlement.'),
})
export const orderBookSchema = z.object({
  aliceId: z.string().min(1), limit: z.number().int().min(1).max(100).optional(),
})
export type OptionResearchRequest = z.infer<typeof optionResearchSchema>
export type OptionResearchFilters = Omit<OptionResearchRequest, 'aliceId'>

/**
 * Perpetual funding rates.
 *
 * A funding rate is the rate charged PER FUNDING PERIOD — not an annualized
 * figure and not an amount. Annualizing it multiplies by the venue's cadence
 * (8h on binance/okx/bybit today, and venues have moved pairs off it), so the
 * caller derives that cadence from the data instead of assuming it. A positive
 * rate follows the venue's long-pays-short convention for the period: longs
 * pay shorts.
 *
 * Both reads are public market data — no entitlement and no credentials.
 */
export const fundingRateSchema = z.object({
  aliceId: z.string().min(1),
})
export const fundingRateHistorySchema = z.object({
  aliceId: z.string().min(1),
  // Both 'Z' and offset ('+08:00') forms name the same instant and callers emit
  // either; a bare date is not a time and is rejected.
  start: z.string().datetime({ offset: true }).optional().describe("ISO 8601 lower bound; omitted reads the venue's most recent periods"),
  limit: z.number().int().min(1).max(1000).optional().describe('Truncates to the MOST RECENT periods in the window, like every other limit in this protocol'),
})
export type FundingRateRequest = z.infer<typeof fundingRateSchema>
export type FundingRateHistoryRequest = z.infer<typeof fundingRateHistorySchema>
export type FundingRateHistoryParams = Omit<FundingRateHistoryRequest, 'aliceId'>

/** Optional structural capabilities: old broker packs continue to load. */
export interface BrokerResearch {
  getOptionContracts?(underlying: string, filters: OptionResearchFilters): Promise<Record<string, unknown>>
  getOptionChain?(underlying: string, filters: OptionResearchFilters): Promise<Record<string, unknown>>
  getOrderBook?(contract: Contract, limit?: number): Promise<unknown>
  getFundingRate?(contract: Contract): Promise<unknown>
  getFundingRateHistory?(contract: Contract, params: FundingRateHistoryParams): Promise<unknown>
}

// ==================== Cross-venue spread (read-only) ====================

/**
 * One venue's leg of a cross-venue spread read.
 *
 * `bid` / `ask` are null whenever the venue reported no tradeable side.
 * CCXT-backed venues surface a missing side as the *string* `"0"`
 * (`String(ticker.bid ?? 0)`), and a 0 price is "no quote", never a level:
 * a silent venue must not be elected the cheapest place to buy.
 */
export interface VenueQuoteLeg {
  /** UTA id that answered this leg. */
  source: string
  /** The requested aliceId, verbatim. */
  aliceId: string
  /** Venue-native symbol of the resolved contract ('' when the leg failed). */
  localSymbol: string
  bid: string | null
  ask: string | null
  last: string | null
  /** OUR local read-back time for this leg (ISO) — the clock `skewMs` is
   *  measured from. Deliberately the only time field on the wire:
   *  `Quote.timestamp` upstream is `ticker.timestamp ?? Date.now()`, so a
   *  venue that stamps nothing is indistinguishable from one that does. */
  observedAt: string
  /** How long THIS leg's read took locally, in ms. Legs are concurrent but
   *  not simultaneous: with `observedAt` this is how a caller judges whether
   *  the legs are comparable at all. */
  latencyMs: number
  /** Set when this leg failed; the call still returns the venues that answered. */
  error?: string
}

export interface VenueSpreadResult {
  /** Envelope timestamp taken immediately before the read fanned out. */
  asOf: string
  /** max(observedAt) − min(observedAt) over the successful legs, in ms.
   *  These are not simultaneous ticks: a skew comparable to the holding
   *  horizon makes the spread approximate. */
  skewMs: number
  /** The pairing key every successful leg agreed on. */
  pairingKey: string
  legs: VenueQuoteLeg[]
  /** null when fewer than two venues quote both sides (or they are one venue). */
  executableSpread: ExecutableSpread | null
  midSpread: MidSpread | null
}

export const venueSpreadSchema = z.object({
  aliceIds: z.array(z.string().min(1)).min(2).max(8).describe(
    '2–8 aliceIds, one per venue leg. Every leg must name the same instrument — same symbol, same quote currency, and same product type.',
  ),
})
