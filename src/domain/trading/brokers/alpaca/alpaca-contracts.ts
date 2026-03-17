/**
 * Contract resolution helpers for Alpaca.
 *
 * Pure functions parameterized by provider string.
 * Now returns IBKR Contract class instances with aliceId extension.
 */

import { Contract, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'

/** Build a fully qualified IBKR Contract for an Alpaca ticker. */
export function makeContract(ticker: string, provider: string): Contract {
  const c = new Contract()
  c.aliceId = `${provider}-${ticker}`
  c.symbol = ticker
  c.secType = 'STK'
  c.exchange = 'SMART'
  c.currency = 'USD'
  return c
}

/** Extract native symbol from aliceId, or null if not ours. */
export function parseAliceId(aliceId: string, provider: string): string | null {
  const prefix = `${provider}-`
  if (!aliceId.startsWith(prefix)) return null
  return aliceId.slice(prefix.length)
}

/**
 * Resolve a Contract to an Alpaca ticker symbol.
 * Accepts: aliceId, or symbol (+ optional secType check).
 */
export function resolveSymbol(contract: Contract, provider: string): string | null {
  if (contract.aliceId) {
    return parseAliceId(contract.aliceId, provider)
  }
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
      return 'Inactive'
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
