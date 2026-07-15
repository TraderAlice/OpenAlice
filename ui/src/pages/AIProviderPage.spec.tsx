import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CredentialSummary,
  WorkspaceCredentialDefault,
  WorkspaceCredentialDefaultsResponse,
} from '../api/config'

const { getWorkspaceCredentialDefaults, setWorkspaceCredentialDefaults } = vi.hoisted(() => ({
  getWorkspaceCredentialDefaults: vi.fn(),
  setWorkspaceCredentialDefaults: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    config: {
      getWorkspaceCredentialDefaults,
      setWorkspaceCredentialDefaults,
    },
  },
}))

import { WorkspaceDefaultsSection } from './AIProviderPage'

const credentials: CredentialSummary[] = [{
  slug: 'openai-1',
  vendor: 'openai',
  label: 'OpenAI',
  authType: 'api-key',
  wires: { 'openai-chat': '', 'openai-responses': '' },
  apiKey: null,
  hasApiKey: true,
}]

const compatibility = {
  claude: [],
  codex: ['openai-1'],
  opencode: ['openai-1'],
  pi: ['openai-1'],
}

function mockDefaults(defaults: Record<string, WorkspaceCredentialDefault>) {
  const response: WorkspaceCredentialDefaultsResponse = {
    defaults,
    compatibleByAgent: compatibility,
  }
  getWorkspaceCredentialDefaults.mockResolvedValue(response)
  setWorkspaceCredentialDefaults.mockImplementation(async (next) => ({ defaults: next }))
}

beforeEach(() => {
  mockDefaults({})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('new Workspace provider defaults', () => {
  it('shows 256K as the explicit default and persists it with a selected credential', async () => {
    render(<WorkspaceDefaultsSection credentials={credentials} />)

    const context = await screen.findByRole('combobox', { name: 'Pi default context window' }) as HTMLSelectElement
    expect(context.value).toBe('256000')
    expect(context.disabled).toBe(true)

    fireEvent.change(screen.getByRole('combobox', { name: 'Pi default credential' }), {
      target: { value: 'openai-1' },
    })

    await waitFor(() => expect(setWorkspaceCredentialDefaults).toHaveBeenCalledWith({
      pi: { credentialSlug: 'openai-1', contextWindow: 256_000 },
    }))
    expect(context.disabled).toBe(false)
  })

  it('preserves the credential/model while changing context and warns above 256K', async () => {
    mockDefaults({
      opencode: {
        credentialSlug: 'openai-1',
        model: 'gpt-5.5',
        contextWindow: 512_000,
      },
    })
    render(<WorkspaceDefaultsSection credentials={credentials} />)

    const context = await screen.findByRole('combobox', { name: 'opencode default context window' }) as HTMLSelectElement
    expect(context.value).toBe('512000')
    expect(screen.getByText(/higher API billing tier/)).toBeTruthy()

    fireEvent.change(context, { target: { value: '128000' } })

    await waitFor(() => expect(setWorkspaceCredentialDefaults).toHaveBeenCalledWith({
      opencode: {
        credentialSlug: 'openai-1',
        model: 'gpt-5.5',
        contextWindow: 128_000,
      },
    }))
    expect(screen.queryByText(/higher API billing tier/)).toBeNull()
  })

  it('preserves a custom context preference that is not one of the presets', async () => {
    mockDefaults({
      pi: { credentialSlug: 'openai-1', contextWindow: 200_000 },
    })
    render(<WorkspaceDefaultsSection credentials={credentials} />)

    const context = await screen.findByRole('combobox', { name: 'Pi default context window' }) as HTMLSelectElement
    expect(context.value).toBe('200000')
    expect(screen.getByRole('option', { name: 'Custom — 200,000 tokens' })).toBeTruthy()
  })
})
