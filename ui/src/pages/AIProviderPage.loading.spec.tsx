// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { AIProviderPage } from './AIProviderPage'

const mocks = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  getPresets: vi.fn(),
  getWorkspaceCredentialDefaults: vi.fn(),
  listAgents: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    config: {
      getCredentials: mocks.getCredentials,
      getPresets: mocks.getPresets,
      getWorkspaceCredentialDefaults: mocks.getWorkspaceCredentialDefaults,
    },
  },
}))

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return { ...actual, listAgents: mocks.listAgents }
})

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.getPresets.mockResolvedValue({ presets: [] })
  mocks.getWorkspaceCredentialDefaults.mockResolvedValue({
    defaults: {},
    compatibleByAgent: {},
  })
  mocks.listAgents.mockResolvedValue([])
})

afterEach(cleanup)

describe('AIProviderPage credential loading', () => {
  it('distinguishes a failed vault read from an empty vault and retries', async () => {
    mocks.getCredentials
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ credentials: [] })

    render(<AIProviderPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Your saved credentials have not been changed.')
    expect(screen.queryByRole('button', { name: /Add your first credential/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.getCredentials).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: /Add your first credential/ })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
