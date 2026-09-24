// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../i18n'
import type { Workspace } from '../components/workspace/api'
import { HarnessWorkbenchContext } from '../components/harness/context'
import { useSessionBusyDialog } from '../components/workspace/session-busy-store'
import { WorkspacePage } from './WorkspacePage'

const mocks = vi.hoisted(() => ({
  takeovers: null as any,
  openOrFocus: vi.fn(),
  closeMatching: vi.fn(),
  spawn: vi.fn(),
  openAgentConfig: vi.fn(),
  resumeSession: vi.fn(),
  openWebSession: vi.fn(),
  refresh: vi.fn(),
  workspaceViewProps: vi.fn(),
  workspaces: [] as Workspace[],
}))

vi.mock('../hooks/useSessionTakeovers', () => ({ useSessionTakeovers: () => mocks.takeovers, awaitingTakeover: (row: any) => row.state === 'pending' }))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: mocks.workspaces,
    defaultAgent: 'codex',
    agents: [{ id: 'codex', kind: 'agent' }, { id: 'pi', kind: 'agent', capabilities: { web: { wire: 'pi-rpc' } } }],
    spawn: mocks.spawn,
    openAgentConfig: mocks.openAgentConfig,
    resumeSession: mocks.resumeSession,
    openWebSession: mocks.openWebSession,
    refresh: mocks.refresh,
  }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: Object.assign((selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) => selector({ openOrFocus: mocks.openOrFocus }), {
    getState: () => ({ openOrFocus: mocks.openOrFocus, closeMatching: mocks.closeMatching,
      tree: { kind: 'leaf', group: { activeTabId: null } }, tabs: {} }),
  }),
}))

vi.mock('./ChatLandingPage', () => ({
  HarnessLandingPage: (props: { mode: string; spec: { params: { targetWsId: string } } }) =>
    <div data-testid="new-conversation" data-mode={props.mode} data-workspace={props.spec.params.targetWsId} />,
}))

vi.mock('../components/workspace/WorkspaceView', () => ({
  WorkspaceView: (props: { label?: string; terminalHeaderActions?: ReactNode }) => {
    mocks.workspaceViewProps(props)
    return (
      <div data-testid="workspace-view" data-label={props.label}>
        {props.terminalHeaderActions}
      </div>
    )
  },
}))

vi.mock('../components/workspace/WorkspaceFilesToggle', () => ({
  WorkspaceFilesToggle: () => <button type="button">Files</button>,
}))

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'chat-1',
    tag: 'chat-jun30',
    dir: '/tmp/chat-jun30',
    createdAt: '2026-06-30T00:00:00.000Z',
    sessions: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.takeovers = null
  mocks.workspaces = [workspace({ displayName: 'Optical Networking Follow-up' })]
})

afterEach(cleanup)

describe('WorkspacePage identity', () => {
  it('uses the Workspace runtime ahead of the installation fallback for a fresh Session', () => {
    mocks.workspaces = [workspace({ defaultAgent: 'pi' })]
    render(
      <WorkspacePage
        spec={{ kind: 'workspace', params: { wsId: 'chat-1' } }}
        visible
      />,
    )

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true, bubbles: true }))
    expect(mocks.spawn).toHaveBeenCalledWith('chat-1', { agent: 'pi' }, undefined)
  })

  it('keeps the user-defined Workspace name primary in the header and runtime label', () => {
    render(
      <WorkspacePage
        spec={{ kind: 'workspace', params: { wsId: 'chat-1' } }}
        visible
      />,
    )

    const workspaceName = screen.getByText('Optical Networking Follow-up')
    const identity = workspaceName.parentElement
    expect(identity?.getAttribute('title')).toBe('Optical Networking Follow-up\nchat-jun30')
    expect(identity?.textContent).toContain('Optical Networking Follow-up')
    expect(identity?.textContent).toContain('chat-jun30')
    expect(screen.getByTestId('new-conversation').getAttribute('data-workspace')).toBe('chat-1')
  })

  it('falls back to the stable tag when no display name is configured', () => {
    mocks.workspaces = [workspace({ displayName: '   ' })]

    render(
      <WorkspacePage
        spec={{ kind: 'workspace', params: { wsId: 'chat-1' } }}
        visible
      />,
    )

    expect(screen.getByTitle('chat-jun30').textContent).toBe('chat-jun30')
    expect(screen.getByTestId('new-conversation').getAttribute('data-workspace')).toBe('chat-1')
  })

  it.each(['chat', 'auto-quant', 'prediction'] as const)('uses the targeted %s composer when no Session is pinned', (source) => {
    render(<WorkspacePage spec={{ kind: 'workspace', params: { wsId: 'chat-1', source } }} visible />)
    const composer = screen.getByTestId('new-conversation')
    expect(composer.getAttribute('data-mode')).toBe(source)
    expect(composer.getAttribute('data-workspace')).toBe('chat-1')
    expect(screen.queryByTestId('workspace-view')).toBeNull()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('promotes Workspace actions into the running terminal canvas', () => {
    mocks.workspaces = [workspace({
      sessions: [{
        id: 'shell-session',
        resumeId: 'resume-shell',
        wsId: 'chat-1',
        agent: 'shell',
        name: 'sh1',
        createdAt: '2026-07-31T00:00:00.000Z',
        lastActiveAt: '2026-07-31T00:00:00.000Z',
        state: 'running',
        surface: 'terminal',
        pid: 42,
        startedAt: 42,
        title: null,
      }],
    })]

    const { container } = render(
      <WorkspacePage
        spec={{ kind: 'workspace', params: { wsId: 'chat-1', sessionId: 'shell-session' } }}
        visible
      />,
    )

    expect(container.querySelector('.workspace-page-shell')?.classList.contains('is-terminal-canvas'))
      .toBe(true)
    expect(screen.getByRole('button', { name: 'Files' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    expect(mocks.workspaceViewProps).toHaveBeenCalledWith(expect.objectContaining({
      terminalHeaderActions: expect.anything(),
    }))
  })

  it('lets a paused TUI handoff own the pane without removing the page header', () => {
    mocks.workspaces = [workspace({
      displayName: 'Optical Networking Follow-up',
      sessions: [{
        id: 'paused-session',
        resumeId: 'resume-paused',
        wsId: 'chat-1',
        agent: 'codex',
        name: 'x4',
        createdAt: '2026-07-31T00:00:00.000Z',
        lastActiveAt: '2026-07-31T00:00:00.000Z',
        state: 'paused',
        surface: 'terminal',
        pid: null,
        startedAt: null,
        title: null,
      }],
    })]

    const { container } = render(
      <WorkspacePage
        spec={{ kind: 'workspace', params: { wsId: 'chat-1', sessionId: 'paused-session' } }}
        visible
      />,
    )

    const shell = container.querySelector('.workspace-page-shell')
    expect(shell?.classList.contains('is-paused-canvas')).toBe(true)
    expect(shell?.classList.contains('is-terminal-canvas')).toBe(false)
    expect(screen.getByText('Optical Networking Follow-up').parentElement?.getAttribute('title'))
      .toBe('Optical Networking Follow-up\nchat-jun30')
    expect(screen.getByRole('button', { name: 'Files' })).toBeTruthy()
  })
})

it('leaves only the panel entry in the Harness header', () => {
  render(<HarnessWorkbenchContext.Provider value={{ wsId: 'chat-1', open: false, toggle: vi.fn() }}>
    <WorkspacePage spec={{ kind: 'workspace', params: { wsId: 'chat-1', source: 'chat' } }} visible />
  </HarnessWorkbenchContext.Provider>)
  expect(screen.getByRole('button', { name: 'Files' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Web Beta' })).toBeNull()
})

it('offers GUI directly in the running TUI Harness header', () => {
  mocks.workspaces = [workspace({ sessions: [{ id: 'pi-one', resumeId: 'native-one', wsId: 'chat-1', agent: 'pi', name: 'p1', title: 'Research', state: 'running', surface: 'terminal', pid: 1, startedAt: 1, createdAt: '', lastActiveAt: '' }] })]
  render(<HarnessWorkbenchContext.Provider value={{ wsId: 'chat-1', open: false, toggle: vi.fn() }}>
    <WorkspacePage spec={{ kind: 'workspace', params: { wsId: 'chat-1', sessionId: 'pi-one', source: 'chat' } }} visible />
  </HarnessWorkbenchContext.Provider>)
  fireEvent.click(screen.getByRole('button', { name: 'GUI' }))
  expect(mocks.openWebSession).toHaveBeenCalledWith('chat-1', 'pi-one', 'chat')
})

it('replaces a background deep link with transient inspection instead of retaining a Session tab', () => {
  const record = { id: 'background', resumeId: 'resume-background', wsId: 'chat-1', agent: 'pi', name: 'p1', title: 'Research', state: 'running' as const, surface: 'headless' as const, pid: null, startedAt: 1, createdAt: '', lastActiveAt: '' }
  mocks.workspaces = [workspace({ sessions: [record] })]
  render(<WorkspacePage spec={{ kind: 'workspace', params: { wsId: 'chat-1', sessionId: 'background', source: 'chat' } }} visible />)
  expect(useSessionBusyDialog.getState().target?.record.id).toBe('background')
  const predicate = mocks.closeMatching.mock.calls[0]![0]
  expect(predicate({ kind: 'workspace', params: { wsId: 'chat-1', sessionId: 'background' } })).toBe(true)
  expect(predicate({ kind: 'workspace', params: { wsId: 'chat-1', sessionId: 'other' } })).toBe(false)
  expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'chat-landing', params: { targetWsId: 'chat-1' } })
  expect(mocks.resumeSession).not.toHaveBeenCalled()
  useSessionBusyDialog.getState().close()
})

it('keeps an already-open GUI mounted read-only through takeover instead of closing its tab', () => {
  const record = { id: 'pi-one', resumeId: 'native-one', wsId: 'chat-1', agent: 'pi', name: 'p1', title: 'Research', state: 'running' as const, surface: 'webpi' as const, pid: 1, startedAt: 1, createdAt: '', lastActiveAt: '' }
  mocks.workspaces = [workspace({ sessions: [record] })]
  mocks.takeovers = { requests: [], activity: vi.fn(), select: vi.fn() }
  const props = { spec: { kind: 'workspace' as const, params: { wsId: 'chat-1', sessionId: 'pi-one', source: 'chat' as const } }, visible: true }
  const view = render(<WorkspacePage {...props} />)
  mocks.takeovers.requests = [{ id: 'takeover', workspaceId: 'chat-1', recordId: 'pi-one', state: 'running', origin: { issueId: 'scan' } }]
  mocks.workspaces = [workspace({ sessions: [{ ...record, surface: 'headless' }] })]
  view.rerender(<WorkspacePage {...props} />)
  expect(mocks.workspaceViewProps.mock.lastCall?.[0]).toMatchObject({ readOnly: true, activeRecord: { surface: 'webpi' } })
  expect(mocks.closeMatching).not.toHaveBeenCalled()
  expect(mocks.resumeSession).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'TUI' })).toBeNull()
  mocks.takeovers.requests[0].state = 'completed'
  mocks.workspaces = [workspace({ sessions: [{ ...record, state: 'paused' }] })]
  view.rerender(<WorkspacePage {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Return to conversation' }))
  expect(mocks.openWebSession).toHaveBeenCalledWith('chat-1', 'pi-one', 'chat')
})
