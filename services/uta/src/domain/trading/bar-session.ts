/**
 * Which trading session a historical-bar request should cover. Whether an
 * instrument has a regular session at all is a property of the instrument, not
 * a caller preference, so the policy lives here rather than in each adapter.
 */

import type { BarSession, HistoricalBarsCapability } from '@traderalice/uta-protocol'

/** Instruments with no regular session; the continuous tape is the only tape. */
const ALWAYS_CONTINUOUS = new Set(['CASH', 'CRYPTO'])

/**
 * Instruments that trade nearly around the clock but do have a defined regular
 * session: continuous by default, `regular` on request.
 */
const CONTINUOUS_BY_DEFAULT = new Set(['FUT', 'FOP', 'CFD', 'CMDTY'])

export interface ResolvedBarSession {
  /** The session the broker will actually be asked for. */
  session: BarSession
  /** True when the resolved session is not what the caller asked for. */
  forced: boolean
}

/**
 * Resolves the effective bar session. Instrument policy is applied before
 * broker capability, because an FX `regular` request is wrong at any broker.
 */
export function resolveBarSession(
  secType: string | undefined,
  requested: BarSession | undefined,
  capability: HistoricalBarsCapability | undefined,
): ResolvedBarSession {
  const kind = (secType ?? '').trim().toUpperCase()

  let session: BarSession
  let forced: boolean
  if (ALWAYS_CONTINUOUS.has(kind)) {
    // Even an explicit 'regular' is overridden: there is no regular session.
    session = 'extended'
    forced = requested === 'regular'
  } else if (CONTINUOUS_BY_DEFAULT.has(kind)) {
    session = requested ?? 'extended'
    forced = false
  } else {
    // A regular session is the safe default: a thin overnight tape distorts
    // every level.
    session = requested ?? 'regular'
    forced = false
  }

  // A broker can only honor the sessions it declares, so fall back to the
  // continuous tape when it offers one and to whatever it does offer otherwise.
  const supported = capability?.sessions
  if (supported && !supported.includes(session)) {
    const fallback = supported.includes('extended') ? 'extended' : supported[0]
    return { session: fallback ?? 'extended', forced: true }
  }
  if (!supported && session === 'regular') {
    return { session: 'extended', forced: true }
  }

  return { session, forced }
}
