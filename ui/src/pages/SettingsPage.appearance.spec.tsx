// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import '../i18n'
import { i18n } from '../i18n'
import { useThemeStore } from '../theme/store'
import { AppearanceSection } from './SettingsPage'

let systemDark = false

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  systemDark = false
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return systemDark },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } satisfies MediaQueryList)))
  useThemeStore.setState({
    theme: 'auto',
    dayPalette: 'paper',
    nightPalette: 'graphite',
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.removeItem('openalice.theme.v1')
})

describe('AppearanceSection palette pair editor', () => {
  it('shows the active slot and one recommended palette library at a time', () => {
    render(<AppearanceSection />)

    expect(screen.getByText('Currently using Day · Paper')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Day palette: Paper' }).getAttribute('aria-pressed'))
      .toBe('true')
    expect(screen.getByRole('button', { name: 'Recommended' }).getAttribute('aria-pressed'))
      .toBe('true')
    expect(screen.getByRole('button', { name: 'Choose Paper' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose Linen' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Choose Graphite' })).toBeNull()
  })

  it('switches the editor to Night and updates only the Night slot', () => {
    render(<AppearanceSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Night palette: Graphite' }))

    expect(screen.getByText('Choose a Night palette')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose Graphite' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Choose Paper' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Choose Midnight' }))

    expect(useThemeStore.getState().dayPalette).toBe('paper')
    expect(useThemeStore.getState().nightPalette).toBe('midnight')
    expect(screen.getByRole('button', { name: 'Edit Night palette: Midnight' })).toBeTruthy()
  })

  it('keeps arbitrary cross-appearance combinations under All palettes', () => {
    render(<AppearanceSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Night palette: Graphite' }))
    fireEvent.click(screen.getByRole('button', { name: 'All palettes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose Paper' }))

    expect(useThemeStore.getState().nightPalette).toBe('paper')
    expect(screen.getByText('Used for Day & Night')).toBeTruthy()
  })

  it('restores the default Paper and Graphite pair without changing color mode', () => {
    useThemeStore.setState({ theme: 'night', dayPalette: 'linen', nightPalette: 'midnight' })
    render(<AppearanceSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset pair' }))

    expect(useThemeStore.getState().theme).toBe('night')
    expect(useThemeStore.getState().dayPalette).toBe('paper')
    expect(useThemeStore.getState().nightPalette).toBe('graphite')
  })

  it('reports the Night slot as active when Auto follows a dark system', () => {
    systemDark = true
    render(<AppearanceSection />)

    expect(screen.getByText('Currently using Night · Graphite')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Night palette: Graphite' }).getAttribute('aria-pressed'))
      .toBe('true')
  })
})
