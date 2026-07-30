// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { NewsPage } from './NewsPage'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    news: {
      list: mocks.list,
    },
  },
}))

beforeEach(async () => {
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
          time: '2026-07-28T09:00:00.000Z',
          title: 'Older day',
          content: '',
          source: 'Reuters',
          link: null,
          categories: null,
        },
        {
          time: '2026-07-29T08:00:00.000Z',
          title: 'Newer day second',
          content: '',
          source: 'Reuters',
          link: null,
          categories: null,
        },
        {
          time: '2026-07-29T10:00:00.000Z',
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
  })
})
