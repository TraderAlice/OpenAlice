import { describe, expect, it } from 'vitest'
import {
  annotateZoneWithPremiumDiscount,
  calculatePremiumDiscountContext,
} from './premium-discount.js'
import type { MarketStructureAnalysis, SwingPoint } from './types.js'

describe('premium / discount context', () => {
  it('classifies current price as premium, discount, or equilibrium using a 5% midpoint band', () => {
    const marketStructure = marketStructureWithAnchors(
      { index: 10, price: 120, type: 'high' },
      { index: 12, price: 80, type: 'low' },
    )

    expect(calculatePremiumDiscountContext({ marketStructure, currentPrice: 103 })).toMatchObject({
      status: 'available',
      location: 'premium',
      equilibriumBandPct: 0.05,
      range: {
        midpoint: 100,
        equilibrium: { bottom: 98, top: 102 },
      },
    })
    expect(calculatePremiumDiscountContext({ marketStructure, currentPrice: 97 })).toMatchObject({
      status: 'available',
      location: 'discount',
    })
    expect(calculatePremiumDiscountContext({ marketStructure, currentPrice: 101 })).toMatchObject({
      status: 'available',
      location: 'equilibrium',
    })
  })

  it('returns unavailable when either confirmed anchor is missing', () => {
    expect(calculatePremiumDiscountContext({
      marketStructure: marketStructureWithAnchors(
        { index: 10, price: 120, type: 'high' },
        undefined,
      ),
      currentPrice: 100,
    })).toEqual({ status: 'unavailable', reason: 'missing_range' })
  })

  it('does not require known trend when confirmed anchors exist', () => {
    const context = calculatePremiumDiscountContext({
      marketStructure: marketStructureWithAnchors(
        { index: 10, price: 120, type: 'high' },
        { index: 12, price: 80, type: 'low' },
        'unknown',
      ),
      currentPrice: 100,
    })

    expect(context.status).toBe('available')
  })

  it('annotates a spanning zone with location, midpoint location, and range coverage', () => {
    const context = calculatePremiumDiscountContext({
      marketStructure: marketStructureWithAnchors(
        { index: 10, price: 120, type: 'high' },
        { index: 12, price: 80, type: 'low' },
      ),
      currentPrice: 100,
    })

    const annotation = annotateZoneWithPremiumDiscount({ top: 104, bottom: 96 }, context)

    expect(annotation).toEqual({
      location: 'spanning',
      midpointLocation: 'equilibrium',
      coverage: {
        premium: 0.25,
        discount: 0.25,
        equilibrium: 0.5,
      },
    })
  })
})

function marketStructureWithAnchors(
  high?: SwingPoint,
  low?: SwingPoint,
  trend: 'bullish' | 'bearish' | 'unknown' = 'bullish',
): MarketStructureAnalysis {
  return {
    marketStructureMode: 'pivot',
    swingPoints: {
      internal: { highs: [], lows: [] },
      swing: {
        highs: high ? [high] : [],
        lows: low ? [low] : [],
      },
      external: { highs: [], lows: [] },
    },
    stateByLevel: {
      internal: { trend: 'unknown', trendValue: 0 },
      swing: {
        trend,
        trendValue: trend === 'bullish' ? 1 : trend === 'bearish' ? -1 : 0,
        lastConfirmedHigh: high,
        lastConfirmedLow: low,
      },
      external: { trend: 'unknown', trendValue: 0 },
    },
    bos: [],
    choch: [],
    swingStrength: [],
  }
}
