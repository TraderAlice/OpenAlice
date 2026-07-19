import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspacesContext, type WorkspacesContextValue } from '../../contexts/workspaces-context'
import { i18n } from '../../i18n'
import {
  MANAGER_WORKSPACE_ID,
  type ManagerWorkspaceSnapshot,
  type SessionRecord,
  type TemplateInfo,
  type Workspace,
} from './api'
import { ChatWorkspaceSection } from './ChatWorkspaceSection'

const actions = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  pauseSession: vi.fn(async () => undefined),
  resumeSession: vi.fn(async () => undefined),
  openWebPiSession: vi.fn(async () => undefined),
  requestDeleteSession: vi.fn(),
}))
const { openOrFocus } = actions

vi.mock('../../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof openOrFocus }) => unknown) =>
    selector({ openOrFocus }),
}))

vi.mock('../../tabs/types', () => ({
  getFocusedTab: () => null,
}))

const chatTemplate: TemplateInfo = {
  name: 'chat',
  defaultAgents: ['pi'],
  version: '1.0.0',
  hasReadme: true,
}

const chatWorkspace: Workspace = {
  id: 'chat-1',
  tag: 'chat-jul11',
  dir: '/tmp/chat-jul11',
  createdAt: '2026-07-11T00:00:00.000Z',
  template: 'chat',
  agents: ['pi'],
  sessions: [],
}

function chatSession(index: number): SessionRecord {
  return {
    id: `chat-session-${index}`,
    resumeId: `chat-resume-${index}`,
    wsId: chatWorkspace.id,
    agent: 'pi',
    name: `p${index}`,
    createdAt: `2026-07-${String(index).padStart(2, '0')}T00:00:00.000Z`,
    lastActiveAt: `2026-07-${String(index).padStart(2, '0')}T12:00:00.000Z`,
    state: 'paused',
    surface: 'terminal',
    pid: null,
    startedAt: null,
    title: `Conversation ${index}`,
  }
}

function workspaceContext(
  workspaces: readonly Workspace[],
  workspaceManager: ManagerWorkspaceSnapshot | null = null,
): WorkspacesContextValue {
  return {
    workspaces,
    templates: [chatTemplate],
    agents: [],
    defaultAgent: 'pi',
    issueDefaultAgent: null,
    listError: null,
    workspaceManager,
    workspaceManagerLoaded: true,
    workspaceManagerError: null,
    hasLoaded: true,
    templatesLoaded: true,
    refresh: vi.fn(),
    refreshWorkspaceManager: vi.fn(async () => undefined),
    quickStartWorkspaceManager: vi.fn(async () => { throw new Error('not used') }),
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: vi.fn(async () => undefined),
    setIssueDefaultAgent: vi.fn(async () => undefined),
    quickChat: vi.fn(async () => 'session-1'),
    pauseSession: actions.pauseSession,
    resumeSession: actions.resumeSession,
    openWebPiSession: actions.openWebPiSession,
    requestDeleteSession: actions.requestDeleteSession,
    openAgentConfig: vi.fn(),
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
  }
}

function renderSection(
  workspaces: readonly Workspace[] = [chatWorkspace],
  workspaceManager: ManagerWorkspaceSnapshot | null = null,
) {
  return render(
    <WorkspacesContext.Provider value={workspaceContext(workspaces, workspaceManager)}>
      <ChatWorkspaceSection />
    </WorkspacesContext.Provider>,
  )
}

beforeEach(async () => {
  for (const mock of Object.values(actions)) mock.mockClear()
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('ChatWorkspaceSection actions', () => {
  it('keeps conversation creation primary and scopes workspace creation to the workspace list', () => {
    renderSection()

    const newChat = screen.getByRole('button', { name: 'New chat' })
    const newWorkspace = screen.getByRole('button', { name: 'New workspace' })
    const workspaceHeading = screen.getByText('Workspaces', { selector: 'span' })
    const workspaceButton = screen.getByRole('button', { name: chatWorkspace.tag })
    const newSession = screen.getByRole('button', { name: 'New conversation in this workspace' })

    expect(newChat.className).toContain('w-full')
    expect(newChat.textContent).toBe('New chat')
    expect(newChat.querySelector('.lucide-message-square-plus')).toBeTruthy()
    expect(workspaceHeading.parentElement?.nextElementSibling?.contains(newWorkspace)).toBe(true)
    expect(newWorkspace.className).toContain('w-full')
    expect(newWorkspace.textContent).toBe('New workspace')
    expect(newWorkspace.querySelector('.lucide-panels-top-left')).toBeTruthy()
    expect(newSession.querySelector('.lucide-message-square-plus')).toBeTruthy()

    fireEvent.click(newChat)
    expect(openOrFocus).toHaveBeenCalledWith({ kind: 'chat-landing', params: {} })

    fireEvent.click(workspaceButton)
    expect(openOrFocus).toHaveBeenLastCalledWith({
      kind: 'chat-landing',
      params: { targetWsId: chatWorkspace.id },
    })

    fireEvent.click(newSession)
    expect(openOrFocus).toHaveBeenLastCalledWith({
      kind: 'chat-landing',
      params: { targetWsId: chatWorkspace.id },
    })
  })

  it('keeps an explicit workspace action in the empty state', () => {
    renderSection([])

    expect(screen.getByText(i18n.t('chat.noChatWorkspacesYet'))).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'New workspace' })).toHaveLength(2)
  })

  it('bounds expanded Workspace history and routes the full catalog to the Session library', () => {
    const sessions = Array.from({ length: 9 }, (_, index) => chatSession(index + 1))
    renderSection([{ ...chatWorkspace, sessions }])

    expect(screen.getAllByRole('button', { name: /^Conversation/ })).toHaveLength(6)
    expect(screen.queryByRole('button', { name: 'Conversation 3' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'View all 9 sessions' }))
    expect(openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: chatWorkspace.id, source: 'chat' },
    })
  })

  it('owns Manager Session navigation and lifecycle actions under the Manager entry', () => {
    const manager: ManagerWorkspaceSnapshot = {
      id: MANAGER_WORKSPACE_ID,
      tag: 'Workspace Manager',
      activeWorkspaceCount: 2,
      sessions: [
        {
          id: 'manager-opencode',
          wsId: MANAGER_WORKSPACE_ID,
          agent: 'opencode',
          name: 'o1',
          createdAt: '2026-07-16T00:00:00.000Z',
          lastActiveAt: '2026-07-16T00:02:00.000Z',
          state: 'running',
          surface: 'terminal',
          resumeId: 'resume-opencode',
          pid: 42,
          startedAt: 1,
          title: 'Inspect the floor',
        },
        {
          id: 'manager-pi',
          wsId: MANAGER_WORKSPACE_ID,
          agent: 'pi',
          name: 'p1',
          createdAt: '2026-07-16T00:00:00.000Z',
          lastActiveAt: '2026-07-16T00:01:00.000Z',
          state: 'paused',
          surface: 'webpi',
          resumeId: 'resume-pi',
          pid: null,
          startedAt: null,
          title: 'Coordinate owners',
        },
      ],
    }

    renderSection([], manager)

    const managerButton = screen.getByRole('button', { name: 'Workspace Manager' })
    const managerSection = managerButton.parentElement?.parentElement
    expect(managerSection).toBeTruthy()
    const managerUi = within(managerSection as HTMLElement)

    expect(managerUi.queryByRole('button', { name: 'Inspect the floor' })).toBeNull()
    fireEvent.click(managerUi.getByRole('button', { name: 'Expand sessions' }))

    const runningSession = managerUi.getByRole('button', { name: 'Inspect the floor' })
    const pausedSession = managerUi.getByRole('button', { name: 'Coordinate owners' })

    fireEvent.click(runningSession)
    expect(openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace-manager',
      params: { sessionId: 'manager-opencode' },
    })

    fireEvent.click(managerUi.getByRole('button', { name: 'Stop this session' }))
    expect(actions.pauseSession).toHaveBeenCalledWith(MANAGER_WORKSPACE_ID, 'manager-opencode')

    fireEvent.click(managerUi.getByRole('button', { name: 'Resume this session' }))
    expect(actions.openWebPiSession).toHaveBeenCalledWith(MANAGER_WORKSPACE_ID, 'manager-pi')

    const pausedRow = pausedSession.parentElement
    expect(pausedRow).toBeTruthy()
    fireEvent.click(within(pausedRow as HTMLElement).getByRole('button', { name: 'Delete this session' }))
    expect(actions.requestDeleteSession).toHaveBeenCalledWith(MANAGER_WORKSPACE_ID, 'manager-pi')

    fireEvent.click(managerUi.getByRole('button', { name: 'Collapse sessions' }))
    expect(managerUi.queryByRole('button', { name: 'Inspect the floor' })).toBeNull()
  })
})
