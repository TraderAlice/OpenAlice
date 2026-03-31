/**
 * Exchange-specific overrides for CcxtBroker.
 *
 * CCXT's "unified API" behaves differently across exchanges:
 * - Bybit: fetchOrder requires { acknowledged: true }, limited to last 500 orders
 * - Binance: fetchOrder works fine, but conditional orders need { stop: true }
 * - OKX/Bitget: no fetchOpenOrder/fetchClosedOrder singular methods
 *
 * Rather than patching one code path with exchange-specific if/else,
 * each tested exchange gets its own override file in exchanges/.
 * Only override what's different — unset methods fall through to the default.
 *
 * To add a new exchange:
 *   1. Create exchanges/<name>.ts exporting a CcxtExchangeOverrides object
 *   2. Only implement the methods that differ from defaults
 *   3. Register it in exchangeOverrides below
 */

import type { Exchange, Order as CcxtOrder } from 'ccxt'
import { bybitOverrides } from './exchanges/bybit.js'

// ==================== Override interface ====================

export interface CcxtExchangeOverrides {
  /** Fetch a single order by ID (regular + conditional). */
  fetchOrderById?(exchange: Exchange, orderId: string, symbol: string): Promise<CcxtOrder>
  /** Cancel an order by ID (regular + conditional). */
  cancelOrderById?(exchange: Exchange, orderId: string, symbol?: string): Promise<void>
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

// ==================== Registry ====================

export const exchangeOverrides: Record<string, CcxtExchangeOverrides> = {
  bybit: bybitOverrides,
}
