import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { NewsTopicPicker } from './NewsTopicPicker'

const mocks = vi.hoisted(() => ({ followedTopics: vi.fn(), setTopicFollow: vi.fn() }))
vi.mock('../../api', () => ({ api: { news: mocks } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('follows the selected stored topic and keeps an absent followed topic available for unfollowing', async () => {
  await i18n.changeLanguage('en')
  mocks.followedTopics.mockResolvedValue({ topics: ['old topic'] })
  mocks.setTopicFollow.mockResolvedValueOnce({ topics: ['ai', 'old topic'] }).mockResolvedValueOnce({ topics: ['ai'] })
  const view = render(<NewsTopicPicker topics={[{ topic: 'ai', count: 2 }]} topic="ai" onChange={vi.fn()} />)
  await waitFor(() => expect((screen.getByRole('button', { name: 'Follow topic' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Follow topic' }))
  expect(await screen.findByRole('button', { name: 'Unfollow topic' })).toBeTruthy()
  expect(mocks.setTopicFollow).toHaveBeenCalledWith('ai', true)
  view.rerender(<NewsTopicPicker topics={[{ topic: 'ai', count: 2 }]} topic="old topic" onChange={vi.fn()} />)
  expect(screen.getByRole('option', { name: 'old topic (0)' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Unfollow topic' }))
  await waitFor(() => expect(mocks.setTopicFollow).toHaveBeenLastCalledWith('old topic', false))
})

it('retains the confirmed follow state on save failure and offers a reload', async () => {
  await i18n.changeLanguage('en')
  mocks.followedTopics.mockResolvedValue({ topics: ['ai'] })
  mocks.setTopicFollow.mockRejectedValueOnce(new Error('offline'))
  render(<NewsTopicPicker topics={[{ topic: 'ai', count: 2 }]} topic="ai" onChange={vi.fn()} />)
  const button = await screen.findByRole('button', { name: 'Unfollow topic' })
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(button.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})
