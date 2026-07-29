// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
        link: null,
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
