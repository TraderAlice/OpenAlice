/**
 * Position math — single source for `marketValue` and `unrealizedPnL`.
 *
 * The IBroker.Position contract requires marketValue and unrealizedPnL
 * to be multiplier-applied. Historically every broker implemented the
 * math itself, leading to drift (Mock had three multiplier-related bugs
 * surfaced in 2026-05-07 QA). This module is the only place that math
 * lives — brokers, UTA reconcile, and UI consumers all funnel here so
 * the multiplier rule is enforced in exactly one implementation.
 *
 * Convention recap (matches the docstring on `Position.multiplier`):
 *   - `quantity`, `avgCost`, `marketPrice` are per-unit values.
 *   - `multiplier` is shares-per-contract: 1 for stocks/crypto, typically
 *     100 for US equity options, broker-specific for futures.
 *   - `marketValue   = quantity × marketPrice × multiplier`
 *   - `unrealizedPnL = quantity × (marketPrice − avgCost) × multiplier × side`
 *     where `side = +1` for long, `−1` for short.
 */

import Decimal from 'decimal.js'

export interface PositionMathInput {
  quantity: Decimal | string | number
  marketPrice: Decimal | string | number
  avgCost: Decimal | string | number
  multiplier: string
  side: 'long' | 'short'
}

export interface PositionMathOutput {
  marketValue: string
  unrealizedPnL: string
}

/** Coerce a numeric-ish input to Decimal; defaults to 0 on falsy/empty. */
function toDecimal(v: Decimal | string | number | undefined | null): Decimal {
  if (v == null || v === '') return new Decimal(0)
  return v instanceof Decimal ? v : new Decimal(v)
}

/** Coerce multiplier string to Decimal; empty → 1 (the canonical default). */
export function multiplierToDecimal(m: string | undefined): Decimal {
  if (!m) return new Decimal(1)
  const d = new Decimal(m)
  return d.isZero() ? new Decimal(1) : d
}

/**
 * Compute marketValue and unrealizedPnL from raw position inputs. Brokers
 * call this in their `getPositions` instead of computing the values inline.
 */
export function derivePositionMath(input: PositionMathInput): PositionMathOutput {
  const qty = toDecimal(input.quantity)
  const mark = toDecimal(input.marketPrice)
  const avg = toDecimal(input.avgCost)
  const mult = multiplierToDecimal(input.multiplier)
  const sideSign = input.side === 'long' ? 1 : -1

  const marketValue = qty.mul(mark).mul(mult)
  const unrealizedPnL = qty.mul(mark.minus(avg)).mul(mult).mul(sideSign)
  return {
    marketValue: marketValue.toString(),
    unrealizedPnL: unrealizedPnL.toString(),
  }
}

/**
 * PnL-only convenience for consumers that already have marketValue but
 * need to recompute PnL after avgCost changes (UTA reconcile pipeline,
 * simulator UI on price tick). Same multiplier discipline as derive.
 */
export function pnlOf(input: PositionMathInput): string {
  const qty = toDecimal(input.quantity)
  const mark = toDecimal(input.marketPrice)
  const avg = toDecimal(input.avgCost)
  const mult = multiplierToDecimal(input.multiplier)
  const sideSign = input.side === 'long' ? 1 : -1
  return qty.mul(mark.minus(avg)).mul(mult).mul(sideSign).toString()
}
