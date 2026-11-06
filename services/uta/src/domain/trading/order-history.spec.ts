import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { projectOrderHistory, projectTradeHistory } from './order-history.js'
import type { GitCommit, Operation, OperationResult } from './git/types.js'
import './contract-ext.js'

let n = 0
function commit(ops: Operation[], results: OperationResult[], message = 'test'): GitCommit {
  return {
    hash: `c${++n}`,
    parentHash: null,
    message,
    operations: ops,
    results,
    stateAfter: {
      netLiquidation: '0', totalCashValue: '0', unrealizedPnL: '0', realizedPnL: '0',
      positions: [], pendingOrders: [],
    },
    timestamp: new Date(1_700_000_000_000 + n * 60_000).toISOString(),
  }
}

function contract(over: Partial<Contract> = {}): Contract {
  const c = new Contract()
  c.aliceId = 'okx|ETH/USDT'
  c.symbol = 'ETH'
  c.localSymbol = 'ETH/USDT'
  c.secType = 'CRYPTO'
  Object.assign(c, over)
  return c
}

function limitBuy(qty: string, price: string): Order {
  const o = new Order()
  o.action = 'BUY'
  o.orderType = 'LMT'
  o.totalQuantity = new Decimal(qty)
  o.lmtPrice = new Decimal(price)
  return o
}

/** A persisted verdict is data, not a type: the log rehydrates from disk without
 *  validating results, so a record can carry a status the union never listed. */
function persistedResult(value: unknown): OperationResult {
  return value as OperationResult
}

describe('projectOrderHistory', () => {
  it('collapses place→sync-fill into one resolved row', () => {
    const commits = [
      commit(
        [{ action: 'placeOrder', contract: contract(), order: limitBuy('0.01', '1650') }],
        [{ action: 'placeOrder', success: true, orderId: 'o1', status: 'submitted' }],
        'buy the dip',
      ),
      commit(
        [{ action: 'syncOrders' }],
        [{ action: 'syncOrders', success: true, orderId: 'o1', status: 'filled', filledQty: '0.01', filledPrice: '1648.5' }],
      ),
    ]
    const rows = projectOrderHistory(commits)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      orderId: 'o1',
      side: 'BUY',
      orderType: 'LMT',
      quantity: '0.01',
      limitPrice: '1650',
      status: 'filled',
      filledQty: '0.01',
      avgFillPrice: '1648.5',
      source: 'alice',
      message: 'buy the dip',
    })
    expect(rows[0].resolvedAt).toBeDefined()
  })

  it('external observed orders are flagged and resolvable by cancel', () => {
    const commits = [
      commit(
        [{ action: 'observeExternalOrder', contract: contract(), order: limitBuy('1', '1500') }],
        [{ action: 'observeExternalOrder', success: true, orderId: 'ext1', status: 'submitted' }],
        '[observed] 1 external order(s)',
      ),
      commit(
        [{ action: 'cancelOrder', orderId: 'ext1' }],
        [{ action: 'cancelOrder', success: true, orderId: 'ext1', status: 'cancelled' }],
      ),
    ]
    const rows = projectOrderHistory(commits)
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('external')
    expect(rows[0].status).toBe('cancelled')
  })

  it('preserves IBKR-superset option fields on the contract', () => {
    const opt = contract({
      aliceId: 'ibkr|AAPL 260717C300', symbol: 'AAPL', secType: 'OPT',
      lastTradeDateOrContractMonth: '20260717', strike: 300, right: 'C', multiplier: '100',
    })
    const commits = [
      commit(
        [{ action: 'placeOrder', contract: opt, order: limitBuy('1', '12.5') }],
        [{ action: 'placeOrder', success: true, orderId: 'opt1', status: 'submitted' }],
      ),
    ]
    const row = projectOrderHistory(commits)[0]
    expect(row.contract).toMatchObject({
      secType: 'OPT', expiry: '20260717', strike: '300', right: 'C', multiplier: '100',
    })
  })

  it('rejected-before-submit rows survive without an orderId', () => {
    const commits = [
      commit(
        [{ action: 'placeOrder', contract: contract(), order: limitBuy('0.01', '99999') }],
        [{ action: 'placeOrder', success: false, status: 'rejected', error: 'price band' }],
      ),
    ]
    const rows = projectOrderHistory(commits)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('rejected')
    expect(rows[0].error).toBe('price band')
  })

  it('keeps an explicitly unconfirmed broker write visible as unconfirmed', () => {
    const commits = [
      commit(
        [{ action: 'placeOrder', contract: contract(), order: limitBuy('0.01', '1650') }],
        [{ action: 'placeOrder', success: false, orderId: 'live-maybe', status: 'unconfirmed', error: 'broker call still outstanding' }],
        'buy the dip',
      ),
    ]
    const rows = projectOrderHistory(commits)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      orderId: 'live-maybe',
      status: 'unconfirmed',
      error: 'broker call still outstanding',
      message: 'buy the dip',
    })
    expect(rows[0].status).not.toBe('rejected')
  })

  it('reads an unresolvable verdict as unconfirmed and names the gap on the row', () => {
    // No writer omits a verdict (one per operation), so these are records whose
    // verdict was lost or written by something that knows a status the vocabulary
    // does not. Neither is a venue rejection: 'rejected' would assert an answer
    // this log does not have, and the order may be live.
    const open = commit(
      [{ action: 'placeOrder', contract: contract(), order: limitBuy('0.01', '1650') }],
      [{ action: 'placeOrder', success: true, orderId: 'o1', status: 'submitted' }],
    )
    const lostVerdict = commit(
      [{ action: 'placeOrder', contract: contract(), order: limitBuy('0.02', '1650') }],
      [],
    )
    const unknownStatus = commit(
      [{ action: 'placeOrder', contract: contract(), order: limitBuy('0.03', '1650') }],
      [persistedResult({ action: 'placeOrder', success: false, status: 'ghosted' })],
    )
    const unknownSync = commit(
      [{ action: 'syncOrders' }],
      [persistedResult({ action: 'syncOrders', success: true, orderId: 'o1', status: 'ghosted' })],
    )

    const unresolved = projectOrderHistory([open, lostVerdict, unknownStatus])

    const anonymous = unresolved.filter((row) => !row.orderId)
    expect(anonymous.map((row) => row.status)).toEqual(['unconfirmed', 'unconfirmed'])
    expect(anonymous.every((row) => row.error?.includes('no recorded verdict'))).toBe(true)
    const rows = projectOrderHistory([open, lostVerdict, unknownStatus, unknownSync])
    const resolved = rows.find((row) => row.orderId === 'o1')
    expect(resolved?.status).toBe('unconfirmed')
    expect(resolved?.resolvedAt).toBeDefined()
  })
})

describe('projectTradeHistory', () => {
  it('records sync fills once with side/contract joined from the origin', () => {
    const commits = [
      commit(
        [{ action: 'placeOrder', contract: contract(), order: limitBuy('0.01', '1650') }],
        [{ action: 'placeOrder', success: true, orderId: 'o1', status: 'submitted' }],
      ),
      commit(
        [{ action: 'syncOrders' }],
        [{ action: 'syncOrders', success: true, orderId: 'o1', status: 'filled', filledQty: '0.01', filledPrice: '1648.5' }],
      ),
    ]
    const trades = projectTradeHistory(commits)
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      orderId: 'o1', side: 'BUY', quantity: '0.01', price: '1648.5', value: '16.485', source: 'order',
    })
  })

  it('reconcile foldings are labeled, not disguised as fills', () => {
    const commits = [
      commit(
        [{ action: 'reconcileBalance', aliceId: 'okx|ETH/USDT', quantityDelta: '0.5', markPrice: '1700' }],
        [{ action: 'reconcileBalance', success: true, status: 'filled', filledQty: '0.5', filledPrice: '1700' }],
      ),
    ]
    const trades = projectTradeHistory(commits)
    expect(trades).toHaveLength(1)
    expect(trades[0].source).toBe('reconcile')
    expect(trades[0].side).toBe('BUY')
  })

  it('does not double-count an origin fill against a redundant sync', () => {
    const order = limitBuy('1', '100')
    const commits = [
      commit(
        [{ action: 'placeOrder', contract: contract(), order }],
        [{ action: 'placeOrder', success: true, orderId: 'o2', status: 'filled', filledQty: '1', filledPrice: '100' }],
      ),
      commit(
        [{ action: 'syncOrders' }],
        [{ action: 'syncOrders', success: true, orderId: 'o2', status: 'filled', filledQty: '1', filledPrice: '100' }],
      ),
    ]
    expect(projectTradeHistory(commits)).toHaveLength(1)
  })
})
