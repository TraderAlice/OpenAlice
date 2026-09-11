// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAgentRuntimesStore } from '../hooks/useAgentRuntimes'
import { i18n } from '../i18n'
import { AIProviderPage } from './AIProviderPage'

const mocks = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  getPresets: vi.fn(),
  getWorkspaceCredentialDefaults: vi.fn(),
  setWorkspaceCredentialDefaults: vi.fn(),
  deleteCredential: vi.fn(),
  listAgents: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    config: {
      getCredentials: mocks.getCredentials,
      getPresets: mocks.getPresets,
      getWorkspaceCredentialDefaults: mocks.getWorkspaceCredentialDefaults,
      setWorkspaceCredentialDefaults: mocks.setWorkspaceCredentialDefaults,
      deleteCredential: mocks.deleteCredential,
    },
  },
}))

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return { ...actual, listAgents: mocks.listAgents }
})

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: () => void }) => unknown) =>
    selector({ openOrFocus: vi.fn() }),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  resetAgentRuntimesStore()
  await i18n.changeLanguage('zh')
  mocks.getCredentials.mockResolvedValue({
    credentials: [{
      slug: 'google-1',
      vendor: 'google',
      label: 'Gemini',
      authType: 'api-key',
      wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
      apiKey: null,
      hasApiKey: true,
      lastModel: 'gemini-3.1-pro-preview',
    }],
  })
  mocks.getPresets.mockResolvedValue({ presets: [] })
  mocks.getWorkspaceCredentialDefaults.mockResolvedValue({
    defaults: {},
    compatibleByAgent: { pi: ['google-1'], opencode: ['google-1'] },
  })
  mocks.setWorkspaceCredentialDefaults.mockImplementation(async (defaults) => ({
    defaults,
  }))
  mocks.deleteCredential.mockResolvedValue(undefined)
  mocks.listAgents.mockResolvedValue([
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
          modelRegistration: { contextWindow: true, reasoning: true },
        },
      },
    },
  ])
})

afterEach(cleanup)

describe('AIProviderPage', () => {
  it('puts creation defaults before the Agent runtimes link and localizes the primary UI', async () => {
    render(<AIProviderPage />)

    const credentials = await screen.findByRole('heading', { name: '凭证库' })
    const defaults = await screen.findByRole('heading', { name: '新工作区默认值' })
    const runtimesLink = screen.getByRole('button', { name: '打开 Agent 运行时' })

    expect(screen.getByRole('heading', { name: 'AI 提供方' })).toBeTruthy()
    expect(screen.queryByText('Agent 运行时参考')).toBeNull()
    expect(credentials.compareDocumentPosition(runtimesLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(defaults.compareDocumentPosition(runtimesLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('persists a Pi creation default and acknowledges the save', async () => {
    render(<AIProviderPage />)

    const select = await screen.findByRole('combobox', { name: 'Pi 默认凭证' })
    fireEvent.change(select, { target: { value: 'google-1' } })

    await waitFor(() => expect(mocks.setWorkspaceCredentialDefaults).toHaveBeenCalledWith(
      { pi: { credentialSlug: 'google-1', wireShape: 'google-generative-ai' } },
    ))
    expect(await screen.findByText('已保存')).toBeTruthy()
  })

  it('names each credential edit action with the credential it changes', async () => {
    render(<AIProviderPage />)

    expect(await screen.findByRole('button', { name: '编辑 Gemini' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.getByText('Google Gemini')).toBeTruthy()
  })

  it('filters the vault list without removing unmatched saved credentials', async () => {
    mocks.getCredentials.mockResolvedValue({
      credentials: [
        {
          slug: 'google-1',
          vendor: 'google',
          label: 'Gemini',
          authType: 'api-key',
          wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
          apiKey: null,
          hasApiKey: true,
          lastModel: 'gemini-3.1-pro-preview',
        },
        {
          slug: 'openrouter-1',
          vendor: 'openrouter',
          label: 'Work gateway',
          authType: 'api-key',
          wires: { 'openai-chat': 'https://openrouter.ai/api/v1' },
          apiKey: null,
          hasApiKey: true,
          lastModel: 'anthropic/claude-sonnet-5',
        },
      ],
    })
    render(<AIProviderPage />)

    expect(await screen.findByRole('button', { name: '编辑 Gemini' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '编辑 Work gateway' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('搜索凭证…'), { target: { value: 'openrouter' } })
    expect(screen.queryByRole('button', { name: '编辑 Gemini' })).toBeNull()
    expect(screen.getByRole('button', { name: '编辑 Work gateway' })).toBeTruthy()
    expect(screen.getByText('OpenRouter')).toBeTruthy()
  })

  it('confirms credential deletion and explains the default cleanup', async () => {
    render(<AIProviderPage />)

    const deleteCredential = await screen.findByRole('button', { name: '删除 Gemini' })
    fireEvent.click(deleteCredential)

    expect(screen.getByRole('heading', { name: '删除 Gemini？' })).toBeTruthy()
    expect(screen.getByText(/永久删除 google-1/)).toBeTruthy()
    expect(screen.getByText(/清除所有引用它的新工作区默认值/)).toBeTruthy()
    expect(mocks.deleteCredential).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '删除 Gemini？' })).toBeNull()
    expect(mocks.deleteCredential).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '删除 Gemini' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(mocks.deleteCredential).toHaveBeenCalledWith('google-1'))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '删除 Gemini？' })).toBeNull())
  })

  it('keeps the confirmation open when credential deletion fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    mocks.deleteCredential.mockRejectedValueOnce(new Error('credential still in use'))
    render(<AIProviderPage />)

    fireEvent.click(await screen.findByRole('button', { name: '删除 Gemini' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('credential still in use'))
    expect(screen.getByRole('heading', { name: '删除 Gemini？' })).toBeTruthy()
    alertSpy.mockRestore()
  })
})
