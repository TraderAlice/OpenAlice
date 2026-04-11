/**
 * Bybit-specific overrides for CcxtBroker.
 *
 * Bybit quirks:
 * - fetchOrder() requires { acknowledged: true } and only searches last 500 orders
 * - fetchOpenOrder / fetchClosedOrder are reliable, query by ID directly with no limit
 * - Both support { stop: true } for conditional/trigger orders
 */

import type { Exchange, Order as CcxtOrder } from 'ccxt'
import type { CcxtExchangeOverrides } from '../overrides.js'

export const bybitOverrides: CcxtExchangeOverrides = {
  async fetchOrderById(exchange: Exchange, orderId: string, symbol: string, _defaultImpl): Promise<CcxtOrder> {
    // Try open regular → open conditional → closed regular → closed conditional
    try {
      return await (exchange as any).fetchOpenOrder(orderId, symbol)
    } catch { /* not an open regular order */ }
    try {
      return await (exchange as any).fetchOpenOrder(orderId, symbol, { stop: true })
    } catch { /* not an open conditional order */ }
    try {
      return await (exchange as any).fetchClosedOrder(orderId, symbol)
    } catch { /* not a closed regular order */ }
    try {
      return await (exchange as any).fetchClosedOrder(orderId, symbol, { stop: true })
    } catch { /* not found anywhere */ }
    throw new Error(`Order ${orderId} not found`)
  },

  // cancelOrderById: not overridden — default { stop: true } fallback works for Bybit
}
