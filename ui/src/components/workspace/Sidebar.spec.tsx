// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('groups secondary workspace actions behind a target-scoped More menu', async () => {
    const user = userEvent.setup()
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

    more.focus()
    await user.keyboard('{ArrowDown}')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename workspace' }))
    expect(onRenameWorkspace).toHaveBeenCalledWith(workspace.id, 'Research desk')

    more.focus()
    await user.keyboard('{ArrowDown}')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configure this workspace' }))
    expect(onConfigureWorkspace).toHaveBeenCalledWith(workspace.id)

    more.focus()
    await user.keyboard('{ArrowDown}')
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

  it('names destructive and lifecycle actions for their target session', async () => {
    const user = userEvent.setup()
    const onPause = vi.fn()
    const onDelete = vi.fn()
    const onSettings = vi.fn()
    const onArchive = vi.fn()
    const { rerender } = render(
      <SessionRow
        session={session}
        isActive={false}
        onSelect={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
        onDelete={onDelete}
        onArchive={onArchive}
        onSettings={onSettings}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop Review AAPL earnings' }))
    const more = screen.getByRole('button', { name: 'More actions for Review AAPL earnings' })
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    more.focus()
    await user.keyboard('{ArrowDown}')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings for Review AAPL earnings' }))
    expect(onSettings).toHaveBeenCalledOnce()

    more.focus()
    await user.keyboard('{ArrowDown}')
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete Review AAPL earnings' })
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
        onArchive={onArchive}
        onSettings={onSettings}
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

    const main = screen.getByRole('button', { name: 'Review AAPL earnings' })
    expect(main.getAttribute('aria-current')).toBe('page')
    expect(main.className).toContain('oa-session-row-main')
    expect(main.parentElement?.className).toContain('oa-session-row')
    expect(main.parentElement?.getAttribute('data-active')).toBe('true')
  })

  it('explains headless occupancy instead of swallowing Session clicks', () => {
    const onSelect = vi.fn()
    const onHeadlessBusy = vi.fn()
    const onResume = vi.fn()
    render(
      <SessionRow
        session={{ ...session, state: 'paused', pid: null, startedAt: null }}
        isActive={false}
        headlessOccupying
        onSelect={onSelect}
        onHeadlessBusy={onHeadlessBusy}
        onPause={vi.fn()}
        onResume={onResume}
        onDelete={vi.fn()}
      />,
    )

    const [title, play] = screen.getAllByRole('button', { name: 'Running · Review AAPL earnings' })
    fireEvent.click(title!)
    fireEvent.click(play!)
    expect(onHeadlessBusy).toHaveBeenCalledTimes(2)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onResume).not.toHaveBeenCalled()
  })

  it('archives a Session from the More menu instead of deleting the coworker', async () => {
    const user = userEvent.setup()
    const onArchive = vi.fn()
    render(
      <SessionRow
        session={{ ...session, state: 'paused', pid: null, startedAt: null }}
        isActive={false}
        canDelete={false}
        onSelect={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onDelete={vi.fn()}
        onArchive={onArchive}
      />,
    )

    const more = screen.getByRole('button', { name: 'More actions for Review AAPL earnings' })
    more.focus()
    await user.keyboard('{ArrowDown}')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive Review AAPL earnings' }))
    expect(onArchive).toHaveBeenCalledOnce()
  })

  it('ellipsizes long English and CJK titles without moving row actions', () => {
    const title = `${'市场扫描'.repeat(12)} and a very long English conversation title about overnight risk`
    render(
      <SessionRow
        session={{ ...session, state: 'paused', pid: null, startedAt: null, title }}
        displayTitle={title}
        subtitle="Issue"
        isActive={false}
        canDelete={false}
        onSelect={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const main = screen.getByRole('button', { name: title })
    expect(main.querySelector('.truncate')?.textContent).toBe(title)
    expect(screen.getByText('Issue').className).toContain('truncate')
    const resume = screen.getByRole('button', { name: `Resume ${title}` })
    expect(resume.className).toContain('oa-icon-action')
    expect(main.compareDocumentPosition(resume) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not offer Archive while an interactive Session is running', async () => {
    const user = userEvent.setup()
    const onArchive = vi.fn()
    render(
      <SessionRow
        session={session}
        isActive={false}
        canDelete={false}
        onSelect={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onDelete={vi.fn()}
        onArchive={onArchive}
      />,
    )

    const more = screen.getByRole('button', { name: 'More actions for Review AAPL earnings' })
    more.focus()
    await user.keyboard('{ArrowDown}')
    const archive = screen.getByRole('menuitem', { name: 'Archive Review AAPL earnings' })
    expect(archive.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(archive)
    expect(onArchive).not.toHaveBeenCalled()
  })
})
