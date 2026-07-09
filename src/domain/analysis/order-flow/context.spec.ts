import { describe, expect, it, vi } from 'vitest'
import type { BarService, BarsResult } from '@/domain/market-data/bars/index.js'
import { analyzeOrderFlowContext } from './context.js'

describe('analyzeOrderFlowContext', () => {
  it('returns delta and profile context with intrabar precision metadata', async () => {
    const getBars = vi.fn()
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
      } as BarsResult)
    const barService = { searchBarSources: vi.fn(), getBars } as unknown as BarService

    const result = await analyzeOrderFlowContext(barService, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '15m',
      count: 1,
      numBins: 5,
    })

    expect(result.status).toBe('ok')
    expect(result.delta?.bars).toHaveLength(1)
    expect(result.delta?.bars[0]).toMatchObject({
      delta: 3000,
      approxDelta: 3000,
      cumulativeDelta: 3000,
      cvd: 3000,
      deltaRatio: 1,
      coverage: 1,
      confidence: 'high',
      lowConfidence: false,
      isApproximation: true,
    })
    expect(result.profile?.bins).toHaveLength(5)
    expect(result.profile?.poc).toBeTruthy()
    expect(result.profile?.valueArea).toEqual(expect.objectContaining({
      high: expect.any(Number),
      low: expect.any(Number),
    }))
    expect(result.meta).toMatchObject({
      intrabarInterval: '1m',
      intrabarTimeframe: '1m',
      intrabarCount: 3,
      targetBars: 1,
      requestedCount: 1,
      actualCount: 1,
      truncated: false,
      lowConfidenceBars: 0,
      isApproximation: true,
    })
  })

  it('supports delta-only mode for callers that do not need volume profile', async () => {
    const getBars = vi.fn(async () => ({
      bars: [
        { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 },
      ],
      meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1 },
    } as BarsResult))
    const barService = { searchBarSources: vi.fn(), getBars } as unknown as BarService

    const result = await analyzeOrderFlowContext(barService, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '15m',
      count: 1,
      mode: 'delta',
    })

    expect(result.delta?.bars).toHaveLength(1)
    expect(result.profile).toBeUndefined()
  })

  it('chooses TradingView 3m intrabars for a long 1h window', async () => {
    const getBars = vi.fn()
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'tradingview|AAPL' },
      } as BarsResult)
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'tradingview|AAPL' },
      } as BarsResult)
    const barService = { searchBarSources: vi.fn(), getBars } as unknown as BarService

    const result = await analyzeOrderFlowContext(barService, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '1h',
      count: 100,
      mode: 'delta',
    })

    expect(getBars).toHaveBeenNthCalledWith(1, { barId: 'tradingview|AAPL', assetClass: 'equity' }, {
      interval: '1h',
      count: 100,
      start: undefined,
      end: undefined,
    })
    expect(getBars).toHaveBeenNthCalledWith(2, { barId: 'tradingview|AAPL', assetClass: 'equity' }, {
      interval: '3m',
      start: '2024-01-01',
      end: '2024-01-01',
    })
    expect(result.meta).toMatchObject({
      intrabarInterval: '3m',
      intrabarsPerParent: 20,
      requiredIntrabarBars: 2000,
      truncated: false,
      degradationReason: '1m intrabar would require 6000 bars, exceeding MAX_BARS=5000. Auto-selected 3m.',
    })
  })

  it('returns no_target_bars without running a profile calculation', async () => {
    const barService = {
      searchBarSources: vi.fn(),
      getBars: vi.fn(async () => ({
        bars: [],
        meta: { symbol: 'AAPL', from: '', to: '', bars: 0 },
      } as BarsResult)),
    } as unknown as BarService

    const result = await analyzeOrderFlowContext(barService, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '15m',
    })

    expect(result).toMatchObject({
      status: 'no_target_bars',
      error: 'No target bars returned for the requested window',
      delta: { bars: [] },
      profile: { bins: [], poc: null, valueArea: null },
      meta: {
        intrabarCount: 0,
        targetBars: 0,
        isApproximation: true,
      },
    })
  })

  it('reports target index offset when supplied bars are capped to the supported intrabar window', async () => {
    const targetBars = Array.from({ length: 122 }, (_, index) => ({
      date: new Date(Date.UTC(2024, 0, 1 + index, 0, 0, 0)).toISOString().slice(0, 10),
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: 100,
    }))
    const barService = {
      searchBarSources: vi.fn(),
      getBars: vi.fn(async () => ({
        bars: [{ date: '2024-01-04', open: 1, high: 1, low: 1, close: 1, volume: 1 }],
        meta: { symbol: 'AAPL', from: '2024-01-04', to: '2024-05-01', bars: 1 },
      } as BarsResult)),
    } as unknown as BarService

    const result = await analyzeOrderFlowContext(barService, {
      barId: 'yfinance|AAPL',
      assetClass: 'equity',
      interval: '1000h',
      count: targetBars.length,
      mode: 'delta',
      targetBars,
    })

    expect(result.status).toBe('ok')
    expect(result.meta.targetIndexOffset).toBe(3)
    expect(result.meta.targetBars).toBe(119)
  })
})
