// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import { WorkspaceAIConfigModal } from './WorkspaceAIConfigModal'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  getAgentConfig: vi.fn(),
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
      agents: ['pi'],
      sessions: [],
    }],
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
})

afterEach(cleanup)

describe('WorkspaceAIConfigModal local model metadata', () => {
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
