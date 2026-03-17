import { describe, it, expect, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Order, OrderState, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import type { UnifiedTradingAccountOptions } from './UnifiedTradingAccount.js'
import { MockBroker, makeContract, makePosition, makeOpenOrder, makePlaceOrderResult } from './__test__/mock-broker.js'
import type { Operation } from './git/types.js'
import './contract-ext.js'

function createUTA(broker?: MockBroker, options?: UnifiedTradingAccountOptions): { uta: UnifiedTradingAccount; broker: MockBroker } {
  const b = broker ?? new MockBroker()
  const uta = new UnifiedTradingAccount(b, options)
  return { uta, broker: b }
}

/** Helper: extract the first staged operation's placeOrder fields */
function getStagedPlaceOrder(uta: UnifiedTradingAccount) {
  const staged = uta.status().staged
  expect(staged).toHaveLength(1)
  const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
  expect(op.action).toBe('placeOrder')
  return { contract: op.contract, order: op.order }
}

// ==================== Operation dispatch (via push) ====================

describe('UTA — operation dispatch', () => {
  let uta: UnifiedTradingAccount
  let broker: MockBroker

  beforeEach(() => {
    ({ uta, broker } = createUTA())
  })

  describe('placeOrder', () => {
    it('calls broker.placeOrder with contract and order', async () => {
      const contract = makeContract({ symbol: 'AAPL' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal(10)
      order.tif = 'DAY'

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('buy AAPL')
      await uta.push()

      expect(broker.placeOrder).toHaveBeenCalledTimes(1)
      const [passedContract, passedOrder] = broker.placeOrder.mock.calls[0]
      expect(passedContract.symbol).toBe('AAPL')
      expect(passedOrder.action).toBe('BUY')
      expect(passedOrder.orderType).toBe('MKT')
      expect(passedOrder.totalQuantity.toNumber()).toBe(10)
    })

    it('passes aliceId and extra contract fields', async () => {
      const contract = makeContract({
        aliceId: 'alpaca-AAPL',
        symbol: 'AAPL',
        secType: 'STK',
        currency: 'USD',
        exchange: 'NASDAQ',
      })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'LMT'
      order.totalQuantity = new Decimal(5)
      order.lmtPrice = 150

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('limit buy AAPL')
      await uta.push()

      const [passedContract, passedOrder] = broker.placeOrder.mock.calls[0]
      expect(passedContract.aliceId).toBe('alpaca-AAPL')
      expect(passedContract.secType).toBe('STK')
      expect(passedContract.currency).toBe('USD')
      expect(passedContract.exchange).toBe('NASDAQ')
      expect(passedOrder.lmtPrice).toBe(150)
    })

    it('returns success result in push', async () => {
      broker.placeOrder.mockResolvedValue(makePlaceOrderResult({
        orderId: 'ord-123',
        execution: { avgPrice: 155, shares: 10, price: 155 } as any,
        orderState: (() => { const os = new OrderState(); os.status = 'Filled'; return os })(),
      }))

      const contract = makeContract({ symbol: 'AAPL' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal(10)

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('buy AAPL')
      const result = await uta.push()

      // Has execution → filled
      expect(result.filled).toHaveLength(1)
      expect(result.filled[0].orderId).toBe('ord-123')
    })

    it('handles broker error', async () => {
      broker.placeOrder.mockResolvedValue({ success: false, error: 'Insufficient funds' })

      const contract = makeContract({ symbol: 'AAPL' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal(10)

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('buy AAPL')
      const result = await uta.push()

      expect(result.rejected).toHaveLength(1)
    })
  })

  describe('closePosition', () => {
    it('calls broker.closePosition with contract and qty', async () => {
      const contract = makeContract({ symbol: 'AAPL' })
      uta.git.add({ action: 'closePosition', contract, quantity: new Decimal(5) })
      uta.git.commit('partial close AAPL')
      await uta.push()

      expect(broker.closePosition).toHaveBeenCalledTimes(1)
      const [passedContract, qty] = broker.closePosition.mock.calls[0]
      expect(passedContract.symbol).toBe('AAPL')
      expect(qty!.toNumber()).toBe(5)
    })

    it('passes undefined qty for full close', async () => {
      const contract = makeContract({ symbol: 'AAPL' })
      uta.git.add({ action: 'closePosition', contract })
      uta.git.commit('close AAPL')
      await uta.push()

      const [, qty] = broker.closePosition.mock.calls[0]
      expect(qty).toBeUndefined()
    })
  })

  describe('cancelOrder', () => {
    it('calls broker.cancelOrder', async () => {
      uta.git.add({ action: 'cancelOrder', orderId: 'ord-789' })
      uta.git.commit('cancel order')
      await uta.push()

      expect(broker.cancelOrder).toHaveBeenCalledWith('ord-789', undefined)
    })
  })

  describe('modifyOrder', () => {
    it('calls broker.modifyOrder with orderId and changes', async () => {
      const changes: Partial<Order> = { lmtPrice: 155, totalQuantity: new Decimal(20) } as any
      uta.git.add({ action: 'modifyOrder', orderId: 'ord-123', changes })
      uta.git.commit('modify order')
      await uta.push()

      expect(broker.modifyOrder).toHaveBeenCalledTimes(1)
      const [orderId, passedChanges] = broker.modifyOrder.mock.calls[0]
      expect(orderId).toBe('ord-123')
      expect(passedChanges.lmtPrice).toBe(155)
    })
  })
})

// ==================== State bridge (via getState) ====================

describe('UTA — getState', () => {
  let uta: UnifiedTradingAccount
  let broker: MockBroker

  beforeEach(() => {
    ({ uta, broker } = createUTA())
  })

  it('assembles GitState from broker data', async () => {
    broker.setAccountInfo({ totalCashValue: 50_000, netLiquidation: 55_000, unrealizedPnL: 3_000, realizedPnL: 800 })
    broker.setPositions([makePosition()])

    const filledState = new OrderState()
    filledState.status = 'Filled'
    const submittedState = new OrderState()
    submittedState.status = 'Submitted'
    const cancelledState = new OrderState()
    cancelledState.status = 'Cancelled'

    broker.setOrders([
      makeOpenOrder({ orderState: filledState }),
      makeOpenOrder({ orderState: submittedState }),
      makeOpenOrder({ orderState: cancelledState }),
    ])

    const state = await uta.getState()

    expect(state.totalCashValue).toBe(50_000)
    expect(state.netLiquidation).toBe(55_000)
    expect(state.unrealizedPnL).toBe(3_000)
    expect(state.realizedPnL).toBe(800)
    expect(state.positions).toHaveLength(1)
    // Only Submitted/PreSubmitted orders are pending
    expect(state.pendingOrders).toHaveLength(1)
    expect(state.pendingOrders[0].orderState.status).toBe('Submitted')
  })

  it('calls all three broker methods', async () => {
    await uta.getState()

    expect(broker.getAccount).toHaveBeenCalledTimes(1)
    expect(broker.getPositions).toHaveBeenCalledTimes(1)
    expect(broker.getOrders).toHaveBeenCalledTimes(1)
  })

  it('returns empty pendingOrders when no orders are pending', async () => {
    const filledState = new OrderState()
    filledState.status = 'Filled'
    const cancelledState = new OrderState()
    cancelledState.status = 'Cancelled'

    broker.setOrders([
      makeOpenOrder({ orderState: filledState }),
      makeOpenOrder({ orderState: cancelledState }),
    ])

    const state = await uta.getState()

    expect(state.pendingOrders).toHaveLength(0)
  })
})

// ==================== stagePlaceOrder ====================

describe('UTA — stagePlaceOrder', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('maps buy side to BUY action', () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'market', qty: 10 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.action).toBe('BUY')
  })

  it('maps sell side to SELL action', () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'sell', type: 'market', qty: 10 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.action).toBe('SELL')
  })

  it('maps order types correctly', () => {
    const cases: Array<[string, string]> = [
      ['market', 'MKT'],
      ['limit', 'LMT'],
      ['stop', 'STP'],
      ['stop_limit', 'STP LMT'],
      ['trailing_stop', 'TRAIL'],
    ]
    for (const [input, expected] of cases) {
      const { uta: u } = createUTA()
      u.stagePlaceOrder({ aliceId: 'a-X', side: 'buy', type: input, qty: 1 })
      const { order } = getStagedPlaceOrder(u)
      expect(order.orderType).toBe(expected)
    }
  })

  it('maps qty to totalQuantity as Decimal', () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'market', qty: 42 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.totalQuantity).toBeInstanceOf(Decimal)
    expect(order.totalQuantity.toNumber()).toBe(42)
  })

  it('maps notional to cashQty', () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'market', notional: 5000 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.cashQty).toBe(5000)
  })

  it('maps price to lmtPrice and stopPrice to auxPrice', () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'stop_limit', qty: 10, price: 150, stopPrice: 145 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.lmtPrice).toBe(150)
    expect(order.auxPrice).toBe(145)
  })

  it('defaults timeInForce to DAY', () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'market', qty: 10 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.tif).toBe('DAY')
  })

  it('allows overriding timeInForce', () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'limit', qty: 10, price: 150, timeInForce: 'gtc' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.tif).toBe('GTC')
  })

  it('maps extendedHours to outsideRth', () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'limit', qty: 10, price: 150, extendedHours: true })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.outsideRth).toBe(true)
  })

  it('sets aliceId and symbol on contract', () => {
    uta.stagePlaceOrder({ aliceId: 'alpaca-AAPL', symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 })
    const { contract } = getStagedPlaceOrder(uta)
    expect(contract.aliceId).toBe('alpaca-AAPL')
    expect(contract.symbol).toBe('AAPL')
  })
})

// ==================== stageModifyOrder ====================

describe('UTA — stageModifyOrder', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('maps provided fields to Partial<Order>', () => {
    uta.stageModifyOrder({ orderId: 'ord-1', qty: 20, price: 155, type: 'limit', timeInForce: 'gtc' })
    const staged = uta.status().staged
    expect(staged).toHaveLength(1)
    const op = staged[0] as Extract<Operation, { action: 'modifyOrder' }>
    expect(op.action).toBe('modifyOrder')
    expect(op.orderId).toBe('ord-1')
    expect(op.changes.totalQuantity).toBeInstanceOf(Decimal)
    expect(op.changes.totalQuantity!.toNumber()).toBe(20)
    expect(op.changes.lmtPrice).toBe(155)
    expect(op.changes.orderType).toBe('LMT')
    expect(op.changes.tif).toBe('GTC')
  })

  it('omits fields not provided', () => {
    uta.stageModifyOrder({ orderId: 'ord-1', price: 160 })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'modifyOrder' }>
    expect(op.changes.lmtPrice).toBe(160)
    expect(op.changes.totalQuantity).toBeUndefined()
    expect(op.changes.orderType).toBeUndefined()
    expect(op.changes.tif).toBeUndefined()
  })
})

// ==================== stageClosePosition ====================

describe('UTA — stageClosePosition', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('stages with Decimal quantity when qty provided', () => {
    uta.stageClosePosition({ aliceId: 'a-AAPL', qty: 5 })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'closePosition' }>
    expect(op.action).toBe('closePosition')
    expect(op.contract.aliceId).toBe('a-AAPL')
    expect(op.quantity).toBeInstanceOf(Decimal)
    expect(op.quantity!.toNumber()).toBe(5)
  })

  it('stages with undefined quantity for full close', () => {
    uta.stageClosePosition({ aliceId: 'a-AAPL' })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'closePosition' }>
    expect(op.quantity).toBeUndefined()
  })
})

// ==================== stageCancelOrder ====================

describe('UTA — stageCancelOrder', () => {
  it('stages cancelOrder with orderId', () => {
    const { uta } = createUTA()
    uta.stageCancelOrder({ orderId: 'ord-999' })
    const staged = uta.status().staged
    expect(staged).toHaveLength(1)
    const op = staged[0] as Extract<Operation, { action: 'cancelOrder' }>
    expect(op.action).toBe('cancelOrder')
    expect(op.orderId).toBe('ord-999')
  })
})

// ==================== git flow edge cases ====================

describe('UTA — git flow', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('commit throws when staging area is empty', () => {
    expect(() => uta.commit('empty')).toThrow('staging area is empty')
  })

  it('push throws when not committed', async () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'market', qty: 10 })
    await expect(uta.push()).rejects.toThrow('please commit first')
  })

  it('executes multiple operations in a single push', async () => {
    const { uta: u, broker: b } = createUTA()
    u.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'market', qty: 10 })
    u.stagePlaceOrder({ aliceId: 'a-MSFT', symbol: 'MSFT', side: 'buy', type: 'market', qty: 5 })
    u.commit('buy both')
    await u.push()

    expect(b.placeOrder).toHaveBeenCalledTimes(2)
  })

  it('clears staging area after push', async () => {
    uta.stagePlaceOrder({ aliceId: 'a-AAPL', side: 'buy', type: 'market', qty: 10 })
    uta.commit('buy')
    await uta.push()

    expect(uta.status().staged).toHaveLength(0)
  })
})

// ==================== sync ====================

describe('UTA — sync', () => {
  it('returns updatedCount: 0 when no pending orders', async () => {
    const { uta } = createUTA()
    const result = await uta.sync()
    expect(result.updatedCount).toBe(0)
  })

  it('detects pending order becoming filled', async () => {
    const { uta, broker } = createUTA()

    // Push a placeOrder that returns pending (orderId but no execution)
    const pendingState = new OrderState()
    pendingState.status = 'Submitted'
    broker.placeOrder.mockResolvedValue(makePlaceOrderResult({
      orderId: 'ord-100',
      orderState: pendingState,
    }))

    uta.stagePlaceOrder({ aliceId: 'a-AAPL', symbol: 'AAPL', side: 'buy', type: 'limit', qty: 10, price: 150 })
    uta.commit('limit buy')
    await uta.push()

    // Now mock broker returning the order as Filled
    // sync matches String(order.orderId) === pendingOrderId
    const filledState = new OrderState()
    filledState.status = 'Filled'
    const filledOrder = new Order()
    // PlaceOrderResult.orderId was 'ord-100', sync does String(order.orderId) comparison
    ;(filledOrder as any).orderId = 'ord-100'
    broker.setOrders([makeOpenOrder({ contract: makeContract({ symbol: 'AAPL' }), order: filledOrder, orderState: filledState })])

    const result = await uta.sync()
    expect(result.updatedCount).toBe(1)
    expect(result.updates[0].orderId).toBe('ord-100')
    expect(result.updates[0].currentStatus).toBe('filled')
  })

  it('does not update when pending order not found in broker', async () => {
    const { uta, broker } = createUTA()

    const pendingState = new OrderState()
    pendingState.status = 'Submitted'
    broker.placeOrder.mockResolvedValue(makePlaceOrderResult({
      orderId: 'ord-200',
      orderState: pendingState,
    }))

    uta.stagePlaceOrder({ aliceId: 'a-AAPL', symbol: 'AAPL', side: 'buy', type: 'limit', qty: 10, price: 150 })
    uta.commit('limit buy')
    await uta.push()

    // Broker returns empty orders — the pending order is not found
    broker.setOrders([])
    const result = await uta.sync()
    expect(result.updatedCount).toBe(0)
  })
})

// ==================== guards ====================

describe('UTA — guards', () => {
  it('rejects operation when guard blocks it', async () => {
    const { uta, broker } = createUTA(undefined, {
      guards: [{ type: 'symbol-whitelist', options: { symbols: ['AAPL'] } }],
    })

    uta.stagePlaceOrder({ aliceId: 'a-TSLA', symbol: 'TSLA', side: 'buy', type: 'market', qty: 10 })
    uta.commit('buy TSLA (should be blocked)')
    const result = await uta.push()

    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].error).toContain('guard')
    expect(broker.placeOrder).not.toHaveBeenCalled()
  })

  it('allows operation when guard passes', async () => {
    const { uta, broker } = createUTA(undefined, {
      guards: [{ type: 'symbol-whitelist', options: { symbols: ['AAPL'] } }],
    })

    uta.stagePlaceOrder({ aliceId: 'a-AAPL', symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 })
    uta.commit('buy AAPL (allowed)')
    await uta.push()

    expect(broker.placeOrder).toHaveBeenCalledTimes(1)
  })
})

// ==================== constructor — savedState ====================

describe('UTA — constructor', () => {
  it('restores from savedState', async () => {
    // Create a UTA, push a commit, export state
    const { uta: original } = createUTA()
    original.stagePlaceOrder({ aliceId: 'a-AAPL', symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 })
    original.commit('initial buy')
    await original.push()

    const savedState = original.exportGitState()
    expect(original.log()).toHaveLength(1)

    // Create new UTA from saved state
    const { uta: restored } = createUTA(undefined, { savedState })
    expect(restored.log()).toHaveLength(1)
    expect(restored.log()[0].message).toBe('initial buy')
  })
})
