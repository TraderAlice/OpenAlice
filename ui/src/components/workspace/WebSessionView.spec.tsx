// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentInfo, WebSessionSnapshot } from './api'
import { isWebSessionNearBottom, WebSessionView } from './WebSessionView'

const mocks = vi.hoisted(() => ({
  abortWebSession: vi.fn(),
  getWebSession: vi.fn(),
  promptWebSession: vi.fn(),
  respondWebSession: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    abortWebSession: mocks.abortWebSession,
    getWebSession: mocks.getWebSession,
    promptWebSession: mocks.promptWebSession,
    respondWebSession: mocks.respondWebSession,
  }
})

const agents: readonly AgentInfo[] = [
  {
    id: 'pi',
    displayName: 'Pi',
    capabilities: { parallelPerCwd: true, resumeLast: true, resumeById: true, transcriptDiscovery: 'none', web: { wire: 'pi-rpc', permissionPrompts: false, freshSession: true } },
  },
  {
    id: 'claude',
    displayName: 'Claude Code',
    capabilities: { parallelPerCwd: true, resumeLast: false, resumeById: true, transcriptDiscovery: 'fs-watch', web: { wire: 'claude-stream-json', permissionPrompts: true, freshSession: true } },
  },
]

function snapshot(phase: WebSessionSnapshot['phase'], overrides: Partial<WebSessionSnapshot> = {}): WebSessionSnapshot {
  return {
    recordId: 'p1',
    wsId: 'workspace-manager',
    resumeId: 'resume-pi',
    agent: 'pi',
    wire: 'pi-rpc',
    nativeSessionId: 'native-1',
    pid: 42,
    startedAt: 1,
    phase,
    messages: [],
    streamingMessage: null,
    requests: [],
    error: null,
    stderrTail: '',
    revision: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  mocks.getWebSession.mockResolvedValue(snapshot('compacting'))
  mocks.abortWebSession.mockResolvedValue(snapshot('idle'))
  mocks.promptWebSession.mockResolvedValue(snapshot('idle'))
  mocks.respondWebSession.mockResolvedValue(snapshot('working'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Web transcript scrolling', () => {
  it('distinguishes a reader browsing history from one following the tail', () => {
    expect(isWebSessionNearBottom({ scrollTop: 100, clientHeight: 300, scrollHeight: 1_000 } as HTMLElement)).toBe(false)
    expect(isWebSessionNearBottom({ scrollTop: 650, clientHeight: 300, scrollHeight: 1_000 } as HTMLElement)).toBe(true)
  })

  it('does not force history readers back to the bottom and offers an explicit jump', async () => {
    mocks.getWebSession.mockResolvedValue(snapshot('idle'))
    const { container } = render(
      <WebSessionView wsId="workspace-manager" sessionId="p1" onSessionLost={vi.fn()} />,
    )
    await waitFor(() => expect(mocks.getWebSession).toHaveBeenCalled())

    const scroller = container.querySelector('.conversation-messages') as HTMLDivElement
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
    mocks.getWebSession.mockImplementation(async () => current)
    const { container } = render(
      <WebSessionView wsId="workspace-manager" sessionId="p1" onSessionLost={vi.fn()} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const scroller = container.querySelector('.conversation-messages') as HTMLDivElement
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

    expect(mocks.getWebSession).toHaveBeenCalledTimes(2)
    expect(scroller.scrollTo).toHaveBeenCalledTimes(scrollCallsBeforeUpdate)
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy()
  })
})

describe('Web composer keyboard submission', () => {
  it('does not let a late response from the previous session replace the selected one', async () => {
    let resolvePrevious!: (value: WebSessionSnapshot) => void
    mocks.getWebSession.mockImplementation((_workspace: string, id: string) => id === 'old'
      ? new Promise<WebSessionSnapshot>((resolve) => { resolvePrevious = resolve })
      : Promise.resolve(snapshot('idle', { recordId: 'new', messages: [{ role: 'user', content: 'New conversation' }] })))
    const { rerender } = render(<WebSessionView wsId="workspace-manager" sessionId="old" onSessionLost={vi.fn()} />)
    rerender(<WebSessionView wsId="workspace-manager" sessionId="new" onSessionLost={vi.fn()} />)
    expect(await screen.findByText('New conversation')).toBeTruthy()
    await act(async () => { resolvePrevious(snapshot('idle', { messages: [{ role: 'user', content: 'Old conversation' }] })) })
    expect(screen.queryByText('Old conversation')).toBeNull()
  })

  it('uses the shared content-sized textarea so multiline prompts grow until the CSS cap', async () => {
    mocks.getWebSession.mockResolvedValue(snapshot('idle'))
    render(
      <WebSessionView wsId="workspace-manager" sessionId="p1" agents={agents} onSessionLost={vi.fn()} />,
    )

    const composer = await screen.findByPlaceholderText('Message Pi…')
    expect(composer.getAttribute('data-slot')).toBe('textarea')
    expect(composer.className).toContain('field-sizing-content')
    expect(composer.getAttribute('rows')).toBe('1')
  })

  it('does not submit when Enter confirms an IME composition candidate', async () => {
    mocks.getWebSession.mockResolvedValue(snapshot('idle'))
    render(
      <WebSessionView wsId="workspace-manager" sessionId="p1" onSessionLost={vi.fn()} />,
    )

    const composer = await screen.findByPlaceholderText('Message Pi…')
    fireEvent.change(composer, { target: { value: '继续检查' } })

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: true })
    expect(mocks.promptWebSession).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: false })
    await waitFor(() => expect(mocks.promptWebSession).toHaveBeenCalledWith(
      'workspace-manager',
      'p1',
      '继续检查',
    ))
  })
})

describe('WebSessionView runtime identity', () => {
  it('labels the composer and stop action after the Session runtime, not Pi', async () => {
    mocks.getWebSession.mockResolvedValue(snapshot('working', { agent: 'claude', wire: 'claude-stream-json' }))
    render(
      <WebSessionView wsId="ws-1" sessionId="c1" agent="claude" agents={agents} onSessionLost={vi.fn()} />,
    )

    expect(await screen.findByRole('button', { name: 'Stop Claude Code' })).toBeTruthy()
    expect(screen.getByTitle('Claude Code stream-json over stdio')).toBeTruthy()
    expect(screen.queryByText(/Message Pi/)).toBeNull()
  })

  it('renders runtime notices as neutral system remarks between turns', async () => {
    mocks.getWebSession.mockResolvedValue(snapshot('idle', {
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'notice', text: 'Turn stopped by the user.' },
      ],
    }))
    render(<WebSessionView wsId="ws-1" sessionId="c1" onSessionLost={vi.fn()} />)

    const note = await screen.findByRole('note')
    expect(note.textContent).toBe('Turn stopped by the user.')
  })
})

describe('WebSessionView compaction state', () => {
  it('explains the pause and keeps the stop action available while the runtime compacts', async () => {
    render(
      <WebSessionView
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
    await waitFor(() => expect(mocks.abortWebSession).toHaveBeenCalledWith('workspace-manager', 'p1'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy()
  })
})

describe('WebSessionView permission requests', () => {
  const awaiting = () => snapshot('awaiting-input', {
    agent: 'claude',
    wire: 'claude-stream-json',
    messages: [{ role: 'user', content: 'check the notes' }],
    streamingMessage: {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'req-1', name: 'Read', arguments: { file_path: 'research/notes.md' } }],
    },
    requests: [{
      id: 'req-1',
      kind: 'permission',
      title: 'Allow Read?',
      description: 'Claude wants to read a file.',
      tool: { name: 'Read', input: { file_path: 'research/notes.md' } },
      options: [
        { id: 'allow', label: 'Allow', tone: 'allow' },
        { id: 'deny', label: 'Deny', tone: 'deny' },
      ],
      createdAt: 1,
    }],
  })

  it('pins the runtime question above the composer with its options and tool detail', async () => {
    mocks.getWebSession.mockResolvedValue(awaiting())
    render(<WebSessionView wsId="ws-1" sessionId="c1" agents={agents} onSessionLost={vi.fn()} />)

    const card = await screen.findByRole('group', { name: 'Allow Read?' })
    expect(card.textContent).toContain('Permission needed')
    expect(card.textContent).toContain('Claude wants to read a file.')
    expect(card.textContent).toContain('research/notes.md')
    expect(screen.getByText('waiting for you')).toBeTruthy()
    // The turn is still in flight: stop stays available, a new prompt is not the way forward.
    expect(screen.getByRole('button', { name: 'Stop Claude Code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
  })

  it('answers with the chosen option id and adopts the returned snapshot', async () => {
    mocks.getWebSession.mockResolvedValue(awaiting())
    mocks.respondWebSession.mockResolvedValue(snapshot('working', { agent: 'claude', wire: 'claude-stream-json', revision: 2 }))
    render(<WebSessionView wsId="ws-1" sessionId="c1" agents={agents} onSessionLost={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(mocks.respondWebSession).toHaveBeenCalledWith('ws-1', 'c1', 'req-1', 'deny', undefined))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Allow Read?' })).toBeNull())
  })

  it('keeps the card and surfaces the failure when the answer is rejected', async () => {
    mocks.getWebSession.mockResolvedValue(awaiting())
    mocks.respondWebSession.mockRejectedValue(new Error('no pending request req-1'))
    render(<WebSessionView wsId="ws-1" sessionId="c1" agents={agents} onSessionLost={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect((await screen.findByRole('alert')).textContent).toBe('no pending request req-1')
    expect(screen.getByRole('group', { name: 'Allow Read?' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Allow' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows how many further requests wait behind the active one', async () => {
    const base = awaiting()
    mocks.getWebSession.mockResolvedValue({
      ...base,
      requests: [...base.requests, { ...base.requests[0]!, id: 'req-2', title: 'Allow Bash?' }],
    })
    render(<WebSessionView wsId="ws-1" sessionId="c1" agents={agents} onSessionLost={vi.fn()} />)

    const card = await screen.findByRole('group', { name: 'Allow Read?' })
    expect(card.textContent).toContain('+1 more')
    expect(screen.queryByRole('group', { name: 'Allow Bash?' })).toBeNull()
  })
})


it('submits a free-text question answer through the conversation hook', async () => {
  mocks.getWebSession.mockResolvedValue(snapshot('awaiting-input', {
    agent: 'codex', wire: 'codex-app-server',
    requests: [{ id: 'q1', kind: 'question', title: 'Project name', options: [], allowText: true, createdAt: 1 }],
  }))
  render(<WebSessionView wsId="workspace-manager" sessionId="p1" onSessionLost={() => {}} />)
  const field = await screen.findByLabelText('Your answer')
  fireEvent.change(field, { target: { value: 'Alice research' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
  await waitFor(() => expect(mocks.respondWebSession).toHaveBeenCalledWith('workspace-manager', 'p1', 'q1', '', 'Alice research'))
})
