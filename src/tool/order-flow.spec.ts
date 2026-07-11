import { describe, expect, it, vi } from 'vitest'
import type { BarService, BarsResult } from '@/domain/market-data/bars/index.js'
import { createOrderFlowTools } from './order-flow.js'

function run<T>(tool: { execute?: unknown }, args: unknown): Promise<T> {
  return (tool.execute as (a: unknown, o: unknown) => Promise<T>)(args, {})
}

describe('createOrderFlowTools', () => {
  it('exposes only the deep order-flow context tool', () => {
    const tools = createOrderFlowTools({
      barService: { searchBarSources: vi.fn(), getBars: vi.fn() } as unknown as BarService,
    })

    expect(Object.keys(tools)).toEqual(['analyzeOrderFlowContext'])
    expect((tools as Record<string, unknown>).calculateDeltaVolume).toBeUndefined()
    expect((tools as Record<string, unknown>).calculateVolumeProfile).toBeUndefined()
  })

  it('uses a compact schema and rejects old single-purpose tool parameters', () => {
    const tools = createOrderFlowTools({
      barService: { searchBarSources: vi.fn(), getBars: vi.fn() } as unknown as BarService,
    })
    const schema = (tools.analyzeOrderFlowContext as any).inputSchema

    expect(schema.safeParse({
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '15m',
      count: 100,
      mode: 'context',
      numBins: 24,
    }).success).toBe(true)
    expect(schema.safeParse({
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '15m',
      mode: 'summary',
    }).success).toBe(true)
    expect(schema.safeParse({
      barId: 'tradingview|AAPL',
      interval: '15m',
      targetInterval: '15m',
    }).success).toBe(false)
  })

  it('returns combined delta/profile context through the tool adapter', async () => {
    const barService: BarService = {
      searchBarSources: vi.fn(),
      getBars: vi.fn()
        .mockResolvedValueOnce({
          bars: [
            { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
          ],
          meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'tradingview|AAPL' },
        } as BarsResult)
        .mockResolvedValueOnce({
          bars: [
            { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 },
            { date: '2024-01-01 09:05:00', open: 101, high: 102, low: 100, close: 102, volume: 1000 },
            { date: '2024-01-01 09:10:00', open: 102, high: 105, low: 101, close: 104, volume: 1000 },
          ],
          meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 3, barId: 'tradingview|AAPL' },
        } as BarsResult),
    }
    const tools = createOrderFlowTools({ barService })

    const result = await run<Record<string, any>>(tools.analyzeOrderFlowContext, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '15m',
      count: 1,
    })

    expect(result.status).toBe('ok')
    expect(result.delta.bars[0]).toMatchObject({
      delta: 3000,
      cvd: 3000,
      confidence: 'high',
    })
    expect(result.profile).toEqual(expect.objectContaining({
      bins: expect.any(Array),
      poc: expect.any(Object),
      valueArea: expect.objectContaining({
        high: expect.any(Number),
        low: expect.any(Number),
      }),
    }))
    expect(result.meta).toMatchObject({
      intrabarInterval: '1m',
      intrabarTimeframe: '1m',
      requestedCount: 1,
      actualCount: 1,
      isApproximation: true,
    })
  })

  it('description states approximation and intrabar degradation metadata', () => {
    const tools = createOrderFlowTools({
      barService: { searchBarSources: vi.fn(), getBars: vi.fn() } as unknown as BarService,
    })

    expect(tools.analyzeOrderFlowContext.description).toContain('approximation-only')
    expect(tools.analyzeOrderFlowContext.description).toContain('degradationReason')
    expect(tools.analyzeOrderFlowContext.description).toContain('MAX_BARS=5000')
    expect(tools.analyzeOrderFlowContext.description).toContain('bar_proxy')
    expect(tools.analyzeOrderFlowContext.description).toContain('bar completion is unknown')
    expect(tools.analyzeOrderFlowContext.description).toContain('summary: structured summary without raw delta bars or profile bins')
  })
})
