// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionRecord, Workspace } from '../components/workspace/api'
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
  resumeSession: vi.fn(),
}))

vi.mock('../tabs/store', () => {
  const useWorkspace = Object.assign(
    (selector: (state: unknown) => unknown) => selector({
      openOrFocus: mocks.openOrFocus,
      closeTab: mocks.closeTab,
      setSidebar: mocks.setSidebar,
    }),
    { getState: () => ({ tabs: {} }) },
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
    resumeSession: mocks.resumeSession,
  }
})

vi.mock('../components/workspace/terminalTheme', () => ({
  useResolvedTerminalThemeVariant: () => 'dark',
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

function Probe() {
  const { openHeadlessRun } = useWorkspaces()
  return (
    <button type="button" onClick={() => void openHeadlessRun('research-desk', 'resume-headless')}>
      Continue
    </button>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listWorkspaces.mockResolvedValue([workspace()])
  mocks.listTemplates.mockResolvedValue([])
  mocks.listAgents.mockResolvedValue([])
  mocks.getWorkspaceDefaultAgent.mockResolvedValue(null)
  mocks.getIssueDefaultAgent.mockResolvedValue(null)
  mocks.openResumeSession.mockResolvedValue({ session: materializedSession() })
  mocks.resumeSession.mockResolvedValue(null)
})

afterEach(cleanup)

describe('WorkspacesProvider conversation routing', () => {
  it('opens a materialized headless Session on the Ask Alice surface', async () => {
    render(
      <WorkspacesProvider>
        <Probe />
      </WorkspacesProvider>,
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
})
