// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WebPiSnapshot } from './api'
import { WebPiView } from './WebPiView'

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
})

afterEach(cleanup)

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
