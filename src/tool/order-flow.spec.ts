import { describe, it, expect, vi } from 'vitest'
import { createOrderFlowTools } from './order-flow.js'
import type { BarService, BarsResult } from '@/domain/market-data/bars/index'

function run<T>(tool: { execute?: unknown }, args: unknown): Promise<T> {
  return (tool.execute as (a: unknown, o: unknown) => Promise<T>)(args, {})
}

describe('createOrderFlowTools', () => {
  it('calculateDeltaVolume 工具已注册并可调用', async () => {
    // Mock bar service
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars: vi.fn()
        .mockResolvedValueOnce({
          // 第一次调用：目标 bars（15m）
          bars: [
            { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
          ],
          meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'tradingview|AAPL' },
        } as BarsResult)
        .mockResolvedValueOnce({
          // 第二次调用：intrabars（1m）
          bars: [
            { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 },
            { date: '2024-01-01 09:05:00', open: 101, high: 102, low: 100, close: 102, volume: 1000 },
            { date: '2024-01-01 09:10:00', open: 102, high: 105, low: 101, close: 104, volume: 1000 },
          ],
          meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 3, barId: 'tradingview|AAPL' },
        } as BarsResult),
    }

    const tools = createOrderFlowTools({ barService: mockBarService })

    expect(tools.calculateDeltaVolume).toBeDefined()
    expect(tools.calculateDeltaVolume.description).toContain('Delta Volume')

    // 执行工具
    const result = await run<{
      bars: Array<Record<string, unknown>>
      meta: Record<string, unknown>
    }>(tools.calculateDeltaVolume, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '15m',
      count: 1,
    })

    expect(result).toHaveProperty('bars')
    expect(result.bars).toHaveLength(1)
    expect(result.bars[0]).toHaveProperty('delta')
    expect(result.bars[0]).toHaveProperty('approxDelta')
    expect(result.bars[0]).toHaveProperty('cumulativeDelta')
    expect(result.bars[0]).toHaveProperty('deltaRatio')
    expect(result.bars[0]).toHaveProperty('coverage')
    expect(result.bars[0].delta).toBe(3000) // 所有 intrabars 都是 +1
    expect(result.meta.intrabarInterval).toBe('1m')
    expect(result.meta.requestedCount).toBe(1)
    expect(result.meta.actualCount).toBe(1)
    expect(result.meta.truncated).toBe(false)
  })

  it('calculateDeltaVolume 为 TradingView 的 1h 长窗口自动选择内部 3m intrabar', async () => {
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
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars,
    }

    const tools = createOrderFlowTools({ barService: mockBarService })
    const result = await run<{ meta: Record<string, unknown> }>(tools.calculateDeltaVolume, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '1h',
      count: 100,
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
    expect(result.meta.intrabarInterval).toBe('3m')
    expect(result.meta.intrabarsPerParent).toBe(20)
    expect(result.meta.requiredIntrabarBars).toBe(2000)
    expect(result.meta.truncated).toBe(false)
    expect(result.meta.degradationReason).toBe('1m intrabar would require 6000 bars, exceeding MAX_BARS=5000. Auto-selected 3m.')
  })

  it('calculateDeltaVolume 的 description 明确说明窗口内近似和 TradingView 5000 根限制', () => {
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars: vi.fn(),
    }
    const tools = createOrderFlowTools({ barService: mockBarService })

    expect(tools.calculateDeltaVolume.description).toContain('window-scoped and approximation-only')
    expect(tools.calculateDeltaVolume.description).toContain('TradingView intraday history is limited to about 5000 bars')
    expect(tools.calculateDeltaVolume.description).toContain('degradationReason')
  })

  it('calculateDeltaVolume 不为非 TradingView 来源选择内部 3m intrabar', async () => {
    const getBars = vi.fn()
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'yfinance|AAPL' },
      } as BarsResult)
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'yfinance|AAPL' },
      } as BarsResult)
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars,
    }

    const tools = createOrderFlowTools({ barService: mockBarService })
    const result = await run<{ meta: Record<string, unknown> }>(tools.calculateDeltaVolume, {
      barId: 'yfinance|AAPL',
      assetClass: 'equity',
      interval: '1h',
      count: 100,
    })

    expect(getBars).toHaveBeenNthCalledWith(1, { barId: 'yfinance|AAPL', assetClass: 'equity' }, {
      interval: '1h',
      count: 100,
      start: undefined,
      end: undefined,
    })
    expect(getBars).toHaveBeenNthCalledWith(2, { barId: 'yfinance|AAPL', assetClass: 'equity' }, {
      interval: '5m',
      start: '2024-01-01',
      end: '2024-01-01',
    })
    expect(result.meta.intrabarInterval).toBe('5m')
    expect(result.meta.intrabarsPerParent).toBe(12)
  })

  it('calculateDeltaVolume 当所有 intrabar 候选都超限时动态截断 count', async () => {
    const getBars = vi.fn()
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'tradingview|AAPL' },
      } as BarsResult)
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01 00:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'tradingview|AAPL' },
      } as BarsResult)
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars,
    }

    const tools = createOrderFlowTools({ barService: mockBarService })
    const result = await run<{ meta: Record<string, unknown> }>(tools.calculateDeltaVolume, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '1w',
      count: 800,
    })

    expect(getBars).toHaveBeenNthCalledWith(1, { barId: 'tradingview|AAPL', assetClass: 'equity' }, {
      interval: '1w',
      count: 714,
      start: undefined,
      end: undefined,
    })
    expect(result.meta.intrabarInterval).toBe('1d')
    expect(result.meta.actualCount).toBe(714)
    expect(result.meta.maxSupportedCount).toBe(714)
    expect(result.meta.truncated).toBe(true)
  })

  it('calculateDeltaVolume 为 1d 大窗口自动降级到 1h intrabar', async () => {
    const getBars = vi.fn()
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'tradingview|AAPL' },
      } as BarsResult)
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01 00:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1, barId: 'tradingview|AAPL' },
      } as BarsResult)
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars,
    }

    const tools = createOrderFlowTools({ barService: mockBarService })
    const result = await run<{ meta: Record<string, unknown> }>(tools.calculateDeltaVolume, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '1d',
      count: 100,
    })

    expect(getBars).toHaveBeenNthCalledWith(1, { barId: 'tradingview|AAPL', assetClass: 'equity' }, {
      interval: '1d',
      count: 100,
      start: undefined,
      end: undefined,
    })
    expect(getBars).toHaveBeenNthCalledWith(2, { barId: 'tradingview|AAPL', assetClass: 'equity' }, {
      interval: '1h',
      start: '2024-01-01',
      end: '2024-01-01',
    })
    expect(result.meta.intrabarInterval).toBe('1h')
    expect(result.meta.intrabarsPerParent).toBe(24)
    expect(result.meta.requiredIntrabarBars).toBe(2400)
    expect(result.meta.truncated).toBe(false)
  })

  it('calculateDeltaVolume 在低 coverage 时返回低置信度 confidence', async () => {
    const mockBarService: BarService = {
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
            { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 800 },
            { date: '2024-01-01 09:05:00', open: 101, high: 102, low: 100, close: 102, volume: 800 },
          ],
          meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 2, barId: 'tradingview|AAPL' },
        } as BarsResult),
    }

    const tools = createOrderFlowTools({ barService: mockBarService })
    const result = await run<{
      bars: Array<Record<string, unknown>>
      meta: Record<string, unknown>
    }>(tools.calculateDeltaVolume, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '15m',
      count: 1,
    })

    expect(result.bars[0].coverage).toBeCloseTo(1600 / 3000, 6)
    expect(result.bars[0].confidence).toBe('not_recommended')
    expect(result.bars[0].lowConfidence).toBe(true)
    expect(result.meta.lowConfidenceBars).toBe(1)
  })

  it('calculateVolumeProfile 工具已注册并可调用', async () => {
    const getBars = vi.fn()
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01', open: 100, high: 110, low: 100, close: 105, volume: 1000 },
          { date: '2024-01-02', open: 105, high: 120, low: 105, close: 115, volume: 1500 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-02', bars: 2 },
      } as BarsResult)
      .mockResolvedValueOnce({
        bars: [
          { date: '2024-01-01 09:00:00', open: 100, high: 102, low: 100, close: 101, volume: 400 },
          { date: '2024-01-01 10:00:00', open: 101, high: 104, low: 101, close: 103, volume: 600 },
          { date: '2024-01-02 09:00:00', open: 105, high: 108, low: 105, close: 107, volume: 700 },
          { date: '2024-01-02 10:00:00', open: 107, high: 120, low: 107, close: 115, volume: 800 },
        ],
        meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-02', bars: 4 },
      } as BarsResult)
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars,
    }

    const tools = createOrderFlowTools({ barService: mockBarService })

    expect(tools.calculateVolumeProfile).toBeDefined()
    expect(tools.calculateVolumeProfile.description).toContain('Volume Profile')

    const result = await run<{
      bins: unknown[]
      poc: Record<string, unknown>
      valueArea: unknown
      meta: Record<string, unknown>
    }>(tools.calculateVolumeProfile, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '1d',
      count: 2,
      numBins: 10,
    })

    expect(result).toHaveProperty('bins')
    expect(result).toHaveProperty('poc')
    expect(result).toHaveProperty('valueArea')
    expect(result.bins.length).toBe(10)
    expect(result.poc).toHaveProperty('volume')
    expect(getBars).toHaveBeenNthCalledWith(1, { barId: 'tradingview|AAPL', assetClass: 'equity' }, {
      interval: '1d',
      count: 2,
      start: undefined,
      end: undefined,
    })
    expect(getBars).toHaveBeenNthCalledWith(2, { barId: 'tradingview|AAPL', assetClass: 'equity' }, {
      interval: '3m',
      start: '2024-01-01',
      end: '2024-01-02',
    })
    expect(result.meta.intrabarInterval).toBe('3m')
    expect(result.meta.targetBars).toBe(2)
    expect(result.meta.intrabarCount).toBe(4)
    expect(result.meta.isApproximation).toBe(true)
  })

  it('calculateDeltaVolume 返回错误当目标 bars 为空', async () => {
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars: vi.fn().mockResolvedValue({
        bars: [],
        meta: { symbol: 'AAPL', from: '', to: '', bars: 0 },
      } as BarsResult),
    }

    const tools = createOrderFlowTools({ barService: mockBarService })

    const result = await run<{ error?: string }>(tools.calculateDeltaVolume, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '15m',
      count: 1,
    })

    expect(result).toHaveProperty('error')
    expect(result.error).toContain('No target bars')
  })

  it('calculateVolumeProfile 返回错误当 bars 为空', async () => {
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars: vi.fn().mockResolvedValue({
        bars: [],
        meta: { symbol: 'AAPL', from: '', to: '', bars: 0 },
      } as BarsResult),
    }

    const tools = createOrderFlowTools({ barService: mockBarService })

    const result = await run<{ error?: string }>(tools.calculateVolumeProfile, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '1d',
      count: 1,
    })

    expect(result).toHaveProperty('error')
    expect(result.error).toContain('No bars')
  })

  it('calculateVolumeProfile 返回错误当 intrabars 为空', async () => {
    const mockBarService: BarService = {
      searchBarSources: vi.fn(),
      getBars: vi.fn()
        .mockResolvedValueOnce({
          bars: [
            { date: '2024-01-01', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
          ],
          meta: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-01', bars: 1 },
        } as BarsResult)
        .mockResolvedValueOnce({
          bars: [],
          meta: { symbol: 'AAPL', from: '', to: '', bars: 0 },
        } as BarsResult),
    }

    const tools = createOrderFlowTools({ barService: mockBarService })

    const result = await run<{ error?: string; meta: Record<string, unknown> }>(tools.calculateVolumeProfile, {
      barId: 'tradingview|AAPL',
      assetClass: 'equity',
      interval: '1d',
      count: 1,
    })

    expect(result).toHaveProperty('error')
    expect(result.error).toContain('No intrabar data')
    expect(result.meta.intrabarCount).toBe(0)
  })
})
