// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationTranscriptItem } from './ConversationTranscript'
import { MessageActions } from './MessageActions'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('copies the final response without reasoning or tool data', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<ConversationTranscriptItem working={false} item={{
    kind: 'assistant-turn', key: 'turn', progress: ['Progress only'], final: '**Final answer**',
    activity: { steps: [], thinking: ['Private reasoning'], unknownParts: ['raw payload'] },
  }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  expect(writeText).toHaveBeenCalledWith('**Final answer**')
})

it('reports clipboard failures and supports a deliberate retry', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('Denied')).mockResolvedValueOnce(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<MessageActions text="Reply" />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('does not offer copy for a response still streaming', () => {
  render(<ConversationTranscriptItem working item={{ kind: 'assistant-turn', key: 'stream', progress: [], final: 'Partial', activity: null }} />)
  expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull()
})

it('labels an unfinished tool as incomplete after execution stops', () => {
  render(<ConversationTranscriptItem working={false} item={{
    kind: 'assistant-turn', key: 'interrupted', progress: [], final: null,
    activity: { thinking: [], unknownParts: [], steps: [{ id: 'read', name: 'read', summary: null, status: 'running', input: '{}', thinking: [] }] },
  }} />)
  expect(screen.getAllByText('Incomplete')).toHaveLength(2)
  expect(screen.queryByText('Completed')).toBeNull()
  expect(screen.queryByText('Running…')).toBeNull()
})
