import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, UNSET_DOUBLE } from '@traderalice/ibkr'
import { AlpacaBroker } from './AlpacaBroker.js'
import '../../contract-ext.js'

// ==================== Alpaca SDK mock ====================

vi.mock('@alpacahq/alpaca-trade-api', () => {
  const MockAlpaca = vi.fn(function (this: any) {
    this.getAccount = vi.fn()
    this.getPositions = vi.fn()
    this.createOrder = vi.fn()
    this.replaceOrder = vi.fn()
    this.cancelOrder = vi.fn()
    this.closePosition = vi.fn()
    this.getOrders = vi.fn()
    this.getOrder = vi.fn()
    this.getSnapshot = vi.fn()
    this.getClock = vi.fn()
    this.getAccountActivities = vi.fn()
  })
  return { default: MockAlpaca }
})

// ==================== AlpacaBroker ====================

describe('AlpacaBroker — init()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when no apiKey is configured', async () => {
    const acc = new AlpacaBroker({ apiKey: '', secretKey: '', paper: true })
    await expect(acc.init()).rejects.toThrow('No API credentials')
  })

  it('throws when no secretKey is configured', async () => {
    const acc = new AlpacaBroker({ apiKey: 'key', secretKey: '', paper: true })
    await expect(acc.init()).rejects.toThrow('No API credentials')
  })

  it('resolves on successful getAccount()', async () => {
    const acc = new AlpacaBroker({ apiKey: 'key', secretKey: 'secret', paper: true })
    const { default: Alpaca } = await import('@alpacahq/alpaca-trade-api')
    ;(Alpaca as any).mockImplementationOnce(function (this: any) {
      this.getAccount = vi.fn().mockResolvedValue({ equity: '50000', paper: true })
      this.getPositions = vi.fn()
      this.createOrder = vi.fn()
      this.replaceOrder = vi.fn()
      this.cancelOrder = vi.fn()
      this.closePosition = vi.fn()
      this.getOrders = vi.fn()
      this.getSnapshot = vi.fn()
      this.getClock = vi.fn()
      this.getAccountActivities = vi.fn()
    })
    await expect(acc.init()).resolves.toBeUndefined()
  })

  it('throws authentication error after MAX_AUTH_RETRIES on 401', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any })
    const acc = new AlpacaBroker({ apiKey: 'bad', secretKey: 'bad', paper: true })
    const { default: Alpaca } = await import('@alpacahq/alpaca-trade-api')
    ;(Alpaca as any).mockImplementationOnce(function (this: any) {
      this.getAccount = vi.fn().mockRejectedValue(new Error('401 Unauthorized'))
      this.getPositions = vi.fn()
      this.createOrder = vi.fn()
      this.replaceOrder = vi.fn()
      this.cancelOrder = vi.fn()
      this.closePosition = vi.fn()
      this.getOrders = vi.fn()
      this.getSnapshot = vi.fn()
      this.getClock = vi.fn()
      this.getAccountActivities = vi.fn()
    })
    await expect(acc.init()).rejects.toThrow('Authentication failed')
  })
})

describe('AlpacaBroker — searchContracts()', () => {
  it('returns empty array for empty pattern', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const results = await acc.searchContracts('')
    expect(results).toEqual([])
  })

  it('uppercases the pattern and returns a contract', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const results = await acc.searchContracts('aapl')
    expect(results).toHaveLength(1)
    expect(results[0].contract.symbol).toBe('AAPL')
  })
})

describe('AlpacaBroker — placeOrder()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns success with orderId on filled order', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      createOrder: vi.fn().mockResolvedValue({
        id: 'ord-1', status: 'filled', filled_avg_price: '150.50', filled_qty: '10',
      }),
    }
    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'
    contract.secType = 'STK'
    contract.exchange = 'NASDAQ'
    contract.currency = 'USD'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)

    const result = await acc.placeOrder(contract, order)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('ord-1')
  })

  it('returns error when contract resolution fails', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = { createOrder: vi.fn() }
    const contract = new Contract()
    contract.aliceId = ''
    contract.symbol = ''
    contract.secType = 'STK'
    contract.exchange = ''
    contract.currency = ''

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(1)

    const result = await acc.placeOrder(contract, order)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot resolve')
  })
})

describe('AlpacaBroker — precision', () => {
  it('placeOrder sends precise qty (no float corruption)', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      createOrder: vi.fn().mockResolvedValue({ id: 'ord-p', status: 'new' }),
    }
    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'
    contract.secType = 'STK'
    contract.exchange = 'NASDAQ'
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('10.5')

    await acc.placeOrder(contract, order)
    const passedQty = (acc as any).client.createOrder.mock.calls[0][0].qty
    expect(passedQty).toBe(10.5)
  })
})

describe('AlpacaBroker — getPositions()', () => {
  it('maps raw Alpaca positions to domain Position format', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getPositions: vi.fn().mockResolvedValue([{
        symbol: 'AAPL',
        side: 'long',
        qty: '10',
        avg_entry_price: '150.00',
        current_price: '160.00',
        market_value: '1600.00',
        unrealized_pl: '100.00',
        unrealized_plpc: '0.0667',
        cost_basis: '1500.00',
      }]),
    }
    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].contract.symbol).toBe('AAPL')
    expect(positions[0].quantity.toNumber()).toBe(10)
    expect(positions[0].avgCost).toBe('150')
    expect(positions[0].marketPrice).toBe('160')
    expect(positions[0].marketValue).toBe('1600')
    expect(positions[0].unrealizedPnL).toBe('100')
    expect(positions[0].side).toBe('long')
  })
})

// ==================== getContractDetails ====================

describe('AlpacaBroker — getContractDetails()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ContractDetails for a valid symbol', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const query = new Contract()
    query.aliceId = 'alpaca-paper|AAPL'
    query.symbol = 'AAPL'

    const details = await acc.getContractDetails(query)
    expect(details).not.toBeNull()
    expect(details!.contract.symbol).toBe('AAPL')
    expect(details!.validExchanges).toBe('SMART,NYSE,NASDAQ,ARCA')
    expect(details!.orderTypes).toBe('MKT,LMT,STP,STP LMT,TRAIL')
    expect(details!.stockType).toBe('COMMON')
  })

  it('returns null when symbol cannot be resolved', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const query = new Contract()
    query.aliceId = ''
    query.symbol = ''

    const details = await acc.getContractDetails(query)
    expect(details).toBeNull()
  })
})

// ==================== modifyOrder ====================

describe('AlpacaBroker — modifyOrder()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls client.replaceOrder with mapped IBKR fields', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const replaceOrder = vi.fn().mockResolvedValue({
      id: 'ord-modified', status: 'accepted',
    })
    ;(acc as any).client = { replaceOrder }

    const changes = new Order()
    changes.totalQuantity = new Decimal(20)
    changes.lmtPrice = 155.50
    changes.auxPrice = UNSET_DOUBLE
    changes.trailingPercent = UNSET_DOUBLE
    changes.tif = 'GTC'

    const result = await acc.modifyOrder('ord-1', changes)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('ord-modified')
    expect(replaceOrder).toHaveBeenCalledWith('ord-1', {
      qty: 20,
      limit_price: 155.50,
      time_in_force: 'gtc',
    })
  })

  it('returns error on API failure', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      replaceOrder: vi.fn().mockRejectedValue(new Error('Order not found')),
    }

    const changes = new Order()
    changes.totalQuantity = new Decimal(5)
    changes.lmtPrice = UNSET_DOUBLE
    changes.auxPrice = UNSET_DOUBLE
    changes.trailingPercent = UNSET_DOUBLE
    changes.tif = ''

    const result = await acc.modifyOrder('ord-999', changes)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Order not found')
  })
})

// ==================== modifyOrder — null-check safety ====================

describe('AlpacaBroker — modifyOrder null-check', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not send undefined lmtPrice/auxPrice/trailingPercent when only qty changes', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const replaceOrder = vi.fn().mockResolvedValue({ id: 'ord-mod', status: 'accepted' })
    ;(acc as any).client = { replaceOrder }

    // Partial<Order> — only totalQuantity set, everything else is undefined
    const changes: Partial<Order> = { totalQuantity: new Decimal(20) }

    await acc.modifyOrder('ord-1', changes)
    const patch = replaceOrder.mock.calls[0][1]

    expect(patch.qty).toBe(20)
    // These should NOT be in the patch — they were undefined, not UNSET_DOUBLE
    expect(patch).not.toHaveProperty('limit_price')
    expect(patch).not.toHaveProperty('stop_price')
    expect(patch).not.toHaveProperty('trail')
  })

  it('sends lmtPrice when explicitly set in changes', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const replaceOrder = vi.fn().mockResolvedValue({ id: 'ord-mod', status: 'accepted' })
    ;(acc as any).client = { replaceOrder }

    const changes: Partial<Order> = { lmtPrice: 155.50 }

    await acc.modifyOrder('ord-1', changes)
    const patch = replaceOrder.mock.calls[0][1]

    expect(patch.limit_price).toBe(155.50)
    expect(patch).not.toHaveProperty('stop_price')
    expect(patch).not.toHaveProperty('trail')
  })

  it('sends auxPrice as stop_price when explicitly set', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const replaceOrder = vi.fn().mockResolvedValue({ id: 'ord-mod', status: 'accepted' })
    ;(acc as any).client = { replaceOrder }

    const changes: Partial<Order> = { auxPrice: 140 }

    await acc.modifyOrder('ord-1', changes)
    const patch = replaceOrder.mock.calls[0][1]

    expect(patch.stop_price).toBe(140)
    expect(patch).not.toHaveProperty('limit_price')
  })
})

// ==================== cancelOrder ====================

describe('AlpacaBroker — cancelOrder()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns PlaceOrderResult with Cancelled status on success', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      cancelOrder: vi.fn().mockResolvedValue(undefined),
    }

    const result = await acc.cancelOrder('ord-1')
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('ord-1')
    expect(result.orderState?.status).toBe('Cancelled')
  })

  it('returns PlaceOrderResult with error on API failure', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      cancelOrder: vi.fn().mockRejectedValue(new Error('Cannot cancel')),
    }

    const result = await acc.cancelOrder('ord-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Cannot cancel')
  })
})

// ==================== closePosition ====================

describe('AlpacaBroker — closePosition()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('full close via native client.closePosition', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      closePosition: vi.fn().mockResolvedValue({
        id: 'close-1', status: 'filled',
      }),
    }

    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'

    const result = await acc.closePosition(contract)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('close-1')
    expect((acc as any).client.closePosition).toHaveBeenCalledWith('AAPL')
  })

  it('partial close via reverse market order', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getPositions: vi.fn().mockResolvedValue([{
        symbol: 'AAPL',
        side: 'long',
        qty: '10',
        avg_entry_price: '150.00',
        current_price: '160.00',
        market_value: '1600.00',
        unrealized_pl: '100.00',
        unrealized_plpc: '0.0667',
        cost_basis: '1500.00',
      }]),
      createOrder: vi.fn().mockResolvedValue({
        id: 'partial-1', status: 'filled', filled_avg_price: '160.00', filled_qty: '3',
      }),
    }

    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'

    const result = await acc.closePosition(contract, new Decimal(3))
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('partial-1')
    // Should place a SELL order for long position
    expect((acc as any).client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'AAPL',
        side: 'sell',
        type: 'market',
        qty: 3,
      }),
    )
  })

  it('returns error when symbol cannot be resolved', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const contract = new Contract()
    contract.aliceId = ''
    contract.symbol = ''

    const result = await acc.closePosition(contract)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot resolve')
  })
})

// ==================== getAccount ====================

describe('AlpacaBroker — getAccount()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps Alpaca account fields to AccountInfo', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getAccount: vi.fn().mockResolvedValue({
        equity: '100000.00',
        cash: '50000.00',
        buying_power: '200000.00',
        portfolio_value: '100000.00',
        daytrade_count: 1,
        daytrading_buying_power: '400000.00',
      }),
      getPositions: vi.fn().mockResolvedValue([
        { symbol: 'AAPL', side: 'long', qty: '10', avg_entry_price: '150', current_price: '160', market_value: '1600', unrealized_pl: '100.00', unrealized_plpc: '0.0667', cost_basis: '1500' },
        { symbol: 'GOOG', side: 'long', qty: '5', avg_entry_price: '2800', current_price: '2850', market_value: '14250', unrealized_pl: '250.00', unrealized_plpc: '0.0179', cost_basis: '14000' },
      ]),
    }

    const info = await acc.getAccount()
    expect(info.netLiquidation).toBe('100000')
    expect(info.totalCashValue).toBe('50000')
    expect(info.buyingPower).toBe('200000')
    expect(info.unrealizedPnL).toBe('350') // 100 + 250
    expect(info.realizedPnL).toBeUndefined()
    expect(info.dayTradesRemaining).toBe(2) // 3 - 1
  })
})

describe('AlpacaBroker — getAccount() precision', () => {
  it('aggregates unrealizedPnL with Decimal to avoid float drift', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getAccount: vi.fn().mockResolvedValue({
        equity: '100000.00', cash: '50000.00', buying_power: '200000.00',
        portfolio_value: '100000.00', daytrade_count: 0, daytrading_buying_power: '400000.00',
      }),
      getPositions: vi.fn().mockResolvedValue([
        { symbol: 'A', side: 'long', qty: '1', avg_entry_price: '10', current_price: '10', market_value: '10', unrealized_pl: '0.1', unrealized_plpc: '0', cost_basis: '10' },
        { symbol: 'B', side: 'long', qty: '1', avg_entry_price: '10', current_price: '10', market_value: '10', unrealized_pl: '0.2', unrealized_plpc: '0', cost_basis: '10' },
        { symbol: 'C', side: 'long', qty: '1', avg_entry_price: '10', current_price: '10', market_value: '10', unrealized_pl: '0.3', unrealized_plpc: '0', cost_basis: '10' },
      ]),
    }

    const info = await acc.getAccount()
    // 0.1 + 0.2 + 0.3 = 0.6 (with floats: 0.6000000000000001)
    expect(info.unrealizedPnL).toBe('0.6')
  })
})

// ==================== getOrders ====================

describe('AlpacaBroker — getOrders()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries each orderId via getOrder', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getOrder: vi.fn()
        .mockResolvedValueOnce({
          id: '100', symbol: 'AAPL', side: 'buy', type: 'limit', qty: '10',
          limit_price: '150.00', stop_price: null, time_in_force: 'gtc',
          status: 'filled', reject_reason: null, extended_hours: false, notional: null,
        })
        .mockResolvedValueOnce({
          id: '101', symbol: 'GOOG', side: 'sell', type: 'market', qty: '5',
          limit_price: null, stop_price: null, time_in_force: 'day',
          status: 'new', reject_reason: null, extended_hours: false, notional: null,
        }),
    }

    const orders = await acc.getOrders(['100', '101'])
    expect(orders).toHaveLength(2)
    expect(orders[0].contract.symbol).toBe('AAPL')
    expect(orders[0].orderState.status).toBe('Filled')
    expect(orders[1].contract.symbol).toBe('GOOG')
    expect(orders[1].orderState.status).toBe('Submitted')
  })
})

// ==================== getOrder ====================

describe('AlpacaBroker — getOrder()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches a specific order by ID', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getOrder: vi.fn().mockResolvedValue({
        id: 'ord-200', symbol: 'AAPL', side: 'buy', qty: '10', notional: null,
        type: 'market', limit_price: null, stop_price: null,
        time_in_force: 'day', extended_hours: false,
        status: 'filled', reject_reason: null,
      }),
    }

    const result = await acc.getOrder('ord-200')
    expect(result).not.toBeNull()
    expect(result!.order.action).toBe('BUY')
    expect(result!.orderState.status).toBe('Filled')
  })

  it('passes orderId as string argument, not object', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const getOrderMock = vi.fn().mockResolvedValue({
      id: 'b0b6dd9d-8b9b-4c5a-9e3f-1a2b3c4d5e6f', symbol: 'AAPL', side: 'buy',
      qty: '1', notional: null, type: 'market', limit_price: null, stop_price: null,
      time_in_force: 'day', extended_hours: false, status: 'filled', reject_reason: null,
    })
    ;(acc as any).client = { getOrder: getOrderMock }

    await acc.getOrder('b0b6dd9d-8b9b-4c5a-9e3f-1a2b3c4d5e6f')
    // Must pass UUID string directly, NOT { order_id: ... }
    expect(getOrderMock).toHaveBeenCalledWith('b0b6dd9d-8b9b-4c5a-9e3f-1a2b3c4d5e6f')
  })

  it('returns null when order not found', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getOrder: vi.fn().mockRejectedValue(new Error('Order not found')),
    }

    const result = await acc.getOrder('nonexistent')
    expect(result).toBeNull()
  })

  it('mapOpenOrder sets orderId to 0 for UUID order IDs', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getOrder: vi.fn().mockResolvedValue({
        id: 'b0b6dd9d-8b9b-4c5a-9e3f-1a2b3c4d5e6f', symbol: 'AAPL', side: 'buy',
        qty: '10', notional: null, type: 'market', limit_price: null, stop_price: null,
        time_in_force: 'day', extended_hours: false, status: 'filled', reject_reason: null,
      }),
    }

    const result = await acc.getOrder('b0b6dd9d-8b9b-4c5a-9e3f-1a2b3c4d5e6f')
    expect(result).not.toBeNull()
    // IBKR orderId is number — UUID can't fit, so it should be 0
    expect(result!.order.orderId).toBe(0)
  })

  it('extracts tpsl from bracket order legs', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getOrder: vi.fn().mockResolvedValue({
        id: 'ord-bracket', symbol: 'AAPL', side: 'buy', qty: '10', notional: null,
        type: 'market', limit_price: null, stop_price: null,
        time_in_force: 'day', extended_hours: false,
        status: 'filled', reject_reason: null,
        order_class: 'bracket',
        legs: [
          { id: 'tp-1', symbol: 'AAPL', side: 'sell', qty: '10', notional: null,
            type: 'limit', limit_price: '160.00', stop_price: null,
            time_in_force: 'gtc', extended_hours: false, status: 'new', reject_reason: null },
          { id: 'sl-1', symbol: 'AAPL', side: 'sell', qty: '10', notional: null,
            type: 'stop', limit_price: null, stop_price: '140.00',
            time_in_force: 'gtc', extended_hours: false, status: 'new', reject_reason: null },
        ],
      }),
    }

    const result = await acc.getOrder('ord-bracket')
    expect(result!.tpsl).toEqual({
      takeProfit: { price: '160.00' },
      stopLoss: { price: '140.00' },
    })
  })

  it('extracts stop-limit SL with limitPrice', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getOrder: vi.fn().mockResolvedValue({
        id: 'ord-stp-lmt', symbol: 'AAPL', side: 'buy', qty: '10', notional: null,
        type: 'market', limit_price: null, stop_price: null,
        time_in_force: 'day', extended_hours: false,
        status: 'filled', reject_reason: null,
        order_class: 'bracket',
        legs: [
          { id: 'sl-2', symbol: 'AAPL', side: 'sell', qty: '10', notional: null,
            type: 'stop_limit', limit_price: '139.50', stop_price: '140.00',
            time_in_force: 'gtc', extended_hours: false, status: 'new', reject_reason: null },
        ],
      }),
    }

    const result = await acc.getOrder('ord-stp-lmt')
    expect(result!.tpsl).toEqual({
      stopLoss: { price: '140.00', limitPrice: '139.50' },
    })
  })

  it('returns no tpsl for simple (non-bracket) orders', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getOrder: vi.fn().mockResolvedValue({
        id: 'ord-simple', symbol: 'AAPL', side: 'buy', qty: '10', notional: null,
        type: 'market', limit_price: null, stop_price: null,
        time_in_force: 'day', extended_hours: false,
        status: 'filled', reject_reason: null,
      }),
    }

    const result = await acc.getOrder('ord-simple')
    expect(result!.tpsl).toBeUndefined()
  })
})

// ==================== getQuote ====================

describe('AlpacaBroker — getQuote()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns mapped quote from client.getSnapshot', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getSnapshot: vi.fn().mockResolvedValue({
        LatestTrade: { Price: 155.25, Timestamp: '2025-01-01T10:00:00Z' },
        LatestQuote: { BidPrice: 155.20, AskPrice: 155.30 },
        DailyBar: { Volume: 1_000_000 },
      }),
    }

    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'

    const quote = await acc.getQuote(contract)
    expect(quote.contract.symbol).toBe('AAPL')
    expect(quote.last).toBe(155.25)
    expect(quote.bid).toBe(155.20)
    expect(quote.ask).toBe(155.30)
    expect(quote.volume).toBe(1_000_000)
    expect(quote.timestamp).toEqual(new Date('2025-01-01T10:00:00Z'))
  })

  it('throws when contract cannot be resolved', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const contract = new Contract()
    contract.aliceId = ''
    contract.symbol = ''

    await expect(acc.getQuote(contract)).rejects.toThrow('Cannot resolve')
  })
})

// ==================== getMarketClock ====================

describe('AlpacaBroker — getMarketClock()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns mapped clock data from client.getClock', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getClock: vi.fn().mockResolvedValue({
        is_open: true,
        next_open: '2025-01-02T14:30:00Z',
        next_close: '2025-01-01T21:00:00Z',
        timestamp: '2025-01-01T15:00:00Z',
      }),
    }

    const clock = await acc.getMarketClock()
    expect(clock.isOpen).toBe(true)
    expect(clock.nextOpen).toEqual(new Date('2025-01-02T14:30:00Z'))
    expect(clock.nextClose).toEqual(new Date('2025-01-01T21:00:00Z'))
    expect(clock.timestamp).toEqual(new Date('2025-01-01T15:00:00Z'))
  })
})

// ==================== getCapabilities ====================

describe('AlpacaBroker — getCapabilities()', () => {
  it('returns correct supportedSecTypes and supportedOrderTypes', () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const caps = acc.getCapabilities()
    expect(caps.supportedSecTypes).toEqual(['STK'])
    expect(caps.supportedOrderTypes).toEqual(['MKT', 'LMT', 'STP', 'STP LMT', 'TRAIL'])
  })
})
