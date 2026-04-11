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

// ==================== Registry ====================

export const exchangeOverrides: Record<string, CcxtExchangeOverrides> = {
  bybit: bybitOverrides,
  hyperliquid: hyperliquidOverrides,
}
