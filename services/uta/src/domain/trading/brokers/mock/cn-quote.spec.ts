import { describe, it, expect } from 'vitest'
import {
  toTencentCode,
  parseCnSymbol,
  inferCnMarket,
  bareCodeOfTencentCode,
  marketOfTencentCode,
} from './cn-quote.js'
import {
  assertLotSize,
  assertOrderQty,
  assertLimitBand,
  isCnAshareSessionOpen,
  isCnAshareTradingDay,
  stampTaxOnSell,
  commissionOnNotional,
  limitPctForBareCode,
  LOT_SIZE,
  cnTradingDayKey,
} from './cn-rules.js'
import { cnEodSignalTableSchema, CN_EOD_SIGNAL_EXAMPLE } from './cn-eod-signal.js'
import Decimal from 'decimal.js'
import type { CnQuoteSnapshot } from './cn-quote.js'


describe('parseCnSymbol / toTencentCode', () => {
  it('maps 6-digit SH/SZ/BJ heuristics', () => {
    expect(toTencentCode('600519')).toBe('sh600519')
    expect(toTencentCode('000001')).toBe('sz000001')
    expect(toTencentCode('300750')).toBe('sz300750')
    expect(toTencentCode('513100')).toBe('sh513100')
    expect(toTencentCode('510300')).toBe('sh510300')
    expect(toTencentCode('159915')).toBe('sz159915')
    expect(toTencentCode('920000')).toBe('bj920000')
    expect(toTencentCode('430047')).toBe('bj430047')
    expect(toTencentCode('870436')).toBe('bj870436')
    expect(inferCnMarket('900901')).toBe('sh')
  })

  it('accepts prefixed, dotted, hyphenated, and secid forms', () => {
    expect(toTencentCode('sh600519')).toBe('sh600519')
    expect(toTencentCode('sh-600519')).toBe('sh600519')
    expect(toTencentCode('600519.SS')).toBe('sh600519')
    expect(toTencentCode('000001.SZ')).toBe('sz000001')
    expect(toTencentCode('920000.BJ')).toBe('bj920000')
    expect(toTencentCode('bj920000')).toBe('bj920000')
    expect(toTencentCode('1.600519')).toBe('sh600519')
    expect(toTencentCode('0.000001')).toBe('sz000001')
    expect(toTencentCode('2.920000')).toBe('bj920000')
  })

  it('exposes canonical dotted ids', () => {
    const a = parseCnSymbol('513100')
    expect(a.ok).toBe(true)
    if (a.ok) expect(a.ref.canonical).toBe('513100.SH')
    const b = parseCnSymbol('920000')
    expect(b.ok).toBe(true)
    if (b.ok) expect(b.ref.canonical).toBe('920000.BJ')
  })

  it('rejects unknown shapes with UNKNOWN_SYMBOL', () => {
    expect(toTencentCode('AAPL')).toBeNull()
    expect(toTencentCode('')).toBeNull()
    const r = parseCnSymbol('AAPL')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('UNKNOWN_SYMBOL')
  })

  it('bare/market helpers', () => {
    expect(bareCodeOfTencentCode('sh600519')).toBe('600519')
    expect(bareCodeOfTencentCode('bj920000')).toBe('920000')
    expect(marketOfTencentCode('sz000001')).toBe('sz')
    expect(marketOfTencentCode('bj920000')).toBe('bj')
  })
})

describe('cn-rules', () => {
  it('lot size is 100', () => {
    expect(LOT_SIZE).toBe(100)
    expect(assertLotSize(new Decimal(100))).toBeNull()
    expect(assertLotSize(new Decimal(150))).toMatch(/lot size/)
    expect(assertLotSize(new Decimal(0))).toMatch(/lot size/)
  })

  it('limit band uses ±10% of prevClose', () => {
    const quote: CnQuoteSnapshot = {
      code: '600519',
      market: 'sh',
      tencentCode: 'sh600519',
      name: 'Kweichow Moutai',
      last: 1700,
      prevClose: 1700,
      open: 1700,
      bid: 1699,
      ask: 1701,
      volume: 0,
      limitUp: 1870,
      limitDown: 1530,
      timestamp: new Date(),
    }
    expect(assertLimitBand('BUY', new Decimal(1700), quote)).toBeNull()
    expect(assertLimitBand('BUY', new Decimal(1900), quote)).toMatch(/outside/)
  })

  it('stamp tax rounds up on sell notional', () => {
    const tax = stampTaxOnSell(new Decimal(100_000))
    expect(tax.toString()).toBe('50')
  })

  it('commission floors at ¥5', () => {
    expect(commissionOnNotional(new Decimal(1000)).toString()).toBe('5')
    expect(commissionOnNotional(new Decimal(100_000)).toString()).toBe('25')
  })

  it('buy requires lot; sell allows odd lots', () => {
    expect(assertOrderQty('BUY', new Decimal(100))).toBeNull()
    expect(assertOrderQty('BUY', new Decimal(50))).toMatch(/buy lot/)
    expect(assertOrderQty('SELL', new Decimal(37))).toBeNull()
  })

  it('trading day key is YYYY-MM-DD', () => {
    expect(cnTradingDayKey(new Date('2026-03-26T02:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('session helper returns boolean', () => {
    expect(typeof isCnAshareSessionOpen(new Date())).toBe('boolean')
  })

  it('uses holiday calendar — National Day closed, ordinary weekday open', () => {
    // 2026-10-01 Thursday 10:00 Shanghai = UTC 02:00
    expect(isCnAshareTradingDay(new Date('2026-10-01T02:00:00Z'))).toBe(false)
    expect(isCnAshareSessionOpen(new Date('2026-10-01T02:00:00Z'))).toBe(false)
    // 2026-09-29 Tuesday 10:00 Shanghai
    expect(isCnAshareTradingDay(new Date('2026-09-29T02:00:00Z'))).toBe(true)
    expect(isCnAshareSessionOpen(new Date('2026-09-29T02:00:00Z'))).toBe(true)
  })

  it('board-aware limit pct', () => {
    expect(limitPctForBareCode('600036')).toBe(0.1)
    expect(limitPctForBareCode('300750')).toBe(0.2)
    expect(limitPctForBareCode('688981')).toBe(0.2)
    expect(limitPctForBareCode('920000')).toBe(0.3)
  })
})

describe('cn-eod-signal', () => {
  it('accepts the example sleeve table', () => {
    const parsed = cnEodSignalTableSchema.safeParse(CN_EOD_SIGNAL_EXAMPLE)
    expect(parsed.success).toBe(true)
  })

  it('rejects BUY without qty', () => {
    const parsed = cnEodSignalTableSchema.safeParse({
      schemaVersion: 1,
      generatedAt: '2026-09-29T00:00:00.000Z',
      rows: [{
        date: '2026-09-29',
        account: 'cn-paper',
        sleeveCny: 70_000,
        symbol: '600036',
        action: 'BUY',
        reason: 'x',
        signalId: 'x',
      }],
    })
    expect(parsed.success).toBe(false)
  })
})
