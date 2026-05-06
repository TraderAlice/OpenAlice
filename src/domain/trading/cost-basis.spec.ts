import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { recomputeCostBasisFromCommits } from './cost-basis.js'
import type { GitCommit, Operation, OperationResult } from './git/types.js'
import './contract-ext.js'

// ==================== Helpers ====================

function makeContract(aliceId: string): Contract {
  const c = new Contract()
  c.aliceId = aliceId
  c.symbol = aliceId.split('|').pop() ?? aliceId
  return c
}

function buy(aliceId: string, qty: number, price: number): { op: Operation; result: OperationResult } {
  const order = new Order()
  order.action = 'BUY'
  order.totalQuantity = new Decimal(qty)
  return {
    op: { action: 'placeOrder', contract: makeContract(aliceId), order },
    result: {
      action: 'placeOrder',
      success: true,
      status: 'filled',
      filledQty: String(qty),
      filledPrice: String(price),
    },
  }
}

function sell(aliceId: string, qty: number, price: number): { op: Operation; result: OperationResult } {
  const order = new Order()
  order.action = 'SELL'
  order.totalQuantity = new Decimal(qty)
  return {
    op: { action: 'placeOrder', contract: makeContract(aliceId), order },
    result: {
      action: 'placeOrder',
      success: true,
      status: 'filled',
      filledQty: String(qty),
      filledPrice: String(price),
    },
  }
}

function reconcile(aliceId: string, delta: number, mark: number): { op: Operation; result: OperationResult } {
  return {
    op: {
      action: 'reconcileBalance',
      aliceId,
      quantityDelta: String(delta),
      markPrice: String(mark),
    },
    result: {
      action: 'reconcileBalance',
      success: true,
      status: 'filled',
      filledQty: String(Math.abs(delta)),
      filledPrice: String(mark),
    },
  }
}

let commitCounter = 0
function commit(...fills: Array<{ op: Operation; result: OperationResult }>): GitCommit {
  return {
    hash: `c${++commitCounter}`,
    parentHash: null,
    message: 'test',
    operations: fills.map(f => f.op),
    results: fills.map(f => f.result),
    stateAfter: {
      netLiquidation: '0',
      totalCashValue: '0',
      unrealizedPnL: '0',
      realizedPnL: '0',
      positions: [],
      pendingOrders: [],
    },
    timestamp: new Date().toISOString(),
  }
}

const ALICE_ID = 'bybit|BTC_USDT'

// ==================== Tests ====================

describe('recomputeCostBasisFromCommits', () => {
  it('returns null when no commits exist', () => {
    expect(recomputeCostBasisFromCommits([], ALICE_ID)).toBeNull()
  })

  it('returns null when commits exist but none touch the aliceId', () => {
    const c = commit(buy('bybit|ETH_USDT', 1, 2000))
    expect(recomputeCostBasisFromCommits([c], ALICE_ID)).toBeNull()
  })

  it('single buy → avg = price, qty = filled', () => {
    const c = commit(buy(ALICE_ID, 1, 50000))
    const result = recomputeCostBasisFromCommits([c], ALICE_ID)!
    expect(result.avgCost.toNumber()).toBe(50000)
    expect(result.qty.toNumber()).toBe(1)
    expect(result.fillCount).toBe(1)
  })

  it('two buys → weighted average', () => {
    const c1 = commit(buy(ALICE_ID, 1, 50000))
    const c2 = commit(buy(ALICE_ID, 1, 80000))
    const result = recomputeCostBasisFromCommits([c1, c2], ALICE_ID)!
    expect(result.avgCost.toNumber()).toBe(65000)
    expect(result.qty.toNumber()).toBe(2)
    expect(result.fillCount).toBe(2)
  })

  it('buy → partial sell → avg unchanged, qty reduced', () => {
    const commits = [
      commit(buy(ALICE_ID, 2, 50000)),
      commit(sell(ALICE_ID, 1, 60000)),
    ]
    const result = recomputeCostBasisFromCommits(commits, ALICE_ID)!
    expect(result.avgCost.toNumber()).toBe(50000)
    expect(result.qty.toNumber()).toBe(1)
  })

  it('buy → full sell → avg/qty reset to zero', () => {
    const commits = [
      commit(buy(ALICE_ID, 1, 50000)),
      commit(sell(ALICE_ID, 1, 60000)),
    ]
    const result = recomputeCostBasisFromCommits(commits, ALICE_ID)!
    expect(result.avgCost.toNumber()).toBe(0)
    expect(result.qty.toNumber()).toBe(0)
  })

  it('buy → over-sell (qty goes negative) → reset to zero', () => {
    const commits = [
      commit(buy(ALICE_ID, 1, 50000)),
      commit(sell(ALICE_ID, 1.5, 60000)),
    ]
    const result = recomputeCostBasisFromCommits(commits, ALICE_ID)!
    expect(result.avgCost.toNumber()).toBe(0)
    expect(result.qty.toNumber()).toBe(0)
  })

  it('buy → full sell → buy again → fresh basis', () => {
    const commits = [
      commit(buy(ALICE_ID, 1, 50000)),
      commit(sell(ALICE_ID, 1, 60000)),
      commit(buy(ALICE_ID, 1, 70000)),
    ]
    const result = recomputeCostBasisFromCommits(commits, ALICE_ID)!
    expect(result.avgCost.toNumber()).toBe(70000)
    expect(result.qty.toNumber()).toBe(1)
  })

  it('Ame example: buy 1@50k → buy 1@80k → sell 0.5 → buy 1@70k', () => {
    const commits = [
      commit(buy(ALICE_ID, 1, 50000)),
      commit(buy(ALICE_ID, 1, 80000)),
      commit(sell(ALICE_ID, 0.5, 90000)),
      commit(buy(ALICE_ID, 1, 70000)),
    ]
    const result = recomputeCostBasisFromCommits(commits, ALICE_ID)!
    // After buy 1@50k:                avg=50000, qty=1
    // After buy 1@80k:                avg=65000, qty=2
    // After sell 0.5@anything:        avg=65000, qty=1.5
    // After buy 1@70k:                avg=(65000*1.5+70000*1)/2.5 = 67000, qty=2.5
    expect(result.avgCost.toNumber()).toBe(67000)
    expect(result.qty.toNumber()).toBe(2.5)
  })

  it('reconcileBalance positive delta acts as buy at markPrice', () => {
    const c = commit(reconcile(ALICE_ID, 1.0093, 80569.90))
    const result = recomputeCostBasisFromCommits([c], ALICE_ID)!
    expect(result.avgCost.toNumber()).toBeCloseTo(80569.90, 6)
    expect(result.qty.toNumber()).toBeCloseTo(1.0093, 6)
  })

  it('reconcileBalance negative delta acts as sell (avg unchanged)', () => {
    const commits = [
      commit(buy(ALICE_ID, 1, 50000)),
      commit(reconcile(ALICE_ID, -0.3, 60000)),
    ]
    const result = recomputeCostBasisFromCommits(commits, ALICE_ID)!
    expect(result.avgCost.toNumber()).toBe(50000)
    expect(result.qty.toNumber()).toBeCloseTo(0.7, 6)
  })

  it('mixes real buy + reconcile bootstrap correctly', () => {
    // Bootstrap 1 BTC at 80k (e.g. UTA first sight), then real buy 0.5 BTC @ 100k
    const commits = [
      commit(reconcile(ALICE_ID, 1, 80000)),
      commit(buy(ALICE_ID, 0.5, 100000)),
    ]
    const result = recomputeCostBasisFromCommits(commits, ALICE_ID)!
    // (80000*1 + 100000*0.5) / 1.5 = 86666.66...
    expect(result.avgCost.toNumber()).toBeCloseTo(86666.67, 2)
    expect(result.qty.toNumber()).toBe(1.5)
    expect(result.fillCount).toBe(2)
  })

  it('rejects unsuccessful results — does not affect cost basis', () => {
    const failedBuy = buy(ALICE_ID, 1, 50000)
    failedBuy.result.success = false
    failedBuy.result.status = 'rejected'
    const goodBuy = buy(ALICE_ID, 1, 60000)
    const result = recomputeCostBasisFromCommits(
      [commit(failedBuy, goodBuy)],
      ALICE_ID,
    )!
    expect(result.avgCost.toNumber()).toBe(60000)
    expect(result.qty.toNumber()).toBe(1)
    expect(result.fillCount).toBe(1)
  })

  it('rejects results without filledPrice — does not affect cost basis', () => {
    const partial = buy(ALICE_ID, 1, 50000)
    partial.result.filledPrice = undefined
    const result = recomputeCostBasisFromCommits([commit(partial)], ALICE_ID)
    expect(result).toBeNull()
  })

  it('filters by aliceId — sibling positions do not contaminate', () => {
    const commits = [
      commit(buy(ALICE_ID, 1, 50000)),
      commit(buy('bybit|ETH_USDT', 5, 2000)),
      commit(buy(ALICE_ID, 1, 80000)),
    ]
    const result = recomputeCostBasisFromCommits(commits, ALICE_ID)!
    expect(result.avgCost.toNumber()).toBe(65000)
    expect(result.qty.toNumber()).toBe(2)
  })

  it('handles closePosition op as a sell', () => {
    const buyFill = buy(ALICE_ID, 1, 50000)
    const closeOp: { op: Operation; result: OperationResult } = {
      op: { action: 'closePosition', contract: makeContract(ALICE_ID) },
      result: {
        action: 'closePosition',
        success: true,
        status: 'filled',
        filledQty: '1',
        filledPrice: '60000',
      },
    }
    const result = recomputeCostBasisFromCommits(
      [commit(buyFill), commit(closeOp)],
      ALICE_ID,
    )!
    expect(result.avgCost.toNumber()).toBe(0)
    expect(result.qty.toNumber()).toBe(0)
  })

  it('preserves Decimal precision for sub-satoshi quantities', () => {
    const commits = [
      commit(buy(ALICE_ID, 0.001, 76276.6)),
    ]
    const result = recomputeCostBasisFromCommits(commits, ALICE_ID)!
    expect(result.avgCost.toString()).toBe('76276.6')
    expect(result.qty.toString()).toBe('0.001')
  })
})
