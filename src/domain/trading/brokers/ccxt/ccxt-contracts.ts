/**
 * Contract resolution helpers for CCXT exchanges.
 *
 * Pure functions parameterized by (markets, exchangeName) —
 * no dependency on the CcxtBroker instance.
 *
 * aliceId format: "{exchange}-{encodedSymbol}"
 * where encodedSymbol = market.symbol with / → _ and : → .
 * e.g. "bybit-ETH_USDT.USDT" for "ETH/USDT:USDT"
 */

import { Contract, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'
import type { CcxtMarket } from './ccxt-types.js'
import { buildContract } from '../contract-builder.js'
import type { SecType } from '../../contract-discipline.js'

// ---- Symbol encoding for aliceId ----

/** CCXT symbol → aliceId suffix (escape / and :) */
export function encodeSymbol(symbol: string): string {
  return symbol.replace(/\//g, '_').replace(/:/g, '.')
}

/** aliceId suffix → CCXT symbol (unescape) */
export function decodeSymbol(encoded: string): string {
  return encoded.replace(/_/g, '/').replace(/\./g, ':')
}

// ---- Type mapping ----

export function ccxtTypeToSecType(type: string): string {
  switch (type) {
    case 'spot': return 'CRYPTO'
    case 'swap': return 'CRYPTO_PERP'
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
 *
 * `Contract.localSymbol` is set to `market.symbol` — CCXT's unified wire
 * format (`BTC/USDT:USDT`, `BTC/USDT`, `BTC/USDT:USDT-220929`). That's
 * CCXT's own uniqueness primitive: it encodes base + quote + (optional)
 * settle + (optional) expiry in one string, distinguishing every product
 * the exchange offers. We do not normalize this across brokers —
 * `aliceId`'s `{utaId}|` prefix already scopes per-broker, and each
 * broker's `getNativeKey` reads its own native key out of Contract.
 *
 * For FUT/OPT/FOP markets, derives `lastTradeDateOrContractMonth` from
 * `market.expiry` (CCXT exposes it as ms epoch on dated derivatives) and
 * `multiplier` from `market.contractSize`. CCXT-typed `optionType` and
 * `strike` populate the OPT-specific fields. `assertContract` (called
 * inside `buildContract`) verifies all required taxonomy fields are
 * present — malformed market data throws here so callers can decide
 * whether to skip or surface the error.
 */
export function marketToContract(market: CcxtMarket, exchangeName: string): Contract {
  const secType = ccxtTypeToSecType(market.type) as SecType
  // CcxtMarket only types the universal subset; CCXT actually exposes
  // expiry / contractSize / strike / optionType on derivative markets.
  const m = market as unknown as {
    expiry?: number
    contractSize?: number
    strike?: number
    optionType?: 'call' | 'put'
  }

  const params: Parameters<typeof buildContract>[0] = {
    symbol: market.base,
    secType,
    exchange: exchangeName,
    currency: market.quote,
    localSymbol: market.symbol,
    description: `${market.base}/${market.quote} ${market.type}${market.settle ? ` (${market.settle} settled)` : ''}`,
  }

  if (secType === 'FUT' || secType === 'OPT' || secType === 'FOP') {
    if (m.expiry) {
      const d = new Date(m.expiry)
      params.lastTradeDateOrContractMonth =
        `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
    }
    params.multiplier = m.contractSize != null ? String(m.contractSize) : '1'
  }
  if (secType === 'OPT' || secType === 'FOP') {
    if (m.strike != null) params.strike = m.strike
    if (m.optionType === 'call') params.right = 'C'
    else if (m.optionType === 'put') params.right = 'P'
  }

  return buildContract(params)
}

/** Parse aliceId → CCXT unified symbol. */
export function aliceIdToCcxt(aliceId: string, exchangeName: string): string | null {
  const prefix = `${exchangeName}-`
  if (!aliceId.startsWith(prefix)) return null
  return decodeSymbol(aliceId.slice(prefix.length))
}

/**
 * Resolve a Contract to a CCXT symbol for API calls.
 * Tries: localSymbol → symbol as CCXT key → search by base+secType.
 * aliceId is managed by UTA layer; broker uses localSymbol/symbol for resolution.
 */
export function contractToCcxt(
  contract: Contract,
  markets: Record<string, CcxtMarket>,
  exchangeName: string,
): string | null {
  // 1. localSymbol is the CCXT unified symbol
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
    // Some exchange-supplied market entries are skeletal (delisted /
    // synthetic / index-only) and lack base or quote — skip those rather
    // than crash on .toUpperCase().
    if (!market.base || !market.quote) continue
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
