// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BarsResponse } from '../../api/market'
import { KlinePanel } from './KlinePanel'

const mocks = vi.hoisted(() => ({
  bars: vi.fn(),
  searchSources: vi.fn(),
  candleSetData: vi.fn(),
  volumeSetData: vi.fn(),
  fitContent: vi.fn(),
}))

vi.mock('../../api/market', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/market')>()
  return {
    ...actual,
    barsApi: {
      ...actual.barsApi,
      bars: mocks.bars,
      searchSources: mocks.searchSources,
    },
  }
})

vi.mock('../../theme/useEffectiveTheme', () => ({
  useEffectiveTheme: () => 'light',
  useEffectivePalette: () => 'paper',
}))

vi.mock('../../theme/semanticColors', () => ({
  readSemanticColor: () => '#000000',
}))

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'CandlestickSeries',
  HistogramSeries: 'HistogramSeries',
  createChart: () => {
    const timeScale = {
      applyOptions: vi.fn(),
      fitContent: mocks.fitContent,
    }
    return {
      addSeries: (series: string) => ({
        priceScale: () => ({ applyOptions: vi.fn() }),
        setData: series === 'CandlestickSeries' ? mocks.candleSetData : mocks.volumeSetData,
      }),
      remove: vi.fn(),
      timeScale: () => timeScale,
    }
  },
}))

function response(symbol: string, barId: string): BarsResponse {
  return {
    results: [{ date: '2026-07-17', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
    meta: {
      symbol,
      from: '2026-07-17',
      to: '2026-07-17',
      bars: 1,
      source: 'vendor',
      sourceId: 'yfinance',
      barId,
      provider: 'yfinance',
      barCapability: 'delayed',
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchSources.mockResolvedValue({ candidates: [], count: 0 })
})

afterEach(cleanup)

describe('KlinePanel source routing', () => {
  it.each([
    { assetClass: 'currency' as const, symbol: 'EURUSD', barId: 'yfinance|EURUSD' },
    { assetClass: 'equity' as const, symbol: '1.600519', barId: 'eastmoney|1.600519' },
  ])('sends assetClass with an explicit vendor barId ($assetClass)', async ({ assetClass, symbol, barId }) => {
    mocks.bars.mockResolvedValue(response(symbol, barId))

    render(
      <MemoryRouter initialEntries={[`/market/${assetClass}/${symbol}?source=${encodeURIComponent(barId)}`]}>
        <KlinePanel selection={{ symbol, assetClass }} source={barId} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mocks.bars).toHaveBeenCalledWith(expect.objectContaining({
        barId,
        assetClass,
        interval: '1d',
      }))
    })
  })

  it('loads commodity bars through the federated endpoint', async () => {
    mocks.bars.mockResolvedValue(response('gold', 'yfinance|gold'))
    mocks.searchSources.mockResolvedValue({
      candidates: [
        { barId: 'yfinance|GOLD', source: 'vendor', sourceId: 'yfinance', symbol: 'GOLD', name: 'Gold.com, Inc.', assetClass: 'equity', label: 'GOLD', barCapability: 'delayed' },
        { barId: 'yfinance|gold', source: 'vendor', sourceId: 'yfinance', symbol: 'gold', name: 'Gold', assetClass: 'commodity', label: 'gold', barCapability: 'delayed' },
        { barId: 'yfinance|GFI', source: 'vendor', sourceId: 'yfinance', symbol: 'GFI', name: 'Gold Fields', assetClass: 'equity', label: 'GFI', barCapability: 'delayed' },
      ],
      count: 3,
    })

    render(
      <MemoryRouter initialEntries={['/market/commodity/gold?source=yfinance%7Cgold']}>
        <KlinePanel selection={{ symbol: 'gold', assetClass: 'commodity' }} source="yfinance|gold" />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mocks.searchSources).toHaveBeenCalledWith('gold', 12)
      expect(mocks.bars).toHaveBeenCalledWith(expect.objectContaining({
        barId: 'yfinance|gold',
        assetClass: 'commodity',
        interval: '1d',
      }))
      expect(mocks.candleSetData).toHaveBeenCalled()
    })
    expect(screen.queryByRole('combobox', { name: 'Source' })).toBeNull()
  })

  it('prefers the focused tab source when Router location still names the previous tab', async () => {
    mocks.bars.mockResolvedValue(response('1.600519', 'eastmoney|1.600519'))

    render(
      <MemoryRouter initialEntries={['/market/commodity/gold?source=yfinance%7Cgold']}>
        <KlinePanel
          selection={{ symbol: '1.600519', assetClass: 'equity' }}
          source="eastmoney|1.600519"
        />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mocks.bars).toHaveBeenCalledWith(expect.objectContaining({
        barId: 'eastmoney|1.600519',
        assetClass: 'equity',
      }))
    })
    expect(mocks.bars).not.toHaveBeenCalledWith(expect.objectContaining({ barId: 'yfinance|gold' }))
  })

  it('does not inherit a stale Router source when the focused tab requests its default provider', async () => {
    mocks.bars.mockResolvedValue(response('AAPL', 'yfinance|AAPL'))

    render(
      <MemoryRouter initialEntries={['/market/commodity/gold?source=yfinance%7Cgold']}>
        <KlinePanel selection={{ symbol: 'AAPL', assetClass: 'equity' }} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mocks.bars).toHaveBeenCalledWith(expect.objectContaining({
        symbol: 'AAPL',
        assetClass: 'equity',
      }))
    })
    expect(mocks.bars).not.toHaveBeenCalledWith(expect.objectContaining({ barId: 'yfinance|gold' }))
  })

  it('publishes the displayed bars to a sibling analysis panel without another request', async () => {
    const onSnapshot = vi.fn()
    mocks.bars.mockResolvedValue(response('EURUSD', 'yfinance|EURUSD'))

    const view = render(
      <MemoryRouter initialEntries={['/market/currency/EURUSD']}>
        <KlinePanel
          selection={{ symbol: 'EURUSD', assetClass: 'currency' }}
          source="yfinance|EURUSD"
          onSnapshot={onSnapshot}
        />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        bars: expect.arrayContaining([expect.objectContaining({ close: 1.5 })]),
        meta: expect.objectContaining({ barId: 'yfinance|EURUSD' }),
      }))
    })
    // CurrencyDetail mirrors snapshots into parent state. That parent render
    // recreates the selection object; primitive effect dependencies must keep
    // it from becoming a request loop.
    view.rerender(
      <MemoryRouter initialEntries={['/market/currency/EURUSD']}>
        <KlinePanel
          selection={{ symbol: 'EURUSD', assetClass: 'currency' }}
          source="yfinance|EURUSD"
          onSnapshot={onSnapshot}
        />
      </MemoryRouter>,
    )
    expect(mocks.bars).toHaveBeenCalledTimes(1)
  })
})
