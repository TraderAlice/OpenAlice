import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import { computeRealizedPnL } from './alpaca-pnl.js'
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
    this.getSnapshot = vi.fn()
    this.getClock = vi.fn()
    this.getAccountActivities = vi.fn()
  })
  return { default: MockAlpaca }
})

/** Helper to build a fill activity record. */
function fill(symbol: string, side: 'buy' | 'sell', qty: number, price: number, index = 0) {
  return {
    activity_type: 'FILL' as const,
    symbol,
    side,
    qty: String(qty),
    price: String(price),
    cum_qty: String(qty),
    leaves_qty: '0',
    transaction_time: `2025-01-01T00:00:0${index}Z`,
    order_id: `order-${index}`,
    type: 'fill',
  }
}

describe('computeRealizedPnL', () => {
  it('returns 0 for empty fills', () => {
    expect(computeRealizedPnL([])).toBe(0)
  })

  it('returns 0 when only buys (no closes)', () => {
    const fills = [
      fill('AAPL', 'buy', 10, 150, 0),
      fill('GOOG', 'buy', 5, 2800, 1),
    ]
    expect(computeRealizedPnL(fills)).toBe(0)
  })

  it('computes profit on simple buy then sell', () => {
    const fills = [
      fill('AAPL', 'buy', 10, 150, 0),
      fill('AAPL', 'sell', 10, 160, 1),
    ]
    // (160 - 150) * 10 = 100
    expect(computeRealizedPnL(fills)).toBe(100)
  })

  it('computes loss on simple buy then sell', () => {
    const fills = [
      fill('AAPL', 'buy', 10, 150, 0),
      fill('AAPL', 'sell', 10, 140, 1),
    ]
    // (140 - 150) * 10 = -100
    expect(computeRealizedPnL(fills)).toBe(-100)
  })

  it('handles partial close (sell less than bought)', () => {
    const fills = [
      fill('AAPL', 'buy', 10, 150, 0),
      fill('AAPL', 'sell', 4, 160, 1),
    ]
    // (160 - 150) * 4 = 40
    expect(computeRealizedPnL(fills)).toBe(40)
  })

  it('handles FIFO across multiple buy lots', () => {
    const fills = [
      fill('AAPL', 'buy', 5, 100, 0),
      fill('AAPL', 'buy', 5, 120, 1),
      fill('AAPL', 'sell', 7, 130, 2),
    ]
    // FIFO: first lot 5@100 -> (130-100)*5 = 150
    //        second lot 2@120 -> (130-120)*2 = 20
    // total = 170
    expect(computeRealizedPnL(fills)).toBe(170)
  })

  it('handles multiple symbols independently', () => {
    const fills = [
      fill('AAPL', 'buy', 10, 150, 0),
      fill('GOOG', 'buy', 2, 2800, 1),
      fill('AAPL', 'sell', 10, 160, 2),
      fill('GOOG', 'sell', 2, 2700, 3),
    ]
    // AAPL: (160-150)*10 = 100
    // GOOG: (2700-2800)*2 = -200
    // total = -100
    expect(computeRealizedPnL(fills)).toBe(-100)
  })

  it('handles short selling (sell then buy)', () => {
    const fills = [
      fill('AAPL', 'sell', 10, 160, 0),
      fill('AAPL', 'buy', 10, 150, 1),
    ]
    // Short: entry 160, exit 150 -> (160-150)*10 = 100 profit
    expect(computeRealizedPnL(fills)).toBe(100)
  })

  it('handles short selling at a loss', () => {
    const fills = [
      fill('AAPL', 'sell', 10, 150, 0),
      fill('AAPL', 'buy', 10, 160, 1),
    ]
    // Short: entry 150, exit 160 -> (150-160)*10 = -100 loss
    expect(computeRealizedPnL(fills)).toBe(-100)
  })

  it('handles multiple round trips', () => {
    const fills = [
      fill('AAPL', 'buy', 10, 100, 0),
      fill('AAPL', 'sell', 10, 110, 1),
      fill('AAPL', 'buy', 10, 105, 2),
      fill('AAPL', 'sell', 10, 115, 3),
    ]
    // Trip 1: (110-100)*10 = 100
    // Trip 2: (115-105)*10 = 100
    // total = 200
    expect(computeRealizedPnL(fills)).toBe(200)
  })

  it('rounds to cents', () => {
    const fills = [
      fill('AAPL', 'buy', 3, 10.333, 0),
      fill('AAPL', 'sell', 3, 10.667, 1),
    ]
    // (10.667 - 10.333) * 3 = 1.002
    expect(computeRealizedPnL(fills)).toBe(1)
  })
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
    contract.aliceId = 'alpaca-AAPL'
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
    expect(positions[0].avgCost).toBe(150)
    expect(positions[0].marketPrice).toBe(160)
    expect(positions[0].marketValue).toBe(1600)
    expect(positions[0].unrealizedPnL).toBe(100)
    expect(positions[0].side).toBe('long')
  })
})

// ==================== getContractDetails ====================

describe('AlpacaBroker — getContractDetails()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ContractDetails for a valid symbol', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    const query = new Contract()
    query.aliceId = 'alpaca-AAPL'
    query.symbol = 'AAPL'

    const details = await acc.getContractDetails(query)
    expect(details).not.toBeNull()
    expect(details!.contract.symbol).toBe('AAPL')
    expect(details!.contract.aliceId).toBe('alpaca-AAPL')
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

// ==================== cancelOrder ====================

describe('AlpacaBroker — cancelOrder()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true on success', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      cancelOrder: vi.fn().mockResolvedValue(undefined),
    }

    const result = await acc.cancelOrder('ord-1')
    expect(result).toBe(true)
  })

  it('returns false on API failure', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      cancelOrder: vi.fn().mockRejectedValue(new Error('Cannot cancel')),
    }

    const result = await acc.cancelOrder('ord-1')
    expect(result).toBe(false)
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
    contract.aliceId = 'alpaca-AAPL'
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
    contract.aliceId = 'alpaca-AAPL'
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
      getAccountActivities: vi.fn().mockResolvedValue([]),
    }

    const info = await acc.getAccount()
    expect(info.netLiquidation).toBe(100000)
    expect(info.totalCashValue).toBe(50000)
    expect(info.buyingPower).toBe(200000)
    expect(info.unrealizedPnL).toBe(350) // 100 + 250
    expect(info.dayTradesRemaining).toBe(2) // 3 - 1
  })
})

// ==================== getOrders ====================

describe('AlpacaBroker — getOrders()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps Alpaca orders to OpenOrder[] with correct statuses', async () => {
    const acc = new AlpacaBroker({ apiKey: 'k', secretKey: 's', paper: true })
    ;(acc as any).client = {
      getOrders: vi.fn().mockResolvedValue([
        {
          id: '100',
          symbol: 'AAPL',
          side: 'buy',
          type: 'limit',
          qty: '10',
          limit_price: '150.00',
          stop_price: null,
          time_in_force: 'gtc',
          status: 'filled',
          filled_avg_price: '149.50',
          filled_qty: '10',
          filled_at: '2025-01-01T10:00:00Z',
          created_at: '2025-01-01T09:30:00Z',
          reject_reason: null,
          extended_hours: false,
          notional: null,
        },
        {
          id: '101',
          symbol: 'GOOG',
          side: 'sell',
          type: 'market',
          qty: '5',
          limit_price: null,
          stop_price: null,
          time_in_force: 'day',
          status: 'new',
          filled_avg_price: null,
          filled_qty: '0',
          filled_at: null,
          created_at: '2025-01-01T09:35:00Z',
          reject_reason: null,
          extended_hours: false,
          notional: null,
        },
        {
          id: '102',
          symbol: 'MSFT',
          side: 'buy',
          type: 'limit',
          qty: '20',
          limit_price: '400.00',
          stop_price: null,
          time_in_force: 'day',
          status: 'canceled',
          filled_avg_price: null,
          filled_qty: '0',
          filled_at: null,
          created_at: '2025-01-01T09:40:00Z',
          reject_reason: null,
          extended_hours: false,
          notional: null,
        },
      ]),
    }

    const orders = await acc.getOrders()
    expect(orders).toHaveLength(3)

    // Filled order
    expect(orders[0].contract.symbol).toBe('AAPL')
    expect(orders[0].order.action).toBe('BUY')
    expect(orders[0].order.totalQuantity.toNumber()).toBe(10)
    expect(orders[0].order.orderType).toBe('LIMIT')
    expect(orders[0].order.lmtPrice).toBe(150)
    expect(orders[0].orderState.status).toBe('Filled')

    // New → Submitted
    expect(orders[1].contract.symbol).toBe('GOOG')
    expect(orders[1].order.action).toBe('SELL')
    expect(orders[1].orderState.status).toBe('Submitted')

    // Canceled → Cancelled
    expect(orders[2].contract.symbol).toBe('MSFT')
    expect(orders[2].orderState.status).toBe('Cancelled')
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
    contract.aliceId = 'alpaca-AAPL'
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
