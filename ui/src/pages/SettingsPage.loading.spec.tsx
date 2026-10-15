// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { SettingsPage } from './SettingsPage'

const mocks = vi.hoisted(() => ({
  configLoad: vi.fn(),
  getVersion: vi.fn(),
  getWorkspaceShell: vi.fn(),
  refreshMachines: vi.fn(async () => undefined),
}))

vi.mock('../api', () => ({
  api: {
    config: {
      load: mocks.configLoad,
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

vi.mock('../hooks/useUpdateLifecycle', () => ({
  useUpdateLifecycle: () => ({ machines: { status: null, fleet: [], loading: false, busy: false, error: null, refresh: mocks.refreshMachines }, versionInfo: null, nativeStatus: null, workspaceStates: [],
    projectWorkspaces: [], preferences: null, checking: false, error: null, availableCount: 0,
    guidance: { app: false, backend: false, workspaceIds: [], needsAttentionWorkspaceIds: [], availableCount: 0, needsAttentionCount: 0 },
    refresh: vi.fn(async () => undefined), savePreferences: vi.fn(async () => undefined) }),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({ workspaces: [], openAgentConfig: vi.fn() }),
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
  mocks.getVersion.mockResolvedValue({
    current: '0.0.0',
    channel: 'stable',
    updateAuthority: 'source',
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

    expect(screen.getByRole('heading', { name: 'Versions & updates' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Language' })).toBeNull()
    expect(screen.getByText('openalice run --home <path>')).toBeTruthy()
    expect(mocks.configLoad).not.toHaveBeenCalled()
  })
})
