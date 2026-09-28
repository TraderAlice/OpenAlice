import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { CnLocalPaperBroker } from './CnLocalPaperBroker.js'
import { commissionOnNotional } from './cn-rules.js'
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

  it('allows same-day sell for verified T+0 ETF 513100', async () => {
    broker.setMarkPrice('513100', 2.3, snap({
      code: '513100',
      market: 'sh',
      tencentCode: 'sh513100',
      name: '国泰纳斯达克100',
      last: 2.3,
      prevClose: 2.3,
      limitUp: 2.53,
      limitDown: 2.07,
    }))
    const c = (await broker.searchContracts('513100'))[0]!.contract
    const buy = new Order()
    buy.action = 'BUY'
    buy.orderType = 'MKT'
    buy.totalQuantity = new Decimal(1000)
    expect((await broker.placeOrder(c, buy)).success).toBe(true)

    const sell = new Order()
    sell.action = 'SELL'
    sell.orderType = 'MKT'
    sell.totalQuantity = new Decimal(1000)
    const sold = await broker.placeOrder(c, sell)
    expect(sold.success).toBe(true)
    expect(await broker.getPositions()).toHaveLength(0)
  })

  it('allows same-day sell for heuristic T+0 commodity ETF by name', async () => {
    broker.setMarkPrice('159985', 1.5, snap({
      code: '159985',
      market: 'sz',
      tencentCode: 'sz159985',
      name: '豆粕ETF',
      last: 1.5,
      prevClose: 1.5,
      limitUp: 1.65,
      limitDown: 1.35,
    }))
    const c = (await broker.searchContracts('159985'))[0]!.contract
    const buy = new Order()
    buy.action = 'BUY'
    buy.orderType = 'MKT'
    buy.totalQuantity = new Decimal(100)
    expect((await broker.placeOrder(c, buy)).success).toBe(true)

    const sell = new Order()
    sell.action = 'SELL'
    sell.orderType = 'MKT'
    sell.totalQuantity = new Decimal(100)
    expect((await broker.placeOrder(c, sell)).success).toBe(true)
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
    // Buy 200@10 → −2000 − ¥5 commission; sell 100@10 → +1000 − ¥0.5 stamp − ¥5 commission
    expect(Number(acct.totalCashValue)).toBeCloseTo(1_000_000 - 2000 - 5 + 1000 - 0.5 - 5, 5)
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

  it('searches Shanghai ETF and BJ codes when marked', async () => {
    broker.setMarkPrice('513100', 2.3, snap({
      code: '513100', market: 'sh', tencentCode: 'sh513100', name: 'NDX ETF', last: 2.3, prevClose: 2.3,
    }))
    broker.setMarkPrice('920000', 14, snap({
      code: '920000', market: 'bj', tencentCode: 'bj920000', name: 'BJ sample', last: 14, prevClose: 14,
    }))
    const etf = await broker.searchContracts('513100')
    expect(etf).toHaveLength(1)
    expect(etf[0]!.contract.symbol).toBe('513100')
    expect(etf[0]!.contract.primaryExchange).toBe('SH')
    const bj = await broker.searchContracts('920000.BJ')
    expect(bj).toHaveLength(1)
    expect(bj[0]!.contract.primaryExchange).toBe('BJ')
  })

  it('search returns empty without a quote (no invented contract)', async () => {
    expect(await broker.searchContracts('600036')).toEqual([])
    expect(await broker.searchContracts('AAPL')).toEqual([])
  })

  it('placeOrder returns UNKNOWN_SYMBOL for non-CN ids', async () => {
    const c = (await broker.searchContracts('600519'))[0]!.contract
    c.symbol = 'AAPL'
    c.localSymbol = 'AAPL'
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(100)
    const r = await broker.placeOrder(c, order)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/^UNKNOWN_SYMBOL:/)
  })

  it('placeOrder returns NO_QUOTE when tencent has no snap', async () => {
    const live = new CnLocalPaperBroker({
      id: 'cn-local-paper-noquote',
      cash: 1_000_000,
      quoteProvider: 'tencent',
      enforceSession: false,
      enforceLotSize: true,
      quoteFetcher: async () => [],
    })
    await live.init()
    try {
      const c = new Contract()
      c.symbol = '600036'
      c.localSymbol = '600036'
      c.secType = 'STK'
      c.currency = 'CNY'
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal(100)
      const r = await live.placeOrder(c, order)
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/^NO_QUOTE:/)
      expect(r.error).toContain('600036.SH')
    } finally {
      await live.close()
    }
  })

  it('freezes cash on LMT BUY and rejects overspend', async () => {
    const c = (await broker.searchContracts('600519'))[0]!.contract
    // Limit below mark so a later setMarkPrice does not auto-fill the resting order.
    const lmt = new Order()
    lmt.action = 'BUY'
    lmt.orderType = 'LMT'
    lmt.totalQuantity = new Decimal(50_000) // 50_000 * 9.5 = 475_000 + commission 118.75
    lmt.lmtPrice = new Decimal('9.5')
    const first = await broker.placeOrder(c, lmt)
    expect(first.success).toBe(true)

    const reserved = new Decimal(50_000).mul('9.5').plus(commissionOnNotional(new Decimal(50_000).mul('9.5')))
    const acct = await broker.getAccount()
    expect(Number(acct.totalCashValue)).toBe(1_000_000) // not yet filled
    expect(Number(acct.buyingPower)).toBeCloseTo(1_000_000 - reserved.toNumber(), 5)

    const again = new Order()
    again.action = 'BUY'
    again.orderType = 'LMT'
    again.totalQuantity = new Decimal(60_000)
    again.lmtPrice = new Decimal('9.5')
    const blocked = await broker.placeOrder(c, again)
    expect(blocked.success).toBe(false)
    expect(blocked.error).toMatch(/^INSUFFICIENT_CASH:/)

    expect(first.orderId).toBeTruthy()
    await broker.cancelOrder(first.orderId!)
    const after = await broker.getAccount()
    expect(Number(after.buyingPower)).toBeCloseTo(1_000_000, 5)
  })

  it('allows odd-lot sells after T+1 unlock', async () => {
    const c = (await broker.searchContracts('600519'))[0]!.contract
    const buy = new Order()
    buy.action = 'BUY'
    buy.orderType = 'MKT'
    buy.totalQuantity = new Decimal(200)
    expect((await broker.placeOrder(c, buy)).success).toBe(true)
    ;(broker as unknown as { boughtToday: Map<string, unknown> }).boughtToday.clear()

    const sell = new Order()
    sell.action = 'SELL'
    sell.orderType = 'MKT'
    sell.totalQuantity = new Decimal(37)
    const sold = await broker.placeOrder(c, sell)
    expect(sold.success).toBe(true)
  })
})
