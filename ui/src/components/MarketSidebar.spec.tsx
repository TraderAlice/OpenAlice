// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('selects news categories using the focused tab view despite a stale router location', () => {
    useWorkspace.getState().openOrFocus({ kind: 'news', params: { view: 'important' } })
    function Location() {
      const location = useLocation()
      return <output aria-label="Current route">{location.pathname + location.search}</output>
    }
    render(<MemoryRouter initialEntries={['/market']}><MarketSidebar /><Location /></MemoryRouter>)
    const categories = screen.getByRole('navigation', { name: 'News categories' })
    expect(within(categories).queryByRole('button', { name: 'US Stocks' })).toBeNull()
    expect(within(categories).queryByRole('button', { name: 'Markets' })).toBeNull()
    fireEvent.click(within(categories).getByRole('button', { name: 'Equity markets' }))
    fireEvent.click(within(categories).getByRole('button', { name: 'US Stocks' }))
    expect(screen.getByLabelText('Current route').textContent).toBe('/market/news?view=important&category=us')
    fireEvent.click(within(categories).getByRole('button', { name: 'All news' }))
    expect(screen.getByLabelText('Current route').textContent).toBe('/market/news?view=important')
  })

  it('reveals the selected category when an existing Market shell restores News', () => {
    useWorkspace.getState().openOrFocus({ kind: 'market-list', params: {} })
    renderSidebar()
    act(() => useWorkspace.getState().openOrFocus({ kind: 'news', params: { category: 'us', view: 'positive' } }))
    const navigation = screen.getByRole('navigation', { name: 'News categories' })
    expect(within(navigation).getByRole('button', { name: 'US Stocks' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(within(navigation).getByRole('button', { name: 'Equity markets' }))
    expect(within(navigation).queryByRole('button', { name: 'US Stocks' })).toBeNull()
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
    expect(screen.getByRole('heading', { name: 'News' })).toBeTruthy()
    expect(screen.getByLabelText('Current route').textContent).toBe('/market')
    fireEvent.click(screen.getByRole('button', { name: 'All news' }))
    expect(screen.getByLabelText('Current route').textContent).toBe('/market/news')
  })

  it('keeps directory headings static and preserves selection when a category group is collapsed', async () => {
    const user = userEvent.setup()
    useWorkspace.getState().openOrFocus({ kind: 'news', params: { category: 'us' } })
    renderSidebar()
    const active = getFocusedTab(useWorkspace.getState())
    for (const label of ['News', 'Markets', 'Macro', 'Watchlist']) {
      const group = screen.getByRole('group', { name: label })
      expect(within(group).getByRole('heading', { name: label })).toBeTruthy()
    }
    const toggle = screen.getByRole('button', { name: 'Equity markets' })
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('US Stocks')
    expect(toggle.getAttribute('aria-current')).toBeNull()
    const navigation = screen.getByRole('navigation', { name: 'News categories' })
    expect(within(navigation).queryByRole('button', { name: 'US Stocks' })).toBeNull()
    expect(getFocusedTab(useWorkspace.getState())).toBe(active)
    await user.keyboard(' ')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(within(navigation).getByRole('button', { name: 'US Stocks' }).getAttribute('aria-current')).toBe('page')
  })

  it('places search results before the news directory', () => {
    renderSidebar()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search assets…' }), { target: { value: 'apple' } })
    const headings = screen.getAllByRole('heading')
    expect(headings[0].textContent).toContain(i18n.t('market.searchResults'))
    expect(headings[1].textContent).toBe('News')
  })
})
