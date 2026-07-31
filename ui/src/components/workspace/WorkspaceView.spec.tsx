// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import type { SessionRecord } from './api'
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
vi.mock('./WebPiView', () => ({ WebPiView: () => null }))

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

describe('WorkspaceView Session library', () => {
  it('keeps a large Workspace searchable and routes running and paused rows correctly', () => {
    const onSpawnFresh = vi.fn()
    const onResume = vi.fn()
    const onSelectSession = vi.fn()
    const sessions = Array.from({ length: 12 }, (_, offset) => (
      session(offset + 1, offset % 3 === 0 ? 'running' : 'paused')
    ))

    render(
      <WorkspaceView
        wsId="chat-1"
        sessionId={null}
        activeRecord={null}
        sessions={sessions}
        onSpawnFresh={onSpawnFresh}
        onResume={onResume}
        onOpenWebPi={vi.fn()}
        onSelectSession={onSelectSession}
        onSessionLost={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy()
    expect(screen.getByText('12', { selector: '.workspace-session-library-count' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^(Open|Resume) Conversation/ })).toHaveLength(12)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), {
      target: { value: 'Conversation 10' },
    })
    expect(screen.getByRole('button', { name: 'Open Conversation 10' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resume Conversation 9' })).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Running: 4' }))
    const results = screen.getByRole('button', { name: 'Open Conversation 10' }).closest('.workspace-session-results')
    expect(results).toBeTruthy()
    expect(within(results as HTMLElement).getAllByRole('button')).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: 'Open Conversation 10' }))
    expect(onSelectSession).toHaveBeenCalledWith('session-10')

    fireEvent.click(screen.getByRole('button', { name: 'Paused: 8' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume Conversation 12' }))
    expect(onResume).toHaveBeenCalledWith('session-12')

    fireEvent.click(screen.getByRole('button', { name: 'Start a new session' }))
    expect(onSpawnFresh).toHaveBeenCalledTimes(1)
  })
})

describe('WorkspaceView Files panel', () => {
  const renderWorkspace = () => render(
    <WorkspaceView
      wsId="chat-1"
      sessionId={null}
      activeRecord={null}
      sessions={[]}
      onSpawnFresh={vi.fn()}
      onResume={vi.fn()}
      onOpenWebPi={vi.fn()}
      onSelectSession={vi.fn()}
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
        sessions={[]}
        onSpawnFresh={vi.fn()}
        onResume={vi.fn()}
        onOpenWebPi={vi.fn()}
        onSelectSession={vi.fn()}
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

describe('WorkspaceView terminal canvas', () => {
  it('gives a pinned terminal one shared Workspace and Session titlebar', () => {
    const activeRecord = session(2, 'running')
    const headerActions = <button type="button">Files</button>

    render(
      <WorkspaceView
        wsId="auto-quant"
        sessionId={activeRecord.id}
        activeRecord={activeRecord}
        sessions={[activeRecord]}
        label="AutoQuant"
        terminalHeaderActions={headerActions}
        onSpawnFresh={vi.fn()}
        onResume={vi.fn()}
        onOpenWebPi={vi.fn()}
        onSelectSession={vi.fn()}
        onSessionLost={vi.fn()}
      />,
    )

    expect(screen.getByTestId('terminal-view')).toBeTruthy()
    expect(viewMocks.terminalProps).toHaveBeenCalledWith(expect.objectContaining({
      label: 'AutoQuant',
      sessionLabel: 'Conversation 2',
      headerActions,
      chrome: 'canvas',
    }))
  })
})
