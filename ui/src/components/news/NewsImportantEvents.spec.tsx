import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { NewsImportantEvents } from './NewsImportantEvents'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../api', () => ({ api: { news: { list: mocks.list } } }))
const events = Array.from({ length: 4 }, (_, index) => ({ id: `event-${index}`, title: `Important ${index}`, updatedAt: '2026-10-24T10:00:00Z', reading: { important: true }, reports: [] }))
beforeEach(async () => { await i18n.changeLanguage('en'); mocks.list.mockReset().mockResolvedValue({ items: [], count: 0, lookback: '24h', stories: events }) })
afterEach(cleanup)

it('shows at most three explicitly important headlines and opens the chosen event or full view', async () => {
  const user = userEvent.setup(), open = vi.fn(), all = vi.fn()
  render(<NewsImportantEvents query={{ source: 'Publisher', storyTopics: 'macro' }} autoRefresh={false} revision={0} onOpen={open} onViewAll={all} />)
  const region = screen.getByRole('region', { name: 'Important events' })
  await within(region).findByRole('button', { name: 'Important 0' })
  expect(within(region).queryByRole('button', { name: 'Important 3' })).toBeNull()
  await user.click(within(region).getByRole('button', { name: 'Important 1' }))
  expect(open).toHaveBeenCalledWith('event-1')
  await user.click(within(region).getByRole('button', { name: 'View all important events' }))
  expect(all).toHaveBeenCalledTimes(1)
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ important: true, includeStories: true, source: 'Publisher', storyTopics: 'macro', limit: 1 }), expect.any(AbortSignal))
})

it('keeps an honest empty state instead of filling it from selected or hot events', async () => {
  mocks.list.mockResolvedValue({ items: [], count: 0, stories: [{ ...events[0], selected: true, reading: { important: false, heat: 999 } }] })
  render(<NewsImportantEvents query={{}} autoRefresh={false} revision={0} onOpen={vi.fn()} onViewAll={vi.fn()} />)
  expect(await screen.findByText('No important events marked.')).toBeTruthy()
})

it('uses the destination relevance ordering when a keyword could move a headline beyond page one', async () => {
  render(<NewsImportantEvents query={{ keyword: 'policy' }} autoRefresh={false} revision={0} onOpen={vi.fn()} onViewAll={vi.fn()} />)
  await screen.findByRole('button', { name: 'Important 0' })
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'policy', storyOrder: 'relevance', important: true }), expect.any(AbortSignal))
})

it('retries a local failure and refreshes after an explicit designation change', async () => {
  const user = userEvent.setup()
  mocks.list.mockRejectedValueOnce(new Error('offline'))
  const props = { query: {}, autoRefresh: false, revision: 0, onOpen: vi.fn(), onViewAll: vi.fn() }
  const { rerender } = render(<NewsImportantEvents {...props} />)
  await user.click(await screen.findByRole('button', { name: 'Retry important events' }))
  await screen.findByRole('button', { name: 'Important 0' })
  rerender(<NewsImportantEvents {...props} revision={1} />)
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3))
})
