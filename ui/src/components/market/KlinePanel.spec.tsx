// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
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

describe('KlinePanel chart controls', () => {
  it('names each control independently and exposes the selected interval and range', async () => {
    mocks.bars.mockResolvedValue(response('AAPL', 'yfinance|AAPL'))

    render(
      <MemoryRouter initialEntries={['/market/equity/AAPL?interval=5m&range=3M']}>
        <KlinePanel selection={{ symbol: 'AAPL', assetClass: 'equity' }} />
      </MemoryRouter>,
    )

    const intervals = screen.getByRole('group', { name: 'Interval' })
    expect(within(intervals).getByRole('button', { name: '5m' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(intervals).getByRole('button', { name: '1m' }).getAttribute('aria-pressed')).toBe('false')

    const ranges = screen.getByRole('group', { name: 'Range' })
    expect(within(ranges).getByRole('button', { name: '3M' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(ranges).getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(within(intervals).getByRole('button', { name: '1h' }))

    await waitFor(() => {
      expect(within(intervals).getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('true')
      expect(mocks.bars).toHaveBeenCalledWith(expect.objectContaining({ interval: '1h' }))
    })
  })
})

it('renders timezone-bearing intraday bars as finite chart timestamps', async () => {
  const data = response('AAPL', 'yfinance|AAPL')
  data.results![0].date = '2026-07-17T13:30:00.000Z'
  mocks.bars.mockResolvedValue(data)
  render(<MemoryRouter><KlinePanel selection={{ symbol: 'AAPL', assetClass: 'equity' }} /></MemoryRouter>)
  await waitFor(() => expect(mocks.candleSetData).toHaveBeenCalledWith([expect.objectContaining({ time: Date.parse('2026-07-17T13:30:00Z') / 1000 })]))
})

function CurrentRoute() { const location = useLocation(); return <output data-testid="route">{location.pathname}</output> }

it('switches to a usable minute window from a stale workspace route', async () => {
  mocks.bars.mockResolvedValue(response('AAPL', 'yfinance|AAPL'))
  render(<MemoryRouter initialEntries={['/chat/workspaces/old/details']}><CurrentRoute /><KlinePanel selection={{ symbol: 'AAPL', assetClass: 'equity' }} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '5m' }))
  await waitFor(() => expect(mocks.bars).toHaveBeenLastCalledWith(expect.objectContaining({ interval: '5m', start: expect.any(String) })))
  expect(screen.getByRole('button', { name: '1M' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByTestId('route').textContent).toBe('/market/equity/AAPL')
})

it('explains a newer rejected candle without substituting it into the chart', async () => {
  const data = response('AAPL', 'yfinance|AAPL')
  data.meta!.quality = { scope: 'fetched_window_before_count', inspectedRows: 2, excludedRows: 1, latestExcludedRecordAt: '2026-07-18', latestExcludedFields: ['close'], reason: 'missing_or_non_finite_ohlc' }
  mocks.bars.mockResolvedValue(data)
  render(<MemoryRouter><KlinePanel selection={{ symbol: 'AAPL', assetClass: 'equity' }} source="yfinance|AAPL" /></MemoryRouter>)
  expect((await screen.findByRole('status')).textContent).toContain('2026-07-18 (close missing or invalid)')
  expect(screen.getByText('Latest record: 2026-07-17')).toBeTruthy()
})

it('embedded market references stay in chat and request 300 exact-source bars', async () => {
  mocks.bars.mockResolvedValue(response('AAPL', 'yfinance|AAPL'))
  function Location() { return <output data-testid="location">{useLocation().pathname}</output> }
  render(<MemoryRouter initialEntries={['/chat/workspaces/test/s/session']}><Location /><KlinePanel selection={null} source="yfinance|AAPL" embeddedInterval="1d" /></MemoryRouter>)
  await waitFor(() => expect(mocks.bars).toHaveBeenCalledWith({ barId: 'yfinance|AAPL', interval: '1d', count: 300 }))
  expect(mocks.searchSources).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '4h' }))
  await waitFor(() => expect(mocks.bars).toHaveBeenLastCalledWith({ barId: 'yfinance|AAPL', interval: '4h', count: 300 }))
  expect(screen.getByTestId('location').textContent).toBe('/chat/workspaces/test/s/session')
  expect(screen.queryByRole('radiogroup', { name: 'Range' })).toBeNull()
})
