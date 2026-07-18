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
  mocks.listCredentials.mockResolvedValue([])
  mocks.getPresets.mockResolvedValue({ presets: [] })
  mocks.getAgentConfig
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
  it('saves a context-only change directly without probing the provider again', async () => {
    render(
      <WorkspaceAIConfigModal
        wsId="chat-1"
        initialSection="ai"
        initialAgent="pi"
        onClose={vi.fn()}
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
    expect(await screen.findByText('已保存。请暂停并恢复已打开的会话以重新载入。')).toBeTruthy()
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
