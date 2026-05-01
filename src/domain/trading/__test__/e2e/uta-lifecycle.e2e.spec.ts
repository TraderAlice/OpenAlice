/**
 * UTA integration tests — full trading lifecycle against MockBroker.
 *
 * Not unit tests. These exercise the complete flow:
 *   stage → commit → push (submitted) → sync (filled) → state changes
 *
 * MockBroker acts as an in-memory exchange with real behavior:
 * positions update, cash moves, orders track status.
 * placeOrder returns submitted — fill confirmed via getOrder/sync.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Decimal from 'decimal.js'
import { UnifiedTradingAccount } from '../../UnifiedTradingAccount.js'
import { MockBroker } from '../../brokers/mock/index.js'
import '../../contract-ext.js'

let broker: MockBroker
let uta: UnifiedTradingAccount

beforeEach(() => {
  broker = new MockBroker({ cash: 100_000 })
  broker.setQuote('AAPL', 150)
  broker.setQuote('ETH', 1920)
  uta = new UnifiedTradingAccount(broker)
})

// ==================== Full trading lifecycle ====================

describe('UTA — full trading lifecycle', () => {
  it('market buy: push returns submitted, position appears, cash decreases', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    const commitResult = uta.commit('buy 10 AAPL')
    expect(commitResult.prepared).toBe(true)

    const pushResult = await uta.push()
    // Push only returns submitted — never filled
    expect(pushResult.submitted).toHaveLength(1)
    expect(pushResult.rejected).toHaveLength(0)
    expect(pushResult.submitted[0].orderId).toBeDefined()

    // But position already appeared (MockBroker executes internally)
    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].contract.symbol).toBe('AAPL')
    expect(positions[0].quantity.toNumber()).toBe(10)

    // Cash decreased — monetary fields are strings (post Decimal migration).
    const account = await broker.getAccount()
    expect(account.totalCashValue).toBe(String(100_000 - 10 * 150))
  })

  it('market buy fills at push time — no sync needed', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy AAPL')
    const pushResult = await uta.push()

    // Market order fills synchronously — status is 'filled' at push time
    expect(pushResult.submitted[0].status).toBe('filled')

    // Sync has nothing to do (order already resolved)
    const syncResult = await uta.sync()
    expect(syncResult.updatedCount).toBe(0)
  })

  it('getState reflects positions and pending orders', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy AAPL')
    await uta.push()

    // Place a limit order (goes submitted)
    uta.stagePlaceOrder({ aliceId: 'mock-paper|ETH', symbol: 'ETH', action: 'BUY', orderType: 'LMT', totalQuantity: '1', lmtPrice: '1800' })
    uta.commit('limit buy ETH')
    const limitPush = await uta.push()
    expect(limitPush.submitted).toHaveLength(1)

    const state = await uta.getState()
    expect(state.positions).toHaveLength(1)
    expect(state.pendingOrders).toHaveLength(1)
    expect(state.totalCashValue).toBe(String(100_000 - 10 * 150))
  })

  it('limit order → submitted → fill → sync detects filled', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '5', lmtPrice: '145' })
    uta.commit('limit buy AAPL')
    const pushResult = await uta.push()
    expect(pushResult.submitted).toHaveLength(1)

    const orderId = pushResult.submitted[0].orderId!

    // Not filled yet — sync finds no changes (limit order still submitted)
    const sync1 = await uta.sync()
    expect(sync1.updatedCount).toBe(0)

    // Exchange fills the order
    broker.fillPendingOrder(orderId, 144)

    // Sync detects the fill
    const sync2 = await uta.sync()
    expect(sync2.updatedCount).toBe(1)
    expect(sync2.updates[0].currentStatus).toBe('filled')

    // Position appeared
    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toNumber()).toBe(5)
    expect(positions[0].avgCost).toBe('144')
  })

  it('partial close reduces position', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy')
    await uta.push()

    uta.stageClosePosition({ aliceId: 'mock-paper|AAPL', qty: '3' })
    uta.commit('partial close')
    const closeResult = await uta.push()
    expect(closeResult.submitted).toHaveLength(1)

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toNumber()).toBe(7)
  })

  it('full close removes position + restores cash', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy')
    await uta.push()

    uta.stageClosePosition({ aliceId: 'mock-paper|AAPL' })
    uta.commit('close all')
    await uta.push()

    expect(await broker.getPositions()).toHaveLength(0)
    const account = await broker.getAccount()
    expect(account.totalCashValue).toBe('100000')
  })

  it('cancel pending order', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '5', lmtPrice: '140' })
    uta.commit('limit buy')
    const pushResult = await uta.push()
    const orderId = pushResult.submitted[0].orderId!

    uta.stageCancelOrder({ orderId })
    uta.commit('cancel')
    await uta.push()

    const order = await broker.getOrder(orderId)
    expect(order!.orderState.status).toBe('Cancelled')
  })

  it('trading history records all commits', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy AAPL')
    await uta.push()

    uta.stageClosePosition({ aliceId: 'mock-paper|AAPL' })
    uta.commit('close AAPL')
    await uta.push()

    const history = uta.log()
    expect(history).toHaveLength(2)
    expect(history[0].message).toBe('close AAPL')
    expect(history[1].message).toBe('buy AAPL')
  })
})

// ==================== TPSL end-to-end ====================

describe('UTA — TPSL end-to-end', () => {
  it('tpsl params flow through to broker.placeOrder', async () => {
    const spy = vi.spyOn(broker, 'placeOrder')

    uta.stagePlaceOrder({
      aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10',
      takeProfit: { price: '160' },
      stopLoss: { price: '140', limitPrice: '139.50' },
    })
    uta.commit('buy AAPL with TPSL')
    const result = await uta.push()

    expect(result.submitted).toHaveLength(1)
    expect(spy).toHaveBeenCalledTimes(1)

    // Verify tpsl reached the broker (3rd argument)
    const tpslArg = spy.mock.calls[0][2]
    expect(tpslArg).toEqual({
      takeProfit: { price: '160' },
      stopLoss: { price: '140', limitPrice: '139.50' },
    })
  })

  it('order without tpsl passes undefined to broker', async () => {
    const spy = vi.spyOn(broker, 'placeOrder')

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy AAPL no TPSL')
    await uta.push()

    const tpslArg = spy.mock.calls[0][2]
    expect(tpslArg).toBeUndefined()
  })
})

// ==================== Precision end-to-end ====================

describe('UTA — precision end-to-end', () => {
  it('fractional qty survives stage → push → position', async () => {
    broker.setQuote('ETH', 1920)
    uta.stagePlaceOrder({ aliceId: 'mock-paper|ETH', symbol: 'ETH', action: 'BUY', orderType: 'MKT', totalQuantity: '0.123456789' })
    uta.commit('buy fractional ETH')
    const result = await uta.push()

    expect(result.submitted).toHaveLength(1)
    const positions = await broker.getPositions()
    expect(positions[0].quantity.toString()).toBe('0.123456789')
  })

  it('partial close precision: 1.0 - 0.3 = 0.7 exactly', async () => {
    broker.setQuote('ETH', 1920)
    uta.stagePlaceOrder({ aliceId: 'mock-paper|ETH', symbol: 'ETH', action: 'BUY', orderType: 'MKT', totalQuantity: '1.0' })
    uta.commit('buy 1 ETH')
    await uta.push()

    uta.stageClosePosition({ aliceId: 'mock-paper|ETH', qty: '0.3' })
    uta.commit('close 0.3 ETH')
    await uta.push()

    const positions = await broker.getPositions()
    expect(positions[0].quantity.toString()).toBe('0.7')
  })

  it('lmtPrice preserves string-input precision stage → push', async () => {
    broker.setQuote('ETH', 1920)
    uta.stagePlaceOrder({
      aliceId: 'mock-paper|ETH', symbol: 'ETH', action: 'BUY', orderType: 'LMT',
      totalQuantity: '0.12345678', lmtPrice: '0.00001234',
    })
    uta.commit('buy ETH limit precise')
    const result = await uta.push()

    expect(result.submitted).toHaveLength(1)
    const orderId = result.submitted[0].orderId!
    const orders = await broker.getOrders([orderId])
    expect(orders).toHaveLength(1)
    expect(orders[0].order.lmtPrice.toFixed()).toBe('0.00001234')
    expect(orders[0].order.totalQuantity.toFixed()).toBe('0.12345678')
  })

  it('wallet status JSON emits price as string (no IEEE noise)', async () => {
    broker.setQuote('AAPL', 150)
    uta.stagePlaceOrder({
      aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT',
      totalQuantity: '10', lmtPrice: '145.25',
    })
    // Status before commit — staged ops only
    const wire = JSON.parse(JSON.stringify(uta.status()))
    const staged = wire.staged[0]
    expect(typeof staged.order.lmtPrice).toBe('string')
    expect(staged.order.lmtPrice).toBe('145.25')
    expect(typeof staged.order.totalQuantity).toBe('string')
    expect(staged.order.totalQuantity).toBe('10')
  })

  it('clean string input stays clean through the full pipeline', async () => {
    // String input '0.3' bypasses the IEEE 754 trap that `0.1 + 0.2`
    // introduces at the JS-number layer. Decimal preserves the clean value
    // all the way to the broker.
    broker.setQuote('AAPL', 150)
    uta.stagePlaceOrder({
      aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT',
      totalQuantity: '100', lmtPrice: '0.3',
    })
    uta.commit('clean price')
    const result = await uta.push()
    const orderId = result.submitted[0].orderId!
    const orders = await broker.getOrders([orderId])
    expect(orders[0].order.lmtPrice.equals(new Decimal('0.3'))).toBe(true)
    expect(orders[0].order.lmtPrice.toFixed()).toBe('0.3')
  })
})
