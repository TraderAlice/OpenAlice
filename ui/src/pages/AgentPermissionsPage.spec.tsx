// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { AgentPermissionsPage } from './AgentPermissionsPage'

const mocks = vi.hoisted(() => ({
  ensureTradingModePolling: vi.fn(),
  loadConfig: vi.fn(),
  setMode: vi.fn(),
  updateSection: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    config: {
      load: mocks.loadConfig,
      updateSection: mocks.updateSection,
    },
  },
}))

vi.mock('../live/trading-mode', () => ({
  ensureTradingModePolling: mocks.ensureTradingModePolling,
  useTradingMode: (selector: (state: {
    status: {
      mode: 'lite'
      modeSource: 'default'
      envLocked: false
    }
    loading: false
    saving: null
    error: null
    setMode: typeof mocks.setMode
  }) => unknown) => selector({
    status: {
      mode: 'lite',
      modeSource: 'default',
      envLocked: false,
    },
    loading: false,
    saving: null,
    error: null,
    setMode: mocks.setMode,
  }),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('AgentPermissionsPage', () => {
  it('explains a configuration load failure and recovers on retry', async () => {
    mocks.loadConfig
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({})

    render(<AgentPermissionsPage />)

    const alert = await screen.findByRole('alert')
    expect(screen.getByRole('heading', { name: 'Agent Permissions' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Couldn’t load Agent Permissions' })).toBeTruthy()
    expect(alert.textContent).toContain('Your permissions have not been changed.')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.loadConfig).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'Trading mode' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
