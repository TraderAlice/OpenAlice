import { describe, expect, it } from 'vitest'
import {
  scoreFVGImportance,
  scoreIFVGImportance,
  type ScoringContext,
} from './importance-scoring.js'
import type { FairValueGap, InverseFVG } from './types.js'

describe('price-action importance scoring', () => {
  it('优先保留未完全填补且更靠近当前价格的 FVG', () => {
    const context: ScoringContext = {
      currentPrice: 110,
      volatility: 2,
      barCount: 100,
    }

    const important = scoreFVGImportance(
      makeFVG({ top: 111, bottom: 109, isFilled: false, completelyFilled: false, formationIndex: 90 }),
      context
    )
    const staleFilled = scoreFVGImportance(
      makeFVG({ top: 150, bottom: 148, isFilled: true, completelyFilled: true, formationIndex: 20 }),
      context
    )

    expect(important).toBeGreaterThan(staleFilled)
  })

  it('同向 BOS 会提升 FVG 分数', () => {
    const fvg = makeFVG({ type: 'bullish', formationIndex: 10 })
    const baseContext: ScoringContext = {
      currentPrice: 110,
      volatility: 2,
      barCount: 100,
    }
    const alignedContext: ScoringContext = {
      ...baseContext,
      marketStructure: {
        marketStructureMode: 'pivot',
        swingPoints: {
          internal: { highs: [], lows: [] },
          swing: { highs: [], lows: [] },
          external: { highs: [], lows: [] },
        },
        stateByLevel: {
          internal: { trend: 'bullish', trendValue: 1 },
          swing: { trend: 'unknown', trendValue: 0 },
          external: { trend: 'unknown', trendValue: 0 },
        },
        bos: [
          {
            type: 'bullish',
            index: 20,
            price: 115,
            level: 'internal',
            brokenSwing: { index: 8, price: 114, type: 'high' },
          },
        ],
        choch: [],
        swingStrength: [],
      },
    }

    expect(scoreFVGImportance(fvg, alignedContext)).toBeGreaterThan(
      scoreFVGImportance(fvg, baseContext)
    )
  })

  it('strong/weak swing strength contributes structured scoring impact to FVGs', () => {
    const fvg = makeFVG({ type: 'bullish', top: 101, bottom: 99, formationIndex: 20 })
    const baseContext: ScoringContext = {
      currentPrice: 100,
      volatility: 2,
      barCount: 100,
    }
    const strongLowContext: ScoringContext = {
      ...baseContext,
      marketStructure: {
        marketStructureMode: 'pivot',
        swingPoints: {
          internal: { highs: [], lows: [] },
          swing: { highs: [], lows: [] },
          external: { highs: [], lows: [] },
        },
        stateByLevel: {
          internal: { trend: 'bullish', trendValue: 1 },
          swing: { trend: 'unknown', trendValue: 0 },
          external: { trend: 'unknown', trendValue: 0 },
        },
        bos: [],
        choch: [],
        swingStrength: [
          {
            id: 'internal-low-10',
            type: 'low',
            level: 'internal',
            index: 10,
            price: 98,
            strength: 'strong',
            reason: 'Defended structural anchor.',
            scoringImpact: { zoneScoreDelta: 12, explanationTag: 'strong_low_defended' },
          },
        ],
      },
    }

    expect(scoreFVGImportance(fvg, strongLowContext)).toBe(
      scoreFVGImportance(fvg, baseContext) + 12
    )
  })

  it('iFVG 分数随吞没强度和冲动倍数提高', () => {
    const context: ScoringContext = {
      currentPrice: 110,
      volatility: 2,
      barCount: 100,
    }

    const weak = scoreIFVGImportance(makeIFVG({ engulfingStrength: 0.8, impulseRatio: 1.5 }), context)
    const strong = scoreIFVGImportance(makeIFVG({ engulfingStrength: 2.2, impulseRatio: 3 }), context)

    expect(strong).toBeGreaterThan(weak)
  })
})

function makeFVG(overrides: Partial<FairValueGap> = {}): FairValueGap {
  return {
    id: 'fvg-test',
    kind: 'fvg',
    direction: overrides.type ?? 'bullish',
    type: 'bullish',
    variant: 'FVG',
    top: 112,
    bottom: 108,
    midpoint: 110,
    sizeAtr: 2,
    formedAtIndex: 50,
    formationIndex: 50,
    confirmedAtIndex: 51,
    confirmationIndex: 51,
    size: 4,
    state: 'active',
    lifecycle: { formedAtIndex: 50, confirmedAtIndex: 51 },
    isFilled: false,
    fillPercentage: 0,
    completelyFilled: false,
    ...overrides,
  }
}

function makeIFVG(overrides: Partial<InverseFVG> = {}): InverseFVG {
  return {
    type: 'bullish_ifvg',
    variant: 'FVG',
    top: 112,
    bottom: 108,
    breakerId: 'fvg_breaker:fvg:50:70',
    source: { kind: 'fvg_breaker', id: 'fvg_breaker:fvg:50:70', index: 70 },
    reversalIndex: 80,
    engulfingStrength: 1,
    impulseRatio: 2,
    ...overrides,
  }
}
