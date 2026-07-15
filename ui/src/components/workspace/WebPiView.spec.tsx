import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getWebPiSession, type WebPiSnapshot } from './api'
import { isWebPiNearBottom, WebPiView } from './WebPiView'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getWebPiSession: vi.fn(),
  promptWebPiSession: vi.fn(),
  abortWebPiSession: vi.fn(),
}))

const snapshot: WebPiSnapshot = {
  recordId: 'pi-live',
  wsId: 'ws-1',
  resumeId: 'resume-1',
  pid: 42,
  startedAt: 1,
  phase: 'idle',
  state: null,
  messages: [],
  streamingMessage: null,
  error: null,
  stderrTail: '',
  revision: 3,
}

beforeEach(() => {
  vi.mocked(getWebPiSession).mockResolvedValue(snapshot)
  HTMLElement.prototype.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('WebPi transcript scrolling', () => {
  it('distinguishes a reader browsing history from one following the tail', () => {
    expect(isWebPiNearBottom({ scrollTop: 100, clientHeight: 300, scrollHeight: 1_000 } as HTMLElement)).toBe(false)
    expect(isWebPiNearBottom({ scrollTop: 650, clientHeight: 300, scrollHeight: 1_000 } as HTMLElement)).toBe(true)
  })

  it('does not force history readers back to the bottom and offers an explicit jump', async () => {
    const { container } = render(
      <WebPiView wsId="ws-1" sessionId="pi-live" onSessionLost={vi.fn()} />,
    )
    await waitFor(() => expect(getWebPiSession).toHaveBeenCalled())

    const scroller = container.querySelector('.webpi-messages') as HTMLDivElement
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, writable: true, value: 120 },
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
    })
    fireEvent.scroll(scroller)

    const jump = screen.getByRole('button', { name: 'Jump to latest' })
    fireEvent.click(jump)

    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 1_000, behavior: 'smooth' })
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()
  })

  it('does not force history readers back down when a new snapshot revision arrives', async () => {
    vi.useFakeTimers()
    let current = snapshot
    vi.mocked(getWebPiSession).mockImplementation(async () => current)
    const { container } = render(
      <WebPiView wsId="ws-1" sessionId="pi-live" onSessionLost={vi.fn()} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const scroller = container.querySelector('.webpi-messages') as HTMLDivElement
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, writable: true, value: 120 },
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
    })
    fireEvent.scroll(scroller)
    const scrollCallsBeforeUpdate = vi.mocked(scroller.scrollTo).mock.calls.length

    current = { ...snapshot, revision: snapshot.revision + 1, phase: 'working' }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(getWebPiSession).toHaveBeenCalledTimes(2)
    expect(scroller.scrollTo).toHaveBeenCalledTimes(scrollCallsBeforeUpdate)
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy()
  })
})
