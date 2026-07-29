// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { MarketBoardPage } from './MarketBoardPage'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
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
    data: {
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
    },
    updatedAt: null,
    loading: false,
    error: null,
  }),
}))

beforeEach(async () => {
  mocks.openOrFocus.mockReset()
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
})
