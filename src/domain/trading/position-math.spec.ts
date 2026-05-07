import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { derivePositionMath, pnlOf, multiplierToDecimal } from './position-math.js'

describe('derivePositionMath', () => {
  it('STK long — multiplier=1: marketValue and PnL are simple products', () => {
    const r = derivePositionMath({
      quantity: 100, marketPrice: 210, avgCost: 200, multiplier: '1', side: 'long',
    })
    expect(r.marketValue).toBe('21000')
    expect(r.unrealizedPnL).toBe('1000')
  })

  it('OPT long — multiplier=100 folds into both fields', () => {
    const r = derivePositionMath({
      quantity: 5, marketPrice: 70, avgCost: 58, multiplier: '100', side: 'long',
    })
    expect(r.marketValue).toBe('35000')   // 5 × 70 × 100
    expect(r.unrealizedPnL).toBe('6000')  // 5 × (70-58) × 100
  })

  it('FUT long — multiplier=50 (ES-style)', () => {
    const r = derivePositionMath({
      quantity: 2, marketPrice: 5850, avgCost: 5800, multiplier: '50', side: 'long',
    })
    expect(r.marketValue).toBe('585000')   // 2 × 5850 × 50
    expect(r.unrealizedPnL).toBe('5000')   // 2 × 50 × 50 = 5000
  })

  it('short side flips the sign of unrealizedPnL', () => {
    const long = derivePositionMath({
      quantity: 1, marketPrice: 110, avgCost: 100, multiplier: '1', side: 'long',
    })
    const short = derivePositionMath({
      quantity: 1, marketPrice: 110, avgCost: 100, multiplier: '1', side: 'short',
    })
    expect(long.unrealizedPnL).toBe('10')
    expect(short.unrealizedPnL).toBe('-10')
    // marketValue is sign-agnostic — quantity is already absolute
    expect(long.marketValue).toBe(short.marketValue)
  })

  it('handles Decimal inputs equivalently to string/number', () => {
    const a = derivePositionMath({
      quantity: new Decimal('1.0093'), marketPrice: new Decimal('80000'),
      avgCost: new Decimal('80000'), multiplier: '1', side: 'long',
    })
    const b = derivePositionMath({
      quantity: '1.0093', marketPrice: 80000, avgCost: '80000', multiplier: '1', side: 'long',
    })
    expect(a).toEqual(b)
  })

  it('zero or empty multiplier defaults to 1 (defensive)', () => {
    const r = derivePositionMath({
      quantity: 10, marketPrice: 100, avgCost: 95, multiplier: '0', side: 'long',
    })
    expect(r.unrealizedPnL).toBe('50')  // 10 × 5 × 1, not 0
  })
})

describe('pnlOf', () => {
  it('matches the unrealizedPnL produced by derivePositionMath', () => {
    const inputs = {
      quantity: '5', marketPrice: '70', avgCost: '58', multiplier: '100', side: 'long' as const,
    }
    expect(pnlOf(inputs)).toBe(derivePositionMath(inputs).unrealizedPnL)
  })

  it('zero PnL when mark equals avgCost', () => {
    expect(pnlOf({
      quantity: 100, marketPrice: 200, avgCost: 200, multiplier: '1', side: 'long',
    })).toBe('0')
  })
})

describe('multiplierToDecimal', () => {
  it('empty/missing → 1', () => {
    expect(multiplierToDecimal(undefined).toNumber()).toBe(1)
    expect(multiplierToDecimal('').toNumber()).toBe(1)
  })
  it('numeric strings parse', () => {
    expect(multiplierToDecimal('100').toNumber()).toBe(100)
    expect(multiplierToDecimal('0.5').toNumber()).toBe(0.5)
  })
  it('zero → 1 (zero is a "broker forgot to set" signal)', () => {
    expect(multiplierToDecimal('0').toNumber()).toBe(1)
  })
})
