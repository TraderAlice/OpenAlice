// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentInfo } from '../components/workspace/api'
import { i18n } from '../i18n'
import { AgentRuntimesSettingsPage } from './AgentRuntimesSettingsPage'

const mocks = vi.hoisted(() => ({
  saveQuickAccess: vi.fn(),
  refresh: vi.fn(),
  quickAccessIds: ['pi'] as string[],
  catalog: [
    {
      id: 'pi',
      displayName: 'Pi',
      kind: 'agent',
      installed: true,
      binPath: '/usr/bin/pi',
      capabilities: {
        parallelPerCwd: true,
        resumeLast: true,
        resumeById: true,
        transcriptDiscovery: 'none',
      },
    },
    {
      id: 'codex',
      displayName: 'Codex',
      kind: 'agent',
      installed: false,
      capabilities: {
        parallelPerCwd: true,
        resumeLast: true,
        resumeById: true,
        transcriptDiscovery: 'none',
      },
    },
    {
      id: 'claude',
      displayName: 'Claude Code',
      kind: 'agent',
      installed: true,
      capabilities: {
        parallelPerCwd: true,
        resumeLast: true,
        resumeById: true,
        transcriptDiscovery: 'none',
      },
    },
  ] as AgentInfo[],
}))

vi.mock('../hooks/useAgentRuntimes', () => ({
  useAgentRuntimes: () => ({
    catalog: mocks.catalog,
    primary: mocks.catalog.filter((agent) => mocks.quickAccessIds.includes(agent.id)),
    others: mocks.catalog.filter((agent) => !mocks.quickAccessIds.includes(agent.id)),
    installed: mocks.catalog.filter((agent) => agent.installed !== false),
    notInstalled: mocks.catalog.filter((agent) => agent.installed === false),
    readiness: {
      overallReady: true,
      checkedAt: '2026-08-18T00:00:00.000Z',
      agents: {
        pi: {
          agent: 'pi',
          displayName: 'Pi',
          installed: true,
          binPath: '/usr/bin/pi',
          status: 'ready',
          ready: true,
          source: 'global-login',
          checkedAt: '2026-08-18T00:00:00.000Z',
          durationMs: 9,
        },
        codex: {
          agent: 'codex',
          displayName: 'Codex',
          installed: false,
          binPath: null,
          status: 'not_installed',
          ready: false,
          source: 'unknown',
          checkedAt: '2026-08-18T00:00:00.000Z',
          durationMs: 1,
          repairTarget: 'runtime-install',
          message: 'Codex is not installed or not on PATH.',
        },
      },
    },
    quickAccessIds: mocks.quickAccessIds,
    recentAgentIds: [],
    loading: false,
    refreshing: false,
    error: null,
    refresh: mocks.refresh,
    saveQuickAccess: mocks.saveQuickAccess,
    recordSuccessfulUse: vi.fn(),
  }),
}))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  mocks.quickAccessIds = ['pi']
  mocks.saveQuickAccess.mockReset()
  mocks.refresh.mockReset()
  mocks.saveQuickAccess.mockResolvedValue(undefined)
  mocks.refresh.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('AgentRuntimesSettingsPage', () => {
  it('shows installed path, readiness, and ordered quick-access controls', async () => {
    render(<AgentRuntimesSettingsPage />)

    expect(screen.getByRole('heading', { name: 'Agent runtimes' })).toBeTruthy()
    expect(screen.getByText('/usr/bin/pi')).toBeTruthy()
    expect(screen.getAllByText(/Installed/).length).toBeGreaterThan(0)
    expect(screen.getByText('Install this CLI and make sure it is on PATH, then check again.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith())

    fireEvent.click(screen.getByRole('switch', { name: 'Add Claude Code to quick access' }))
    await waitFor(() => expect(mocks.saveQuickAccess).toHaveBeenCalledWith(['pi', 'claude']))
  })

  it('does not let an uninstalled runtime newly consume a pin slot', () => {
    render(<AgentRuntimesSettingsPage />)

    const addCodex = screen.getByRole('switch', {
      name: 'Codex is not installed, so it cannot be added to quick access.',
    })
    expect(addCodex.getAttribute('aria-checked')).toBe('false')
    expect(addCodex).toHaveProperty('disabled', true)
    fireEvent.click(addCodex)
    expect(mocks.saveQuickAccess).not.toHaveBeenCalled()
  })

  it('keeps a stale uninstalled pin visible so it can be removed', async () => {
    mocks.quickAccessIds = ['codex', 'pi']
    render(<AgentRuntimesSettingsPage />)

    const removeCodex = screen.getAllByRole('switch', { name: 'Remove Codex from quick access' })
    expect(removeCodex.length).toBeGreaterThan(0)
    fireEvent.click(removeCodex[0]!)
    await waitFor(() => expect(mocks.saveQuickAccess).toHaveBeenCalledWith(['pi']))
  })

  it('moves a pinned runtime without exceeding four slots', async () => {
    mocks.quickAccessIds = ['pi', 'claude']
    render(<AgentRuntimesSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Move Pi down' }))
    await waitFor(() => expect(mocks.saveQuickAccess).toHaveBeenCalledWith(['claude', 'pi']))
  })
})
