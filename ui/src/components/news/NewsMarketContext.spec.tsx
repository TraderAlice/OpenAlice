// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BarsResponse, HistoricalBar, SectorRotationResult } from '../../api/market'
import { i18n } from '../../i18n'
import { NewsMarketContext } from './NewsMarketContext'

const mocks = vi.hoisted(() => ({ bars: vi.fn(), rotation: vi.fn() }))
vi.mock('../../api/market', () => ({ barsApi: { bars: mocks.bars }, marketApi: { sectorRotation: mocks.rotation } }))
vi.mock('../MeasuredChartFrame', () => ({
  MeasuredChartFrame: ({ children }: { children: (size: { width: number; height: number }) => ReactNode }) => children({ width: 480, height: 160 }),
}))
const bar = (date: string, close: number): HistoricalBar => ({ date, close, open: close, high: close, low: close, volume: 1 })
function response(symbol: string, previous = 100, latest = 110): BarsResponse {
  const results = [bar('2026-10-22', previous), bar('2026-10-23', latest)]
  return { results, meta: { symbol, provider: 'yfinance', source: 'vendor', sourceId: 'yfinance', barId: `vendor:yfinance:equity:${symbol}`, from: results[0].date, to: results[1].date, bars: 2 } }
}
const rotation = (): SectorRotationResult => ({
  asOf: '2026-10-23', meta: { provider: 'fixture', asOf: '2026-10-23', stale: true },
  benchmark: { symbol: 'SPY', returns: { '1D': 0, '1W': 0, '1M': 0, '3M': 0, '6M': 0 } },
  sectors: [0.02, -0.01, 0, null, NaN, Infinity].map((value, index) => ({
    symbol: ['XLK', 'XLE', 'XLV', 'XLF', 'XLI', 'XLU'][index], sector: `Sector ${index}`,
    returns: { '1D': value, '1W': 0.04, '1M': 0.05, '3M': 0.06, '6M': 0.07 },
    rel_strength: { '1D': null, '1W': null, '1M': null, '3M': null, '6M': null },
    momentum_acceleration: null, dollar_volume: null, dv_share: null, dv_share_change: null,
    rvol: null, rotation_score: null, bars: 130,
  })), methodology: 'fixture',
})
beforeEach(async () => {
  await i18n.changeLanguage('en')
  mocks.bars.mockReset().mockImplementation(async ({ symbol }) => response(symbol))
  mocks.rotation.mockReset().mockImplementation(async () => rotation())
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('loads four bounded daily context snapshots and exposes actual record date/source without opening a chart', async () => {
  render(<NewsMarketContext watchlist={[]} />)
  expect(within(screen.getByRole('region', { name: 'Market context' })).getByText('Daily record')).toBeTruthy()
  const ticker = screen.getByRole('button', { name: 'View S&P 500 chart' })
  await within(ticker).findByText('110.00')
  expect(within(ticker).getByText('+10.00%')).toBeTruthy()
  expect(ticker.textContent).toContain('2026-10-23')
  expect(ticker.textContent).toContain('yfinance')
  expect(mocks.bars).toHaveBeenCalledTimes(4)
  expect(mocks.bars.mock.calls.every(([query]) => query.interval === '1d' && query.count === 2)).toBe(true)
  expect(screen.queryByRole('region', { name: 'Market chart' })).toBeNull()
  expect(screen.queryByRole('group', { name: 'Markets' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Sector ETFs' })).toBeNull()
  expect(mocks.rotation).not.toHaveBeenCalled()
})

it('uses existing watchlist identities instead of adding benchmark subscriptions', async () => {
  render(<NewsMarketContext watchlist={[{ assetClass: 'equity', symbol: 'AAPL' }]} />)
  await within(screen.getByRole('button', { name: 'View AAPL chart' })).findByText('110.00')
  expect(screen.queryByRole('button', { name: 'View S&P 500 chart' })).toBeNull()
  expect(mocks.bars).toHaveBeenCalledWith({ symbol: 'AAPL', assetClass: 'equity', interval: '1d', count: 2 })
})

it('bounds the strip to the first four watchlist assets and leaves a one-record change unknown', async () => {
  mocks.bars.mockImplementation(async ({ symbol }) => ({ ...response(symbol), results: [bar('2026-10-23', -5)] }))
  render(<NewsMarketContext watchlist={['A', 'B', 'C', 'D', 'E'].map(symbol => ({ assetClass: 'equity', symbol }))} />)
  const ticker = screen.getByRole('button', { name: 'View A chart' })
  await within(ticker).findByText('-5.00')
  expect(within(ticker).getByText('—')).toBeTruthy()
  expect(mocks.bars).toHaveBeenCalledTimes(4)
  expect(screen.queryByRole('button', { name: 'View E chart' })).toBeNull()
})

it('opens price history lazily, changes its range and returns focus on collapse', async () => {
  const user = userEvent.setup()
  render(<NewsMarketContext watchlist={[]} />)
  const ticker = screen.getByRole('button', { name: 'View S&P 500 chart' })
  await within(ticker).findByText('110.00')
  await user.click(ticker)
  const chart = screen.getByRole('region', { name: 'Market chart' })
  await within(chart).findByText('110.00')
  expect(chart.querySelector('.recharts-line-curve')).toBeTruthy()
  expect(mocks.bars).toHaveBeenCalledWith(expect.objectContaining({ symbol: '^GSPC', interval: '1d', start: expect.any(String) }))
  const priorStart = mocks.bars.mock.calls.at(-1)![0].start
  await user.click(within(chart).getByRole('button', { name: '1M' }))
  await waitFor(() => expect(mocks.bars.mock.calls.at(-1)![0].start).not.toBe(priorStart))
  await user.click(within(chart).getByRole('button', { name: 'Close price chart' }))
  expect(screen.queryByRole('region', { name: 'Market chart' })).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(ticker))
})

it('keeps other tickers readable during one source failure and retries only that ticker', async () => {
  const user = userEvent.setup()
  let failed = true
  mocks.bars.mockImplementation(async ({ symbol }) => { if (symbol === 'GC=F' && failed) throw new Error('offline'); return response(symbol) })
  render(<NewsMarketContext watchlist={[]} />)
  await within(screen.getByRole('button', { name: 'View S&P 500 chart' })).findByText('110.00')
  const retry = await screen.findByRole('button', { name: 'Retry Gold futures data' })
  failed = false
  await user.click(retry)
  await within(screen.getByRole('button', { name: 'View Gold futures chart' })).findByText('110.00')
  expect(mocks.bars.mock.calls.filter(([query]) => query.symbol === '^GSPC')).toHaveLength(1)
})

it('preserves zero prices and avoids division by zero in daily changes', async () => {
  mocks.bars.mockImplementation(async ({ symbol }) => response(symbol, symbol === 'BASEZERO' ? 0 : 100, symbol === 'ZERO' ? 0 : 10))
  render(<NewsMarketContext watchlist={[{ assetClass: 'equity', symbol: 'ZERO' }, { assetClass: 'equity', symbol: 'BASEZERO' }]} />)
  const zero = screen.getByRole('button', { name: 'View ZERO chart' })
  await within(zero).findByText('0.00')
  expect(within(zero).getByText('-100.00%')).toBeTruthy()
  const base = screen.getByRole('button', { name: 'View BASEZERO chart' })
  await within(base).findByText('10.00')
  expect(base.textContent).not.toMatch(/Infinity|NaN/)
  expect(within(base).getByText('—')).toBeTruthy()
})

it('does not replace the new asset chart when a previous request finishes late', async () => {
  const user = userEvent.setup()
  let finish!: (value: BarsResponse) => void
  mocks.bars.mockImplementation(async (query) => {
    if (query.symbol === '^GSPC' && query.start) return new Promise<BarsResponse>(resolve => { finish = resolve })
    return response(query.symbol, 100, query.symbol === '000001.SS' ? 200 : 110)
  })
  render(<NewsMarketContext watchlist={[]} />)
  await user.click(screen.getByRole('button', { name: 'View S&P 500 chart' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  await user.click(screen.getByRole('button', { name: 'View Shanghai Composite chart' }))
  const chart = screen.getByRole('region', { name: 'Market chart' })
  await within(chart).findByText('200.00')
  await act(async () => { finish(response('^GSPC')); await Promise.resolve() })
  expect(within(chart).getByText('200.00')).toBeTruthy()
  expect(within(chart).queryByText('110.00')).toBeNull()
})

it.each(['empty', 'nonfinite'])('shows unavailable %s history without manufacturing a mini chart', async kind => {
  const user = userEvent.setup()
  mocks.bars.mockResolvedValue({ results: kind === 'empty' ? [] : [bar('2026-10-23', NaN)], meta: null })
  render(<NewsMarketContext watchlist={[]} />)
  await user.click(screen.getByRole('button', { name: 'View S&P 500 chart' }))
  const chart = screen.getByRole('region', { name: 'Market chart' })
  expect(await within(chart).findByText('Market data is unavailable.')).toBeTruthy()
  expect(chart.querySelector('.recharts-line-curve')).toBeNull()
})

it.each([
  ['Forex', 'currency', ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCNY']],
  ['Commodities', 'commodity', ['gold', 'crude_oil', 'silver', 'copper']],
  ['Crypto', 'crypto', ['BTCUSD', 'ETHUSD', 'SOLUSD']],
] as const)('loads only the selected %s group and closes the previous inline chart', async (name, assetClass, symbols) => {
  const user = userEvent.setup()
  render(<NewsMarketContext watchlist={[]} showMarkets />)
  await within(screen.getByRole('button', { name: 'View S&P 500 chart' })).findByText('110.00')
  await user.click(screen.getByRole('button', { name: 'View S&P 500 chart' }))
  await within(screen.getByRole('region', { name: 'Market chart' })).findByText('110.00')
  mocks.bars.mockClear()
  await user.click(screen.getByRole('button', { name }))
  await waitFor(() => expect(mocks.bars).toHaveBeenCalledTimes(symbols.length))
  expect(mocks.bars.mock.calls.map(([query]) => query.symbol)).toEqual(symbols)
  expect(mocks.bars.mock.calls.every(([query]) => query.assetClass === assetClass && query.count === 2)).toBe(true)
  expect(screen.queryByRole('region', { name: 'Market chart' })).toBeNull()
  expect(mocks.rotation).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true')
})

it('keeps four decimal places on forex prices', async () => {
  const user = userEvent.setup()
  mocks.bars.mockImplementation(async ({ symbol }) => response(symbol, 1.12, 1.12208259))
  render(<NewsMarketContext watchlist={[]} showMarkets />)
  await user.click(screen.getByRole('button', { name: 'Forex' }))
  expect(await within(screen.getByRole('button', { name: 'View EUR/USD chart' })).findByText('1.1221')).toBeTruthy()
})

it('loads sector ETF returns on demand, preserves missing and zero values, and opens the existing inline chart', async () => {
  const user = userEvent.setup()
  render(<NewsMarketContext watchlist={[]} showMarkets />)
  expect(mocks.rotation).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Sector ETFs' }))
  const tile = await screen.findByRole('button', { name: 'View Technology (XLK) chart' })
  expect(within(tile).getByText('+2.00%')).toBeTruthy()
  const description = document.getElementById(tile.getAttribute('aria-describedby') ?? '')
  expect(description?.textContent).toBe('1D +2.00%')
  expect(within(screen.getByRole('button', { name: 'View Health care (XLV) chart' })).getByText('0.00%')).toBeTruthy()
  expect(within(screen.getByRole('button', { name: 'View Financials (XLF) chart' })).getByText('—')).toBeTruthy()
  expect(within(screen.getByRole('button', { name: 'View Industrials (XLI) chart' })).getByText('—')).toBeTruthy()
  expect(within(screen.getByRole('button', { name: 'View Utilities (XLU) chart' })).getByText('—')).toBeTruthy()
  expect(screen.getByText('2026-10-23 · fixture')).toBeTruthy()
  expect(screen.getByText('Cached data')).toBeTruthy()
  expect(screen.getByText('Equal tiles · change over selected period')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '1W' }))
  expect(within(tile).getByText('+4.00%')).toBeTruthy()
  expect(description?.textContent).toBe('1W +4.00%')
  expect(mocks.rotation).toHaveBeenCalledTimes(1)
  await user.click(tile)
  const chart = screen.getByRole('region', { name: 'Market chart' })
  await within(chart).findByText('110.00')
  expect(mocks.bars).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'XLK', assetClass: 'equity', start: expect.any(String) }))
  await user.click(within(chart).getByRole('button', { name: 'Close price chart' }))
  expect(document.activeElement).toBe(tile)
})

it('contains a sector source failure within its selected group and supports retry', async () => {
  const user = userEvent.setup()
  mocks.rotation.mockRejectedValueOnce(new Error('offline'))
  render(<NewsMarketContext watchlist={[]} showMarkets />)
  await user.click(screen.getByRole('button', { name: 'Sector ETFs' }))
  expect(await screen.findByText('Market data is unavailable.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: 'View Technology (XLK) chart' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Overview' }))
  expect(await screen.findByRole('button', { name: 'View S&P 500 chart' })).toBeTruthy()
  expect(screen.queryByText('Market data is unavailable.')).toBeNull()
})
