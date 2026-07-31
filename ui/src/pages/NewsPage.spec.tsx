// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { NewsPage } from './NewsPage'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}))

function newsResponse(title: string, lookback = '24h') {
  return {
    items: [{
      time: '2026-07-29T10:00:00.000Z',
      title,
      content: `${title} content`,
      source: 'Reuters',
      link: null,
      categories: null,
    }],
    count: 1,
    lookback,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('../api', () => ({
  api: {
    news: {
      list: mocks.list,
    },
  },
}))

beforeEach(async () => {
  mocks.list.mockReset()
  await i18n.changeLanguage('en')
  mocks.list.mockResolvedValue({
    items: [
      {
        time: '2026-07-29T08:00:00.000Z',
        title: 'Middle update',
        content: 'Middle content',
        source: 'Reuters',
        link: null,
        categories: null,
      },
      {
        time: '2026-07-29T10:00:00.000Z',
        title: 'Newest update',
        content: 'Newest content',
        source: 'Bloomberg',
        link: 'https://example.com/newest',
        categories: null,
      },
      {
        time: '2026-07-29T06:00:00.000Z',
        title: 'Oldest update',
        content: 'Oldest content',
        source: 'CNBC',
        link: null,
        categories: null,
      },
    ],
    count: 3,
    lookback: '24h',
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('NewsPage ordering', () => {
  it('shows the newest article first regardless of API response order', async () => {
    render(<NewsPage />)

    const newest = await screen.findByText('Newest update')
    const middle = screen.getByText('Middle update')
    const oldest = screen.getByText('Oldest update')

    expect(newest.compareDocumentPosition(middle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(middle.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('NewsPage article disclosures', () => {
  it('uses a native disclosure button that expands with the keyboard', async () => {
    const user = userEvent.setup()
    render(<NewsPage />)

    const disclosure = await screen.findByRole('button', { name: 'Newest update' })
    expect(disclosure.tagName).toBe('BUTTON')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    const panelId = disclosure.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open original' })).toBeNull()

    disclosure.focus()
    await user.keyboard('{Enter}')

    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region').id).toBe(panelId)
    const originalLink = screen.getByRole('link', { name: 'Open original' })
    expect(originalLink.getAttribute('href')).toBe('https://example.com/newest')
    expect(originalLink.className).toContain('min-h-10')

    await user.keyboard(' ')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Open original' })).toBeNull()
  })

  it('labels the feed filters and exposes loading state on the article surface', async () => {
    render(<NewsPage />)

    expect(await screen.findByRole('combobox', { name: 'News time range' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'News source' })).toBeTruthy()

    const article = await screen.findByRole('button', { name: 'Newest update' })
    expect(article.className).toContain('sm:py-3.5')
    expect(article.closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByTestId('news-feed').className).not.toContain('rounded-xl')
    expect(screen.getByTestId('news-feed').className).not.toContain('shadow-')
  })

  it('uses compact rows without content and preview rows only when content exists', async () => {
    mocks.list.mockResolvedValue({
      items: [
        {
          time: '2026-07-29T10:00:00.000Z',
          title: 'Compact transcript',
          content: '',
          source: 'SeekingAlpha',
          link: 'https://example.com/transcript',
          categories: 'markets,us',
        },
        {
          time: '2026-07-29T09:00:00.000Z',
          title: 'Reported story',
          content: 'A useful editorial summary that should be visible in the feed.',
          source: 'Reuters',
          link: null,
          categories: 'markets,asia',
        },
      ],
      count: 2,
      lookback: '24h',
    })

    render(<NewsPage />)

    const compact = (await screen.findByRole('button', { name: 'Compact transcript' })).closest('article')
    const preview = screen.getByRole('button', { name: 'Reported story' }).closest('article')
    expect(compact?.getAttribute('data-density')).toBe('compact')
    expect(preview?.getAttribute('data-density')).toBe('preview')
    expect(compact?.textContent).not.toContain('A useful editorial summary')
    expect(screen.getByText('A useful editorial summary that should be visible in the feed.')).toBeTruthy()

    const source = compact?.querySelector('span.font-semibold')
    expect(source?.textContent).toBe('SeekingAlpha')
    expect(source?.className).not.toContain('bg-primary')
    expect(screen.getByText('markets · us').className).toContain('hidden')
  })

  it('groups several calendar days without disturbing newest-first order', async () => {
    mocks.list.mockResolvedValue({
      items: [
        {
          time: '2020-07-28T09:00:00.000Z',
          title: 'Older day',
          content: '',
          source: 'Reuters',
          link: null,
          categories: null,
        },
        {
          time: '2020-07-29T08:00:00.000Z',
          title: 'Newer day second',
          content: '',
          source: 'Reuters',
          link: null,
          categories: null,
        },
        {
          time: '2020-07-29T10:00:00.000Z',
          title: 'Newer day first',
          content: '',
          source: 'Reuters',
          link: null,
          categories: null,
        },
      ],
      count: 3,
      lookback: '24h',
    })

    render(<NewsPage />)

    const first = await screen.findByText('Newer day first')
    const second = screen.getByText('Newer day second')
    const older = screen.getByText('Older day')
    expect(document.querySelectorAll('[data-news-day]')).toHaveLength(2)
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(second.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(first.closest('[data-news-day]')).toBe(second.closest('[data-news-day]'))
    expect(second.closest('[data-news-day]')).not.toBe(older.closest('[data-news-day]'))
    const newestDay = new Intl.DateTimeFormat('en', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date('2020-07-29T10:00:00.000Z'))
    expect(screen.getByRole('heading', { name: newestDay })).toBeTruthy()
  })
})

describe('NewsPage request recovery', () => {
  it('reports an initial failure instead of presenting it as an empty feed, then retries', async () => {
    mocks.list
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(newsResponse('Recovered update'))

    render(<NewsPage />)

    const error = await screen.findByRole('alert')
    expect(error.textContent).toContain('Couldn’t load News')
    expect(error.textContent).toContain('OpenAlice backend')
    expect(screen.queryByText('No articles')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Recovered update')).toBeTruthy()
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears mismatched articles when a new filter fails', async () => {
    render(<NewsPage />)
    expect(await screen.findByText('Newest update')).toBeTruthy()

    mocks.list.mockRejectedValueOnce(new Error('filter unavailable'))
    fireEvent.change(screen.getByRole('combobox', { name: 'News source' }), {
      target: { value: 'Reuters' },
    })

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Newest update')).toBeNull()
    expect(screen.queryByText('No articles')).toBeNull()
  })

  it('keeps the last successful feed visible when a background refresh fails', async () => {
    let refresh: (() => void) | undefined
    vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, delay) => {
      if (delay === 60_000) refresh = handler as () => void
      return {} as ReturnType<typeof setInterval>
    })

    render(<NewsPage />)
    expect(await screen.findByText('Newest update')).toBeTruthy()
    expect(refresh).toBeTypeOf('function')
    mocks.list.mockRejectedValueOnce(new Error('refresh unavailable'))

    await act(async () => {
      refresh?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('showing the last news received')
    expect(screen.getByText('Newest update')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    mocks.list.mockResolvedValueOnce(newsResponse('Refreshed update'))
    fireEvent.click(within(status).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Refreshed update')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('lets the latest filter response win when an older request finishes last', async () => {
    render(<NewsPage />)
    expect(await screen.findByText('Newest update')).toBeTruthy()

    const slow = deferred<ReturnType<typeof newsResponse>>()
    const fast = deferred<ReturnType<typeof newsResponse>>()
    mocks.list
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => fast.promise)

    const lookback = screen.getByRole('combobox', { name: 'News time range' })
    fireEvent.change(lookback, { target: { value: '1h' } })
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    fireEvent.change(lookback, { target: { value: '7d' } })
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3))

    await act(async () => {
      fast.resolve(newsResponse('Latest response', '7d'))
      await fast.promise
    })
    expect(await screen.findByText('Latest response')).toBeTruthy()

    await act(async () => {
      slow.resolve(newsResponse('Stale response', '1h'))
      await slow.promise
    })
    expect(screen.getByText('Latest response')).toBeTruthy()
    expect(screen.queryByText('Stale response')).toBeNull()
  })
})
