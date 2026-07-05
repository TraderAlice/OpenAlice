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

  /**
   * Bybit's open-orders listing is category-scoped, and the broker config
   * sets defaultType 'swap' — an unscoped fetchOpenOrders() silently
   * returns ONLY swap orders (observed live: a real open spot order,
   * empty list, no error). Sweep every category the account trades and
   * merge. Throws if any category fails — a partial listing would ghost
   * real orders out of absence-detection and external observation, which
   * is worse than observation being loudly off (same rule as full-spectrum
   * market loading).
   */
  async fetchAllOpenOrders(exchange: Exchange, _defaultImpl): Promise<CcxtOrder[]> {
    const merged = new Map<string, CcxtOrder>()
    for (const type of ['spot', 'swap'] as const) {
      const orders = await exchange.fetchOpenOrders(undefined, undefined, undefined, { type })
      for (const o of orders) {
        if (o.id) merged.set(o.id, o)
      }
    }
    return Array.from(merged.values())
  },
}
