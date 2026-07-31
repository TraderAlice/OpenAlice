// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import type { Workspace } from './api'
import { OverviewCard } from './OverviewCard'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const workspace: Workspace = {
  id: 'research-desk',
  tag: 'research',
  displayName: 'Research desk',
  dir: '/tmp/research',
  createdAt: '2026-07-28T00:00:00.000Z',
  template: 'chat',
  spawnedFromVersion: '0.1.0',
  upgradeAvailable: { from: '0.1.0', to: '0.2.0' },
  agentOverride: {
    claude: false,
    codex: true,
    opencode: false,
    pi: false,
  },
  sessions: [
    {
      id: 'session-1',
      resumeId: 'resume-1',
      wsId: 'research-desk',
      agent: 'codex',
      name: 'x1',
      createdAt: '2026-07-28T00:00:00.000Z',
      lastActiveAt: '2026-07-28T00:01:00.000Z',
      state: 'running',
      pid: 42,
      startedAt: 1,
      title: 'Investigate the market',
    },
  ],
}

describe('OverviewCard', () => {
  it('exposes native controls for the workspace and its sessions', () => {
    const onOpen = vi.fn()
    const onOpenSession = vi.fn()
    const onConfigure = vi.fn()
    const onUpgrade = vi.fn()
    render(
      <OverviewCard
        workspace={workspace}
        lastCommit={null}
        onOpen={onOpen}
        onOpenSession={onOpenSession}
        onConfigure={onConfigure}
        onUpgrade={onUpgrade}
      />,
    )

    const workspaceButton = screen.getByRole('button', { name: 'Research desk' })
    const sessionButton = screen.getByRole('button', { name: 'x1 running' })
    expect(workspaceButton.tagName).toBe('BUTTON')
    expect(sessionButton.tagName).toBe('BUTTON')
    workspaceButton.focus()
    expect(document.activeElement).toBe(workspaceButton)
    sessionButton.focus()
    expect(document.activeElement).toBe(sessionButton)

    fireEvent.click(screen.getByRole('button', { name: 'v0.2.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Workspace override · codex' }))
    expect(onUpgrade).toHaveBeenCalledTimes(1)
    expect(onConfigure).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.click(workspaceButton)
    fireEvent.click(sessionButton)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpenSession).toHaveBeenCalledWith('session-1')
  })

  it('keeps high-session workspaces compact while preserving recent drill-ins', () => {
    const onOpen = vi.fn()
    const onOpenSession = vi.fn()
    const manySessionWorkspace: Workspace = {
      ...workspace,
      sessions: Array.from({ length: 8 }, (_, index) => ({
        ...workspace.sessions[0]!,
        id: `session-${index + 1}`,
        resumeId: `resume-${index + 1}`,
        name: `x${index + 1}`,
        state: index === 0 ? 'running' : 'paused',
        lastActiveAt: `2026-07-28T00:${String(59 - index).padStart(2, '0')}:00.000Z`,
      })),
    }

    render(
      <OverviewCard
        workspace={manySessionWorkspace}
        lastCommit={null}
        onOpen={onOpen}
        onOpenSession={onOpenSession}
      />,
    )

    expect(screen.getAllByRole('button', { name: / (running|paused)$/ })).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'x5 paused' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'x6 paused' })).toBeNull()
    expect(screen.getByRole('button', { name: 'x1 running' }).className).toContain('min-h-10')
    expect(screen.getByRole('button', { name: 'x3 paused' }).closest('li')?.className)
      .toContain('hidden sm:list-item')

    const viewAll = screen.getByRole('button', { name: 'View all 8 sessions' })
    expect(viewAll.className).toContain('min-h-10')
    expect(viewAll.textContent).toContain('+6')
    expect(viewAll.textContent).toContain('+3')
    fireEvent.click(viewAll)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpenSession).not.toHaveBeenCalled()
  })

  it('offers a mobile-only View all path when the desktop preview still fits', () => {
    const threeSessionWorkspace: Workspace = {
      ...workspace,
      sessions: Array.from({ length: 3 }, (_, index) => ({
        ...workspace.sessions[0]!,
        id: `session-${index + 1}`,
        resumeId: `resume-${index + 1}`,
        name: `x${index + 1}`,
      })),
    }

    render(
      <OverviewCard
        workspace={threeSessionWorkspace}
        lastCommit={null}
        onOpen={() => undefined}
        onOpenSession={() => undefined}
      />,
    )

    const viewAll = screen.getByRole('button', { name: 'View all 3 sessions' })
    expect(viewAll.closest('li')?.className).toContain('sm:hidden')
    expect(viewAll.textContent).toContain('+1')
    expect(screen.getByRole('button', { name: 'x3 running' }).closest('li')?.className)
      .toContain('hidden sm:list-item')
  })
})
