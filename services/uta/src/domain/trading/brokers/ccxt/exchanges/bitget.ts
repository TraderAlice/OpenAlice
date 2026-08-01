/**
 * Bitget-specific overrides for CcxtBroker.
 *
 * Bitget exposes two incompatible private API families:
 * - Classic accounts: separate spot + contract wallets on v2 endpoints
 * - Unified Trading Accounts (UTA): one shared wallet on v3 endpoints
 *
 * CCXT defaults Bitget to `type=spot` and `uta=false`. Unscoped balance and
 * open-order reads therefore look healthy while silently hiding USDT-M funds
 * and orders. Keep the account family explicit and enumerate every namespace
 * the preset claims to observe.
 */

import type { Exchange, Order as CcxtOrder, Position as CcxtPosition } from 'ccxt'
import type { CcxtExchangeOverrides } from '../overrides.js'

const USDT_FUTURES = 'USDT-FUTURES'

function usesUta(exchange: Exchange): boolean {
  return (exchange.options as Record<string, unknown> | undefined)?.['uta'] === true
}

async function fetchAndMergeOpenOrders(
  exchange: Exchange,
  parameterSets: Array<Record<string, unknown>>,
): Promise<CcxtOrder[]> {
  const merged = new Map<string, CcxtOrder>()
  for (const params of parameterSets) {
    const orders = await exchange.fetchOpenOrders(undefined, undefined, undefined, params)
    for (const order of orders) {
      if (order.id) merged.set(order.id, order)
    }
  }
  return Array.from(merged.values())
}

export const bitgetOverrides: CcxtExchangeOverrides = {
  // Bitget reads are account-family scoped. If one claimed namespace fails,
  // returning the remaining wallets or zero PnL is actively misleading.
  strictPrivateReads: true,

  resolveSubAccounts(exchange: Exchange) {
    if (usesUta(exchange)) {
      return [
        { id: 'default', label: 'Unified Account', kind: 'unified', walletTypes: [] },
      ]
    }
    return [
      { id: 'spot', label: 'Spot', kind: 'spot', walletTypes: ['spot'] },
      { id: 'derivatives', label: 'USDT-M Futures', kind: 'derivatives', walletTypes: ['swap'] },
    ]
  },

  async fetchBalance(exchange: Exchange, params, defaultImpl): Promise<Record<string, unknown>> {
    const routedParams = !usesUta(exchange) && params?.['type'] === 'swap'
      ? { ...params, productType: USDT_FUTURES }
      : params
    const balance = await defaultImpl(exchange, routedParams)
    if (!usesUta(exchange)) return balance

    // CCXT 4.5.38's parseUtaBalance maps `balance` to total and discards the
    // per-asset `equity` field. Bitget defines equity after account PnL/debt
    // adjustments, which is what the account roll-up must use.
    const rawAssets = Array.isArray(balance['info']) ? balance['info'] : []
    for (const raw of rawAssets) {
      if (typeof raw !== 'object' || raw === null) continue
      const asset = raw as Record<string, unknown>
      const coin = typeof asset['coin'] === 'string' ? asset['coin'].toUpperCase() : undefined
      const equity = asset['equity']
      if (!coin || equity === undefined) continue
      const normalized = balance[coin]
      if (typeof normalized === 'object' && normalized !== null) {
        ;(normalized as Record<string, unknown>)['total'] = equity
      }
    }
    return balance
  },

  async fetchPositions(exchange: Exchange, _defaultImpl): Promise<CcxtPosition[]> {
    return await exchange.fetchPositions(undefined, {
      productType: USDT_FUTURES,
      ...(usesUta(exchange) ? { uta: true } : {}),
    })
  },

  async fetchAllOpenOrders(exchange: Exchange, _defaultImpl): Promise<CcxtOrder[]> {
    if (usesUta(exchange)) {
      // CCXT 4.5.38 derives USDT-FUTURES from defaultSubType even when
      // `type=spot`, so UTA spot calls must pin productType=SPOT explicitly.
      // One strategy call per category returns both trigger and TP/SL orders.
      return await fetchAndMergeOpenOrders(exchange, [
        { type: 'spot', productType: 'SPOT', uta: true },
        { type: 'spot', productType: 'SPOT', uta: true, trigger: true },
        { type: 'swap', productType: USDT_FUTURES, uta: true },
        { type: 'swap', productType: USDT_FUTURES, uta: true, trigger: true },
      ])
    }

    // Classic Bitget splits regular, trigger, TP/SL, and trailing orders into
    // separate endpoints. A failure in any namespace propagates: a partial
    // listing must never masquerade as an authoritative empty order book.
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
