// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import type { SessionRecord } from './api'
import { WorkspaceView } from './WorkspaceView'

vi.mock('../../live/use-is-desktop', () => ({ useIsDesktop: () => true }))
vi.mock('../../live/workspace-side-panels', () => ({
  useWorkspaceSidePanels: () => ({ files: false, autoHideMobile: true }),
}))
vi.mock('./FilesPanel', () => ({ FilesPanel: () => null }))
vi.mock('./Terminal', () => ({ TerminalView: () => null }))
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
