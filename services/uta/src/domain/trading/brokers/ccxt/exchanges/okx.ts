/**
 * OKX-specific overrides for CcxtBroker.
 *
 * OKX quirks:
 * - An account in long/short (hedged) position mode requires `posSide` on every
 *   FUTURES/SWAP order; omitting it is error 51000 ("Parameter posSide error").
 *   ccxt's okx mapping only emits the field when the caller passes
 *   params.positionSide or params.hedged === true
 *   (node_modules/ccxt/js/src/okx.js:3227-3248), and the broker passes neither,
 *   so every swap order on a hedge account was rejected (reported live: 9/9).
 *   Position mode is an ACCOUNT setting, not a per-order choice, so it is read
 *   from the venue (GET /api/v5/account/config → data[0].posMode: 'net_mode' |
 *   'long_short_mode') on the SEND path, for the order it decides — deliberately
 *   no local config field that could drift from the account, and no mode kept
 *   around to decide a later order. OKX's own integration demo reads posMode the
 *   same way: send posSide in long_short_mode, omit it in net_mode.
 * - `posSide` must NOT be sent for SPOT or MARGIN orders, and OKX documents
 *   reduceOnly as "Only applicable to MARGIN orders, and FUTURES/SWAP orders in
 *   net mode" — in long/short mode the posSide already names the position the
 *   order may only reduce, which is what ccxt's own hedged branch relies on (it
 *   drops the param there: okx.js:3240-3244).
 *
 * The flow is the shared position-mode seam (../position-mode.ts); this file
 * supplies only the parts that are OKX's own — how to read the mode, which mode
 * is hedged, which instruments may never carry posSide, and the side/posSide
 * mapping. The seam declares no `cache` for OKX: the account-config read is
 * cheap (5 requests / 2s) and a mode older than the order it mutates is exactly
 * how a close becomes an open.
 *
 * One deliberate asymmetry: OKX sets `readWhenSuppressed`, so a spot or margin
 * order still consults the account even though the answer cannot change its
 * payload — that read is what CcxtBroker.spec.ts:989 pins.
 *
 * A raw `params.posSide` does reach the wire: createOrderRequest ends with
 * `return this.extend(request, params)` (okx.js:3472), `posSide` is not in its
 * omit list, and createOrder sends that same body — wrapped in an array, to the
 * batch endpoint this ccxt version defaults to (okx.js:3509-3524). Nothing here
 * depends on ccxt's `hedged` flag.
 */

import type { Exchange } from 'ccxt'
import type { CcxtExchangeOverrides } from '../overrides.js'
import { makePositionModePlaceOrder } from '../position-mode.js'
import type { PositionModePolicy } from '../position-mode.js'

/** `posMode` values reported by GET /api/v5/account/config. */
export type OkxPositionMode = 'net_mode' | 'long_short_mode'

/** Ccxt-internal surface this override relies on (untyped in ccxt's d.ts). */
interface OkxExchangeInternals {
  /** Implicit API method — okx.fetchAccounts() wraps exactly this call. */
  privateGetAccountConfig(params?: Record<string, unknown>): Promise<unknown>
}

/** Pull `data[0].posMode` out of the raw account-config envelope. Any shape this
 *  adapter does not recognize yields undefined rather than a guessed mode. */
function readPositionMode(response: unknown): OkxPositionMode | undefined {
  if (typeof response !== 'object' || response === null || !('data' in response)) return undefined
  const data = response.data
  if (!Array.isArray(data)) return undefined
  const first: unknown = data[0]
  if (typeof first !== 'object' || first === null || !('posMode' in first)) return undefined
  const mode = first.posMode
  return mode === 'net_mode' || mode === 'long_short_mode' ? mode : undefined
}

/** OKX's share of the position-mode contract. */
const okxPositionModePolicy: PositionModePolicy<OkxPositionMode> = {
  venue: 'okx',

  explicitField: 'posSide',

  mismatchNote: 'a long/short account rejects that with 51000',

  /** The account's mode as of the order being placed. The seam calls this on the
   *  send path and never serves an earlier answer (no TTL for OKX), so a mode
   *  switch lands on the very next order; simultaneous orders share one call. */
  async read(exchange: Exchange): Promise<OkxPositionMode> {
    const internals = exchange as unknown as OkxExchangeInternals
    const response = await internals.privateGetAccountConfig({})
    const parsed = readPositionMode(response)
    if (parsed === undefined) {
      throw new Error('okx: account config carries no usable posMode')
    }
    return parsed
  },

  isHedge: (mode) => mode === 'long_short_mode',

  // posSide is a futures/swap parameter: OKX rejects it on spot and margin, so
  // those instruments never carry the field. An unresolvable market is not a
  // derivative.
  suppressesInstrument: (market) => market?.type !== 'swap' && market?.type !== 'future',

  // This file used to read the mode FIRST and ask what the instrument was only
  // afterwards, so a spot order does ask the venue for a mode it will not use.
  // CcxtBroker.spec.ts:989 pins that read: 'never sends posSide for spot on a
  // long/short account' expects exactly one account-config read for a spot order,
  // so the read is kept deliberately instead of being re-anchored away.
  readWhenSuppressed: true,

  orderFields: ({ side, reducing }) => ({
    // side + posSide maps the order onto a position: buy/long and sell/short add
    // to that side, while sell/long and buy/short reduce it. The broker's close
    // path marks its intent with reduceOnly — without it, a plain sell of a long
    // would open a short.
    set: { posSide: reducing
      ? (side === 'sell' ? 'long' : 'short')
      : (side === 'buy' ? 'long' : 'short') },
    // reduceOnly is documented for net mode only, and posSide already limits this
    // order to the position it names — ccxt's hedged branch drops the param for
    // the same reason (okx.js:3240-3244). Keeping it risks an out-of-scope param
    // rejection on every close, which is the failure this override exists to fix.
    drop: ['reduceOnly'],
  }),
}

const okxPlaceOrder = makePositionModePlaceOrder(okxPositionModePolicy)

export const okxOverrides: CcxtExchangeOverrides = {
  placeOrder: okxPlaceOrder,
  // CcxtBroker has normalized TP/SL into params; ccxt maps those nested fields
  // to attachAlgoOrds for OKX spot and swap orders (okx.js:3324-3417).
  placeOrderWithTpSl: (exchange, symbol, type, side, amount, price, _tpsl, params) =>
    okxPlaceOrder(
      exchange,
      symbol,
      type,
      side,
      amount,
      price,
      params,
      (exchange, symbol, type, side, amount, price, params) =>
        exchange.createOrder(symbol, type, side, amount, price, params),
    ),
}
