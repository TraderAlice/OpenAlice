/**
 * Bitget Classic-specific overrides for CcxtBroker.
 *
 * Classic accounts keep spot and futures funds behind separate v2 account
 * endpoints. CCXT defaults Bitget to spot, so an unscoped balance or open-order
 * read succeeds while silently omitting USDT-M funds and orders. This adapter
 * deliberately supports Classic only; Bitget Unified Trading Account (v3) is
 * a separate account family and must not be enabled accidentally through a
 * transport option.
 */

import type { Exchange, Order as CcxtOrder, Position as CcxtPosition } from 'ccxt'
import type { CcxtExchangeOverrides } from '../overrides.js'

const USDT_FUTURES = 'USDT-FUTURES'

async function fetchAndMergeOpenOrders(
  exchange: Exchange,
  parameterSets: Array<Record<string, unknown>>,
): Promise<CcxtOrder[]> {
  const merged = new Map<string, CcxtOrder>()
  for (const params of parameterSets) {
    const orders = await exchange.fetchOpenOrders(undefined, undefined, undefined, params)
    for (const order of orders) {
      if (!order.id) continue
      merged.set(`${order.symbol ?? ''}:${order.id}`, order)
    }
  }
  return Array.from(merged.values())
}

export const bitgetOverrides: CcxtExchangeOverrides = {
  // Every declared namespace contributes to the account truth. Returning the
  // readable subset would turn a permissions or routing error into false equity
  // or a false empty order list.
  strictPrivateReads: true,
  strictOpenOrderReads: true,

  subAccounts: [
    { id: 'spot', label: 'Spot', kind: 'spot', walletTypes: ['spot'] },
    { id: 'derivatives', label: 'USDT-M Futures', kind: 'derivatives', walletTypes: ['swap'] },
  ],

  async fetchBalance(exchange: Exchange, params, defaultImpl): Promise<Record<string, unknown>> {
    const routedParams = params?.['type'] === 'swap'
      ? { ...params, productType: USDT_FUTURES }
      : params
    return await defaultImpl(exchange, routedParams)
  },

  async fetchPositions(exchange: Exchange, _defaultImpl): Promise<CcxtPosition[]> {
    return await exchange.fetchPositions(undefined, { productType: USDT_FUTURES })
  },

  async fetchAllOpenOrders(exchange: Exchange, _defaultImpl): Promise<CcxtOrder[]> {
    // Classic Bitget splits regular, trigger, TP/SL, and trailing orders into
    // separate namespaces. Keep this sequential to avoid bursting six private
    // requests at the venue at once.
    return await fetchAndMergeOpenOrders(exchange, [
      { type: 'spot' },
      { type: 'spot', trigger: true },
      { type: 'swap', productType: USDT_FUTURES },
      { type: 'swap', productType: USDT_FUTURES, trigger: true, planType: 'normal_plan' },
      { type: 'swap', productType: USDT_FUTURES, trigger: true, planType: 'profit_loss' },
      { type: 'swap', productType: USDT_FUTURES, trailing: true, planType: 'track_plan' },
    ])
  },
}
