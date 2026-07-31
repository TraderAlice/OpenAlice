// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WebPiSnapshot } from './api'
import { isWebPiNearBottom, WebPiView } from './WebPiView'

const mocks = vi.hoisted(() => ({
  abortWebPiSession: vi.fn(),
  getWebPiSession: vi.fn(),
  promptWebPiSession: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    abortWebPiSession: mocks.abortWebPiSession,
    getWebPiSession: mocks.getWebPiSession,
    promptWebPiSession: mocks.promptWebPiSession,
  }
})

function snapshot(phase: WebPiSnapshot['phase']): WebPiSnapshot {
  return {
    recordId: 'p1',
    wsId: 'workspace-manager',
    resumeId: 'resume-pi',
    pid: 42,
    startedAt: 1,
    phase,
    state: { isCompacting: phase === 'compacting', isStreaming: phase === 'working' },
    messages: [],
    streamingMessage: null,
    error: null,
    stderrTail: '',
    revision: 1,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  mocks.getWebPiSession.mockResolvedValue(snapshot('compacting'))
  mocks.abortWebPiSession.mockResolvedValue(snapshot('idle'))
  mocks.promptWebPiSession.mockResolvedValue(snapshot('idle'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WebPi transcript scrolling', () => {
  it('distinguishes a reader browsing history from one following the tail', () => {
    expect(isWebPiNearBottom({ scrollTop: 100, clientHeight: 300, scrollHeight: 1_000 } as HTMLElement)).toBe(false)
    expect(isWebPiNearBottom({ scrollTop: 650, clientHeight: 300, scrollHeight: 1_000 } as HTMLElement)).toBe(true)
  })

  it('does not force history readers back to the bottom and offers an explicit jump', async () => {
    mocks.getWebPiSession.mockResolvedValue(snapshot('idle'))
    const { container } = render(
      <WebPiView wsId="workspace-manager" sessionId="p1" onSessionLost={vi.fn()} />,
    )
    await waitFor(() => expect(mocks.getWebPiSession).toHaveBeenCalled())

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
    let current = snapshot('idle')
    mocks.getWebPiSession.mockImplementation(async () => current)
    const { container } = render(
      <WebPiView wsId="workspace-manager" sessionId="p1" onSessionLost={vi.fn()} />,
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

    current = { ...current, revision: current.revision + 1, phase: 'working' }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(mocks.getWebPiSession).toHaveBeenCalledTimes(2)
    expect(scroller.scrollTo).toHaveBeenCalledTimes(scrollCallsBeforeUpdate)
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy()
  })
})

describe('WebPi composer keyboard submission', () => {
  it('does not submit when Enter confirms an IME composition candidate', async () => {
    mocks.getWebPiSession.mockResolvedValue(snapshot('idle'))
    render(
      <WebPiView wsId="workspace-manager" sessionId="p1" onSessionLost={vi.fn()} />,
    )

    const composer = await screen.findByPlaceholderText('Message Pi…')
    fireEvent.change(composer, { target: { value: '继续检查' } })

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: true })
    expect(mocks.promptWebPiSession).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: false })
    await waitFor(() => expect(mocks.promptWebPiSession).toHaveBeenCalledWith(
      'workspace-manager',
      'p1',
      '继续检查',
    ))
  })
})

describe('WebPiView compaction state', () => {
  it('explains the pause and keeps the stop action available while Pi compacts', async () => {
    render(
      <WebPiView
        wsId="workspace-manager"
        sessionId="p1"
        label="Workspace Manager"
        onSessionLost={vi.fn()}
      />,
    )

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Compacting conversation context')
    expect(status.textContent).toContain('summarizing older history')
    expect(screen.getByText('compacting')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop Pi' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Stop Pi' }))
    await waitFor(() => expect(mocks.abortWebPiSession).toHaveBeenCalledWith('workspace-manager', 'p1'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy()
  })
})
