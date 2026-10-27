// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { formatTermAxisLabel, formatTermAxisPrice, MarketBoardPage } from './MarketBoardPage'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  boardData: null as unknown,
}))

const moversBoard = {
  meta: {},
  gainers: [{
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    price: 1042.1,
    percent_change: 0.062,
    volume: 51_000_000,
    relative_volume: 1.8,
    dollar_volume: 53_150_000_000,
  }],
  losers: [],
  active: [],
  undervaluedGrowth: [],
  growthTech: [],
  smallCaps: [],
  undervaluedLarge: [],
}

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

vi.mock('../components/market/BoardMeta', () => ({
  BoardMeta: () => null,
}))

vi.mock('../components/market/useReferenceBoard', () => ({
  useReferenceBoard: () => ({
    data: mocks.boardData,
    updatedAt: null,
    loading: false,
    slow: false,
    error: null,
    retry: vi.fn(),
  }),
}))

vi.mock('../components/MeasuredChartFrame', () => ({
  MeasuredChartFrame: ({ className }: { className?: string }) => <div data-testid="chart-frame" className={className} />,
}))

beforeEach(async () => {
  mocks.openOrFocus.mockReset()
  mocks.boardData = moversBoard
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

describe('MarketBoardPage', () => {
  it('keeps the timeline, country values, source dates and table on the same historical observation', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('en')
    const history = [{ date: '2025-01-01', value: 0 }, { date: '2025-02-01', value: 4 }]
    const present = { value: 4, date: '2025-02-01', history }
    mocks.boardData = { meta: {}, rows: [{ country: 'US', label: 'United States', cpiYoy: present, shortRate: present, cli: present, housePrice: { value: 90, date: '2025-02-01', history: [{ date: '2025-02-01', value: 90 }] }, sharePrice: present }] }
    render(<MarketBoardPage spec={{ kind: 'market-board', params: { board: 'global-macro' } }} visible />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Country' }), 'US')
    fireEvent.change(screen.getByRole('slider', { name: 'Historical timeline' }), { target: { value: '0' } })
    const details = screen.getByRole('region', { name: 'United States' })
    expect(within(details).getByLabelText('CPI YoY: 0.00%, 2025-01-01')).toBeTruthy()
    expect(within(details).queryByText('90.0')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Table' }))
    expect(within(screen.getByTestId('global-macro-desktop')).getAllByText('2025-01-01')).toHaveLength(4)
    expect(within(screen.getByTestId('global-macro-desktop')).queryByText('2025-02-01')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Map' }))
    expect(screen.getByRole('slider', { name: 'Historical timeline' }).getAttribute('aria-valuetext')).toBe('2025-01-01')
  })

  it('opens an equity detail from the keyboard-accessible symbol control', async () => {
    const user = userEvent.setup()
    render(
      <MarketBoardPage
        spec={{ kind: 'market-board', params: { board: 'movers' } }}
        visible
      />,
    )

    const detailButton = screen.getByRole('button', { name: '打开 NVDA 详情' })
    detailButton.focus()
    await user.keyboard('{Enter}')

    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'market-detail',
      params: { assetClass: 'equity', symbol: 'NVDA' },
    })
  })

  it('keeps every Movers list reachable and prioritizes primary metrics on narrow screens', async () => {
    const user = userEvent.setup()
    render(
      <MarketBoardPage
        spec={{ kind: 'market-board', params: { board: 'movers' } }}
        visible
      />,
    )

    const listGroup = screen.getByRole('group', { name: '异动' })
    const listButtons = within(listGroup).getAllByRole('button')
    expect(listButtons).toHaveLength(7)
    expect(listGroup.className).toContain('flex-wrap')
    expect(listButtons.every((button) => button.className.includes('whitespace-nowrap'))).toBe(true)
    expect(screen.getByRole('button', { name: '涨幅榜' }).getAttribute('aria-pressed')).toBe('true')

    expect(screen.getByRole('table').className).toContain('table-fixed')
    expect(screen.getByRole('columnheader', { name: '成交量' }).className).toContain('hidden')
    expect(screen.getByRole('columnheader', { name: 'RVOL' }).className).toContain('hidden')
    expect(screen.getByRole('columnheader', { name: '成交额' }).className).toContain('hidden')

    await user.click(screen.getByRole('button', { name: '成长科技' }))
    expect(screen.getByRole('button', { name: '成长科技' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('gives Global Macro a scan-first mobile hierarchy without removing the desktop comparison table', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('en')
    mocks.boardData = {
      meta: {},
      rows: [{
        country: 'US',
        label: 'United States',
        cpiYoy: { value: 4.25, date: '2026-06-01' },
        shortRate: { value: 3.625, date: '2026-07-29' },
        cli: { value: 100.8, date: '2026-06-01' },
        housePrice: { value: 156.4, date: '2026-05-01' },
        sharePrice: { value: null, date: null, error: 'market closed' },
      }],
    }

    render(
      <MarketBoardPage
        spec={{ kind: 'market-board', params: { board: 'global-macro' } }}
        visible
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Table' }))
    const mobile = screen.getByTestId('global-macro-mobile')
    const desktop = screen.getByTestId('global-macro-desktop')
    expect(mobile.className).toContain('md:hidden')
    expect(mobile.className).not.toContain('overflow-x-auto')
    expect(desktop.className).toContain('hidden')
    expect(desktop.className).toContain('md:block')
    expect(desktop.className).toContain('overflow-x-auto')

    expect(within(mobile).getByRole('heading', { name: 'United States' })).toBeTruthy()
    const metricGroups = mobile.querySelectorAll('dl')
    expect(metricGroups).toHaveLength(2)
    expect(metricGroups[0]?.className).toContain('grid-cols-3')
    expect(metricGroups[1]?.className).toContain('grid-cols-2')

    expect(within(mobile).getByLabelText('CPI YoY: 4.25%, 2026-06-01').className).toContain('text-destructive')
    expect(within(mobile).getByLabelText('Short rate (3M): 3.63%, 2026-07-29')).toBeTruthy()
    expect(within(mobile).getByLabelText('CLI: 100.8, 2026-06-01').className).toContain('text-success')
    expect(within(mobile).getByLabelText('House (2015=100): 156.4, 2026-05-01')).toBeTruthy()
    expect(within(mobile).getByLabelText('Equity (2015=100): —, market closed').className).toContain('text-muted-foreground/50')

    const comparisonTable = within(desktop).getByRole('table')
    expect(within(comparisonTable).getAllByRole('columnheader')).toHaveLength(6)
    expect(within(comparisonTable).getAllByText('2026-06-01')).toHaveLength(2)
    expect(within(mobile).getAllByText('2026-06-01')).toHaveLength(2)
  })

  it('opens inline macro country details and structured country News filtering', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('en')
    mocks.boardData = { meta: {}, rows: [{ country: 'US', label: 'United States', cpiYoy: { value: 2.95, date: '2024-01-01' }, shortRate: { value: 3.7, date: '2026-09-01' }, cli: { value: 101, date: '2026-09-01' }, housePrice: { value: null, date: null }, sharePrice: { value: null, date: null } }] }
    render(<MarketBoardPage spec={{ kind: 'market-board', params: { board: 'global-macro' } }} visible />)
    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe('true')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Indicator' }), 'shortRate')
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    const viewBox = screen.getByRole('group', { name: 'World macro map' }).getAttribute('viewBox')
    await user.click(screen.getByRole('button', { name: 'Table' }))
    await user.click(screen.getByRole('button', { name: 'Map' }))
    expect((screen.getByRole('combobox', { name: 'Indicator' }) as HTMLSelectElement).value).toBe('shortRate')
    expect((screen.getByRole('combobox', { name: 'Observation period' }) as HTMLSelectElement).value).toBe('2026-09-01')
    expect(screen.getByRole('group', { name: 'World macro map' }).getAttribute('viewBox')).toBe(viewBox)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Country' }), 'US')
    const details = screen.getByRole('region', { name: 'United States' })
    expect(within(details).getByText('2024-01-01')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(within(details).getByRole('button', { name: 'Search news' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'news', params: { view: 'events', country: 'US' } })
  })

  it('keeps Shipping card metadata intact when the card narrows', () => {
    mocks.boardData = {
      meta: {},
      curves: [{
        key: 'suez',
        name: 'Suez Canal',
        points: [],
        latest: {
          date: '2026-07-29',
          vessels: 21,
          tons: 1_400_000,
        },
      }],
    }

    render(
      <MarketBoardPage
        spec={{ kind: 'market-board', params: { board: 'shipping' } }}
        visible
      />,
    )

    const header = screen.getByText('Suez Canal').parentElement
    expect(header?.className).toContain('flex-col')
    expect(header?.className).toContain('sm:flex-row')

    const metadata = screen.getByText('2026-07-29').parentElement
    expect(metadata?.className).toContain('flex-wrap')
    expect(screen.getByText('2026-07-29').className).toContain('whitespace-nowrap')
    expect(screen.getByText('21 艘').className).toContain('whitespace-nowrap')
    expect(screen.getByText('1.40M t').className).toContain('whitespace-nowrap')
  })

  it('keeps contract dates, prices and basis readable in the inline details', async () => {
    const user = userEvent.setup()
    mocks.boardData = {
      meta: {},
      curves: [{
        symbol: 'BTC',
        spot: 118_240.5,
        points: [
          {
            expiration: '2026-08-30',
            price: 119_000,
            daysToExpiry: 31,
            annualizedBasis: 7.2,
          },
          {
            expiration: '2026-09-30',
            price: 120_000,
            daysToExpiry: 62,
            annualizedBasis: 8.1,
          },
        ],
      }],
    }

    render(
      <MarketBoardPage
        spec={{ kind: 'market-board', params: { board: 'term-structure' } }}
        visible
      />,
    )

    await user.click(screen.getByText('合约明细'))
    const table = screen.getByRole('table', { name: 'BTC 合约明细' })
    expect(within(table).getByText('2026-08-30')).toBeTruthy()
    expect(within(table).getByText('119,000')).toBeTruthy()
    expect(within(table).getByText('+7.2%')).toBeTruthy()
    expect(within(table).getByText('+8.1%')).toBeTruthy()
  })

  it('compresses term-axis labels without losing desktop precision', () => {
    expect(formatTermAxisLabel('26-08-30', 320)).toBe('08-30')
    expect(formatTermAxisLabel('26-08-30', 640)).toBe('26-08-30')
    expect(formatTermAxisPrice(118_240.5, 320)).toBe('118.2K')
    expect(formatTermAxisPrice(118_240.5, 640)).toBe('118,240.5')
  })

  it('keeps a large Calendar scan-first, searchable, and bounded on mobile', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('en')
    mocks.boardData = {
      meta: {},
      window: { start: '2026-08-04', end: '2026-08-13' },
      earnings: Array.from({ length: 120 }, (_, index) => ({
        report_date: index < 60 ? '2026-08-04' : '2026-08-05',
        symbol: `E${String(index).padStart(3, '0')}`,
        name: `Earnings company ${index}`,
        eps_previous: index / 10,
        eps_consensus: index / 8,
      })),
      ipos: [
        { ipo_date: '2026-08-06', symbol: 'NEW1', name: 'New One', exchange: 'NASDAQ' },
        { ipo_date: '2026-08-07', symbol: 'NEW2', name: 'New Two', exchange: 'NYSE' },
      ],
      dividends: [],
    }

    render(
      <MarketBoardPage
        spec={{ kind: 'market-board', params: { board: 'calendar' } }}
        visible
      />,
    )

    expect(screen.getByRole('button', { name: 'Earnings (120)' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Showing 50 of 120 events')).toBeTruthy()
    expect(within(screen.getByTestId('calendar-mobile')).getAllByRole('button')).toHaveLength(50)
    expect(within(screen.getByTestId('calendar-desktop')).getAllByRole('row')).toHaveLength(51)

    await user.click(screen.getByRole('button', { name: 'Show 50 more events' }))
    expect(within(screen.getByTestId('calendar-mobile')).getAllByRole('button')).toHaveLength(100)

    const search = screen.getByRole('searchbox', { name: 'Search calendar events' })
    await user.type(search, 'E119')
    expect(screen.getByText('Showing 1 of 1 events')).toBeTruthy()
    const result = within(screen.getByTestId('calendar-mobile')).getByRole('button', { name: 'Open E119 details' })
    await user.click(result)
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'market-detail',
      params: { assetClass: 'equity', symbol: 'E119' },
    })

    await user.clear(search)
    await user.click(screen.getByRole('button', { name: 'IPOs (2)' }))
    await waitFor(() => expect(screen.getByText('Showing 2 of 2 events')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'IPOs (2)' }).getAttribute('aria-pressed')).toBe('true')
  })
})
