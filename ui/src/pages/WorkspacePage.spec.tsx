// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../i18n'
import type { Workspace } from '../components/workspace/api'
import { WorkspacePage } from './WorkspacePage'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  spawn: vi.fn(),
  openAgentConfig: vi.fn(),
  resumeSession: vi.fn(),
  openWebPiSession: vi.fn(),
  refresh: vi.fn(),
  workspaceViewProps: vi.fn(),
  workspaces: [] as Workspace[],
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: mocks.workspaces,
    defaultAgent: 'codex',
    agents: [{ id: 'codex', kind: 'agent' }, { id: 'pi', kind: 'agent' }],
    spawn: mocks.spawn,
    openAgentConfig: mocks.openAgentConfig,
    resumeSession: mocks.resumeSession,
    openWebPiSession: mocks.openWebPiSession,
    refresh: mocks.refresh,
  }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (
    selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown,
  ) => selector({ openOrFocus: mocks.openOrFocus }),
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
    expect(screen.getByTestId('workspace-view').getAttribute('data-label'))
      .toBe('Optical Networking Follow-up')
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
    expect(screen.getByTestId('workspace-view').getAttribute('data-label')).toBe('chat-jun30')
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
})
