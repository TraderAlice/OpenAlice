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

 it('does not animate the first asynchronously loaded active history', () => {
   const { rerender } = render(<ConversationView {...base} />)
   rerender(<ConversationView {...base} busy items={[{ kind: 'assistant-turn', key: 'history', progress: [], final: 'Already in progress', activity: null }]} />)
   expect(screen.getByText('Already in progress')).toBeTruthy()
 })

describe('warm-frame follow-tail restore', () => {
  it('scrolls to the latest turn when a following reader returns from a hidden warm frame', async () => {
    const items = [{
      kind: 'assistant-turn' as const,
      key: 'turn-1',
      progress: [],
      final: 'Latest answer',
      activity: null,
    }]
    const { container, rerender } = render(<ConversationView {...base} items={items} visible={false} />)
    const scroller = container.querySelector('.conversation-messages') as HTMLDivElement
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, writable: true, value: 0 },
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
    })
    vi.mocked(scroller.scrollTo).mockClear()

    rerender(<ConversationView {...base} items={items} visible />)
    await waitFor(() => {
      expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: 'auto' })
    })
  })

  it('does not force history readers to the bottom when the warm frame becomes visible', async () => {
    const items = [{
      kind: 'assistant-turn' as const,
      key: 'turn-1',
      progress: [],
      final: 'Older context',
      activity: null,
    }]
    const { container, rerender } = render(<ConversationView {...base} items={items} />)
    const scroller = container.querySelector('.conversation-messages') as HTMLDivElement
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, writable: true, value: 120 },
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
    })
    fireEvent.scroll(scroller)
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy()
    vi.mocked(scroller.scrollTo).mockClear()

    rerender(<ConversationView {...base} items={items} visible={false} />)
    rerender(<ConversationView {...base} items={items} visible />)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    expect(scroller.scrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy()
  })
})
