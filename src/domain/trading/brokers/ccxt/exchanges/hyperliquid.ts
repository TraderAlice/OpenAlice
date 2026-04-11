/**
 * Hyperliquid-specific overrides for CcxtBroker.
 *
 * Hyperliquid quirks:
 * - No native market orders. CCXT emulates them as IOC limit orders with
 *   a slippage-bounded price (default 5%). To compute the bound, CCXT
 *   requires the caller to pass a reference price even for type='market'.
 *   Server enforces an 80% deviation cap from mark price, so we can't
 *   send an extreme dummy value — we have to fetchTicker first.
 *
 * - CCXT's parsePosition leaves markPrice undefined for hyperliquid (hardcoded
 *   in node_modules/ccxt/js/src/hyperliquid.js, line 3613). Hyperliquid does
 *   return positionValue (mapped to notional by CCXT), so we recover markPrice
 *   from notional / contracts.
 */

import type { Exchange, Order as CcxtOrder, Position as CcxtPosition } from 'ccxt'
import type { CcxtExchangeOverrides } from '../overrides.js'

export const hyperliquidOverrides: CcxtExchangeOverrides = {
  /** Inject a fetched ticker price for market orders, then delegate to default. */
  async placeOrder(
    exchange: Exchange,
    symbol: string,
    type: string,
    side: 'buy' | 'sell',
    amount: number,
    price: number | undefined,
    params: Record<string, unknown>,
    defaultImpl,
  ): Promise<CcxtOrder> {
    let refPrice = price
    if (type === 'market' && refPrice === undefined) {
      const ticker = await exchange.fetchTicker(symbol)
      refPrice = ticker.last ?? ticker.close ?? undefined
      if (refPrice === undefined) {
        throw new Error(`hyperliquid: cannot fetch reference price for market order on ${symbol}`)
      }
    }
    return await defaultImpl(exchange, symbol, type, side, amount, refPrice, params)
  },

  /** Recover markPrice that CCXT's parsePosition omits, by inverting notional / contracts. */
  async fetchPositions(exchange: Exchange, defaultImpl): Promise<CcxtPosition[]> {
    const raw = await defaultImpl(exchange)
    return raw.map(p => {
      if (p.markPrice == null && p.notional != null && p.contracts != null && p.contracts !== 0) {
        const recovered = Math.abs(p.notional) / Math.abs(p.contracts)
        return { ...p, markPrice: recovered }
      }
      return p
    })
  },
}
