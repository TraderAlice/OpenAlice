// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
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
    error: null,
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

  it('uses a stable mobile grid for term basis values', () => {
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

    const firstBasis = screen.getByText('26-08-30')
    expect(firstBasis.className).toContain('justify-between')
    expect(firstBasis.parentElement?.className).toContain('grid-cols-2')
    expect(firstBasis.parentElement?.className).toContain('sm:flex')
  })

  it('compresses term-axis labels without losing desktop precision', () => {
    expect(formatTermAxisLabel('26-08-30', 320)).toBe('08-30')
    expect(formatTermAxisLabel('26-08-30', 640)).toBe('26-08-30')
    expect(formatTermAxisPrice(118_240.5, 320)).toBe('118.2K')
    expect(formatTermAxisPrice(118_240.5, 640)).toBe('118,240.5')
  })
})
