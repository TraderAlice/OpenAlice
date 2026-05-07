import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { buildContract, buildPosition } from './contract-builder.js'

describe('buildContract — defaults & validation', () => {
  it('STK with universal fields → valid contract, localSymbol defaults to symbol', () => {
    const c = buildContract({ symbol: 'AAPL', secType: 'STK', exchange: 'SMART', currency: 'USD' })
    expect(c.symbol).toBe('AAPL')
    expect(c.secType).toBe('STK')
    expect(c.localSymbol).toBe('AAPL')  // default
    expect(c.multiplier).toBe('')
  })

  it('OPT requires expiry/strike/right/multiplier — throws via assertContract', () => {
    expect(() => buildContract({
      symbol: 'AAPL', secType: 'OPT', exchange: 'CBOE', currency: 'USD',
    })).toThrow(/lastTradeDateOrContractMonth.*strike.*right.*multiplier/s)
  })

  it('OPT with all fields → valid', () => {
    const c = buildContract({
      symbol: 'AAPL', secType: 'OPT', exchange: 'CBOE', currency: 'USD',
      lastTradeDateOrContractMonth: '20260720',
      strike: 150,
      right: 'C',
      multiplier: '100',
    })
    expect(c.right).toBe('C')
    expect(c.strike).toBe(150)
    expect(c.multiplier).toBe('100')
  })

  it('FUT requires expiry/multiplier (not strike/right)', () => {
    expect(() => buildContract({
      symbol: 'ES', secType: 'FUT', exchange: 'CME', currency: 'USD',
    })).toThrow(/lastTradeDateOrContractMonth.*multiplier/s)
    const c = buildContract({
      symbol: 'ES', secType: 'FUT', exchange: 'CME', currency: 'USD',
      lastTradeDateOrContractMonth: '202606', multiplier: '50',
    })
    expect(c.multiplier).toBe('50')
  })

  it('rejects unknown secType at buildContract output', () => {
    expect(() => buildContract({
      symbol: 'AAPL',
      // @ts-expect-error — intentionally wrong to verify runtime catch
      secType: 'BANANA',
      exchange: 'SMART',
      currency: 'USD',
    })).toThrow(/secType "BANANA"/)
  })

  it('CRYPTO / CRYPTO_PERP need only universal fields', () => {
    expect(buildContract({ symbol: 'BTC', secType: 'CRYPTO', exchange: 'BYBIT', currency: 'USD' })).toBeDefined()
    expect(buildContract({ symbol: 'BTC', secType: 'CRYPTO_PERP', exchange: 'BYBIT', currency: 'USDT' })).toBeDefined()
  })
})

describe('buildPosition — pass-through vs derive', () => {
  const baseContract = buildContract({
    symbol: 'AAPL', secType: 'STK', exchange: 'SMART', currency: 'USD',
  })

  it('derives marketValue and PnL when both are absent', () => {
    const p = buildPosition({
      contract: baseContract,
      currency: 'USD',
      side: 'long',
      quantity: new Decimal(100),
      avgCost: '200',
      marketPrice: '210',
      realizedPnL: '0',
    })
    expect(p.marketValue).toBe('21000')   // 100 × 210 × 1
    expect(p.unrealizedPnL).toBe('1000')  // 100 × 10 × 1
    expect(p.multiplier).toBe('1')        // default
  })

  it('passes through marketValue + unrealizedPnL when both supplied (Alpaca/IBKR path)', () => {
    const p = buildPosition({
      contract: baseContract,
      currency: 'USD',
      side: 'long',
      quantity: new Decimal(100),
      avgCost: '200',
      marketPrice: '210',
      realizedPnL: '0',
      marketValue: '99999',  // arbitrary upstream value
      unrealizedPnL: '12345',
    })
    expect(p.marketValue).toBe('99999')
    expect(p.unrealizedPnL).toBe('12345')
  })

  it('inherits multiplier from contract when not overridden', () => {
    const optContract = buildContract({
      symbol: 'AAPL', secType: 'OPT', exchange: 'CBOE', currency: 'USD',
      lastTradeDateOrContractMonth: '20260720', strike: 150, right: 'C', multiplier: '100',
    })
    const p = buildPosition({
      contract: optContract,
      currency: 'USD',
      side: 'long',
      quantity: new Decimal(5),
      avgCost: '58',
      marketPrice: '70',
      realizedPnL: '0',
    })
    expect(p.multiplier).toBe('100')
    expect(p.marketValue).toBe('35000')   // 5 × 70 × 100
    expect(p.unrealizedPnL).toBe('6000')  // 5 × 12 × 100
  })

  it('explicit multiplier override wins over contract.multiplier', () => {
    const optContract = buildContract({
      symbol: 'AAPL', secType: 'OPT', exchange: 'CBOE', currency: 'USD',
      lastTradeDateOrContractMonth: '20260720', strike: 150, right: 'C', multiplier: '100',
    })
    const p = buildPosition({
      contract: optContract,
      currency: 'USD',
      side: 'long',
      quantity: new Decimal(1),
      avgCost: '50',
      marketPrice: '50',
      realizedPnL: '0',
      multiplier: '50',  // override
    })
    expect(p.multiplier).toBe('50')
  })

  it('avgCostSource is preserved when set', () => {
    const p = buildPosition({
      contract: baseContract,
      currency: 'USD',
      side: 'long',
      quantity: new Decimal(1),
      avgCost: '100',
      marketPrice: '100',
      realizedPnL: '0',
      avgCostSource: 'wallet',
    })
    expect(p.avgCostSource).toBe('wallet')
  })
})
