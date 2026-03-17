/**
 * Contract resolution helpers for CCXT exchanges.
 *
 * Pure functions parameterized by (markets, exchangeName) —
 * no dependency on the CcxtBroker instance.
 * Now returns IBKR Contract class instances with aliceId extension.
 */

import { Contract, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'
import type { CcxtMarket } from './ccxt-types.js'

// ---- Type mapping ----

export function ccxtTypeToSecType(type: string): string {
  switch (type) {
    case 'spot': return 'CRYPTO'
    case 'swap': return 'CRYPTO'  // perpetual swap is still crypto
    case 'future': return 'FUT'
    case 'option': return 'OPT'
    default: return 'CRYPTO'
  }
}

export function mapOrderStatus(status: string | undefined): string {
  switch (status) {
    case 'closed': return 'Filled'
    case 'open': return 'Submitted'
    case 'canceled':
    case 'cancelled': return 'Cancelled'
    case 'expired':
    case 'rejected': return 'Inactive'
    default: return 'Submitted'
  }
}

/** Create an IBKR OrderState from a CCXT status string. */
export function makeOrderState(ccxtStatus: string | undefined): OrderState {
  const s = new OrderState()
  s.status = mapOrderStatus(ccxtStatus)
  return s
}

// ---- Contract ↔ CCXT symbol conversion ----

/**
 * Convert a CcxtMarket to an IBKR Contract.
 * aliceId = "{exchangeName}-{market.id}"
 */
export function marketToContract(market: CcxtMarket, exchangeName: string): Contract {
  const c = new Contract()
  c.aliceId = `${exchangeName}-${market.id}`
  c.symbol = market.base
  c.secType = ccxtTypeToSecType(market.type)
  c.exchange = exchangeName
  c.currency = market.quote
  c.localSymbol = market.symbol       // CCXT unified symbol, e.g. "BTC/USDT:USDT"
  c.description = `${market.base}/${market.quote} ${market.type}${market.settle ? ` (${market.settle} settled)` : ''}`
  return c
}

/** Parse aliceId → raw nativeId (market.id) part. */
export function aliceIdToCcxt(aliceId: string, exchangeName: string): string | null {
  const prefix = `${exchangeName}-`
  if (!aliceId.startsWith(prefix)) return null
  return aliceId.slice(prefix.length)
}

/**
 * Resolve a Contract to a CCXT symbol for API calls.
 * Tries: aliceId → localSymbol → symbol as CCXT key → search by base+secType.
 */
export function contractToCcxt(
  contract: Contract,
  markets: Record<string, CcxtMarket>,
  exchangeName: string,
): string | null {
  // 1. aliceId → market.id → look up in markets
  if (contract.aliceId) {
    const ccxtSymbol = aliceIdToCcxt(contract.aliceId, exchangeName)
    if (ccxtSymbol && markets[ccxtSymbol]) return ccxtSymbol
    // aliceId uses market.id, but markets are indexed by ccxt symbol
    // search by market.id
    for (const m of Object.values(markets)) {
      if (`${exchangeName}-${m.id}` === contract.aliceId) return m.symbol
    }
    return null
  }

  // 2. localSymbol is the CCXT unified symbol
  if (contract.localSymbol && markets[contract.localSymbol]) {
    return contract.localSymbol
  }

  // 3. symbol might be a CCXT unified symbol (e.g. "BTC/USDT:USDT")
  if (contract.symbol && markets[contract.symbol]) {
    return contract.symbol
  }

  // 4. Search by base symbol + secType (resolve to unique)
  if (contract.symbol) {
    const candidates = resolveContractSync(contract, markets)
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) {
      // Ambiguous — caller should have resolved first
      return null
    }
  }

  return null
}

/** Synchronous search returning CCXT symbols. Used by contractToCcxt. */
export function resolveContractSync(
  query: Contract,
  markets: Record<string, CcxtMarket>,
): string[] {
  if (!query.symbol) return []

  const searchBase = query.symbol.toUpperCase()
  const results: string[] = []

  for (const market of Object.values(markets)) {
    if (market.active === false) continue
    if (market.base.toUpperCase() !== searchBase) continue

    if (query.secType) {
      const marketSecType = ccxtTypeToSecType(market.type)
      if (marketSecType !== query.secType) continue
    }

    if (query.currency && market.quote.toUpperCase() !== query.currency.toUpperCase()) continue

    if (!query.currency) {
      const quote = market.quote.toUpperCase()
      if (quote !== 'USDT' && quote !== 'USD' && quote !== 'USDC') continue
    }

    results.push(market.symbol)
  }

  return results
}
