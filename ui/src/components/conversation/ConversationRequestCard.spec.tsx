// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationRequestCard } from './ConversationRequestCard'

afterEach(cleanup)
const question = { id: 'q1', kind: 'question' as const, title: 'Project name', allowText: true, options: [] }

it('retains the draft after an error and permits a retry', async () => {
  const respond = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(undefined)
  render(<ConversationRequestCard request={question} queued={0} respond={respond} />)
  const field = screen.getByLabelText('Your answer') as HTMLTextAreaElement
  fireEvent.change(field, { target: { value: 'Alice research' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
  await screen.findByRole('alert')
  expect(field.value).toBe('Alice research')
  fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
  await waitFor(() => expect(respond).toHaveBeenCalledTimes(2))
  expect(respond).toHaveBeenLastCalledWith('q1', '', 'Alice research')
})

it('masks secret input and does not expose text fields on permissions', () => {
  const { unmount } = render(<ConversationRequestCard request={{ ...question, secret: true }} queued={0} respond={vi.fn()} />)
  expect(screen.getByLabelText('Your answer').getAttribute('type')).toBe('password')
  unmount()
  render(<ConversationRequestCard request={{ ...question, kind: 'permission', options: [{ id: 'allow', label: 'Allow', tone: 'allow' }] }} queued={0} respond={vi.fn()} />)
  expect(screen.queryByLabelText('Your answer')).toBeNull()
  expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy()
})
