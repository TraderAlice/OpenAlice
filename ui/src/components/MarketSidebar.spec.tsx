// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BarSourceCandidate } from '../api/market'
import { i18n } from '../i18n'
import { useWorkspace } from '../tabs/store'
import { useWatchlist } from '../tabs/watchlist-store'
import { getFocusedTab } from '../tabs/types'
import { MarketSidebar } from './MarketSidebar'

const searchResults: BarSourceCandidate[] = [
  {
    barId: 'yfinance|AAPL',
    source: 'vendor',
    sourceId: 'yfinance',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'equity',
    label: 'AAPL',
    barCapability: 'delayed',
  },
  {
    barId: 'alpaca-paper|AAPL',
    source: 'uta',
    sourceId: 'alpaca-paper',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'equity',
    label: 'AAPL',
    barCapability: 'iex',
  },
]

vi.mock('./market/useAssetSearch', () => ({
  useAssetSearch: (query: string) => ({
    results: query.trim() ? searchResults : [],
    loading: false,
  }),
}))

beforeEach(async () => {
  window.localStorage.clear()
  await i18n.changeLanguage('en')
  useWorkspace.setState({
    tabs: {},
    tree: { kind: 'leaf', group: { id: 'g1', tabIds: [], activeTabId: null } },
    focusedGroupId: 'g1',
    selectedSidebar: null,
  })
  useWatchlist.setState({ entries: [] })
})

afterEach(cleanup)

describe('MarketSidebar search keyboard controls', () => {
  it('groups peer destinations by purpose without nesting boards under News', () => {
    render(<MarketSidebar />)
    const markets = screen.getByRole('group', { name: 'Markets' })
    const macro = screen.getByRole('group', { name: 'Macro' })
    const news = screen.getByRole('button', { name: 'News' })
    expect(news.closest('[role="group"]')).toBeNull()
    expect(screen.getAllByRole('button')[0]).toBe(news)
    expect(within(markets).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Browse Markets', 'Movers', 'Sector Rotation', 'Term Structure',
    ])
    expect(within(macro).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Calendar', 'Macro', 'Global Macro', 'Fed', 'Shipping',
    ])
    for (const group of [markets, macro]) {
      expect(group.className).not.toContain('border-l')
      for (const button of within(group).getAllByRole('button')) fireEvent.click(button)
    }
    expect(getFocusedTab(useWorkspace.getState())?.spec).toEqual({
      kind: 'market-board', params: { board: 'shipping' },
    })
  })

  it('opens the first exact provider when Enter is pressed', () => {
    render(<MarketSidebar />)
    const search = screen.getByRole('textbox', { name: 'Search assets…' })

    fireEvent.change(search, { target: { value: 'apple' } })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(getFocusedTab(useWorkspace.getState())?.spec).toEqual({
      kind: 'market-detail',
      params: {
        assetClass: 'equity',
        symbol: 'AAPL',
        source: 'yfinance|AAPL',
      },
    })
  })

  it('moves the provider highlight with arrow keys before selecting', () => {
    const view = render(<MarketSidebar />)
    const search = screen.getByRole('textbox', { name: 'Search assets…' })

    fireEvent.change(search, { target: { value: 'apple' } })
    fireEvent.keyDown(search, { key: 'ArrowDown' })

    const highlighted = view.container.querySelector('[data-keyboard-highlighted="true"]')
    expect(highlighted?.textContent).toContain('alpaca-paper')

    fireEvent.keyDown(search, { key: 'Enter' })
    expect(getFocusedTab(useWorkspace.getState())?.spec).toEqual({
      kind: 'market-detail',
      params: {
        assetClass: 'equity',
        symbol: 'AAPL',
        source: 'alpaca-paper|AAPL',
      },
    })
  })

  it('clears an inline search with Escape', () => {
    render(<MarketSidebar />)
    const search = screen.getByRole('textbox', { name: 'Search assets…' })

    fireEvent.change(search, { target: { value: 'apple' } })
    fireEvent.keyDown(search, { key: 'Escape' })

    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('heading', { name: /Search Results/ })).toBeNull()
  })

  it('keeps the watchlist remove action visible and separate from row navigation', () => {
    useWatchlist.setState({
      entries: [{ assetClass: 'equity', symbol: 'AAPL', addedAt: 1 }],
    })
    render(<MarketSidebar />)

    const remove = screen.getByRole('button', { name: 'Remove AAPL' })
    expect(remove.className).not.toContain('opacity-0')

    fireEvent.click(remove)

    expect(useWatchlist.getState().entries).toEqual([])
    expect(getFocusedTab(useWorkspace.getState())).toBeNull()
  })

  it('opens News as a Market browse leaf', () => {
    render(<MarketSidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'News' }))

    expect(getFocusedTab(useWorkspace.getState())?.spec).toEqual({
      kind: 'news',
      params: {},
    })
  })
})
