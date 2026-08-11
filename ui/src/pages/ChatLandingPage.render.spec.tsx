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
  getPresets: vi.fn(),
  getQuickChat: vi.fn(),
  quickChat: vi.fn(),
  rememberRecentChatWorkspace: vi.fn(),
  rememberQuickChatLaunch: vi.fn(),
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
    getPresets: mocks.getPresets,
  },
}))

vi.mock('../api/preferences', () => ({
  preferencesApi: {
    getQuickChat: mocks.getQuickChat,
    rememberRecentChatWorkspace: mocks.rememberRecentChatWorkspace,
    rememberQuickChatLaunch: mocks.rememberQuickChatLaunch,
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

const codexAgent: AgentInfo = {
  ...piAgent,
  id: 'codex',
  displayName: 'Codex',
  capabilities: {
    ...piAgent.capabilities,
    aiProvider: {
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['openai-responses'],
    },
  },
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

function withInteractivePreference(
  workspace: Workspace,
  preference: NonNullable<Workspace['runtimeSettings']>['runtime']['interactive']['agents'][string],
  agent = 'pi',
): Workspace {
  return {
    ...workspace,
    defaultAgent: agent,
    runtimeSettings: {
      version: 3,
      runtime: {
        interactive: { agents: {}, recent: { agent, agents: { [agent]: preference } } },
        headless: { agents: {}, recent: { agents: {} } },
      },
    },
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

async function findInferenceTrigger(model: string): Promise<HTMLButtonElement> {
  const trigger = await screen.findByRole('button', { name: 'Model and reasoning' }) as HTMLButtonElement
  await waitFor(() => {
    expect(trigger.textContent).toContain(model)
  })
  return trigger
}

function expectDefaultEffort(label: string): void {
  expect(screen.getByRole('button', { name: 'Model and reasoning' }).textContent).toContain(label)
}

async function openInferenceSubmenu(label: 'Model' | 'Effort'): Promise<void> {
  const trigger = await screen.findByRole('button', { name: 'Model and reasoning' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(label) }))
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
  mocks.getPresets.mockResolvedValue({ presets: [] })
  mocks.getQuickChat.mockResolvedValue({
    lastCredentialByAgent: {},
    recentChatWorkspaceId: 'chat-1',
  })
  mocks.quickChat.mockResolvedValue('chat-1')
  mocks.rememberRecentChatWorkspace.mockResolvedValue(undefined)
  mocks.rememberQuickChatLaunch.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('ChatLandingPage polling stability', () => {
  it('does not inspect deprecated native config when a poll replaces the Workspace object with the same id', async () => {
    const view = render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect(await screen.findByRole('button', { name: 'AI access' })).toBeTruthy()
    expect(mocks.detectWorkspaceCredential).not.toHaveBeenCalled()

    await act(async () => {
      workspaces = structuredClone(workspaces)
      view.rerender(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)
    })

    expect(mocks.detectWorkspaceCredential).not.toHaveBeenCalled()
    expect(mocks.getAgentReadiness).not.toHaveBeenCalled()
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

  it('separates Session context from the AI inference controls', async () => {
    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    const contextRow = screen.getByTestId('harness-landing-context')
    const inferenceRow = screen.getByTestId('harness-landing-controls')
    expect(contextRow.contains(await screen.findByRole('button', { name: 'Choose Chat workspace' }))).toBe(true)
    expect(contextRow.contains(screen.getByRole('button', { name: 'Select agent' }))).toBe(true)
    expect(inferenceRow.contains(await screen.findByRole('button', { name: 'AI access' }))).toBe(true)
    expect(inferenceRow.contains(screen.getByRole('button', { name: 'Model and reasoning' }))).toBe(true)
    expect(inferenceRow.querySelectorAll('button').length).toBe(4)
    expect(screen.queryByRole('combobox', { name: 'AI model' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull()
  })
})

describe('ChatLandingPage suggestion strip', () => {
  it('separates the label from the staggered prompt actions and fills the composer', () => {
    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    const strip = screen.getByTestId('harness-landing-suggestions')
    expect(strip.textContent).toContain('Try asking')
    const suggestions = strip.querySelectorAll<HTMLButtonElement>('button.oa-suggestion-enter')
    expect(suggestions).toHaveLength(3)
    expect(suggestions[0]?.className).toContain('oa-suggestion-enter')
    expect(suggestions[1]?.style.animationDelay).toBe('55ms')
    expect(suggestions[0]?.textContent).toContain("Read today's cross-asset signals")

    fireEvent.click(suggestions[0]!)
    expect((screen.getByPlaceholderText('Ask Alice…') as HTMLTextAreaElement).value)
      .toContain("Read today's macro backdrop")

    fireEvent.click(screen.getByRole('button', { name: 'More ideas' }))
    expect(strip.textContent).toContain('Find what actually needs follow-up')
    expect(strip.textContent).toContain('Turn research into a scheduled Issue')
    expect(strip.textContent).toContain('Delegate a reproducible study')
    expect(strip.textContent).not.toContain("Read today's cross-asset signals")
  })
})

describe('ChatLandingPage keyboard submission', () => {
  it('does not submit when Enter confirms an IME composition candidate', async () => {
    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    await screen.findByRole('button', { name: 'Model and reasoning' })
    const composer = screen.getByPlaceholderText('Ask Alice…')
    fireEvent.change(composer, { target: { value: '你好' } })

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: true })
    expect(mocks.quickChat).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: false })
    await waitFor(() => expect(mocks.quickChat).toHaveBeenCalledWith(
      '你好',
      'pi',
      undefined,
      'chat-1',
      'chat',
      undefined,
      undefined,
      'native',
    ))
  })

  it('does not let a diagnostic readiness failure block a native chat launch', async () => {
    const nativePiAgent: AgentInfo = {
      ...piAgent,
      capabilities: {
        ...piAgent.capabilities,
        aiProvider: {
          ...piAgent.capabilities.aiProvider!,
          credentialSource: 'runtime-or-workspace',
        },
      },
    }
    mocks.useWorkspaces.mockImplementation(() => ({
      ...context(workspaces),
      agents: [nativePiAgent],
    }))
    mocks.listAgentCredentials.mockResolvedValue([])
    mocks.detectWorkspaceCredential.mockResolvedValue({
      configured: false,
      slug: null,
      model: null,
      contextWindow: null,
      wireShape: null,
    })
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

    expect((await screen.findByRole('button', { name: 'Select agent' })).textContent).toContain('Pi')
    expect(screen.queryByText('Model, reasoning, and context are managed by Pi')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Ask Alice…'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(mocks.quickChat).toHaveBeenCalledWith(
      'hello',
      'pi',
      undefined,
      'chat-1',
      'chat',
      undefined,
      undefined,
      'native',
    ))
    expect(mocks.probeAgentRuntimeReadiness).not.toHaveBeenCalled()
    expect(screen.queryByText('The runtime reported an error: 429: balance exhausted')).toBeNull()
  })

  it('submits only the explicit credential while its model and effort remain optional defaults', async () => {
    const nativePiAgent: AgentInfo = {
      ...piAgent,
      capabilities: {
        ...piAgent.capabilities,
        aiProvider: {
          ...piAgent.capabilities.aiProvider!,
          credentialSource: 'runtime-or-workspace',
        },
      },
    }
    mocks.useWorkspaces.mockImplementation(() => ({
      ...context(workspaces),
      agents: [nativePiAgent],
    }))
    mocks.listAgentCredentials.mockResolvedValue([
      {
        slug: 'glm-1',
        vendor: 'glm',
        authType: 'api-key',
        wires: { 'openai-chat': 'https://open.bigmodel.cn/api/paas/v4' },
        resolvedModel: 'glm-5.2',
      },
      {
        slug: 'deepseek-1',
        vendor: 'deepseek',
        authType: 'api-key',
        wires: { 'openai-chat': 'https://api.deepseek.com' },
        resolvedModel: 'deepseek-v4-flash',
        resolvedReasoningEffort: 'high',
      },
    ])
    mocks.detectWorkspaceCredential.mockResolvedValue({
      configured: true,
      slug: 'glm-1',
      model: 'glm-5.2',
      contextWindow: 256_000,
      wireShape: 'openai-chat',
    })

    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect((await screen.findByRole('button', { name: 'Model and reasoning' })).textContent)
      .toContain('Model managed by runtime')
    fireEvent.click(screen.getByRole('button', { name: 'AI access' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /deepseek-1/ }))
    expect(await findInferenceTrigger('deepseek-v4-flash')).toBeTruthy()
    expect(screen.queryByText('New Session only')).toBeNull()
    expect(screen.queryByText(/instead of Workspace/)).toBeNull()
    expect(screen.queryByText('Workspace settings stay unchanged')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Ask Alice…'), { target: { value: 'Use DeepSeek.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(mocks.quickChat).toHaveBeenCalledWith(
      'Use DeepSeek.',
      'pi',
      'deepseek-1',
      'chat-1',
      'chat',
      undefined,
      undefined,
      undefined,
    ))
  })

  it('persists and submits explicit model and effort choices as one recent launch tuple', async () => {
    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    await openInferenceSubmenu('Model')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Custom model…' }))
    const customModel = await screen.findByRole('textbox', { name: 'Model ID' })
    fireEvent.change(customModel, { target: { value: 'gemini-3.1-pro-preview' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await openInferenceSubmenu('Effort')
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'high reasoning' }))

    expect(mocks.rememberQuickChatLaunch).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText('Ask Alice…'), { target: { value: 'Go deeper.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(mocks.quickChat).toHaveBeenCalledWith(
      'Go deeper.',
      'pi',
      undefined,
      'chat-1',
      'chat',
      'gemini-3.1-pro-preview',
      'high',
      'native',
    ))
  })
})

describe('ChatLandingPage AI source disclosure', () => {
  it('can explicitly use the runtime account without reading the Workspace AI source', async () => {
    const nativePiAgent: AgentInfo = {
      ...piAgent,
      capabilities: {
        ...piAgent.capabilities,
        aiProvider: {
          ...piAgent.capabilities.aiProvider!,
          credentialSource: 'runtime-or-workspace',
        },
      },
    }
    mocks.useWorkspaces.mockImplementation(() => ({
      ...context(workspaces),
      agents: [nativePiAgent],
    }))
    mocks.listAgentCredentials.mockResolvedValue([{
      slug: 'deepseek-1',
      vendor: 'deepseek',
      authType: 'api-key',
      wires: { 'openai-chat': 'https://api.deepseek.com' },
      resolvedModel: 'deepseek-v4-flash',
    }])
    mocks.detectWorkspaceCredential.mockResolvedValue({
      configured: true,
      slug: 'deepseek-1',
      model: 'deepseek-v4-flash',
      contextWindow: 128_000,
      wireShape: 'openai-chat',
    })

    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    fireEvent.click(await screen.findByRole('button', { name: 'AI access' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Managed by Pi/ }))
    expect(mocks.rememberQuickChatLaunch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Model and reasoning' }).textContent)
      .toContain('Model managed by runtime')

    fireEvent.change(screen.getByPlaceholderText('Ask Alice…'), { target: { value: 'Use my account.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(mocks.quickChat).toHaveBeenCalledWith(
      'Use my account.',
      'pi',
      undefined,
      'chat-1',
      'chat',
      undefined,
      undefined,
      'native',
    ))
  })

  it('restores the complete Workspace recent launch tuple ahead of an unrelated installation default', async () => {
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
        label: 'DeepSeek',
        authType: 'api-key',
        wires: { 'openai-chat': 'https://api.deepseek.com' },
        resolvedModel: 'deepseek-v4-flash',
      },
    ])
    mocks.getQuickChat.mockResolvedValue({
      lastCredentialByAgent: { pi: 'google-1' },
      recentChatWorkspaceId: 'chat-1',
      recentLaunch: {
        agent: 'pi',
        accessMode: 'vault',
        credentialSlug: 'google-1',
        model: 'gemini-3.1-flash-lite',
        reasoningEffort: 'minimal',
      },
    })
    workspaces = [withInteractivePreference(chatWorkspace(), {
      accessMode: 'vault',
      credentialSlug: 'deepseek-1',
      wireShape: 'openai-chat',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })]

    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect((await screen.findByRole('button', { name: 'AI access' })).textContent).toContain('DeepSeek')
    await waitFor(() => {
      const summary = screen.getByRole('button', { name: 'Model and reasoning' }).textContent
      expect(summary).toContain('deepseek-v4-flash')
      expect(summary).toContain('high reasoning')
    })
    fireEvent.change(screen.getByPlaceholderText('Ask Alice…'), { target: { value: 'Continue.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(mocks.quickChat).toHaveBeenCalledWith(
      'Continue.',
      'pi',
      'deepseek-1',
      'chat-1',
      'chat',
      'deepseek-v4-flash',
      'high',
      undefined,
    ))
  })

  it('keeps effort absent when a registered Workspace model preference omits it', async () => {
    workspaces = [withInteractivePreference(chatWorkspace(), {
      accessMode: 'native',
      model: 'gpt-5.6-sol',
    }, 'codex')]
    mocks.useWorkspaces.mockImplementation(() => ({
      ...context(workspaces),
      agents: [codexAgent],
      defaultAgent: 'codex',
    }))
    mocks.getAgentRuntimeReadiness.mockResolvedValue({
      agents: {
        codex: {
          agent: 'codex',
          displayName: 'Codex',
          installed: true,
          binPath: '/tmp/codex',
          status: 'ready',
          ready: true,
          source: 'global-login',
          checkedAt: '2026-08-07T00:00:00.000Z',
          durationMs: 1,
        },
      },
      overallReady: true,
      checkedAt: '2026-08-07T00:00:00.000Z',
    })
    mocks.getPresets.mockResolvedValue({
      presets: [{
        id: 'codex-oauth',
        label: 'OpenAI Codex (Subscription)',
        models: [{
          id: 'gpt-5.6-sol',
          label: 'GPT 5.6 Sol (Power)',
          semantics: {
            reasoning: {
              mode: 'required',
              efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
              defaultEffort: 'low',
            },
          },
        }],
      }],
    })
    mocks.getQuickChat.mockResolvedValue({
      lastCredentialByAgent: {},
      recentChatWorkspaceId: 'chat-1',
      recentLaunch: {
        agent: 'codex',
        accessMode: 'auto',
        credentialSlug: null,
        model: 'gpt-5.6-sol',
        reasoningEffort: null,
      },
    })

    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect((await findInferenceTrigger('gpt-5.6-sol')).textContent).toContain('Effort not specified')
    fireEvent.change(screen.getByPlaceholderText('Ask Alice…'), { target: { value: 'Use model defaults.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(mocks.quickChat).toHaveBeenCalledWith(
      'Use model defaults.',
      'codex',
      undefined,
      'chat-1',
      'chat',
      'gpt-5.6-sol',
      undefined,
      'native',
    ))
  })

  it('keeps a Workspace vault preference implicit so the model leads the metadata row', async () => {
    workspaces = [withInteractivePreference(chatWorkspace(), {
      accessMode: 'vault',
      credentialSlug: 'google-1',
      wireShape: 'google-generative-ai',
      model: 'gemini-3.1-flash-lite',
      reasoningEffort: 'minimal',
    })]
    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect(await findInferenceTrigger('gemini-3.1-flash-lite')).toBeTruthy()
    expect(screen.queryByText('Saved in this workspace')).toBeNull()
    expect(screen.queryByText(/Sending will configure this workspace/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adjust workspace AI' })).toBeNull()
    expectDefaultEffort('minimal reasoning')
  })

  it('shows an explicitly selected vault credential without native-config injection copy', async () => {
    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    fireEvent.click(await screen.findByRole('button', { name: 'AI access' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /google-1/ }))
    expect(screen.queryByText('New Session only')).toBeNull()
    expect(screen.queryByText('Workspace settings stay unchanged')).toBeNull()
    expect(await findInferenceTrigger('gemini-3.1-flash-lite')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Configure workspace AI' })).toBeNull()
    expectDefaultEffort('Effort not specified')
  })

  it('keeps effort unspecified when a required reasoning model exposes no effort tiers', async () => {
    mocks.listAgentCredentials.mockResolvedValue([{
      slug: 'kimi-1',
      vendor: 'kimi',
      authType: 'api-key',
      wires: { 'openai-chat': 'https://api.moonshot.ai/v1' },
      resolvedModel: 'kimi-k2.7-code',
      resolvedReasoning: true,
      resolvedReasoningMode: 'required',
    }])
    workspaces = [withInteractivePreference(chatWorkspace(), {
      accessMode: 'vault',
      credentialSlug: 'kimi-1',
      wireShape: 'openai-chat',
      model: 'kimi-k2.7-code',
    })]

    render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    await findInferenceTrigger('kimi-k2.7-code')
    expectDefaultEffort('Effort not specified')
  })

  it('keeps an in-progress provider choice when polling replaces equivalent Workspace settings', async () => {
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

    workspaces = [withInteractivePreference(chatWorkspace(), {
      accessMode: 'vault',
      credentialSlug: 'google-1',
      wireShape: 'google-generative-ai',
      model: 'gemini-3.1-flash-lite',
    })]
    const view = render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    expect(await findInferenceTrigger('gemini-3.1-flash-lite')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'AI access' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /deepseek-1/ }))
    expect(await findInferenceTrigger('deepseek-v3.2')).toBeTruthy()

    workspaces = structuredClone(workspaces)
    await act(async () => {
      view.rerender(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)
    })

    expect(mocks.detectWorkspaceCredential).not.toHaveBeenCalled()
    expect(await findInferenceTrigger('deepseek-v3.2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Model and reasoning' }).textContent).not.toContain('gemini-3.1-pro-preview')
  })
})
