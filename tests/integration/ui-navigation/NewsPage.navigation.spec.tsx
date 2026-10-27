// @vitest-environment jsdom

import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UrlAdopter } from '../../../ui/src/tabs/UrlAdopter'
import { useWorkspace } from '../../../ui/src/tabs/store'
import type { ViewSpec } from '../../../ui/src/tabs/types'
import { NewsPage } from '../../../ui/src/pages/NewsPage'
import { i18n } from '../../../ui/src/i18n'

vi.mock('../../../ui/src/components/news/NewsMarketContext', () => ({ NewsMarketContext: () => null }))
vi.mock('../../../ui/src/components/news/NewsEconomicCalendar', () => ({ NewsEconomicCalendar: () => null }))
vi.mock('../../../ui/src/components/news/NewsImportantEvents', () => ({ NewsImportantEvents: () => null }))

vi.mock('../../../ui/src/api', () => ({ api: { news: { list: vi.fn(async () => ({
  items: [
    { time: '2026-09-06T00:00:00Z', title: 'US positive', content: 'x', source: 'test', link: null, categories: 'us,positive' },
    { time: '2026-09-06T00:00:00Z', title: 'US negative', content: 'x', source: 'test', link: null, categories: 'us,negative' },
    { time: '2026-09-06T00:00:00Z', title: 'Macro negative', content: 'x', source: 'test', link: null, categories: 'macro,negative' },
  ], count: 3, lookback: '24h',
})) }, config: { getNewsPresets: vi.fn(async () => ({ feeds: [] })) } } }))
vi.mock('../../../ui/src/hooks/useAliceProject', () => ({
  useAliceProject: () => ({ project: { product: 'trader' }, loading: false }),
}))
// Keep the real Router, adopter, and tab store; avoid loading unrelated page modules.
vi.mock('../../../ui/src/tabs/registry', () => ({ getView: () => ({
  toUrl: (spec: ViewSpec) => spec.kind === 'news'
    ? '/market/news?' + new URLSearchParams(spec.params)
    : '/chat',
}) }))

function Host() {
  const navigate = useNavigate()
  const [mount, setMount] = useState(0)
  const spec = useWorkspace((state) => state.tree.kind === 'leaf'
    ? state.tabs[state.tree.group.activeTabId ?? '']?.spec : undefined)
  return <>
    <button onClick={() => navigate('/chat')}>Leave news</button>
    <button onClick={() => setMount(value => value + 1)}>Remount news</button>
    {spec?.kind === 'news' && <NewsPage key={mount} spec={spec} />}
  </>
}

beforeEach(async () => {
  window.localStorage.clear()
  useWorkspace.setState({
    tabs: {},
    tree: { kind: 'leaf', group: { id: 'g1', tabIds: [], activeTabId: null } },
    focusedGroupId: 'g1', selectedSidebar: null,
  })
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

it.each(['category', 'relationships'])('keeps source when changing %s', async change => {
  window.history.replaceState({}, '', '/market/news?view=events&source=test')
  render(<BrowserRouter><UrlAdopter /><Host /></BrowserRouter>)
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'News source' }) as HTMLSelectElement).value).toBe('test'))
  if (change === 'category') {
    fireEvent.click(within(screen.getByRole('navigation', { name: 'News topics' })).getByRole('link', { name: 'AI' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('category')).toBe('ai'))
  } else {
    fireEvent.click(screen.getByText('Event relationships', { selector: 'summary' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Country / region' }), { target: { value: 'CA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('country')).toBe('CA'))
  }
  expect(new URLSearchParams(window.location.search).get('source')).toBe('test')
})

it('preserves the source through remounts, view changes and history, and explicitly clears it', async () => {
  window.history.replaceState({}, '', '/market/news?view=events')
  render(<BrowserRouter><UrlAdopter /><Host /></BrowserRouter>)
  const filter = await screen.findByRole('combobox', { name: 'News source' })
  await waitFor(() => expect(within(filter).getByRole('option', { name: 'test' })).toBeTruthy())
  fireEvent.change(filter, { target: { value: 'test' } })
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('source')).toBe('test'))
  fireEvent.click(screen.getByRole('button', { name: 'Remount news' }))
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'News source' }) as HTMLSelectElement).value).toBe('test'))
  fireEvent.click(screen.getByRole('button', { name: 'Hot' }))
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('hot'))
  expect(new URLSearchParams(window.location.search).get('source')).toBe('test')
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  await waitFor(() => expect(new URLSearchParams(window.location.search).has('source')).toBe(false))
  window.history.back()
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'News source' }) as HTMLSelectElement).value).toBe('test'))
})

it('restores reading status through the real News adopter, tab store and browser history', async () => {
  window.history.replaceState({}, '', '/market/news?view=events&readStatus=updated')
  render(<BrowserRouter><UrlAdopter /><Host /></BrowserRouter>)
  const filter = await screen.findByRole('combobox', { name: 'Reading status' })
  expect((filter as HTMLSelectElement).value).toBe('updated')
  fireEvent.change(filter, { target: { value: 'unread' } })
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('readStatus')).toBe('unread'))
  fireEvent.click(screen.getByRole('button', { name: 'Hot' }))
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('hot'))
  expect(new URLSearchParams(window.location.search).get('readStatus')).toBe('unread')
  window.history.back()
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('events'))
  expect((screen.getByRole('combobox', { name: 'Reading status' }) as HTMLSelectElement).value).toBe('unread')
  window.history.back()
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Reading status' }) as HTMLSelectElement).value).toBe('updated'))
  expect(Object.values(useWorkspace.getState().tabs).filter(tab => tab.spec.kind === 'news')).toHaveLength(1)
})

it('restores a saved News selection and changes views on the news route after returning', async () => {
  window.history.replaceState({}, '', '/market/news?category=us&view=positive')
  render(<BrowserRouter><UrlAdopter /><Host /></BrowserRouter>)
  await screen.findByRole('heading', { name: 'US positive' })
  const saved = Object.values(useWorkspace.getState().tabs).find((tab) => tab.spec.kind === 'news')!

  fireEvent.click(screen.getByRole('button', { name: 'Leave news' }))
  expect(screen.queryByRole('heading', { name: 'US positive' })).toBeNull()
  act(() => useWorkspace.getState().openOrFocus(saved.spec))
  await screen.findByRole('heading', { name: 'US positive' })
  await waitFor(() => expect(window.location.search).toBe('?category=us&view=positive'))
  expect(screen.queryByRole('heading', { name: 'US negative' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Macro negative' })).toBeNull()

  fireEvent.click(within(screen.getByRole('navigation', { name: 'News views' })).getByRole('button', { name: 'Latest' }))
  expect(window.location.pathname).toBe('/market/news')
  expect(window.location.search).toBe('?category=us')
  expect(await screen.findByRole('heading', { name: 'US negative' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Macro negative' })).toBeNull()
  expect(Object.values(useWorkspace.getState().tabs).filter((tab) => tab.spec.kind === 'news')).toHaveLength(1)
})

it('updates a country-name search in the existing News tab and clears its URL keyword', async () => {
  window.history.replaceState({}, '', '/market/news?keyword=Canada')
  render(<BrowserRouter><UrlAdopter /><Host /></BrowserRouter>)
  await screen.findByDisplayValue('Canada')
  const newsId = Object.values(useWorkspace.getState().tabs).find(tab => tab.spec.kind === 'news')!.id

  act(() => useWorkspace.getState().openOrFocus({ kind: 'news', params: { view: 'events', keyword: 'United States' } }))
  await screen.findByDisplayValue('United States')
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('keyword')).toBe('United States'))
  fireEvent.click(screen.getByRole('button', { name: 'Hot' }))
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('hot'))
  expect(new URLSearchParams(window.location.search).get('keyword')).toBe('United States')
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  await waitFor(() => expect(new URLSearchParams(window.location.search).has('keyword')).toBe(false))
  expect((screen.getByRole('textbox', { name: 'Keyword' }) as HTMLInputElement).value).toBe('')
  const newsTabs = Object.values(useWorkspace.getState().tabs).filter(tab => tab.spec.kind === 'news')
  expect(newsTabs).toHaveLength(1)
  expect(newsTabs[0].id).toBe(newsId)
})
