import { describe, it, expect } from 'vitest'
import { toTencentCode, bareCodeOfTencentCode, marketOfTencentCode } from './cn-quote.js'
import {
  assertLotSize,
  assertLimitBand,
  isCnAshareSessionOpen,
  stampTaxOnSell,
  LOT_SIZE,
  cnTradingDayKey,
} from './cn-rules.js'
import Decimal from 'decimal.js'
import type { CnQuoteSnapshot } from './cn-quote.js'

describe('toTencentCode', () => {
  it('maps 6-digit SH/SZ heuristics', () => {
    expect(toTencentCode('600519')).toBe('sh600519')
    expect(toTencentCode('000001')).toBe('sz000001')
    expect(toTencentCode('300750')).toBe('sz300750')
  })

  it('accepts prefixed and dotted forms', () => {
    expect(toTencentCode('sh600519')).toBe('sh600519')
    expect(toTencentCode('600519.SS')).toBe('sh600519')
    expect(toTencentCode('000001.SZ')).toBe('sz000001')
    expect(toTencentCode('1.600519')).toBe('sh600519')
    expect(toTencentCode('0.000001')).toBe('sz000001')
  })

  it('rejects unknown shapes', () => {
    expect(toTencentCode('AAPL')).toBeNull()
    expect(toTencentCode('')).toBeNull()
  })

  it('bare/market helpers', () => {
    expect(bareCodeOfTencentCode('sh600519')).toBe('600519')
    expect(marketOfTencentCode('sz000001')).toBe('sz')
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

  it('trading day key is YYYY-MM-DD', () => {
    expect(cnTradingDayKey(new Date('2026-03-26T02:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('session helper returns boolean', () => {
    expect(typeof isCnAshareSessionOpen(new Date())).toBe('boolean')
  })
})
