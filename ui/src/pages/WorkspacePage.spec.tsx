// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../i18n'
import type { SessionRecord, Workspace } from '../components/workspace/api'
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
    agents: [{ id: 'codex', kind: 'native' }],
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
  WorkspaceView: (props: { label?: string; onTerminalStatusChange?: (status: string) => void }) => {
    mocks.workspaceViewProps(props)
    return <div data-testid="workspace-view" data-label={props.label} />
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

function runningSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'codex-1',
    resumeId: 'resume-1',
    wsId: 'chat-1',
    agent: 'codex',
    name: 'x1',
    title: 'Optical networking supplier map',
    createdAt: '2026-07-30T00:00:00.000Z',
    lastActiveAt: '2026-07-30T00:00:00.000Z',
    state: 'running',
    surface: 'terminal',
    pid: 42,
    startedAt: 42,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.workspaces = [workspace({ displayName: 'Optical Networking Follow-up' })]
})

afterEach(cleanup)

describe('WorkspacePage identity', () => {
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

  it('merges Workspace, research, and runtime status into one identity bar', () => {
    mocks.workspaces = [workspace({
      displayName: 'AutoQuant',
      sessions: [runningSession()],
    })]

    render(
      <WorkspacePage
        spec={{
          kind: 'workspace',
          params: { wsId: 'chat-1', sessionId: 'codex-1', source: 'auto-quant' },
        }}
        visible
      />,
    )

    expect(screen.getByText('AutoQuant')).toBeTruthy()
    expect(screen.getByText('Optical networking supplier map')).toBeTruthy()
    expect(screen.queryByText('x1')).toBeNull()
    expect(screen.getByLabelText('connecting')).toBeTruthy()
    expect(screen.getByTestId('workspace-view').parentElement?.classList.contains('p-3')).toBe(false)
  })
})
