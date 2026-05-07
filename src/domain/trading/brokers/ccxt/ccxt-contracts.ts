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

// ---- Canonical localSymbol (Phase 3 of IBKR-as-truth refactor) ----

/**
 * Build the canonical Contract.localSymbol for a CCXT market — IBKR-shaped
 * (broker-agnostic) instead of CCXT's wire format (`BTC/USDT:USDT`).
 *
 * The canonical form lets aliceIds and downstream consumers stop
 * special-casing CCXT's wire encoding. CCXT's wire format itself stays
 * a CcxtBroker-internal concern: `contractToCcxt` now derives wire from
 * the canonical Contract via `resolveContractSync`'s base+secType+currency
 * search, which already existed as a fallback.
 *
 * Format per market.type:
 *   - spot:   `${base}`                      (e.g. `BTC`)
 *   - swap:   `${base}-PERP`                 (e.g. `BTC-PERP`)
 *   - future: `${base}-FUT-${expiryYYYYMM}`  (e.g. `BTC-FUT-202609`)
 *   - option: `${base}-OPT-...`              (skipped — CCXT options are niche)
 *
 * Multi-quote disambiguation (BTC/USDT vs BTC/USDC spot held simultaneously)
 * is left for a follow-up — most users hold one quote per underlying, and
 * `Contract.currency` differentiates them within the same UTA.
 */
export function canonicalLocalSymbol(market: CcxtMarket): string {
  const base = market.base
  switch (market.type) {
    case 'spot':   return base
    case 'swap':   return `${base}-PERP`
    case 'future': return `${base}-FUT-${ccxtExpiryToCanonical(market)}`
    case 'option': return market.symbol  // out of scope; preserve wire format
    default:       return market.symbol
  }
}

/** Best-effort YYYYMM extraction from a CCXT future market's expiry. */
function ccxtExpiryToCanonical(market: CcxtMarket): string {
  // CCXT exposes `expiry` (ms epoch) on dated futures. Fall back to whatever
  // is encoded in the symbol if not present.
  const ms = (market as unknown as { expiry?: number }).expiry
  if (typeof ms === 'number') {
    const d = new Date(ms)
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    return `${d.getUTCFullYear()}${m}`
  }
  // Fallback: tail of `BTC/USDT:USDT-220929` after the trailing dash.
  const dash = market.symbol.lastIndexOf('-')
  if (dash >= 0) return market.symbol.slice(dash + 1)
  return 'unknown'
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
 * Convert a CcxtMarket to an IBKR Contract with a canonical localSymbol.
 * CCXT's wire format ("BTC/USDT:USDT") is no longer on the Contract —
 * `contractToCcxt` derives it from `(base, secType, currency)` via the
 * markets table when CCXT-side talk is needed.
 */
export function marketToContract(market: CcxtMarket, exchangeName: string): Contract {
  return buildContract({
    symbol: market.base,
    secType: ccxtTypeToSecType(market.type) as SecType,
    exchange: exchangeName,
    currency: market.quote,
    localSymbol: canonicalLocalSymbol(market),
    description: `${market.base}/${market.quote} ${market.type}${market.settle ? ` (${market.settle} settled)` : ''}`,
  })
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
