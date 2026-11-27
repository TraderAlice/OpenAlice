// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COMMANDER_WORKSPACE_ID,
  type AgentInfo,
  type CommanderSnapshot,
  type SessionRecord,
} from '../components/workspace/api'
import type { WorkspacesContextValue } from '../contexts/workspaces-context'
import { resetAgentRuntimesStore } from '../hooks/useAgentRuntimes'
import { i18n } from '../i18n'
import { CommanderPage } from './CommanderPage'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
  setDefaultAgent: vi.fn(),
  getCommander: vi.fn(),
  openCommander: vi.fn(),
  refreshCommander: vi.fn(),
  pauseSession: vi.fn(),
  setSessionDisplayName: vi.fn(),
  updateSessionRuntime: vi.fn(),
  openAgentConfig: vi.fn(),
  getAgentRuntimeReadiness: vi.fn(),
  probeAgentRuntimeReadiness: vi.fn(),
  listAgents: vi.fn(),
  listAgentCredentials: vi.fn(),
  detectWorkspaceCredential: vi.fn(),
  getAgentReadiness: vi.fn(),
  getWorkspaceCredentialDefaults: vi.fn(),
  getPresets: vi.fn(),
  getQuickChat: vi.fn(),
  rememberQuickChatLaunch: vi.fn(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => mocks.useWorkspaces(),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: {
    openOrFocus: typeof mocks.openOrFocus
    setSidebar: typeof mocks.setSidebar
  }) => unknown) => selector({
    openOrFocus: mocks.openOrFocus,
    setSidebar: mocks.setSidebar,
  }),
}))

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return {
    ...actual,
    getCommander: mocks.getCommander,
    openCommander: mocks.openCommander,
    getAgentRuntimeReadiness: mocks.getAgentRuntimeReadiness,
    probeAgentRuntimeReadiness: mocks.probeAgentRuntimeReadiness,
    listAgents: mocks.listAgents,
    listAgentCredentials: mocks.listAgentCredentials,
    detectWorkspaceCredential: mocks.detectWorkspaceCredential,
    getAgentReadiness: mocks.getAgentReadiness,
  }
})

vi.mock('../api/preferences', () => ({
  preferencesApi: {
    getQuickChat: mocks.getQuickChat,
    rememberQuickChatLaunch: mocks.rememberQuickChatLaunch,
  },
}))

vi.mock('../api/config', () => ({
  configApi: {
    getWorkspaceCredentialDefaults: mocks.getWorkspaceCredentialDefaults,
    getPresets: mocks.getPresets,
  },
}))

vi.mock('../components/workspace/SessionTakeoverDialog', () => ({
  SessionTakeoverBubble: () => null,
}))

vi.mock('../components/workspace/SessionSettingsDialog', () => ({
  SessionSettingsDialog: ({ open, record }: { open: boolean; record: SessionRecord }) => (
    open ? <div data-testid="session-settings-dialog" data-session-id={record.id} /> : null
  ),
}))

vi.mock('../components/workspace/Terminal', () => ({
  TerminalView: ({
    wsId,
    sessionId,
    hideHeader,
  }: {
    wsId: string
    sessionId: string
    hideHeader?: boolean
  }) => (
    <div
      data-testid="terminal-view"
      data-ws-id={wsId}
      data-session-id={sessionId}
      data-hide-header={String(Boolean(hideHeader))}
    />
  ),
}))

vi.mock('../components/workspace/WebSessionView', () => ({
  WebSessionView: ({
    wsId,
    sessionId,
    hideHeader,
  }: {
    wsId: string
    sessionId: string
    hideHeader?: boolean
  }) => (
    <div
      data-testid="web-session-view"
      data-ws-id={wsId}
      data-session-id={sessionId}
      data-hide-header={String(Boolean(hideHeader))}
    />
  ),
}))

const runtimeIds = ['claude', 'codex', 'opencode', 'pi'] as const
const runtimeAgents: AgentInfo[] = [
  ['claude', 'Claude'],
  ['codex', 'Codex'],
  ['opencode', 'OpenCode'],
  ['pi', 'Pi'],
  ['shell', 'Shell'],
].map(([id, displayName]) => ({
  id,
  displayName,
  kind: id === 'shell' ? 'utility' : 'agent',
  installed: true,
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'none',
    ...(id === 'pi'
      ? { web: { wire: 'pi-rpc' as const, permissionPrompts: false, freshSession: true } }
      : id === 'claude'
        ? { web: { wire: 'claude-stream-json' as const, permissionPrompts: true, freshSession: true } }
        : {}),
    ...(id !== 'shell'
      ? {
          aiProvider: {
            credentialSource: id === 'opencode' || id === 'pi'
              ? 'workspace-required' as const
              : 'runtime-or-workspace' as const,
            wirePreference: id === 'claude'
              ? ['anthropic' as const]
              : id === 'codex'
                ? ['openai-responses' as const]
                : ['openai-chat' as const, 'anthropic' as const],
          },
        }
      : {}),
  },
}))

function commanderSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'commander-session-1',
    resumeId: 'commander-resume-1',
    wsId: COMMANDER_WORKSPACE_ID,
    agent: 'claude',
    name: 'c1',
    createdAt: '2026-11-27T00:00:00.000Z',
    lastActiveAt: '2026-11-27T00:00:00.000Z',
    state: 'running',
    surface: 'webpi',
    pid: 101,
    startedAt: 1000,
    title: 'Commander',
    ...overrides,
  }
}

function commanderSnapshot(overrides: Partial<CommanderSnapshot> = {}): CommanderSnapshot {
  return {
    id: COMMANDER_WORKSPACE_ID,
    tag: 'Commander',
    initialized: false,
    session: null,
    unreadReports: 0,
    activeWorkers: 0,
    activeWorkspaceCount: 2,
    ...overrides,
  }
}

function context(overrides: Partial<WorkspacesContextValue> = {}): WorkspacesContextValue {
  return {
    workspaces: [],
    templates: [],
    agents: runtimeAgents,
    defaultAgent: 'codex',
    issueDefaultAgent: null,
    listError: null,
    commander: commanderSnapshot(),
    commanderLoaded: true,
    commanderError: null,
    hasLoaded: true,
    templatesLoaded: true,
    templatesError: null,
    autoQuantDefaultWorkspaceId: null,
    autoQuantPreferenceLoaded: true,
    autoQuantPreferenceError: null,
    refresh: vi.fn(async () => undefined),
    refreshTemplates: vi.fn(async () => undefined),
    refreshAutoQuantPreference: vi.fn(async () => undefined),
    refreshCommander: mocks.refreshCommander,
    openCommander: mocks.openCommander,
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: mocks.setDefaultAgent,
    setIssueDefaultAgent: vi.fn(async () => undefined),
    initializeAutoQuant: vi.fn(async () => { throw new Error('not used') }),
    initializeChat: vi.fn(async () => { throw new Error('not used') }),
    setAutoQuantDefaultWorkspace: vi.fn(async () => undefined),
    quickChat: vi.fn(async () => ''),
    pauseSession: mocks.pauseSession,
    resumeSession: vi.fn(async () => undefined),
    openWebSession: vi.fn(async () => undefined),
    requestDeleteSession: vi.fn(),
    setSessionPresence: vi.fn(async () => undefined),
    setSessionDisplayName: mocks.setSessionDisplayName,
    updateSessionRuntime: mocks.updateSessionRuntime,
    openAgentConfig: mocks.openAgentConfig,
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
    ...overrides,
  }
}

function readiness() {
  return {
    agents: Object.fromEntries(runtimeIds.map((agent) => [agent, {
      agent,
      displayName: agent,
      installed: true,
      binPath: `/tmp/${agent}`,
      status: 'ready' as const,
      ready: true,
      source: agent === 'pi' ? 'managed-runtime' as const : 'global-login' as const,
      checkedAt: '2026-11-27T00:00:00.000Z',
      durationMs: 1,
    }])),
    overallReady: true,
    checkedAt: '2026-11-27T00:00:00.000Z',
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetAgentRuntimesStore()
  await i18n.changeLanguage('en')
  mocks.useWorkspaces.mockImplementation(() => context())
  mocks.getCommander.mockResolvedValue(commanderSnapshot())
  mocks.refreshCommander.mockResolvedValue(undefined)
  mocks.openCommander.mockResolvedValue({
    commander: commanderSnapshot({ initialized: true, session: commanderSession() }),
    session: commanderSession(),
    snapshot: null,
  })
  mocks.getAgentRuntimeReadiness.mockResolvedValue(readiness())
  mocks.probeAgentRuntimeReadiness.mockResolvedValue(readiness())
  mocks.listAgents.mockResolvedValue(runtimeAgents.filter((agent) => agent.kind !== 'utility'))
  mocks.listAgentCredentials.mockResolvedValue([])
  mocks.detectWorkspaceCredential.mockResolvedValue({
    configured: false,
    slug: null,
    model: null,
    contextWindow: null,
    wireShape: null,
  })
  mocks.getAgentReadiness.mockResolvedValue({ agents: {} })
  mocks.getWorkspaceCredentialDefaults.mockResolvedValue({
    defaults: {},
    compatibleByAgent: {},
  })
  mocks.getPresets.mockResolvedValue({ presets: [] })
  mocks.getQuickChat.mockResolvedValue({ lastCredentialByAgent: {}, recentChatWorkspaceId: null })
  mocks.rememberQuickChatLaunch.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('CommanderPage', () => {
  it('renders an accessible single-session initializer and submits via openCommander while respecting IME composition', async () => {
    render(<CommanderPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Commander' })).toBeTruthy()
    await screen.findByRole('button', { name: 'Select agent' })

    const composer = screen.getByLabelText('Message for Commander')
    fireEvent.change(composer, { target: { value: '检查今日定时报告' } })

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: true })
    expect(mocks.openCommander).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', keyCode: 229 })
    expect(mocks.openCommander).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: false })
    await waitFor(() => expect(mocks.openCommander).toHaveBeenCalledWith({
      prompt: '检查今日定时报告',
      agent: 'codex',
    }))
  })

  it('populates the prompt composer from executive starter cards and opens AI config when uninitialized', async () => {
    render(<CommanderPage />)
    await screen.findByRole('button', { name: 'Select agent' })

    fireEvent.click(screen.getByRole('button', { name: /Triage schedules & reports/i }))
    const composer = screen.getByLabelText('Message for Commander') as HTMLTextAreaElement
    expect(composer.value).toContain('scheduled runs')

    fireEvent.click(screen.getByRole('button', { name: 'Commander AI settings' }))
    expect(mocks.openAgentConfig).toHaveBeenCalledWith(COMMANDER_WORKSPACE_ID, 'codex', 'ai')
  })

  it('immediately mounts the persistent WebSessionView, shows live status, links to Dispatch, and opens SessionSettingsDialog', () => {
    const session = commanderSession({ state: 'running', surface: 'webpi' })
    mocks.useWorkspaces.mockImplementation(() => context({
      commander: commanderSnapshot({
        initialized: true,
        session,
        activeWorkers: 2,
        unreadReports: 1,
      }),
    }))

    render(<CommanderPage />)

    const webView = screen.getByTestId('web-session-view')
    expect(webView.dataset.wsId).toBe(COMMANDER_WORKSPACE_ID)
    expect(webView.dataset.sessionId).toBe(session.id)
    expect(webView.dataset.hideHeader).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('Coordinating 2 workers')

    fireEvent.click(screen.getByRole('button', { name: 'Issues & Dispatch' }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('issue')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'issue', params: {} })

    fireEvent.click(screen.getByRole('button', { name: 'Commander AI settings' }))
    expect(screen.getByTestId('session-settings-dialog').dataset.sessionId).toBe(session.id)
  })

  it('mounts TerminalView when the persistent Commander session is running in terminal mode', () => {
    const session = commanderSession({ agent: 'opencode', state: 'running', surface: 'terminal' })
    mocks.useWorkspaces.mockImplementation(() => context({
      commander: commanderSnapshot({
        initialized: true,
        session,
        unreadReports: 3,
      }),
    }))

    render(<CommanderPage />)

    const terminalView = screen.getByTestId('terminal-view')
    expect(terminalView.dataset.wsId).toBe(COMMANDER_WORKSPACE_ID)
    expect(terminalView.dataset.sessionId).toBe(session.id)
    expect(terminalView.dataset.hideHeader).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('3 pending reports')
  })

  it('auto-opens a paused Web-capable Commander session via openCommander', async () => {
    const session = commanderSession({ agent: 'claude', state: 'paused', surface: 'webpi' })
    mocks.useWorkspaces.mockImplementation(() => context({
      commander: commanderSnapshot({
        initialized: true,
        session,
      }),
    }))

    render(<CommanderPage />)

    await waitFor(() => expect(mocks.openCommander).toHaveBeenCalledOnce())
  })

  it('renders a Resume Commander action for a paused TUI-only Commander session', async () => {
    const session = commanderSession({ agent: 'opencode', state: 'paused', surface: 'terminal' })
    mocks.useWorkspaces.mockImplementation(() => context({
      commander: commanderSnapshot({
        initialized: true,
        session,
      }),
    }))

    render(<CommanderPage />)

    expect(mocks.openCommander).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Resume Commander' }))
    await waitFor(() => expect(mocks.openCommander).toHaveBeenCalledOnce())
  })

  it('surfaces load errors with an alert and retry button', async () => {
    mocks.useWorkspaces.mockImplementation(() => context({
      commander: null,
      commanderLoaded: true,
      commanderError: 'Commander snapshot unavailable',
    }))

    render(<CommanderPage />)

    expect(screen.getByRole('alert').textContent).toContain('Commander snapshot unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mocks.refreshCommander).toHaveBeenCalledOnce())
  })
})
