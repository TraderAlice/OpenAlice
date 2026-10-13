import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import '../../contract-ext.js'
import { PayloadType } from './ctrader-protocol.js'
import { CtraderBroker, ctraderConfigSchema } from './CtraderBroker.js'
import { closedLegStatus, decideHedgedOrder, legId, parseLegId, viewPosition, type RawPositionView } from './ctrader-protection.js'
import { FakeCtraderServer } from './__test__/fake-ctrader-server.js'
import { SYMBOL, installReadHandlers } from './__test__/ctrader-fixtures.js'
import { installTradingVenue } from './__test__/fake-trading-venue.js'

const WEDNESDAY = new Date('2026-10-14T09:00:00Z')

async function makeBroker(options: { accountType?: number } = {}) {
  const server = new FakeCtraderServer()
  installReadHandlers(server)
  const venue = installTradingVenue(server)
  if (options.accountType !== undefined) {
    server.handlers[PayloadType.TRADER_REQ] = () => ({
      payloadType: PayloadType.TRADER_RES,
      payload: { ctidTraderAccountId: 4242, trader: { ctidTraderAccountId: 4242, balance: 100_000, moneyDigits: 2, depositAssetId: 1, accountType: options.accountType } },
    })
  }
  const broker = new CtraderBroker({
    id: 'ctrader-demo',
    config: ctraderConfigSchema.parse({ clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-1', traderLogin: 1000001 }),
    transport: { socketFactory: server.socketFactory, heartbeatIntervalMs: 0 },
    now: () => WEDNESDAY,
    quoteTimeoutMs: 20,
    fillTimeoutMs: 50,
    orderReplyTimeoutMs: 50,
  })
  await broker.init()
  return { server, venue, broker }
}

const contract = (symbol: string) => Object.assign(new Contract(), { symbol })

function order(f: { action: string; type: string; qty: string; lmt?: string; aux?: string }): Order {
  const o = new Order()
  o.action = f.action
  o.orderType = f.type
  o.totalQuantity = new Decimal(f.qty)
  if (f.lmt) o.lmtPrice = new Decimal(f.lmt)
  if (f.aux) o.auxPrice = new Decimal(f.aux)
  o.tif = 'GTC'
  return o
}

/** Protect the XAUUSD short (position 503) with SL 4250 / TP 4000. */
function protectGold(venue: Awaited<ReturnType<typeof makeBroker>>['venue']) {
  const gold = venue.positions.find((p) => p['positionId'] === 503)!
  gold['stopLoss'] = 4250
  gold['takeProfit'] = 4000
}

// ==================== pure helpers ====================

describe('protection helpers', () => {
  it('round-trips leg ids and rejects anything else', () => {
    expect(legId('stopLoss', 503)).toBe('sl-503')
    expect(parseLegId('tp-503')).toEqual({ kind: 'takeProfit', positionId: 503 })
    expect(parseLegId('9001')).toBeNull()
    expect(parseLegId('sl-')).toBeNull()
    expect(parseLegId('xx-5')).toBeNull()
  })

  const pos = (positionId: number, side: number, volume: number, openedAt: number): RawPositionView => ({
    positionId, symbolId: 1, side, volume, open: true, openedAt, stopLoss: undefined, takeProfit: undefined,
  })

  it('opens when nothing opposite is open, and reduces the oldest position that fits', () => {
    const longs = [pos(502, 1, 3_000_000, 2), pos(501, 1, 1_000_000, 1)]
    expect(decideHedgedOrder(longs, 'EURUSD', 1, 100_000)).toEqual({ kind: 'open' })
    expect(decideHedgedOrder(longs, 'EURUSD', 2, 100_000)).toEqual({ kind: 'reduce', positionId: 501 })
    expect(decideHedgedOrder(longs, 'EURUSD', 2, 2_000_000)).toEqual({ kind: 'reduce', positionId: 502 })
  })

  it('refuses orders that would flip, straddle positions, or face both sides', () => {
    const longs = [pos(501, 1, 1_000_000, 1), pos(502, 1, 3_000_000, 2)]
    expect(decideHedgedOrder(longs, 'EURUSD', 2, 5_000_000)).toMatchObject({ kind: 'refuse', error: expect.stringMatching(/larger than the open EURUSD position \(40000 units\)/) })
    expect(decideHedgedOrder([pos(501, 1, 1_000_000, 1), pos(502, 1, 1_000_000, 2)], 'EURUSD', 2, 1_500_000))
      .toMatchObject({ kind: 'refuse', error: expect.stringMatching(/No single open EURUSD position/) })
    expect(decideHedgedOrder([pos(501, 1, 1_000_000, 1), pos(777, 2, 1_000_000, 2)], 'EURUSD', 2, 100_000))
      .toMatchObject({ kind: 'refuse', error: expect.stringMatching(/Both long and short/) })
  })

  it('settles a closed position leg from its fired protection order', () => {
    const fired = [{ orderType: 4, orderStatus: 2, executionPrice: 4250.4, stopLoss: 4250, takeProfit: 4000 }]
    expect(closedLegStatus('stopLoss', fired)).toBe('Filled')
    expect(closedLegStatus('takeProfit', fired)).toBe('Cancelled')
    expect(closedLegStatus('stopLoss', [{ orderType: 1, orderStatus: 2, closingOrder: true }])).toBe('Cancelled')
  })

  it('reads raw positions', () => {
    expect(viewPosition({ positionId: 1, positionStatus: 2, stopLoss: 1.1, tradeData: { symbolId: 5, volume: 100, tradeSide: 2, openTimestamp: 9 } }))
      .toEqual({ positionId: 1, symbolId: 5, side: 2, volume: 100, open: false, openedAt: 9, stopLoss: 1.1, takeProfit: undefined })
  })
})

// ==================== legs ====================

describe('position protection legs', () => {
  it('lists stop-loss and take-profit of open positions as orders', async () => {
    const { venue, broker } = await makeBroker()
    protectGold(venue)
    const legs = (await broker.getOpenOrders()).filter((o) => o.orderId?.startsWith('sl-') || o.orderId?.startsWith('tp-'))
    expect(legs.map((l) => l.orderId)).toEqual(['sl-503', 'tp-503'])
    const [sl, tp] = legs
    expect(sl!.order).toMatchObject({ action: 'BUY', orderType: 'STP', tif: 'GTC', orderRef: 'position stop-loss' })
    expect(sl!.order.auxPrice.toString()).toBe('4250')
    expect(sl!.order.totalQuantity.toString()).toBe('2')
    expect(tp!.order).toMatchObject({ action: 'BUY', orderType: 'LMT' })
    expect(tp!.order.lmtPrice.toString()).toBe('4000')
    expect(sl!.contract.symbol).toBe('XAUUSD')
    expect(sl!.orderState.status).toBe('Submitted')
  })

  it('returns the legs of a protected market order from birth', async () => {
    const { broker } = await makeBroker()
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', type: 'MKT', qty: '1000' }), {
      stopLoss: { price: '1.11' }, takeProfit: { price: '1.13' },
    })
    expect(result).toMatchObject({ success: true, legs: [{ orderId: 'sl-600', kind: 'stopLoss' }, { orderId: 'tp-600', kind: 'takeProfit' }] })
    expect((await broker.getOrder('sl-600'))!.order.auxPrice.toString()).toBe('1.11')
  })

  it('moves a stop-loss to break-even and keeps the take-profit', async () => {
    const { server, venue, broker } = await makeBroker()
    protectGold(venue)
    const result = await broker.modifyOrder('sl-503', { auxPrice: new Decimal('4100') })
    expect(result).toMatchObject({ success: true, orderId: 'sl-503', orderState: { status: 'Submitted' } })
    expect(server.requestsOf(PayloadType.AMEND_POSITION_SLTP_REQ).at(-1)!.payload).toEqual({ ctidTraderAccountId: 4242, positionId: 503, stopLoss: 4100, takeProfit: 4000 })
    expect(venue.positions.find((p) => p['positionId'] === 503)).toMatchObject({ stopLoss: 4100, takeProfit: 4000 })
  })

  it('moves a take-profit with lmtPrice and can add a missing stop-loss', async () => {
    const { server, venue, broker } = await makeBroker()
    protectGold(venue)
    expect(await broker.modifyOrder('tp-503', { lmtPrice: new Decimal('3950') })).toMatchObject({ success: true })
    expect(venue.positions.find((p) => p['positionId'] === 503)).toMatchObject({ stopLoss: 4250, takeProfit: 3950 })
    expect(await broker.modifyOrder('sl-501', { auxPrice: new Decimal('1.09') })).toMatchObject({ success: true })
    expect(server.requestsOf(PayloadType.AMEND_POSITION_SLTP_REQ).at(-1)!.payload).toEqual({ ctidTraderAccountId: 4242, positionId: 501, stopLoss: 1.09 })
  })

  it('refuses leg changes it cannot express', async () => {
    const { server, venue, broker } = await makeBroker()
    protectGold(venue)
    expect(await broker.modifyOrder('sl-503', { totalQuantity: new Decimal(1) })).toMatchObject({ success: false, error: expect.stringMatching(/whole position/) })
    expect(await broker.modifyOrder('sl-503', { lmtPrice: new Decimal('4200') })).toMatchObject({ success: false, error: expect.stringMatching(/auxPrice/) })
    expect(await broker.modifyOrder('sl-503', { auxPrice: new Decimal('4200.123') })).toMatchObject({ success: false, error: expect.stringMatching(/more decimals/) })
    expect(await broker.modifyOrder('sl-999', { auxPrice: new Decimal('1') })).toEqual({ success: false, error: 'Position 999 is no longer open' })
    expect(server.requestsOf(PayloadType.AMEND_POSITION_SLTP_REQ)).toHaveLength(0)
  })

  it('cancels one level by re-sending only the other', async () => {
    const { server, venue, broker } = await makeBroker()
    protectGold(venue)
    expect(await broker.cancelOrder('tp-503')).toMatchObject({ success: true, orderState: { status: 'Cancelled' } })
    expect(server.requestsOf(PayloadType.AMEND_POSITION_SLTP_REQ).at(-1)!.payload).toEqual({ ctidTraderAccountId: 4242, positionId: 503, stopLoss: 4250 })
    expect(venue.positions.find((p) => p['positionId'] === 503)!['takeProfit']).toBeUndefined()
    expect((await broker.getOrder('tp-503'))!.orderState.status).toBe('Cancelled')
    expect(await broker.cancelOrder('tp-503')).toMatchObject({ success: false, error: expect.stringMatching(/no take-profit/) })
  })

  it('settles legs after the venue closes the position at its stop-loss', async () => {
    const { venue, broker } = await makeBroker()
    protectGold(venue)
    venue.triggerProtection(503, 'stopLoss')
    const sl = await broker.getOrder('sl-503')
    const tp = await broker.getOrder('tp-503')
    expect(sl!.orderState.status).toBe('Filled')
    expect(tp!.orderState.status).toBe('Cancelled')
    expect(sl!.order.action).toBe('BUY')
    expect(sl!.contract.symbol).toBe('XAUUSD')
    expect((await broker.getOpenOrders()).some((o) => o.orderId === 'sl-503')).toBe(false)
  })
})

// ==================== hedged reduce linking ====================

describe('orders against an open position on a hedged account', () => {
  it('links an IBKR-style protective stop to the position it closes', async () => {
    const { server, broker } = await makeBroker()
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'SELL', type: 'STP', qty: '1000', aux: '1.105' }))
    expect(result).toMatchObject({ success: true, orderState: { status: 'Submitted' } })
    expect(server.requestsOf(PayloadType.NEW_ORDER_REQ).at(-1)!.payload).toMatchObject({ orderType: 3, tradeSide: 2, volume: 100_000, positionId: 501 })
  })

  it('reduces a position with a linked market order instead of opening a hedge', async () => {
    const { venue, broker } = await makeBroker()
    const result = await broker.placeOrder(contract('XAUUSD'), order({ action: 'BUY', type: 'MKT', qty: '1' }))
    expect(result).toMatchObject({ success: true, orderState: { status: 'Filled' } })
    expect(venue.positions.find((p) => p['positionId'] === 503)!['tradeData']['volume']).toBe(100)
    expect(venue.positions.filter((p) => p['positionStatus'] === 1 && p['tradeData']['symbolId'] === SYMBOL.XAUUSD)).toHaveLength(1)
  })

  it('opens normally on the same side and refuses ambiguous or oversized opposite orders', async () => {
    const { server, broker } = await makeBroker()
    expect(await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', type: 'LMT', qty: '1000', lmt: '1.1' }))).toMatchObject({ success: true })
    expect(server.requestsOf(PayloadType.NEW_ORDER_REQ).at(-1)!.payload).not.toHaveProperty('positionId')
    expect(await broker.placeOrder(contract('EURUSD'), order({ action: 'SELL', type: 'STP', qty: '50000', aux: '1.105' })))
      .toMatchObject({ success: false, error: expect.stringMatching(/would open an opposite position/) })
    expect(await broker.placeOrder(contract('EURUSD'), order({ action: 'SELL', type: 'STP', qty: '35000', aux: '1.105' })))
      .toMatchObject({ success: false, error: expect.stringMatching(/No single open EURUSD position/) })
  })

  it('refuses protection attached to a reducing order', async () => {
    const { broker } = await makeBroker()
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'SELL', type: 'STP', qty: '1000', aux: '1.105' }), { takeProfit: { price: '1.09' } })
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/reduces the open EURUSD position/) })
  })

  it('does not link on a netting account', async () => {
    const { server, broker } = await makeBroker({ accountType: 1 })
    expect(await broker.placeOrder(contract('EURUSD'), order({ action: 'SELL', type: 'STP', qty: '50000', aux: '1.105' }))).toMatchObject({ success: true })
    expect(server.requestsOf(PayloadType.NEW_ORDER_REQ).at(-1)!.payload).not.toHaveProperty('positionId')
  })

  it('cancels a linked stop when its position is closed', async () => {
    const { server, venue, broker } = await makeBroker()
    const stop = await broker.placeOrder(contract('XAUUSD'), order({ action: 'BUY', type: 'STP', qty: '2', aux: '4300' }))
    expect(stop).toMatchObject({ success: true })
    const closed = await broker.closePosition(contract('XAUUSD'))
    expect(closed).toMatchObject({ success: true, message: expect.stringMatching(`cancelled linked pending orders ${stop.orderId}`) })
    expect(venue.orders.find((o) => String(o['orderId']) === stop.orderId)!['orderStatus']).toBe(5)
    expect(server.requestsOf(PayloadType.CANCEL_ORDER_REQ).map((m) => m.payload!['orderId'])).toEqual([Number(stop.orderId)])
  })
})
