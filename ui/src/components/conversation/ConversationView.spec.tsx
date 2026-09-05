// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationView, type ConversationViewProps } from './ConversationView'

const base: ConversationViewProps = {
  items: [], revision: 1, busy: false, ready: true,
  placeholder: 'Ask another agent…', empty: 'Ready',
}
beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() }) })
afterEach(cleanup)

describe('adapter-neutral conversation', () => {
  it('renders a non-Pi transcript, failed execution and preserved unknown data', () => {
    render(<ConversationView {...base} items={[{
      kind: 'assistant-turn', key: 'external-turn-1', progress: ['Checking the repository'], final: 'The check failed.',
      activity: { thinking: ['Compare the result'], unknownParts: ['{"customEvent":"retained"}'], steps: [{
        id: 'external-operation', name: 'validate', summary: 'Check source', input: '{"target":"src"}',
        status: 'failed', thinking: [], result: [{ kind: 'markdown', text: 'Missing file' }],
      }] },
    }]} />)
    expect(screen.getByText('Checking the repository')).toBeTruthy()
    expect(screen.getByText('Missing file')).toBeTruthy()
    expect(screen.getByText('1 failed').closest('details')?.open).toBe(true)
    expect(screen.getByText('{"customEvent":"retained"}')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop response' })).toBeNull()
  })

  it('only exposes supported actions and blocks duplicate requests while pending', async () => {
    let complete!: () => void
    const send = vi.fn(() => new Promise<void>((resolve) => { complete = resolve }))
    render(<ConversationView {...base} send={send} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Do the work' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send).toHaveBeenCalledTimes(1)
    expect((input as HTMLTextAreaElement).disabled).toBe(true)
    complete()
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''))
  })

  it('keeps the draft on send failure and permits a deliberate retry', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(undefined)
    render(<ConversationView {...base} send={send} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe('Keep this draft')
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  })

  it('cannot send while busy and does not invent stop support', () => {
    const send = vi.fn()
    render(<ConversationView {...base} busy send={send} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Later' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(send).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
