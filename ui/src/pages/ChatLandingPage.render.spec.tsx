// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacesContextValue } from '../contexts/workspaces-context'
import { i18n } from '../i18n'
import type { AgentInfo, Workspace } from '../components/workspace/api'
import { AutoQuantLandingPage, ChatLandingPage } from './ChatLandingPage'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  openOrFocus: vi.fn(),
  listAgentCredentials: vi.fn(),
  detectWorkspaceCredential: vi.fn(),
  getAgentReadiness: vi.fn(),
  getAgentRuntimeReadiness: vi.fn(),
  probeAgentRuntimeReadiness: vi.fn(),
  getWorkspaceCredentialDefaults: vi.fn(),
  getQuickChat: vi.fn(),
  quickChat: vi.fn(),
  rememberRecentChatWorkspace: vi.fn(),
  rememberQuickChatCredential: vi.fn(),
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
    listAgentCredentials: mocks.listAgentCredentials,
    detectWorkspaceCredential: mocks.detectWorkspaceCredential,
    getAgentReadiness: mocks.getAgentReadiness,
    getAgentRuntimeReadiness: mocks.getAgentRuntimeReadiness,
    probeAgentRuntimeReadiness: mocks.probeAgentRuntimeReadiness,
  }
})

vi.mock('../api/config', () => ({
  configApi: {
    getWorkspaceCredentialDefaults: mocks.getWorkspaceCredentialDefaults,
  },
}))

vi.mock('../api/preferences', () => ({
  preferencesApi: {
    getQuickChat: mocks.getQuickChat,
    rememberRecentChatWorkspace: mocks.rememberRecentChatWorkspace,
    rememberQuickChatCredential: mocks.rememberQuickChatCredential,
  },
}))

const piAgent: AgentInfo = {
  id: 'pi',
  displayName: 'Pi',
  kind: 'agent',
  installed: true,
  capabilities: {
    parallelPerCwd: false,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'fs-watch',
    aiProvider: {
      credentialSource: 'workspace-required',
      wirePreference: ['google-generative-ai', 'openai-chat', 'anthropic', 'openai-responses'],
      modelRegistration: { contextWindow: true, reasoning: true },
    },
  },
}

const opencodeAgent: AgentInfo = {
  ...piAgent,
  id: 'opencode',
  displayName: 'opencode',
}

function chatWorkspace(): Workspace {
  return {
    id: 'chat-1',
    tag: 'chat-jul16',
    dir: '/tmp/chat-jul16',
    createdAt: '2026-07-16T00:00:00.000Z',
    template: 'chat',
    sessions: [],
  }
}

function context(
  workspaces: readonly Workspace[],
  autoQuantDefaultWorkspaceId: string | null = null,
): WorkspacesContextValue {
  return {
    workspaces,
    templates: [],
    agents: [piAgent, opencodeAgent],
    defaultAgent: 'pi',
    issueDefaultAgent: null,
    listError: null,
    workspaceManager: null,
    workspaceManagerLoaded: true,
    workspaceManagerError: null,
    hasLoaded: true,
    templatesLoaded: true,
    templatesError: null,
    autoQuantDefaultWorkspaceId,
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
    quickChat: mocks.quickChat,
    pauseSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => undefined),
    openWebPiSession: vi.fn(async () => undefined),
    requestDeleteSession: vi.fn(),
    openAgentConfig: vi.fn(),
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
  }
}

let workspaces: Workspace[]

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  workspaces = [chatWorkspace()]
  mocks.useWorkspaces.mockImplementation(() => context(workspaces))
  mocks.listAgentCredentials.mockResolvedValue([{
    slug: 'google-1',
    vendor: 'google',
    authType: 'api-key',
    wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
    resolvedModel: 'gemini-3.1-flash-lite',
    resolvedReasoning: true,
    resolvedReasoningEffort: 'minimal',
    resolvedReasoningMode: 'adaptive',
  }])
  mocks.detectWorkspaceCredential.mockResolvedValue({
    configured: true,
    slug: 'google-1',
    model: 'gemini-3.1-flash-lite',
    contextWindow: 256_000,
    wireShape: 'google-generative-ai',
    reasoning: true,
    reasoningEffort: 'minimal',
    reasoningMode: 'adaptive',
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
  mocks.getAgentRuntimeReadiness.mockResolvedValue({
    agents: {
      pi: {
        agent: 'pi',
        displayName: 'Pi',
        installed: true,
        binPath: '/tmp/pi',
        status: 'ready',
        ready: true,
        source: 'workspace-override',
        checkedAt: '2026-07-16T00:00:00.000Z',
        durationMs: 1,
      },
    },
    overallReady: true,
    checkedAt: '2026-07-16T00:00:00.000Z',
  })
  mocks.probeAgentRuntimeReadiness.mockImplementation(() => mocks.getAgentRuntimeReadiness())
  mocks.getWorkspaceCredentialDefaults.mockResolvedValue({
    defaults: {},
    compatibleByAgent: { pi: ['google-1'] },
  })
  mocks.getQuickChat.mockResolvedValue({
    lastCredentialByAgent: {},
    recentChatWorkspaceId: 'chat-1',
  })
  mocks.quickChat.mockResolvedValue('chat-1')
  mocks.rememberRecentChatWorkspace.mockResolvedValue(undefined)
  mocks.rememberQuickChatCredential.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('ChatLandingPage polling stability', () => {
  it('does not re-run credential detection when a poll replaces the Workspace object with the same id', async () => {
    const view = render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    await waitFor(() => expect(mocks.detectWorkspaceCredential).toHaveBeenCalledTimes(1))

    await act(async () => {
      workspaces = structuredClone(workspaces)
      view.rerender(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)
    })

    expect(mocks.detectWorkspaceCredential).toHaveBeenCalledTimes(1)
    expect(mocks.getAgentReadiness).toHaveBeenCalledTimes(1)
  })
})

describe('ChatLandingPage compact-height layout', () => {
  it('pins overflow to the reachable top edge while centering content when room allows', () => {
    render(<ChatLandingPage spec={{ params: {} }} />)

    const scrollArea = screen.getByTestId('harness-landing-scroll')
    const stack = screen.getByTestId('harness-landing-stack')
    const controls = screen.getByTestId('harness-landing-controls')
    const composer = screen.getByPlaceholderText('Ask Alice…')

    expect(scrollArea.className).toContain('justify-start')
    expect(scrollArea.className).toContain('overflow-x-hidden')
    expect(scrollArea.className).toContain('overflow-y-auto')
    expect(stack.className).toContain('my-auto')
    expect(composer.className).toContain('min-h-[72px]')
    expect(controls.className).toContain('items-end')
    expect(controls.className).not.toContain('flex-col')
    expect(controls.lastElementChild?.className).toContain('shrink-0')
  })

  it('shares the compact-height contract with the AutoQuant landing', () => {
    const autoQuantWorkspace: Workspace = {
      ...chatWorkspace(),
      id: 'auto-quant-1',
      tag: 'quant-desk',
      template: 'auto-quant-v2',
    }
    workspaces = [autoQuantWorkspace]
    mocks.useWorkspaces.mockImplementation(() => context(workspaces, autoQuantWorkspace.id))

    render(<AutoQuantLandingPage spec={{ params: {} }} />)

    expect(screen.getByTestId('harness-landing-scroll').className).toContain('justify-start')
    expect(screen.getByTestId('harness-landing-stack').className).toContain('my-auto')
    expect(screen.getByPlaceholderText('Describe the strategy, market, hypothesis, or iteration goal…').className)
      .toContain('min-h-[72px]')
  })
})

describe('ChatLandingPage Workspace inventory states', () => {
  it('shows a recovery surface instead of a fake new-Workspace composer after the first list failure', () => {
    const failed = {
      ...context([]),
      hasLoaded: false,
      listError: 'list failed: 500',
    }
    mocks.useWorkspaces.mockReturnValue(failed)

    render(<ChatLandingPage spec={{ params: {} }} />)

    expect(screen.getByRole('heading', { name: 'Workspace data is unavailable' })).toBeTruthy()
    expect(screen.queryByPlaceholderText('Ask Alice…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(failed.refresh).toHaveBeenCalledOnce()
  })

  it('keeps the composer available with an explicit stale-data notice after a later refresh fails', () => {
    mocks.useWorkspaces.mockReturnValue({
      ...context(workspaces),
      listError: 'list failed: 500',
    })

    render(<ChatLandingPage spec={{ params: {} }} />)

    expect(screen.getByText('Live refresh failed. Showing the last known Workspace data.')).toBeTruthy()
    expect(screen.getByPlaceholderText('Ask Alice…')).toBeTruthy()
  })
})

describe('ChatLandingPage adapter inventory', () => {
  it('offers installation-level runtimes regardless of Workspace age', async () => {
    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select agent' }))

    expect(screen.getByRole('menuitem', { name: /Pi/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /opencode/ })).toBeTruthy()
  })
})

describe('ChatLandingPage keyboard submission', () => {
  it('does not submit when Enter confirms an IME composition candidate', async () => {
    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    await screen.findByLabelText('Model gemini-3.1-flash-lite')
    const composer = screen.getByPlaceholderText('Ask Alice…')
    fireEvent.change(composer, { target: { value: '你好' } })

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: true })
    expect(mocks.quickChat).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: false })
    await waitFor(() => expect(mocks.quickChat).toHaveBeenCalledWith(
      '你好',
      'pi',
      'google-1',
      'chat-1',
      'chat',
    ))
  })

  it('shows the runtime provider error and does not create a chat session', async () => {
    mocks.getAgentRuntimeReadiness.mockResolvedValue({
      agents: {
        pi: {
          agent: 'pi',
          displayName: 'Pi',
          installed: true,
          binPath: '/tmp/pi',
          status: 'unknown',
          ready: false,
          source: 'unknown',
          checkedAt: null,
          durationMs: null,
        },
      },
      overallReady: false,
      checkedAt: null,
    })
    mocks.probeAgentRuntimeReadiness.mockResolvedValue({
      agents: {
        pi: {
          agent: 'pi',
          displayName: 'Pi',
          installed: true,
          binPath: '/tmp/pi',
          status: 'failed',
          ready: false,
          source: 'launcher-vault',
          checkedAt: '2026-08-02T00:00:00.000Z',
          durationMs: 10,
          repairTarget: 'retry',
          message: 'The runtime reported an error: 429: balance exhausted',
        },
      },
      overallReady: false,
      checkedAt: '2026-08-02T00:00:00.000Z',
    })

    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    await screen.findByLabelText('Model gemini-3.1-flash-lite')
    fireEvent.change(screen.getByPlaceholderText('Ask Alice…'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('The runtime reported an error: 429: balance exhausted')).toBeTruthy()
    expect(mocks.quickChat).not.toHaveBeenCalled()
  })
})

describe('ChatLandingPage AI source disclosure', () => {
  it('keeps an existing Workspace source implicit so the model leads the metadata row', async () => {
    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect(await screen.findByLabelText('Model gemini-3.1-flash-lite')).toBeTruthy()
    expect(screen.queryByText('Saved in this workspace')).toBeNull()
    expect(screen.queryByText(/Sending will configure this workspace/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Adjust workspace AI' })).toBeTruthy()
    expect(screen.getByLabelText('minimal reasoning')).toBeTruthy()
  })

  it('labels a vault fallback as a pending write instead of existing Workspace config', async () => {
    mocks.detectWorkspaceCredential.mockResolvedValue({
      configured: false,
      slug: null,
      model: null,
      contextWindow: null,
      wireShape: null,
    })
    mocks.getAgentReadiness.mockResolvedValue({
      agents: {
        pi: {
          agent: 'pi',
          ready: true,
          requiresCredential: true,
          source: 'launcher-vault',
          hasWorkspaceConfig: false,
          hasUsableWorkspaceConfig: false,
          detectedCredentialSlug: null,
          compatibleCredentialSlugs: ['google-1'],
          injectableCredentialSlugs: ['google-1'],
        },
      },
    })

    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect(await screen.findByText('Sending will configure this workspace with the selected AI provider.')).toBeTruthy()
    expect(screen.getByLabelText('Model gemini-3.1-flash-lite')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Configure workspace AI' })).toBeTruthy()
    expect(screen.getByLabelText('minimal reasoning')).toBeTruthy()
  })

  it('shows a required reasoning policy when the provider has no effort tiers', async () => {
    mocks.listAgentCredentials.mockResolvedValue([{
      slug: 'kimi-1',
      vendor: 'kimi',
      authType: 'api-key',
      wires: { 'openai-chat': 'https://api.moonshot.ai/v1' },
      resolvedModel: 'kimi-k2.7-code',
      resolvedReasoning: true,
      resolvedReasoningMode: 'required',
    }])
    mocks.detectWorkspaceCredential.mockResolvedValue({
      configured: false,
      slug: null,
      model: null,
      contextWindow: null,
      wireShape: null,
    })
    mocks.getAgentReadiness.mockResolvedValue({
      agents: {
        pi: {
          agent: 'pi',
          ready: true,
          requiresCredential: true,
          source: 'launcher-vault',
          hasWorkspaceConfig: false,
          hasUsableWorkspaceConfig: false,
          detectedCredentialSlug: null,
          compatibleCredentialSlugs: ['kimi-1'],
          injectableCredentialSlugs: ['kimi-1'],
        },
      },
    })

    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect(await screen.findByLabelText('Reasoning always on')).toBeTruthy()
    expect(screen.getByLabelText('Model kimi-k2.7-code')).toBeTruthy()
  })

  it('replaces a transient provider choice with the Workspace config saved in Settings', async () => {
    mocks.listAgentCredentials.mockResolvedValue([
      {
        slug: 'google-1',
        vendor: 'google',
        authType: 'api-key',
        wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
        resolvedModel: 'gemini-3.1-flash-lite',
      },
      {
        slug: 'deepseek-1',
        vendor: 'deepseek',
        authType: 'api-key',
        wires: { 'openai-chat': 'https://api.deepseek.com/v1' },
        resolvedModel: 'deepseek-v3.2',
      },
    ])

    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect(await screen.findByLabelText('Model gemini-3.1-flash-lite')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'AI provider' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /deepseek-1/ }))
    expect(await screen.findByLabelText('Model deepseek-v3.2')).toBeTruthy()

    mocks.detectWorkspaceCredential.mockResolvedValue({
      configured: true,
      slug: 'google-1',
      model: 'gemini-3.1-pro-preview',
      contextWindow: 512_000,
      wireShape: 'google-generative-ai',
    })
    window.dispatchEvent(new CustomEvent('openalice:workspace-agent-config-changed', {
      detail: { wsId: 'chat-1', agent: 'pi' },
    }))

    expect(await screen.findByLabelText('Model gemini-3.1-pro-preview')).toBeTruthy()
    expect(screen.queryByLabelText('Model deepseek-v3.2')).toBeNull()
    expect(mocks.detectWorkspaceCredential).toHaveBeenCalledTimes(2)
  })
})
