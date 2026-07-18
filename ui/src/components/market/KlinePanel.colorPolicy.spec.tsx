// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const candle = { applyOptions: vi.fn(), setData: vi.fn() }
  const priceScale = { applyOptions: vi.fn() }
  const volume = { applyOptions: vi.fn(), setData: vi.fn(), priceScale: vi.fn(() => priceScale) }
  const timeScale = { applyOptions: vi.fn(), fitContent: vi.fn() }
  const chart = {
    addSeries: vi.fn(), applyOptions: vi.fn(), remove: vi.fn(), timeScale: vi.fn(() => timeScale),
  }
  const createChart = vi.fn(() => chart)
  const bars = vi.fn()
  const searchSources = vi.fn()
  return { candle, volume, chart, createChart, bars, searchSources }
})

vi.mock('lightweight-charts', () => ({
  createChart: mocks.createChart,
  CandlestickSeries: { kind: 'candlestick' },
  HistogramSeries: { kind: 'histogram' },
}))

vi.mock('../../api/market', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../../api/market')>()
  return { ...original, barsApi: { bars: mocks.bars, searchSources: mocks.searchSources } }
})

import { useThemeStore } from '../../theme/store'
import { KlinePanel } from './KlinePanel'

const appearance = {
  activeFamilyId: 'builtin-openalice', mode: 'dark' as const, terminal: { mode: 'follow' as const },
  marketColors: 'protected' as const, marketDirection: 'green-up-red-down' as const, statusColors: 'protected' as const,
}

function seedPolicy(up: string, down: string): void {
  const style = document.documentElement.style
  const values: Record<string, string> = {
    '--oa-chart-axis-text': '#aaaaaa', '--oa-chart-axis-border': '#333333',
    '--oa-chart-background': '#111111', '--oa-chart-crosshair': '#eeeeee',
    '--oa-chart-grid': '#222222', '--oa-chart-selection': '#444444',
    '--oa-market-up': up, '--oa-market-down': down,
    '--oa-market-volume-up': up, '--oa-market-volume-down': down,
  }
  for (const [name, value] of Object.entries(values)) style.setProperty(name, value)
}

describe('KlinePanel color policy projection', () => {
  beforeEach(() => {
    seedPolicy('#00aa00', '#cc0000')
    mocks.chart.addSeries.mockReturnValueOnce(mocks.candle).mockReturnValueOnce(mocks.volume)
    mocks.searchSources.mockResolvedValue({ candidates: [] })
    mocks.bars.mockResolvedValue({ results: [{ date: '2026-01-01', open: 1, high: 3, low: 1, close: 2, volume: 5 }], meta: null })
    useThemeStore.setState({ appearance, theme: 'dark', families: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    document.documentElement.removeAttribute('style')
  })

  it('keeps one chart and data request while direction changes reapply options and volume data', async () => {
    render(<MemoryRouter><KlinePanel selection={{ symbol: 'AAPL', assetClass: 'equity' }} /></MemoryRouter>)
    await waitFor(() => expect(mocks.bars).toHaveBeenCalledTimes(1))
    expect(mocks.createChart).toHaveBeenCalledTimes(1)

    const applyCount = mocks.chart.applyOptions.mock.calls.length
    const volumeSetCount = mocks.volume.setData.mock.calls.length
    seedPolicy('#cc0000', '#00aa00')
    useThemeStore.setState({ appearance: { ...appearance, marketDirection: 'red-up-green-down' } })

    await waitFor(() => expect(mocks.chart.applyOptions.mock.calls.length).toBeGreaterThan(applyCount))
    expect(mocks.candle.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ borderUpColor: '#cc0000', downColor: '#00aa00' }))
    expect(mocks.volume.setData.mock.calls.length).toBeGreaterThan(volumeSetCount)
    expect(mocks.createChart).toHaveBeenCalledTimes(1)
    expect(mocks.bars).toHaveBeenCalledTimes(1)
  })
})
