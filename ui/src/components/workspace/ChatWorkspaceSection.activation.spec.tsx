// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspacesContext, type WorkspacesContextValue } from '../../contexts/workspaces-context'
import { i18n } from '../../i18n'
import type { SessionRecord, TemplateInfo, Workspace } from './api'
import { ChatWorkspaceSection } from './ChatWorkspaceSection'
import type { ViewSpec } from '../../tabs/types'

const mocks = vi.hoisted(() => ({
  focusedSpec: null as ViewSpec | null,
  openOrFocus: vi.fn(),
  rememberRecentChatWorkspace: vi.fn(async () => undefined),
  getQuickChat: vi.fn(async () => ({ recentChatWorkspaceId: 'chat-active' as string | null })),
  createdWorkspace: null as Workspace | null,
}))

vi.mock('../../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

vi.mock('../../tabs/types', () => ({
  getFocusedTab: () => (mocks.focusedSpec ? { spec: mocks.focusedSpec } : null),
}))

vi.mock('../../api/preferences', () => ({
  preferencesApi: {
    getQuickChat: mocks.getQuickChat,
    rememberRecentChatWorkspace: mocks.rememberRecentChatWorkspace,
  },
}))

vi.mock('./CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: ({ onCreated, onClose }: { onCreated: (ws: Workspace) => void; onClose: () => void }) => (
    <div data-testid="mock-create-dialog">
      <button
        type="button"
        onClick={() => {
          if (mocks.createdWorkspace) onCreated(mocks.createdWorkspace)
          onClose()
        }}
      >
        Complete Create
      </button>
    </div>
  ),
}))

vi.mock('../../hooks/useHarnessPreferences', () => ({
  useHarnessPreferences: () => ({
    preferences: { showHeadlessBornSessions: true, showIssueAttachedSessions: true },
    loading: false,
    error: null,
    save: vi.fn(),
  }),
}))

vi.mock('../../hooks/useWorkspaceSessionDirectory', () => ({
  useWorkspaceSessionDirectories: () => ({
    directories: new Map(),
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

const chatTemplate: TemplateInfo = {
  name: 'chat',
  defaultAgents: ['codex'],
  version: '1.0.0',
  hasReadme: true,
}

const aqTemplate: TemplateInfo = {
  name: 'auto-quant-v2',
  defaultAgents: ['pi'],
  version: '1.0.0',
  hasReadme: true,
}

function makeSession(wsId: string, id: string, state: 'running' | 'paused', title: string): SessionRecord {
  return {
    id,
    resumeId: `resume-${id}`,
    wsId,
    agent: 'codex',
    name: 'x1',
    createdAt: '2026-07-15T00:00:00.000Z',
    lastActiveAt: '2026-07-15T00:05:00.000Z',
    state,
    surface: 'terminal',
    pid: state === 'running' ? 123 : null,
    startedAt: state === 'running' ? 1 : null,
    title,
  }
}

const activeChatWs: Workspace = {
  id: 'chat-active',
  tag: 'chat-main',
  displayName: 'Main Chat',
  dir: '/tmp/chat-main',
  createdAt: '2026-07-01T00:00:00.000Z',
  template: 'chat',
  activationState: 'active',
  sessions: [makeSession('chat-active', 'sess-active', 'running', 'Active chat session')],
}

const standbyChatWs: Workspace = {
  id: 'chat-standby',
  tag: 'chat-side',
  displayName: 'Standby Chat',
  dir: '/tmp/chat-side',
  createdAt: '2026-07-10T00:00:00.000Z',
  template: 'chat',
  activationState: 'standby',
  sessions: [
    makeSession('chat-standby', 'sess-standby-run', 'running', 'Standby running session'),
    makeSession('chat-standby', 'sess-standby-paused', 'paused', 'Standby paused session'),
  ],
}

const activeAqWs: Workspace = {
  id: 'aq-active',
  tag: 'auto-quant-main',
  displayName: 'Main Quant',
  dir: '/tmp/aq-main',
  createdAt: '2026-07-01T00:00:00.000Z',
  template: 'auto-quant-v2',
  activationState: 'active',
  sessions: [],
}

function makeContext(overrides: Partial<WorkspacesContextValue> = {}): WorkspacesContextValue {
  return {
    workspaces: [activeChatWs, standbyChatWs, activeAqWs],
    templates: [chatTemplate, aqTemplate],
    agents: [],
    defaultAgent: 'codex',
    issueDefaultAgent: null,
    listError: null,
    workspaceManager: null,
    workspaceManagerLoaded: true,
    workspaceManagerError: null,
    hasLoaded: true,
    templatesLoaded: true,
    templatesError: null,
    autoQuantDefaultWorkspaceId: activeAqWs.id,
    autoQuantPreferenceLoaded: true,
    autoQuantPreferenceError: null,
    autoPredictionDefaultWorkspaceId: null,
    autoPredictionPreferenceLoaded: true,
    autoPredictionPreferenceError: null,
    activatingWorkspaceId: null,
    requestActivateWorkspace: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    refreshTemplates: vi.fn(async () => undefined),
    refreshAutoQuantPreference: vi.fn(async () => undefined),
    refreshAutoPredictionPreference: vi.fn(async () => undefined),
    refreshWorkspaceManager: vi.fn(async () => undefined),
    quickStartWorkspaceManager: vi.fn(async () => { throw new Error('unused') }),
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: vi.fn(async () => undefined),
    setIssueDefaultAgent: vi.fn(async () => undefined),
    initializeAutoQuant: vi.fn(async () => activeAqWs),
    initializeChat: vi.fn(async () => activeChatWs),
    setAutoQuantDefaultWorkspace: vi.fn(async () => undefined),
    setAutoPredictionDefaultWorkspace: vi.fn(async () => undefined),
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
  mocks.focusedSpec = null
  mocks.createdWorkspace = null
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('ChatWorkspaceSection standby slot invariants', () => {
  it('does not preempt the active AutoQuant workspace when creating a new standby workspace', async () => {
    const ctx = makeContext()
    mocks.createdWorkspace = {
      id: 'aq-new-standby',
      tag: 'auto-quant-2',
      dir: '/tmp/aq-2',
      createdAt: '2026-07-20T00:00:00.000Z',
      template: 'auto-quant-v2',
      activationState: 'standby',
      sessions: [],
    }

    render(
      <WorkspacesContext.Provider value={ctx}>
        <ChatWorkspaceSection mode="auto-quant" placement="navigation" />
      </WorkspacesContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Auto Quant Workspace options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch Workspace' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New AutoQuant workspace' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Complete Create' }))

    expect(ctx.refresh).toHaveBeenCalled()
    expect(ctx.setAutoQuantDefaultWorkspace).not.toHaveBeenCalled()
    expect(ctx.requestActivateWorkspace).not.toHaveBeenCalled()
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'auto-quant-landing',
      params: { targetWsId: 'aq-new-standby' },
    })
  })

  it('does not persist recentChatWorkspaceId when creating a new standby chat workspace', async () => {
    const ctx = makeContext()
    mocks.createdWorkspace = {
      id: 'chat-new-standby',
      tag: 'chat-2',
      dir: '/tmp/chat-2',
      createdAt: '2026-07-20T00:00:00.000Z',
      template: 'chat',
      activationState: 'standby',
      sessions: [],
    }

    render(
      <WorkspacesContext.Provider value={ctx}>
        <ChatWorkspaceSection mode="chat" placement="navigation" />
      </WorkspacesContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Chat Workspace options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch Workspace' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New workspace' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Complete Create' }))

    expect(ctx.refresh).toHaveBeenCalled()
    expect(ctx.requestActivateWorkspace).not.toHaveBeenCalled()
    expect(mocks.rememberRecentChatWorkspace).not.toHaveBeenCalled()
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'chat-landing',
      params: { targetWsId: 'chat-new-standby' },
    })
  })

  it('does not steal the active chat slot when opening or resuming sessions in a standby chat workspace', () => {
    const ctx = makeContext()
    mocks.focusedSpec = { kind: 'workspace', params: { wsId: standbyChatWs.id, source: 'chat' } }

    render(
      <WorkspacesContext.Provider value={ctx}>
        <ChatWorkspaceSection mode="chat" placement="navigation" />
      </WorkspacesContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Standby running session' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: standbyChatWs.id, sessionId: 'sess-standby-run', source: 'chat' },
    })
    expect(mocks.rememberRecentChatWorkspace).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Standby paused session' }))
    expect(ctx.resumeSession).toHaveBeenCalledWith(standbyChatWs.id, 'sess-standby-paused', 'chat')
    expect(mocks.rememberRecentChatWorkspace).not.toHaveBeenCalled()
  })

  it('still remembers active chat workspace when opening a session in the active workspace', () => {
    const ctx = makeContext()
    mocks.focusedSpec = { kind: 'workspace', params: { wsId: activeChatWs.id, source: 'chat' } }

    render(
      <WorkspacesContext.Provider value={ctx}>
        <ChatWorkspaceSection mode="chat" placement="navigation" />
      </WorkspacesContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Active chat session' }))
    expect(mocks.rememberRecentChatWorkspace).toHaveBeenCalledWith(activeChatWs.id)
  })
})
