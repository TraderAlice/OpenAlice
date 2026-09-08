/**
 * Contract resolution helpers for Alpaca.
 *
 * Pure functions parameterized by provider string.
 * Now returns IBKR Contract class instances with aliceId extension.
 */

import { Contract, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'
import { buildContract } from '../contract-builder.js'
import type { BarInterval } from '../types.js'

/** Normalized BarInterval → Alpaca v2 timeframe string. */
export const ALPACA_TIMEFRAME: Record<BarInterval, string> = {
  '1m': '1Min', '5m': '5Min', '15m': '15Min', '30m': '30Min',
  '1h': '1Hour', '4h': '4Hour', '1d': '1Day', '1w': '1Week',
}

/** Build a fully qualified IBKR Contract for an Alpaca ticker. */
export function makeContract(ticker: string): Contract {
  return buildContract({
    symbol: ticker,
    secType: 'STK',
    exchange: 'SMART',
    currency: 'USD',
  })
}

/**
 * Resolve a Contract to an Alpaca ticker symbol.
 * Uses symbol directly. aliceId is managed by UTA layer, not broker.
 */
export function resolveSymbol(contract: Contract): string | null {
  if (contract.symbol) {
    // If secType is specified and not STK, not our domain
    if (contract.secType && contract.secType !== 'STK') return null
    return contract.symbol.toUpperCase()
  }
  return null
}

/** Map Alpaca order status string to IBKR-style OrderState status. */
export function mapAlpacaOrderStatus(alpacaStatus: string): string {
  switch (alpacaStatus) {
    case 'filled':
      return 'Filled'
    case 'new':
    case 'accepted':
    case 'pending_new':
    case 'accepted_for_bidding':
      return 'Submitted'
    case 'canceled':
    case 'expired':
    case 'replaced':
      return 'Cancelled'
    case 'partially_filled':
      return 'Submitted'  // still active
    case 'done_for_day':
    case 'suspended':
    case 'rejected':
      // Not 'Inactive': that is IBKR's held state and order-sync treats it as a
      // working order, while these Alpaca statuses are terminal refusals.
      return 'Rejected'
    default:
      return 'Submitted'
  }
}

/** Create an IBKR OrderState from an Alpaca status string. */
export function makeOrderState(alpacaStatus: string, rejectReason?: string): OrderState {
  const s = new OrderState()
  s.status = mapAlpacaOrderStatus(alpacaStatus)
  if (rejectReason) s.rejectReason = rejectReason
  return s
}
