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
  openHeadlessRun: vi.fn(async () => undefined),
  requestDeleteSession: vi.fn(),
  setSessionPresence: vi.fn(async () => undefined),
  setSessionDisplayName: vi.fn(async () => undefined),
  updateSessionRuntime: vi.fn(async () => undefined),
  openAgentConfig: vi.fn(),
}))
const directoryState = vi.hoisted(() => ({
  directories: new Map(),
}))
const { openOrFocus } = actions
const focusedTabState = vi.hoisted(() => ({
  tab: null as { spec: { kind: string; params: Record<string, string> } } | null,
}))

vi.mock('../../hooks/useWorkspaceSessionDirectory', () => ({
  useWorkspaceSessionDirectories: () => ({
    directories: directoryState.directories,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

vi.mock('../../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof openOrFocus }) => unknown) =>
    selector({ openOrFocus }),
}))

vi.mock('../../tabs/types', () => ({
  getFocusedTab: () => focusedTabState.tab,
}))

const harnessPreference = vi.hoisted(() => ({
  showHeadlessBornSessions: true,
  showIssueAttachedSessions: true,
}))

vi.mock('../../hooks/useHarnessPreferences', () => ({
  useHarnessPreferences: () => ({
    preferences: harnessPreference,
    loading: false,
    error: null,
    save: vi.fn(),
  }),
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
    openHeadlessRun: actions.openHeadlessRun,
    setDefaultAgent: vi.fn(async () => undefined),
    setIssueDefaultAgent: vi.fn(async () => undefined),
    initializeAutoQuant: vi.fn(async () => { throw new Error('not used') }),
    initializeChat: vi.fn(async () => { throw new Error('not used') }),
    setAutoQuantDefaultWorkspace: vi.fn(async () => undefined),
    quickChat: vi.fn(async () => 'session-1'),
    pauseSession: actions.pauseSession,
    resumeSession: actions.resumeSession,
    openWebPiSession: actions.openWebPiSession,
    requestDeleteSession: actions.requestDeleteSession,
    setSessionPresence: actions.setSessionPresence,
    setSessionDisplayName: actions.setSessionDisplayName,
    updateSessionRuntime: actions.updateSessionRuntime,
    openAgentConfig: actions.openAgentConfig,
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
  directoryState.directories = new Map()
  focusedTabState.tab = null
  harnessPreference.showHeadlessBornSessions = true
  harnessPreference.showIssueAttachedSessions = true
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
    const menu = screen.getByRole('dialog', { name: 'Chat Workspace options' })
    expect(menu.className).toContain('w-72')
    expect(menu.className).not.toContain('absolute bottom-full')
    fireEvent.click(screen.getByRole('button', { name: 'Workspace tree' }))
    expect(onRequestDisplayMode).toHaveBeenCalledWith('multi')
  })

  it('surfaces a template update from the bottom Workspace context', () => {
    const upgradeWorkspace: Workspace = {
      ...chatWorkspace,
      currentVersion: '1.8.2',
      upgradeAvailable: { from: '1.8.2', to: '1.8.3' },
    }
    renderSection([upgradeWorkspace], null, undefined, 'focused')

    const trigger = screen.getByRole('button', {
      name: 'Chat context: chat-jul11. Template update available to v1.8.3.',
    })
    expect(within(trigger).getByText('Update available · v1.8.3')).toBeTruthy()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Review template update to v1.8.3' }))

    expect(actions.openAgentConfig).toHaveBeenCalledWith('chat-1', undefined, 'template')
  })

  it('keeps Escape scoped to the open Workspace context menu', () => {
    renderSection([chatWorkspace], null, undefined, 'focused')

    const trigger = screen.getByRole('button', { name: 'Chat context: chat-jul11' })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Chat Workspace options' })).toBeTruthy()
    trigger.focus()

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

  it('switches the focused Workspace through a searchable Dialog', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Switch Workspace' }))

    const dialog = screen.getByRole('dialog', { name: 'Switch Workspace' })
    expect(screen.queryByRole('dialog', { name: 'Chat Workspace options' })).toBeNull()
    const picker = within(dialog)
    expect(picker.getByRole('searchbox', { name: 'Search Workspaces…' })).toBeTruthy()
    fireEvent.click(picker.getByRole('button', { name: /chat-jul11/ }))

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

  it('caps focused and recent sidebars to a recent work set and keeps Browse complete', async () => {
    const sessions = Array.from({ length: 9 }, (_, index) => chatSession(index + 1))
    const workspace = { ...chatWorkspace, sessions }
    const onNavigate = vi.fn()
    const user = userEvent.setup()

    const expectCappedSidebar = () => {
      expect(screen.getAllByRole('button', { name: /^Conversation \d+$/ })).toHaveLength(8)
      expect(screen.getByRole('button', { name: 'Conversation 9' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Conversation 3' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Conversation 2' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Conversation 1' })).toBeNull()
      expect(
        screen.getByText('Recent conversations', { selector: 'span.uppercase' }).nextElementSibling?.textContent,
      ).toBe('9')
    }

    const { unmount: unmountFocused } = renderSection([workspace], null, onNavigate, 'focused')
    expectCappedSidebar()
    const inlineBrowse = screen.getByRole('button', { name: 'View all 9 conversations' })
    inlineBrowse.focus()
    await user.click(inlineBrowse)

    let dialog = screen.getByRole('dialog', { name: 'Browse all conversations' })
    let browser = within(dialog)
    expect(browser.getAllByRole('button', { name: /^Conversation \d+$/ })).toHaveLength(9)
    expect(browser.getByRole('button', { name: 'Conversation 1' })).toBeTruthy()
    expect(browser.getByRole('button', { name: 'Current Workspace' }).getAttribute('aria-pressed')).toBe('true')
    expect(openOrFocus).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Browse all conversations' })).toBeNull()
    expect(document.activeElement).toBe(inlineBrowse)

    await user.click(inlineBrowse)
    dialog = screen.getByRole('dialog', { name: 'Browse all conversations' })
    browser = within(dialog)

    await user.click(browser.getByRole('button', { name: 'Conversation 3' }))
    expect(openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: chatWorkspace.id, sessionId: 'chat-session-3', source: 'chat' },
    })
    expect(onNavigate).toHaveBeenCalledTimes(1)
    unmountFocused()

    const { unmount: unmountRecent } = renderSection([workspace], null, undefined, 'recent')
    expectCappedSidebar()
    await user.click(screen.getByRole('button', { name: 'View all 9 conversations' }))
    dialog = screen.getByRole('dialog', { name: 'Browse all conversations' })
    expect(within(dialog).getByRole('button', { name: 'All Workspaces' }).getAttribute('aria-pressed')).toBe('true')
    unmountRecent()

    focusedTabState.tab = {
      spec: {
        kind: 'workspace',
        params: { wsId: chatWorkspace.id, sessionId: 'chat-session-1', source: 'chat' },
      },
    }
    renderSection([workspace], null, undefined, 'focused')
    expect(screen.getAllByRole('button', { name: /^Conversation \d+$/ })).toHaveLength(8)
    expect(screen.getByRole('button', { name: 'Conversation 1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Conversation 2' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Conversation 9' })).toBeTruthy()
    expect(
      screen.getByText('Recent conversations', { selector: 'span.uppercase' }).nextElementSibling?.textContent,
    ).toBe('9')
    expect(
      screen.getByRole('button', { name: 'Conversation 9' }).compareDocumentPosition(
        screen.getByRole('button', { name: 'Conversation 1' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View all 9 conversations' })).toBeTruthy()
  })

  it('does not show an inline Browse action when every recent conversation fits', () => {
    const workspace = {
      ...chatWorkspace,
      sessions: Array.from({ length: 8 }, (_, index) => chatSession(index + 1)),
    }

    renderSection([workspace], null, undefined, 'focused')

    expect(screen.getAllByRole('button', { name: /^Conversation \d+$/ })).toHaveLength(8)
    expect(screen.queryByRole('button', { name: /View all \d+ conversations/ })).toBeNull()
  })

  it('keeps every running headless row while still capping the recent work set', () => {
    directoryState.directories = new Map([[chatWorkspace.id, {
      workspace: { id: chatWorkspace.id, tag: chatWorkspace.tag },
      sessions: [
        {
          resumeId: 'resume-headless-running-a',
          agent: 'claude',
          createdAt: Date.parse('2026-08-03T00:00:00.000Z'),
          updatedAt: Date.parse('2026-08-03T01:00:00.000Z'),
          lifecycle: 'active',
          resumable: true,
          active: true,
          latestExecution: {
            taskId: 'task-run-a',
            status: 'running',
            startedAt: Date.parse('2026-08-03T01:00:00.000Z'),
            issueId: 'scan-open',
          },
        },
        {
          resumeId: 'resume-headless-running-b',
          agent: 'codex',
          createdAt: Date.parse('2026-08-03T00:30:00.000Z'),
          updatedAt: Date.parse('2026-08-03T02:00:00.000Z'),
          lifecycle: 'active',
          resumable: true,
          active: true,
          latestExecution: {
            taskId: 'task-run-b',
            status: 'running',
            startedAt: Date.parse('2026-08-03T02:00:00.000Z'),
            issueId: 'risk-watch',
          },
        },
      ],
    }]])
    const sessions = [
      ...Array.from({ length: 9 }, (_, index) => chatSession(index + 1)),
      {
        ...chatSession(20),
        id: 'session-headless-running-a',
        resumeId: 'resume-headless-running-a',
        agent: 'claude',
        name: 'c1',
        surface: 'headless' as const,
        state: 'running' as const,
        title: null,
        lastActiveAt: '2026-08-03T01:00:00.000Z',
      },
      {
        ...chatSession(21),
        id: 'session-headless-running-b',
        resumeId: 'resume-headless-running-b',
        agent: 'codex',
        name: 'x1',
        surface: 'headless' as const,
        state: 'running' as const,
        title: null,
        lastActiveAt: '2026-08-03T02:00:00.000Z',
      },
    ]
    renderSection([{ ...chatWorkspace, sessions }], null, undefined, 'focused')

    const runningSection = screen.getByRole('region', { name: 'Running in background' })
    expect(within(runningSection).getByText('Scan Open')).toBeTruthy()
    expect(within(runningSection).getByText('Risk Watch')).toBeTruthy()
    expect(within(runningSection).getByText('2')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Conversation \d+$/ })).toHaveLength(8)
    expect(screen.queryByRole('button', { name: 'Conversation 1' })).toBeNull()
    expect(
      screen.getByText('Recent conversations', { selector: 'span.uppercase' }).nextElementSibling?.textContent,
    ).toBe('9')
  })

  it('browses current or cross-Workspace conversations without leaving the page first', async () => {
    const user = userEvent.setup()
    const olderWorkspace = {
      ...chatWorkspace,
      sessions: [{ ...chatSession(1), title: 'Older thesis' }],
    }
    const currentWorkspace: Workspace = {
      ...chatWorkspace,
      id: 'chat-2',
      tag: 'chat-aug3',
      dir: '/tmp/chat-aug3',
      createdAt: '2026-08-03T00:00:00.000Z',
      sessions: [{
        ...chatSession(2),
        id: 'current-session',
        wsId: 'chat-2',
        title: 'Current thesis',
      }],
    }
    renderSection([olderWorkspace, currentWorkspace], null, undefined, 'focused')

    const trigger = screen.getByRole('button', { name: 'Chat context: chat-aug3' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Browse all conversations' }))

    const dialog = screen.getByRole('dialog', { name: 'Browse all conversations' })
    const browser = within(dialog)
    expect(browser.getByRole('button', { name: 'Current thesis' })).toBeTruthy()
    expect(browser.queryByRole('button', { name: 'Older thesis' })).toBeNull()

    fireEvent.click(browser.getByRole('button', { name: 'All Workspaces' }))
    expect(browser.getByRole('button', { name: 'Older thesis' })).toBeTruthy()

    fireEvent.change(browser.getByRole('searchbox', { name: 'Search conversations…' }), {
      target: { value: 'older' },
    })
    expect(browser.queryByRole('button', { name: 'Current thesis' })).toBeNull()
    expect(browser.getByRole('button', { name: 'Older thesis' })).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Browse all conversations' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
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

  it('groups running headless Sessions and explains why TUI is temporarily unavailable', async () => {
    const onNavigate = vi.fn()
    directoryState.directories = new Map([[chatWorkspace.id, {
      workspace: { id: chatWorkspace.id, tag: chatWorkspace.tag },
      sessions: [
        {
          resumeId: 'resume-headless-colleague',
          agent: 'codex',
          createdAt: Date.parse('2026-08-01T00:00:00.000Z'),
          updatedAt: Date.parse('2026-08-02T00:00:00.000Z'),
          lifecycle: 'active',
          resumable: true,
          active: false,
          latestExecution: {
            taskId: 'task-done',
            status: 'done',
            startedAt: Date.parse('2026-08-02T00:00:00.000Z'),
            finishedAt: Date.parse('2026-08-02T00:05:00.000Z'),
            assistantPreview: 'Morning scan complete. Semis still lead.',
          },
        },
        {
          resumeId: 'resume-headless-running',
          agent: 'claude',
          createdAt: Date.parse('2026-08-03T00:00:00.000Z'),
          updatedAt: Date.parse('2026-08-03T01:00:00.000Z'),
          lifecycle: 'active',
          resumable: true,
          active: true,
          latestExecution: {
            taskId: 'task-run',
            status: 'running',
            startedAt: Date.parse('2026-08-03T01:00:00.000Z'),
            issueId: 'scan-open',
          },
        },
      ],
    }]])

    const headlessWorkspace = {
      ...chatWorkspace,
      sessions: [
        {
          ...chatSession(20),
          id: 'session-headless-colleague',
          resumeId: 'resume-headless-colleague',
          agent: 'codex',
          name: 'x1',
          surface: 'headless' as const,
          title: null,
          lastActiveAt: '2026-08-02T00:05:00.000Z',
        },
        {
          ...chatSession(21),
          id: 'session-headless-running',
          resumeId: 'resume-headless-running',
          agent: 'claude',
          name: 'c1',
          surface: 'headless' as const,
          state: 'running' as const,
          title: null,
          lastActiveAt: '2026-08-03T01:00:00.000Z',
        },
      ],
    }

    renderSection([headlessWorkspace], null, onNavigate, 'focused')

    const runningSection = screen.getByRole('region', { name: 'Running in background' })
    expect(within(runningSection).getByText('Scan Open')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Morning scan complete. Semis still lead.' })).toBeTruthy()
    const [runningTitle, runningPlay] = screen.getAllByRole('button', { name: 'Running · Scan Open' })
    fireEvent.click(runningTitle!)
    expect(screen.getByRole('dialog', { name: 'This Session is running in the background' })).toBeTruthy()
    expect(screen.getByText('Started by Issue scan-open')).toBeTruthy()
    expect(openOrFocus).not.toHaveBeenCalled()
    expect(actions.resumeSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)

    fireEvent.click(runningPlay!)
    expect(screen.getByRole('dialog', { name: 'This Session is running in the background' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)

    fireEvent.click(within(runningSection).getByRole('button', { name: /Running in background/ }))
    expect(within(runningSection).queryByText('Scan Open')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Resume Morning scan complete. Semis still lead.' }))
    expect(actions.resumeSession).toHaveBeenCalledWith(
      chatWorkspace.id,
      'session-headless-colleague',
      'chat',
    )
    expect(onNavigate).toHaveBeenCalledOnce()

    const user = userEvent.setup()
    const more = screen.getByRole('button', { name: 'More actions for Morning scan complete. Semis still lead.' })
    more.focus()
    await user.keyboard('{ArrowDown}')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive Morning scan complete. Semis still lead.' }))
    expect(actions.setSessionPresence).toHaveBeenCalledWith(
      chatWorkspace.id,
      'resume-headless-colleague',
      'archived',
    )
  })

  it('hides headless-born Sessions that never opened a TUI unless the harness preference is on', () => {
    harnessPreference.showHeadlessBornSessions = false
    const hiddenWorkspace = {
      ...chatWorkspace,
      sessions: [
        { ...chatSession(1), title: 'Interactive thesis' },
        {
          ...chatSession(20),
          id: 'session-headless-colleague',
          resumeId: 'resume-headless-colleague',
          agent: 'codex',
          name: 'x1',
          surface: 'headless' as const,
          title: null,
        },
      ],
    }
    renderSection([hiddenWorkspace], null, undefined, 'focused')
    expect(screen.getByRole('button', { name: 'Interactive thesis' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'x1' })).toBeNull()
  })

  it('keeps headless occupancy inside Browse Running without a Headless filter', () => {
    directoryState.directories = new Map([[chatWorkspace.id, {
      workspace: { id: chatWorkspace.id, tag: chatWorkspace.tag },
      sessions: [{
        resumeId: 'resume-headless-running',
        agent: 'claude',
        createdAt: Date.parse('2026-08-03T00:00:00.000Z'),
        updatedAt: Date.parse('2026-08-03T01:00:00.000Z'),
        lifecycle: 'active',
        resumable: true,
        active: true,
        latestExecution: {
          taskId: 'task-run',
          status: 'running',
          startedAt: Date.parse('2026-08-03T01:00:00.000Z'),
          issueId: 'scan-open',
        },
      }],
    }]])
    const pausedWorkspace = {
      ...chatWorkspace,
      sessions: [
        { ...chatSession(1), title: 'Paused thesis' },
        {
          ...chatSession(22),
          id: 'session-headless-running',
          resumeId: 'resume-headless-running',
          agent: 'claude',
          name: 'c1',
          surface: 'headless' as const,
          state: 'running' as const,
          title: null,
          lastActiveAt: '2026-08-03T01:00:00.000Z',
        },
      ],
    }
    renderSection([pausedWorkspace], null, undefined, 'focused')

    fireEvent.click(screen.getByRole('button', { name: 'Chat context: chat-jul11' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse all conversations' }))
    const dialog = screen.getByRole('dialog', { name: 'Browse all conversations' })
    const browser = within(dialog)
    expect(browser.getByRole('button', { name: 'Paused thesis' })).toBeTruthy()
    expect(browser.getByRole('button', { name: 'Running · Scan Open' })).toBeTruthy()

    fireEvent.click(browser.getByRole('button', { name: /^Running$/ }))
    expect(browser.queryByRole('button', { name: 'Paused thesis' })).toBeNull()
    expect(browser.getByRole('button', { name: 'Running · Scan Open' })).toBeTruthy()
    expect(browser.queryByRole('button', { name: 'Headless' })).toBeNull()
  })

  it('projects Issue identity across focused, recent, multi, and browse rosters', () => {
    const launchPrompt = [
      '# Daily market close',
      '',
      'You are the close-desk analyst. Review semiconductors, rates, and open risk.',
    ].join('\n')
    const longEnglish = 'Review the overnight cross-asset tape and summarize every open risk before the cash open'
    const longCjk = '请在开盘前复查隔夜跨资产波动并整理所有未平仓风险'
    directoryState.directories = new Map([
      [chatWorkspace.id, {
        workspace: { id: chatWorkspace.id, tag: chatWorkspace.tag },
        sessions: [
          {
            resumeId: 'resume-issue',
            agent: 'codex',
            createdAt: Date.parse('2026-08-04T00:00:00.000Z'),
            updatedAt: Date.parse('2026-08-04T01:00:00.000Z'),
            lifecycle: 'active' as const,
            resumable: true,
            active: false,
            createdBy: {
              kind: 'issue' as const,
              workspaceId: chatWorkspace.id,
              issueId: 'daily-market-close',
              policy: 'new-then-resume' as const,
              fire: 'schedule' as const,
            },
            latestExecution: {
              taskId: 'task-issue',
              status: 'done' as const,
              startedAt: Date.parse('2026-08-04T00:50:00.000Z'),
              finishedAt: Date.parse('2026-08-04T01:00:00.000Z'),
              issueId: 'daily-market-close',
              assistantPreview: 'Close scan finished. Semis still lead.',
            },
          },
          {
            resumeId: 'resume-named',
            agent: 'pi',
            createdAt: Date.parse('2026-08-03T00:00:00.000Z'),
            updatedAt: Date.parse('2026-08-03T01:00:00.000Z'),
            lifecycle: 'active' as const,
            resumable: true,
            active: false,
            displayName: 'AAPL desk',
            createdBy: {
              kind: 'issue' as const,
              workspaceId: chatWorkspace.id,
              issueId: 'aapl-earnings',
              policy: 'new-each-run' as const,
              fire: 'retry' as const,
            },
          },
          {
            resumeId: 'chat-resume-1',
            agent: 'pi',
            createdAt: Date.parse('2026-07-01T00:00:00.000Z'),
            updatedAt: Date.parse('2026-07-01T12:00:00.000Z'),
            lifecycle: 'active' as const,
            resumable: true,
            active: false,
            createdBy: { kind: 'interactive' as const, surface: 'quick-chat' as const },
            interactive: {
              name: 'p1',
              title: longEnglish,
              state: 'paused' as const,
              lastActiveAt: '2026-07-01T12:00:00.000Z',
            },
          },
        ],
      }],
      ['chat-2', {
        workspace: { id: 'chat-2', tag: 'chat-aug3' },
        sessions: [{
          resumeId: 'resume-conversation',
          agent: 'pi',
          createdAt: Date.parse('2026-08-05T00:00:00.000Z'),
          updatedAt: Date.parse('2026-08-05T02:00:00.000Z'),
          lifecycle: 'active' as const,
          resumable: true,
          active: false,
          createdBy: {
            kind: 'conversation' as const,
            caller: { kind: 'human' as const },
            reason: 'explicit-workspace',
          },
        }],
      }],
    ])

    const focusedWorkspace: Workspace = {
      ...chatWorkspace,
      sessions: [
        {
          ...chatSession(30),
          id: 'session-issue',
          resumeId: 'resume-issue',
          agent: 'codex',
          name: 'x1',
          surface: 'headless',
          title: launchPrompt,
          lastActiveAt: '2026-08-06T01:00:00.000Z',
        },
        {
          ...chatSession(31),
          id: 'session-named',
          resumeId: 'resume-named',
          displayName: 'AAPL desk',
          title: launchPrompt,
          lastActiveAt: '2026-08-03T01:00:00.000Z',
        },
        { ...chatSession(1), title: longEnglish },
      ],
    }
    const otherWorkspace: Workspace = {
      ...chatWorkspace,
      id: 'chat-2',
      tag: 'chat-aug3',
      dir: '/tmp/chat-aug3',
      createdAt: '2026-08-03T00:00:00.000Z',
      sessions: [{
        ...chatSession(2),
        id: 'session-conversation',
        resumeId: 'resume-conversation',
        wsId: 'chat-2',
        title: longCjk,
        lastActiveAt: '2026-08-05T02:00:00.000Z',
      }],
    }

    const expectSharedTitles = (scope: HTMLElement | Document = document) => {
      const view = scope === document ? screen : within(scope as HTMLElement)
      expect(view.getByRole('button', { name: 'Daily Market Close' })).toBeTruthy()
      expect(view.getByRole('button', { name: 'AAPL desk' })).toBeTruthy()
      expect(view.getByRole('button', { name: longEnglish })).toBeTruthy()
      expect(view.queryByRole('button', { name: launchPrompt })).toBeNull()
      expect(view.queryByText(launchPrompt)).toBeNull()
    }

    const { unmount: unmountFocused } = renderSection(
      [focusedWorkspace, otherWorkspace],
      null,
      undefined,
      'focused',
    )
    expectSharedTitles()
    expect(screen.getAllByText('Issue')).toHaveLength(2)
    expect(screen.queryByText(longCjk)).toBeNull()
    unmountFocused()

    const { unmount: unmountRecent } = renderSection(
      [focusedWorkspace, otherWorkspace],
      null,
      undefined,
      'recent',
    )
    expectSharedTitles()
    expect(screen.getByRole('button', { name: longCjk })).toBeTruthy()
    expect(screen.getAllByText('Issue · chat-jul11')).toHaveLength(2)
    expect(screen.getByText('Conversation · chat-aug3')).toBeTruthy()
    unmountRecent()

    renderSection([focusedWorkspace, otherWorkspace], null, undefined, 'multi')
    expectSharedTitles()
    expect(screen.getByRole('button', { name: longCjk })).toBeTruthy()
    expect(screen.getAllByText('Issue')).toHaveLength(2)
    expect(screen.getByText('Conversation')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Chat context: Workspaces' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse all conversations' }))
    const dialog = screen.getByRole('dialog', { name: 'Browse all conversations' })
    const browser = within(dialog)
    expectSharedTitles(dialog)
    fireEvent.click(browser.getByRole('button', { name: 'All Workspaces' }))
    expectSharedTitles(dialog)
    expect(browser.getByRole('button', { name: longCjk })).toBeTruthy()
    expect(browser.getAllByText('Issue')).toHaveLength(2)
    expect(browser.getByText('Conversation')).toBeTruthy()
  })
})
