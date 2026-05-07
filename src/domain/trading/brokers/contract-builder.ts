/**
 * Contract / Position output funnel.
 *
 * Phase 2 of the IBKR-as-truth refactor: every broker's `getPositions` and
 * contract-construction call goes through `buildContract` and `buildPosition`.
 * The functions enforce discipline at the broker output boundary:
 *
 *   - `buildContract` runs `assertContract` so any invalid output throws
 *     immediately. The error names the missing/wrong field — the alternative
 *     was bugs that surface days later as "why is OPT PnL wrong?"
 *   - `buildPosition` is the single multiplier-aware position constructor.
 *     If the broker has a pre-computed marketValue / unrealizedPnL from an
 *     upstream API (Alpaca, IBKR/TWS), we trust those. Otherwise we derive
 *     via `derivePositionMath`. Either way, `Position.multiplier` is always
 *     populated (defaults to `contract.multiplier || '1'`), so consumers
 *     can stop defending against optionality.
 */

import { Contract } from '@traderalice/ibkr'
import Decimal from 'decimal.js'
import type { Position } from './types.js'
import { assertContract, type SecType } from '../contract-discipline.js'
import { derivePositionMath } from '../position-math.js'

// ==================== buildContract ====================

export interface BuildContractInput {
  symbol: string
  secType: SecType
  exchange: string
  currency: string
  /** Defaults to `symbol` when absent. */
  localSymbol?: string
  /** OPT/FOP: YYYYMMDD. FUT: YYYYMM. */
  lastTradeDateOrContractMonth?: string
  /** OPT/FOP only. */
  strike?: number
  /** OPT/FOP only — `'C'`/`'P'`/`'CALL'`/`'PUT'`. */
  right?: 'C' | 'P' | 'CALL' | 'PUT'
  /** OPT/FOP/FUT need this; non-derivative may leave it empty (consumers default to '1'). */
  multiplier?: string
  primaryExchange?: string
  conId?: number
  tradingClass?: string
  /** Free-form description; some brokers use this for long names. */
  description?: string
}

/**
 * Construct a fully-validated IBKR Contract from broker-supplied fields.
 * Throws via `assertContract` if the result violates the SecType taxonomy
 * (e.g. an OPT without strike). All brokers' contract creation funnels
 * here — adding a new broker means matching this input shape, not
 * spelunking through the IBKR Contract class to remember which fields
 * matter.
 */
export function buildContract(input: BuildContractInput): Contract {
  const c = new Contract()
  c.symbol = input.symbol
  c.secType = input.secType
  c.exchange = input.exchange
  c.currency = input.currency
  c.localSymbol = input.localSymbol ?? input.symbol
  if (input.lastTradeDateOrContractMonth) c.lastTradeDateOrContractMonth = input.lastTradeDateOrContractMonth
  if (input.strike !== undefined) c.strike = input.strike
  if (input.right) c.right = input.right
  if (input.multiplier) c.multiplier = input.multiplier
  if (input.primaryExchange) c.primaryExchange = input.primaryExchange
  if (input.conId !== undefined) c.conId = input.conId
  if (input.tradingClass) c.tradingClass = input.tradingClass
  if (input.description) c.description = input.description
  assertContract(c)
  return c
}

// ==================== buildPosition ====================

export interface BuildPositionInput {
  contract: Contract
  currency: string
  side: 'long' | 'short'
  quantity: Decimal
  avgCost: string
  marketPrice: string
  realizedPnL: string
  /** Override `contract.multiplier` (defaults to that, then '1'). */
  multiplier?: string
  /**
   * Pre-computed marketValue (multiplier-applied) from an upstream API.
   * When set, used as-is. When absent, derived from quantity × marketPrice
   * × multiplier × side via `derivePositionMath`.
   */
  marketValue?: string
  /** Pre-computed unrealizedPnL — see marketValue. */
  unrealizedPnL?: string
  avgCostSource?: 'broker' | 'wallet'
}

/**
 * Construct a canonical Position. Brokers either pass through pre-computed
 * marketValue/unrealizedPnL from upstream APIs (Alpaca / IBKR — already
 * multiplier-applied server-side) or omit them and let the builder derive
 * the math. Multiplier is always non-empty on output (the IBroker contract
 * promised this; previously brokers had to opt in, now the builder enforces).
 */
export function buildPosition(input: BuildPositionInput): Position {
  const multiplier = input.multiplier
    ?? (input.contract.multiplier ? input.contract.multiplier : '1')

  // Either pass-through or derive — never both.
  let marketValue: string
  let unrealizedPnL: string
  if (input.marketValue !== undefined && input.unrealizedPnL !== undefined) {
    marketValue = input.marketValue
    unrealizedPnL = input.unrealizedPnL
  } else {
    const derived = derivePositionMath({
      quantity: input.quantity,
      marketPrice: input.marketPrice,
      avgCost: input.avgCost,
      multiplier,
      side: input.side,
    })
    marketValue = input.marketValue ?? derived.marketValue
    unrealizedPnL = input.unrealizedPnL ?? derived.unrealizedPnL
  }

  return {
    contract: input.contract,
    currency: input.currency,
    side: input.side,
    quantity: input.quantity,
    avgCost: input.avgCost,
    marketPrice: input.marketPrice,
    marketValue,
    unrealizedPnL,
    realizedPnL: input.realizedPnL,
    multiplier,
    ...(input.avgCostSource && { avgCostSource: input.avgCostSource }),
  }
}
