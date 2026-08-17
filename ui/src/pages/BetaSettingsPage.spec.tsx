// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import '../i18n'
import { i18n } from '../i18n'
import {
  BETA_FEATURES_STORAGE_KEY,
  DEFAULT_BETA_FEATURES,
  useBetaFeatures,
} from '../live/beta-features'
import { BetaSettingsPage } from './BetaSettingsPage'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.removeItem(BETA_FEATURES_STORAGE_KEY)
  useBetaFeatures.setState(DEFAULT_BETA_FEATURES)
})

afterEach(() => {
  cleanup()
  localStorage.removeItem(BETA_FEATURES_STORAGE_KEY)
  useBetaFeatures.setState(DEFAULT_BETA_FEATURES)
})

describe('BetaSettingsPage', () => {
  it('keeps Office off until the switch is turned on', () => {
    render(<BetaSettingsPage />)

    const toggle = screen.getByRole('switch', { name: 'Office' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(useBetaFeatures.getState().office).toBe(false)

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(useBetaFeatures.getState().office).toBe(true)
  })
})
