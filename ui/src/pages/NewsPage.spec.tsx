// @vitest-environment jsdom

import { useEffect, useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsListResponse } from '../api'
import { i18n } from '../i18n'
import { NewsPage } from './NewsPage'

const mocks = vi.hoisted(() => ({ list: vi.fn(), getStory: vi.fn(), importantQuery: vi.fn(), watchlist: [] as Array<{ assetClass: string; symbol: string; addedAt: number }> }))
vi.mock('../api', () => ({ api: { news: { list: mocks.list, getStory: mocks.getStory, setReader: vi.fn().mockResolvedValue({}), getRelatedStories: vi.fn().mockResolvedValue([]), followedTopics: vi.fn().mockResolvedValue({ topics: [] }) }, config: { getNewsPresets: vi.fn().mockResolvedValue({ feeds: [] }) } } }))
vi.mock('../components/news/NewsMarketContext', () => ({ NewsMarketContext: () => <section aria-label="Market context" /> }))
vi.mock('../components/news/NewsEconomicCalendar', () => ({ NewsEconomicCalendar: () => <section aria-label="Economic calendar" /> }))
vi.mock('../components/news/NewsImportantEvents', () => ({ NewsImportantEvents: ({ onOpen, query }: { onOpen: (id: string) => void; query: unknown }) => { mocks.importantQuery(query); return <section aria-label="Important events"><button onClick={() => onOpen('model-access')}>Open important event</button></section> } }))
vi.mock('../tabs/watchlist-store', () => ({
  useWatchlist: (selector: (state: { entries: typeof mocks.watchlist }) => unknown) => selector({ entries: mocks.watchlist }),
}))
function RoutedNewsPage({ delayed = false }: { delayed?: boolean }) {
  const [search] = useSearchParams()
  const [adopted, setAdopted] = useState(search)
  useEffect(() => { setAdopted(search) }, [search])
  const params = delayed ? adopted : search
  return <NewsPage spec={{ kind: 'news', params: {
    category: params.get('category') ?? undefined,
    view: params.get('view') ?? undefined,
    keyword: params.get('keyword') ?? undefined,
    readStatus: params.get('readStatus') ?? undefined,
    eventId: params.get('eventId') ?? undefined,
    country: params.get('country') ?? undefined,
    industry: params.get('industry') ?? undefined,
    asset: params.get('asset') ?? undefined,
  } }} />
}
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
  mocks.getStory.mockReset()
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

function newsRows() { return screen.getAllByRole('listitem').filter(row => !row.parentElement?.closest('[role="listitem"]')) }
describe('NewsPage inline stream', () => {
  it('keeps structured relationship filters through search and view changes and clears them explicitly', async () => {
    const user = userEvent.setup()
    render(<RoutedNewsPage />, '/market/news?view=events&country=CA&industry=XLK&asset=yfinance%7CAAPL')
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'CA', industry: 'XLK', asset: 'yfinance|AAPL' }), expect.any(AbortSignal)))
    expect(mocks.importantQuery).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'CA', industry: 'XLK', asset: 'yfinance|AAPL' }))
    await user.type(screen.getByRole('textbox', { name: 'Keyword' }), 'policy')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'CA', keyword: 'policy' }), expect.any(AbortSignal)))
    await user.click(screen.getByRole('button', { name: 'Hot' }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'CA', industry: 'XLK', storyOrder: 'heat' }), expect.any(AbortSignal)))
    await user.click(screen.getByRole('button', { name: 'Clear relationships' }))
    await waitFor(() => expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty('country'))
    expect(mocks.list.mock.lastCall?.[0]).toHaveProperty('keyword', 'policy')
  })
  it('opens the exact event from a notification without applying old reading or keyword filters', async () => {
    const story = { version: 1 as const, id: 'port-closure', revision: 1, title: 'Port closure', summary: 'A closure.', reason: 'Exact notification destination.', topics: ['shipping'], symbols: [], selected: false, status: 'watching' as const, updatedAt: '2026-10-24T10:00:00Z', preparedBy: 'Fixture', overviewReportIds: [1], developments: [{ id: 'closure', time: '2026-10-24T09:00:00Z', title: 'Closure', summary: 'The port closed.', reportIds: [1] }], reports: [], missingReportIds: [] }
    mocks.list.mockResolvedValue({ items: [], count: 0, lookback: '24h', stories: [story] })
    mocks.getStory.mockResolvedValue(story)
    render(<RoutedNewsPage />, '/market/news?eventId=port-closure&readStatus=unread&keyword=unrelated')
    expect(await screen.findByText('Exact notification destination.')).toBeTruthy()
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: 'port-closure', includeStories: true }), expect.any(AbortSignal)))
    expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty('readStatus')
    expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty('keyword')
    expect(screen.getByRole('button', { name: 'Port closure' }).getAttribute('aria-expanded')).toBe('true')
  })
  it('opens a Latest important headline without a hidden reading filter excluding it', async () => {
    const user = userEvent.setup()
    render(<RoutedNewsPage />, '/market/news?view=events&readStatus=updated&country=CA&industry=XLK&asset=yfinance%7CAAPL')
    await user.click(screen.getByRole('button', { name: 'Latest' }))
    await user.click(screen.getByRole('button', { name: 'Open important event' }))
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Reading status' }) as HTMLSelectElement).value).toBe('all'))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ important: true, includeStories: true }), expect.any(AbortSignal)))
    expect(mocks.list.mock.lastCall?.[0].readStatus).toBeUndefined()
    expect(mocks.list.mock.lastCall?.[0].country).toBeUndefined()
    expect(mocks.list.mock.lastCall?.[0].industry).toBeUndefined()
    expect(mocks.list.mock.lastCall?.[0].asset).toBeUndefined()
  })

  it('restores reading status, sends it to events and keeps it across views until Clear', async () => {
    const user = userEvent.setup()
    render(<RoutedNewsPage />, '/market/news?view=events&keyword=shipping&readStatus=updated')
    const reading = await screen.findByRole('combobox', { name: 'Reading status' })
    expect((reading as HTMLSelectElement).value).toBe('updated')
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ readStatus: 'updated', includeStories: true, keyword: 'shipping' }), expect.any(AbortSignal)))
    await user.selectOptions(reading, 'unread')
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ readStatus: 'unread' }), expect.any(AbortSignal)))
    await user.click(screen.getByRole('button', { name: 'Latest' }))
    expect(screen.queryByRole('combobox', { name: 'Reading status' })).toBeNull()
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ readStatus: expect.any(String) }), expect.any(AbortSignal)))
    await user.click(screen.getByRole('button', { name: 'Events' }))
    expect((await screen.findByRole('combobox', { name: 'Reading status' }) as HTMLSelectElement).value).toBe('unread')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Reading status' }) as HTMLSelectElement).value).toBe('all'))
  })

  it('keeps market context and the economic calendar off the News homepage', async () => {
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    expect(screen.queryByRole('region', { name: 'Market context' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Economic calendar' })).toBeNull()
  })

  it('applies a country-name deep link and preserves it across views until explicitly cleared', async () => {
    const user = userEvent.setup()
    mocks.list.mockResolvedValue({ ...newsResponse('Country report'), stories: [] })
    render(<RoutedNewsPage />, '/market/news?view=events&keyword=Canada')
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'Canada', includeStories: true }), expect.any(AbortSignal)))
    expect((screen.getByRole('textbox', { name: 'Keyword' }) as HTMLInputElement).value).toBe('Canada')
    await user.click(screen.getByRole('button', { name: 'Hot' }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'Canada', storyOrder: 'heat' }), expect.any(AbortSignal)))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ keyword: 'Canada' }), expect.any(AbortSignal)))
    expect((screen.getByRole('textbox', { name: 'Keyword' }) as HTMLInputElement).value).toBe('')
  })
  it('requests server-ranked heat, persistent bookmarks and discovered topics', async () => {
    const user = userEvent.setup()
    mocks.list.mockResolvedValue({ ...newsResponse('Raw report'), stories: [], storyTopics: [{ topic: 'shipping', count: 2 }] })
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Raw report' })
    await user.click(screen.getByRole('button', { name: 'Hot' }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ includeStories: true, storyOrder: 'heat' }), expect.any(AbortSignal)))
    const topics = await screen.findByRole('combobox', { name: 'Event topics' })
    await user.selectOptions(topics, 'shipping')
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ storyTopics: 'shipping' }), expect.any(AbortSignal)))
    await user.click(screen.getByRole('button', { name: 'Bookmarks' }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ bookmarked: true }), expect.any(AbortSignal)))
  })
  it('reads an AI story without a stock link, with separate developments and cited originals across days', async () => {
    mocks.list.mockResolvedValue({ ...newsResponse('Raw report'), storyNextOffset: 50, stories: [{ version: 1, id: 'model-access', revision: 1, title: 'Model release and access', summary: 'A release followed by wider access.', reason: 'Track adoption; business effects remain uncertain.', topics: ['ai'], symbols: [], selected: true, status: 'active', updatedAt: '2026-07-29T11:00:00Z', preparedBy: 'Native CLI', overviewReportIds: [1, 2], missingReportIds: [], developments: [
      { id: 'release', time: '2026-07-27T08:00:00Z', title: 'Model released', summary: 'First release.', reportIds: [1] },
      { id: 'access', time: '2026-07-29T10:00:00Z', title: 'Access opened', summary: 'New access, a different fact.', reportIds: [2] },
    ], reports: [
      { id: 1, ...newsResponse('Original launch').items[0], time: '2026-07-27T08:00:00Z', source: 'AI Lab', role: 'official', link: 'https://example.com/release' },
      { id: 2, ...newsResponse('Access announcement').items[0], source: 'AI Lab', role: 'official', link: 'https://example.com/access' },
    ] }] })
    const response = await mocks.list()
    response.stories[0].reading = { important: true, bookmarked: false, locked: false, heat: 0, participants: 0, trend: 'unknown', isNew: false, hasUpdate: false }
    const importantRequest = deferred<NewsListResponse>()
    mocks.list.mockImplementation(async params => params?.important ? importantRequest.promise : response)
    mocks.getStory.mockResolvedValue(response.stories[0])
    render(<RoutedNewsPage delayed />)
    await screen.findByRole('heading', { name: 'Raw report' })
    expect(screen.queryByRole('button', { name: 'Selected' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open important event' }))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ important: true, includeStories: true }), expect.any(AbortSignal)))
    await act(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
    await act(async () => { importantRequest.resolve(response) })
    expect(await screen.findByText('Track adoption; business effects remain uncertain.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse details' }))
    const sourceFilter = screen.getByRole('combobox', { name: 'News source' })
    sourceFilter.focus()
    fireEvent.change(sourceFilter, { target: { value: 'AI Lab' } })
    await screen.findByRole('heading', { name: 'Model release and access' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Read event' })).toBeTruthy())
    expect(document.activeElement).toBe(sourceFilter)
    fireEvent.click(screen.getByRole('button', { name: 'Events' }))
    expect(await screen.findByRole('heading', { name: 'Model release and access' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Latest development' })).getByText('Access opened')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Read event' }))
    const panel = await screen.findByRole('region', { name: 'Model release and access' })
    expect(await within(panel).findByText('Track adoption; business effects remain uncertain.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(panel).getByText('Developments · 2', { selector: 'summary' }))
    expect(within(panel).getByRole('heading', { name: 'Model released' })).toBeTruthy()
    expect(within(panel).getByRole('heading', { name: 'Access opened' })).toBeTruthy()
    fireEvent.click(within(panel).getByText('Original reports · 2', { selector: 'summary' }))
    expect(within(panel).getByRole('link', { name: 'Original launch' }).getAttribute('href')).toBe('https://example.com/release')
    expect(within(panel).getByText('Native CLI')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Reporting sources' })).getByText('AI Lab')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hot' }))
    expect(await screen.findByLabelText('Coverage rank 1')).toHaveProperty('textContent', '01')
    fireEvent.click(screen.getByRole('button', { name: 'Next events' }))
    expect(await screen.findByLabelText('Coverage rank 51')).toHaveProperty('textContent', '51')
    fireEvent.click(screen.getByRole('button', { name: 'Show topic: ai' }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ storyOrder: 'heat', storyTopics: 'ai' }), expect.any(AbortSignal)))
    expect(mocks.list.mock.lastCall?.[0].storyOffset).toBeUndefined()
    expect(await screen.findByLabelText('Coverage rank 1')).toBeTruthy()
  })
  it('provides named navigation and automatic-update controls without the duplicate source strip', async () => {
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    expect(screen.getByRole('link', { name: 'Browse sources' }).getAttribute('href')).toBe('/settings/news-collector#news-source-directory')
    expect(screen.getByRole('checkbox', { name: 'Automatic updates' })).toBeTruthy()
    expect(screen.queryByLabelText('Source coverage')).toBeNull()
    const row = newsRows()[0]
    expect(within(row).getByRole('link', { name: 'Bloomberg' }).textContent).toBe('Bloomberg')
  })
  it('requests category filtering at the server and labels timestamps without a publication date', async () => {
    mocks.list.mockResolvedValue({ items: [{ ...newsResponse('Undated AI report').items[0], categories: 'ai', timeBasis: 'collection' }], count: 1, lookback: '24h' })
    render(<RoutedNewsPage />, '/market/news?category=ai')
    await screen.findByRole('heading', { name: 'Undated AI report' })
    expect(mocks.list.mock.calls.at(-1)?.[0]).toMatchObject({ categories: 'ai,artificial-intelligence,llm,machine-learning' })
    expect(screen.getByText('Collected')).toBeTruthy()
  })
  it('provides a keyboard action for revealing more reports', async () => {
    mocks.list.mockResolvedValue({ items: Array.from({ length: 41 }, (_, index) => ({ ...newsResponse('Report ' + index).items[0], time: new Date(Date.UTC(2026, 6, 29, 0, index)).toISOString() })), count: 41, lookback: '24h' })
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Report 40' })
    expect(newsRows()).toHaveLength(40)
    fireEvent.click(screen.getByRole('button', { name: 'Show more reports' }))
    expect(newsRows()).toHaveLength(41)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Report 0' })))
  })
  it('focuses the first new stream row when earlier grouped originals are expanded', async () => {
    const items = Array.from({ length: 41 }, (_, index) => ({ ...newsResponse('Report ' + index).items[0], id: index + 1, time: new Date(Date.UTC(2026, 6, 29, 0, index)).toISOString(), eventRef: { storyId: 'event-' + index, developmentId: 'fact' } }))
    items.push({ ...items[40], id: 1000, source: 'Second desk' })
    mocks.list.mockResolvedValue({ items, count: items.length, lookback: '24h' })
    render(<RoutedNewsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '2 reports · 2 sources' }))
    const more = screen.getByRole('button', { name: 'Show more reports' })
    more.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Report 0' })))
  })
  it('expands a long quoted original even when the main article content is empty', async () => {
    mocks.list.mockResolvedValue({ items: [{ ...newsResponse('Quote-only report').items[0], content: '', quote: { author: '@other', text: 'Long quoted original text', url: 'https://x.com/other/status/1' } }], count: 1, lookback: '24h' })
    render(<RoutedNewsPage />)
    const quote = await screen.findByText('Long quoted original text')
    expect(quote.className).toContain('line-clamp-3')
    const expand = screen.getByRole('button', { name: i18n.t('news.showMore') })
    fireEvent.click(expand)
    expect(quote.className).not.toContain('line-clamp-3')
    expect(expand.getAttribute('aria-controls')).toBe(quote.id)
  })
  it('keeps an X author, quote and explicit stock association visible in the watchlist', async () => {
    mocks.watchlist = [{ assetClass: 'equity', symbol: 'EXAMPLE', addedAt: 1 }]
    mocks.list.mockResolvedValue({ items: [{ ...newsResponse('A new product launch').items[0], source: 'Example company', author: '@example', symbols: ['NASDAQ:EXAMPLE'], quote: { author: '@other', text: 'Quoted announcement', url: 'https://x.com/other/status/1' } }], count: 1, lookback: '24h' })
    render(<RoutedNewsPage />, '/market/news?view=watchlist')
    await screen.findByRole('heading', { name: 'A new product launch' })
    expect(screen.getByText('@example')).toBeTruthy()
    expect(screen.getByRole('link', { name: '@other' }).getAttribute('href')).toBe('https://x.com/other/status/1')
    expect(screen.getByText('Quoted announcement')).toBeTruthy()
    expect(screen.getByText('NASDAQ:EXAMPLE')).toBeTruthy()
  })
  it('opens grouped originals inside the News feed without a dialog', async () => {
    mocks.list.mockResolvedValue({ items: [
      { ...newsResponse('Fed holds rates steady as inflation cools').items[0], source: 'fed' },
      { ...newsResponse('Fed holds interest rates steady as inflation cools').items[0], time: '2026-07-29T11:00:00Z', source: 'cls' },
    ], count: 2, lookback: '24h' })
    render(<RoutedNewsPage />)
    const trigger = await screen.findByRole('button', { name: '2 reports · 2 sources' })
    await userEvent.setup().click(trigger)
    await screen.findByRole('heading', { name: 'Fed holds rates steady as inflation cools' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(screen.getByTestId('news-feed')).getByRole('heading', { name: 'Fed holds rates steady as inflation cools' })).toBeTruthy()
  })

  it('folds multiple reports and opens the complete event timeline without losing the stream', async () => {
    mocks.list.mockResolvedValueOnce({ items: [
      { ...newsResponse('Fed holds rates steady as inflation cools').items[0], source: 'fed' },
      { ...newsResponse('Fed holds interest rates steady as inflation cools').items[0], time: '2026-07-29T11:00:00Z', source: 'cls' },
    ], count: 2, lookback: '24h' })
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Fed holds interest rates steady as inflation cools' })
    expect(newsRows()).toHaveLength(1)
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: '2 reports · 2 sources' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const timeline = await screen.findByRole('region', { name: 'Reporting timeline' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(timeline).getByRole('heading', { name: 'Fed holds rates steady as inflation cools' })).toBeTruthy()
    expect(within(timeline).getByText('cls')).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await user.click(trigger)
    expect(screen.queryByRole('region', { name: 'Reporting timeline' })).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'All reports' }))
    expect(newsRows()).toHaveLength(2)
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })

  it('marks a title-only report as missing its body', async () => {
    const value = newsResponse('Title only')
    value.items[0].content = ''
    mocks.list.mockResolvedValue(value)
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Title only' })
    expect(screen.getByText('The source did not provide a body.')).toBeTruthy()
  })

  it('orders complete stories newest-first with their own source and original link', async () => {
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    const rows = newsRows()
    expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual(['Newest update', 'Middle update', 'Oldest update'])
    expect(within(rows[0]).getByText('Newest content')).toBeTruthy()
    fireEvent.click(within(rows[0]).getByRole('button', { name: i18n.t('news.showMore') }))
    expect(within(rows[0]).getByText('Newest content')).toBeTruthy()
    fireEvent.click(within(rows[0]).getByRole('button', { name: i18n.t('news.showLess') }))
    expect(within(rows[0]).getByText('Newest content')).toBeTruthy()
    expect(within(rows[0]).getByText('Bloomberg')).toBeTruthy()
    expect(within(rows[0]).getByRole('link', { name: 'Bloomberg' }).getAttribute('href')).toBe('https://example.com/newest')
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
    render(<RoutedNewsPage />)
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
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Story 80' })
    expect(newsRows()).toHaveLength(40)
    // Rendering the first batch does not guarantee the observer effect has registered.
    await waitFor(() => expect(notify).toBeTypeOf('function'))
    act(() => notify(false))
    expect(screen.queryByRole('heading', { name: 'Story 40' })).toBeNull()
    act(() => { notify(true); notify(true) })
    expect(newsRows()).toHaveLength(80)
    const previousView = notify
    const stream = screen.getByRole('region', { name: i18n.t('news.streamLabel') })
    stream.scrollTop = 5000
    fireEvent.click(within(screen.getByRole('navigation', { name: 'News views' })).getByRole('button', { name: 'Positive' }))
    act(() => previousView(true))
    expect(newsRows()).toHaveLength(40)
    expect(stream.scrollTop).toBe(0)
    act(() => notify(true))
    expect(newsRows()).toHaveLength(80)
    act(() => notify(true))
    expect(newsRows()).toHaveLength(81)
    expect(screen.getByRole('heading', { name: 'Story 0' })).toBeTruthy()
  })

  it('applies the category from market navigation without rendering another navigator', async () => {
    render(<RoutedNewsPage />, '/market/news?category=macro')
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
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: /AAPL supplier setback/ })
    const views = screen.getByRole('navigation', { name: 'News views' })
    fireEvent.click(within(views).getByRole('button', { name: 'Important' }))
    expect(screen.queryByRole('heading', { name: 'NVDA advances after results' })).toBeNull()
    fireEvent.click(within(views).getByRole('button', { name: 'Positive' }))
    expect(await screen.findByRole('heading', { name: 'NVDA advances after results' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /AAPL supplier setback/ })).toBeNull()
    fireEvent.click(within(views).getByRole('button', { name: 'Negative' }))
    expect(screen.getByRole('heading', { name: /AAPL supplier setback/ })).toBeTruthy()
    fireEvent.click(within(views).getByRole('button', { name: 'Watchlist' }))
    expect(newsRows()).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /AAPL supplier setback/ })).toBeTruthy()
  })

  it('keeps advanced filters collapsed until requested without reloading the feed', async () => {
    const user = userEvent.setup()
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    expect(screen.queryByLabelText('Start date')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Symbol' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Keyword' })).toBeTruthy()
    const toggle = screen.getByRole('button', { name: 'Filters' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('Start date')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Symbol' })).toBeTruthy()
    await user.click(toggle)
    expect(screen.queryByLabelText('Start date')).toBeNull()
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })

  it('collapses applied advanced filters, shows their count and clears them', async () => {
    const user = userEvent.setup()
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-07-28' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-07-29' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Symbol' }), { target: { value: 'AAPL' } })
    screen.getByRole('textbox', { name: 'Symbol' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mocks.list.mock.lastCall?.[0]).toMatchObject({ symbol: 'AAPL', startTime: expect.any(String), endTime: expect.any(String) }))
    expect(screen.queryByLabelText('Start date')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search' }))
    const toggle = screen.getByRole('button', { name: 'Filters (2)' })
    await user.click(toggle)
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-07-28')
    expect((screen.getByRole('textbox', { name: 'Symbol' }) as HTMLInputElement).value).toBe('AAPL')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(mocks.list.mock.lastCall?.[0].symbol).toBeUndefined())
    expect(mocks.list.mock.lastCall?.[0].startTime).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-expanded')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('textbox', { name: 'Symbol' }) as HTMLInputElement).value).toBe('')
  })

  it('submits text filters deliberately and clears them without losing the stream', async () => {
    render(<RoutedNewsPage />)
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
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-07-30' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-07-29' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByText(i18n.t('news.dateRangeError'))).toBeTruthy()
    const start = screen.getByLabelText('Start date')
    expect(start.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(start.getAttribute('aria-describedby')!)?.textContent).toContain(i18n.t('news.dateRangeError'))
    await waitFor(() => expect(document.activeElement).toBe(start))
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Newest update' })).toBeTruthy()
  })

  it('keeps a broken thumbnail from obscuring a story and rejects executable links', async () => {
    mocks.list.mockResolvedValue({ ...newsResponse('Unsafe link story'), items: [{ ...newsResponse('Unsafe link story').items[0], link: 'javascript:alert(1)', image: 'https://example.com/story.jpg' }] })
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Unsafe link story' })
    expect(within(newsRows()[0]).queryByRole('link')).toBeNull()
    expect(screen.getByText('Unsafe link story content')).toBeTruthy()
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Unsafe link story content')).toBeTruthy()
  })
})

describe('NewsPage request recovery', () => {
  it('reports initial failure and retries without calling it an empty feed', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(newsResponse('Recovered update'))
    render(<RoutedNewsPage />)
    await screen.findByRole('alert')
    expect(screen.queryByText('No articles')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Recovered update' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears mismatched articles when a new source filter fails', async () => {
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    mocks.list.mockRejectedValueOnce(new Error('filter unavailable'))
    fireEvent.change(screen.getByRole('combobox', { name: 'News source' }), { target: { value: 'Reuters' } })
    await screen.findByRole('alert')
    expect(screen.queryByRole('heading', { name: 'Newest update' })).toBeNull()
    expect(screen.queryByText('No articles')).toBeNull()
  })

  it('shows new-report updates without replacing the stream before confirmation', async () => {
    let poll: (() => void) | undefined
    vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, delay) => {
      if (delay === 60_000) poll = handler as () => void
      return {} as ReturnType<typeof setInterval>
    })
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    mocks.list.mockResolvedValueOnce(newsResponse('Incoming report'))
    await act(async () => { poll?.(); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByRole('heading', { name: 'Newest update' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Incoming report' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show new reports (1)' }))
    expect(await screen.findByRole('heading', { name: 'Incoming report' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show new reports (1)' })).toBeNull()
  })

  it('retains the successful stream on refresh failure and recovers', async () => {
    let refresh: (() => void) | undefined
    vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, delay) => {
      if (delay === 60_000) refresh = handler as () => void
      return {} as ReturnType<typeof setInterval>
    })
    render(<RoutedNewsPage />)
    await screen.findByRole('heading', { name: 'Newest update' })
    expect(refresh).toBeTypeOf('function')
    mocks.list.mockRejectedValueOnce(new Error('refresh unavailable'))
    await act(async () => { refresh?.(); await Promise.resolve(); await Promise.resolve() })
    const notice = await screen.findByText(i18n.t('news.stale'))
    expect(screen.getByRole('heading', { name: 'Newest update' })).toBeTruthy()
    mocks.list.mockResolvedValueOnce(newsResponse('Refreshed update'))
    fireEvent.click(within(notice.closest('[role="status"]')!).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Refreshed update' })).toBeTruthy()
    expect(screen.queryByText(i18n.t('news.stale'))).toBeNull()
  })

  it('lets the latest query win when an older request finishes last', async () => {
    render(<RoutedNewsPage />)
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
