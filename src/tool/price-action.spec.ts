import { describe, expect, it } from 'vitest'
import type { BarService, BarSourceRef, GetBarsOpts } from '@/domain/market-data/bars/index.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import { fvgRaidBars } from '@/domain/analysis/price-action/fixtures/sweeps-raids.fixture.js'
import { createPriceActionTools } from './price-action.js'

function run(tool: { execute?: unknown }, args: unknown): Promise<unknown> {
  return (tool.execute as (a: unknown, o: unknown) => Promise<unknown>)(args, {})
}

describe('analyzePriceAction v2 foundation', () => {
  it('exposes the v2 breaking parameter contract', () => {
    const tools = createPriceActionTools({
      barService: fakeBarService([]),
    })
    const schema = (tools.analyzePriceAction as any).inputSchema
    const baseArgs = { barId: 'test|PA', interval: '15m' }

    expect(schema.safeParse({
      ...baseArgs,
      minGapAtrMultiplier: 0.5,
      zoneMitigationSource: 'body',
      fvgZoneMitigationSource: 'wick',
      orderBlockZoneMitigationSource: 'midpoint',
      marketStructureMode: 'extreme',
      liquidityPoolToleranceAtrMultiplier: 0.1,
      liquidityPoolTolerancePctCap: 0,
      minLiquidityPoolTouches: 2,
      liquidityPoolLevels: ['internal', 'swing'],
    }).success).toBe(true)

    for (const source of ['body', 'wick', 'midpoint']) {
      expect(schema.safeParse({ ...baseArgs, zoneMitigationSource: source }).success).toBe(true)
    }
    expect(schema.safeParse({ ...baseArgs, zoneMitigationSource: 'close' }).success).toBe(false)
    expect(schema.safeParse({ ...baseArgs, fvgZoneMitigationSource: 'absolute' }).success).toBe(false)
    expect(schema.safeParse({ ...baseArgs, marketStructureMode: 'adjusted' }).success).toBe(false)
    expect(schema.safeParse({ ...baseArgs, hideOverlappingOrderBlocks: true }).success).toBe(false)
    expect(schema.safeParse({ ...baseArgs, orderBlockOverlapMethod: 'previous' }).success).toBe(false)
  })

  it('returns the single-timeframe v2 keys in top-down order', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarService([
        bar(100, 102, 98, 101, 0),
        bar(101, 103, 99, 102, 1),
        bar(102, 104, 100, 103, 2),
      ]),
    })

    const result = await run(tools.analyzePriceAction, {
      barId: 'test|PA',
      interval: '15m',
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, unknown>

    expect(Object.keys(result)).toEqual([
      'marketStructure',
      'premiumDiscount',
      'liquidityPools',
      'liquiditySweeps',
      'fvgs',
      'ifvgs',
      'orderBlocks',
      'breakers',
      'meta',
    ])
    expect((result.meta as Record<string, unknown>).schemaVersion).toBe(2)
    expect(result.premiumDiscount).toEqual({ status: 'unavailable', reason: 'missing_range' })
    expect(result.liquidityPools).toEqual([])
    expect(result.liquiditySweeps).toEqual([])
    expect(result.breakers).toEqual([])
  })

  it('locks the stable single-timeframe public contract fields', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarService([
        bar(100, 102, 98, 101, 0),
        bar(101, 103, 99, 102, 1),
        bar(102, 104, 100, 103, 2),
      ]),
    })

    const result = await run(tools.analyzePriceAction, {
      barId: 'test|PA',
      interval: '15m',
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    expect({
      keys: Object.keys(result),
      marketStructure: {
        mode: result.marketStructure.marketStructureMode,
        internalTrend: result.marketStructure.stateByLevel.internal.trend,
        swingTrend: result.marketStructure.stateByLevel.swing.trend,
        externalTrend: result.marketStructure.stateByLevel.external.trend,
        bosCount: result.marketStructure.bos.length,
        chochCount: result.marketStructure.choch.length,
        swingStrengthCount: result.marketStructure.swingStrength.length,
      },
      premiumDiscount: result.premiumDiscount,
      liquidityPools: result.liquidityPools,
      liquiditySweeps: result.liquiditySweeps,
      fvgs: result.fvgs,
      ifvgs: result.ifvgs,
      orderBlocks: result.orderBlocks,
      breakers: result.breakers,
      meta: {
        schemaVersion: result.meta.schemaVersion,
        totalFvgCount: result.meta.totalFvgCount,
        returnedFvgCount: result.meta.returnedFvgCount,
        totalIfvgCount: result.meta.totalIfvgCount,
        returnedIfvgCount: result.meta.returnedIfvgCount,
        totalBreakerCount: result.meta.totalBreakerCount,
        returnedBreakerCount: result.meta.returnedBreakerCount,
        totalOrderBlockCount: result.meta.totalOrderBlockCount,
        returnedOrderBlockCount: result.meta.returnedOrderBlockCount,
        bosCount: result.meta.bosCount,
        chochCount: result.meta.chochCount,
      },
    }).toEqual({
      keys: [
        'marketStructure',
        'premiumDiscount',
        'liquidityPools',
        'liquiditySweeps',
        'fvgs',
        'ifvgs',
        'orderBlocks',
        'breakers',
        'meta',
      ],
      marketStructure: {
        mode: 'pivot',
        internalTrend: 'unknown',
        swingTrend: 'unknown',
        externalTrend: 'unknown',
        bosCount: 0,
        chochCount: 0,
        swingStrengthCount: 0,
      },
      premiumDiscount: { status: 'unavailable', reason: 'missing_range' },
      liquidityPools: [],
      liquiditySweeps: [],
      fvgs: [],
      ifvgs: [],
      orderBlocks: [],
      breakers: [],
      meta: {
        schemaVersion: 2,
        totalFvgCount: 0,
        returnedFvgCount: 0,
        totalIfvgCount: 0,
        returnedIfvgCount: 0,
        totalBreakerCount: 0,
        returnedBreakerCount: 0,
        totalOrderBlockCount: 0,
        returnedOrderBlockCount: 0,
        bosCount: 0,
        chochCount: 0,
      },
    })
  })

  it('keeps v2 result placeholders when no bars are returned', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarService([]),
    })

    const result = await run(tools.analyzePriceAction, {
      barId: 'test|EMPTY',
      interval: '15m',
    }) as Record<string, unknown>

    expect(Object.keys(result)).toEqual([
      'marketStructure',
      'premiumDiscount',
      'liquidityPools',
      'liquiditySweeps',
      'fvgs',
      'ifvgs',
      'orderBlocks',
      'breakers',
      'error',
      'meta',
    ])
    expect((result.meta as Record<string, unknown>).schemaVersion).toBe(2)
  })

  it('returns premium-discount context from the latest confirmed swing range', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarService([
        bar(98, 100, 95, 98, 0),
        bar(99, 105, 96, 103, 1),
        bar(108, 120, 100, 110, 2),
        bar(106, 108, 98, 100, 3),
        bar(96, 102, 90, 94, 4),
        bar(86, 99, 80, 85, 5),
        bar(90, 101, 88, 96, 6),
        bar(96, 103, 89, 100, 7),
        bar(100, 104, 99, 101, 8),
      ]),
    })

    const result = await run(tools.analyzePriceAction, {
      barId: 'test|PA',
      interval: '15m',
      swingLookback: 2,
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    expect(result.marketStructure.stateByLevel.swing.trend).toBe('unknown')
    expect(result.premiumDiscount).toMatchObject({
      status: 'available',
      currentPrice: 101,
      location: 'equilibrium',
      equilibriumBandPct: 0.05,
      range: {
        high: { index: 2, price: 120, type: 'high' },
        low: { index: 5, price: 80, type: 'low' },
        midpoint: 100,
        equilibrium: { bottom: 98, top: 102 },
      },
    })
  })

  it('returns liquidity sweep events from single-timeframe analysis', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarService(fvgRaidBars),
    })

    const result = await run(tools.analyzePriceAction, {
      barId: 'test|RAID',
      interval: '15m',
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
      minBodyRatio: 0.5,
    }) as Record<string, any>

    expect(result.liquiditySweeps).toEqual([
      expect.objectContaining({
        kind: 'fvg_raid',
        direction: 'bullish',
        sweepIndex: 3,
        target: expect.objectContaining({ kind: 'fvg' }),
      }),
    ])
  })

  it('returns EQH liquidity pools and pool sweeps from single-timeframe analysis', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarService(eqhToolBars()),
    })

    const result = await run(tools.analyzePriceAction, {
      barId: 'test|EQH',
      interval: '15m',
      internalLookback: 2,
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    expect(result.liquidityPools).toEqual([
      expect.objectContaining({
        type: 'EQH',
        direction: 'bearish',
        level: 'internal',
        touches: [
          { index: 2, price: 100, type: 'high' },
          { index: 5, price: 100.08, type: 'high' },
        ],
        swept: true,
        sweptAtIndex: 8,
      }),
    ])
    expect(result.liquiditySweeps).toContainEqual(expect.objectContaining({
      kind: 'liquidity_pool_sweep',
      direction: 'bearish',
      sweepIndex: 8,
      target: expect.objectContaining({ kind: 'liquidity_pool' }),
    }))
    expect(result.liquiditySweeps).not.toContainEqual(expect.objectContaining({
      kind: 'swing_sweep',
      direction: 'bearish',
      sweptLevel: 100,
    }))
  })

  it('passes the public extreme market-structure mode through analysis', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarService([
        bar(100, 101, 99, 100, 0),
        bar(100, 105, 99, 102, 1),
        bar(102, 104, 101, 103, 2),
        bar(103, 103, 95, 96, 3),
        bar(96, 106, 94, 105, 4),
      ]),
    })

    const result = await run(tools.analyzePriceAction, {
      barId: 'test|EXTREME',
      interval: '15m',
      internalLookback: 2,
      marketStructureMode: 'extreme',
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    expect(result.marketStructure.marketStructureMode).toBe('extreme')
  })
})

describe('analyzeMultiTimeframePriceAction', () => {
  it('is exposed as a separate MTF summary tool without adding intervals mode to analyzePriceAction', () => {
    const tools = createPriceActionTools({
      barService: fakeBarService([]),
    })

    expect(tools.analyzeMultiTimeframePriceAction).toBeDefined()
    const singleSchema = (tools.analyzePriceAction as any).inputSchema
    expect(singleSchema.safeParse({ barId: 'test|PA', intervals: ['1h', '15m'] }).success).toBe(false)
  })

  it('summarizes bullish higher timeframe plus bearish execution pullback', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarServiceByInterval({
        '1h': [
          bar(100, 101, 99, 100, 0),
          bar(101, 104, 100, 103, 1),
          bar(103, 110, 102, 105, 2),
          bar(105, 107, 101, 102, 3),
          bar(102, 103, 96, 98, 4),
          bar(98, 102, 97, 101, 5),
          bar(101, 106, 100, 105, 6),
          bar(105, 113, 104, 112, 7),
          bar(112, 114, 111, 113, 8),
        ],
        '15m': [
          bar(112, 114, 111, 113, 0),
          bar(113, 114, 108, 109, 1),
          bar(109, 110, 100, 104, 2),
          bar(104, 113, 103, 111, 3),
          bar(111, 116, 110, 114, 4),
          bar(114, 115, 109, 110, 5),
          bar(110, 111, 104, 105, 6),
          bar(105, 106, 98, 99, 7),
          bar(99, 100, 96, 98, 8),
        ],
      }),
    })

    const result = await run(tools.analyzeMultiTimeframePriceAction, {
      barId: 'test|MTF',
      intervals: ['1h', '15m'],
      count: 100,
      internalLookback: 2,
      swingLookback: 2,
      externalLookback: 2,
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    expect(result.status).toBe('ok')
    expect(result.summary).toMatchObject({
      bias: 'bullish',
      alignment: 'conflicted',
    })
    expect(result.summary.conflicts).toContain('1h swing trend bullish conflicts with 15m swing trend bearish')
    expect(result.intervals).toHaveLength(2)
    expect(result.intervals[0]).toMatchObject({
      interval: '1h',
      status: 'ok',
      trend: { swing: 'bullish' },
      detailRequest: {
        tool: 'analyzePriceAction',
        args: expect.objectContaining({ barId: 'test|MTF', interval: '1h', count: 100 }),
      },
    })
    expect(result.intervals[1]).toMatchObject({
      interval: '15m',
      status: 'ok',
      trend: { swing: 'bearish' },
    })
    expect(result.intervals[0].liquidity).toEqual(expect.objectContaining({
      poolCount: expect.any(Number),
      sweepCount: expect.any(Number),
    }))
    expect(result.intervals[0].zone).toEqual(expect.objectContaining({ fvgCount: expect.any(Number), orderBlockCount: expect.any(Number) }))
    expect(result.intervals[0].premiumDiscount).toEqual(expect.objectContaining({ status: expect.any(String) }))
    expect(result.intervals[0].structure).toEqual(expect.objectContaining({ mode: expect.any(String), bosCount: expect.any(Number), chochCount: expect.any(Number) }))
  })

  it('marks the top-level result partial when one interval has insufficient data', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarServiceByInterval({
        '1h': trendBars('bullish'),
        '15m': [bar(100, 101, 99, 100, 0), bar(100, 101, 99, 100, 1)],
      }),
    })

    const result = await run(tools.analyzeMultiTimeframePriceAction, {
      barId: 'test|MTF',
      intervals: ['1h', '15m'],
      internalLookback: 2,
      swingLookback: 2,
      externalLookback: 2,
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    expect(result.status).toBe('partial')
    expect(result.intervals.find((entry: any) => entry.interval === '15m')).toMatchObject({
      status: 'insufficient',
      error: 'Insufficient bars returned for price-action summary',
    })
  })

  it('marks the top-level result partial when every interval is insufficient', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarServiceByInterval({
        '1h': [bar(100, 101, 99, 100, 0), bar(100, 101, 99, 100, 1)],
        '15m': [bar(100, 101, 99, 100, 0)],
      }),
    })

    const result = await run(tools.analyzeMultiTimeframePriceAction, {
      barId: 'test|MTF',
      intervals: ['1h', '15m'],
    }) as Record<string, any>

    expect(result.status).toBe('partial')
    expect(result.error).toBeUndefined()
    expect(result.intervals.map((entry: any) => entry.status)).toEqual(['insufficient', 'insufficient'])
  })

  it('locks the stable MTF public contract statuses and detail requests', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarServiceByInterval({
        ok: trendBars('bullish'),
        partial: [bar(100, 101, 99, 100, 0)],
      }, {
        failed: new Error('provider timeout'),
      }),
    })

    const partial = await run(tools.analyzeMultiTimeframePriceAction, {
      barId: 'test|MTF-GOLDEN',
      intervals: ['ok', 'partial', 'failed'],
      count: 100,
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    const ok = await run(tools.analyzeMultiTimeframePriceAction, {
      barId: 'test|MTF-GOLDEN',
      intervals: ['ok'],
      count: 100,
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    expect({
      status: ok.status,
      error: ok.error,
      intervalShapes: ok.intervals.map((entry: any) => ({
        interval: entry.interval,
        status: entry.status,
        detailRequest: entry.detailRequest,
        hasTrend: Boolean(entry.trend),
        hasLiquidity: Boolean(entry.liquidity),
        hasZone: Boolean(entry.zone),
        hasPremiumDiscount: Boolean(entry.premiumDiscount),
        hasStructure: Boolean(entry.structure),
        hasMeta: Boolean(entry.meta),
      })),
    }).toEqual({
      status: 'ok',
      error: undefined,
      intervalShapes: [
        {
          interval: 'ok',
          status: 'ok',
          detailRequest: {
            tool: 'analyzePriceAction',
            args: expect.objectContaining({ barId: 'test|MTF-GOLDEN', interval: 'ok', count: 100 }),
          },
          hasTrend: true,
          hasLiquidity: true,
          hasZone: true,
          hasPremiumDiscount: true,
          hasStructure: true,
          hasMeta: true,
        },
      ],
    })

    expect({
      status: partial.status,
      intervalShapes: partial.intervals.map((entry: any) => ({
        interval: entry.interval,
        status: entry.status,
        detailRequest: entry.detailRequest,
        hasMeta: Boolean(entry.meta),
        error: entry.error,
      })),
    }).toEqual({
      status: 'partial',
      intervalShapes: [
        {
          interval: 'ok',
          status: 'ok',
          detailRequest: {
            tool: 'analyzePriceAction',
            args: expect.objectContaining({ barId: 'test|MTF-GOLDEN', interval: 'ok', count: 100 }),
          },
          hasMeta: true,
          error: undefined,
        },
        {
          interval: 'partial',
          status: 'insufficient',
          detailRequest: {
            tool: 'analyzePriceAction',
            args: expect.objectContaining({ barId: 'test|MTF-GOLDEN', interval: 'partial', count: 100 }),
          },
          hasMeta: true,
          error: 'Insufficient bars returned for price-action summary',
        },
        {
          interval: 'failed',
          status: 'error',
          detailRequest: {
            tool: 'analyzePriceAction',
            args: expect.objectContaining({ barId: 'test|MTF-GOLDEN', interval: 'failed', count: 100 }),
          },
          hasMeta: false,
          error: 'provider timeout',
        },
      ],
    })

    const error = await run(tools.analyzeMultiTimeframePriceAction, {
      barId: 'test|MTF-GOLDEN',
      intervals: ['failed'],
    }) as Record<string, any>

    expect({
      status: error.status,
      error: error.error,
      intervalShapes: error.intervals.map((entry: any) => ({
        interval: entry.interval,
        status: entry.status,
        detailRequest: entry.detailRequest,
        error: entry.error,
      })),
    }).toEqual({
      status: 'error',
      error: 'All intervals failed',
      intervalShapes: [
        {
          interval: 'failed',
          status: 'error',
          detailRequest: {
            tool: 'analyzePriceAction',
            args: expect.objectContaining({ barId: 'test|MTF-GOLDEN', interval: 'failed' }),
          },
          error: 'provider timeout',
        },
      ],
    })
  })

  it('includes liquidity pool context in each interval summary', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarServiceByInterval({
        '15m': eqhToolBars(),
      }),
    })

    const result = await run(tools.analyzeMultiTimeframePriceAction, {
      barId: 'test|MTF-EQH',
      intervals: ['15m'],
      count: 100,
      internalLookback: 2,
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    expect(result.status).toBe('ok')
    expect(result.intervals[0].liquidity).toMatchObject({
      poolCount: 1,
      sweepCount: expect.any(Number),
    })
  })

  it('marks the top-level result partial when one interval fetch fails', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarServiceByInterval({
        '1h': trendBars('bullish'),
      }, {
        '15m': new Error('provider timeout'),
      }),
    })

    const result = await run(tools.analyzeMultiTimeframePriceAction, {
      barId: 'test|MTF',
      intervals: ['1h', '15m'],
      internalLookback: 2,
      swingLookback: 2,
      externalLookback: 2,
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
    }) as Record<string, any>

    expect(result.status).toBe('partial')
    expect(result.intervals.find((entry: any) => entry.interval === '15m')).toMatchObject({
      status: 'error',
      error: 'provider timeout',
    })
  })

  it('returns top-level error when all intervals fail', async () => {
    const tools = createPriceActionTools({
      barService: fakeBarServiceByInterval({}, {
        '1h': new Error('upstream down'),
        '15m': new Error('provider timeout'),
      }),
    })

    const result = await run(tools.analyzeMultiTimeframePriceAction, {
      barId: 'test|MTF',
      intervals: ['1h', '15m'],
    }) as Record<string, any>

    expect(result.status).toBe('error')
    expect(result.error).toBe('All intervals failed')
    expect(result.intervals.map((entry: any) => entry.status)).toEqual(['error', 'error'])
  })
})

function fakeBarService(bars: OhlcvBar[]): BarService {
  return {
    searchBarSources: async () => [],
    getBars: async () => ({
      bars,
      meta: {
        symbol: 'PA',
        from: bars[0]?.date ?? '',
        to: bars.at(-1)?.date ?? '',
        bars: bars.length,
      },
    }),
  }
}

function fakeBarServiceByInterval(
  barsByInterval: Record<string, OhlcvBar[]>,
  errorsByInterval: Record<string, Error> = {},
): BarService {
  return {
    searchBarSources: async () => [],
    getBars: async (_ref: BarSourceRef, opts: GetBarsOpts) => {
      const error = errorsByInterval[opts.interval]
      if (error) throw error
      const bars = barsByInterval[opts.interval] ?? []
      return {
        bars,
        meta: {
          symbol: 'MTF',
          from: bars[0]?.date ?? '',
          to: bars.at(-1)?.date ?? '',
          bars: bars.length,
        },
      }
    },
  }
}

function trendBars(direction: 'bullish' | 'bearish'): OhlcvBar[] {
  return direction === 'bullish'
    ? [
        bar(100, 101, 99, 100, 0),
        bar(101, 104, 100, 103, 1),
        bar(103, 110, 102, 105, 2),
        bar(105, 107, 101, 102, 3),
        bar(102, 103, 96, 98, 4),
        bar(98, 102, 97, 101, 5),
        bar(101, 106, 100, 105, 6),
        bar(105, 113, 104, 112, 7),
        bar(112, 114, 111, 113, 8),
      ]
    : [
        bar(112, 114, 111, 113, 0),
        bar(113, 114, 108, 109, 1),
        bar(109, 110, 100, 104, 2),
        bar(104, 113, 103, 111, 3),
        bar(111, 116, 110, 114, 4),
        bar(114, 115, 109, 110, 5),
        bar(110, 111, 104, 105, 6),
        bar(105, 106, 98, 99, 7),
        bar(99, 100, 96, 98, 8),
      ]
}

function bar(open: number, high: number, low: number, close: number, index: number): OhlcvBar {
  return {
    date: `2024-01-01 09:${String(index).padStart(2, '0')}`,
    open,
    high,
    low,
    close,
    volume: 1000,
  }
}

function eqhToolBars(): OhlcvBar[] {
  return [
    bar(99, 99.2, 98.6, 99, 0),
    bar(99, 99.4, 98.8, 99.2, 1),
    bar(99.2, 100, 98.9, 99.4, 2),
    bar(99.4, 99.5, 98.9, 99.1, 3),
    bar(99.1, 99.6, 98.7, 99.2, 4),
    bar(99.2, 100.08, 98.8, 99.4, 5),
    bar(99.4, 99.7, 98.9, 99.3, 6),
    bar(99.3, 99.6, 98.8, 99.2, 7),
    bar(99.2, 100.2, 98.8, 99.9, 8),
  ]
}
