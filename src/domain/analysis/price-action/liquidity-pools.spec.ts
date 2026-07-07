import { describe, expect, it } from 'vitest'
import { detectLiquidityPools } from './liquidity-pools.js'
import { detectLiquiditySweeps } from './liquidity-sweeps.js'
import {
  capDisabledSwingPoints,
  emptySwingPoints,
  eqhPoolSweepBars,
  eqhSwingPoints,
  eqlPoolSweepBars,
  eqlSwingPoints,
  outsideToleranceSwingPoints,
  threeTouchSwingPoints,
} from './fixtures/eqh-eql.fixture.js'

describe('detectLiquidityPools', () => {
  it('forms an EQH pool from two equal highs inside the default capped ATR tolerance', () => {
    const pools = detectLiquidityPools({
      swingPoints: eqhSwingPoints,
      currentVolatility: 2,
    })

    expect(pools).toEqual([
      expect.objectContaining({
        id: 'liquidity-pool-EQH-internal-1-3',
        kind: 'liquidity_pool',
        type: 'EQH',
        direction: 'bearish',
        level: 'internal',
        price: 100.04,
        tolerance: 0.1,
        toleranceAtr: 0.05,
        firstTouchedAtIndex: 1,
        lastTouchedAtIndex: 3,
        swept: false,
        touches: [
          { index: 1, price: 100, type: 'high' },
          { index: 3, price: 100.08, type: 'high' },
        ],
      }),
    ])
  })

  it('forms an EQL pool from two equal lows inside the same tolerance', () => {
    const pools = detectLiquidityPools({
      swingPoints: eqlSwingPoints,
      currentVolatility: 2,
    })

    expect(pools).toEqual([
      expect.objectContaining({
        id: 'liquidity-pool-EQL-internal-1-3',
        type: 'EQL',
        direction: 'bullish',
        level: 'internal',
        price: 99.96,
        tolerance: 0.1,
        touches: [
          { index: 1, price: 100, type: 'low' },
          { index: 3, price: 99.92, type: 'low' },
        ],
      }),
    ])
  })

  it('does not form a pool when touches are outside the default tolerance', () => {
    const pools = detectLiquidityPools({
      swingPoints: outsideToleranceSwingPoints,
      currentVolatility: 2,
    })

    expect(pools).toEqual([])
  })

  it('retains three or more touches in a single pool', () => {
    const pools = detectLiquidityPools({
      swingPoints: threeTouchSwingPoints,
      currentVolatility: 2,
    })

    expect(pools).toHaveLength(1)
    expect(pools[0].touches.map((touch) => touch.index)).toEqual([1, 3, 5])
  })

  it('allows liquidityPoolTolerancePctCap = 0 to disable the percentage cap', () => {
    const poolsWithCap = detectLiquidityPools({
      swingPoints: capDisabledSwingPoints,
      currentVolatility: 3,
    })
    const poolsWithoutCap = detectLiquidityPools({
      swingPoints: capDisabledSwingPoints,
      currentVolatility: 3,
      liquidityPoolTolerancePctCap: 0,
    })

    expect(poolsWithCap).toEqual([])
    expect(poolsWithoutCap).toHaveLength(1)
    expect(poolsWithoutCap[0]).toEqual(expect.objectContaining({
      tolerance: 0.3,
      toleranceAtr: 0.1,
    }))
  })
})

describe('liquidity pool sweeps', () => {
  it('requires an EQH sweep to cross the tolerance band and reclaim below the pool level', () => {
    const [pool] = detectLiquidityPools({
      swingPoints: eqhSwingPoints,
      currentVolatility: 2,
    })

    const sweeps = detectLiquiditySweeps({
      bars: eqhPoolSweepBars,
      swingPoints: emptySwingPoints,
      fvgs: [],
      currentVolatility: 2,
      liquidityPools: [pool],
    })

    expect(sweeps).toEqual([
      expect.objectContaining({
        kind: 'liquidity_pool_sweep',
        direction: 'bearish',
        sweepIndex: 5,
        sweptLevel: 100.04,
        wickExtreme: 100.2,
        close: 99.9,
        penetration: 0.06,
        penetrationAtr: 0.03,
        target: expect.objectContaining({
          kind: 'liquidity_pool',
          id: 'liquidity-pool-EQH-internal-1-3',
          index: 3,
          level: 'internal',
        }),
      }),
    ])
  })

  it('requires an EQL sweep to cross the tolerance band and reclaim above the pool level', () => {
    const [pool] = detectLiquidityPools({
      swingPoints: eqlSwingPoints,
      currentVolatility: 2,
    })

    const sweeps = detectLiquiditySweeps({
      bars: eqlPoolSweepBars,
      swingPoints: emptySwingPoints,
      fvgs: [],
      currentVolatility: 2,
      liquidityPools: [pool],
    })

    expect(sweeps).toEqual([
      expect.objectContaining({
        kind: 'liquidity_pool_sweep',
        direction: 'bullish',
        sweepIndex: 5,
        sweptLevel: 99.96,
        wickExtreme: 99.8,
        close: 100.1,
        penetration: 0.06,
      }),
    ])
  })

  it('suppresses redundant component swing sweeps in the same pool target area', () => {
    const [pool] = detectLiquidityPools({
      swingPoints: eqhSwingPoints,
      currentVolatility: 2,
    })

    const sweeps = detectLiquiditySweeps({
      bars: eqhPoolSweepBars,
      swingPoints: eqhSwingPoints,
      fvgs: [],
      currentVolatility: 2,
      liquidityPools: [pool],
    })

    expect(sweeps).toHaveLength(1)
    expect(sweeps[0]).toEqual(expect.objectContaining({
      kind: 'liquidity_pool_sweep',
      target: expect.objectContaining({ id: pool.id }),
    }))
  })
})
