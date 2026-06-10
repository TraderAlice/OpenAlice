/**
 * Crypto futures term structure — Deribit curve (keyless).
 *
 * The PERPETUAL row anchors as the spot proxy; dated futures get an
 * annualized basis vs that anchor: (fut/spot − 1) × 365/days. Contango /
 * backwardation reads directly off the sign.
 */

import type { DerivativesClientLike } from '../client/types.js'
import type { ReferenceMeta } from './types.js'

export interface TermPoint {
  /** ISO expiry date, e.g. '2026-09-25'. */
  expiration: string
  price: number | null
  daysToExpiry: number | null
  /** Annualized basis vs the perpetual, in percent. Null when either leg
   *  is missing or expiry is too near for the annualization to be sane. */
  annualizedBasis: number | null
}

export interface TermCurve {
  symbol: string
  /** Perpetual price — the spot proxy the basis is computed against. */
  spot: number | null
  points: TermPoint[]
}

export interface TermStructureBoard {
  curves: TermCurve[]
  errors?: Record<string, string>
  meta: ReferenceMeta
}

const SYMBOLS = ['BTC', 'ETH']

/** Below ~a week the 365/days multiplier turns funding noise into ±30%
 *  "basis" (seen live: a $112 discount 3 days out annualized to −24%). */
const MIN_DAYS_FOR_BASIS = 7

export async function fetchTermStructure(
  derivativesClient: DerivativesClientLike,
): Promise<TermStructureBoard> {
  const settled = await Promise.allSettled(
    SYMBOLS.map((symbol) => derivativesClient.getFuturesCurve({ provider: 'deribit', symbol })),
  )

  if (settled.every((r) => r.status === 'rejected')) {
    const first = (settled[0] as PromiseRejectedResult).reason
    throw first instanceof Error ? first : new Error(String(first))
  }

  const now = Date.now()
  const curves: TermCurve[] = []
  const errors: Record<string, string> = {}

  settled.forEach((r, i) => {
    const symbol = SYMBOLS[i]
    if (r.status === 'rejected') {
      errors[symbol] = r.reason instanceof Error ? r.reason.message : String(r.reason)
      return
    }
    const rows = r.value
    const perp = rows.find((row) => row.expiration === 'PERPETUAL')
    const spot = perp?.price ?? null
    const points: TermPoint[] = rows
      .filter((row) => row.expiration !== 'PERPETUAL')
      .map((row) => {
        const expiryMs = Date.parse(row.expiration + 'T08:00:00Z') // Deribit expiry 08:00 UTC
        const days = Number.isFinite(expiryMs) ? (expiryMs - now) / 86400000 : null
        const basis =
          spot != null && row.price != null && days != null && days >= MIN_DAYS_FOR_BASIS
            ? (row.price / spot - 1) * (365 / days) * 100
            : null
        return {
          expiration: row.expiration,
          price: row.price ?? null,
          daysToExpiry: days != null ? Math.round(days) : null,
          annualizedBasis: basis,
        }
      })
      .sort((a, b) => a.expiration.localeCompare(b.expiration))
    curves.push({ symbol, spot, points })
  })

  return {
    curves,
    ...(Object.keys(errors).length ? { errors } : {}),
    meta: { provider: 'deribit', asOf: new Date().toISOString() },
  }
}
