/**
 * CcxtBroker unit tests.
 *
 * We mock the ccxt module so the constructor doesn't try to reach real exchanges.
 * Tests focus on pure logic: searchContracts sorting/filtering, cancelOrder cache,
 * placeOrder notional conversion, and the constructor error path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'

// Mock ccxt BEFORE importing CcxtBroker
vi.mock('ccxt', () => {
  // Create a fake exchange class that can be used as a constructor
  const MockExchange = vi.fn(function (this: any) {
    this.markets = {}
    this.options = { fetchMarkets: { types: ['spot', 'linear'] } }
    this.setSandboxMode = vi.fn()
    this.loadMarkets = vi.fn().mockResolvedValue({})
    this.fetchMarkets = vi.fn().mockResolvedValue([])
    this.fetchTicker = vi.fn()
    this.fetchBalance = vi.fn()
    this.fetchPositions = vi.fn()
    this.fetchOpenOrders = vi.fn()
    this.fetchClosedOrders = vi.fn()
    this.createOrder = vi.fn()
    this.cancelOrder = vi.fn()
    this.editOrder = vi.fn()
    this.fetchOrder = vi.fn()
    this.fetchFundingRate = vi.fn()
    this.fetchOrderBook = vi.fn()
  })

  return {
    default: {
      bybit: MockExchange,
      binance: MockExchange,
    },
  }
})

import { CcxtBroker } from './CcxtBroker.js'
import '../../contract-ext.js'

// ==================== Helpers ====================

function makeSpotMarket(base: string, quote: string, symbol?: string): any {
  return {
    id: symbol ?? `${base}${quote}`,
    symbol: symbol ?? `${base}/${quote}`,
    base: base.toUpperCase(),
    quote: quote.toUpperCase(),
    type: 'spot',
    active: true,
    precision: { price: 0.01 },
    limits: {},
    settle: undefined,
  }
}

function makeSwapMarket(base: string, quote: string, symbol?: string): any {
  return {
    id: symbol ?? `${base}${quote}`,
    symbol: symbol ?? `${base}/${quote}:${quote}`,
    base: base.toUpperCase(),
    quote: quote.toUpperCase(),
    type: 'swap',
    active: true,
    precision: { price: 0.01 },
    limits: {},
    settle: quote.toUpperCase(),
  }
}

function makeAccount(overrides?: Partial<{ apiKey: string; apiSecret: string }>) {
  return new CcxtBroker({
    exchange: 'bybit',
    apiKey: overrides?.apiKey ?? 'k',
    apiSecret: overrides?.apiSecret ?? 's',
    defaultMarketType: 'swap',
    sandbox: false,
  })
}

function setInitialized(acc: CcxtBroker, markets: Record<string, any>) {
  ;(acc as any).initialized = true
  ;(acc as any).exchange.markets = markets
}

// ==================== Constructor ====================

describe('CcxtBroker — constructor', () => {
  it('throws for unknown exchange', () => {
    expect(() => new CcxtBroker({ exchange: 'unknownxyz', apiKey: 'k', apiSecret: 's', defaultMarketType: 'spot', sandbox: false })).toThrow(
      'Unknown CCXT exchange',
    )
  })

  it('sets readOnly when no apiKey', () => {
    const acc = new CcxtBroker({ exchange: 'bybit', apiKey: '', apiSecret: '', defaultMarketType: 'spot', sandbox: false })
    expect((acc as any).readOnly).toBe(true)
  })

  it('uses exchange name as provider', () => {
    const acc = makeAccount()
    expect(acc.provider).toBe('bybit')
  })

  it('defaults id to exchange-main', () => {
    const acc = makeAccount()
    expect(acc.id).toBe('bybit-main')
  })
})

// ==================== searchContracts ====================

describe('CcxtBroker — searchContracts', () => {
  let acc: CcxtBroker

  beforeEach(() => {
    acc = makeAccount()
    setInitialized(acc, {
      'BTC/USDT': makeSpotMarket('BTC', 'USDT', 'BTC/USDT'),
      'BTC/USDT:USDT': makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT'),
      'BTC/USD': makeSpotMarket('BTC', 'USD', 'BTC/USD'),
      'ETH/USDT': makeSpotMarket('ETH', 'USDT', 'ETH/USDT'),
    })
  })

  it('returns empty array for empty pattern', async () => {
    expect(await acc.searchContracts('')).toEqual([])
  })

  it('filters by base asset (case-insensitive)', async () => {
    const results = await acc.searchContracts('btc')
    const symbols = results.map((r) => r.contract.symbol)
    expect(symbols.every((s) => s.startsWith('BTC'))).toBe(true)
    expect(symbols).not.toContain('ETH/USDT')
  })

  it('only returns USDT/USD/USDC quoted markets', async () => {
    ;(acc as any).exchange.markets['BTC/DOGE'] = { ...makeSpotMarket('BTC', 'DOGE'), id: 'BTCDOGE' }
    const results = await acc.searchContracts('BTC')
    const quotes = results.map((r) => r.contract.currency)
    expect(quotes.every((q) => ['USDT', 'USD', 'USDC'].includes(q ?? ''))).toBe(true)
  })

  it('excludes inactive markets', async () => {
    ;(acc as any).exchange.markets['BTC/USDC'] = { ...makeSpotMarket('BTC', 'USDC'), active: false }
    const before = (await acc.searchContracts('BTC')).length
    expect(before).toBe(3) // spot+swap USDT + spot USD (not inactive USDC)
  })

  it('sorts swap before spot when defaultMarketType is swap', async () => {
    const results = await acc.searchContracts('BTC')
    // USDT swap should come first (swap preference when defaultMarketType=swap)
    const first = results[0]
    expect((first.contract as any).secType ?? first.contract.symbol.includes(':') ? 'CRYPTO_PERP' : 'CRYPTO').toBeTruthy()
  })
})

// ==================== cancelOrder — cache miss ====================

describe('CcxtBroker — cancelOrder cache', () => {
  it('calls exchange.cancelOrder with undefined symbol when orderId is not in cache', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})
    ;(acc as any).exchange.cancelOrder = vi.fn().mockResolvedValue({})
    await acc.cancelOrder('order-not-cached')
    expect((acc as any).exchange.cancelOrder).toHaveBeenCalledWith('order-not-cached', undefined)
  })

  it('returns false when exchange.cancelOrder throws (cache miss causes undefined symbol)', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})
    ;(acc as any).exchange.cancelOrder = vi.fn().mockRejectedValue(new Error('symbol required'))
    const result = await acc.cancelOrder('order-not-cached')
    expect(result).toBe(false)
  })

  it('calls exchange.cancelOrder with correct symbol when orderId is cached', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})
    ;(acc as any).orderSymbolCache.set('order-123', 'BTC/USDT:USDT')
    ;(acc as any).exchange.cancelOrder = vi.fn().mockResolvedValue({})
    const result = await acc.cancelOrder('order-123')
    expect(result).toBe(true)
    expect((acc as any).exchange.cancelOrder).toHaveBeenCalledWith('order-123', 'BTC/USDT:USDT')
  })
})

// ==================== placeOrder — notional conversion ====================

describe('CcxtBroker — placeOrder notional', () => {
  it('converts notional to size using ticker price when qty is not provided', async () => {
    const acc = makeAccount()
    setInitialized(acc, {
      'BTC/USDT:USDT': makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT'),
    })
    ;(acc as any).exchange.fetchTicker = vi.fn().mockResolvedValue({ last: 50_000 })
    ;(acc as any).exchange.createOrder = vi.fn().mockResolvedValue({
      id: 'ord-1', status: 'open', average: undefined, filled: undefined,
    })

    const contract = new Contract()
    contract.aliceId = 'bybit-BTC/USDT:USDT'
    contract.symbol = 'BTC/USDT:USDT'
    contract.secType = 'CRYPTO_PERP'
    contract.exchange = 'bybit'
    contract.currency = 'USDT'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.cashQty = 500 // $500 worth of BTC

    const result = await acc.placeOrder(contract, order)

    expect(result.success).toBe(true)
    const createOrderCall = (acc as any).exchange.createOrder.mock.calls[0]
    // size = 500 / 50000 = 0.01 BTC
    expect(createOrderCall[3]).toBeCloseTo(0.01)
  })

  it('returns error when neither qty nor notional provided', async () => {
    const acc = makeAccount()
    setInitialized(acc, {
      'BTC/USDT:USDT': makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT'),
    })

    const contract = new Contract()
    contract.aliceId = 'bybit-BTC/USDT:USDT'
    contract.symbol = 'BTC/USDT:USDT'
    contract.secType = 'CRYPTO_PERP'
    contract.exchange = 'bybit'
    contract.currency = 'USDT'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    // No totalQuantity or cashQty set

    const result = await acc.placeOrder(contract, order)
    expect(result.success).toBe(false)
    expect(result.error).toContain('totalQuantity or cashQty')
  })
})

// ==================== getContractDetails ====================

describe('CcxtBroker — getContractDetails', () => {
  it('returns ContractDetails for a resolvable contract via aliceId', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT')
    setInitialized(acc, { 'BTC/USDT:USDT': market })

    const contract = new Contract()
    contract.aliceId = 'bybit-BTC/USDT:USDT'

    const details = await acc.getContractDetails(contract)
    expect(details).not.toBeNull()
    expect(details!.contract.symbol).toBe('BTC')
    expect(details!.contract.currency).toBe('USDT')
    expect(details!.longName).toContain('BTC/USDT')
    expect(details!.minTick).toBe(0.01)
  })

  it('returns null when contract cannot be resolved', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})

    const contract = new Contract()
    contract.aliceId = 'bybit-NONEXISTENT'

    const details = await acc.getContractDetails(contract)
    expect(details).toBeNull()
  })
})

// ==================== placeOrder (qty-based) ====================

describe('CcxtBroker — placeOrder qty-based', () => {
  let acc: CcxtBroker

  beforeEach(() => {
    acc = makeAccount()
    setInitialized(acc, {
      'BTC/USDT:USDT': makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT'),
    })
  })

  function makeContract(): Contract {
    const contract = new Contract()
    contract.aliceId = 'bybit-BTC/USDT:USDT'
    contract.symbol = 'BTC/USDT:USDT'
    contract.secType = 'CRYPTO_PERP'
    contract.exchange = 'bybit'
    contract.currency = 'USDT'
    return contract
  }

  it('places market order with totalQuantity', async () => {
    ;(acc as any).exchange.createOrder = vi.fn().mockResolvedValue({
      id: 'ord-mkt', status: 'open', average: undefined, filled: undefined,
    })

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(0.5)

    const result = await acc.placeOrder(makeContract(), order)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('ord-mkt')

    const call = (acc as any).exchange.createOrder.mock.calls[0]
    expect(call[0]).toBe('BTC/USDT:USDT') // symbol
    expect(call[1]).toBe('market')          // type
    expect(call[2]).toBe('buy')             // side
    expect(call[3]).toBe(0.5)               // size
    expect(call[4]).toBeUndefined()         // no price for market order
  })

  it('places limit order with lmtPrice passed correctly', async () => {
    ;(acc as any).exchange.createOrder = vi.fn().mockResolvedValue({
      id: 'ord-lmt', status: 'open', average: undefined, filled: undefined,
    })

    const order = new Order()
    order.action = 'SELL'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(1.0)
    order.lmtPrice = 65000

    const result = await acc.placeOrder(makeContract(), order)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('ord-lmt')

    const call = (acc as any).exchange.createOrder.mock.calls[0]
    expect(call[0]).toBe('BTC/USDT:USDT')
    expect(call[1]).toBe('limit')
    expect(call[2]).toBe('sell')
    expect(call[3]).toBe(1.0)
    expect(call[4]).toBe(65000)
  })

  it('returns error when contract cannot be resolved', async () => {
    const contract = new Contract()
    contract.aliceId = 'bybit-NONEXISTENT'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(1)

    const result = await acc.placeOrder(contract, order)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot resolve contract')
  })
})

// ==================== modifyOrder ====================

describe('CcxtBroker — modifyOrder', () => {
  it('calls exchange.editOrder with mapped fields', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'BTC/USDT:USDT': makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT') })
    ;(acc as any).orderSymbolCache.set('ord-100', 'BTC/USDT:USDT')
    ;(acc as any).exchange.fetchOrder = vi.fn().mockResolvedValue({
      type: 'limit', side: 'buy', amount: 0.5, price: 60000,
    })
    ;(acc as any).exchange.editOrder = vi.fn().mockResolvedValue({
      id: 'ord-100-edited', status: 'open',
    })

    const changes = new Order()
    changes.totalQuantity = new Decimal(0.75)
    changes.lmtPrice = 62000
    changes.orderType = 'LMT'

    const result = await acc.modifyOrder('ord-100', changes)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('ord-100-edited')

    const call = (acc as any).exchange.editOrder.mock.calls[0]
    expect(call[0]).toBe('ord-100')
    expect(call[1]).toBe('BTC/USDT:USDT')
    expect(call[2]).toBe('limit')
    expect(call[3]).toBe('buy')   // original side
    expect(call[4]).toBe(0.75)
    expect(call[5]).toBe(62000)
  })

  it('returns error when orderId is not in cache', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})

    const changes = new Order()
    changes.totalQuantity = new Decimal(1)

    const result = await acc.modifyOrder('unknown-order', changes)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown order')
  })
})

// ==================== closePosition ====================

describe('CcxtBroker — closePosition', () => {
  it('reverses position with market order and correct side', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT')
    setInitialized(acc, { 'BTC/USDT:USDT': market })

    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT:USDT',
        contracts: 0.5,
        contractSize: 1,
        markPrice: 60000,
        entryPrice: 58000,
        unrealizedPnl: 1000,
        side: 'long',
        leverage: 10,
        initialMargin: 2900,
        liquidationPrice: 50000,
      },
    ])
    ;(acc as any).exchange.createOrder = vi.fn().mockResolvedValue({
      id: 'close-1', status: 'closed',
    })

    const contract = new Contract()
    contract.aliceId = 'bybit-BTC/USDT:USDT'

    const result = await acc.closePosition(contract)
    expect(result.success).toBe(true)

    const call = (acc as any).exchange.createOrder.mock.calls[0]
    expect(call[2]).toBe('sell') // reverses long position
    expect(call[3]).toBe(0.5)   // full position size
  })

  it('returns error when no position found', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'BTC/USDT:USDT': makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT') })
    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([])

    const contract = new Contract()
    contract.aliceId = 'bybit-NONEXISTENT'

    const result = await acc.closePosition(contract)
    expect(result.success).toBe(false)
    expect(result.error).toContain('No open position')
  })
})

// ==================== getAccount ====================

describe('CcxtBroker — getAccount', () => {
  it('maps CCXT balance to AccountInfo', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})

    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      total: { USDT: 10000 },
      free: { USDT: 8000 },
      used: { USDT: 2000 },
    })
    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([
      { unrealizedPnl: 500, realizedPnl: 100 },
      { unrealizedPnl: -200, realizedPnl: 50 },
    ])

    const info = await acc.getAccount()
    expect(info.netLiquidation).toBe(10000)
    expect(info.totalCashValue).toBe(8000)
    expect(info.initMarginReq).toBe(2000)
    expect(info.unrealizedPnL).toBe(300)
    expect(info.realizedPnL).toBe(150)
  })

  it('throws when read-only', async () => {
    const acc = new CcxtBroker({ exchange: 'bybit', apiKey: '', apiSecret: '', defaultMarketType: 'swap', sandbox: false })
    ;(acc as any).initialized = true

    await expect(acc.getAccount()).rejects.toThrow('read-only')
  })
})

// ==================== getPositions ====================

describe('CcxtBroker — getPositions', () => {
  it('maps CCXT positions to Position[] with Decimal quantity', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT')
    setInitialized(acc, { 'BTC/USDT:USDT': market })

    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT:USDT',
        contracts: 2,
        contractSize: 1,
        markPrice: 60000,
        entryPrice: 58000,
        unrealizedPnl: 4000,
        side: 'long',
        leverage: 5,
        initialMargin: 23200,
        liquidationPrice: 48000,
      },
    ])

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity).toBeInstanceOf(Decimal)
    expect(positions[0].quantity.toNumber()).toBe(2)
    expect(positions[0].side).toBe('long')
    expect(positions[0].avgCost).toBe(58000)
    expect(positions[0].marketPrice).toBe(60000)
    expect(positions[0].leverage).toBe(5)
  })

  it('skips zero-size positions', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT')
    setInitialized(acc, { 'BTC/USDT:USDT': market })

    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT:USDT',
        contracts: 0,
        contractSize: 1,
        markPrice: 60000,
        entryPrice: 58000,
        unrealizedPnl: 0,
        side: 'long',
        leverage: 1,
        initialMargin: 0,
        liquidationPrice: 0,
      },
    ])

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(0)
  })

  it('skips positions without market data', async () => {
    const acc = makeAccount()
    setInitialized(acc, {}) // no markets loaded

    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'UNKNOWN/USDT:USDT',
        contracts: 1,
        contractSize: 1,
        markPrice: 100,
        entryPrice: 90,
        unrealizedPnl: 10,
        side: 'long',
        leverage: 1,
        initialMargin: 90,
        liquidationPrice: 0,
      },
    ])

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(0)
  })
})

// ==================== getOrders ====================

describe('CcxtBroker — getOrders', () => {
  it('merges fetchOpenOrders + fetchClosedOrders into OpenOrder[]', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT')
    setInitialized(acc, { 'BTC/USDT:USDT': market })

    ;(acc as any).exchange.fetchOpenOrders = vi.fn().mockResolvedValue([
      {
        id: '1001', symbol: 'BTC/USDT:USDT', side: 'buy', type: 'limit',
        amount: 0.1, price: 55000, status: 'open', average: undefined,
        filled: 0, lastTradeTimestamp: undefined, timestamp: Date.now(), reduceOnly: false,
      },
    ])
    ;(acc as any).exchange.fetchClosedOrders = vi.fn().mockResolvedValue([
      {
        id: '1002', symbol: 'BTC/USDT:USDT', side: 'sell', type: 'market',
        amount: 0.2, price: undefined, status: 'closed', average: 61000,
        filled: 0.2, lastTradeTimestamp: Date.now(), timestamp: Date.now(), reduceOnly: true,
      },
    ])

    const orders = await acc.getOrders()
    expect(orders).toHaveLength(2)

    // Check first order (open)
    expect(orders[0].order.action).toBe('BUY')
    expect(orders[0].order.totalQuantity.toNumber()).toBe(0.1)
    expect(orders[0].order.lmtPrice).toBe(55000)
    expect(orders[0].orderState.status).toBe('Submitted')

    // Check second order (closed)
    expect(orders[1].order.action).toBe('SELL')
    expect(orders[1].orderState.status).toBe('Filled')
  })

  it('caches orderId → symbol', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).exchange.fetchOpenOrders = vi.fn().mockResolvedValue([
      {
        id: '2001', symbol: 'ETH/USDT:USDT', side: 'buy', type: 'limit',
        amount: 1, price: 3000, status: 'open',
      },
    ])
    ;(acc as any).exchange.fetchClosedOrders = vi.fn().mockResolvedValue([])

    await acc.getOrders()
    expect((acc as any).orderSymbolCache.get('2001')).toBe('ETH/USDT:USDT')
  })

  it('handles fetchOpenOrders failure gracefully', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT')
    setInitialized(acc, { 'BTC/USDT:USDT': market })

    ;(acc as any).exchange.fetchOpenOrders = vi.fn().mockRejectedValue(new Error('not supported'))
    ;(acc as any).exchange.fetchClosedOrders = vi.fn().mockResolvedValue([
      {
        id: '3001', symbol: 'BTC/USDT:USDT', side: 'buy', type: 'market',
        amount: 0.5, price: undefined, status: 'closed',
      },
    ])

    const orders = await acc.getOrders()
    expect(orders).toHaveLength(1)
    expect(orders[0].order.action).toBe('BUY')
  })
})

// ==================== getQuote ====================

describe('CcxtBroker — getQuote', () => {
  it('returns mapped ticker data', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT')
    setInitialized(acc, { 'BTC/USDT:USDT': market })

    const now = Date.now()
    ;(acc as any).exchange.fetchTicker = vi.fn().mockResolvedValue({
      last: 60000, bid: 59990, ask: 60010, baseVolume: 1234.5,
      high: 61000, low: 59000, timestamp: now,
    })

    const contract = new Contract()
    contract.aliceId = 'bybit-BTC/USDT:USDT'

    const quote = await acc.getQuote(contract)
    expect(quote.last).toBe(60000)
    expect(quote.bid).toBe(59990)
    expect(quote.ask).toBe(60010)
    expect(quote.volume).toBe(1234.5)
    expect(quote.high).toBe(61000)
    expect(quote.low).toBe(59000)
    expect(quote.timestamp).toEqual(new Date(now))
  })

  it('throws when contract cannot be resolved', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})

    const contract = new Contract()
    contract.aliceId = 'bybit-NONEXISTENT'

    await expect(acc.getQuote(contract)).rejects.toThrow('Cannot resolve contract')
  })
})

// ==================== getMarketClock ====================

describe('CcxtBroker — getMarketClock', () => {
  it('returns isOpen: true with current timestamp (crypto 24/7)', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})

    const before = Date.now()
    const clock = await acc.getMarketClock()
    const after = Date.now()

    expect(clock.isOpen).toBe(true)
    expect(clock.timestamp!.getTime()).toBeGreaterThanOrEqual(before)
    expect(clock.timestamp!.getTime()).toBeLessThanOrEqual(after)
  })
})

// ==================== getCapabilities ====================

describe('CcxtBroker — getCapabilities', () => {
  it('returns CRYPTO secType and MKT/LMT order types', () => {
    const acc = makeAccount()
    const caps = acc.getCapabilities()
    expect(caps.supportedSecTypes).toEqual(['CRYPTO'])
    expect(caps.supportedOrderTypes).toEqual(['MKT', 'LMT'])
  })
})

// ==================== close ====================

describe('CcxtBroker — close', () => {
  it('resolves without error (no-op)', async () => {
    const acc = makeAccount()
    await expect(acc.close()).resolves.toBeUndefined()
  })
})
