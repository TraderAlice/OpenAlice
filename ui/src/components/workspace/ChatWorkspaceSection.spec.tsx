// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    templatesError: null,
    autoQuantDefaultWorkspaceId: null,
    autoQuantPreferenceLoaded: true,
    autoQuantPreferenceError: null,
    refresh: vi.fn(),
    refreshTemplates: vi.fn(async () => undefined),
    refreshAutoQuantPreference: vi.fn(async () => undefined),
    refreshWorkspaceManager: vi.fn(async () => undefined),
    quickStartWorkspaceManager: vi.fn(async () => { throw new Error('not used') }),
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: vi.fn(async () => undefined),
    setIssueDefaultAgent: vi.fn(async () => undefined),
    initializeAutoQuant: vi.fn(async () => { throw new Error('not used') }),
    setAutoQuantDefaultWorkspace: vi.fn(async () => undefined),
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
  onNavigate?: () => void,
  displayMode: 'focused' | 'recent' | 'multi' = 'multi',
  onRequestDisplayMode: (mode: 'focused' | 'recent' | 'multi') => void = () => undefined,
) {
  return render(
    <WorkspacesContext.Provider value={workspaceContext(workspaces, workspaceManager)}>
      <ChatWorkspaceSection
        onNavigate={onNavigate}
        displayMode={displayMode}
        onRequestDisplayMode={onRequestDisplayMode}
      />
    </WorkspacesContext.Provider>,
  )
}

beforeEach(async () => {
  for (const mock of Object.values(actions)) mock.mockClear()
  window.localStorage.clear()
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('ChatWorkspaceSection actions', () => {
  it('keeps one durable Workspace focused and starts new conversations inside it', () => {
    const sessions = [chatSession(1), chatSession(2)]
    const focusedWorkspace = { ...chatWorkspace, sessions }
    const onNavigate = vi.fn()

    renderSection([focusedWorkspace], null, onNavigate, 'focused')

    expect(screen.getByText('Recent conversations')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Chat context: chat-jul11' })).toBeTruthy()
    expect(screen.queryByText('Workspaces', { selector: 'span.uppercase' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(openOrFocus).toHaveBeenCalledWith({
      kind: 'chat-landing',
      params: { targetWsId: chatWorkspace.id },
    })
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('routes the bottom Workspace context menu into the Workspace tree', () => {
    const onRequestDisplayMode = vi.fn()
    renderSection([chatWorkspace], null, undefined, 'focused', onRequestDisplayMode)

    fireEvent.click(screen.getByRole('button', { name: 'Chat context: chat-jul11' }))
    expect(screen.getByRole('dialog', { name: 'Chat Workspace options' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Workspace tree' }))
    expect(onRequestDisplayMode).toHaveBeenCalledWith('multi')
  })

  it('keeps Escape scoped to the open Workspace context menu', () => {
    renderSection([chatWorkspace], null, undefined, 'focused')

    const trigger = screen.getByRole('button', { name: 'Chat context: chat-jul11' })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Chat Workspace options' })).toBeTruthy()

    const allowed = fireEvent.keyDown(document, { key: 'Escape' })

    expect(allowed).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Chat Workspace options' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('offers an explicit recent view and orders sessions across Workspaces with ownership visible', () => {
    const olderWorkspace = {
      ...chatWorkspace,
      sessions: [{ ...chatSession(1), lastActiveAt: '2026-07-01T12:00:00.000Z' }],
    }
    const newerWorkspace: Workspace = {
      ...chatWorkspace,
      id: 'chat-2',
      tag: 'chat-aug3',
      dir: '/tmp/chat-aug3',
      createdAt: '2026-08-03T00:00:00.000Z',
      sessions: [{
        ...chatSession(2),
        id: 'newest-session',
        wsId: 'chat-2',
        lastActiveAt: '2026-08-03T12:00:00.000Z',
      }],
    }
    const onRequestDisplayMode = vi.fn()

    const { unmount } = renderSection(
      [olderWorkspace, newerWorkspace],
      null,
      undefined,
      'focused',
      onRequestDisplayMode,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Chat context: chat-aug3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recent across Workspaces' }))
    expect(onRequestDisplayMode).toHaveBeenCalledWith('recent')
    unmount()

    renderSection([olderWorkspace, newerWorkspace], null, undefined, 'recent')
    const newer = screen.getByRole('button', { name: 'Conversation 2' })
    const older = screen.getByRole('button', { name: 'Conversation 1' })
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('chat-aug3')).toBeTruthy()
    expect(screen.getByText('chat-jul11')).toBeTruthy()
    expect(screen.queryByText('Workspaces', { selector: 'span.uppercase' })).toBeNull()
  })

  it('switches the focused Workspace without expanding the whole tree', () => {
    const alternative = {
      ...chatWorkspace,
      id: 'chat-2',
      tag: 'chat-aug3',
      dir: '/tmp/chat-aug3',
      createdAt: '2026-08-03T00:00:00.000Z',
    }
    const onRequestDisplayMode = vi.fn()
    renderSection([chatWorkspace, alternative], null, undefined, 'focused', onRequestDisplayMode)

    fireEvent.click(screen.getByRole('button', { name: 'Chat context: chat-aug3' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Switch Workspace' }), {
      target: { value: chatWorkspace.id },
    })

    expect(openOrFocus).toHaveBeenCalledWith({
      kind: 'chat-landing',
      params: { targetWsId: chatWorkspace.id },
    })
    expect(onRequestDisplayMode).toHaveBeenCalledWith('focused')
  })

  it('keeps conversation creation primary and scopes workspace creation to the workspace list', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderSection([chatWorkspace], null, onNavigate)

    const newChat = screen.getByRole('button', { name: 'New chat' })
    const workspaceHeading = screen.getByText('Workspaces', { selector: 'span.uppercase' })
    const workspaceButton = screen.getByRole('button', { name: chatWorkspace.tag })
    const newSession = screen.getByRole('button', { name: 'New conversation in chat-jul11' })
    const moreWorkspaceActions = screen.getByRole('button', { name: 'More actions for chat-jul11' })

    expect(newChat.className).toContain('w-full')
    expect(newChat.textContent).toBe('New chat')
    expect(newChat.querySelector('.lucide-message-square-plus')).toBeTruthy()
    expect(workspaceHeading.parentElement?.nextElementSibling?.tagName).toBe('UL')
    expect(screen.queryByRole('button', { name: 'New workspace' })).toBeNull()
    expect(newSession.querySelector('.lucide-message-square-plus')).toBeTruthy()

    moreWorkspaceActions.focus()
    await user.keyboard('{ArrowDown}')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configure chat-jul11' }))
    expect(onNavigate).not.toHaveBeenCalled()

    fireEvent.click(newChat)
    expect(openOrFocus).toHaveBeenCalledWith({ kind: 'chat-landing', params: {} })
    expect(onNavigate).toHaveBeenCalledTimes(1)

    fireEvent.click(workspaceButton)
    expect(openOrFocus).toHaveBeenLastCalledWith({
      kind: 'chat-landing',
      params: { targetWsId: chatWorkspace.id },
    })
    expect(onNavigate).toHaveBeenCalledTimes(2)

    fireEvent.click(newSession)
    expect(openOrFocus).toHaveBeenLastCalledWith({
      kind: 'chat-landing',
      params: { targetWsId: chatWorkspace.id },
    })
    expect(onNavigate).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByRole('button', { name: 'Chat context: Workspaces' }))
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeTruthy()
  })

  it('keeps named Workspace identity compact and scopes every row action to it', async () => {
    const user = userEvent.setup()
    const namedWorkspace: Workspace = {
      ...chatWorkspace,
      id: 'chat-optical',
      tag: 'chat-jun30',
      displayName: 'Optical Networking Follow-up',
      dir: '/tmp/chat-jun30',
    }

    renderSection([chatWorkspace, namedWorkspace])

    expect(screen.getAllByText('Optical Networking Follow-up')).toHaveLength(1)
    expect(screen.getByText('chat-jun30')).toBeTruthy()
    const collapse = screen.getByRole('button', {
      name: 'Collapse sessions in Optical Networking Follow-up (chat-jun30)',
    })
    const newConversation = screen.getByRole('button', {
      name: 'New conversation in Optical Networking Follow-up (chat-jun30)',
    })
    const more = screen.getByRole('button', {
      name: 'More actions for Optical Networking Follow-up (chat-jun30)',
    })
    more.focus()
    await user.keyboard('{ArrowDown}')
    const configure = screen.getByRole('menuitem', {
      name: 'Configure Optical Networking Follow-up (chat-jun30)',
    })
    expect(screen.getByRole('menuitem', {
      name: 'Offboard Optical Networking Follow-up (chat-jun30)',
    })).toBeTruthy()
    expect(collapse.className).toContain('h-7')
    expect(newConversation.className).toContain('h-7')
    expect(more.className).toContain('oa-workspace-row-action')
    expect(more.className).not.toContain('opacity-0')
    expect(configure.textContent).toContain('Configure')

    expect(screen.queryByRole('button', { name: 'New conversation in this workspace' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Configure this workspace' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Offboard workspace' })).toBeNull()
  })

  it('keeps one explicit workspace action in the empty state', () => {
    renderSection([])

    expect(screen.getByText(i18n.t('chat.noChatWorkspacesYet'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New workspace' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Chat context: Workspaces' }))
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeTruthy()
  })

  it('reports a failed Workspace inventory without pretending the list is empty', () => {
    const retry = vi.fn(async () => undefined)
    const failed = {
      ...workspaceContext([]),
      hasLoaded: false,
      listError: 'list failed: 500',
      refresh: retry,
    }

    render(
      <WorkspacesContext.Provider value={failed}>
        <ChatWorkspaceSection />
      </WorkspacesContext.Provider>,
    )

    expect(screen.queryByText(i18n.t('chat.noChatWorkspacesYet'))).toBeNull()
    expect(screen.getByText(i18n.t('workspace.dataUnavailableSidebar'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('keeps the Chat section visible when the template catalog fails', () => {
    const retryTemplates = vi.fn(async () => undefined)
    const failed = {
      ...workspaceContext([chatWorkspace]),
      templates: [],
      templatesError: 'templates failed: 500',
      refreshTemplates: retryTemplates,
    }

    render(
      <WorkspacesContext.Provider value={failed}>
        <ChatWorkspaceSection />
      </WorkspacesContext.Provider>,
    )

    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy()
    expect(screen.getByText(i18n.t('workspace.templatesUnavailableSidebar'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retryTemplates).toHaveBeenCalledOnce()
  })

  it('bounds expanded Workspace history and routes the full catalog to the Session library', () => {
    const sessions = Array.from({ length: 9 }, (_, index) => chatSession(index + 1))
    const onNavigate = vi.fn()
    renderSection([{ ...chatWorkspace, sessions }], null, onNavigate)

    expect(screen.getAllByRole('button', { name: /^Conversation/ })).toHaveLength(6)
    expect(screen.queryByRole('button', { name: 'Conversation 3' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'View all 9 sessions' }))
    expect(openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: chatWorkspace.id, source: 'chat' },
    })
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('owns Manager Session navigation and lifecycle actions under the Manager entry', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
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

    renderSection([], manager, onNavigate)

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
    expect(onNavigate).toHaveBeenCalledTimes(1)

    fireEvent.click(managerUi.getByRole('button', { name: 'Stop Inspect the floor' }))
    expect(actions.pauseSession).toHaveBeenCalledWith(MANAGER_WORKSPACE_ID, 'manager-opencode')
    expect(onNavigate).toHaveBeenCalledTimes(1)

    fireEvent.click(managerUi.getByRole('button', { name: 'Resume Coordinate owners' }))
    expect(actions.openWebPiSession).toHaveBeenCalledWith(MANAGER_WORKSPACE_ID, 'manager-pi')
    expect(onNavigate).toHaveBeenCalledTimes(2)

    const pausedRow = pausedSession.parentElement
    expect(pausedRow).toBeTruthy()
    const managerMore = within(pausedRow as HTMLElement).getByRole('button', { name: 'More actions for Coordinate owners' })
    managerMore.focus()
    await user.keyboard('{ArrowDown}')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Coordinate owners' }))
    expect(actions.requestDeleteSession).toHaveBeenCalledWith(MANAGER_WORKSPACE_ID, 'manager-pi')
    expect(onNavigate).toHaveBeenCalledTimes(2)

    fireEvent.click(managerUi.getByRole('button', { name: 'Collapse sessions' }))
    expect(managerUi.queryByRole('button', { name: 'Inspect the floor' })).toBeNull()
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })
})
