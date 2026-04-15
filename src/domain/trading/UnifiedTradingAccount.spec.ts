import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Order, OrderState, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import type { UnifiedTradingAccountOptions } from './UnifiedTradingAccount.js'
import { MockBroker, makeContract, makePosition, makeOpenOrder } from './brokers/mock/index.js'
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
      const spy = vi.spyOn(broker, 'placeOrder')
      const contract = makeContract({ symbol: 'AAPL' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal(10)
      order.tif = 'DAY'

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('buy AAPL')
      await uta.push()

      expect(spy).toHaveBeenCalledTimes(1)
      const [passedContract, passedOrder] = spy.mock.calls[0]
      expect(passedContract.symbol).toBe('AAPL')
      expect(passedOrder.action).toBe('BUY')
      expect(passedOrder.orderType).toBe('MKT')
      expect(passedOrder.totalQuantity.toNumber()).toBe(10)
    })

    it('passes aliceId and extra contract fields', async () => {
      const spy = vi.spyOn(broker, 'placeOrder')
      const contract = makeContract({
        aliceId: 'mock-paper|AAPL',
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

      const [passedContract, passedOrder] = spy.mock.calls[0]
      expect(passedContract.aliceId).toBe('mock-paper|AAPL')
      expect(passedContract.secType).toBe('STK')
      expect(passedContract.currency).toBe('USD')
      expect(passedContract.exchange).toBe('NASDAQ')
      expect(passedOrder.lmtPrice).toBe(150)
    })

    it('returns submitted result in push (fill confirmed via sync)', async () => {
      const contract = makeContract({ symbol: 'AAPL' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal(10)

      uta.git.add({ action: 'placeOrder', contract, order })
      uta.git.commit('buy AAPL')
      const result = await uta.push()

      expect(result.submitted).toHaveLength(1)
      expect(result.submitted[0].orderId).toBeDefined()
      expect(result.submitted[0].status).toBe('filled')
    })

    it('handles broker error', async () => {
      vi.spyOn(broker, 'placeOrder').mockResolvedValue({ success: false, error: 'Insufficient funds' })

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
      const spy = vi.spyOn(broker, 'closePosition')
      const contract = makeContract({ symbol: 'AAPL' })
      uta.git.add({ action: 'closePosition', contract, quantity: new Decimal(5) })
      uta.git.commit('partial close AAPL')
      await uta.push()

      expect(spy).toHaveBeenCalledTimes(1)
      const [passedContract, qty] = spy.mock.calls[0]
      expect(passedContract.symbol).toBe('AAPL')
      expect(qty!.toNumber()).toBe(5)
    })

    it('passes undefined qty for full close', async () => {
      const spy = vi.spyOn(broker, 'closePosition')
      const contract = makeContract({ symbol: 'AAPL' })
      uta.git.add({ action: 'closePosition', contract })
      uta.git.commit('close AAPL')
      await uta.push()

      const [, qty] = spy.mock.calls[0]
      expect(qty).toBeUndefined()
    })
  })

  describe('cancelOrder', () => {
    it('calls broker.cancelOrder and records as cancelled', async () => {
      const orderState = new OrderState()
      orderState.status = 'Cancelled'
      const spy = vi.spyOn(broker, 'cancelOrder').mockResolvedValue({
        success: true, orderId: 'ord-789', orderState,
      })
      uta.git.add({ action: 'cancelOrder', orderId: 'ord-789' })
      uta.git.commit('cancel order')
      const result = await uta.push()

      expect(spy).toHaveBeenCalledWith('ord-789', undefined)
      expect(result.submitted).toHaveLength(1)
      expect(result.submitted[0].status).toBe('cancelled')
      expect(result.rejected).toHaveLength(0)
    })
  })

  describe('modifyOrder', () => {
    it('calls broker.modifyOrder with orderId and changes', async () => {
      const spy = vi.spyOn(broker, 'modifyOrder')
      const changes: Partial<Order> = { lmtPrice: 155, totalQuantity: new Decimal(20) } as any
      uta.git.add({ action: 'modifyOrder', orderId: 'ord-123', changes })
      uta.git.commit('modify order')
      await uta.push()

      expect(spy).toHaveBeenCalledTimes(1)
      const [orderId, passedChanges] = spy.mock.calls[0]
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
    broker.setAccountInfo({ totalCashValue: '50000', netLiquidation: '55000', unrealizedPnL: '3000', realizedPnL: '800' })
    broker.setPositions([makePosition()])

    // Push a limit order to create a pending entry in git history
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: 5, lmtPrice: 145 })
    uta.commit('limit buy')
    await uta.push()

    const state = await uta.getState()

    expect(state.totalCashValue).toBe('50000')
    expect(state.netLiquidation).toBe('55000')
    expect(state.unrealizedPnL).toBe('3000')
    expect(state.realizedPnL).toBe('800')
    expect(state.positions).toHaveLength(1)
    // Limit order is pending (Submitted) — found via getOrders([pendingId])
    expect(state.pendingOrders).toHaveLength(1)
    expect(state.pendingOrders[0].orderState.status).toBe('Submitted')
  })

  it('calls all three broker methods', async () => {
    const spyAccount = vi.spyOn(broker, 'getAccount')
    const spyPositions = vi.spyOn(broker, 'getPositions')
    const spyOrders = vi.spyOn(broker, 'getOrders')
    await uta.getState()

    expect(spyAccount).toHaveBeenCalledTimes(1)
    expect(spyPositions).toHaveBeenCalledTimes(1)
    expect(spyOrders).toHaveBeenCalledTimes(1)
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

  it('sets BUY action', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.action).toBe('BUY')
  })

  it('sets SELL action', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'SELL', orderType: 'MKT', totalQuantity: 10 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.action).toBe('SELL')
  })

  it('passes order types through', () => {
    const types = ['MKT', 'LMT', 'STP', 'STP LMT', 'TRAIL']
    for (const orderType of types) {
      const { uta: u } = createUTA()
      u.stagePlaceOrder({ aliceId: 'mock-paper|X', action: 'BUY', orderType, totalQuantity: 1 })
      const { order } = getStagedPlaceOrder(u)
      expect(order.orderType).toBe(orderType)
    }
  })

  it('sets totalQuantity as Decimal', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 42 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.totalQuantity).toBeInstanceOf(Decimal)
    expect(order.totalQuantity.toNumber()).toBe(42)
  })

  it('sets cashQty', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', cashQty: 5000 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.cashQty).toBe(5000)
  })

  it('sets lmtPrice and auxPrice', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'STP LMT', totalQuantity: 10, lmtPrice: 150, auxPrice: 145 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.lmtPrice).toBe(150)
    expect(order.auxPrice).toBe(145)
  })

  it('auxPrice sets trailing offset for TRAIL orders', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'SELL', orderType: 'TRAIL', totalQuantity: 10, auxPrice: 5 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.auxPrice).toBe(5)
    expect(order.orderType).toBe('TRAIL')
  })

  it('TRAIL order with trailStopPrice and auxPrice', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'SELL', orderType: 'TRAIL', totalQuantity: 10, trailStopPrice: 145, auxPrice: 5 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.trailStopPrice).toBe(145)
    expect(order.auxPrice).toBe(5)
  })

  it('sets trailingPercent', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'SELL', orderType: 'TRAIL', totalQuantity: 10, trailingPercent: 2.5 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.trailingPercent).toBe(2.5)
  })

  it('defaults tif to DAY', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.tif).toBe('DAY')
  })

  it('allows overriding tif', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: 10, lmtPrice: 150, tif: 'GTC' })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.tif).toBe('GTC')
  })

  it('sets outsideRth', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: 10, lmtPrice: 150, outsideRth: true })
    const { order } = getStagedPlaceOrder(uta)
    expect(order.outsideRth).toBe(true)
  })

  it('sets aliceId and symbol on contract', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
    const { contract } = getStagedPlaceOrder(uta)
    expect(contract.aliceId).toBe('mock-paper|AAPL')
    expect(contract.symbol).toBe('AAPL')
  })

  it('sets tpsl with takeProfit only', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10, takeProfit: { price: '160' } })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
    expect(op.tpsl).toEqual({ takeProfit: { price: '160' }, stopLoss: undefined })
  })

  it('sets tpsl with stopLoss only', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10, stopLoss: { price: '140' } })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
    expect(op.tpsl).toEqual({ takeProfit: undefined, stopLoss: { price: '140' } })
  })

  it('sets tpsl with both TP and SL', () => {
    uta.stagePlaceOrder({
      aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10,
      takeProfit: { price: '160' }, stopLoss: { price: '140', limitPrice: '139.50' },
    })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
    expect(op.tpsl).toEqual({
      takeProfit: { price: '160' },
      stopLoss: { price: '140', limitPrice: '139.50' },
    })
  })

  it('omits tpsl when neither TP nor SL provided', () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'placeOrder' }>
    expect(op.tpsl).toBeUndefined()
  })
})

// ==================== stageModifyOrder ====================

describe('UTA — stageModifyOrder', () => {
  let uta: UnifiedTradingAccount

  beforeEach(() => {
    ({ uta } = createUTA())
  })

  it('sets provided fields on Partial<Order>', () => {
    uta.stageModifyOrder({ orderId: 'ord-1', totalQuantity: 20, lmtPrice: 155, orderType: 'LMT', tif: 'GTC' })
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
    uta.stageModifyOrder({ orderId: 'ord-1', lmtPrice: 160 })
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
    uta.stageClosePosition({ aliceId: 'mock-paper|AAPL', qty: 5 })
    const staged = uta.status().staged
    const op = staged[0] as Extract<Operation, { action: 'closePosition' }>
    expect(op.action).toBe('closePosition')
    expect(op.contract.aliceId).toBe('mock-paper|AAPL')
    expect(op.quantity).toBeInstanceOf(Decimal)
    expect(op.quantity!.toNumber()).toBe(5)
  })

  it('stages with undefined quantity for full close', () => {
    uta.stageClosePosition({ aliceId: 'mock-paper|AAPL' })
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
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
    await expect(uta.push()).rejects.toThrow('please commit first')
  })

  it('executes multiple operations in a single push', async () => {
    const { uta: u, broker: b } = createUTA()
    const spy = vi.spyOn(b, 'placeOrder')
    u.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
    u.stagePlaceOrder({ aliceId: 'mock-paper|MSFT', symbol: 'MSFT', action: 'BUY', orderType: 'MKT', totalQuantity: 5 })
    u.commit('buy both')
    await u.push()

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('clears staging area after push', async () => {
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
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

    // Limit order → MockBroker keeps it pending naturally
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: 10, lmtPrice: 150 })
    uta.commit('limit buy')
    const pushResult = await uta.push()
    const orderId = pushResult.submitted[0]?.orderId
    expect(orderId).toBeDefined()

    // Simulate fill via test helper
    broker.fillPendingOrder(orderId!, 149)

    const result = await uta.sync()
    expect(result.updatedCount).toBe(1)
    expect(result.updates[0].orderId).toBe(orderId)
    expect(result.updates[0].currentStatus).toBe('filled')
  })

  it('does not update when pending order not found in broker', async () => {
    const { uta, broker } = createUTA()

    // Limit order → pending
    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: 10, lmtPrice: 150 })
    uta.commit('limit buy')
    const pushResult = await uta.push()
    const orderId = pushResult.submitted[0]?.orderId
    expect(orderId).toBeDefined()

    // Clear all orders — simulates order vanishing from exchange
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
    const spy = vi.spyOn(broker, 'placeOrder')

    uta.stagePlaceOrder({ aliceId: 'mock-paper|TSLA', symbol: 'TSLA', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
    uta.commit('buy TSLA (should be blocked)')
    const result = await uta.push()

    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].error).toContain('guard')
    expect(spy).not.toHaveBeenCalled()
  })

  it('allows operation when guard passes', async () => {
    const { uta, broker } = createUTA(undefined, {
      guards: [{ type: 'symbol-whitelist', options: { symbols: ['AAPL'] } }],
    })
    const spy = vi.spyOn(broker, 'placeOrder')

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
    uta.commit('buy AAPL (allowed)')
    await uta.push()

    expect(spy).toHaveBeenCalledTimes(1)
  })
})

// ==================== constructor — savedState ====================

describe('UTA — constructor', () => {
  it('restores from savedState', async () => {
    // Create a UTA, push a commit, export state
    const { uta: original } = createUTA()
    original.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
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

// ==================== health tracking ====================

describe('UTA — health tracking', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /** Let _connect() (fire-and-forget from constructor) complete via microtask flush. */
  async function flush() { await vi.advanceTimersByTimeAsync(0) }

  it('connects automatically on construction and becomes healthy', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().lastSuccessAt).toBeInstanceOf(Date)
  })

  it('goes offline and starts recovery when initial connect fails', async () => {
    const broker = new MockBroker()
    broker.setFailMode(100) // init + getAccount will fail
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.health).toBe('offline')
    expect(uta.getHealthInfo().recovering).toBe(true)
    await uta.close()
  })

  it('auto-recovers after initial connect failure when broker comes back', async () => {
    const broker = new MockBroker()
    // _connect calls init() which fails (consumes 1). Recovery at 5s: init() + getAccount() succeed.
    broker.setFailMode(1)
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.health).toBe('offline')

    // Advance to trigger first recovery attempt — broker is back (failMode exhausted)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().recovering).toBe(false)
  })

  it('transitions healthy → degraded after 3 consecutive failures', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(3)

    for (let i = 0; i < 3; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('degraded')
  })

  it('transitions degraded → offline after 6 consecutive failures', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(6)

    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('offline')
    await uta.close()
  })

  it('resets to healthy on any successful call', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(4)

    for (let i = 0; i < 4; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('degraded')

    // Next call succeeds (failMode exhausted)
    await uta.getAccount()
    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().consecutiveFailures).toBe(0)
  })

  it('fails fast when offline and recovering', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(100)

    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('offline')
    expect(uta.getHealthInfo().recovering).toBe(true)

    // Subsequent calls fail fast with offline message
    await expect(uta.getAccount()).rejects.toThrow(/offline and reconnecting/)
    await uta.close()
  })

  it('push() throws when offline', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(100)

    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: 10 })
    uta.commit('buy AAPL')
    await expect(uta.push()).rejects.toThrow(/offline/)
    await uta.close()
  })

  it('auto-recovery restores healthy after runtime disconnect', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    expect(uta.health).toBe('healthy')

    // Go offline via runtime failures
    broker.setFailMode(6)
    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('offline')
    expect(uta.getHealthInfo().recovering).toBe(true)

    // Broker is back (failMode exhausted) — advance timer to trigger recovery
    await vi.advanceTimersByTimeAsync(5_000)

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().recovering).toBe(false)
  })

  it('close() cancels recovery timer', async () => {
    const broker = new MockBroker()
    broker.setFailMode(100)
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.getHealthInfo().recovering).toBe(true)
    await uta.close()
    expect(uta.getHealthInfo().recovering).toBe(false)
  })

  it('getHealthInfo returns full snapshot', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()

    const info = uta.getHealthInfo()
    expect(info.status).toBe('healthy')
    expect(info.consecutiveFailures).toBe(0)
    expect(info.lastSuccessAt).toBeInstanceOf(Date)
    expect(info.recovering).toBe(false)
  })

  it('tracks health across different broker methods', async () => {
    const broker = new MockBroker()
    const { uta } = createUTA(broker)
    await flush()
    broker.setFailMode(2)

    await expect(uta.getAccount()).rejects.toThrow()
    await expect(uta.getPositions()).rejects.toThrow()
    expect(uta.getHealthInfo().consecutiveFailures).toBe(2)

    // Success on a different method resets
    await uta.getMarketClock()
    expect(uta.health).toBe('healthy')
  })
})
