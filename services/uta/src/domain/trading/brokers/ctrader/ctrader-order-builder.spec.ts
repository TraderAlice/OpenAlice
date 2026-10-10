import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { Order } from '@traderalice/ibkr'
import type { CatalogSymbol } from './ctrader-catalog.js'
import { parseSymbolSpec, type SymbolSpec } from './ctrader-catalog.js'
import { buildAmendOrder, buildNewOrder, dayExpiry, parseGoodTillDate, volumeOnGrid } from './ctrader-order-builder.js'
import { OrderType, TimeInForce } from './ctrader-mapping.js'
import { SPECS, SYMBOL } from './__test__/ctrader-fixtures.js'

const EURUSD: CatalogSymbol = {
  symbolId: SYMBOL.EURUSD, name: 'EURUSD', description: 'Euro vs US Dollar', enabled: true, baseAsset: 'EUR', quoteAsset: 'USD',
  category: 'Majors', assetClassName: 'Forex', assetClass: 'currency', sortingNumber: 1,
}
const XAUUSD: CatalogSymbol = { ...EURUSD, symbolId: SYMBOL.XAUUSD, name: 'XAUUSD', baseAsset: 'XAU', assetClass: 'commodity' }
const EUR_SPEC = parseSymbolSpec(SPECS[SYMBOL.EURUSD]!)!
const XAU_SPEC = parseSymbolSpec(SPECS[SYMBOL.XAUUSD]!)!
const WEDNESDAY = new Date('2026-10-14T09:00:00Z')

function order(fields: Partial<Record<keyof Order, unknown>>): Order {
  const o = new Order()
  for (const [k, v] of Object.entries(fields)) {
    ;(o as unknown as Record<string, unknown>)[k] = typeof v === 'number' || (typeof v === 'string' && /^\d/.test(v) && k !== 'goodTillDate')
      ? new Decimal(v as number)
      : v
  }
  return o
}

function build(o: Order, extra: { tpsl?: Parameters<typeof buildNewOrder>[0]['tpsl']; symbol?: CatalogSymbol; spec?: SymbolSpec; reference?: { bid: string; ask: string } } = {}) {
  return buildNewOrder({
    order: o,
    symbol: extra.symbol ?? EURUSD,
    spec: extra.spec ?? EUR_SPEC,
    clientOrderId: 'oa-test',
    now: WEDNESDAY,
    ...(extra.tpsl ? { tpsl: extra.tpsl } : {}),
    ...(extra.reference ? { reference: { bid: new Decimal(extra.reference.bid), ask: new Decimal(extra.reference.ask) } } : {}),
  })
}

describe('volumeOnGrid', () => {
  it('converts units to cents on the step grid', () => {
    expect(volumeOnGrid(new Decimal(2000), EUR_SPEC, 'EURUSD')).toEqual({ ok: true, value: 200_000 })
  })

  it('names the minimum, step and lot size when off grid', () => {
    expect(volumeOnGrid(new Decimal(500), EUR_SPEC, 'EURUSD')).toEqual({
      ok: false, error: 'Quantity 500 is below the EURUSD minimum of 1000 units (1 lot = 100000 units)',
    })
    expect(volumeOnGrid(new Decimal(1500), EUR_SPEC, 'EURUSD')).toMatchObject({ ok: false, error: expect.stringMatching(/not a multiple of the EURUSD step of 1000 units/) })
    expect(volumeOnGrid(new Decimal('0.001'), EUR_SPEC, 'EURUSD')).toMatchObject({ ok: false, error: expect.stringMatching(/finer than 0.01/) })
  })
})

describe('buildNewOrder', () => {
  it('builds a market order without time in force for DAY', () => {
    const r = build(order({ action: 'BUY', orderType: 'MKT', totalQuantity: 1000, tif: 'DAY', orderRef: 'my-note' }))
    expect(r).toEqual({
      ok: true,
      value: {
        isMarket: true,
        payload: { symbolId: SYMBOL.EURUSD, tradeSide: 1, volume: 100_000, clientOrderId: 'oa-test', label: 'my-note', orderType: OrderType.MARKET },
      },
    })
  })

  it('builds limit, stop and stop-limit orders', () => {
    const limit = build(order({ action: 'SELL', orderType: 'LMT', totalQuantity: 1000, lmtPrice: '1.12345', tif: 'GTC' }))
    expect(limit).toMatchObject({ ok: true, value: { payload: { orderType: OrderType.LIMIT, limitPrice: 1.12345, tradeSide: 2, timeInForce: TimeInForce.GOOD_TILL_CANCEL } } })

    const stop = build(order({ action: 'BUY', orderType: 'STP', totalQuantity: 1000, auxPrice: '1.13', tif: 'GTC' }))
    expect(stop).toMatchObject({ ok: true, value: { payload: { orderType: OrderType.STOP, stopPrice: 1.13 } } })

    const stopLimit = build(order({ action: 'SELL', orderType: 'STP LMT', totalQuantity: 2, auxPrice: '4000', lmtPrice: '3999.5', tif: 'GTC' }), { symbol: XAUUSD, spec: XAU_SPEC })
    expect(stopLimit).toMatchObject({ ok: true, value: { payload: { orderType: OrderType.STOP_LIMIT, stopPrice: 4000, slippageInPoints: 50, volume: 200 } } })
  })

  it('rejects a stop-limit whose limit is on the wrong side of the stop', () => {
    const r = build(order({ action: 'BUY', orderType: 'STP LMT', totalQuantity: 1000, auxPrice: '1.13', lmtPrice: '1.129' }))
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/at or above the stop/) })
  })

  it('turns a pending DAY order into GTD at the session close', () => {
    const r = build(order({ action: 'BUY', orderType: 'LMT', totalQuantity: 1000, lmtPrice: '1.1', tif: 'DAY' }))
    expect(r).toMatchObject({ ok: true, value: { payload: { timeInForce: TimeInForce.GOOD_TILL_DATE, expirationTimestamp: Date.parse('2026-10-16T22:00:00Z') } } })
  })

  it('parses GTD expiry and refuses past dates', () => {
    const ok = build(order({ action: 'BUY', orderType: 'LMT', totalQuantity: 1000, lmtPrice: '1.1', tif: 'GTD', goodTillDate: '20261015 12:00:00 UTC' }))
    expect(ok).toMatchObject({ ok: true, value: { payload: { expirationTimestamp: Date.parse('2026-10-15T12:00:00Z') } } })
    const past = build(order({ action: 'BUY', orderType: 'LMT', totalQuantity: 1000, lmtPrice: '1.1', tif: 'GTD', goodTillDate: '20261001 12:00:00' }))
    expect(past).toMatchObject({ ok: false, error: 'goodTillDate is in the past' })
  })

  it('refuses prices finer than the symbol digits', () => {
    const r = build(order({ action: 'BUY', orderType: 'LMT', totalQuantity: 1, lmtPrice: '4195.123' }), { symbol: XAUUSD, spec: XAU_SPEC })
    expect(r).toEqual({ ok: false, error: 'Limit price 4195.123 has more decimals than XAUUSD allows (2)' })
  })

  it('refuses unsupported order types, cash quantities and disabled symbols', () => {
    expect(build(order({ action: 'BUY', orderType: 'TRAIL', totalQuantity: 1000 }))).toMatchObject({ ok: false, error: expect.stringMatching(/not supported/) })
    expect(build(order({ action: 'BUY', orderType: 'MKT', cashQty: 500 }))).toMatchObject({ ok: false, error: expect.stringMatching(/Cash-quantity/) })
    expect(build(order({ action: 'BUY', orderType: 'MKT', totalQuantity: 1000 }), { spec: { ...EUR_SPEC, tradingMode: 3 } }))
      .toMatchObject({ ok: false, error: 'EURUSD is in close-only mode; new orders are not accepted' })
  })

  it('attaches absolute protection to pending orders and checks its sides', () => {
    const r = build(order({ action: 'BUY', orderType: 'LMT', totalQuantity: 1000, lmtPrice: '1.1', tif: 'GTC' }), {
      tpsl: { stopLoss: { price: '1.09' }, takeProfit: { price: '1.12' } },
    })
    expect(r).toMatchObject({ ok: true, value: { payload: { stopLoss: 1.09, takeProfit: 1.12 } } })

    const wrong = build(order({ action: 'BUY', orderType: 'LMT', totalQuantity: 1000, lmtPrice: '1.1' }), { tpsl: { stopLoss: { price: '1.11' } } })
    expect(wrong).toEqual({ ok: false, error: 'Stop loss 1.11 must be below the limit price 1.1 for a buy order' })
  })

  it('sends market-order protection as distances from the current price', () => {
    const r = build(order({ action: 'SELL', orderType: 'MKT', totalQuantity: 2 }), {
      symbol: XAUUSD, spec: XAU_SPEC, reference: { bid: '4195.01', ask: '4195.21' },
      tpsl: { stopLoss: { price: '4205.01' }, takeProfit: { price: '4175' } },
    })
    expect(r).toEqual({
      ok: true,
      value: {
        isMarket: true,
        payload: expect.objectContaining({ orderType: OrderType.MARKET, relativeStopLoss: 1_000_000, relativeTakeProfit: 2_001_000 }),
        marketProtection: { stopLoss: 4205.01, takeProfit: 4175 },
      },
    })
    expect((r as { value: { payload: Record<string, unknown> } }).value.payload).not.toHaveProperty('stopLoss')
  })

  it('needs a reference price for market-order protection and rejects stop-limit protection', () => {
    expect(build(order({ action: 'BUY', orderType: 'MKT', totalQuantity: 1000 }), { tpsl: { stopLoss: { price: '1.1' } } }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/No current EURUSD price/) })
    expect(build(order({ action: 'BUY', orderType: 'LMT', totalQuantity: 1000, lmtPrice: '1.1' }), { tpsl: { stopLoss: { price: '1.09', limitPrice: '1.08' } } }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/Stop-limit protection/) })
  })
})

describe('time helpers', () => {
  it('parses IBKR goodTillDate variants', () => {
    expect(parseGoodTillDate('20261015 12:00:00 UTC')).toBe(Date.parse('2026-10-15T12:00:00Z'))
    expect(parseGoodTillDate('20261015-12:00:00')).toBe(Date.parse('2026-10-15T12:00:00Z'))
    expect(parseGoodTillDate('tomorrow')).toBeNull()
  })

  it('expires DAY at the next session close, even when the market is closed now', () => {
    expect(dayExpiry(EUR_SPEC, new Date('2026-10-10T16:00:00Z'))).toBe(Date.parse('2026-10-16T22:00:00Z'))
    expect(dayExpiry({ ...EUR_SPEC, schedule: [] }, WEDNESDAY)).toBe(Date.parse('2026-10-14T23:59:59Z'))
  })
})

describe('buildAmendOrder', () => {
  const current = { orderId: 9001, orderType: OrderType.LIMIT, tradeSide: 1, volume: 100_000, limitPrice: 1.1, stopLoss: 1.09, timeInForce: TimeInForce.GOOD_TILL_CANCEL }

  it('changes price and volume and re-sends existing protection', () => {
    const r = buildAmendOrder({ current, changes: { lmtPrice: new Decimal('1.105'), totalQuantity: new Decimal(3000) }, symbol: EURUSD, spec: EUR_SPEC, now: WEDNESDAY })
    expect(r).toEqual({ ok: true, value: { orderId: 9001, stopLoss: 1.09, limitPrice: 1.105, volume: 300_000 } })
  })

  it('recomputes the stop-limit distance when the limit changes', () => {
    const stopLimit = { orderId: 9002, orderType: OrderType.STOP_LIMIT, tradeSide: 2, volume: 100, stopPrice: 4000 }
    const r = buildAmendOrder({ current: stopLimit, changes: { lmtPrice: new Decimal('3998') }, symbol: XAUUSD, spec: XAU_SPEC, now: WEDNESDAY })
    expect(r).toEqual({ ok: true, value: { orderId: 9002, slippageInPoints: 200 } })
  })

  it('refuses changes that do not fit the order type or switch time in force', () => {
    expect(buildAmendOrder({ current, changes: { auxPrice: new Decimal('1.2') }, symbol: EURUSD, spec: EUR_SPEC, now: WEDNESDAY }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/auxPrice can only be changed/) })
    expect(buildAmendOrder({ current, changes: { tif: 'DAY' }, symbol: EURUSD, spec: EUR_SPEC, now: WEDNESDAY }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/only change the expiry/) })
    expect(buildAmendOrder({ current, changes: {}, symbol: EURUSD, spec: EUR_SPEC, now: WEDNESDAY }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/Nothing to change/) })
  })
})
