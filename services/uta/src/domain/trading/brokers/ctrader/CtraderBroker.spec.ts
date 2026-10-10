import { describe, it, expect } from 'vitest'
import { Contract } from '@traderalice/ibkr'
import '../../contract-ext.js'
import { PayloadType } from './ctrader-protocol.js'
import { CtraderBroker, ctraderConfigSchema } from './CtraderBroker.js'
import { FakeCtraderServer } from './__test__/fake-ctrader-server.js'
import { SYMBOL, installReadHandlers } from './__test__/ctrader-fixtures.js'

const WEDNESDAY = new Date('2026-10-14T09:00:00Z')

async function makeBroker(options: { spots?: boolean; now?: Date } = {}) {
  const server = new FakeCtraderServer()
  installReadHandlers(server, { spots: options.spots ?? true })
  const broker = new CtraderBroker({
    id: 'ctrader-demo',
    config: ctraderConfigSchema.parse({ clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-1', traderLogin: '1000001' }),
    transport: { socketFactory: server.socketFactory, heartbeatIntervalMs: 0 },
    now: () => options.now ?? WEDNESDAY,
    quoteTimeoutMs: 20,
  })
  await broker.init()
  return { server, broker }
}

function contract(fields: Partial<Contract>): Contract {
  return Object.assign(new Contract(), fields)
}

describe('ctraderConfigSchema', () => {
  it('accepts the login as a string from forms and defaults to demo', () => {
    const cfg = ctraderConfigSchema.parse({ clientId: 'a', clientSecret: 'b', accessToken: 'c', traderLogin: '1000001', refreshToken: '' })
    expect(cfg).toEqual({ environment: 'demo', clientId: 'a', clientSecret: 'b', accessToken: 'c', traderLogin: 1000001 })
  })

  it('requires an account selector', () => {
    expect(() => ctraderConfigSchema.parse({ clientId: 'a', clientSecret: 'b', accessToken: 'c', traderLogin: '' })).toThrow(/traderLogin/)
  })
})

describe('CtraderBroker init and catalog', () => {
  it('connects and loads the catalog once', async () => {
    const { server, broker } = await makeBroker()
    await broker.init()
    expect(server.requestsOf(PayloadType.SYMBOLS_LIST_REQ)).toHaveLength(1)
    expect(broker.brokerEngine).toBe('ctrader')
    expect(broker.meta).toEqual({ environment: 'demo', traderLogin: 1000001 })
  })

  it('refuses catalog reads before init with CONNECTING', async () => {
    const broker = new CtraderBroker({
      config: ctraderConfigSchema.parse({ clientId: 'a', clientSecret: 'b', accessToken: 'c', traderLogin: 1 }),
    })
    await expect(broker.searchContracts('EUR')).rejects.toMatchObject({ code: 'CONNECTING' })
    expect(() => broker.resolveNativeKey('EURUSD')).toThrow(/not loaded/)
  })

  it('searches enabled symbols by name, description and assets', async () => {
    const { broker } = await makeBroker()
    const eur = await broker.searchContracts('eurusd')
    expect(eur[0]!.contract).toMatchObject({ symbol: 'EURUSD', secType: 'CFD', exchange: 'CTRADER', currency: 'USD', conId: SYMBOL.EURUSD })
    expect((await broker.searchContracts('gold')).map((d) => d.contract.symbol)).toEqual(['XAUUSD'])
    expect((await broker.searchContracts('OLDFX'))).toEqual([])
  })

  it('round-trips native keys and resolves by conId, localSymbol, aliceId or symbol', async () => {
    const { broker } = await makeBroker()
    const gold = broker.resolveNativeKey('XAUUSD')
    expect(broker.getNativeKey(gold)).toBe('XAUUSD')
    expect(broker.getNativeKey(contract({ conId: SYMBOL.US500 }))).toBe('US 500')
    expect(broker.getNativeKey(contract({ aliceId: 'ctrader-demo|US 500' }))).toBe('US 500')
    expect(broker.getNativeKey(contract({ symbol: 'eur/usd' }))).toBe('EURUSD')
    expect(() => broker.resolveNativeKey('NOPE')).toThrow(/Unknown cTrader symbol/)
  })

  it('reports the venue asset class from broker categories', async () => {
    const { broker } = await makeBroker()
    expect(broker.assetClassFor(contract({ symbol: 'EURUSD' }))).toBe('currency')
    expect(broker.assetClassFor(contract({ symbol: 'XAUUSD' }))).toBe('commodity')
    expect(broker.assetClassFor(contract({ symbol: 'US 500' }))).toBe('equity')
    expect(broker.assetClassFor(contract({ symbol: 'NOPE' }))).toBe('unknown')
  })

  it('exposes volume limits in units and tick size in contract details', async () => {
    const { broker } = await makeBroker()
    const d = await broker.getContractDetails(contract({ symbol: 'XAUUSD' }))
    expect(d).not.toBeNull()
    expect(d!.minSize.toString()).toBe('1')
    expect(d!.sizeIncrement.toString()).toBe('1')
    expect(d!.minTick).toBe(0.01)
    expect(d!.longName).toBe('Gold vs US Dollar')
    expect(d!.category).toBe('Metals')
    expect(await broker.getContractDetails(contract({ symbol: 'NOPE' }))).toBeNull()
  })

  it('caches symbol specs across calls', async () => {
    const { server, broker } = await makeBroker()
    await broker.getContractDetails(contract({ symbol: 'EURUSD' }))
    await broker.getContractDetails(contract({ symbol: 'EURUSD' }))
    expect(server.requestsOf(PayloadType.SYMBOL_BY_ID_REQ)).toHaveLength(1)
  })
})

describe('CtraderBroker account and positions', () => {
  it('reports balance, unrealized PnL and margin in the deposit currency', async () => {
    const { broker } = await makeBroker()
    expect(await broker.getAccount()).toEqual({
      baseCurrency: 'EUR',
      netLiquidation: '980',
      totalCashValue: '1000',
      unrealizedPnL: '-20',
      initMarginReq: '130',
    })
  })

  it('merges hedged positions per symbol and side, marked at the close-out side', async () => {
    const { broker } = await makeBroker()
    const positions = await broker.getPositions()
    const eur = positions.find((p) => p.contract.symbol === 'EURUSD')!
    const gold = positions.find((p) => p.contract.symbol === 'XAUUSD')!

    expect(eur).toMatchObject({ side: 'long', currency: 'USD', avgCost: '1.115', marketPrice: '1.12016', multiplier: '1' })
    expect(eur.quantity.toString()).toBe('40000')
    expect(eur.unrealizedPnL).toBe('206.4')

    expect(gold).toMatchObject({ side: 'short', avgCost: '4100', marketPrice: '4195.21' })
    expect(gold.quantity.toString()).toBe('2')
    expect(gold.unrealizedPnL).toBe('-190.42')
  })

  it('falls back to the last bar when no tick arrives', async () => {
    const { server, broker } = await makeBroker({ spots: false })
    server.handlers[PayloadType.GET_TRENDBARS_REQ] = (p) => ({
      payloadType: PayloadType.GET_TRENDBARS_RES,
      payload: { trendbar: p['symbolId'] === SYMBOL.EURUSD ? [{ low: 111_990, deltaClose: 10, utcTimestampInMinutes: 29_000_000 }] : [] },
    })
    const quote = await broker.getQuote(contract({ symbol: 'EURUSD' }))
    expect(quote).toMatchObject({ bid: '1.12', ask: '1.12', last: '1.12', timestamp: new Date(29_000_000 * 60_000) })
    await expect(broker.getQuote(contract({ symbol: 'XAUUSD' }))).rejects.toMatchObject({ code: 'MARKET_CLOSED' })
  })
})

describe('CtraderBroker quotes', () => {
  it('quotes bid, ask and mid from the spot stream and reuses the subscription', async () => {
    const { server, broker } = await makeBroker()
    const quote = await broker.getQuote(contract({ symbol: 'EURUSD' }))
    expect(quote).toMatchObject({ bid: '1.12016', ask: '1.12017', last: '1.12017', volume: '0' })
    expect(quote.contract.symbol).toBe('EURUSD')
    await broker.getQuote(contract({ symbol: 'EURUSD' }))
    expect(server.requestsOf(PayloadType.SUBSCRIBE_SPOTS_REQ)).toHaveLength(1)
  })

  it('merges one-sided spot updates', async () => {
    const { server, broker } = await makeBroker()
    await broker.getQuote(contract({ symbol: 'EURUSD' }))
    server.push(PayloadType.SPOT_EVENT, { ctidTraderAccountId: 4242, symbolId: SYMBOL.EURUSD, ask: 112_030 })
    expect(await broker.getQuote(contract({ symbol: 'EURUSD' }))).toMatchObject({ bid: '1.12016', ask: '1.1203' })
  })

  it('re-subscribes known symbols after a reconnect', async () => {
    const { server, broker } = await makeBroker()
    await broker.getQuote(contract({ symbol: 'XAUUSD' }))
    server.current.drop()
    await broker.init()
    await new Promise((r) => setTimeout(r, 0))
    const subs = server.requestsOf(PayloadType.SUBSCRIBE_SPOTS_REQ)
    expect(subs).toHaveLength(2)
    expect(subs[1]!.payload!['symbolId']).toEqual([SYMBOL.XAUUSD])
  })
})

describe('CtraderBroker orders (read)', () => {
  it('maps pending orders with units, prices, tif and attached protection', async () => {
    const { broker } = await makeBroker()
    const [limit, stopLimit] = await broker.getOpenOrders()

    expect(limit!.orderId).toBe('9001')
    expect(limit!.order).toMatchObject({ action: 'BUY', orderType: 'LMT', tif: 'GTC', orderRef: 'alice-1' })
    expect(limit!.order.totalQuantity.toString()).toBe('1000')
    expect(limit!.order.lmtPrice.toString()).toBe('1.1')
    expect(limit!.orderState.status).toBe('Submitted')

    expect(stopLimit!.order).toMatchObject({ action: 'SELL', orderType: 'STP LMT', tif: 'GTD', goodTillDate: '20261016 21:00:00 UTC', orderRef: 'gold-short' })
    expect(stopLimit!.order.auxPrice.toString()).toBe('4000')
    expect(stopLimit!.order.lmtPrice.toString()).toBe('3999.5')
    expect(stopLimit!.tpsl).toEqual({ takeProfit: { price: '3900' }, stopLoss: { price: '4100' } })
  })

  it('looks orders up by string id and returns null for unknown ones', async () => {
    const { broker } = await makeBroker()
    expect((await broker.getOrder('9002'))!.contract.symbol).toBe('XAUUSD')
    expect(await broker.getOrder('1234')).toBeNull()
    expect(await broker.getOrder('not-a-number')).toBeNull()
    expect((await broker.getOrders(['9001', '1234', '9002'])).map((o) => o.orderId)).toEqual(['9001', '9002'])
  })
})

describe('CtraderBroker market clock', () => {
  it('uses the schedule of the first listed symbol', async () => {
    const open = await makeBroker({ now: WEDNESDAY })
    expect(await open.broker.getMarketClock()).toMatchObject({ isOpen: true, nextClose: new Date('2026-10-16T22:00:00Z') })

    const closed = await makeBroker({ now: new Date('2026-10-10T16:00:00Z') })
    expect(await closed.broker.getMarketClock()).toMatchObject({ isOpen: false, nextOpen: new Date('2026-10-11T22:00:00Z') })
  })
})

describe('CtraderBroker historical bars', () => {
  const DAY = 86_400_000
  /** One daily bar per day from `firstDay`, honoring from/to like the server. */
  function dailyBars(server: FakeCtraderServer, firstDay: number, maxRangeMs?: number) {
    server.handlers[PayloadType.GET_TRENDBARS_REQ] = (p) => {
      const from = p['fromTimestamp'] as number
      const to = p['toTimestamp'] as number
      if (maxRangeMs !== undefined && to - from > maxRangeMs) return { error: 'INCORRECT_BOUNDARIES' }
      const trendbar = []
      for (let t = Math.max(from, firstDay); t <= to; t += DAY) {
        const aligned = Math.ceil(t / DAY) * DAY
        if (aligned > to) break
        trendbar.push({ low: 112_000, deltaOpen: 5, deltaHigh: 20, deltaClose: 10, volume: 7, utcTimestampInMinutes: aligned / 60_000 })
        t = aligned
      }
      return { payloadType: PayloadType.GET_TRENDBARS_RES, payload: { period: 12, trendbar } }
    }
  }

  it('returns the most recent bars in ascending order, honoring limit', async () => {
    const { server, broker } = await makeBroker()
    dailyBars(server, WEDNESDAY.getTime() - 30 * DAY)
    const bars = await broker.getHistorical(contract({ symbol: 'EURUSD' }), { interval: '1d', limit: 5 })
    expect(bars).toHaveLength(5)
    expect(bars[0]!.timestamp < bars[4]!.timestamp).toBe(true)
    expect(bars[4]!.timestamp.getTime()).toBeLessThanOrEqual(WEDNESDAY.getTime())
    expect(bars[0]).toMatchObject({ open: '1.12005', high: '1.1202', low: '1.12', close: '1.1201', volume: '7' })
    expect(server.requestsOf(PayloadType.GET_TRENDBARS_REQ)[0]!.payload).toMatchObject({ period: 12, symbolId: SYMBOL.EURUSD })
  })

  it('halves the request window when the server rejects the range', async () => {
    const { server, broker } = await makeBroker()
    dailyBars(server, WEDNESDAY.getTime() - 400 * DAY, 400 * DAY)
    const bars = await broker.getHistorical(contract({ symbol: 'EURUSD' }), { interval: '1d', limit: 10 })
    expect(bars).toHaveLength(10)
    const ranges = server.requestsOf(PayloadType.GET_TRENDBARS_REQ).map((m) => (m.payload!['toTimestamp'] as number) - (m.payload!['fromTimestamp'] as number))
    expect(ranges[0]).toBeGreaterThan(400 * DAY)
    expect(ranges.at(-1)).toBeLessThanOrEqual(400 * DAY)
  })

  it('pages back to an explicit start and stops at the edge of history', async () => {
    const { server, broker } = await makeBroker()
    dailyBars(server, WEDNESDAY.getTime() - 3 * 365 * DAY)
    const start = new Date(WEDNESDAY.getTime() - 20 * DAY)
    const bars = await broker.getHistorical(contract({ symbol: 'EURUSD' }), { interval: '1d', start })
    expect(bars.length).toBeGreaterThanOrEqual(19)
    expect(bars.every((b) => b.timestamp >= start)).toBe(true)
  })

  it('rejects unknown contracts', async () => {
    const { broker } = await makeBroker()
    await expect(broker.getHistorical(contract({ symbol: 'NOPE' }), { interval: '1h' })).rejects.toMatchObject({ code: 'EXCHANGE' })
  })
})

describe('CtraderBroker capabilities', () => {
  it('declares CFD, the supported order types and all bar sizes', async () => {
    const { broker } = await makeBroker()
    expect(broker.getCapabilities()).toEqual({
      supportedSecTypes: ['CFD'],
      supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT'],
      historicalBars: { supported: true, quality: 'realtime', supportedBarSizes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] },
    })
  })
})
