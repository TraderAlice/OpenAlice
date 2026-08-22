// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { HarnessSettingsPage } from './HarnessSettingsPage'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  preferences: {
    showHeadlessBornSessions: false,
    showUnverifiedHarnessReleases: false,
  },
}))

vi.mock('../hooks/useHarnessPreferences', () => ({
  useHarnessPreferences: () => ({
    preferences: mocks.preferences,
    loading: false,
    error: null,
    save: mocks.save,
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.preferences.showHeadlessBornSessions = false
  mocks.preferences.showUnverifiedHarnessReleases = false
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  mocks.save.mockResolvedValue(undefined)
})

describe('HarnessSettingsPage', () => {
  it('opts into showing headless-born Sessions and names the shared roster', async () => {
    render(<HarnessSettingsPage />)

    const toggle = screen.getByRole('switch', { name: 'Show headless-born Sessions' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Shared Harness behavior')).toBeTruthy()
    expect(screen.getByText('Ask Alice')).toBeTruthy()
    expect(screen.getByText('Auto Quant')).toBeTruthy()
    expect(screen.getByText('Auto Prediction')).toBeTruthy()

    fireEvent.click(toggle)
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      showHeadlessBornSessions: true,
      showUnverifiedHarnessReleases: false,
    }))
  })

  it('keeps unverified release discovery off until explicitly enabled', async () => {
    render(<HarnessSettingsPage />)
    const toggle = screen.getByRole('switch', { name: 'Show unverified Harness releases' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      showHeadlessBornSessions: false,
      showUnverifiedHarnessReleases: true,
    }))
  })
})
