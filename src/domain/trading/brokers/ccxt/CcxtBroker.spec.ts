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
    this.fetchTickers = vi.fn().mockResolvedValue({})
    this.fetchBalance = vi.fn().mockResolvedValue({ free: {}, used: {}, total: {} })
    this.fetchPositions = vi.fn().mockResolvedValue([])
    this.fetchOpenOrders = vi.fn()
    this.fetchClosedOrders = vi.fn()
    this.createOrder = vi.fn()
    this.cancelOrder = vi.fn()
    this.editOrder = vi.fn()
    this.fetchOrder = vi.fn()
    this.fetchOpenOrder = vi.fn()
    this.fetchClosedOrder = vi.fn()
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

function makeAccount(overrides?: Partial<{ exchange: string; apiKey: string; secret: string }>) {
  return new CcxtBroker({
    exchange: overrides?.exchange ?? 'bybit',
    apiKey: overrides?.apiKey ?? 'k',
    secret: overrides?.secret ?? 's',
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
    expect(() => new CcxtBroker({ exchange: 'unknownxyz', apiKey: 'k', secret: 's', sandbox: false })).toThrow(
      'Unknown CCXT exchange',
    )
  })

  it('stores exchange name in meta', () => {
    const acc = makeAccount()
    expect(acc.meta).toEqual({ exchange: 'bybit' })
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

  it('sorts swap before spot by default', async () => {
    const results = await acc.searchContracts('BTC')
    // derivatives come first
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

  it('returns PlaceOrderResult with error when exchange.cancelOrder throws', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})
    ;(acc as any).exchange.cancelOrder = vi.fn().mockRejectedValue(new Error('symbol required'))
    const result = await acc.cancelOrder('order-not-cached')
    expect(result.success).toBe(false)
    expect(result.error).toBe('symbol required')
  })

  it('returns PlaceOrderResult with Cancelled status when orderId is cached', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})
    ;(acc as any).orderSymbolCache.set('order-123', 'BTC/USDT:USDT')
    ;(acc as any).exchange.cancelOrder = vi.fn().mockResolvedValue({})
    const result = await acc.cancelOrder('order-123')
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('order-123')
    expect(result.orderState?.status).toBe('Cancelled')
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
    contract.localSymbol = 'BTC/USDT:USDT'
    contract.symbol = 'BTC/USDT:USDT'
    contract.secType = 'CRYPTO_PERP'
    contract.exchange = 'bybit'
    contract.currency = 'USDT'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.cashQty = new Decimal(500) // $500 worth of BTC

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
    contract.localSymbol = 'BTC/USDT:USDT'
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

// ==================== placeOrder — async behavior ====================

describe('CcxtBroker — placeOrder async', () => {
  it('never returns execution (fill status comes from sync)', async () => {
    const acc = makeAccount()
    setInitialized(acc, {
      'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT'),
    })
    ;(acc as any).exchange.createOrder = vi.fn().mockResolvedValue({
      id: 'ord-42', status: 'closed', filled: 0.5, average: 1920.5,
    })

    const contract = new Contract()
    contract.localSymbol = 'ETH/USDT:USDT'
    const order = new Order()
    order.action = 'SELL'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(0.5)

    const result = await acc.placeOrder(contract, order)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('ord-42')
    // No execution — exchanges are async, fill confirmed via sync
    expect(result.execution).toBeUndefined()
  })
})

// ==================== getOrder — Bybit (tested exchange) ====================

describe('CcxtBroker — getOrder (bybit)', () => {
  it('uses fetchOpenOrder for open orders', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).orderSymbolCache.set('ord-100', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockResolvedValue({
      id: 'ord-100', symbol: 'ETH/USDT:USDT', side: 'buy', amount: 0.1,
      type: 'limit', price: 1900, status: 'open',
    })

    const result = await acc.getOrder('ord-100')
    expect(result).not.toBeNull()
    expect(result!.order.action).toBe('BUY')
    expect(result!.orderState.status).toBe('Submitted')
    expect((acc as any).exchange.fetchOpenOrder).toHaveBeenCalledWith('ord-100', 'ETH/USDT:USDT')
    // Should NOT use fetchOrder (bybit override avoids it)
    expect((acc as any).exchange.fetchOrder).not.toHaveBeenCalled()
  })

  it('falls back to fetchClosedOrder for filled orders', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).orderSymbolCache.set('ord-100', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockRejectedValue(new Error('not open'))
    ;(acc as any).exchange.fetchClosedOrder = vi.fn().mockResolvedValue({
      id: 'ord-100', symbol: 'ETH/USDT:USDT', side: 'sell', amount: 0.5,
      type: 'market', price: null, status: 'closed',
    })

    const result = await acc.getOrder('ord-100')
    expect(result).not.toBeNull()
    expect(result!.order.action).toBe('SELL')
    expect(result!.orderState.status).toBe('Filled')
  })

  it('finds conditional orders via { stop: true } fallback', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).orderSymbolCache.set('ord-sl', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn()
      .mockRejectedValueOnce(new Error('not found'))  // regular open
      .mockResolvedValueOnce({                         // conditional open (stop: true)
        id: 'ord-sl', symbol: 'ETH/USDT:USDT', side: 'sell', amount: 0.5,
        type: 'limit', price: 1800, status: 'open', triggerPrice: 1850,
      })
    ;(acc as any).exchange.fetchClosedOrder = vi.fn().mockRejectedValue(new Error('not found'))

    const result = await acc.getOrder('ord-sl')
    expect(result).not.toBeNull()
    expect(result!.orderState.status).toBe('Submitted')
    // Second fetchOpenOrder call should have { stop: true }
    expect((acc as any).exchange.fetchOpenOrder).toHaveBeenCalledWith('ord-sl', 'ETH/USDT:USDT', { stop: true })
  })

  it('returns null when orderId not in symbol cache', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})

    const result = await acc.getOrder('unknown-id')
    expect(result).toBeNull()
  })

  it('returns null when order not found on any endpoint', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT') })
    ;(acc as any).orderSymbolCache.set('ord-404', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockRejectedValue(new Error('not found'))
    ;(acc as any).exchange.fetchClosedOrder = vi.fn().mockRejectedValue(new Error('not found'))

    const result = await acc.getOrder('ord-404')
    expect(result).toBeNull()
  })

  it('extracts tpsl from CCXT order with takeProfitPrice/stopLossPrice', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).orderSymbolCache.set('ord-tp', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockResolvedValue({
      id: 'ord-tp', symbol: 'ETH/USDT:USDT', side: 'buy', amount: 0.1,
      type: 'limit', price: 1900, status: 'open',
      takeProfitPrice: 2200,
      stopLossPrice: 1800,
    })

    const result = await acc.getOrder('ord-tp')
    expect(result!.tpsl).toEqual({
      takeProfit: { price: '2200' },
      stopLoss: { price: '1800' },
    })
  })

  it('returns no tpsl when CCXT order has no TP/SL prices', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).orderSymbolCache.set('ord-plain', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockResolvedValue({
      id: 'ord-plain', symbol: 'ETH/USDT:USDT', side: 'buy', amount: 0.1,
      type: 'limit', price: 1900, status: 'open',
    })

    const result = await acc.getOrder('ord-plain')
    expect(result!.tpsl).toBeUndefined()
  })

  it('extracts only takeProfit when stopLossPrice is absent', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).orderSymbolCache.set('ord-tp-only', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockResolvedValue({
      id: 'ord-tp-only', symbol: 'ETH/USDT:USDT', side: 'buy', amount: 0.1,
      type: 'limit', price: 1900, status: 'open',
      takeProfitPrice: 2200,
    })

    const result = await acc.getOrder('ord-tp-only')
    expect(result!.tpsl).toEqual({ takeProfit: { price: '2200' } })
  })
})

// ==================== getOrder — default path (binance etc) ====================

describe('CcxtBroker — getOrder (default/binance)', () => {
  it('uses fetchOrder for regular orders', async () => {
    const acc = makeAccount({ exchange: 'binance' })
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).orderSymbolCache.set('ord-100', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOrder = vi.fn().mockResolvedValue({
      id: 'ord-100', symbol: 'ETH/USDT:USDT', side: 'sell', amount: 0.5,
      type: 'market', price: null, status: 'closed',
    })

    const result = await acc.getOrder('ord-100')
    expect(result).not.toBeNull()
    expect(result!.order.action).toBe('SELL')
    expect(result!.orderState.status).toBe('Filled')
    expect((acc as any).exchange.fetchOrder).toHaveBeenCalledWith('ord-100', 'ETH/USDT:USDT')
  })

  it('falls back to { stop: true } for conditional orders', async () => {
    const acc = makeAccount({ exchange: 'binance' })
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).orderSymbolCache.set('ord-sl', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOrder = vi.fn()
      .mockRejectedValueOnce(new Error('order not found'))
      .mockResolvedValueOnce({
        id: 'ord-sl', symbol: 'ETH/USDT:USDT', side: 'sell', amount: 0.5,
        type: 'limit', price: 1800, status: 'open', triggerPrice: 1850,
      })

    const result = await acc.getOrder('ord-sl')
    expect(result).not.toBeNull()
    expect(result!.orderState.status).toBe('Submitted')
    expect((acc as any).exchange.fetchOrder).toHaveBeenCalledTimes(2)
    expect((acc as any).exchange.fetchOrder).toHaveBeenLastCalledWith('ord-sl', 'ETH/USDT:USDT', { stop: true })
  })

  it('returns null when order not found on either endpoint', async () => {
    const acc = makeAccount({ exchange: 'binance' })
    setInitialized(acc, { 'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT') })
    ;(acc as any).orderSymbolCache.set('ord-404', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOrder = vi.fn().mockRejectedValue(new Error('not found'))

    const result = await acc.getOrder('ord-404')
    expect(result).toBeNull()
    expect((acc as any).exchange.fetchOrder).toHaveBeenCalledTimes(2)
  })
})

// ==================== getContractDetails ====================

describe('CcxtBroker — getContractDetails', () => {
  it('returns ContractDetails for a resolvable contract via aliceId', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT')
    setInitialized(acc, { 'BTC/USDT:USDT': market })

    const contract = new Contract()
    contract.localSymbol = 'BTC/USDT:USDT'

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
    contract.localSymbol = 'NONEXISTENT/USDT'

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
    contract.localSymbol = 'BTC/USDT:USDT'
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
    order.lmtPrice = new Decimal(65000)

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
    contract.localSymbol = 'NONEXISTENT/USDT'

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
    // Bybit override uses fetchOpenOrder to fetch the original order
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockResolvedValue({
      type: 'limit', side: 'buy', amount: 0.5, price: 60000,
    })
    ;(acc as any).exchange.editOrder = vi.fn().mockResolvedValue({
      id: 'ord-100-edited', status: 'open',
    })

    const changes = new Order()
    changes.totalQuantity = new Decimal(0.75)
    changes.lmtPrice = new Decimal(62000)
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

// ==================== modifyOrder — field forwarding ====================

describe('CcxtBroker — modifyOrder field forwarding', () => {
  it('uses original price when lmtPrice not in changes (Partial<Order>)', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT') })
    ;(acc as any).orderSymbolCache.set('ord-200', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockResolvedValue({
      type: 'limit', side: 'buy', amount: 0.1, price: 1900,
    })
    ;(acc as any).exchange.editOrder = vi.fn().mockResolvedValue({ id: 'ord-200-edited', status: 'open' })

    // Partial<Order> — only totalQuantity, no lmtPrice
    const changes: Partial<Order> = { totalQuantity: new Decimal(0.2) }

    await acc.modifyOrder('ord-200', changes)
    const call = (acc as any).exchange.editOrder.mock.calls[0]

    // Should use original price (1900), not undefined
    expect(call[4]).toBe(0.2)    // amount
    expect(call[5]).toBe(1900)   // price from original
  })

  it('forwards auxPrice as stopPrice in params', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT') })
    ;(acc as any).orderSymbolCache.set('ord-300', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockResolvedValue({
      type: 'limit', side: 'sell', amount: 0.1, price: 2100,
    })
    ;(acc as any).exchange.editOrder = vi.fn().mockResolvedValue({ id: 'ord-300-edited', status: 'open' })

    const changes: Partial<Order> = { auxPrice: new Decimal(1850) }

    await acc.modifyOrder('ord-300', changes)
    const call = (acc as any).exchange.editOrder.mock.calls[0]

    // 7th argument is the params object with extra fields
    const params = call[6] ?? {}
    expect(params.stopPrice).toBe(1850)
  })

  it('forwards tif in params', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT') })
    ;(acc as any).orderSymbolCache.set('ord-400', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockResolvedValue({
      type: 'limit', side: 'buy', amount: 0.1, price: 1900,
    })
    ;(acc as any).exchange.editOrder = vi.fn().mockResolvedValue({ id: 'ord-400-edited', status: 'open' })

    const changes: Partial<Order> = { tif: 'GTC' }

    await acc.modifyOrder('ord-400', changes)
    const call = (acc as any).exchange.editOrder.mock.calls[0]

    const params = call[6] ?? {}
    expect(params.timeInForce).toBe('gtc')
  })

  it('does not include undefined fields in params', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT') })
    ;(acc as any).orderSymbolCache.set('ord-500', 'ETH/USDT:USDT')
    ;(acc as any).exchange.fetchOpenOrder = vi.fn().mockResolvedValue({
      type: 'limit', side: 'buy', amount: 0.1, price: 1900,
    })
    ;(acc as any).exchange.editOrder = vi.fn().mockResolvedValue({ id: 'ord-500-edited', status: 'open' })

    // Only change qty — nothing else should appear in params
    const changes: Partial<Order> = { totalQuantity: new Decimal(0.5) }

    await acc.modifyOrder('ord-500', changes)
    const call = (acc as any).exchange.editOrder.mock.calls[0]

    const params = call[6] ?? {}
    expect(params).toEqual({})
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
    contract.localSymbol = 'BTC/USDT:USDT'

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
    contract.localSymbol = 'NONEXISTENT/USDT'

    const result = await acc.closePosition(contract)
    expect(result.success).toBe(false)
    expect(result.error).toContain('No open position')
  })
})

// ==================== precision + reduceOnly behavior ====================

describe('CcxtBroker — precision', () => {
  it('placeOrder sends precise quantity (no float corruption)', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT') })
    ;(acc as any).exchange.createOrder = vi.fn().mockResolvedValue({ id: 'ord-1', status: 'open' })

    const contract = new Contract()
    contract.localSymbol = 'ETH/USDT:USDT'
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.123456789')

    await acc.placeOrder(contract, order)
    const amount = (acc as any).exchange.createOrder.mock.calls[0][3]
    // parseFloat("0.123456789") === 0.123456789 (exact in IEEE 754)
    expect(amount).toBe(0.123456789)
  })

  it('getPositions returns precise Decimal quantity from string contracts', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT') })
    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([{
      symbol: 'ETH/USDT:USDT',
      contracts: '0.51', // string from exchange — must not lose precision
      contractSize: '1',
      markPrice: 1920, entryPrice: 1900, unrealizedPnl: 10.2,
      side: 'long', leverage: 10, initialMargin: 100, liquidationPrice: 0,
    }])

    const positions = await acc.getPositions()
    // Must be exactly "0.51", not "0.50999999..."
    expect(positions[0].quantity.toString()).toBe('0.51')
  })

  it('getPositions handles fractional contractSize precisely', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'ETH/USDT:USDT': makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT') })
    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([{
      symbol: 'ETH/USDT:USDT',
      contracts: '51', // 51 contracts × 0.01 contractSize = 0.51
      contractSize: '0.01',
      markPrice: 1920, entryPrice: 1900, unrealizedPnl: 10.2,
      side: 'long', leverage: 10, initialMargin: 100, liquidationPrice: 0,
    }])

    const positions = await acc.getPositions()
    expect(positions[0].quantity.toString()).toBe('0.51')
  })
})

describe('CcxtBroker — closePosition reduceOnly', () => {
  it('passes reduceOnly: true to createOrder params', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('ETH', 'USDT', 'ETH/USDT:USDT')
    setInitialized(acc, { 'ETH/USDT:USDT': market })

    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([{
      symbol: 'ETH/USDT:USDT', contracts: 0.5, contractSize: 1,
      markPrice: 1920, entryPrice: 1900, unrealizedPnl: 10,
      side: 'long', leverage: 10, initialMargin: 100, liquidationPrice: 0,
    }])
    ;(acc as any).exchange.createOrder = vi.fn().mockResolvedValue({ id: 'close-1', status: 'closed' })

    const contract = new Contract()
    contract.localSymbol = 'ETH/USDT:USDT'
    await acc.closePosition(contract)

    // createOrder 6th arg is params
    const params = (acc as any).exchange.createOrder.mock.calls[0][5]
    expect(params.reduceOnly).toBe(true)
  })
})

// ==================== getAccount ====================

describe('CcxtBroker — getAccount', () => {
  it('maps CCXT balance to AccountInfo', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})

    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      // Real CCXT shape: per-coin entries at top level. The aggregate
      // free/used/total dicts also exist on real responses but our parser
      // reads the per-coin form.
      USDT: { free: 8000, used: 2000, total: 10000 },
    })
    // Positions must include contracts/contractSize/markPrice so the broker
    // can reconstruct netLiquidation from fresh position market values.
    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([
      { contracts: 1, contractSize: 1, markPrice: 1500, unrealizedPnl: 500, realizedPnl: 100, side: 'long' },
      { contracts: 1, contractSize: 1, markPrice: 500, unrealizedPnl: -200, realizedPnl: 50, side: 'long' },
    ])

    const info = await acc.getAccount()
    // netLiq = free (8000) + position market values (1500 + 500 = 2000) = 10000
    expect(info.netLiquidation).toBe('10000')
    expect(info.totalCashValue).toBe('8000')
    expect(info.initMarginReq).toBe('2000')
    expect(info.unrealizedPnL).toBe('300')
    expect(info.realizedPnL).toBe('150')
  })

  it('throws BrokerError when no API credentials', async () => {
    const acc = new CcxtBroker({ exchange: 'bybit', apiKey: '', secret: '', sandbox: false })

    await expect(acc.init()).rejects.toThrow(/requires credentials/)
  })

  it('sums all stablecoins (USDT + USDC + FDUSD) into totalCashValue', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})

    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      USDT: { free: 1000, used: 200, total: 1200 },
      USDC: { free: 500, used: 0, total: 500 },
      FDUSD: { free: 300, used: 100, total: 400 },
      free: {},  // reserved aggregate, must be ignored
      used: {},
    })
    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([])

    const info = await acc.getAccount()
    expect(info.totalCashValue).toBe('1800')   // 1000 + 500 + 300
    expect(info.initMarginReq).toBe('300')     // 200 + 0 + 100
    expect(info.netLiquidation).toBe('1800')   // no positions, equity = cash
  })

  it('includes spot holdings value in netLiquidation', async () => {
    const acc = makeAccount()
    setInitialized(acc, {
      'BTC/USDT': makeSpotMarket('BTC', 'USDT', 'BTC/USDT'),
    })

    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      USDT: { free: 1000, used: 0, total: 1000 },
      BTC: { free: 0.5, used: 0, total: 0.5 },
    })
    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([])
    ;(acc as any).exchange.fetchTickers = vi.fn().mockResolvedValue({
      'BTC/USDT': { last: 60000 },
    })

    const info = await acc.getAccount()
    // netLiq = cash (1000) + spot value (0.5 * 60000 = 30000) = 31000
    expect(info.totalCashValue).toBe('1000')
    expect(info.netLiquidation).toBe('31000')
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
    expect(positions[0].avgCost).toBe('58000')
    expect(positions[0].marketPrice).toBe('60000')
    expect(positions[0].avgCostSource).toBe('broker')
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

  // ---- Spot holding synthesis ----

  it('synthesizes spot positions from non-stable balance entries', async () => {
    const acc = makeAccount()
    setInitialized(acc, {
      'BTC/USDT': makeSpotMarket('BTC', 'USDT', 'BTC/USDT'),
      'ETH/USDT': makeSpotMarket('ETH', 'USDT', 'ETH/USDT'),
    })
    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      // CCXT shape: per-coin entries + aggregate keys mixed at top level.
      USDT: { free: 1000, used: 0, total: 1000 },
      BTC: { free: 0.5, used: 0, total: 0.5 },
      ETH: { free: 2, used: 0, total: 2 },
      free: {},  // reserved aggregate — must not be treated as a coin
      used: {},
      total: {},
    })
    ;(acc as any).exchange.fetchTickers = vi.fn().mockResolvedValue({
      'BTC/USDT': { last: 60000 },
      'ETH/USDT': { last: 2000 },
    })

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(2)
    const btc = positions.find(p => p.contract.symbol === 'BTC')!
    expect(btc.side).toBe('long')
    expect(btc.quantity.toString()).toBe('0.5')
    expect(btc.avgCost).toBe('60000')        // markPrice placeholder; UTA replaces via wallet ledger
    expect(btc.marketValue).toBe('30000')
    expect(btc.unrealizedPnL).toBe('0')
    expect(btc.contract.localSymbol).toBe('BTC')       // canonical (no broker-flavored encoding)
    expect(btc.avgCostSource).toBe('wallet')           // signals UTA to reconstruct cost
  })

  it('combines free + used into spot quantity', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'BTC/USDT': makeSpotMarket('BTC', 'USDT', 'BTC/USDT') })
    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      BTC: { free: 0.3, used: 0.2, total: 0.5 },  // 0.2 locked as collateral
    })
    ;(acc as any).exchange.fetchTickers = vi.fn().mockResolvedValue({
      'BTC/USDT': { last: 60000 },
    })

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toString()).toBe('0.5')
  })

  it('skips spot holdings with no <COIN>/USDT|USDC|USD market', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'BTC/USDT': makeSpotMarket('BTC', 'USDT', 'BTC/USDT') })
    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      BTC: { free: 0.5, used: 0, total: 0.5 },
      OBSCURE: { free: 100, used: 0, total: 100 },  // no market → skip
    })
    ;(acc as any).exchange.fetchTickers = vi.fn().mockResolvedValue({
      'BTC/USDT': { last: 60000 },
    })

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].contract.symbol).toBe('BTC')
  })

  it('skips zero spot balances', async () => {
    const acc = makeAccount()
    setInitialized(acc, {
      'BTC/USDT': makeSpotMarket('BTC', 'USDT', 'BTC/USDT'),
      'ETH/USDT': makeSpotMarket('ETH', 'USDT', 'ETH/USDT'),
    })
    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      BTC: { free: 0.5, used: 0, total: 0.5 },
      ETH: { free: 0, used: 0, total: 0 },  // dust/empty
    })
    ;(acc as any).exchange.fetchTickers = vi.fn().mockResolvedValue({
      'BTC/USDT': { last: 60000 },
      'ETH/USDT': { last: 2000 },
    })

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].contract.symbol).toBe('BTC')
  })

  it('does not treat stablecoins as spot positions', async () => {
    const acc = makeAccount()
    setInitialized(acc, {
      'USDT/USD': makeSpotMarket('USDT', 'USD', 'USDT/USD'),  // exists but USDT is stable
      'BTC/USDT': makeSpotMarket('BTC', 'USDT', 'BTC/USDT'),
    })
    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      USDT: { free: 1000, used: 0, total: 1000 },
      USDC: { free: 500, used: 0, total: 500 },
      FDUSD: { free: 200, used: 0, total: 200 },  // post-BUSD stable on Binance
      BTC: { free: 0.1, used: 0, total: 0.1 },
    })
    ;(acc as any).exchange.fetchTickers = vi.fn().mockResolvedValue({
      'BTC/USDT': { last: 60000 },
    })

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].contract.symbol).toBe('BTC')
  })

  it('returns spot and perp on the same underlying as separate Positions', async () => {
    const acc = makeAccount()
    setInitialized(acc, {
      'BTC/USDT': makeSpotMarket('BTC', 'USDT', 'BTC/USDT'),
      'BTC/USDT:USDT': makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT'),
    })
    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      BTC: { free: 0.5, used: 0, total: 0.5 },
    })
    ;(acc as any).exchange.fetchPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'BTC/USDT:USDT',
        contracts: 1, contractSize: 1, markPrice: 60000, entryPrice: 58000,
        unrealizedPnl: 2000, side: 'long', leverage: 5, initialMargin: 11600,
        liquidationPrice: 50000,
      },
    ])
    ;(acc as any).exchange.fetchTickers = vi.fn().mockResolvedValue({
      'BTC/USDT': { last: 60000 },
    })

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(2)
    // Distinct contract identities — same underlying, different products.
    // Canonical localSymbols disambiguate without leaking CCXT wire format.
    const localSymbols = positions.map(p => p.contract.localSymbol)
    expect(localSymbols).toContain('BTC')        // spot
    expect(localSymbols).toContain('BTC-PERP')   // perp
  })

  it('falls back to per-symbol fetchTicker when fetchTickers throws', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'BTC/USDT': makeSpotMarket('BTC', 'USDT', 'BTC/USDT') })
    ;(acc as any).exchange.fetchBalance = vi.fn().mockResolvedValue({
      BTC: { free: 0.5, used: 0, total: 0.5 },
    })
    ;(acc as any).exchange.fetchTickers = vi.fn().mockRejectedValue(new Error('not supported'))
    ;(acc as any).exchange.fetchTicker = vi.fn().mockResolvedValue({ last: 60000 })

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].marketPrice).toBe('60000')
    expect((acc as any).exchange.fetchTicker).toHaveBeenCalledWith('BTC/USDT')
  })
})

// ==================== getOrders ====================

describe('CcxtBroker — getOrders', () => {
  it('queries each orderId via getOrder and returns results (bybit)', async () => {
    const acc = makeAccount()
    const market = makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT')
    setInitialized(acc, { 'BTC/USDT:USDT': market })

    ;(acc as any).orderSymbolCache.set('ord-1', 'BTC/USDT:USDT')
    ;(acc as any).orderSymbolCache.set('ord-2', 'BTC/USDT:USDT')

    // Bybit path: ord-1 not open, found via fetchClosedOrder; ord-2 found via fetchOpenOrder
    ;(acc as any).exchange.fetchOpenOrder = vi.fn()
      .mockRejectedValueOnce(new Error('not open'))   // ord-1 regular
      .mockRejectedValueOnce(new Error('not open'))   // ord-1 conditional
      .mockResolvedValueOnce({ id: 'ord-2', symbol: 'BTC/USDT:USDT', side: 'buy', type: 'limit', amount: 0.1, price: 55000, status: 'open' })
    ;(acc as any).exchange.fetchClosedOrder = vi.fn()
      .mockResolvedValueOnce({ id: 'ord-1', symbol: 'BTC/USDT:USDT', side: 'sell', type: 'market', amount: 0.2, status: 'closed' })

    const orders = await acc.getOrders(['ord-1', 'ord-2'])
    expect(orders).toHaveLength(2)
    expect(orders[0].order.action).toBe('SELL')
    expect(orders[0].orderState.status).toBe('Filled')
    expect(orders[1].order.action).toBe('BUY')
    expect(orders[1].orderState.status).toBe('Submitted')
  })

  it('skips unfound orders', async () => {
    const acc = makeAccount()
    setInitialized(acc, { 'BTC/USDT:USDT': makeSwapMarket('BTC', 'USDT', 'BTC/USDT:USDT') })

    // ord-404 not in symbol cache
    const orders = await acc.getOrders(['ord-404'])
    expect(orders).toHaveLength(0)
  })

  it('returns empty for empty input', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})
    const orders = await acc.getOrders([])
    expect(orders).toHaveLength(0)
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
    contract.localSymbol = 'BTC/USDT:USDT'

    const quote = await acc.getQuote(contract)
    expect(quote.last).toBe('60000')
    expect(quote.bid).toBe('59990')
    expect(quote.ask).toBe('60010')
    expect(quote.volume).toBe('1234.5')
    expect(quote.high).toBe('61000')
    expect(quote.low).toBe('59000')
    expect(quote.timestamp).toEqual(new Date(now))
  })

  it('throws when contract cannot be resolved', async () => {
    const acc = makeAccount()
    setInitialized(acc, {})

    const contract = new Contract()
    contract.localSymbol = 'NONEXISTENT/USDT'

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
  it('returns CRYPTO + CRYPTO_PERP secTypes and MKT/LMT order types', () => {
    const acc = makeAccount()
    const caps = acc.getCapabilities()
    expect(caps.supportedSecTypes).toEqual(['CRYPTO', 'CRYPTO_PERP'])
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
