/**
 * Contract-resolution helpers for INDstocks.
 *
 * INDstocks identifies a tradeable instrument by `SECURITY_ID` (+ exchange),
 * resolved from the instruments-master CSV. Inside OpenAlice we key on the
 * human-readable trading symbol (like Alpaca keys on ticker); the broker
 * resolves symbol → SECURITY_ID via its in-memory catalog at call time.
 *
 * v1 is equity-only (secType STK). F&O (FUT/OPT) — lot sizes, expiries,
 * strikes — is deferred; see the TODOs.
 */

import { Contract, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'
import { buildContract } from '../contract-builder.js'
import type { BarInterval } from '../types.js'

/** Default Indian exchange when a symbol is given without one (v1: NSE). */
export const DEFAULT_EXCHANGE = 'NSE'

/**
 * Normalized BarInterval → INDstocks `{interval}` path segment.
 * Docs: second (1s..15s), minute (1m..30m), hour (60m..240m), day/week/month.
 * Range caps differ per tier (1d / 7d / 14d / 1y) — enforce at call site.
 */
export const IND_INTERVAL: Record<BarInterval, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '60m', '4h': '240m', '1d': '1d', '1w': '1w',
}

/** Build a fully-validated equity Contract for an INDstocks symbol. */
export function makeContract(symbol: string, exchange: string = DEFAULT_EXCHANGE): Contract {
  return buildContract({
    symbol: symbol.toUpperCase(),
    secType: 'STK',
    exchange,
    currency: 'INR',
  })
}

/**
 * Resolve a Contract to an INDstocks trading symbol. Equity-only for v1:
 * reject anything whose secType is set and not STK.
 */
export function resolveSymbol(contract: Contract): string | null {
  if (!contract.symbol) return null
  if (contract.secType && contract.secType !== 'STK') return null
  return contract.symbol.toUpperCase()
}

/** Scrip-code used by quote/historical endpoints: `${EXCH}_${SECURITY_ID}`. */
export function scripCode(exch: string, securityId: string): string {
  return `${exch}_${securityId}`
}

/**
 * Map an INDstocks order_status to an IBKR-style OrderState status.
 * Full status vocabulary (docs):
 *   QUEUED, O-PENDING, SL-PENDING, PROCESSING, ABORTED, INITIATED, SUCCESS,
 *   CANCELLED, MODIFIED, PENDING, EXPIRED, FAILED, PARTIALLY FILLED,
 *   PARTIALLY FILLED - CANCELLED, PARTIALLY FILLED - EXPIRED.
 */
export function mapIndOrderStatus(status: string): string {
  const s = status.toUpperCase()
  switch (s) {
    case 'SUCCESS':
    case 'FILLED':
      return 'Filled'
    case 'CANCELLED':
    case 'EXPIRED':
    case 'ABORTED':
    case 'PARTIALLY FILLED - CANCELLED':
    case 'PARTIALLY FILLED - EXPIRED':
      return 'Cancelled'
    case 'FAILED':
      return 'Inactive'
    case 'QUEUED':
    case 'O-PENDING':
    case 'SL-PENDING':
    case 'PROCESSING':
    case 'INITIATED':
    case 'PENDING':
    case 'MODIFIED':
    case 'PARTIALLY FILLED':
      return 'Submitted'   // still working
    default:
      return 'Submitted'
  }
}

/** Build an IBKR OrderState from an INDstocks status string. */
export function makeOrderState(status: string, rejectReason?: string): OrderState {
  const s = new OrderState()
  s.status = mapIndOrderStatus(status)
  if (rejectReason) s.rejectReason = rejectReason
  return s
}

// ==================== Order-field mapping (IBKR → INDstocks) ====================

/** IBKR orderType → INDstocks `order_type`. v1 supports LIMIT/MARKET only. */
export function ibkrOrderTypeToInd(orderType: string): string {
  switch (orderType) {
    case 'MKT': return 'MARKET'
    case 'LMT': return 'LIMIT'
    // STP / STP LMT have no native normal-order equivalent — stop-loss lives
    // in the separate GTT "smart orders" API. TODO: wire GTT for STP support.
    default: return 'LIMIT'
  }
}

/** IBKR TIF → INDstocks `validity`. Only DAY/IOC exist. */
export function ibkrTifToInd(tif: string): string {
  return tif === 'IOC' ? 'IOC' : 'DAY'
}

/**
 * `algo_id` is a required, exchange-specific constant in the place-order body.
 * Docs: 99999 (NSE), 9999999999999999 (BSE).
 */
export function algoIdFor(exchange: string): string {
  return exchange.toUpperCase() === 'BSE' ? '9999999999999999' : '99999'
}
