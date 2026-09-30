/**
 * Exchange-specific overrides for CcxtBroker.
 *
 * CCXT's "unified API" behaves differently across exchanges:
 * - Bybit: fetchOrder requires { acknowledged: true }, limited to last 500 orders
 * - Binance: fetchOrder works fine, but conditional orders need { stop: true }
 * - OKX/Bitget: no fetchOpenOrder/fetchClosedOrder singular methods
 * - Hyperliquid: market orders require a ref price, fetchPositions omits markPrice,
 *   balances live in the spot or perp clearinghouse depending on the wallet's
 *   account-abstraction mode (unified wallets read 0 from the perp default)
 *
 * Each tested exchange gets its own override file in exchanges/. Only override
 * what's different — unset methods fall through to the default.
 *
 * Override convention: every override receives the original args plus a final
 * `defaultImpl` parameter. The override can choose to:
 *   - call defaultImpl(...args)        → run the default behavior
 *   - call defaultImpl(modifiedArgs)   → modify inputs, then run default
 *   - postprocess defaultImpl's result → modify outputs
 *   - ignore defaultImpl entirely      → completely replace the implementation
 *
 * To add a new exchange:
 *   1. Create exchanges/<name>.ts exporting a CcxtExchangeOverrides object
 *   2. Only implement the methods that differ from defaults
 *   3. Register it in exchangeOverrides below
 */

import type { Exchange, Order as CcxtOrder, Position as CcxtPosition } from 'ccxt'
import { bitgetOverrides } from './exchanges/bitget.js'
import { bybitOverrides } from './exchanges/bybit.js'
import { hyperliquidOverrides } from './exchanges/hyperliquid.js'

// ==================== Override interface ====================

/** A function that calls the default implementation with the same arg shape. */
type DefaultImpl<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>

export interface CcxtExchangeOverrides {
  /** Fail account reads when one of the wallets or position namespaces this
   *  adapter claims to aggregate is unreadable. Use only where a partial read
   *  would look valid while hiding material funds or risk. */
  strictPrivateReads?: boolean

  /** Propagate an all-open-orders failure instead of degrading to an empty
   *  list. Verified multi-namespace adapters use this because a partial list
   *  is actively unsafe for external-order observation. */
  strictOpenOrderReads?: boolean

  /** Fetch one normalized balance wallet. Override when a venue needs routing
   *  parameters beyond the generic CCXT `type` selector. */
  fetchBalance?(
    exchange: Exchange,
    params: Record<string, unknown> | undefined,
    defaultImpl: DefaultImpl<[Exchange, Record<string, unknown> | undefined], Record<string, unknown>>,
  ): Promise<Record<string, unknown>>

  /** Fetch a single order by ID (regular + conditional). */
  fetchOrderById?(
    exchange: Exchange,
    orderId: string,
    symbol: string,
    defaultImpl: DefaultImpl<[Exchange, string, string], CcxtOrder>,
  ): Promise<CcxtOrder>

  /** Cancel an order by ID (regular + conditional). */
  cancelOrderById?(
    exchange: Exchange,
    orderId: string,
    symbol: string | undefined,
    defaultImpl: DefaultImpl<[Exchange, string, string | undefined], void>,
  ): Promise<void>

  /** Place an order via ccxt.createOrder. Override when an exchange needs custom prep
   *  (e.g. hyperliquid market orders require a reference price for slippage bounds). */
  placeOrder?(
    exchange: Exchange,
    symbol: string,
    type: string,
    side: 'buy' | 'sell',
    amount: number,
    price: number | undefined,
    params: Record<string, unknown>,
    defaultImpl: DefaultImpl<
      [Exchange, string, string, 'buy' | 'sell', number, number | undefined, Record<string, unknown>],
      CcxtOrder
    >,
  ): Promise<CcxtOrder>

  /** Fetch positions. Override when CCXT's parsePosition leaves important
   *  fields undefined (e.g. hyperliquid omits markPrice). */
  fetchPositions?(
    exchange: Exchange,
    defaultImpl: DefaultImpl<[Exchange], CcxtPosition[]>,
  ): Promise<CcxtPosition[]>

  /** Place an order WITH attached TP/SL, venue-verified. CcxtBroker
   *  refuses tpsl placement entirely when an exchange has no such
   *  override — observed live: ccxt's unified takeProfit/stopLoss params
   *  were silently dropped on okx spot and the entry filled unprotected.
   *  Implementations must map to the venue's real attach mechanism (okx:
   *  attachAlgoOrds; bybit: v5 takeProfit/stopLoss fields) and be verified
   *  live before registering. */
  placeOrderWithTpSl?(
    exchange: Exchange,
    symbol: string,
    type: string,
    side: 'buy' | 'sell',
    amount: number,
    price: number | undefined,
    tpsl: { takeProfit?: { price: string }; stopLoss?: { price: string; limitPrice?: string } },
    params: Record<string, unknown>,
  ): Promise<CcxtOrder>

  /** List ALL open orders across every market type the account trades.
   *  Override when the venue's listing endpoint is category-scoped and the
   *  unscoped call silently returns a subset (bybit: defaultType 'swap'
   *  hides spot orders — observed live, no error raised). */
  fetchAllOpenOrders?(
    exchange: Exchange,
    defaultImpl: DefaultImpl<[Exchange], CcxtOrder[]>,
  ): Promise<CcxtOrder[]>

  /** Sub-account (wallet / compartment) decomposition for SEPARATE-WALLET venues.
   *  Binance keeps spot / USDⓈ-M / COIN-M in distinct wallets behind distinct
   *  endpoints; each logical sub-account aggregates one or more CCXT balance
   *  `type`s. Drives `listSubAccounts()`, scoped reads, and write disambiguation
   *  (ANG-111). Leave undefined for UNIFIED-account venues (okx / bybit UTA),
   *  where a single fetchBalance() returns the whole account — those expose one
   *  implicit 'default' sub-account and never require a selector. A per-type
   *  fetch failure (e.g. an un-activated COIN-M wallet → -2015) is normally
   *  skipped; adapters with `strictPrivateReads` propagate it instead. */
  subAccounts?: CcxtSubAccountDef[]
}

/** One CCXT sub-account: a logical wallet aggregating CCXT balance `type`s. */
export interface CcxtSubAccountDef {
  /** Selector id, e.g. 'spot' / 'derivatives'. */
  id: string
  /** User-facing label, e.g. 'Spot' / 'Futures'. */
  label: string
  /** Editorial taxonomy. 'unified' is reserved for the implicit single-wallet default. */
  kind: 'spot' | 'derivatives' | 'unified'
  /** CCXT balance `type`s this sub-account fetches and merges. Empty ⇒ a plain
   *  unscoped fetchBalance() (the unified-default case). */
  walletTypes: string[]
}

// ==================== Default implementations ====================

/** Default: fetch one wallet balance, preserving an actually-unscoped call. */
export async function defaultFetchBalance(
  exchange: Exchange,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return await (params === undefined
    ? exchange.fetchBalance()
    : exchange.fetchBalance(params)) as unknown as Record<string, unknown>
}

/** Default: fetchOrder + { stop: true } fallback. Works for binance, okx, bitget, etc. */
export async function defaultFetchOrderById(exchange: Exchange, orderId: string, symbol: string): Promise<CcxtOrder> {
  try {
    return await exchange.fetchOrder(orderId, symbol)
  } catch { /* not a regular order */ }
  try {
    return await exchange.fetchOrder(orderId, symbol, { stop: true })
  } catch { /* not found */ }
  throw new Error(`Order ${orderId} not found`)
}

/** Default: cancelOrder + { stop: true } fallback. */
export async function defaultCancelOrderById(exchange: Exchange, orderId: string, symbol?: string): Promise<void> {
  try {
    await exchange.cancelOrder(orderId, symbol)
    return
  } catch (err) {
    if (symbol) {
      try {
        await exchange.cancelOrder(orderId, symbol, { stop: true })
        return
      } catch { /* fall through to original error */ }
    }
    throw err
  }
}

/** Default: pass straight through to ccxt.createOrder. Works for bybit, binance, alpaca-via-ccxt, etc. */
export async function defaultPlaceOrder(
  exchange: Exchange,
  symbol: string,
  type: string,
  side: 'buy' | 'sell',
  amount: number,
  price: number | undefined,
  params: Record<string, unknown>,
): Promise<CcxtOrder> {
  return await exchange.createOrder(symbol, type, side, amount, price, params)
}

/** Default: pass straight through to ccxt.fetchPositions. */
export async function defaultFetchPositions(exchange: Exchange): Promise<CcxtPosition[]> {
  return await exchange.fetchPositions()
}

/**
 * Default: one unscoped fetchOpenOrders call. Verified live on OKX — its
 * pending-orders endpoint is NOT instType-scoped, so a single call returns
 * spot + swap together. Do NOT assume that generalizes: ccxt has no
 * semantics here, it's an SDK over whatever the venue does. Exchanges whose
 * listing is category-scoped (bybit) get their own override; new exchanges
 * should be probed live before trusting this default.
 */
export async function defaultFetchAllOpenOrders(exchange: Exchange): Promise<CcxtOrder[]> {
  return await exchange.fetchOpenOrders()
}

// ==================== Registry ====================

/** Binance keeps spot / USDⓈ-M / COIN-M in separate wallets behind separate
 *  endpoints, so it splits into two trading sub-accounts: 'spot' (the spot
 *  wallet) and 'derivatives' (USDⓈ-M `future` + COIN-M `delivery`, merged).
 *  'delivery' is tolerated-on-failure — many accounts never activate COIN-M
 *  (ANG-111). Reads aggregate across both unless scoped; writes must name one. */
const binanceOverrides: CcxtExchangeOverrides = {
  subAccounts: [
    { id: 'spot', label: 'Spot', kind: 'spot', walletTypes: ['spot'] },
    { id: 'derivatives', label: 'Futures', kind: 'derivatives', walletTypes: ['future', 'delivery'] },
  ],
}

export const exchangeOverrides: Record<string, CcxtExchangeOverrides> = {
  binance: binanceOverrides,
  bitget: bitgetOverrides,
  bybit: bybitOverrides,
  hyperliquid: hyperliquidOverrides,
}

// ==================== Exchange-id aliases ====================

/**
 * Venue ids that ARE a registered id's own venue, named one by one.
 *
 * A broker is configured with a ccxt id, and ccxt ships several ids per venue —
 * one per market subset of the SAME account. For those, the position-mode field,
 * the wallet decomposition and the venue's error codes are identical; only
 * `fetchMarkets.types` and the default type differ. A listed alias gets the
 * canonical id's overrides, so a hedged account configured as `binanceusdm` or
 * `binancecoinm` gets the same handling as one configured as `binance` instead of
 * sending what the venue refuses (binance: -4061).
 *
 * Why an explicit list and not a rule (suffix strip, prefix match): an override is
 * a set of ORDER RULES — which leg field a payload carries, how an account
 * decomposes into wallets. Applying another venue's rules is silent at the call
 * site and surfaces only as an order the venue rejects, or worse, as an accepted
 * order composed under assumptions that venue never made. ccxt's metadata does
 * not predict this safely: the ids rejected below are the same class hierarchy and
 * the same API shape. So an id is either listed here, or it keeps today's
 * behaviour — no overrides.
 *
 * Verified against the installed ccxt (4.5.78). Both entries extend `binance` and
 * change only id/name/urls{logo,doc}/has/options (binanceusdm.js:11, binancecoinm.js:10),
 * inheriting the whole endpoint table — the fapi/dapi groups and the spot host in
 * binance.js's urls.api (binance.js:228) — so they are the same venue, the same
 * account, and the same live endpoints answer for them:
 *   - binanceusdm (USDⓈ-M; fetchMarkets.types ['linear'], binanceusdm.js:35-38)
 *     reads GET /fapi/v1/positionSide/dual, the endpoint the override names.
 *   - binancecoinm (COIN-M; fetchMarkets.types ['inverse'], binancecoinm.js:34-38)
 *     still reaches that linear endpoint: the override pins `{ subType: 'linear' }`
 *     (exchanges/binance.ts) and ccxt gives params precedence over the instance's
 *     own defaultSubType (Exchange.js:6232-6239), which is the setting Binance
 *     documents as shared between UM and CM. So COIN-M needs no separate policy
 *     variant — which is why this id is a mapping, not a fifth override file.
 *
 * Deliberately NOT listed. Each one inherits the class and the API shape, not the
 * venue; the rules an override encodes were observed on ONE venue's account, and
 * nothing here shows a sibling entity's deployment follows them:
 *   - `binanceus` (Binance US, binanceus.js:16): its own spot deployment
 *     (api.binance.us, binanceus.js:24-26) with swap/future false and
 *     fetchPositionMode false (binanceus.js:56-57,103), yet it inherits binance's
 *     fapi/dapi group URLs — so the position-mode read (and the `future`/`delivery`
 *     wallet reads) would leave for the GLOBAL Binance endpoints with US
 *     credentials and read another entity's account state as the account's own.
 *   - `okxus` / `myokx` (OKX US / OKX EEA; okxus.js:17,21 us.okx.com,
 *     myokx.js:17,21 eea.okx.com): separate deployments of OKX's API. The OKX
 *     overrides are the ones verified against www.okx.com.
 *   - `bybiteu` (Bybit EU; bybiteu.js:18,31-35 api.bybit.eu) with swap/future false
 *     (bybiteu.js:57-58). The Bybit overrides were verified against api.bybit.com.
 * Unconfirmable therefore unmapped: the failure direction is always NO overrides.
 */
export const exchangeIdAliases: Record<string, string> = {
  binanceusdm: 'binance',
  binancecoinm: 'binance',
}

/**
 * The overrides for a configured ccxt exchange id, aliases included — the lookup
 * every override consumer must use instead of indexing `exchangeOverrides`
 * directly. Returns the registry's own object (same reference: a copy could drift
 * from the canonical entry).
 *
 * Unknown, unlisted and unconfirmed ids all resolve to an empty overrides object:
 * a missing override costs a venue refusal, a wrong one composes orders under
 * another venue's rules. Never widen this to a nearest-match.
 */
export function resolveExchangeOverrides(exchangeId: string): CcxtExchangeOverrides {
  return exchangeOverrides[exchangeIdAliases[exchangeId] ?? exchangeId] ?? {}
}
