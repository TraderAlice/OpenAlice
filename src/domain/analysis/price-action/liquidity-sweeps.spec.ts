import { describe, expect, it } from 'vitest'
import { analyzeMarketStructure } from './market-structure.js'
import { detectLiquiditySweeps } from './liquidity-sweeps.js'
import {
  bodyBreakBars,
  bullishFvgTarget,
  duplicateSwingTargets,
  fvgRaidBars,
  sameBarMultiTargetBars,
  swingSweepBars,
  swingTargets,
} from './fixtures/sweeps-raids.fixture.js'

describe('detectLiquiditySweeps', () => {
  it('creates a bearish swing sweep from wick penetration with body reclaim', () => {
    const sweeps = detectLiquiditySweeps({
      bars: swingSweepBars,
      swingPoints: swingTargets,
      fvgs: [],
      currentVolatility: 2,
    })

    expect(sweeps).toEqual([
      expect.objectContaining({
        kind: 'swing_sweep',
        direction: 'bearish',
        sweepIndex: 3,
        sweptLevel: 110,
        wickExtreme: 112,
        close: 109,
        penetration: 2,
        penetrationAtr: 1,
        reclaimSource: 'body',
        reclaimConfirmed: true,
        target: expect.objectContaining({
          kind: 'swing',
          id: 'swing-high-1',
          index: 1,
          level: 'swing',
        }),
      }),
    ])
  })

  it('does not create a sweep when the body closes through the swing target', () => {
    const marketStructure = analyzeMarketStructure({
      bars: bodyBreakBars,
      swingPoints: swingTargets,
      internalLookback: 1,
      swingLookback: 1,
      externalLookback: 1,
    })

    const sweeps = detectLiquiditySweeps({
      bars: bodyBreakBars,
      swingPoints: swingTargets,
      fvgs: [],
      currentVolatility: 2,
      marketStructure,
    })

    expect(sweeps).toEqual([])
    expect(marketStructure.bos).toContainEqual(
      expect.objectContaining({
        type: 'bullish',
        index: 3,
        brokenSwing: expect.objectContaining({ price: 110 }),
      }),
    )
  })

  it('creates an FVG raid without mutating the target zone lifecycle or structure state', () => {
    const marketStructure = analyzeMarketStructure({
      bars: fvgRaidBars,
      swingPoints: swingTargets,
      internalLookback: 1,
      swingLookback: 1,
      externalLookback: 1,
    })
    const beforeState = structuredClone(marketStructure.stateByLevel)
    const beforeLifecycle = structuredClone(bullishFvgTarget.lifecycle)

    const sweeps = detectLiquiditySweeps({
      bars: fvgRaidBars,
      swingPoints: swingTargets,
      fvgs: [bullishFvgTarget],
      currentVolatility: 2,
      marketStructure,
      zoneMitigationSource: 'body',
    })

    expect(sweeps).toContainEqual(expect.objectContaining({
      kind: 'fvg_raid',
      direction: 'bullish',
      sweepIndex: 3,
      sweptLevel: 107,
      wickExtreme: 106,
      close: 110,
      penetration: 1,
      penetrationAtr: 0.5,
      target: expect.objectContaining({
        kind: 'fvg',
        id: 'fvg-bullish-1',
        index: 2,
      }),
    }))
    expect(bullishFvgTarget.lifecycle).toEqual(beforeLifecycle)
    expect(marketStructure.stateByLevel).toEqual(beforeState)
  })

  it('keeps FVG raids independent from wick mitigation semantics', () => {
    const sweeps = detectLiquiditySweeps({
      bars: fvgRaidBars,
      swingPoints: swingTargets,
      fvgs: [bullishFvgTarget],
      currentVolatility: 2,
      zoneMitigationSource: 'wick',
    })

    expect(sweeps).toContainEqual(expect.objectContaining({
      kind: 'fvg_raid',
      direction: 'bullish',
      sweepIndex: 3,
      target: expect.objectContaining({ id: 'fvg-bullish-1' }),
    }))
  })

  it('keeps different same-bar target kinds and dedupes same-kind targets by importance', () => {
    const sweeps = detectLiquiditySweeps({
      bars: sameBarMultiTargetBars,
      swingPoints: duplicateSwingTargets,
      fvgs: [bullishFvgTarget],
      currentVolatility: 2,
      zoneMitigationSource: 'body',
    })

    expect(sweeps).toHaveLength(2)
    expect(sweeps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'swing_sweep',
        sweptLevel: 112,
        target: expect.objectContaining({ id: 'internal-high-3' }),
      }),
      expect.objectContaining({
        kind: 'fvg_raid',
        sweptLevel: 107,
        target: expect.objectContaining({ id: 'fvg-bullish-1' }),
      }),
    ]))
  })
})
