import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Decimal from 'decimal.js'
import { Order } from '@traderalice/ibkr'
import { CnLocalPaperBroker } from './CnLocalPaperBroker.js'
import type { CnQuoteSnapshot } from './cn-quote.js'

function snap(overrides: Partial<CnQuoteSnapshot> = {}): CnQuoteSnapshot {
  const prev = overrides.prevClose ?? 10
  return {
    code: '600519',
    market: 'sh',
    tencentCode: 'sh600519',
    name: 'Kweichow Moutai',
    last: 10,
    prevClose: prev,
    open: 10,
    bid: 9.99,
    ask: 10.01,
    volume: 1_000_000,
    limitUp: Math.round(prev * 1.1 * 100) / 100,
    limitDown: Math.round(prev * 0.9 * 100) / 100,
    timestamp: new Date(),
    ...overrides,
  }
}

describe('CnLocalPaperBroker', () => {
  let broker: CnLocalPaperBroker

  beforeEach(async () => {
    broker = new CnLocalPaperBroker({
      id: 'cn-local-paper-test',
      cash: 1_000_000,
      quoteProvider: 'manual',
      enforceSession: false,
      enforceLotSize: true,
      enforceTPlus1: true,
      enforceLimitBand: true,
    })
    await broker.init()
    broker.setMarkPrice('600519', 10, snap())
  })

  afterEach(async () => {
    await broker.close()
  })

  it('reports CNY account currency', async () => {
    const acct = await broker.getAccount()
    expect(acct.baseCurrency).toBe('CNY')
    expect(Number(acct.totalCashValue)).toBe(1_000_000)
  })

  it('rejects non-lot quantities', async () => {
    const c = (await broker.searchContracts('600519'))[0]!.contract
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(50)
    const r = await broker.placeOrder(c, order)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/lot size/)
  })

  it('buys at mark and locks T+1 sells', async () => {
    const c = (await broker.searchContracts('600519'))[0]!.contract
    const buy = new Order()
    buy.action = 'BUY'
    buy.orderType = 'MKT'
    buy.totalQuantity = new Decimal(100)
    const bought = await broker.placeOrder(c, buy)
    expect(bought.success).toBe(true)

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0]!.quantity.toString()).toBe('100')
    expect(positions[0]!.currency).toBe('CNY')

    const sell = new Order()
    sell.action = 'SELL'
    sell.orderType = 'MKT'
    sell.totalQuantity = new Decimal(100)
    const blocked = await broker.placeOrder(c, sell)
    expect(blocked.success).toBe(false)
    expect(blocked.error).toMatch(/T\+1/)
  })

  it('allows selling previously held shares not bought today', async () => {
    // Seed inventory without going through today's buy lock: buy then clear lock map via day roll simulation.
    const c = (await broker.searchContracts('600519'))[0]!.contract
    const buy = new Order()
    buy.action = 'BUY'
    buy.orderType = 'MKT'
    buy.totalQuantity = new Decimal(200)
    expect((await broker.placeOrder(c, buy)).success).toBe(true)

    // Pretend prior day: wipe boughtToday by selling after manually clearing lock.
    ;(broker as unknown as { boughtToday: Map<string, unknown> }).boughtToday.clear()

    const sell = new Order()
    sell.action = 'SELL'
    sell.orderType = 'MKT'
    sell.totalQuantity = new Decimal(100)
    const sold = await broker.placeOrder(c, sell)
    expect(sold.success).toBe(true)

    const acct = await broker.getAccount()
    // 100 * 10 = 1000 proceeds minus 0.5 stamp tax
    expect(Number(acct.totalCashValue)).toBeCloseTo(1_000_000 - 2000 + 1000 - 0.5, 5)
  })

  it('rejects limit price outside ±10% band', async () => {
    const c = (await broker.searchContracts('600519'))[0]!.contract
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(100)
    order.lmtPrice = new Decimal(20)
    const r = await broker.placeOrder(c, order)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/outside/)
  })

  it('capabilities are STK-only', () => {
    const caps = broker.getCapabilities()
    expect(caps.supportedSecTypes).toEqual(['STK'])
    expect(caps.supportedOrderTypes).toContain('MKT')
  })
})
