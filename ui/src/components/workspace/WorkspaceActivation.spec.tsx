// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../Toast'
import { WorkspacesProvider } from '../../contexts/WorkspacesContext'
import { WorkspacesContext, useWorkspaces, type WorkspacesContextValue } from '../../contexts/workspaces-context'
import { i18n } from '../../i18n'
import type { Workspace, WorkspaceActivationPreview, WorkspaceActivationResult } from './api'
import { OverviewCard } from './OverviewCard'
import { StandbyWorkspaceBanner } from './StandbyWorkspaceBanner'
import { WorkspaceActivationBadge } from './WorkspaceActivationBadge'

const apiMocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn<() => Promise<Workspace[]>>(),
  listTemplates: vi.fn(async () => []),
  getWorkspaceManager: vi.fn(async () => ({ id: 'workspace-manager', tag: 'manager', activeWorkspaceCount: 0, sessions: [] })),
  getWorkspaceDefaultAgent: vi.fn(async () => null),
  getIssueDefaultAgent: vi.fn(async () => null),
  getAutoQuantDefaultWorkspace: vi.fn(async () => ({ defaultWorkspaceId: null, ready: false })),
  getAutoPredictionDefaultWorkspace: vi.fn(async () => ({ defaultWorkspaceId: null, ready: false })),
  getWorkspaceActivationPreview: vi.fn<(wsId: string) => Promise<WorkspaceActivationPreview>>(),
  activateWorkspace: vi.fn<(wsId: string) => Promise<WorkspaceActivationResult>>(),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    listWorkspaces: apiMocks.listWorkspaces,
    listTemplates: apiMocks.listTemplates,
    getWorkspaceManager: apiMocks.getWorkspaceManager,
    getWorkspaceDefaultAgent: apiMocks.getWorkspaceDefaultAgent,
    getIssueDefaultAgent: apiMocks.getIssueDefaultAgent,
    getAutoQuantDefaultWorkspace: apiMocks.getAutoQuantDefaultWorkspace,
    getAutoPredictionDefaultWorkspace: apiMocks.getAutoPredictionDefaultWorkspace,
    getWorkspaceActivationPreview: apiMocks.getWorkspaceActivationPreview,
    activateWorkspace: apiMocks.activateWorkspace,
  }
})

vi.mock('../../hooks/useAgentRuntimes', () => ({
  useAgentRuntimes: () => ({ agents: [] }),
}))

vi.mock('./terminalAppearance', () => ({
  useTerminalAppearance: () => ({ viewAttributes: {} }),
  publishTerminalViewAttributes: vi.fn(async () => undefined),
}))

const activeWorkspace: Workspace = {
  id: 'aq-active',
  tag: 'auto-quant-main',
  displayName: 'Main Quant',
  dir: '/tmp/aq-active',
  createdAt: '2026-07-01T00:00:00.000Z',
  template: 'auto-quant-v2',
  activationState: 'active',
  sessions: [],
}

const standbyWorkspace: Workspace = {
  id: 'aq-standby',
  tag: 'auto-quant-exp',
  displayName: 'Experimental Quant',
  dir: '/tmp/aq-standby',
  createdAt: '2026-07-10T00:00:00.000Z',
  template: 'auto-quant-v2',
  activationState: 'standby',
  sessions: [],
}

function mockContext(overrides: Partial<WorkspacesContextValue> = {}): WorkspacesContextValue {
  return {
    workspaces: [activeWorkspace, standbyWorkspace],
    templates: [],
    agents: [],
    defaultAgent: null,
    issueDefaultAgent: null,
    listError: null,
    workspaceManager: null,
    workspaceManagerLoaded: true,
    workspaceManagerError: null,
    hasLoaded: true,
    templatesLoaded: true,
    templatesError: null,
    autoQuantDefaultWorkspaceId: activeWorkspace.id,
    autoQuantPreferenceLoaded: true,
    autoQuantPreferenceError: null,
    activatingWorkspaceId: null,
    requestActivateWorkspace: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    refreshTemplates: vi.fn(async () => undefined),
    refreshAutoQuantPreference: vi.fn(async () => undefined),
    refreshWorkspaceManager: vi.fn(async () => undefined),
    quickStartWorkspaceManager: vi.fn(async () => { throw new Error('unused') }),
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: vi.fn(async () => undefined),
    setIssueDefaultAgent: vi.fn(async () => undefined),
    initializeAutoQuant: vi.fn(async () => activeWorkspace),
    initializeChat: vi.fn(async () => activeWorkspace),
    setAutoQuantDefaultWorkspace: vi.fn(async () => undefined),
    quickChat: vi.fn(async () => ''),
    pauseSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => undefined),
    openWebSession: vi.fn(async () => undefined),
    requestDeleteSession: vi.fn(),
    setSessionPresence: vi.fn(async () => undefined),
    setSessionDisplayName: vi.fn(async () => undefined),
    updateSessionRuntime: vi.fn(async () => undefined),
    openAgentConfig: vi.fn(),
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  apiMocks.listWorkspaces.mockResolvedValue([activeWorkspace, standbyWorkspace])
})

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('WorkspaceActivationBadge', () => {
  it('renders Active by default when activationState is active or undefined, and Standby when standby', async () => {
    const { rerender } = render(<WorkspaceActivationBadge workspace={{ activationState: undefined }} />)
    expect(screen.getByText('Active')).toBeTruthy()

    rerender(<WorkspaceActivationBadge workspace={{ activationState: 'active' }} />)
    expect(screen.getByText('Active')).toBeTruthy()

    rerender(<WorkspaceActivationBadge workspace={{ activationState: 'standby' }} />)
    expect(screen.getByText('Standby')).toBeTruthy()

    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    expect(screen.getByText('待命')).toBeTruthy()
  })
})

describe('OverviewCard activation actions', () => {
  it('shows Activate button on standby workspaces and does not open the card on click', () => {
    const onOpen = vi.fn()
    const onActivate = vi.fn()
    render(
      <OverviewCard
        workspace={standbyWorkspace}
        lastCommit={null}
        onOpen={onOpen}
        onOpenSession={vi.fn()}
        onActivate={onActivate}
      />,
    )

    expect(screen.getByText('Standby')).toBeTruthy()
    const activateButton = screen.getByRole('button', { name: 'Activate' })
    fireEvent.click(activateButton)
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('omits Activate button on active workspaces', () => {
    render(
      <OverviewCard
        workspace={activeWorkspace}
        lastCommit={null}
        onOpen={vi.fn()}
        onOpenSession={vi.fn()}
        onActivate={vi.fn()}
      />,
    )

    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
  })
})

describe('StandbyWorkspaceBanner', () => {
  it('renders nothing for active workspaces', () => {
    const ctx = mockContext()
    const { container } = render(
      <WorkspacesContext.Provider value={ctx}>
        <StandbyWorkspaceBanner workspace={activeWorkspace} />
      </WorkspacesContext.Provider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows Activate and Absorb actions for standby workspaces and wires them correctly', () => {
    const requestActivateWorkspace = vi.fn(async () => true)
    const openAgentConfig = vi.fn()
    const ctx = mockContext({ requestActivateWorkspace, openAgentConfig })

    render(
      <WorkspacesContext.Provider value={ctx}>
        <StandbyWorkspaceBanner workspace={standbyWorkspace} />
      </WorkspacesContext.Provider>,
    )

    expect(screen.getByTestId('standby-workspace-banner')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    expect(requestActivateWorkspace).toHaveBeenCalledWith(standbyWorkspace.id)

    fireEvent.click(screen.getByRole('button', { name: 'Absorb into active workspace' }))
    expect(openAgentConfig).toHaveBeenCalledWith(
      activeWorkspace.id,
      undefined,
      'absorb',
      standbyWorkspace.id,
    )
  })
})

describe('WorkspacesProvider activation confirmation flow', () => {
  function Trigger() {
    const { requestActivateWorkspace } = useWorkspaces()
    return (
      <button type="button" onClick={() => void requestActivateWorkspace?.(standbyWorkspace.id)}>
        Trigger Activate
      </button>
    )
  }

  it('shows confirmation dialog with issue/run counts before activating when currentActive has active work', async () => {
    apiMocks.getWorkspaceActivationPreview.mockResolvedValue({
      workspaceId: standbyWorkspace.id,
      template: 'auto-quant-v2',
      alreadyActive: false,
      currentActive: {
        id: activeWorkspace.id,
        tag: activeWorkspace.tag,
        displayName: activeWorkspace.displayName,
        openIssueCount: 3,
        scheduledIssueCount: 2,
        inFlightRunCount: 1,
      },
    })
    apiMocks.activateWorkspace.mockResolvedValue({
      workspace: { ...standbyWorkspace, activationState: 'active' },
      previousActiveId: activeWorkspace.id,
    })

    render(
      <ToastProvider>
        <WorkspacesProvider>
          <Trigger />
        </WorkspacesProvider>
      </ToastProvider>,
    )

    await waitFor(() => expect(apiMocks.listWorkspaces).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Activate' }))

    await waitFor(() => {
      expect(screen.getByText('Activate Experimental Quant?')).toBeTruthy()
    })
    expect(screen.getByText('3 open issues')).toBeTruthy()
    expect(screen.getByText('2 scheduled issues')).toBeTruthy()
    expect(screen.getByText('1 in-flight runs')).toBeTruthy()
    expect(apiMocks.activateWorkspace).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => {
      expect(apiMocks.activateWorkspace).toHaveBeenCalledWith(standbyWorkspace.id)
    })
  })

  it('activates immediately without confirmation when currentActive has zero open/scheduled issues and runs', async () => {
    apiMocks.getWorkspaceActivationPreview.mockResolvedValue({
      workspaceId: standbyWorkspace.id,
      template: 'auto-quant-v2',
      alreadyActive: false,
      currentActive: {
        id: activeWorkspace.id,
        tag: activeWorkspace.tag,
        displayName: activeWorkspace.displayName,
        openIssueCount: 0,
        scheduledIssueCount: 0,
        inFlightRunCount: 0,
      },
    })
    apiMocks.activateWorkspace.mockResolvedValue({
      workspace: { ...standbyWorkspace, activationState: 'active' },
      previousActiveId: activeWorkspace.id,
    })

    render(
      <ToastProvider>
        <WorkspacesProvider>
          <Trigger />
        </WorkspacesProvider>
      </ToastProvider>,
    )

    await waitFor(() => expect(apiMocks.listWorkspaces).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Activate' }))

    await waitFor(() => {
      expect(apiMocks.activateWorkspace).toHaveBeenCalledWith(standbyWorkspace.id)
    })
    expect(screen.queryByText('Activate Experimental Quant?')).toBeNull()
  })
})
