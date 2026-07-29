// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { SettingsPage } from './SettingsPage'

const mocks = vi.hoisted(() => ({
  configLoad: vi.fn(),
  getPersona: vi.fn(),
  getVersion: vi.fn(),
  getWorkspaceShell: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    config: {
      load: mocks.configLoad,
    },
    persona: {
      get: mocks.getPersona,
    },
    version: {
      get: mocks.getVersion,
    },
  },
}))

vi.mock('../api/preferences', () => ({
  preferencesApi: {
    getWorkspaceShell: mocks.getWorkspaceShell,
  },
}))

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } satisfies MediaQueryList)))
  await i18n.changeLanguage('en')
  mocks.getPersona.mockResolvedValue({ content: '', path: '' })
  mocks.getVersion.mockResolvedValue({
    current: '0.0.0',
    latest: '0.0.0',
    hasUpdate: false,
    releaseUrl: '',
  })
  mocks.getWorkspaceShell.mockResolvedValue({ supported: false })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SettingsPage loading', () => {
  it('renders independent settings without waiting for an unused config read', async () => {
    mocks.configLoad.mockRejectedValue(new Error('offline'))

    render(<SettingsPage />)

    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy()
    expect(screen.getByText('openalice start --home <path>')).toBeTruthy()
    await waitFor(() => expect(mocks.getPersona).toHaveBeenCalledOnce())
    expect(mocks.configLoad).not.toHaveBeenCalled()
  })
})
