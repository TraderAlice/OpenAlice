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
    uiStyle: 'default',
    stylePaletteMode: 'saved',
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.removeItem('openalice.theme.v1')
  localStorage.removeItem('openalice.editor-tabs.v1')
})

describe('AppearanceSection palette pair editor', () => {
  it('switches component style immediately without changing the palette pair', () => {
    render(<AppearanceSection />)

    expect(screen.getByRole('radio', { name: 'Default' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Windows 98' }))

    expect(useThemeStore.getState().uiStyle).toBe('win98')
    expect(useThemeStore.getState().dayPalette).toBe('paper')
    expect(useThemeStore.getState().nightPalette).toBe('graphite')
    expect(useThemeStore.getState().stylePaletteMode).toBe('saved')
    expect(screen.getByRole('radio', { name: 'Windows 98' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'Use recommended colors' })).toBeTruthy()
  })

  it('scopes the selected style recommendation without rewriting saved colors', () => {
    render(<AppearanceSection />)

    fireEvent.click(screen.getByRole('radio', { name: 'Windows 98' }))
    expect(useThemeStore.getState().dayPalette).toBe('paper')
    expect(useThemeStore.getState().nightPalette).toBe('graphite')

    fireEvent.click(screen.getByRole('button', { name: 'Use recommended colors' }))

    expect(useThemeStore.getState().theme).toBe('auto')
    expect(useThemeStore.getState().dayPalette).toBe('paper')
    expect(useThemeStore.getState().nightPalette).toBe('graphite')
    expect(useThemeStore.getState().stylePaletteMode).toBe('recommended')
    expect(screen.getByText('Currently using Day · Windows Classic')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use saved colors' }).getAttribute('aria-pressed'))
      .toBe('true')

    fireEvent.click(screen.getByRole('radio', { name: 'Default' }))
    expect(screen.getByText('Currently using Day · Paper')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Day palette: Paper' })).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'Windows 98' }))
    expect(screen.getByText('Currently using Day · Windows Classic')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use saved colors' }))
    expect(useThemeStore.getState().stylePaletteMode).toBe('saved')
    expect(screen.getByText('Currently using Day · Paper')).toBeTruthy()
  })

  it('does not expose the retired editor tab strip preference', () => {
    localStorage.setItem('openalice.editor-tabs.v1', JSON.stringify({
      state: { showEditorTabs: true },
      version: 1,
    }))

    render(<AppearanceSection />)

    expect(screen.queryByText('Show editor tabs')).toBeNull()
  })

  it('keeps the palette library collapsed until the user asks to customize it', () => {
    render(<AppearanceSection />)

    expect(screen.getByText('Currently using Day · Paper')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Day palette: Paper' }).getAttribute('aria-pressed'))
      .toBe('true')
    const disclosure = screen.getByRole('button', { name: 'Customize palettes' })
    const editor = document.getElementById(disclosure.getAttribute('aria-controls') ?? '')

    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(editor?.hidden).toBe(true)
    expect(screen.queryByRole('button', { name: 'Recommended' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset pair' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Choose Paper' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Auto' }).className).toContain('min-h-10')

    fireEvent.click(disclosure)

    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(editor?.hidden).toBe(false)
    expect(screen.getByRole('button', { name: 'Recommended' }).getAttribute('aria-pressed'))
      .toBe('true')
    expect(screen.getByRole('button', { name: 'Recommended' }).className).toContain('min-h-10')
    expect(screen.getByRole('button', { name: 'Reset pair' }).className).toContain('min-h-10')
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

    fireEvent.click(screen.getByRole('button', { name: 'Customize palettes' }))
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

  it('preserves a selected pair when the palette editor is collapsed again', () => {
    render(<AppearanceSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Customize palettes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose Linen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide palette editor' }))

    expect(useThemeStore.getState().dayPalette).toBe('linen')
    expect(screen.getByRole('button', { name: 'Edit Day palette: Linen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Customize palettes' }).getAttribute('aria-expanded'))
      .toBe('false')
    expect(screen.queryByRole('button', { name: 'Choose Linen' })).toBeNull()
  })
})
