import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import '../../contract-ext.js'
import { PayloadType } from './ctrader-protocol.js'
import { CtraderBroker, ctraderConfigSchema } from './CtraderBroker.js'
import { FakeCtraderServer } from './__test__/fake-ctrader-server.js'
import { SYMBOL, installReadHandlers } from './__test__/ctrader-fixtures.js'
import { installTradingVenue } from './__test__/fake-trading-venue.js'

const WEDNESDAY = new Date('2026-10-14T09:00:00Z')

async function makeBroker(serverOptions: { permissionScope?: number } = {}) {
  const server = new FakeCtraderServer(serverOptions)
  installReadHandlers(server)
  const venue = installTradingVenue(server)
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

function contract(symbol: string): Contract {
  return Object.assign(new Contract(), { symbol })
}

function order(fields: { action: string; orderType: string; qty: string; lmt?: string; aux?: string; tif?: string; ref?: string }): Order {
  const o = new Order()
  o.action = fields.action
  o.orderType = fields.orderType
  o.totalQuantity = new Decimal(fields.qty)
  if (fields.lmt) o.lmtPrice = new Decimal(fields.lmt)
  if (fields.aux) o.auxPrice = new Decimal(fields.aux)
  o.tif = fields.tif ?? 'DAY'
  if (fields.ref) o.orderRef = fields.ref
  return o
}

describe('placeOrder', () => {
  it('fills a market order and reports the execution in units', async () => {
    const { server, broker } = await makeBroker()
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', orderType: 'MKT', qty: '2000', ref: 'test-buy' }))

    expect(result).toMatchObject({ success: true, orderId: '9100', orderState: { status: 'Filled' } })
    expect(result.execution).toMatchObject({ price: 1.12017, side: 'BOT', exchange: 'CTRADER' })
    expect(result.execution!.shares.toString()).toBe('2000')

    const sent = server.requestsOf(PayloadType.NEW_ORDER_REQ)[0]!.payload!
    expect(sent).toMatchObject({ ctidTraderAccountId: 4242, symbolId: SYMBOL.EURUSD, orderType: 1, tradeSide: 1, volume: 200_000, label: 'test-buy' })
    expect(sent['clientOrderId']).toMatch(/^oa-[0-9a-f]{24}$/)
    expect(sent).not.toHaveProperty('timeInForce')
  })

  it('rests a limit order as Submitted, with DAY mapped to the session close', async () => {
    const { server, venue, broker } = await makeBroker()
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', orderType: 'LMT', qty: '1000', lmt: '1.1' }))
    expect(result).toMatchObject({ success: true, orderId: '9100', orderState: { status: 'Submitted' } })
    expect(result.execution).toBeUndefined()
    expect(server.requestsOf(PayloadType.NEW_ORDER_REQ)[0]!.payload).toMatchObject({ timeInForce: 1, expirationTimestamp: Date.parse('2026-10-16T22:00:00Z') })

    const listed = await broker.getOrder('9100')
    expect(listed!.orderState.status).toBe('Submitted')
    expect(venue.orders.at(-1)!['limitPrice']).toBe(1.1)
  })

  it('protects a market order relative to the fill, without amending when exact', async () => {
    const { server, venue, broker } = await makeBroker()
    const result = await broker.placeOrder(contract('XAUUSD'), order({ action: 'SELL', orderType: 'MKT', qty: '1' }), {
      stopLoss: { price: '4205.01' }, takeProfit: { price: '4175' },
    })
    expect(result).toMatchObject({ success: true, orderState: { status: 'Filled' } })
    expect(result.message).toBeUndefined()
    expect(server.requestsOf(PayloadType.AMEND_POSITION_SLTP_REQ)).toHaveLength(0)
    expect(venue.positions.at(-1)).toMatchObject({ stopLoss: 4205.01, takeProfit: 4175 })
  })

  it('moves protection to the exact prices after a slipped fill', async () => {
    const { server, venue, broker } = await makeBroker()
    venue.fillSlippage = 0.5
    const result = await broker.placeOrder(contract('XAUUSD'), order({ action: 'SELL', orderType: 'MKT', qty: '1' }), {
      stopLoss: { price: '4205.01' },
    })
    expect(result.success).toBe(true)
    expect(result.message).toBeUndefined()
    expect(server.requestsOf(PayloadType.AMEND_POSITION_SLTP_REQ)[0]!.payload).toMatchObject({ positionId: 600, stopLoss: 4205.01 })
    expect(venue.positions.at(-1)!['stopLoss']).toBe(4205.01)
  })

  it('reports active fill-relative protection when the exact amend fails', async () => {
    const { venue, broker } = await makeBroker()
    venue.fillSlippage = 0.5
    venue.rejectProtectionAmend = 'POSITION_LOCKED'
    const result = await broker.placeOrder(contract('XAUUSD'), order({ action: 'SELL', orderType: 'MKT', qty: '1' }), { stopLoss: { price: '4205.01' } })
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/Protection is active relative to the fill \(SL 4204.51.*POSITION_LOCKED/)
  })

  it('returns the venue rejection text', async () => {
    const { venue, broker } = await makeBroker()
    venue.rejectNext = 'NOT_ENOUGH_MONEY'
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', orderType: 'MKT', qty: '1000' }))
    expect(result).toEqual({ success: false, error: 'cTrader placeOrder rejected: NOT_ENOUGH_MONEY: Not enough funds' })
  })

  it('validates locally before sending', async () => {
    const { server, broker } = await makeBroker()
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', orderType: 'MKT', qty: '1500' }))
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/not a multiple of the EURUSD step/) })
    expect(server.requestsOf(PayloadType.NEW_ORDER_REQ)).toHaveLength(0)
    expect(await broker.placeOrder(contract('NOPE'), order({ action: 'BUY', orderType: 'MKT', qty: '1' }))).toMatchObject({ success: false })
  })

  it('finds an order whose reply was lost instead of reporting failure', async () => {
    const { server, venue, broker } = await makeBroker()
    venue.dropNextReply = true
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', orderType: 'LMT', qty: '1000', lmt: '1.1', tif: 'GTC' }))
    expect(result).toMatchObject({ success: true, orderId: '9100', message: expect.stringMatching(/confirmed by lookup/) })
    expect(server.requestsOf(PayloadType.ORDER_LIST_REQ)).toHaveLength(1)
  })

  it('reports an unknown outcome when the lost order cannot be found', async () => {
    const { server, broker } = await makeBroker()
    server.handlers[PayloadType.NEW_ORDER_REQ] = () => undefined
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', orderType: 'MKT', qty: '1000' }))
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/outcome unknown.*Check open orders and positions/) })
  })

  it('reports Submitted when a market fill is not confirmed in time', async () => {
    const { venue, broker } = await makeBroker()
    venue.holdFills = true
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', orderType: 'MKT', qty: '1000' }))
    expect(result).toMatchObject({ success: true, orderState: { status: 'Submitted' } })
  })

  it('refuses writes on a view-only token', async () => {
    const { server, broker } = await makeBroker({ permissionScope: 0 })
    const result = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', orderType: 'MKT', qty: '1000' }))
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/view-only/) })
    expect(server.requestsOf(PayloadType.NEW_ORDER_REQ)).toHaveLength(0)
  })
})

describe('modifyOrder and cancelOrder', () => {
  it('amends a working limit order and keeps its id', async () => {
    const { server, venue, broker } = await makeBroker()
    const result = await broker.modifyOrder('9001', { lmtPrice: new Decimal('1.105'), totalQuantity: new Decimal(3000) })
    expect(result).toMatchObject({ success: true, orderId: '9001', orderState: { status: 'Submitted' } })
    expect(server.requestsOf(PayloadType.AMEND_ORDER_REQ)[0]!.payload).toMatchObject({ orderId: 9001, limitPrice: 1.105, volume: 300_000 })
    expect(venue.orders.find((o) => o['orderId'] === 9001)).toMatchObject({ limitPrice: 1.105 })
  })

  it('keeps a DAY (GTD) order expiring at the same time after an amend', async () => {
    const { broker } = await makeBroker()
    const placed = await broker.placeOrder(contract('EURUSD'), order({ action: 'BUY', orderType: 'LMT', qty: '1000', lmt: '1.1', tif: 'DAY' }))
    const before = await broker.getOrder(placed.orderId!)
    expect(before!.order).toMatchObject({ tif: 'GTD', goodTillDate: '20261016 22:00:00 UTC' })

    expect(await broker.modifyOrder(placed.orderId!, { lmtPrice: new Decimal('1.105') })).toMatchObject({ success: true })
    const after = await broker.getOrder(placed.orderId!)
    expect(after!.order).toMatchObject({ tif: 'GTD', goodTillDate: '20261016 22:00:00 UTC' })
    expect(after!.order.lmtPrice.toString()).toBe('1.105')
  })

  it('moves only the stop of a stop-limit order and keeps its limit price', async () => {
    const { server, broker } = await makeBroker()
    expect((await broker.getOrder('9002'))!.order.lmtPrice.toString()).toBe('3999.5')
    expect(await broker.modifyOrder('9002', { auxPrice: new Decimal('4001') })).toMatchObject({ success: true })
    expect(server.requestsOf(PayloadType.AMEND_ORDER_REQ)[0]!.payload).toMatchObject({ orderId: 9002, stopPrice: 4001, slippageInPoints: 150 })
    const after = await broker.getOrder('9002')
    expect(after!.order.auxPrice.toString()).toBe('4001')
    expect(after!.order.lmtPrice.toString()).toBe('3999.5')
  })

  it('refuses to amend unknown or finished orders', async () => {
    const { venue, broker } = await makeBroker()
    expect(await broker.modifyOrder('1234', { lmtPrice: new Decimal('1.1') })).toEqual({ success: false, error: 'cTrader order 1234 not found' })
    venue.orders.find((o) => o['orderId'] === 9001)!['orderStatus'] = 2
    expect(await broker.modifyOrder('9001', { lmtPrice: new Decimal('1.1') })).toMatchObject({ success: false, error: expect.stringMatching(/no longer working \(Filled\)/) })
  })

  it('cancels a working order and refuses a second cancel', async () => {
    const { broker } = await makeBroker()
    expect(await broker.cancelOrder('9002')).toMatchObject({ success: true, orderId: '9002', orderState: { status: 'Cancelled' } })
    expect(await broker.cancelOrder('9002')).toMatchObject({ success: false, error: expect.stringMatching(/UNABLE_TO_CANCEL_ORDER/) })
    expect(await broker.cancelOrder('1234')).toEqual({ success: false, error: 'cTrader order 1234 not found' })
  })
})

describe('closePosition', () => {
  it('closes all hedged EURUSD longs oldest first', async () => {
    const { server, venue, broker } = await makeBroker()
    const result = await broker.closePosition(contract('EURUSD'))
    expect(result).toMatchObject({ success: true, orderState: { status: 'Filled' }, message: expect.stringMatching(/closed 2 positions/) })
    expect(server.requestsOf(PayloadType.CLOSE_POSITION_REQ).map((m) => m.payload)).toEqual([
      { ctidTraderAccountId: 4242, positionId: 501, volume: 1_000_000 },
      { ctidTraderAccountId: 4242, positionId: 502, volume: 3_000_000 },
    ])
    expect(venue.positions.filter((p) => p['positionStatus'] === 1).map((p) => p['positionId'])).toEqual([503])
  })

  it('closes part of a position across hedged legs', async () => {
    const { server, broker } = await makeBroker()
    const result = await broker.closePosition(contract('EURUSD'), new Decimal(15000))
    expect(result.success).toBe(true)
    expect(server.requestsOf(PayloadType.CLOSE_POSITION_REQ).map((m) => m.payload!['volume'])).toEqual([1_000_000, 500_000])
  })

  it('validates the close quantity', async () => {
    const { server, broker } = await makeBroker()
    expect(await broker.closePosition(contract('EURUSD'), new Decimal(50000))).toMatchObject({ success: false, error: expect.stringMatching(/exceeds the open EURUSD position of 40000 units/) })
    expect(await broker.closePosition(contract('EURUSD'), new Decimal(1500))).toMatchObject({ success: false, error: expect.stringMatching(/not a multiple/) })
    expect(await broker.closePosition(contract('US 500'))).toEqual({ success: false, error: 'No open US 500 position to close' })
    expect(server.requestsOf(PayloadType.CLOSE_POSITION_REQ)).toHaveLength(0)
  })

  it('refuses to guess a side when long and short are both open', async () => {
    const { venue, broker } = await makeBroker()
    venue.positions.push({ positionId: 777, positionStatus: 1, price: 1.13, tradeData: { symbolId: SYMBOL.EURUSD, volume: 100_000, tradeSide: 2 } })
    expect(await broker.closePosition(contract('EURUSD'))).toMatchObject({ success: false, error: expect.stringMatching(/Both long and short EURUSD/) })
  })

  it('reports partial progress when a later close fails', async () => {
    const { server, venue, broker } = await makeBroker()
    const original = server.handlers[PayloadType.CLOSE_POSITION_REQ]!
    server.handlers[PayloadType.CLOSE_POSITION_REQ] = (p, s) => p['positionId'] === 502
      ? { payloadType: PayloadType.ORDER_ERROR_EVENT, payload: { ctidTraderAccountId: 4242, errorCode: 'POSITION_LOCKED' } }
      : original(p, s)
    const result = await broker.closePosition(contract('EURUSD'))
    expect(result).toMatchObject({ success: true, message: expect.stringMatching(/30000 units remain open: .*POSITION_LOCKED/) })
    expect(venue.positions.find((p) => p['positionId'] === 501)!['positionStatus']).toBe(2)
  })
})
