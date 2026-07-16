// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacesContextValue } from '../contexts/workspaces-context'
import type { AgentInfo, ManagerWorkspaceSnapshot, SessionRecord } from '../components/workspace/api'
import { i18n } from '../i18n'
import { WorkspaceManagerPage } from './WorkspaceManagerPage'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  openOrFocus: vi.fn(),
  setDefaultAgent: vi.fn(),
  getWorkspaceManager: vi.fn(),
  getAgentRuntimeReadiness: vi.fn(),
  probeAgentRuntimeReadiness: vi.fn(),
  listAgentCredentials: vi.fn(),
  detectWorkspaceCredential: vi.fn(),
  getAgentReadiness: vi.fn(),
  getWorkspaceCredentialDefaults: vi.fn(),
  quickStartWorkspaceManager: vi.fn(),
  openWebPiSession: vi.fn(),
  resumeSession: vi.fn(),
  getQuickChat: vi.fn(),
  rememberQuickChatCredential: vi.fn(),
  openAgentConfig: vi.fn(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => mocks.useWorkspaces(),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return {
    ...actual,
    getWorkspaceManager: mocks.getWorkspaceManager,
    getAgentRuntimeReadiness: mocks.getAgentRuntimeReadiness,
    probeAgentRuntimeReadiness: mocks.probeAgentRuntimeReadiness,
    listAgentCredentials: mocks.listAgentCredentials,
    detectWorkspaceCredential: mocks.detectWorkspaceCredential,
    getAgentReadiness: mocks.getAgentReadiness,
    quickStartWorkspaceManager: mocks.quickStartWorkspaceManager,
    openWebPiSession: mocks.openWebPiSession,
    resumeSession: mocks.resumeSession,
  }
})

vi.mock('../api/preferences', () => ({
  preferencesApi: {
    getQuickChat: mocks.getQuickChat,
    rememberQuickChatCredential: mocks.rememberQuickChatCredential,
  },
}))

vi.mock('../api/config', () => ({
  configApi: {
    getWorkspaceCredentialDefaults: mocks.getWorkspaceCredentialDefaults,
  },
}))

vi.mock('../components/workspace/Terminal', () => ({
  TerminalView: () => <div data-testid="terminal-view" />,
}))

vi.mock('../components/workspace/WebPiView', () => ({
  WebPiView: () => <div data-testid="webpi-view" />,
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
  },
}))

function managerSnapshot(sessions: readonly SessionRecord[] = []): ManagerWorkspaceSnapshot {
  return {
    id: 'workspace-manager',
    tag: 'Workspace Manager',
    activeWorkspaceCount: 2,
    sessions,
  }
}

function context(
  defaultAgent: string,
  workspaceManager: ManagerWorkspaceSnapshot = managerSnapshot(),
): WorkspacesContextValue {
  return {
    workspaces: [],
    templates: [],
    agents: runtimeAgents,
    defaultAgent,
    issueDefaultAgent: null,
    listError: null,
    workspaceManager,
    workspaceManagerLoaded: true,
    workspaceManagerError: null,
    hasLoaded: true,
    templatesLoaded: true,
    refresh: vi.fn(),
    refreshWorkspaceManager: vi.fn(async () => undefined),
    quickStartWorkspaceManager: mocks.quickStartWorkspaceManager,
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: mocks.setDefaultAgent,
    setIssueDefaultAgent: vi.fn(async () => undefined),
    quickChat: vi.fn(async () => ''),
    pauseSession: vi.fn(async () => undefined),
    resumeSession: mocks.resumeSession,
    openWebPiSession: mocks.openWebPiSession,
    requestDeleteSession: vi.fn(),
    openAgentConfig: mocks.openAgentConfig,
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
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
      checkedAt: '2026-07-16T00:00:00.000Z',
      durationMs: 1,
    }])),
    overallReady: true,
    checkedAt: '2026-07-16T00:00:00.000Z',
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.useWorkspaces.mockImplementation(() => context('codex'))
  mocks.getWorkspaceManager.mockResolvedValue(managerSnapshot())
  mocks.getAgentRuntimeReadiness.mockResolvedValue(readiness())
  mocks.probeAgentRuntimeReadiness.mockResolvedValue(readiness())
  mocks.listAgentCredentials.mockResolvedValue([])
  mocks.detectWorkspaceCredential.mockResolvedValue({
    slug: null,
    model: null,
    contextWindow: null,
    wireShape: null,
  })
  mocks.getAgentReadiness.mockResolvedValue({ agents: {} })
  mocks.getWorkspaceCredentialDefaults.mockResolvedValue({
    defaults: {},
    compatibleByAgent: {},
    contextWindow: 256_000,
  })
  mocks.getQuickChat.mockResolvedValue({ lastCredentialByAgent: {}, recentChatWorkspaceId: null })
  mocks.rememberQuickChatCredential.mockResolvedValue(undefined)
  mocks.openWebPiSession.mockResolvedValue(undefined)
  mocks.resumeSession.mockResolvedValue(undefined)
  mocks.quickStartWorkspaceManager.mockResolvedValue({
    manager: managerSnapshot(),
    session: {
      id: 'manager-session',
      resumeId: 'manager-resume',
      wsId: 'workspace-manager',
      agent: 'claude',
      name: 'c1',
      createdAt: '2026-07-16T00:00:00.000Z',
      lastActiveAt: '2026-07-16T00:00:00.000Z',
      state: 'running',
      surface: 'terminal',
      pid: 1,
      startedAt: 1,
      title: 'Inspect the floor.',
    },
    snapshot: null,
  })
})

afterEach(cleanup)

describe('WorkspaceManagerPage runtime selection', () => {
  it('uses the Quick Chat runtime catalog and launches the selected native runtime', async () => {
    render(<WorkspaceManagerPage spec={{ kind: 'workspace-manager', params: {} }} />)

    const picker = await screen.findByRole('button', { name: 'Select agent' })
    expect(picker.textContent).toContain('Codex')
    expect(screen.getByText('Model and context are managed by Codex')).toBeTruthy()
    fireEvent.click(picker)

    for (const name of ['Claude', 'Codex', 'OpenCode', 'Pi']) {
      expect(screen.getByRole('menuitem', { name })).toBeTruthy()
    }
    expect(screen.queryByRole('menuitem', { name: 'Shell' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Claude' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Inspect the floor.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start manager' }))

    await waitFor(() => expect(mocks.quickStartWorkspaceManager).toHaveBeenCalledWith(
      'Inspect the floor.',
      'claude',
      undefined,
    ))
    expect(mocks.setDefaultAgent).toHaveBeenCalledWith('claude')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace-manager',
      params: { sessionId: 'manager-session' },
    })
  })

  it('shows and launches the Manager workspace model/context from the shared config', async () => {
    mocks.useWorkspaces.mockImplementation(() => context('pi'))
    mocks.listAgentCredentials.mockResolvedValue([
      {
        slug: 'google-1',
        label: 'Gemini',
        vendor: 'google',
        authType: 'api-key',
        wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
        resolvedModel: 'gemini-3.1-flash-lite',
      },
      {
        slug: 'deepseek-1',
        label: 'DeepSeek',
        vendor: 'deepseek',
        authType: 'api-key',
        wires: { 'openai-chat': 'https://api.deepseek.com' },
        resolvedModel: 'deepseek-chat',
      },
    ])
    mocks.getQuickChat.mockResolvedValue({
      lastCredentialByAgent: { pi: 'deepseek-1' },
      recentChatWorkspaceId: null,
    })
    mocks.detectWorkspaceCredential.mockResolvedValue({
      slug: 'google-1',
      model: 'gemini-3.1-flash-lite',
      contextWindow: 256_000,
      wireShape: 'google-generative-ai',
    })
    mocks.getAgentReadiness.mockResolvedValue({
      agents: {
        pi: {
          agent: 'pi',
          ready: true,
          requiresCredential: true,
          source: 'workspace-config',
          hasWorkspaceConfig: true,
          hasUsableWorkspaceConfig: true,
          detectedCredentialSlug: 'google-1',
          compatibleCredentialSlugs: ['google-1'],
          injectableCredentialSlugs: ['google-1'],
        },
      },
    })

    render(<WorkspaceManagerPage spec={{ kind: 'workspace-manager', params: {} }} />)

    expect((await screen.findByRole('button', { name: 'AI provider' })).textContent).toContain('Gemini')
    expect(screen.getByLabelText('Model gemini-3.1-flash-lite')).toBeTruthy()
    expect(screen.getByLabelText('256K context')).toBeTruthy()
    expect(screen.queryByText('Agent runtime')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Adjust workspace AI' }))
    expect(mocks.openAgentConfig).toHaveBeenCalledWith('workspace-manager', 'pi', 'ai')

    fireEvent.click(screen.getByRole('button', { name: 'AI provider' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /DeepSeek/ }))
    expect(screen.getByLabelText('Model deepseek-chat')).toBeTruthy()
    expect(mocks.rememberQuickChatCredential).toHaveBeenCalledWith('pi', 'deepseek-1')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Audit issues.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start manager' }))

    await waitFor(() => expect(mocks.quickStartWorkspaceManager).toHaveBeenCalledWith(
      'Audit issues.',
      'pi',
      'deepseek-1',
    ))
  })

  it('does not flash a fallback credential before remembered preferences resolve', async () => {
    mocks.useWorkspaces.mockImplementation(() => context('pi'))
    mocks.listAgentCredentials.mockResolvedValue([{
      slug: 'google-1',
      label: 'Gemini',
      vendor: 'google',
      authType: 'api-key',
      wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
      resolvedModel: 'gemini-3.1-flash-lite',
    }])
    let resolvePreferences!: (value: {
      lastCredentialByAgent: Record<string, string>
      recentChatWorkspaceId: string | null
    }) => void
    mocks.getQuickChat.mockReturnValue(new Promise((resolve) => {
      resolvePreferences = resolve
    }))

    render(<WorkspaceManagerPage spec={{ kind: 'workspace-manager', params: {} }} />)

    await waitFor(() => expect(mocks.listAgentCredentials).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'AI provider' }).textContent).toContain('AI provider')
    expect(screen.queryByText('Gemini')).toBeNull()
    expect(screen.queryByLabelText('Model gemini-3.1-flash-lite')).toBeNull()

    await act(async () => {
      resolvePreferences({ lastCredentialByAgent: { pi: 'google-1' }, recentChatWorkspaceId: null })
    })
    expect((await screen.findByRole('button', { name: 'AI provider' })).textContent).toContain('Gemini')
  })

  it('shows model/context for a usable hand-edited Manager config without a vault credential', async () => {
    mocks.useWorkspaces.mockImplementation(() => context('pi'))
    mocks.detectWorkspaceCredential.mockResolvedValue({
      slug: null,
      model: 'local-manual-model',
      contextWindow: 128_000,
      wireShape: 'openai-chat',
    })
    mocks.getAgentReadiness.mockResolvedValue({
      agents: {
        pi: {
          agent: 'pi',
          ready: true,
          requiresCredential: true,
          source: 'workspace-config',
          hasWorkspaceConfig: true,
          hasUsableWorkspaceConfig: true,
          detectedCredentialSlug: null,
          compatibleCredentialSlugs: [],
          injectableCredentialSlugs: [],
        },
      },
    })

    render(<WorkspaceManagerPage spec={{ kind: 'workspace-manager', params: {} }} />)

    expect(await screen.findByLabelText('Model local-manual-model')).toBeTruthy()
    expect(screen.getByLabelText('128K context')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'AI provider' })).toBeNull()
  })

  it('keeps a paused non-Pi Manager Session stopped until the user resumes it', async () => {
    const session: SessionRecord = {
      id: 'manager-codex',
      resumeId: 'manager-codex-resume',
      wsId: 'workspace-manager',
      agent: 'codex',
      name: 'x1',
      createdAt: '2026-07-16T00:00:00.000Z',
      lastActiveAt: '2026-07-16T00:00:00.000Z',
      state: 'paused',
      surface: 'terminal',
      pid: null,
      startedAt: null,
      title: 'Resume native manager',
    }
    const snapshot = managerSnapshot([session])
    mocks.useWorkspaces.mockImplementation(() => context('codex', snapshot))

    const { container } = render(<WorkspaceManagerPage spec={{
      kind: 'workspace-manager',
      params: { sessionId: session.id },
    }} />)

    expect(mocks.resumeSession).not.toHaveBeenCalled()
    expect(screen.queryByTestId('terminal-view')).toBeNull()
    expect(container.firstElementChild?.classList.contains('workspaces-root')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Continue in terminal' }))

    expect(mocks.resumeSession).toHaveBeenCalledWith(
      'workspace-manager',
      session.id,
    )
    expect(mocks.openWebPiSession).not.toHaveBeenCalled()
  })

  it('reopens a paused Pi Manager Session in its saved WebPi surface', () => {
    const session: SessionRecord = {
      id: 'manager-pi',
      resumeId: 'manager-pi-resume',
      wsId: 'workspace-manager',
      agent: 'pi',
      name: 'p1',
      createdAt: '2026-07-16T00:00:00.000Z',
      lastActiveAt: '2026-07-16T00:00:00.000Z',
      state: 'paused',
      surface: 'webpi',
      pid: null,
      startedAt: null,
      title: 'Resume WebPi manager',
    }
    mocks.useWorkspaces.mockImplementation(() => context('pi', managerSnapshot([session])))

    render(<WorkspaceManagerPage spec={{
      kind: 'workspace-manager',
      params: { sessionId: session.id },
    }} />)

    expect(mocks.openWebPiSession).not.toHaveBeenCalled()
    const openWebPi = screen.getByText('Open WebPi').closest('button')
    expect(openWebPi).toBeTruthy()
    fireEvent.click(openWebPi as HTMLButtonElement)

    expect(mocks.openWebPiSession).toHaveBeenCalledWith('workspace-manager', session.id)
    expect(mocks.resumeSession).not.toHaveBeenCalled()
  })
})
