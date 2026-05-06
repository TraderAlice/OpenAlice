/**
 * Cost-basis reconstruction from the wallet/order log.
 *
 * Walks `GitCommit` operations chronologically and computes the running
 * weighted-average cost (WAC) for a given `aliceId`. Used by UTA for
 * positions whose broker has no authoritative avgCost — i.e. CCXT spot
 * holdings synthesized from `fetchBalance()`. The complementary path
 * (`reconcileBalance` operations) folds in unattributed quantity drift
 * at observed market price, so first-sight bootstrap and external
 * deposits/transfers compose into the same algorithm.
 *
 * Sell-down semantics: cost basis stays put as long as the position is
 * net long; when quantity reaches zero (or goes negative through over-
 * sell) the running average resets to zero, so the next buy starts a
 * fresh basis. Matches what most exchange UIs show for crypto spot.
 *
 * Out of scope (deliberate, document-only limitations):
 *   - Short positions are not modeled — spot holdings are long-only.
 *   - Splits / rebases / token migrations: not modeled.
 *   - FIFO lot tracking for tax accounting: WAC only.
 *   - Pre-Alice deposits: handled via `reconcileBalance`, but the cost
 *     attribution will be "current price at first observation" rather
 *     than the user's true acquisition cost.
 */

import Decimal from 'decimal.js'
import type { GitCommit, Operation, OperationResult } from './git/types.js'

export interface CostBasisResult {
  /** Running weighted-average cost. Zero when qty <= 0. */
  avgCost: Decimal
  /** Net quantity after applying all fills. */
  qty: Decimal
  /** Number of fills applied — for diagnostics / UI tooltips. */
  fillCount: number
}

/**
 * Replay every filled fill for `aliceId` across the commit log and return
 * the resulting cost-basis state. Returns `null` if no relevant fills exist
 * — caller should fall back to bootstrap (markPrice) and synthesize a
 * `reconcileBalance` to seed the log.
 */
export function recomputeCostBasisFromCommits(
  commits: GitCommit[],
  aliceId: string,
): CostBasisResult | null {
  let avg = new Decimal(0)
  let qty = new Decimal(0)
  let fillCount = 0

  for (const commit of commits) {
    for (let i = 0; i < commit.operations.length; i++) {
      const op = commit.operations[i]
      const result = commit.results[i]
      if (!matchesAliceId(op, aliceId)) continue
      if (!result || !result.success) continue
      if (!result.filledQty || !result.filledPrice) continue

      const fillQty = new Decimal(result.filledQty)
      const fillPrice = new Decimal(result.filledPrice)
      if (fillQty.isZero()) continue

      const direction = fillDirection(op)
      if (direction === 'buy') {
        // Weighted-average update
        const newQty = qty.plus(fillQty)
        if (newQty.isZero()) {
          // Defensive — shouldn't happen for a buy, but guard against div/0
          avg = new Decimal(0)
          qty = new Decimal(0)
        } else {
          avg = avg.mul(qty).plus(fillPrice.mul(fillQty)).div(newQty)
          qty = newQty
        }
      } else {
        // Sell — qty drops, avg unchanged. Reset when fully sold (or oversold).
        qty = qty.minus(fillQty)
        if (qty.lte(0)) {
          avg = new Decimal(0)
          qty = new Decimal(0)
        }
      }
      fillCount++
    }
  }

  if (fillCount === 0) return null
  return { avgCost: avg, qty, fillCount }
}

/** True when this op references `aliceId`. */
function matchesAliceId(op: Operation, aliceId: string): boolean {
  switch (op.action) {
    case 'placeOrder':
    case 'closePosition':
      return op.contract?.aliceId === aliceId
    case 'reconcileBalance':
      return op.aliceId === aliceId
    default:
      return false
  }
}

/** Determine if a filled op behaves as a buy or sell for cost-basis purposes. */
function fillDirection(op: Operation): 'buy' | 'sell' {
  switch (op.action) {
    case 'placeOrder': {
      const action = (op.order?.action ?? '').toUpperCase()
      return action === 'SELL' ? 'sell' : 'buy'
    }
    case 'closePosition':
      // closePosition on a long spot holding sells; we don't model short closes.
      return 'sell'
    case 'reconcileBalance':
      return new Decimal(op.quantityDelta).gte(0) ? 'buy' : 'sell'
    default:
      // Unreachable — caller pre-filters via matchesAliceId.
      return 'buy'
  }
}

/** Whether this op's filled result would affect a cost-basis pipeline. */
export function isCostBasisRelevant(op: Operation, result: OperationResult | undefined): boolean {
  if (!result?.success || !result.filledQty || !result.filledPrice) return false
  return op.action === 'placeOrder' || op.action === 'closePosition' || op.action === 'reconcileBalance'
}
