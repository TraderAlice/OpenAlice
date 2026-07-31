// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import type { AgentInfo, SessionRecord, Workspace } from './api'
import { SessionRow, WorkspaceRow } from './Sidebar'

const capabilities = {
  parallelPerCwd: true,
  resumeLast: true,
  resumeById: true,
  transcriptDiscovery: 'none' as const,
}

const agents: readonly AgentInfo[] = [
  { id: 'pi', displayName: 'Pi', kind: 'agent', capabilities },
  { id: 'shell', displayName: 'Shell', kind: 'utility', capabilities },
]

const workspace: Workspace = {
  id: 'workspace-1',
  tag: 'chat',
  dir: '/tmp/chat',
  createdAt: '2026-07-15T00:00:00.000Z',
  sessions: [],
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WorkspaceRow session launcher', () => {
  it('keeps the default runtime one click away while the full runtime menu remains discoverable', () => {
    const onSpawn = vi.fn()
    render(
      <WorkspaceRow
        workspace={workspace}
        agents={agents}
        defaultAgent="pi"
        selection={null}
        onSelectWorkspace={vi.fn()}
        onSelectSession={vi.fn()}
        onSpawn={onSpawn}
        onOpenHeadlessRun={vi.fn()}
        onPauseSession={vi.fn()}
        onResumeSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Spawn a new Pi session' }))
    expect(onSpawn).toHaveBeenCalledWith(workspace.id, { agent: 'pi' })

    fireEvent.click(screen.getByRole('button', { name: 'Choose runtime for new session' }))
    expect(screen.getByRole('menuitem', { name: 'Shell (sh)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Shell (sh)' }))

    expect(onSpawn).toHaveBeenLastCalledWith(workspace.id, { agent: 'shell' })
  })

  it('uses the primary plus button as the chooser when no default runtime exists', () => {
    render(
      <WorkspaceRow
        workspace={workspace}
        agents={agents}
        defaultAgent={null}
        selection={null}
        onSelectWorkspace={vi.fn()}
        onSelectSession={vi.fn()}
        onSpawn={vi.fn()}
        onOpenHeadlessRun={vi.fn()}
        onPauseSession={vi.fn()}
        onResumeSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Choose runtime for new session' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Spawn a new session…' }))
    expect(screen.getByRole('menuitem', { name: 'Shell (sh)' })).toBeTruthy()
  })

  it('groups secondary workspace actions behind a target-scoped More menu', () => {
    const onRenameWorkspace = vi.fn()
    const onConfigureWorkspace = vi.fn()
    const onDelete = vi.fn(async () => undefined)
    vi.spyOn(window, 'prompt').mockReturnValue('Research desk')
    render(
      <WorkspaceRow
        workspace={workspace}
        agents={[]}
        defaultAgent={null}
        selection={{ wsId: workspace.id, sessionId: null }}
        onSelectWorkspace={vi.fn()}
        onSelectSession={vi.fn()}
        onSpawn={vi.fn()}
        onOpenHeadlessRun={vi.fn()}
        onPauseSession={vi.fn()}
        onResumeSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onDelete={onDelete}
        onRenameWorkspace={onRenameWorkspace}
        onConfigureWorkspace={onConfigureWorkspace}
      />,
    )

    expect(screen.getByTitle('chat').getAttribute('aria-current')).toBe('page')
    const more = screen.getByRole('button', { name: 'More actions for chat' })
    expect(more.className).not.toContain('opacity-0')

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename workspace' }))
    expect(onRenameWorkspace).toHaveBeenCalledWith(workspace.id, 'Research desk')

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configure this workspace' }))
    expect(onConfigureWorkspace).toHaveBeenCalledWith(workspace.id)

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offboard workspace' }))
    expect(onDelete).toHaveBeenCalledWith(workspace.id)
  })
})

describe('SessionRow actions', () => {
  const session: SessionRecord = {
    id: 'session-1',
    resumeId: 'resume-1',
    wsId: workspace.id,
    agent: 'pi',
    name: 'p1',
    createdAt: '2026-07-15T00:00:00.000Z',
    lastActiveAt: '2026-07-15T00:05:00.000Z',
    state: 'running',
    pid: 123,
    startedAt: 1,
    title: 'Review AAPL earnings',
  }

  it('names destructive and lifecycle actions for their target session', () => {
    const onPause = vi.fn()
    const onDelete = vi.fn()
    const { rerender } = render(
      <SessionRow
        session={session}
        isActive={false}
        onSelect={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
        onDelete={onDelete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop Review AAPL earnings' }))
    const more = screen.getByRole('button', { name: 'More actions for Review AAPL earnings' })
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(more)
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete Review AAPL earnings' })
    expect(document.activeElement).toBe(deleteItem)
    fireEvent.click(deleteItem)
    expect(onPause).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()

    const onResume = vi.fn()
    rerender(
      <SessionRow
        session={{ ...session, state: 'paused', pid: null, startedAt: null, title: null }}
        isActive={false}
        onSelect={vi.fn()}
        onPause={vi.fn()}
        onResume={onResume}
        onDelete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Resume p1' }))
    expect(onResume).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'More actions for p1' })).toBeTruthy()
  })

  it('marks the active session as the current page', () => {
    render(
      <SessionRow
        session={session}
        isActive
        onSelect={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Review AAPL earnings' }).getAttribute('aria-current')).toBe('page')
  })
})
