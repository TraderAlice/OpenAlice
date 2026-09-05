// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
function renderSidebar() {
  return render(<MemoryRouter initialEntries={['/market']}><MarketSidebar /></MemoryRouter>)
}

describe('MarketSidebar search keyboard controls', () => {
  it('selects grouped news categories while preserving the view URL param', () => {
    useWorkspace.getState().openOrFocus({ kind: 'news', params: {} })
    function Location() {
      const location = useLocation()
      return <output aria-label="Current route">{location.pathname + location.search}</output>
    }
    render(<MemoryRouter initialEntries={['/market/news?view=important']}><MarketSidebar /><Location /></MemoryRouter>)
    const categories = screen.getByRole('navigation', { name: 'News categories' })
    expect(within(categories).queryByRole('button', { name: 'US Stocks' })).toBeNull()
    expect(within(categories).queryByRole('button', { name: 'Markets' })).toBeNull()
    fireEvent.click(within(categories).getByRole('button', { name: 'Equity markets' }))
    fireEvent.click(within(categories).getByRole('button', { name: 'US Stocks' }))
    expect(screen.getByLabelText('Current route').textContent).toBe('/market/news?view=important&category=us')
    fireEvent.click(within(categories).getByRole('button', { name: 'All news' }))
    expect(screen.getByLabelText('Current route').textContent).toBe('/market/news?view=important')
  })

  it('opens the first exact provider when Enter is pressed', () => {
    renderSidebar()
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
    const view = renderSidebar()
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
    renderSidebar()
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
    renderSidebar()

    const remove = screen.getByRole('button', { name: 'Remove AAPL' })
    expect(remove.className).not.toContain('opacity-0')

    fireEvent.click(remove)

    expect(useWatchlist.getState().entries).toEqual([])
    expect(getFocusedTab(useWorkspace.getState())).toBeNull()
  })

  it('opens News through its child without making the group heading navigate', () => {
    function Location() {
      const location = useLocation()
      return <output aria-label="Current route">{location.pathname}</output>
    }
    render(<MemoryRouter initialEntries={['/market']}><MarketSidebar /><Location /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'News' }))
    expect(screen.getByLabelText('Current route').textContent).toBe('/market')
    fireEvent.click(screen.getByRole('button', { name: 'All news' }))
    expect(screen.getByLabelText('Current route').textContent).toBe('/market/news')
  })

  it('folds each market directory independently without changing the active view', () => {
    useWorkspace.getState().openOrFocus({ kind: 'news', params: {} })
    renderSidebar()
    const active = getFocusedTab(useWorkspace.getState())
    for (const label of ['News', 'Markets', 'Macro', 'Watchlist']) {
      const group = screen.getByRole('group', { name: label })
      const heading = within(group).getAllByRole('button')[0]
      expect(heading.getAttribute('aria-expanded')).toBe('true')
      fireEvent.click(heading)
      expect(heading.getAttribute('aria-expanded')).toBe('false')
      expect(within(group).getAllByRole('button')).toEqual([heading])
      expect(getFocusedTab(useWorkspace.getState())).toBe(active)
      fireEvent.keyDown(heading, { key: 'Enter' })
      expect(heading.getAttribute('aria-expanded')).toBe('true')
    }
  })
})
