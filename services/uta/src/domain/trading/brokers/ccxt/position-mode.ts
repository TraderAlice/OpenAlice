/**
 * Position-mode-aware order placement — the shared shape behind the CcxtBroker
 * per-exchange hedge overrides.
 *
 * Position mode (one-way/net vs hedge/dual-side) is an ACCOUNT setting, not a
 * per-order choice, and a hedged account rejects an order that does not name the
 * position it belongs to (OKX 51000, Binance -4061, Bitget 40774). ccxt emits
 * those fields only when the caller supplies them — or via an inferred `hedged`
 * flag that ccxt derives from the ORDER SIDE, which is a guess about intent, not
 * a reading of the account. So every venue that can be in hedge mode needs the
 * field supplied deliberately, from the account's actual mode, read from the
 * venue's own endpoint on the send path.
 *
 * A PositionModePolicy is all a venue has to provide. Everything that is not
 * venue-specific — reading at send time, never inventing a mode when the read
 * fails, leaving one-way accounts byte-for-byte as they were, and annotating the
 * send that surfaces a mismatch — lives here once.
 *
 * Two safety properties this module is built around:
 *
 * 1. An unknown mode stays unknown. A failed read sends exactly the payload the
 *    venue received before this override existed, and the caller gets the
 *    venue's own rejection — annotated with the failed read — rather than a
 *    guessed position side.
 * 2. A cached mode can only fail CLOSED. Caching exists only for venues whose
 *    read is expensive (Binance's GET /fapi/v1/positionSide/dual carries IP
 *    weight 30), and a stale answer is a REJECTION, not a wrong fill: a stale
 *    'hedge' answer against a now-one-way account sends a field the venue no
 *    longer accepts, a stale 'one-way' answer against a now-hedge account omits
 *    it, and both are refusals the caller may retry once `staleError` has
 *    dropped the cache entry.
 */

import type { Exchange, Market, Order as CcxtOrder } from 'ccxt'
import type { CcxtExchangeOverrides } from './overrides.js'

/** The only two modes a venue in this adapter family can be in. */
export type PositionMode = 'one-way' | 'hedge'

/** The order fields a mode/intent combination produces, and what it must drop. */
export interface PositionModeOrderFields {
  /** Fields to add to the order params. */
  set?: Record<string, unknown>
  /** Params that must not reach the wire in this mode (e.g. reduceOnly). */
  drop?: readonly string[]
}

export interface PositionModePolicy<M extends string = PositionMode> {
  /** Venue id used in warnings, e.g. 'okx'. */
  readonly venue: string

  /** The caller-supplied field that overrides detection entirely. */
  readonly explicitField: string

  /** What the venue answers when the payload named the wrong position — carried
   *  into the fallback error so a mismatch never reads like a generic param. */
  readonly mismatchNote: string

  /** Read the account's mode from the venue's own endpoint. Must throw rather
   *  than return a guessed mode: an unreadable account config is not a mode. */
  read(exchange: Exchange): Promise<M>

  /** True when this mode is the hedged / dual-side one. */
  isHedge(mode: M): boolean

  /** True when the instrument must never carry the hedge field (spot, margin,
   *  options). Venues differ here; the rule is per venue, not shared. */
  suppressesInstrument(market: Market | undefined): boolean

  /** Read the mode even when suppressesInstrument() is true, i.e. the venue is
   *  consulted before the instrument gate. Default false: an instrument that can
   *  never carry the field (spot, margin) must not pay for a read that cannot
   *  change its payload — on Binance that read is IP weight 30.
   *
   *  OKX sets this true to preserve the behaviour asserted by
   *  CcxtBroker.spec.ts:989 ('never sends posSide for spot on a long/short
   *  account' asserts privateGetAccountConfig is called exactly once for a spot
   *  order). That assertion pins a read whose result cannot affect a spot order;
   *  it is preserved deliberately here rather than silently re-anchored. */
  readWhenSuppressed?: boolean

  /** The payload for this mode and order intent. Called only when the mode is
   *  hedged and the instrument is not suppressed. */
  orderFields(input: { side: 'buy' | 'sell'; reducing: boolean }): PositionModeOrderFields

  /** Opt-in caching for venues whose read is expensive. Omit to read per order
   *  (the cheap-read case, where a cache can only add staleness). */
  cache?: {
    ttlMs: number
    /** True when this venue error PROVES the cached mode was stale. Matched on
     *  the venue's error code/class, never on message text, which venues reword. */
    staleError(err: unknown): boolean
  }
}

interface CachedMode {
  mode: string
  at: number
}

interface ModeReaderInternals {
  markets?: Record<string, Market>
}

/** Per-exchange cache. WeakMap so a dropped exchange drops its entry. */
const cachedModes = new WeakMap<Exchange, CachedMode>()
/** In-flight reads, so simultaneous orders share one call instead of one each. */
const pendingReads = new WeakMap<Exchange, Promise<string>>()

export interface PositionModeReader<M extends string> {
  /** The mode as of this order. Never serves an answer older than the policy's
   *  TTL, and never serves one at all after invalidate(). */
  read(exchange: Exchange): Promise<M>
  /** Drop the cached answer. Called when a venue error proves it stale, or by
   *  any future code path that changes the account's mode. */
  invalidate(exchange: Exchange): void
}

export function createPositionModeReader<M extends string>(
  policy: PositionModePolicy<M>,
): PositionModeReader<M> {
  return {
    async read(exchange: Exchange): Promise<M> {
      const cached = cachedModes.get(exchange)
      if (cached && policy.cache && Date.now() - cached.at < policy.cache.ttlMs) {
        return cached.mode as M
      }
      const inFlight = pendingReads.get(exchange)
      if (inFlight) return (await inFlight) as M

      const read = (async () => {
        const mode = await policy.read(exchange)
        if (policy.cache) cachedModes.set(exchange, { mode, at: Date.now() })
        return mode
      })()
      const release = () => {
        if (pendingReads.get(exchange) === read) pendingReads.delete(exchange)
      }
      void read.then(release, release)
      pendingReads.set(exchange, read)
      return (await read) as M
    },

    invalidate(exchange: Exchange): void {
      cachedModes.delete(exchange)
    },
  }
}

/** Is this error the venue telling us the payload named the wrong position? */
export function isPositionModeStale<M extends string>(
  policy: PositionModePolicy<M>,
  err: unknown,
): boolean {
  return policy.cache?.staleError(err) === true
}

type PlaceOrderFn = NonNullable<CcxtExchangeOverrides['placeOrder']>

/**
 * Build the `placeOrder` override for a policy: the same flow for every venue.
 *
 * Order of decisions, and why:
 *  - an explicit caller-supplied field is a wire decision, so the venue is not
 *    even asked for a mode it would not use;
 *  - an instrument that can never carry the field is not read at all, unless the
 *    policy opts in (readWhenSuppressed) to keep a venue's read-before-instrument
 *    order;
 *  - the mode is read per order (or per TTL), because a mode older than the
 *    order it mutates is how a close becomes an open;
 *  - a failed read degrades to the untouched payload and the resulting venue
 *    error carries the failed read with it;
 *  - one-way accounts send byte-for-byte what they sent before.
 */
export function makePositionModePlaceOrder<M extends string>(
  policy: PositionModePolicy<M>,
): PlaceOrderFn {
  const reader = createPositionModeReader(policy)

  return async function placeOrder(
    exchange: Exchange,
    symbol: string,
    type: string,
    side: 'buy' | 'sell',
    amount: number,
    price: number | undefined,
    params: Record<string, unknown>,
    defaultImpl,
  ): Promise<CcxtOrder> {
    if (params[policy.explicitField] !== undefined) {
      return await defaultImpl(exchange, symbol, type, side, amount, price, params)
    }

    const markets = (exchange as unknown as ModeReaderInternals).markets
    const market = markets?.[symbol]
    const suppressed = policy.suppressesInstrument(market)
    if (suppressed && policy.readWhenSuppressed !== true) {
      return await defaultImpl(exchange, symbol, type, side, amount, price, params)
    }

    let mode: M
    try {
      mode = await reader.read(exchange)
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err)
      console.warn(
        `ccxt[${policy.venue}]: cannot read account position mode (${cause}) — sending ${symbol} without ${policy.explicitField}; ${policy.mismatchNote}`,
      )
      try {
        return await defaultImpl(exchange, symbol, type, side, amount, price, params)
      } catch (sendErr) {
        const venueMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
        throw new Error(
          `${venueMsg} — note: account position mode detection failed (${cause}), so no ${policy.explicitField} was sent`,
        )
      }
    }

    // The read happened (readWhenSuppressed), but the field it would decide still
    // must not reach a spot or margin order.
    if (suppressed) {
      return await defaultImpl(exchange, symbol, type, side, amount, price, params)
    }

    if (!policy.isHedge(mode)) {
      return await defaultImpl(exchange, symbol, type, side, amount, price, params)
    }

    // The broker's close path marks its intent with reduceOnly: without that
    // marker a plain sell of a long would open a short instead of closing it.
    const reducing = params['reduceOnly'] === true
    const { set, drop } = policy.orderFields({ side, reducing })

    const hedgeParams: Record<string, unknown> = { ...params, ...(set ?? {}) }
    for (const key of drop ?? []) delete hedgeParams[key]

    try {
      return await defaultImpl(exchange, symbol, type, side, amount, price, hedgeParams)
    } catch (sendErr) {
      // A venue error that proves the cached mode wrong must not leave it cached
      // for the next order — the next send has to re-read.
      if (isPositionModeStale(policy, sendErr)) reader.invalidate(exchange)
      throw sendErr
    }
  }
}
