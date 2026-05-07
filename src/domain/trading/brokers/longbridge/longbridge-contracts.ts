/**
 * Contract resolution helpers for Longbridge.
 *
 * Longbridge uses suffixed symbols: `700.HK`, `AAPL.US`, `600519.SH`,
 * `000001.SZ`, etc. The market suffix is the unique key — without it
 * a bare ticker is ambiguous (`700` exists on multiple boards).
 */

import { Contract, ContractDescription, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'
import { buildContract } from '../contract-builder.js'

/** Per-suffix metadata: which exchange / currency the SDK considers it. */
interface SuffixInfo {
  exchange: string
  currency: string
}

const SUFFIX_TABLE: Record<string, SuffixInfo> = {
  HK: { exchange: 'SEHK',   currency: 'HKD' },
  US: { exchange: 'SMART',  currency: 'USD' },  // SMART covers NYSE/NASDAQ/ARCA
  SH: { exchange: 'SSE',    currency: 'CNY' },
  SZ: { exchange: 'SZSE',   currency: 'CNY' },
  SG: { exchange: 'SGX',    currency: 'SGD' },
}

/**
 * Build a fully qualified IBKR Contract for a Longbridge symbol.
 *
 * @param lbSymbol — the LB-native suffixed symbol (e.g. "700.HK"). Bare
 *                   tickers are accepted as a fallback (treated as US).
 */
export function makeContract(lbSymbol: string): Contract {
  const { ticker, suffix } = parseLbSymbol(lbSymbol)
  const info = SUFFIX_TABLE[suffix] ?? SUFFIX_TABLE['US']
  return buildContract({
    symbol: ticker,
    localSymbol: lbSymbol,  // preserve native key for round-trip resolution
    secType: 'STK',
    exchange: info.exchange,
    currency: info.currency,
  })
}

/**
 * Parse `"700.HK"` → `{ ticker: "700", suffix: "HK" }`.
 * Bare tickers without a suffix come back as `{ ticker, suffix: "US" }` —
 * Longbridge accepts US tickers without an explicit suffix on some
 * endpoints, so this is the most-forgiving default.
 */
export function parseLbSymbol(lbSymbol: string): { ticker: string; suffix: string } {
  const idx = lbSymbol.lastIndexOf('.')
  if (idx < 0) return { ticker: lbSymbol.toUpperCase(), suffix: 'US' }
  const suffix = lbSymbol.slice(idx + 1).toUpperCase()
  const ticker = lbSymbol.slice(0, idx)
  return { ticker, suffix }
}

/**
 * Resolve a Contract back to a Longbridge symbol (e.g. "700.HK").
 *
 * Preferred sources, in order:
 *   1. `localSymbol` — set by makeContract; round-trips losslessly.
 *   2. `aliceId` after the `|` separator — the UTA-stamped native key.
 *   3. `symbol` + currency-derived suffix — best-effort fallback.
 */
export function resolveSymbol(contract: Contract): string | null {
  if (contract.localSymbol && contract.localSymbol.includes('.')) {
    return contract.localSymbol
  }
  if (contract.aliceId) {
    const idx = contract.aliceId.indexOf('|')
    if (idx >= 0) {
      const native = contract.aliceId.slice(idx + 1)
      if (native.includes('.')) return native
    }
  }
  if (!contract.symbol) return null
  // Fallback: infer suffix from currency (lossy — SH vs SZ collapse, SG vs HK collapse).
  const suffix = inferSuffixFromCurrency(contract.currency)
  return `${contract.symbol}.${suffix}`
}

function inferSuffixFromCurrency(currency: string | undefined): string {
  switch ((currency ?? '').toUpperCase()) {
    case 'HKD': return 'HK'
    case 'CNY':
    case 'CNH': return 'SH'  // ambiguous — SH wins over SZ for stable inference
    case 'SGD': return 'SG'
    default:    return 'US'
  }
}

/**
 * Map the `Market` enum value (numeric) returned by the SDK to a
 * suffix string. Used when emitting Position contracts.
 */
export function marketToSuffix(market: number): string {
  // Mirrors longbridge's exported `const enum Market`.
  switch (market) {
    case 1: return 'US'
    case 2: return 'HK'
    case 3: return 'SH'  // CN — collapses to SH (callers using stockPositions get the symbol with suffix already, this is a fallback)
    case 4: return 'SG'
    default: return 'US'
  }
}

/**
 * Map Longbridge's `OrderStatus` enum (numeric) to IBKR-style status string.
 * IBKR statuses we emit: Submitted, Filled, Cancelled, Inactive.
 */
export function mapLbOrderStatus(status: number): string {
  switch (status) {
    case 5:                         // Filled
      return 'Filled'
    case 14:                        // Rejected
    case 16:                        // Expired
      return 'Inactive'
    case 15:                        // Canceled
    case 17:                        // PartialWithdrawal
      return 'Cancelled'
    case 11:                        // PartialFilled
    case 7:                         // New
    case 6:                         // WaitToNew
    case 8:                         // WaitToReplace
    case 9:                         // PendingReplace
    case 10:                        // Replaced
    case 12:                        // WaitToCancel
    case 13:                        // PendingCancel
    case 1: case 2: case 3: case 4: // NotReported variants
      return 'Submitted'
    default:
      return 'Submitted'
  }
}

/** Make an OrderState from an LB status enum + optional reject message. */
export function makeOrderState(status: number, msg?: string): OrderState {
  const s = new OrderState()
  s.status = mapLbOrderStatus(status)
  if (msg && (status === 14 /* Rejected */)) s.rejectReason = msg
  return s
}

/** Produce a single-result ContractDescription for echo fallback. */
export function echoContractDescription(lbSymbol: string): ContractDescription {
  const desc = new ContractDescription()
  desc.contract = makeContract(lbSymbol)
  return desc
}
