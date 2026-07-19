// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MANAGER_WORKSPACE_ID,
  type ManagerWorkspaceSnapshot,
  type SessionRecord,
  type Workspace,
} from '../components/workspace/api'
import { i18n } from '../i18n'
import { ToastProvider } from '../components/Toast'
import { useWorkspaces } from './workspaces-context'
import { WorkspacesProvider } from './WorkspacesContext'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  closeTab: vi.fn(),
  setSidebar: vi.fn(),
  listWorkspaces: vi.fn(),
  listTemplates: vi.fn(),
  listAgents: vi.fn(),
  getWorkspaceDefaultAgent: vi.fn(),
  getIssueDefaultAgent: vi.fn(),
  openResumeSession: vi.fn(),
  getWorkspaceManager: vi.fn(),
  pauseSession: vi.fn(),
  resumeSession: vi.fn(),
  openWebPiSession: vi.fn(),
  deleteSession: vi.fn(),
  getWorkspaceState: vi.fn(),
}))

vi.mock('../tabs/store', () => {
  const useWorkspace = Object.assign(
    (selector: (state: unknown) => unknown) => selector({
      openOrFocus: mocks.openOrFocus,
      closeTab: mocks.closeTab,
      setSidebar: mocks.setSidebar,
    }),
    { getState: () => mocks.getWorkspaceState() },
  )
  return { useWorkspace }
})

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return {
    ...actual,
    listWorkspaces: mocks.listWorkspaces,
    listTemplates: mocks.listTemplates,
    listAgents: mocks.listAgents,
    getWorkspaceDefaultAgent: mocks.getWorkspaceDefaultAgent,
    getIssueDefaultAgent: mocks.getIssueDefaultAgent,
    openResumeSession: mocks.openResumeSession,
    getWorkspaceManager: mocks.getWorkspaceManager,
    pauseSession: mocks.pauseSession,
    resumeSession: mocks.resumeSession,
    openWebPiSession: mocks.openWebPiSession,
    deleteSession: mocks.deleteSession,
  }
})

vi.mock('../components/workspace/terminalAppearance', () => ({
  useTerminalAppearance: () => ({
    mode: 'dark',
    theme: {},
    viewAttributes: { foreground: [255, 255, 255], background: [0, 0, 0] },
  }),
  publishTerminalViewAttributes: vi.fn().mockResolvedValue(true),
}))

vi.mock('../components/workspace/WorkspaceAIConfigModal', () => ({
  WorkspaceAIConfigModal: () => null,
}))

function workspace(): Workspace {
  return {
    id: 'research-desk',
    tag: 'research-desk',
    dir: '/tmp/research-desk',
    createdAt: '2026-07-16T00:00:00.000Z',
    template: 'auto-quant',
    agents: ['pi'],
    sessions: [],
  }
}

function materializedSession(): SessionRecord {
  return {
    id: 'pi-headless-follow-up',
    resumeId: 'resume-headless',
    wsId: 'research-desk',
    agent: 'pi',
    name: 'follow-up',
    createdAt: '2026-07-16T00:00:00.000Z',
    lastActiveAt: '2026-07-16T00:00:00.000Z',
    state: 'paused',
    surface: 'webpi',
    pid: null,
    startedAt: null,
    title: 'Headless research follow-up',
  }
}

function managerSession(): SessionRecord {
  return {
    id: 'opencode-manager-session',
    resumeId: 'resume-manager',
    wsId: MANAGER_WORKSPACE_ID,
    agent: 'opencode',
    name: 'o1',
    createdAt: '2026-07-16T00:00:00.000Z',
    lastActiveAt: '2026-07-16T00:00:00.000Z',
    state: 'paused',
    surface: 'terminal',
    pid: null,
    startedAt: null,
    title: 'Coordinate release owners',
  }
}

function managerSnapshot(): ManagerWorkspaceSnapshot {
  return {
    id: MANAGER_WORKSPACE_ID,
    tag: 'Workspace Manager',
    activeWorkspaceCount: 1,
    sessions: [managerSession()],
  }
}

function Probe() {
  const { openHeadlessRun } = useWorkspaces()
  return (
    <button type="button" onClick={() => void openHeadlessRun('research-desk', 'resume-headless')}>
      Continue
    </button>
  )
}

function ManagerProbe() {
  const {
    workspaceManager,
    pauseSession,
    resumeSession,
    openWebPiSession,
    requestDeleteSession,
  } = useWorkspaces()
  const session = workspaceManager?.sessions[0]
  if (!session) return <span>Loading manager</span>
  return (
    <div>
      <span>{session.title}</span>
      <button type="button" onClick={() => void pauseSession(MANAGER_WORKSPACE_ID, session.id)}>Pause manager</button>
      <button type="button" onClick={() => void resumeSession(MANAGER_WORKSPACE_ID, session.id)}>Resume manager</button>
      <button type="button" onClick={() => void openWebPiSession(MANAGER_WORKSPACE_ID, session.id)}>Open manager WebPi</button>
      <button type="button" onClick={() => requestDeleteSession(MANAGER_WORKSPACE_ID, session.id)}>Delete manager</button>
    </div>
  )
}

function SessionDeleteProbe() {
  const { requestDeleteSession } = useWorkspaces()
  return (
    <button type="button" onClick={() => requestDeleteSession('research-desk', 'pi-headless-follow-up')}>
      Delete focused session
    </button>
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.listWorkspaces.mockResolvedValue([workspace()])
  mocks.listTemplates.mockResolvedValue([])
  mocks.listAgents.mockResolvedValue([])
  mocks.getWorkspaceDefaultAgent.mockResolvedValue(null)
  mocks.getIssueDefaultAgent.mockResolvedValue(null)
  mocks.openResumeSession.mockResolvedValue({ session: materializedSession() })
  mocks.getWorkspaceManager.mockResolvedValue(managerSnapshot())
  mocks.pauseSession.mockResolvedValue(true)
  mocks.resumeSession.mockResolvedValue(null)
  mocks.openWebPiSession.mockResolvedValue({ pid: 43, startedAt: 3 })
  mocks.deleteSession.mockResolvedValue(true)
  mocks.getWorkspaceState.mockReturnValue({
    tabs: {},
    tree: {
      kind: 'leaf',
      group: { id: 'g1', tabIds: [], activeTabId: null },
    },
    focusedGroupId: 'g1',
    selectedSidebar: 'chat',
  })
})

afterEach(cleanup)

describe('WorkspacesProvider conversation routing', () => {
  it('opens a materialized headless Session on the Ask Alice surface', async () => {
    render(
      <ToastProvider>
        <WorkspacesProvider>
          <Probe />
        </WorkspacesProvider>
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: {
        wsId: 'research-desk',
        sessionId: 'pi-headless-follow-up',
        source: 'chat',
      },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('chat')
  })

  it('routes Manager lifecycle actions through the separate launcher-owned state', async () => {
    mocks.resumeSession.mockResolvedValue({ pid: 42, startedAt: 2 })
    render(
      <ToastProvider>
        <WorkspacesProvider>
          <ManagerProbe />
        </WorkspacesProvider>
      </ToastProvider>,
    )

    expect(await screen.findByText('Coordinate release owners')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Pause manager' }))
    await waitFor(() => expect(mocks.pauseSession).toHaveBeenCalledWith(
      MANAGER_WORKSPACE_ID,
      'opencode-manager-session',
    ))

    fireEvent.click(screen.getByRole('button', { name: 'Resume manager' }))
    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace-manager',
      params: { sessionId: 'opencode-manager-session' },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Open manager WebPi' }))
    await waitFor(() => expect(mocks.openWebPiSession).toHaveBeenCalledWith(
      MANAGER_WORKSPACE_ID,
      'opencode-manager-session',
    ))

    fireEvent.click(screen.getByRole('button', { name: 'Delete manager' }))
    expect(screen.getByText(/Delete "Coordinate release owners"/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.deleteSession).toHaveBeenCalledWith(
      MANAGER_WORKSPACE_ID,
      'opencode-manager-session',
    ))
  })

  it('lands a deleted focused Session on its Workspace Session library', async () => {
    const focusedSession = materializedSession()
    mocks.listWorkspaces.mockResolvedValue([{ ...workspace(), sessions: [focusedSession] }])
    mocks.getWorkspaceState.mockReturnValue({
      tabs: {
        'session-tab': {
          id: 'session-tab',
          spec: {
            kind: 'workspace',
            params: { wsId: 'research-desk', sessionId: focusedSession.id, source: 'chat' },
          },
        },
      },
      tree: {
        kind: 'leaf',
        group: { id: 'g1', tabIds: ['session-tab'], activeTabId: 'session-tab' },
      },
      focusedGroupId: 'g1',
      selectedSidebar: 'chat',
    })

    render(
      <ToastProvider>
        <WorkspacesProvider>
          <SessionDeleteProbe />
        </WorkspacesProvider>
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete focused session' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'research-desk', source: 'chat' },
    }))
    expect(mocks.closeTab).toHaveBeenCalledWith('session-tab')
  })
})
