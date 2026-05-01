/**
 * Shared encoding helpers for client request methods.
 * Reduces duplication across market-data, orders, account, historical.
 */

import { makeField, makeFieldHandleEmpty } from '../comm.js'
import type { Contract } from '@traderalice/ibkr-types'
import type { EClient } from './base.js'
import * as SV from '@traderalice/ibkr-types'

/**
 * Encode the standard contract fields used by most request methods.
 * Returns array of makeField() strings ready to join.
 */
export function encodeContract(client: EClient, contract: Contract, includeConId = true): string[] {
  const flds: string[] = []

  if (includeConId) {
    flds.push(makeField(contract.conId))
  }

  flds.push(
    makeField(contract.symbol),
    makeField(contract.secType),
    makeField(contract.lastTradeDateOrContractMonth),
    makeFieldHandleEmpty(contract.strike),
    makeField(contract.right),
    makeField(contract.multiplier),
    makeField(contract.exchange),
  )

  if (client.serverVersion() >= SV.MIN_SERVER_VER_PRIMARYEXCH) {
    flds.push(makeField(contract.primaryExchange))
  }

  flds.push(
    makeField(contract.currency),
    makeField(contract.localSymbol),
  )

  if (client.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) {
    flds.push(makeField(contract.tradingClass))
  }

  return flds
}

/**
 * Encode contract fields in the "legacy" order (primaryExchange always included,
 * no version gate). Used by some older-style methods.
 */
export function encodeContractLegacy(client: EClient, contract: Contract): string[] {
  const flds: string[] = []

  flds.push(
    makeField(contract.conId),
    makeField(contract.symbol),
    makeField(contract.secType),
    makeField(contract.lastTradeDateOrContractMonth),
    makeFieldHandleEmpty(contract.strike),
    makeField(contract.right),
    makeField(contract.multiplier),
    makeField(contract.exchange),
    makeField(contract.primaryExchange),
    makeField(contract.currency),
    makeField(contract.localSymbol),
  )

  if (client.serverVersion() >= SV.MIN_SERVER_VER_TRADING_CLASS) {
    flds.push(makeField(contract.tradingClass))
  }

  return flds
}
