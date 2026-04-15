/**
 * MockBroker TDD tests — written BEFORE implementation.
 *
 * MockBroker is an in-memory exchange that implements IBroker.
 * It's the precision gatekeeper: if the chain passes imprecise floats,
 * these tests will catch it.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, OrderState } from '@traderalice/ibkr'
import { MockBroker, makeContract, makePosition, makeOpenOrder, makePlaceOrderResult } from './index.js'
import '../../contract-ext.js'

let broker: MockBroker

beforeEach(() => {
  broker = new MockBroker({ cash: 100_000 })
})

// ==================== Precision ====================

describe('precision', () => {
  it('placeOrder quantity survives Decimal round-trip', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.123456789')

    const result = await broker.placeOrder(contract, order)
    expect(result.success).toBe(true)
    // Verify via position — placeOrder doesn't return execution (async model)
    const positions = await broker.getPositions()
    expect(positions[0].quantity.toString()).toBe('0.123456789')
  })

  it('position quantity matches placed order exactly', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.51')

    await broker.placeOrder(contract, order)
    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toString()).toBe('0.51')
  })

  it('closePosition removes position completely', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.51')

    await broker.placeOrder(contract, order)
    const closeResult = await broker.closePosition(contract)
    expect(closeResult.success).toBe(true)

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(0)
  })

  it('partial close leaves correct remainder via Decimal subtraction', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH' })
    const buyOrder = new Order()
    buyOrder.action = 'BUY'
    buyOrder.orderType = 'MKT'
    buyOrder.totalQuantity = new Decimal('1.0')

    await broker.placeOrder(contract, buyOrder)
    await broker.closePosition(contract, new Decimal('0.3'))

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    // 1.0 - 0.3 = 0.7 exactly, no IEEE 754 nonsense
    expect(positions[0].quantity.toString()).toBe('0.7')
  })
})

// ==================== placeOrder ====================

describe('placeOrder', () => {
  it('market order returns submitted (fill confirmed via getOrder)', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)

    const result = await broker.placeOrder(contract, order)
    expect(result.success).toBe(true)
    expect(result.orderId).toBeDefined()
    // No execution in response — async model
    expect(result.execution).toBeUndefined()
    // But getOrder shows filled status
    const detail = await broker.getOrder(result.orderId!)
    expect(detail!.orderState.status).toBe('Filled')
  })

  it('limit order stays submitted, no execution', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = 140

    const result = await broker.placeOrder(contract, order)
    expect(result.success).toBe(true)
    expect(result.execution).toBeUndefined()
    expect(result.orderState!.status).toBe('Submitted')
    expect(result.orderId).toBeDefined()
  })

  it('creates position on buy', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)

    await broker.placeOrder(contract, order)
    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].side).toBe('long')
    expect(positions[0].quantity.toNumber()).toBe(10)
    expect(positions[0].avgCost).toBe('150')
  })

  it('updates existing position on additional buy (avg cost recalc)', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })

    const order1 = new Order()
    order1.action = 'BUY'
    order1.orderType = 'MKT'
    order1.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order1)

    broker.setQuote('AAPL', 160)
    const order2 = new Order()
    order2.action = 'BUY'
    order2.orderType = 'MKT'
    order2.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order2)

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toNumber()).toBe(20)
    // avg cost = (10*150 + 10*160) / 20 = 155
    expect(positions[0].avgCost).toBe('155')
  })
})

// ==================== closePosition ====================

describe('closePosition', () => {
  it('closes full position', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order)

    const result = await broker.closePosition(contract)
    expect(result.success).toBe(true)

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(0)
  })

  it('partial close reduces quantity', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order)

    await broker.closePosition(contract, new Decimal(3))

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toNumber()).toBe(7)
  })

  it('returns error when no position', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const result = await broker.closePosition(contract)
    expect(result.success).toBe(false)
    expect(result.error).toContain('No open position')
  })
})

// ==================== cancelOrder ====================

describe('cancelOrder', () => {
  it('cancels pending order', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = 140

    const placed = await broker.placeOrder(contract, order)
    const cancelled = await broker.cancelOrder(placed.orderId!)
    expect(cancelled.success).toBe(true)
    expect(cancelled.orderId).toBe(placed.orderId)
    expect(cancelled.orderState?.status).toBe('Cancelled')

    const brokerOrder = await broker.getOrder(placed.orderId!)
    expect(brokerOrder!.orderState.status).toBe('Cancelled')
  })

  it('returns error for unknown order', async () => {
    const result = await broker.cancelOrder('nonexistent')
    expect(result.success).toBe(false)
    expect(result.error).toContain('nonexistent')
  })
})

// ==================== modifyOrder ====================

describe('modifyOrder', () => {
  it('updates pending order qty/price', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = 140

    const placed = await broker.placeOrder(contract, order)

    const changes = new Order()
    changes.totalQuantity = new Decimal(20)
    changes.lmtPrice = 145
    const modified = await broker.modifyOrder(placed.orderId!, changes)
    expect(modified.success).toBe(true)

    const brokerOrder = await broker.getOrder(placed.orderId!)
    expect(brokerOrder!.order.totalQuantity.toNumber()).toBe(20)
    expect(brokerOrder!.order.lmtPrice).toBe(145)
  })

  it('returns error for unknown order', async () => {
    const changes = new Order()
    changes.totalQuantity = new Decimal(20)
    const result = await broker.modifyOrder('nonexistent', changes)
    expect(result.success).toBe(false)
  })
})

// ==================== getOrder ====================

describe('getOrder', () => {
  it('finds order by id', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = 140

    const placed = await broker.placeOrder(contract, order)
    const found = await broker.getOrder(placed.orderId!)
    expect(found).not.toBeNull()
    expect(found!.order.action).toBe('BUY')
  })

  it('returns null for unknown id', async () => {
    const result = await broker.getOrder('nonexistent')
    expect(result).toBeNull()
  })
})

// ==================== fillPendingOrder (test helper) ====================

describe('fillPendingOrder', () => {
  it('fills a pending limit order at specified price', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = 140

    const placed = await broker.placeOrder(contract, order)
    broker.fillPendingOrder(placed.orderId!, 139.50)

    const filled = await broker.getOrder(placed.orderId!)
    expect(filled!.orderState.status).toBe('Filled')

    // Position should be created
    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].avgCost).toBe('139.5')
  })
})

// ==================== getAccount ====================

describe('getAccount', () => {
  it('starts with configured cash', async () => {
    const account = await broker.getAccount()
    expect(account.netLiquidation).toBe('100000')
    expect(account.totalCashValue).toBe('100000')
    expect(account.unrealizedPnL).toBe('0')
  })

  it('cash decreases after buy, equity includes unrealized PnL', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order)

    // Price goes up
    broker.setQuote('AAPL', 160)
    const account = await broker.getAccount()
    // cash = 100000 - 10*150 = 98500
    expect(account.totalCashValue).toBe('98500')
    // unrealized = 10 * (160 - 150) = 100
    expect(account.unrealizedPnL).toBe('100')
    // equity = cash + market value = 98500 + 10*160 = 100100
    expect(account.netLiquidation).toBe('100100')
  })
})

// ==================== Call tracking ====================

describe('call tracking', () => {
  it('records method calls with args', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    await broker.getQuote(contract)
    expect(broker.callCount('getQuote')).toBe(1)
    expect(broker.lastCall('getQuote')!.args[0]).toBe(contract)
  })

  it('tracks multiple calls', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)

    await broker.placeOrder(contract, order)
    await broker.getPositions()
    await broker.getAccount()

    expect(broker.callCount('placeOrder')).toBe(1)
    expect(broker.callCount('getPositions')).toBe(1)
    expect(broker.callCount('getAccount')).toBe(1)
    expect(broker.calls().length).toBeGreaterThanOrEqual(3)
  })

  it('returns null for uncalled method', () => {
    expect(broker.lastCall('placeOrder')).toBeNull()
    expect(broker.callCount('placeOrder')).toBe(0)
  })

  it('resetCalls clears the log', async () => {
    await broker.getAccount()
    expect(broker.callCount('getAccount')).toBe(1)
    broker.resetCalls()
    expect(broker.callCount('getAccount')).toBe(0)
  })
})

// ==================== accountInfo constructor option ====================

describe('accountInfo constructor option', () => {
  it('overrides getAccount return value', async () => {
    const b = new MockBroker({ accountInfo: { netLiquidation: '50000', totalCashValue: '30000', unrealizedPnL: '2000', realizedPnL: '500' } })
    const account = await b.getAccount()
    expect(account.netLiquidation).toBe('50000')
    expect(account.totalCashValue).toBe('30000')
    expect(account.unrealizedPnL).toBe('2000')
    expect(account.realizedPnL).toBe('500')
  })
})

// ==================== Factory helpers ====================

describe('factory helpers', () => {
  it('makeContract creates a contract with defaults', () => {
    const c = makeContract()
    expect(c.aliceId).toBe('mock-paper|AAPL')
    expect(c.symbol).toBe('AAPL')
  })

  it('makeContract accepts overrides', () => {
    const c = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH', secType: 'CRYPTO' })
    expect(c.aliceId).toBe('mock-paper|ETH')
    expect(c.symbol).toBe('ETH')
    expect(c.secType).toBe('CRYPTO')
  })

  it('makePosition creates a position with defaults', () => {
    const p = makePosition()
    expect(p.side).toBe('long')
    expect(p.quantity.toNumber()).toBe(10)
  })

  it('makeOpenOrder creates an order with defaults', () => {
    const o = makeOpenOrder()
    expect(o.orderState.status).toBe('Filled')
  })

  it('makePlaceOrderResult creates a success result', () => {
    const r = makePlaceOrderResult()
    expect(r.success).toBe(true)
    expect(r.orderId).toBe('order-1')
  })
})
