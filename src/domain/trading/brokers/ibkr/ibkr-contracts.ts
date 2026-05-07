/**
 * Contract helpers and IBKR error classification.
 *
 * Unlike Alpaca/CCXT, IBKR contracts ARE our native Contract type —
 * no translation layer is needed. Helpers just ensure required fields are set.
 */

import { Contract } from '@traderalice/ibkr'
import { BrokerError, type BrokerErrorCode } from '../types.js'
import '../../contract-ext.js'
import { buildContract } from '../contract-builder.js'
import type { SecType } from '../../contract-discipline.js'

/** Build a standard IBKR Contract (defaults: STK + SMART + USD). */
export function makeContract(
  symbol: string,
  secType: SecType = 'STK',
  exchange = 'SMART',
  currency = 'USD',
): Contract {
  return buildContract({ symbol, secType, exchange, currency })
}

/**
 * Resolve a Contract to a display symbol string.
 * Prefers localSymbol > symbol. Returns null if neither is set.
 */
export function resolveSymbol(contract: Contract): string | null {
  return contract.localSymbol || contract.symbol || null
}

// ==================== IBKR error classification ====================

/**
 * Classify an IBKR TWS error code into a BrokerError.
 *
 * TWS errors follow a numeric code system:
 * - Codes < 1000: request-level errors (order rejected, contract not found, etc.)
 * - Codes 1100-1300: system/connectivity events
 * - Codes >= 2000: informational (data farm status, market data messages)
 */
export function classifyIbkrError(code: number, msg: string): BrokerError {
  const classified = classifyCode(code, msg)
  return new BrokerError(classified, `IBKR error ${code}: ${msg}`)
}

function classifyCode(code: number, msg: string): BrokerErrorCode {
  // Network / connectivity
  if (code === 502) return 'NETWORK'   // Couldn't connect to TWS
  if (code === 504) return 'NETWORK'   // Not connected
  if (code === 1100) return 'NETWORK'  // Connectivity between IB and TWS has been lost
  if (code === 1101) return 'NETWORK'  // Connectivity restored (data maintained)
  if (code === 1102) return 'NETWORK'  // Connectivity restored (data lost)

  // Authentication
  if (code === 326) return 'AUTH'      // Unable to connect as client ID is already in use

  // Market closed — check message content for TWS order warnings
  if (code === 399 && /outside.*trading.*hours/i.test(msg)) return 'MARKET_CLOSED'
  if (/market.*closed|not.*open|trading.*halt/i.test(msg)) return 'MARKET_CLOSED'

  // Exchange-level rejections
  if (code === 200) return 'EXCHANGE'  // No security definition found
  if (code === 201) return 'EXCHANGE'  // Order rejected
  if (code === 202) return 'EXCHANGE'  // Order cancelled
  if (code === 103) return 'EXCHANGE'  // Duplicate order id
  if (code === 104) return 'EXCHANGE'  // Can't modify a filled order
  if (code === 105) return 'EXCHANGE'  // Order being modified doesn't match
  if (code === 110) return 'EXCHANGE'  // Price does not conform to min tick
  if (code === 135) return 'EXCHANGE'  // Can't find order
  if (code === 136) return 'EXCHANGE'  // Can't cancel order (already cancelled/filled)
  if (code === 161) return 'EXCHANGE'  // Cancel attempted when not connected
  if (code === 162) return 'EXCHANGE'  // Historical data query error
  if (code === 354) return 'EXCHANGE'  // Market data not subscribed

  return 'UNKNOWN'
}
