/**
 * Execution model — applies slippage + commission on fills.
 *
 * Slippage is applied in the direction that hurts you:
 *   - BUYS:  fill at price * (1 + slippageBps/10000)
 *   - SELLS: fill at price * (1 - slippageBps/10000)
 *
 * Commission is charged on the notional value of the filled quantity
 * at the slipped price, one-way per leg. A round-trip long pays
 * commission twice (entry + exit).
 *
 * This is a minimum-viable model. It does not simulate partial fills,
 * liquidity, queue position, or spread — those would all make the
 * numbers worse, not better, so the MVP errs on the pessimistic side.
 */

import type { ExecutionParams } from './types.js'

export interface FillQuote {
  /** Fill price after slippage. */
  price: number
  /** Commission charged on this leg. */
  commission: number
  /** Notional value at the slipped price. */
  notional: number
}

/** Apply slippage and compute commission for a BUY (entry long or exit short). */
export function quoteBuy(rawPrice: number, size: number, params: ExecutionParams): FillQuote {
  validate(rawPrice, size, params)
  const slip = rawPrice * (params.slippageBps / 10_000)
  const price = rawPrice + slip
  const notional = price * size
  const commission = notional * (params.commissionBps / 10_000)
  return { price, commission, notional }
}

/** Apply slippage and compute commission for a SELL (entry short or exit long). */
export function quoteSell(rawPrice: number, size: number, params: ExecutionParams): FillQuote {
  validate(rawPrice, size, params)
  const slip = rawPrice * (params.slippageBps / 10_000)
  const price = rawPrice - slip
  const notional = price * size
  const commission = notional * (params.commissionBps / 10_000)
  return { price, commission, notional }
}

function validate(rawPrice: number, size: number, params: ExecutionParams): void {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    throw new Error(`execution: rawPrice must be positive, got ${rawPrice}`)
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`execution: size must be positive, got ${size}`)
  }
  if (params.slippageBps < 0) {
    throw new Error(`execution: slippageBps must be >= 0, got ${params.slippageBps}`)
  }
  if (params.commissionBps < 0) {
    throw new Error(`execution: commissionBps must be >= 0, got ${params.commissionBps}`)
  }
}
