// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { AIProviderPage } from './AIProviderPage'

const mocks = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  getPresets: vi.fn(),
  getWorkspaceCredentialDefaults: vi.fn(),
  setWorkspaceCredentialDefaults: vi.fn(),
  deleteCredential: vi.fn(),
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

beforeEach(async () => {
  vi.clearAllMocks()
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
})

afterEach(cleanup)

describe('AIProviderPage defaults', () => {
  it('puts creation defaults before collapsed runtime reference and localizes the primary UI', async () => {
    render(<AIProviderPage />)

    const credentials = await screen.findByRole('heading', { name: '凭证库' })
    const defaults = await screen.findByRole('heading', { name: '新工作区默认值' })
    const runtimeReference = screen.getByText('Agent 运行时参考')
    const details = runtimeReference.closest('details')

    expect(screen.getByRole('heading', { name: 'AI 提供方' })).toBeTruthy()
    expect(details?.open).toBe(false)
    expect(credentials.compareDocumentPosition(runtimeReference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(defaults.compareDocumentPosition(runtimeReference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
})
