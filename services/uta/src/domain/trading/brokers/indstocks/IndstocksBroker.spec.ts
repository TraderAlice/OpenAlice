import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { IndstocksBroker } from './IndstocksBroker.js'
import { makeContract } from './indstocks-contracts.js'
import { BrokerError } from '../types.js'
import type { IndstocksInstrument } from './indstocks-types.js'
import '../../contract-ext.js'

// ==================== IndstocksClient mock ====================
// init() constructs `new IndstocksClient(token)` internally, so the module is
// mocked. Method-level tests bypass init() and inject a plain fake into
// (broker as any).client + (broker as any).catalog instead.

vi.mock('./indstocks-client.js', () => {
  const IndstocksClient = vi.fn(function (this: any) {
    this.getProfile = vi.fn().mockResolvedValue({ status: 'success' })
    this.getInstruments = vi.fn().mockResolvedValue([])
    this.getFunds = vi.fn()
    this.getHoldings = vi.fn()
    this.getPositions = vi.fn()
    this.placeOrder = vi.fn()
    this.modifyOrder = vi.fn()
    this.cancelOrder = vi.fn()
    this.getOrder = vi.fn()
    this.getOrderBook = vi.fn()
    this.getQuotes = vi.fn()
    this.getHistorical = vi.fn()
    this.setToken = vi.fn()
  })
  return { IndstocksClient }
})

// ==================== ws mock (controllable fake socket) ====================

vi.mock('ws', () => {
  class FakeWS {
    static instances: FakeWS[] = []
    handlers: Record<string, Array<(...a: any[]) => void>> = {}
    sent: string[] = []
    constructor(public url: string, public opts: any) { FakeWS.instances.push(this) }
    on(ev: string, cb: (...a: any[]) => void) { (this.handlers[ev] ??= []).push(cb); return this }
    send(d: string) { this.sent.push(d) }
    close() { this.emit('close') }
    emit(ev: string, ...args: any[]) { (this.handlers[ev] ?? []).forEach(h => h(...args)) }
  }
  return { default: FakeWS }
})

// Catalog with one NSE equity (RELIANCE → security_id 2885).
const RELIANCE: IndstocksInstrument = {
  securityId: '2885',
  tradingSymbol: 'RELIANCE',
  exch: 'NSE',
  segment: 'E',
  instrumentName: 'EQUITY',
  customSymbol: 'Reliance Industries',
}
const catalog = () => new Map<string, IndstocksInstrument>([['NSE:RELIANCE', RELIANCE]])

function broker() {
  return new IndstocksBroker({ accessToken: 'tok', userId: 'CLIENT1' })
}

// ==================== init() ====================

describe('IndstocksBroker — init()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws CONFIG when no access token is configured', async () => {
    const b = new IndstocksBroker({ accessToken: '', userId: 'CLIENT1' })
    await expect(b.init()).rejects.toThrow('No INDstocks access token')
  })

  it('resolves when the token probe (getProfile) succeeds', async () => {
    const b = broker()
    await expect(b.init()).resolves.toBeUndefined()
  })

  it('HALTS immediately on a 403/AUTH token error — no retries (daily-token wall)', async () => {
    const b = broker()
    const { IndstocksClient } = await import('./indstocks-client.js')
    const getProfile = vi.fn().mockRejectedValue(
      new BrokerError('AUTH', 'INDstocks access token expired or invalid.'),
    )
    ;(IndstocksClient as any).mockImplementationOnce(function (this: any) {
      this.getProfile = getProfile
      this.getInstruments = vi.fn().mockResolvedValue([])
    })
    await expect(b.init()).rejects.toThrow(/token expired or invalid/i)
    // Permanent AUTH error must NOT be retried — exactly one probe.
    expect(getProfile).toHaveBeenCalledTimes(1)
  })

  it('retries a transient (non-permanent) error before giving up', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any })
    const b = broker()
    const { IndstocksClient } = await import('./indstocks-client.js')
    const getProfile = vi.fn().mockRejectedValue(new Error('network blip'))
    ;(IndstocksClient as any).mockImplementationOnce(function (this: any) {
      this.getProfile = getProfile
      this.getInstruments = vi.fn().mockResolvedValue([])
    })
    await expect(b.init()).rejects.toThrow('network blip')
    expect(getProfile.mock.calls.length).toBeGreaterThan(1)
  })
})

// ==================== searchContracts() ====================

describe('IndstocksBroker — searchContracts()', () => {
  it('returns [] for an empty pattern', async () => {
    expect(await broker().searchContracts('')).toEqual([])
  })

  it('echoes an uppercased contract when the catalog has not loaded', async () => {
    const results = await broker().searchContracts('reliance')
    expect(results).toHaveLength(1)
    expect(results[0].contract.symbol).toBe('RELIANCE')
  })

  it('fuzzy-matches against a loaded catalog', async () => {
    const b = broker()
    ;(b as any).catalog = catalog()
    const results = await b.searchContracts('RELIANCE')
    expect(results.some(r => r.contract.symbol === 'RELIANCE')).toBe(true)
  })
})

// ==================== placeOrder() ====================

describe('IndstocksBroker — placeOrder()', () => {
  beforeEach(() => vi.clearAllMocks())

  function armed() {
    const b = broker()
    const placeOrder = vi.fn().mockResolvedValue({
      status: 'success',
      data: { order_id: 'DRV-1', order_status: 'O-PENDING' },
    })
    ;(b as any).client = { placeOrder }
    ;(b as any).catalog = catalog()
    return { b, placeOrder }
  }

  it('maps a LIMIT order to the INDstocks body and returns the order id', async () => {
    const { b, placeOrder } = armed()
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = new Decimal('1450.5')
    order.tif = 'DAY'

    const res = await b.placeOrder(makeContract('RELIANCE'), order)
    expect(res.success).toBe(true)
    expect(res.orderId).toBe('DRV-1')
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({
      txn_type: 'BUY',
      exchange: 'NSE',
      segment: 'EQUITY',
      order_type: 'LIMIT',
      validity: 'DAY',
      security_id: '2885',
      qty: 10,
      algo_id: '99999',
      limit_price: 1450.5,
    }))
  })

  it('maps a MARKET order with no limit_price', async () => {
    const { b, placeOrder } = armed()
    const order = new Order()
    order.action = 'SELL'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(5)

    const res = await b.placeOrder(makeContract('RELIANCE'), order)
    expect(res.success).toBe(true)
    const body = placeOrder.mock.calls[0][0]
    expect(body.order_type).toBe('MARKET')
    expect(body.txn_type).toBe('SELL')
    expect(body.limit_price).toBeUndefined()
  })

  it('fails on a catalog miss (cannot resolve security_id)', async () => {
    const b = broker()
    ;(b as any).client = { placeOrder: vi.fn() }
    ;(b as any).catalog = catalog()
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(1)
    const res = await b.placeOrder(makeContract('UNKNOWNCO'), order)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/catalog miss/i)
  })

  it('routes attached TP/SL to a GTT smart order and returns the child leg', async () => {
    const b = broker()
    const placeSmartOrder = vi.fn().mockResolvedValue({
      status: 'success',
      data: { order_data: [{
        order_id: 'EQ-100',
        order_status: 'CREATED',
        child_order_details: { order_id: 'GTT-200', order_status: 'CREATED' },
      }] },
    })
    const placeOrder = vi.fn()
    ;(b as any).client = { placeSmartOrder, placeOrder }
    ;(b as any).catalog = catalog()

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(1)
    order.lmtPrice = new Decimal('1450')

    const res = await b.placeOrder(makeContract('RELIANCE'), order, {
      stopLoss: { price: '1400' },
      takeProfit: { price: '1550' },
    })
    expect(placeOrder).not.toHaveBeenCalled()   // bracket → smart order, not /order
    expect(res.success).toBe(true)
    expect(res.orderId).toBe('EQ-100')
    expect(res.legs).toEqual([{ orderId: 'GTT-200', kind: 'stopLoss' }])
    const body = placeSmartOrder.mock.calls[0][0]
    expect(body.sl_trigger_price).toBe(1400)
    expect(body.tgt_trigger_price).toBe(1550)
    expect(body.security_id).toBe('2885')
  })

  it('refuses a zero/unset quantity', async () => {
    const { b } = armed()
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(0)
    const res = await b.placeOrder(makeContract('RELIANCE'), order)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/positive integer/i)
  })
})

// ==================== cancelOrder() ====================

describe('IndstocksBroker — cancelOrder()', () => {
  it('returns Cancelled state on success', async () => {
    const b = broker()
    ;(b as any).client = { cancelOrder: vi.fn().mockResolvedValue({ status: 'success' }) }
    const res = await b.cancelOrder('DRV-1')
    expect(res.success).toBe(true)
    expect(res.orderState?.status).toBe('Cancelled')
  })
})

// ==================== getPositions() ====================

describe('IndstocksBroker — getPositions()', () => {
  it('maps holdings (long, LTP-enriched) and short positions, in INR', async () => {
    // Verified live shape: holdings have symbol/total_qty/avg_price, no LTP →
    // broker batches /market/quotes/ltp (security_id is the NSE id).
    const b = broker()
    ;(b as any).client = {
      getHoldings: vi.fn().mockResolvedValue({ data: [{
        symbol: 'RELIANCE', security_id: '2885', total_qty: 10, avg_price: 1400,
      }] }),
      getLtp: vi.fn().mockResolvedValue({ data: { 'NSE_2885': { live_price: 1450 } } }),
      getPositions: vi.fn().mockResolvedValue({ data: [{
        trading_symbol: 'TCS', exchange: 'NSE',
        net_quantity: -5, average_price: 3800, last_traded_price: 3750,
      }] }),
    }
    const positions = await b.getPositions()
    expect(positions).toHaveLength(2)

    const reliance = positions.find(p => p.contract.symbol === 'RELIANCE')!
    expect(reliance.side).toBe('long')
    expect(reliance.currency).toBe('INR')
    expect(reliance.quantity.toString()).toBe('10')
    expect(reliance.marketPrice).toBe('1450')
    expect(reliance.unrealizedPnL).toBe('500')   // (1450-1400)*10, derived from live LTP

    const tcs = positions.find(p => p.contract.symbol === 'TCS')!
    expect(tcs.side).toBe('short')
    expect(tcs.quantity.toString()).toBe('5')
  })
})

// ==================== getAccount() ====================

describe('IndstocksBroker — getAccount()', () => {
  it('reports INR cash, direct unrealized PnL, and CNC buying power', async () => {
    // Verified live /funds shape: withdrawal_balance / unrealized_pnl /
    // detailed_avl_balance.eq_cnc.
    const b = broker()
    ;(b as any).client = {
      getFunds: vi.fn().mockResolvedValue({ data: {
        withdrawal_balance: 100000, unrealized_pnl: 500, realized_pnl: 0,
        detailed_avl_balance: { eq_cnc: 250000 },
      } }),
      getHoldings: vi.fn().mockResolvedValue({ data: [{
        symbol: 'RELIANCE', security_id: '2885', total_qty: 10, avg_price: 1400,
      }] }),
      getLtp: vi.fn().mockResolvedValue({ data: { 'NSE_2885': { live_price: 1450 } } }),
      getPositions: vi.fn().mockResolvedValue({ data: [] }),
    }
    const acc = await b.getAccount()
    expect(acc.baseCurrency).toBe('INR')
    expect(acc.totalCashValue).toBe('100000')
    expect(acc.unrealizedPnL).toBe('500')
    expect(acc.buyingPower).toBe('250000')
    expect(acc.netLiquidation).toBe('114500')   // cash 100000 + MV 14500
  })
})

// ==================== getQuote() ====================

describe('IndstocksBroker — getQuote()', () => {
  it('builds the scrip-code, maps live_price → last, parses depth bid/ask (comma strings)', async () => {
    // Verified live shape: bid/ask nested in market_depth[code].depth[0] as
    // comma-formatted strings ("1,455.00").
    const b = broker()
    const getQuotes = vi.fn().mockResolvedValue({
      data: { 'NSE_2885': {
        live_price: 1455.25, day_high: 1460, day_low: 1450, volume: 1200000,
        market_depth: { 'NSE_2885': { depth: [
          { buy: { quantity: '1,055', price: '1,455.00' }, sell: { quantity: '0.00', price: '1,455.50' } },
        ] } },
      } },
    })
    ;(b as any).client = { getQuotes }
    ;(b as any).catalog = catalog()

    const q = await b.getQuote(makeContract('RELIANCE'))
    expect(getQuotes).toHaveBeenCalledWith(['NSE_2885'])
    expect(q.last).toBe('1455.25')
    expect(q.bid).toBe('1455')
    expect(q.ask).toBe('1455.5')
    expect(q.high).toBe('1460')
    expect(q.contract.symbol).toBe('RELIANCE')
  })
})

// ==================== capabilities + identity ====================

describe('IndstocksBroker — capabilities & identity', () => {
  it('declares STK with MKT/LMT order types', () => {
    const caps = broker().getCapabilities()
    expect(caps.supportedSecTypes).toEqual(['STK'])
    expect(caps.supportedOrderTypes).toEqual(['MKT', 'LMT'])
    expect(caps.historicalBars?.supported).toBe(true)
  })

  it('round-trips nativeKey ↔ contract', () => {
    const b = broker()
    const c = makeContract('RELIANCE')
    const key = b.getNativeKey(c)
    expect(key).toBe('RELIANCE')
    expect(b.resolveNativeKey(key).symbol).toBe('RELIANCE')
  })

  it('reports market clock with a boolean isOpen and a timestamp', async () => {
    const clock = await broker().getMarketClock()
    expect(typeof clock.isOpen).toBe('boolean')
    expect(clock.timestamp).toBeInstanceOf(Date)
  })
})

// ==================== order-update stream ====================

describe('IndstocksBroker — streamOrderUpdates()', () => {
  beforeEach(() => vi.clearAllMocks())

  async function fakeWsClass() {
    return (await import('ws')).default as any
  }

  it('subscribes on open and forwards order updates, ignoring heartbeats', async () => {
    const updates: any[] = []
    const stream = broker().streamOrderUpdates({ onUpdate: u => updates.push(u) })
    const FakeWS = await fakeWsClass()
    const sock = FakeWS.instances.at(-1)

    sock.emit('open')
    expect(JSON.parse(sock.sent[0])).toEqual({ action: 'subscribe', mode: 'order_updates' })
    // Auth header carried at handshake.
    expect(sock.opts.headers.Authorization).toBe('tok')

    sock.emit('message', JSON.stringify({ type: 'order', order_id: 'O-1', order_status: 'PARTIALLY_EXECUTED', filled_quantity: 5 }))
    sock.emit('message', JSON.stringify({ heartbeat: true }))   // ignored
    expect(updates).toHaveLength(1)
    expect(updates[0].order_id).toBe('O-1')

    stream.stop()
  })

  it('calls onAuthError on a 403 handshake (expired daily token) without reconnecting', async () => {
    const onAuthError = vi.fn()
    broker().streamOrderUpdates({ onUpdate: () => {}, onAuthError })
    const FakeWS = await fakeWsClass()
    const sock = FakeWS.instances.at(-1)
    sock.emit('unexpected-response', {}, { statusCode: 403 })
    expect(onAuthError).toHaveBeenCalledTimes(1)
  })
})

// ==================== fromConfig() ====================

describe('IndstocksBroker — fromConfig()', () => {
  it('derives a stable id from userId (not the rotating token)', () => {
    const b = IndstocksBroker.fromConfig({ id: 'indstocks-CLIENT1', brokerConfig: { accessToken: 'tok', userId: 'CLIENT1' } })
    expect(b.id).toBe('indstocks-CLIENT1')
    expect(b.label).toBe('INDmoney')
  })
})
