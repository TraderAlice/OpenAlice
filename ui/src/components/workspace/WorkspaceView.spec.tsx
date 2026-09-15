// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import { getWorkspaceSessionDirectory, type SessionRecord } from './api'
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), getWorkspaceSessionDirectory: vi.fn(async () => ({ sessions: [] })) }))
import { WorkspaceView } from './WorkspaceView'

const viewMocks = vi.hoisted(() => ({
  isDesktop: true,
  terminalProps: vi.fn(),
  sidePrefs: {
    files: false,
    autoHideMobile: true,
    mobileFilesOpen: false,
  },
}))

vi.mock('../../live/use-is-desktop', () => ({ useIsDesktop: () => viewMocks.isDesktop }))
vi.mock('../../live/workspace-side-panels', () => ({
  useWorkspaceSidePanels: () => viewMocks.sidePrefs,
}))
vi.mock('./FilesPanel', () => ({ FilesPanel: () => <div data-testid="files-panel" /> }))
vi.mock('./Terminal', () => ({
  TerminalView: (props: unknown) => {
    viewMocks.terminalProps(props)
    return <div data-testid="terminal-view" />
  },
}))
vi.mock('./WebSessionView', () => ({ WebSessionView: () => null }))

function session(index: number, state: SessionRecord['state']): SessionRecord {
  return {
    id: `session-${index}`,
    resumeId: `resume-${index}`,
    wsId: 'chat-1',
    agent: index % 2 === 0 ? 'pi' : 'opencode',
    name: `p${index}`,
    createdAt: `2026-07-${String(index).padStart(2, '0')}T00:00:00.000Z`,
    lastActiveAt: `2026-07-${String(index).padStart(2, '0')}T12:00:00.000Z`,
    state,
    surface: 'terminal',
    pid: state === 'running' ? index : null,
    startedAt: state === 'running' ? index : null,
    title: `Conversation ${index}`,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  viewMocks.isDesktop = true
  viewMocks.sidePrefs.files = false
  viewMocks.sidePrefs.autoHideMobile = true
  viewMocks.sidePrefs.mobileFilesOpen = false
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('WorkspaceView Files panel', () => {
  const renderWorkspace = () => render(
    <WorkspaceView
      wsId="chat-1"
      sessionId={null}
      activeRecord={null}
      onResume={vi.fn()}
      onOpenWeb={vi.fn()}
      onSessionLost={vi.fn()}
    />,
  )

  it('uses the transient mobile state instead of the persisted desktop preference', () => {
    viewMocks.isDesktop = false
    viewMocks.sidePrefs.files = true

    const { container, rerender } = renderWorkspace()

    expect(screen.queryByTestId('files-panel')).toBeNull()
    expect(container.querySelector('.workspace-view')?.classList.contains('has-no-side')).toBe(true)

    viewMocks.sidePrefs.mobileFilesOpen = true
    rerender(
      <WorkspaceView
        wsId="chat-1"
        sessionId={null}
        activeRecord={null}
        onResume={vi.fn()}
        onOpenWeb={vi.fn()}
        onSessionLost={vi.fn()}
      />,
    )

    expect(screen.getByTestId('files-panel')).toBeTruthy()
    expect(container.querySelector('.workspace-view')?.classList.contains('has-no-side')).toBe(false)
  })

  it('follows the runtime Files disclosure state on desktop', () => {
    viewMocks.sidePrefs.files = true

    const { container } = renderWorkspace()

    expect(screen.getByTestId('files-panel')).toBeTruthy()
    expect(container.querySelector('.workspace-view')?.classList.contains('has-no-side')).toBe(false)
  })
})

describe('WorkspaceView paused Session recovery', () => {
  it('shows a failed resume and lets the user retry instead of staying on Opening', async () => {
    const paused: SessionRecord = {
      ...session(2, 'paused'),
      runtime: {
        credentialSource: 'vault',
        credentialSlug: 'deepseek-1',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
      },
    }
    const onResume = vi.fn(async () => { throw new Error('Pi CLI login is required') })

    render(
      <WorkspaceView
        wsId="chat-1"
        sessionId={paused.id}
        activeRecord={paused}
        onResume={onResume}
        onOpenWeb={vi.fn(async () => undefined)}
        onSessionLost={vi.fn()}
      />,
    )

    expect((await screen.findByRole('alert')).textContent).toContain('Pi CLI login is required')
    expect(onResume).toHaveBeenCalledOnce()
    expect(screen.queryByText('Session paused')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(onResume).toHaveBeenCalledTimes(2))

  })
})

describe('WorkspaceView terminal canvas', () => {
  it('gives a pinned terminal one shared Workspace and Session titlebar', () => {
    const activeRecord = session(2, 'running')
    const headerActions = <button type="button">Files</button>

    render(
      <WorkspaceView
        wsId="auto-quant"
        sessionId={activeRecord.id}
        activeRecord={activeRecord}
        label="AutoQuant"
        terminalHeaderActions={headerActions}
        onResume={vi.fn()}
        onOpenWeb={vi.fn()}
        onSessionLost={vi.fn()}
      />,
    )

    expect(screen.getByTestId('terminal-view')).toBeTruthy()
    expect(viewMocks.terminalProps).toHaveBeenCalledWith(expect.objectContaining({
      label: 'AutoQuant',
      sessionLabel: 'Conversation 2',
      headerActions,
    }))
  })
})
