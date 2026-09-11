// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UrlAdopter } from '../tabs/UrlAdopter'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'
import { NewsPage } from './NewsPage'
import { i18n } from '../i18n'

vi.mock('../api', () => ({ api: { news: { list: vi.fn(async () => ({
  items: [
    { time: '2026-09-06T00:00:00Z', title: 'US positive', content: 'x', source: 'test', link: null, categories: 'us,positive' },
    { time: '2026-09-06T00:00:00Z', title: 'US negative', content: 'x', source: 'test', link: null, categories: 'us,negative' },
    { time: '2026-09-06T00:00:00Z', title: 'Macro negative', content: 'x', source: 'test', link: null, categories: 'macro,negative' },
  ], count: 3, lookback: '24h',
})) } } }))
vi.mock('../hooks/useAliceProject', () => ({
  useAliceProject: () => ({ project: { product: 'trader' }, loading: false }),
}))
// Keep the real Router, adopter, and tab store; avoid loading unrelated page modules.
vi.mock('../tabs/registry', () => ({ getView: () => ({
  toUrl: (spec: ViewSpec) => spec.kind === 'news'
    ? '/market/news?' + new URLSearchParams(spec.params)
    : '/chat',
}) }))

function Host() {
  const navigate = useNavigate()
  const spec = useWorkspace((state) => state.tree.kind === 'leaf'
    ? state.tabs[state.tree.group.activeTabId ?? '']?.spec : undefined)
  return <>
    <button onClick={() => navigate('/chat')}>Leave news</button>
    {spec?.kind === 'news' && <NewsPage spec={spec} />}
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
