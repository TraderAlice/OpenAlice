// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import { WorkspaceAIConfigModal } from './WorkspaceAIConfigModal'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  getAgentConfig: vi.fn(),
  getWorkspaceLaunchPlan: vi.fn(),
  listCredentials: vi.fn(),
  saveAgentConfig: vi.fn(),
  saveCredential: vi.fn(),
  testAgentConfig: vi.fn(),
  getPresets: vi.fn(),
}))

vi.mock('../../contexts/workspaces-context', () => ({
  useWorkspaces: () => mocks.useWorkspaces(),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    getAgentConfig: mocks.getAgentConfig,
    getWorkspaceLaunchPlan: mocks.getWorkspaceLaunchPlan,
    listCredentials: mocks.listCredentials,
    saveAgentConfig: mocks.saveAgentConfig,
    saveCredential: mocks.saveCredential,
    testAgentConfig: mocks.testAgentConfig,
  }
})

vi.mock('../../api', () => ({
  api: { config: { getPresets: mocks.getPresets } },
}))

const savedPi = {
  baseUrl: 'https://provider.test/v1',
  apiKey: 'secret',
  model: 'unknown-model',
  contextWindow: 256_000,
  wireShape: 'openai-chat' as const,
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh')
  mocks.useWorkspaces.mockReturnValue({
    workspaces: [{
      id: 'chat-1',
      tag: 'chat-1',
      dir: '/tmp/chat-1',
      createdAt: '2026-07-18T00:00:00.000Z',
      template: 'chat',
      sessions: [],
    }],
    agents: [
      {
        id: 'claude',
        displayName: 'Claude Code',
        capabilities: {
          parallelPerCwd: true,
          resumeLast: false,
          resumeById: true,
          transcriptDiscovery: 'fs-watch',
          aiProvider: {
            credentialSource: 'runtime-or-workspace',
            wirePreference: ['anthropic'],
          },
        },
      },
      {
        id: 'codex',
        displayName: 'Codex',
        capabilities: {
          parallelPerCwd: true,
          resumeLast: true,
          resumeById: true,
          transcriptDiscovery: 'subprocess',
          aiProvider: {
            credentialSource: 'runtime-or-workspace',
            wirePreference: ['openai-responses'],
          },
        },
      },
      {
        id: 'opencode',
        displayName: 'opencode',
        capabilities: {
          parallelPerCwd: true,
          resumeLast: true,
          resumeById: true,
          transcriptDiscovery: 'subprocess',
          aiProvider: {
            credentialSource: 'workspace-required',
            wirePreference: ['google-generative-ai', 'openai-chat', 'anthropic', 'openai-responses'],
            vendorPolicies: {
              minimax: {
                wirePreference: ['anthropic'],
                legacyRequestedWireFallbacks: { 'openai-chat': 'anthropic' },
              },
            },
            modelRegistration: {
              contextWindow: true,
              reasoning: true,
              effortVariants: true,
            },
          },
        },
      },
      {
        id: 'pi',
        displayName: 'Pi',
        capabilities: {
          parallelPerCwd: true,
          resumeLast: true,
          resumeById: true,
          transcriptDiscovery: 'none',
          aiProvider: {
            credentialSource: 'workspace-required',
            wirePreference: ['google-generative-ai', 'openai-chat', 'anthropic', 'openai-responses'],
            vendorPolicies: {
              minimax: {
                wirePreference: ['anthropic'],
                legacyRequestedWireFallbacks: { 'openai-chat': 'anthropic' },
              },
            },
            modelRegistration: { contextWindow: true, reasoning: true },
          },
        },
      },
    ],
    refresh: vi.fn(),
    saveWorkspaceMetadata: vi.fn(),
  })
  mocks.listCredentials.mockReset().mockResolvedValue([])
  mocks.getPresets.mockReset().mockResolvedValue({ presets: [] })
  mocks.getAgentConfig.mockReset()
    .mockResolvedValueOnce({ claude: null, codex: null, opencode: null, pi: savedPi })
    .mockResolvedValueOnce({
      claude: null,
      codex: null,
      opencode: null,
      pi: { ...savedPi, contextWindow: 512_000 },
    })
  mocks.saveAgentConfig.mockResolvedValue(undefined)
  mocks.getWorkspaceLaunchPlan.mockResolvedValue({
    workspace: { id: 'chat-1', tag: 'chat-1', dir: '/tmp/chat-1' },
    agent: {
      id: 'pi',
      displayName: 'Pi',
      kind: 'agent',
      installed: true,
      binPath: '/usr/local/bin/pi',
      capabilities: {
        parallelPerCwd: true,
        resumeLast: true,
        resumeById: true,
        transcriptDiscovery: 'none',
      },
    },
    launch: {
      intent: 'fresh',
      mode: 'direct',
      composedCommand: ['pi'],
      resolvedCommand: ['pi'],
      cwd: '/tmp/chat-1',
      envPWD: '/tmp/chat-1',
      environment: [],
      transcriptDir: null,
    },
  })
})

afterEach(cleanup)

describe('WorkspaceAIConfigModal local model metadata', () => {
  it('exposes a named modal dialog and moves focus into the selected section', () => {
    render(
      <WorkspaceAIConfigModal
        wsId="chat-1"
        initialSection="general"
        onClose={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: '工作区设置' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: '通用' }).getAttribute('aria-current')).toBe('page')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '通用' }))
  })

  it('keeps compact settings chrome fixed around one scroll owner', async () => {
    render(
      <WorkspaceAIConfigModal
        wsId="chat-1"
        initialSection="ai"
        initialAgent="pi"
        onClose={vi.fn()}
      />,
    )

    const dialog = screen.getByTestId('workspace-settings-dialog')
    const sectionNav = screen.getByTestId('workspace-settings-section-nav')
    const scrollArea = screen.getByTestId('workspace-settings-ai-scroll')
    const footer = screen.getByTestId('workspace-settings-ai-footer')

    expect(dialog.className).toContain('h-full')
    expect(dialog.className).toContain('overflow-hidden')
    expect(dialog.className).toContain('sm:max-h-[85dvh]')
    expect(sectionNav.className).toContain('overflow-x-auto')
    expect(screen.getByRole('button', { name: '通用' }).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: 'Claude Code' }).className).toContain('min-h-11')
    expect(scrollArea.className).toContain('min-h-0')
    expect(scrollArea.className).toContain('overflow-y-auto')
    expect(footer.className).toContain('shrink-0')

    expect(await screen.findByText('— 没有兼容 Pi 的凭证 —')).toBeTruthy()
    expect(screen.queryByText('从已保存凭证载入')).toBeNull()
  })

  it('keeps forward and reverse Tab navigation inside the dialog', () => {
    render(
      <WorkspaceAIConfigModal
        wsId="chat-1"
        initialSection="general"
        onClose={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: '工作区设置' })
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ))
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes on Escape, restores focus, and removes its keyboard listener', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open workspace settings'
    document.body.append(trigger)
    trigger.focus()
    const onClose = vi.fn()

    const { unmount } = render(
      <WorkspaceAIConfigModal
        wsId="chat-1"
        initialSection="general"
        onClose={onClose}
      />,
    )

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '通用' }))
    expect(trigger.hasAttribute('inert')).toBe(true)
    expect(trigger.getAttribute('aria-hidden')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    unmount()
    expect(document.activeElement).toBe(trigger)
    expect(trigger.hasAttribute('inert')).toBe(false)
    expect(trigger.getAttribute('aria-hidden')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    trigger.remove()
  })

  it('saves a Codex native-login model without requiring an API probe', async () => {
    mocks.getAgentConfig.mockReset().mockResolvedValue({
      claude: null,
      codex: null,
      opencode: null,
      pi: null,
    })

    render(
      <WorkspaceAIConfigModal wsId="chat-1" initialSection="ai" initialAgent="codex" onClose={vi.fn()} />,
    )

    fireEvent.change(await screen.findByPlaceholderText('gpt-5.5'), {
      target: { value: 'gpt-5.6' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mocks.saveAgentConfig).toHaveBeenCalledWith(
      'chat-1',
      'codex',
      expect.objectContaining({
        baseUrl: null,
        apiKey: null,
        model: 'gpt-5.6',
      }),
    ))
    expect(mocks.testAgentConfig).not.toHaveBeenCalled()
  })

  it('repairs a saved MiniMax OpenAI wire and removes the lossy protocol choice', async () => {
    const minimaxPi = {
      ...savedPi,
      baseUrl: 'https://api.minimax.io/v1',
      model: 'MiniMax-M2.5',
    }
    mocks.getAgentConfig.mockReset().mockResolvedValue({
      claude: null,
      codex: null,
      opencode: null,
      pi: minimaxPi,
    })
    mocks.listCredentials.mockResolvedValue([{
      slug: 'minimax-test',
      vendor: 'minimax',
      authType: 'api-key',
      wires: {
        anthropic: 'https://api.minimax.io/anthropic',
        'openai-chat': 'https://api.minimax.io/v1',
      },
      apiKey: 'secret',
    }])

    render(
      <WorkspaceAIConfigModal wsId="chat-1" initialSection="ai" initialAgent="pi" onClose={vi.fn()} />,
    )

    const protocol = await screen.findByRole('combobox', { name: 'Pi API 协议' }) as HTMLSelectElement
    await screen.findByRole('button', { name: '测试' })
    expect(protocol.value).toBe('anthropic')
    expect(Array.from(protocol.options).map((option) => option.value)).toEqual(['anthropic'])
  })

  it('shows LongCat\'s real thinking default without inventing an effort selector', async () => {
    mocks.getAgentConfig.mockReset().mockResolvedValue({
      claude: null,
      codex: null,
      opencode: null,
      pi: {
        ...savedPi,
        baseUrl: 'https://api.longcat.chat/openai',
        model: 'LongCat-2.0',
      },
    })
    mocks.getPresets.mockResolvedValue({
      presets: [{
        id: 'longcat',
        label: 'LongCat',
        category: 'third-party',
        defaultName: 'LongCat',
        description: '',
        models: [{
          id: 'LongCat-2.0',
          label: 'LongCat 2.0',
          semantics: { reasoning: { mode: 'optional', defaultEnabled: true } },
        }],
        schema: { type: 'object', properties: {} },
      }],
    })
    render(
      <WorkspaceAIConfigModal wsId="chat-1" initialSection="ai" initialAgent="pi" onClose={vi.fn()} />,
    )

    expect(await screen.findByText('开启（提供方默认）')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Pi 思考强度' })).toBeNull()
    expect(screen.getByText(/不会虚构一个强度值/)).toBeTruthy()
  })

  it('prefills a registered effort and saves an explicit Workspace override without probing', async () => {
    const openAiPi = {
      ...savedPi,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6',
    }
    mocks.getAgentConfig.mockReset()
      .mockResolvedValueOnce({ claude: null, codex: null, opencode: null, pi: openAiPi })
      .mockResolvedValueOnce({
        claude: null,
        codex: null,
        opencode: null,
        pi: { ...openAiPi, reasoningEffort: 'high' },
      })
    mocks.getPresets.mockResolvedValue({
      presets: [{
        id: 'codex-api',
        label: 'OpenAI',
        category: 'official',
        defaultName: 'OpenAI',
        description: '',
        models: [{
          id: 'gpt-5.6',
          label: 'GPT 5.6',
          semantics: {
            reasoning: {
              mode: 'optional',
              efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
              defaultEffort: 'medium',
            },
          },
        }],
        schema: { type: 'object', properties: {} },
      }],
    })
    mocks.listCredentials.mockResolvedValue([{
      slug: 'openai-test',
      vendor: 'openai',
      authType: 'api-key',
      wires: { 'openai-chat': 'https://api.openai.com/v1' },
      apiKey: 'secret',
    }])

    render(
      <WorkspaceAIConfigModal wsId="chat-1" initialSection="ai" initialAgent="pi" onClose={vi.fn()} />,
    )

    const effort = await screen.findByRole('combobox', { name: 'Pi 思考强度' })
    expect((effort as HTMLSelectElement).value).toBe('medium')
    fireEvent.change(effort, { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mocks.saveAgentConfig).toHaveBeenCalledWith(
      'chat-1',
      'pi',
      expect.objectContaining({ reasoningEffort: 'high' }),
    ))
    expect(mocks.testAgentConfig).not.toHaveBeenCalled()
  })

  it('keeps runtime default selected when the provider publishes tiers but no default', async () => {
    const glmPi = {
      ...savedPi,
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      model: 'glm-5.2',
    }
    mocks.getAgentConfig.mockReset().mockResolvedValue({
      claude: null,
      codex: null,
      opencode: null,
      pi: glmPi,
    })
    mocks.listCredentials.mockResolvedValue([{
      slug: 'glm-test',
      vendor: 'glm',
      authType: 'api-key',
      wires: { 'openai-chat': 'https://open.bigmodel.cn/api/coding/paas/v4' },
      apiKey: 'secret',
    }])
    mocks.getPresets.mockResolvedValue({
      presets: [{
        id: 'glm',
        label: 'GLM',
        category: 'third-party',
        defaultName: 'GLM',
        description: '',
        models: [{
          id: 'glm-5.2',
          label: 'GLM 5.2',
          semantics: { reasoning: { mode: 'adaptive', efforts: ['high', 'max'] } },
        }],
        schema: { type: 'object', properties: {} },
      }],
    })

    render(
      <WorkspaceAIConfigModal wsId="chat-1" initialSection="ai" initialAgent="pi" onClose={vi.fn()} />,
    )

    const effort = await screen.findByRole('combobox', { name: 'Pi 思考强度' })
    expect((effort as HTMLSelectElement).value).toBe('')
    expect((effort as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('运行时默认（提供方未公布）')
  })

  it('saves a context-only change directly without probing the provider again', async () => {
    const onClose = vi.fn()
    const onAiSaved = vi.fn()
    render(
      <WorkspaceAIConfigModal
        wsId="chat-1"
        initialSection="ai"
        initialAgent="pi"
        onClose={onClose}
        onAiSaved={onAiSaved}
      />,
    )

    const contextWindow = await screen.findByRole('combobox', { name: 'Pi 上下文窗口' })
    fireEvent.change(contextWindow, { target: { value: '512000' } })

    const save = screen.getByRole('button', { name: '保存' })
    expect(screen.queryByRole('button', { name: '测试' })).toBeNull()
    fireEvent.click(save)

    await waitFor(() => expect(mocks.saveAgentConfig).toHaveBeenCalledWith(
      'chat-1',
      'pi',
      expect.objectContaining({
        baseUrl: 'https://provider.test/v1',
        apiKey: 'secret',
        model: 'unknown-model',
        contextWindow: 512_000,
        wireShape: 'openai-chat',
      }),
    ))
    expect(mocks.testAgentConfig).not.toHaveBeenCalled()
    expect(onAiSaved).toHaveBeenCalledWith({
      agent: 'pi',
      runtimeLabel: 'Pi',
      model: 'unknown-model',
      workspaceLabel: 'chat-1',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('已保存。请暂停并恢复已打开的会话以重新载入。')).toBeNull()
  })

  it('notifies launch surfaces after resetting the Workspace-local binding', async () => {
    mocks.getAgentConfig.mockReset()
      .mockResolvedValueOnce({ claude: null, codex: null, opencode: null, pi: savedPi })
      .mockResolvedValueOnce({ claude: null, codex: null, opencode: null, pi: null })
    const configChanged = vi.fn()
    const credentialsChanged = vi.fn()
    window.addEventListener('openalice:workspace-agent-config-changed', configChanged)
    window.addEventListener('openalice:credentials-changed', credentialsChanged)

    render(
      <WorkspaceAIConfigModal
        wsId="chat-1"
        initialSection="ai"
        initialAgent="pi"
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '恢复为全局默认值' }))

    await waitFor(() => expect(mocks.saveAgentConfig).toHaveBeenCalledWith(
      'chat-1',
      'pi',
      { baseUrl: null, apiKey: null, model: null },
    ))
    expect(configChanged).toHaveBeenCalledTimes(1)
    expect(credentialsChanged).toHaveBeenCalledTimes(1)

    window.removeEventListener('openalice:workspace-agent-config-changed', configChanged)
    window.removeEventListener('openalice:credentials-changed', credentialsChanged)
  })
})
