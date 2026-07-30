// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { MarketBoardPage } from './MarketBoardPage'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  boardData: null as unknown,
}))

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

beforeEach(async () => {
  mocks.openOrFocus.mockReset()
  mocks.boardData = {
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
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

describe('MarketBoardPage', () => {
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
