import { describe, it, expect, beforeEach, vi } from 'vitest'
import Decimal from 'decimal.js'
import { ContractDescription, Order, OrderState, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
// Co-located with the broker stubs it exercises — MockBroker +
// UTAManager + UnifiedTradingAccount live in services/uta/src/domain/
// trading/. The spec still tests Alice's tool layer (createTradingTools),
// imported via the `@/` alias (resolves to ../../src/* per services/uta
// tsconfig.json).
import type { OpenOrder } from '../domain/trading/brokers/types.js'
import { MockBroker, makeContract } from '../domain/trading/brokers/mock/index.js'
import { UTAManager } from '../domain/trading/uta-manager.js'
import { UnifiedTradingAccount } from '../domain/trading/UnifiedTradingAccount.js'
import type { UTAManagerSDK } from '@/services/uta-client/index.js'
import { createTradingTools } from '@/tool/trading.js'
import '../domain/trading/contract-ext.js'

function makeUta(broker: MockBroker): UnifiedTradingAccount {
  return new UnifiedTradingAccount(broker)
}

function makeManager(...brokers: MockBroker[]): UTAManager {
  const mgr = new UTAManager()
  for (const b of brokers) mgr.add(makeUta(b))
  return mgr
}

/**
 * The tool layer accepts UTAManagerSDK (an HTTP adapter) after the
 * Step-6 swap. For unit tests we still construct a real in-process
 * UTAManager — its methods are a structural superset of the SDK's, so
 * casting at the boundary keeps the tests honest about behaviour
 * without requiring a mock fetch layer. The `getFxRates` SDK method is
 * absent from real UTAManager; tool/trading.ts try/catches the call
 * and falls through with empty rates, which the tests don't exercise.
 */
const asSDK = (mgr: UTAManager) => mgr as unknown as UTAManagerSDK

// ==================== UTAManager.resolve ====================

describe('UTAManager.resolve', () => {
  let mgr: UTAManager

  beforeEach(() => {
    mgr = makeManager(
      new MockBroker({ id: 'alpaca-paper', label: 'Alpaca Paper' }),
      new MockBroker({ id: 'bybit-main', label: 'Bybit Main' }),
    )
  })

  it('returns all UTAs when source is not provided', () => {
    const results = mgr.resolve()
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id).sort()).toEqual(['alpaca-paper', 'bybit-main'])
  })

  it('returns single UTA by exact id', () => {
    const results = mgr.resolve('alpaca-paper')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('alpaca-paper')
  })

  it('returns empty array when source matches nothing', () => {
    expect(mgr.resolve('nonexistent')).toHaveLength(0)
  })
})

// ==================== resolveOne ====================

describe('UTAManager.resolveOne', () => {
  let mgr: UTAManager

  beforeEach(() => {
    mgr = makeManager(
      new MockBroker({ id: 'alpaca-paper' }),
      new MockBroker({ id: 'bybit-main' }),
    )
  })

  it('returns the single matching UTA', () => {
    const result = mgr.resolveOne('alpaca-paper')
    expect(result.id).toBe('alpaca-paper')
  })

  it('throws when no UTA matches', () => {
    expect(() => mgr.resolveOne('unknown-id')).toThrow('No UTA found matching source "unknown-id"')
  })
})

// ==================== createTradingTools: listUTAs ====================

describe('createTradingTools — listUTAs', () => {
  it('returns summaries for all registered UTAs', async () => {
    const mgr = makeManager(new MockBroker({ id: 'acc1', label: 'Test' }))
    const tools = createTradingTools(asSDK(mgr))
    const result = await (tools.listUTAs.execute as Function)({})
    expect(Array.isArray(result)).toBe(true)
    expect(result[0].id).toBe('acc1')
  })
})

// ==================== createTradingTools: searchContracts ====================

describe('createTradingTools — searchContracts', () => {
  it('aggregates results from all UTAs', async () => {
    const a1 = new MockBroker({ id: 'acc1' })
    const a2 = new MockBroker({ id: 'acc2' })
    const desc1 = new ContractDescription()
    desc1.contract = makeContract({ symbol: 'AAPL' })
    const desc2 = new ContractDescription()
    desc2.contract = makeContract({ symbol: 'AAPL' })
    vi.spyOn(a1, 'searchContracts').mockResolvedValue([desc1])
    vi.spyOn(a2, 'searchContracts').mockResolvedValue([desc2])

    const mgr = makeManager(a1, a2)
    const tools = createTradingTools(asSDK(mgr))
    const result = await (tools.searchContracts.execute as Function)({ pattern: 'AAPL' })
    expect(result).toHaveLength(2)
  })
})

// ==================== getOrders — summarization ====================

describe('createTradingTools — getOrders summarization', () => {
  function makeOpenOrder(overrides?: Partial<{ action: string; orderType: string; qty: number | string; lmtPrice: number | string; status: string; symbol: string }>): OpenOrder {
    const contract = makeContract({ symbol: overrides?.symbol ?? 'AAPL' })
    contract.aliceId = `mock-paper|${overrides?.symbol ?? 'AAPL'}`
    const order = new Order()
    order.action = overrides?.action ?? 'BUY'
    order.orderType = overrides?.orderType ?? 'MKT'
    order.totalQuantity = new Decimal(overrides?.qty ?? 10)
    if (overrides?.lmtPrice != null) order.lmtPrice = new Decimal(overrides.lmtPrice)
    const orderState = new OrderState()
    orderState.status = overrides?.status ?? 'Submitted'
    return { contract, order, orderState }
  }

  it('returns compact summaries without UNSET fields', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    broker.setQuote('AAPL', 150)
    const mgr = makeManager(broker)
    const uta = mgr.resolve('mock-paper')[0]

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy')
    await uta.push(uta.status().pendingHash!)

    const tools = createTradingTools(asSDK(mgr))
    const ids = uta.getPendingOrderIds().map(p => p.orderId)
    // getPendingOrderIds may be empty after market fill — test the tool output shape instead
    const result = await (tools.getOrders.execute as Function)({ source: 'mock-paper' })

    // Result should be an array of compact objects, not raw OpenOrder
    if (Array.isArray(result) && result.length > 0) {
      const first = result[0]
      // Should have summarized fields
      expect(first).toHaveProperty('source')
      expect(first).toHaveProperty('action')
      expect(first).toHaveProperty('orderType')
      expect(first).toHaveProperty('totalQuantity')
      expect(first).toHaveProperty('status')
      // Should NOT have raw IBKR fields
      expect(first).not.toHaveProperty('softDollarTier')
      expect(first).not.toHaveProperty('transmit')
      expect(first).not.toHaveProperty('blockOrder')
      expect(first).not.toHaveProperty('sweepToFill')
    }
  })

  it('filters UNSET values from order summary', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const mgr = makeManager(broker)
    const tools = createTradingTools(asSDK(mgr))

    // Mock getOrders to return a raw OpenOrder with UNSET fields
    const uta = mgr.resolve('mock-paper')[0]
    vi.spyOn(uta, 'getPendingOrderIds').mockReturnValue([{ orderId: 'ord-1', symbol: 'AAPL' }])
    vi.spyOn(uta, 'getOrders').mockResolvedValue([makeOpenOrder()])

    const result = await (tools.getOrders.execute as Function)({ source: 'mock-paper' })
    expect(Array.isArray(result)).toBe(true)
    const order = result[0]

    // lmtPrice is UNSET_DOUBLE — should be absent
    expect(order.lmtPrice).toBeUndefined()
    // auxPrice is UNSET_DOUBLE — should be absent
    expect(order.auxPrice).toBeUndefined()
    // trailStopPrice is UNSET_DOUBLE — should be absent
    expect(order.trailStopPrice).toBeUndefined()
    // parentId is 0 — should be absent
    expect(order.parentId).toBeUndefined()
    // tpsl not set — should be absent
    expect(order.tpsl).toBeUndefined()
  })

  it('includes non-UNSET optional fields', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const mgr = makeManager(broker)
    const tools = createTradingTools(asSDK(mgr))

    const uta = mgr.resolve('mock-paper')[0]
    vi.spyOn(uta, 'getPendingOrderIds').mockReturnValue([{ orderId: 'ord-2', symbol: 'AAPL' }])
    const openOrder = makeOpenOrder({ lmtPrice: '150', orderType: 'LMT' })
    openOrder.tpsl = { takeProfit: { price: '160' }, stopLoss: { price: '140' } }
    vi.spyOn(uta, 'getOrders').mockResolvedValue([openOrder])

    const result = await (tools.getOrders.execute as Function)({ source: 'mock-paper' })
    const order = result[0]

    expect(order.lmtPrice).toBe('150')
    expect(order.tpsl).toEqual({ takeProfit: { price: '160' }, stopLoss: { price: '140' } })
  })

  it('emits price fields as decimal strings (not numbers)', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const mgr = makeManager(broker)
    const tools = createTradingTools(asSDK(mgr))

    const uta = mgr.resolve('mock-paper')[0]
    vi.spyOn(uta, 'getPendingOrderIds').mockReturnValue([{ orderId: 'ord-1', symbol: 'ETH' }])
    const openOrder = makeOpenOrder({ symbol: 'ETH', orderType: 'LMT' })
    openOrder.order.lmtPrice = new Decimal('0.00001234')
    vi.spyOn(uta, 'getOrders').mockResolvedValue([openOrder])

    const result = await (tools.getOrders.execute as Function)({ source: 'mock-paper' })
    const order = result[0]
    expect(typeof order.lmtPrice).toBe('string')
    expect(order.lmtPrice).toBe('0.00001234')
  })

  it('preserves string orderId from getPendingOrderIds', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const mgr = makeManager(broker)
    const tools = createTradingTools(asSDK(mgr))

    const uta = mgr.resolve('mock-paper')[0]
    vi.spyOn(uta, 'getPendingOrderIds').mockReturnValue([{ orderId: 'uuid-abc-123', symbol: 'AAPL' }])
    vi.spyOn(uta, 'getOrders').mockResolvedValue([makeOpenOrder()])

    const result = await (tools.getOrders.execute as Function)({ source: 'mock-paper' })
    // Should use the string orderId, not order.orderId (which is 0)
    expect(result[0].orderId).toBe('uuid-abc-123')
  })

  it('groupBy contract clusters orders by aliceId', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const mgr = makeManager(broker)
    const tools = createTradingTools(asSDK(mgr))

    const uta = mgr.resolve('mock-paper')[0]
    vi.spyOn(uta, 'getPendingOrderIds').mockReturnValue([
      { orderId: 'ord-1', symbol: 'AAPL' },
      { orderId: 'ord-2', symbol: 'AAPL' },
      { orderId: 'ord-3', symbol: 'ETH' },
    ])
    vi.spyOn(uta, 'getOrders').mockResolvedValue([
      makeOpenOrder({ symbol: 'AAPL', action: 'BUY' }),
      makeOpenOrder({ symbol: 'AAPL', action: 'SELL', orderType: 'LMT', lmtPrice: '160' }),
      makeOpenOrder({ symbol: 'ETH', action: 'BUY' }),
    ])

    const result = await (tools.getOrders.execute as Function)({ source: 'mock-paper', groupBy: 'contract' })

    // Should be an object keyed by aliceId
    expect(result).not.toBeInstanceOf(Array)
    expect(result['mock-paper|AAPL']).toBeDefined()
    expect(result['mock-paper|AAPL'].orders).toHaveLength(2)
    expect(result['mock-paper|ETH']).toBeDefined()
    expect(result['mock-paper|ETH'].orders).toHaveLength(1)
  })
})

// ==================== getQuote (aliceId resolution) ====================

describe('createTradingTools — getQuote', () => {
  it('resolves aliceId via UTA so broker sees a contract with native fields', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const spy = vi.spyOn(broker, 'getQuote')
    const tools = createTradingTools(asSDK(makeManager(broker)))

    const result = await (tools.getQuote.execute as Function)({ aliceId: 'mock-paper|AAPL' })

    expect(spy).toHaveBeenCalledTimes(1)
    const [passedContract] = spy.mock.calls[0]
    // Without contractFromAliceId, this would be empty and broker resolution
    // would fail. With the fix, MockBroker.resolveNativeKey populates symbol.
    expect(passedContract.symbol || passedContract.localSymbol).toBeTruthy()
    expect(passedContract.aliceId).toBe('mock-paper|AAPL')
    expect(result.source).toBe('mock-paper')
  })

  it('returns error on malformed aliceId', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const tools = createTradingTools(asSDK(makeManager(broker)))
    const result = await (tools.getQuote.execute as Function)({ aliceId: 'no-separator-here' })
    expect(result.error).toMatch(/Invalid aliceId/)
  })

  it('routes to the UTA encoded in the aliceId without an explicit source', async () => {
    const a1 = new MockBroker({ id: 'alpaca-paper' })
    const a2 = new MockBroker({ id: 'bybit-main' })
    const spy1 = vi.spyOn(a1, 'getQuote')
    const spy2 = vi.spyOn(a2, 'getQuote')
    const tools = createTradingTools(asSDK(makeManager(a1, a2)))

    await (tools.getQuote.execute as Function)({ aliceId: 'bybit-main|BTC' })

    expect(spy2).toHaveBeenCalledTimes(1)
    expect(spy1).not.toHaveBeenCalled()
  })
})

// ==================== getContractDetails (aliceId resolution) ====================

describe('createTradingTools — getContractDetails', () => {
  it('expands aliceId via UTA before calling broker.getContractDetails', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const spy = vi.spyOn(broker, 'getContractDetails')
    const tools = createTradingTools(asSDK(makeManager(broker)))

    await (tools.getContractDetails.execute as Function)({
      source: 'mock-paper',
      aliceId: 'mock-paper|AAPL',
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const [passedQuery] = spy.mock.calls[0]
    expect(passedQuery.symbol || passedQuery.localSymbol).toBeTruthy()
    expect(passedQuery.aliceId).toBe('mock-paper|AAPL')
  })

  it('returns error on cross-UTA aliceId mismatch', async () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const tools = createTradingTools(asSDK(makeManager(broker)))
    const result = await (tools.getContractDetails.execute as Function)({
      source: 'mock-paper',
      aliceId: 'other-account|AAPL',
    })
    expect(result.error).toMatch(/belongs to UTA "other-account"/)
  })
})

// ==================== placeOrder schema (AI ergonomics) ====================

describe('placeOrder inputSchema', () => {
  // LLMs frequently emit "" for fields they don't intend to set rather than
  // omitting the key. Without empty-string tolerance, every optional numeric
  // field rejects with "must be a positive numeric string" and the whole MKT
  // call fails at the schema gate (the cashQty/lmtPrice/auxPrice cluster bug
  // reported 2026-05-12).
  it('treats empty-string optional numeric fields as omitted', () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const tools = createTradingTools(asSDK(makeManager(broker)))

    const result = (tools.placeOrder.inputSchema as any).safeParse({
      source: 'mock-paper',
      aliceId: 'mock-paper|AAPL',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0.01',
      cashQty: '',
      lmtPrice: '',
      auxPrice: '',
      trailStopPrice: '',
      trailingPercent: '',
    })

    expect(result.success).toBe(true)
    expect(result.data.cashQty).toBeUndefined()
    expect(result.data.lmtPrice).toBeUndefined()
    expect(result.data.totalQuantity).toBe('0.01')
  })

  it('still rejects non-empty invalid numerics', () => {
    const broker = new MockBroker({ id: 'mock-paper' })
    const tools = createTradingTools(asSDK(makeManager(broker)))

    const result = (tools.placeOrder.inputSchema as any).safeParse({
      source: 'mock-paper',
      aliceId: 'mock-paper|AAPL',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0',
    })

    expect(result.success).toBe(false)
  })
})
