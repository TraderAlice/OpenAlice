// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsListResponse } from '../api'
import { i18n } from '../i18n'
import { NewsPage } from './NewsPage'

const mocks = vi.hoisted(() => ({ list: vi.fn(), watchlist: [] as Array<{ assetClass: string; symbol: string; addedAt: number }> }))
vi.mock('../api', () => ({ api: { news: { list: mocks.list } } }))
vi.mock('../tabs/watchlist-store', () => ({
  useWatchlist: (selector: (state: { entries: typeof mocks.watchlist }) => unknown) => selector({ entries: mocks.watchlist }),
}))
function render(node: ReactNode, entry = '/market/news') {
  return renderView(<MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter>)
}

function newsResponse(title: string, lookback = '24h'): NewsListResponse {
  return { items: [{ time: '2026-07-29T10:00:00.000Z', title, content: `${title} content`, source: 'Reuters', link: null, categories: 'markets,us' }], count: 1, lookback }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(async () => {
  mocks.list.mockReset()
  mocks.watchlist = []
  await i18n.changeLanguage('en')
  mocks.list.mockResolvedValue({
    items: [
      { time: '2026-07-29T08:00:00.000Z', title: 'Middle update', content: 'Middle content', source: 'Reuters', link: null, categories: 'markets,us' },
      { time: '2026-07-29T10:00:00.000Z', title: 'Newest update', content: 'Newest content', source: 'Bloomberg', link: 'https://example.com/newest', categories: 'markets,us' },
      { time: '2026-07-29T06:00:00.000Z', title: 'Oldest update', content: 'Oldest content', source: 'CNBC', link: null, categories: 'macro,rates' },
    ], count: 3, lookback: '24h',
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('NewsPage inline stream', () => {
  it('orders complete stories newest-first with their own source and original link', async () => {
    render(<NewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual(['Newest update', 'Middle update', 'Oldest update'])
    expect(within(rows[0]).getByText('Newest content')).toBeTruthy()
    fireEvent.click(within(rows[0]).getByRole('button', { name: i18n.t('news.showMore') }))
    expect(within(rows[0]).getByText('Newest content')).toBeTruthy()
    fireEvent.click(within(rows[0]).getByRole('button', { name: i18n.t('news.showLess') }))
    expect(within(rows[0]).getByText('Newest content')).toBeTruthy()
    expect(within(rows[0]).getByText('Bloomberg')).toBeTruthy()
    expect(within(rows[0]).getByRole('link', { name: 'Open original' }).getAttribute('href')).toBe('https://example.com/newest')
    expect(within(rows[1]).getByText('Middle content')).toBeTruthy()
    expect(within(rows[1]).queryByRole('link', { name: 'Open original' })).toBeNull()
  })
  it('groups the timeline by local calendar day across midnight', async () => {
    const beforeMidnight = new Date(2025, 0, 12, 23, 55)
    const afterMidnight = new Date(2025, 0, 13, 0, 5)
    mocks.list.mockResolvedValueOnce({ items: [
      { ...newsResponse('Before midnight').items[0], time: beforeMidnight.toISOString() },
      { ...newsResponse('After midnight').items[0], time: afterMidnight.toISOString() },
    ], count: 2, lookback: '24h' })
    render(<NewsPage />)
    await screen.findByRole('heading', { name: 'After midnight' })
    const day = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
    const latestDay = screen.getByRole('list', { name: day.format(afterMidnight) })
    const previousDay = screen.getByRole('list', { name: day.format(beforeMidnight) })
    expect(within(latestDay).getByRole('heading').textContent).toBe('After midnight')
    expect(within(previousDay).getByRole('heading').textContent).toBe('Before midnight')
  })

  it('reveals stories once per bottom intersection and resets when the view changes', async () => {
    let notify!: (isIntersecting: boolean) => void
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        notify = (isIntersecting) => callback([{ isIntersecting }])
      }
      observe() {}
      disconnect() {}
    })
    const items = Array.from({ length: 81 }, (_, index) => ({
      ...newsResponse(`Story ${index}`).items[0],
      categories: 'us,positive',
      time: new Date(2026, 6, 29, 10, index).toISOString(),
    }))
    mocks.list.mockResolvedValueOnce({ items, count: items.length, lookback: '24h' })
    render(<NewsPage />)
    await screen.findByRole('heading', { name: 'Story 80' })
    expect(screen.getAllByRole('listitem')).toHaveLength(40)
    act(() => notify(false))
    expect(screen.queryByRole('heading', { name: 'Story 40' })).toBeNull()
    act(() => { notify(true); notify(true) })
    expect(screen.getAllByRole('listitem')).toHaveLength(80)
    const previousView = notify
    const stream = screen.getByRole('region', { name: i18n.t('news.streamLabel') })
    stream.scrollTop = 5000
    fireEvent.click(within(screen.getByRole('navigation', { name: 'News views' })).getByRole('button', { name: 'Positive' }))
    act(() => previousView(true))
    expect(screen.getAllByRole('listitem')).toHaveLength(40)
    expect(stream.scrollTop).toBe(0)
    act(() => notify(true))
    expect(screen.getAllByRole('listitem')).toHaveLength(80)
    act(() => notify(true))
    expect(screen.getAllByRole('listitem')).toHaveLength(81)
    expect(screen.getByRole('heading', { name: 'Story 0' })).toBeTruthy()
  })

  it('applies the category from market navigation without rendering another navigator', async () => {
    render(<NewsPage />, '/market/news?category=macro')
    await screen.findByRole('heading', { name: 'Oldest update' })
    expect(screen.queryByRole('heading', { name: 'Newest update' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'News categories' })).toBeNull()
  })

  it('filters explicit importance, sentiment, and watchlist symbols without substring matches', async () => {
    mocks.watchlist = [{ assetClass: 'equity', symbol: 'AAPL', addedAt: 1 }]
    mocks.list.mockResolvedValue({ items: [
      { ...newsResponse('AAPL supplier setback').items[0], categories: 'markets,us,important,negative' },
      { ...newsResponse('NVDA advances after results').items[0], categories: 'markets,us,positive' },
      { ...newsResponse('XAAPL unrelated ticker').items[0], categories: 'markets,us' },
    ], count: 3, lookback: '24h' })
    render(<NewsPage />)
    await screen.findByRole('heading', { name: /AAPL supplier setback/ })
    const views = screen.getByRole('navigation', { name: 'News views' })
    fireEvent.click(within(views).getByRole('button', { name: 'Important' }))
    expect(screen.queryByRole('heading', { name: 'NVDA advances after results' })).toBeNull()
    fireEvent.click(within(views).getByRole('button', { name: 'Positive' }))
    expect(screen.getByRole('heading', { name: 'NVDA advances after results' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /AAPL supplier setback/ })).toBeNull()
    fireEvent.click(within(views).getByRole('button', { name: 'Negative' }))
    expect(screen.getByRole('heading', { name: /AAPL supplier setback/ })).toBeTruthy()
    fireEvent.click(within(views).getByRole('button', { name: 'Watchlist' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /AAPL supplier setback/ })).toBeTruthy()
  })

  it('submits text filters deliberately and clears them without losing the stream', async () => {
    render(<NewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    const keyword = screen.getByRole('textbox', { name: 'Keyword' })
    fireEvent.change(keyword, { target: { value: 'earnings' } })
    expect(mocks.list).toHaveBeenCalledTimes(1)
    mocks.list.mockResolvedValueOnce(newsResponse('Search result'))
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('heading', { name: 'Search result' })).toBeTruthy()
    expect(mocks.list.mock.lastCall?.[0]).toMatchObject({ keyword: 'earnings' })
    mocks.list.mockResolvedValueOnce(newsResponse('Unfiltered update'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(await screen.findByRole('heading', { name: 'Unfiltered update' })).toBeTruthy()
    expect((keyword as HTMLInputElement).value).toBe('')
    expect(mocks.list.mock.lastCall?.[0].keyword).toBeUndefined()
  })

  it('rejects reversed dates without requesting or clearing the current feed', async () => {
    render(<NewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-07-30' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-07-29' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Newest update' })).toBeTruthy()
  })

  it('keeps a broken thumbnail from obscuring a story and rejects executable links', async () => {
    mocks.list.mockResolvedValue({ ...newsResponse('Unsafe link story'), items: [{ ...newsResponse('Unsafe link story').items[0], link: 'javascript:alert(1)', image: 'https://example.com/story.jpg' }] })
    render(<NewsPage />)
    await screen.findByRole('heading', { name: 'Unsafe link story' })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Unsafe link story content')).toBeTruthy()
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Unsafe link story content')).toBeTruthy()
  })
})

describe('NewsPage request recovery', () => {
  it('reports initial failure and retries without calling it an empty feed', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(newsResponse('Recovered update'))
    render(<NewsPage />)
    await screen.findByRole('alert')
    expect(screen.queryByText('No articles')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Recovered update' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears mismatched articles when a new source filter fails', async () => {
    render(<NewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    mocks.list.mockRejectedValueOnce(new Error('filter unavailable'))
    fireEvent.change(screen.getByRole('combobox', { name: 'News source' }), { target: { value: 'Reuters' } })
    await screen.findByRole('alert')
    expect(screen.queryByRole('heading', { name: 'Newest update' })).toBeNull()
    expect(screen.queryByText('No articles')).toBeNull()
  })

  it('retains the successful stream on refresh failure and recovers', async () => {
    let refresh: (() => void) | undefined
    vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, delay) => {
      if (delay === 60_000) refresh = handler as () => void
      return {} as ReturnType<typeof setInterval>
    })
    render(<NewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    expect(refresh).toBeTypeOf('function')
    mocks.list.mockRejectedValueOnce(new Error('refresh unavailable'))
    await act(async () => { refresh?.(); await Promise.resolve(); await Promise.resolve() })
    const notice = await screen.findByRole('status')
    expect(screen.getByRole('heading', { name: 'Newest update' })).toBeTruthy()
    mocks.list.mockResolvedValueOnce(newsResponse('Refreshed update'))
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Refreshed update' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('lets the latest query win when an older request finishes last', async () => {
    render(<NewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    const slow = deferred<NewsListResponse>()
    const fast = deferred<NewsListResponse>()
    mocks.list.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => fast.promise)
    const lookback = screen.getByRole('combobox', { name: 'News time range' })
    fireEvent.change(lookback, { target: { value: '1h' } })
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    fireEvent.change(lookback, { target: { value: '7d' } })
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3))
    await act(async () => { fast.resolve(newsResponse('Latest response', '7d')); await fast.promise })
    expect(await screen.findByRole('heading', { name: 'Latest response' })).toBeTruthy()
    await act(async () => { slow.resolve(newsResponse('Stale response', '1h')); await slow.promise })
    expect(screen.getByRole('heading', { name: 'Latest response' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Stale response' })).toBeNull()
  })
})
