/**
 * Exchange-specific overrides for CcxtBroker.
 *
 * CCXT's "unified API" behaves differently across exchanges:
 * - Bybit: fetchOrder requires { acknowledged: true }, limited to last 500 orders
 * - Binance: fetchOrder works fine, but conditional orders need { stop: true }
 * - OKX/Bitget: no fetchOpenOrder/fetchClosedOrder singular methods
 * - Hyperliquid: market orders require a ref price, fetchPositions omits markPrice
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
import { bybitOverrides } from './exchanges/bybit.js'
import { hyperliquidOverrides } from './exchanges/hyperliquid.js'

// ==================== Override interface ====================

/** A function that calls the default implementation with the same arg shape. */
type DefaultImpl<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>

export interface CcxtExchangeOverrides {
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
   *  fetch failure (e.g. an un-activated COIN-M wallet → -2015) is skipped, not
   *  fatal. */
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
  bybit: bybitOverrides,
  hyperliquid: hyperliquidOverrides,
}
