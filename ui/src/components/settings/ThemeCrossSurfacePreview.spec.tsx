// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AppearancePreferences } from '../../api/themes'
import { demoThemeFamily } from '../../demo/fixtures/themes'
import { i18n } from '../../i18n'
import { ThemeCrossSurfacePreview } from './ThemeCrossSurfacePreview'

const baseAppearance: AppearancePreferences = {
  activeFamilyId: 'unrelated-active-family',
  mode: 'dark',
  terminal: { mode: 'follow' },
  marketColors: 'theme',
  marketDirection: 'green-up-red-down',
  statusColors: 'theme',
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('ThemeCrossSurfacePreview', () => {
  it('renders every inventory-owned surface from the candidate without changing active state', () => {
    const family = demoThemeFamily('tinted-base24', 'Candidate', ['dark'])
    const variant = family.variants.dark!
    const activeBefore = document.documentElement.getAttribute('style')

    render(<ThemeCrossSurfacePreview variant={variant} appearance={baseAppearance} />)

    const preview = screen.getByTestId('theme-cross-surface-preview')
    expect(preview.getAttribute('data-inventory-contract')).toBe('#16:193;#18:83')
    expect(preview.querySelector('[data-inventory-owner="#16"]')).not.toBeNull()
    expect(preview.querySelector('[data-inventory-owner="#18"]')).not.toBeNull()
    expect(preview.querySelector('[data-inventory-owner="#18-invariant"]')).not.toBeNull()
    expect(preview.querySelector('[data-inventory-owner="#17"]')).not.toBeNull()
    expect(screen.getByTestId('status-preview').children).toHaveLength(4)
    expect(screen.getByTestId('risk-preview').children).toHaveLength(5)
    expect(screen.getByText('▲ +1.82%')).toBeTruthy()
    expect(screen.getByText('▼ −0.74%')).toBeTruthy()
    expect(screen.getByText('＋ BUY')).toBeTruthy()
    expect(screen.getByText('− SELL')).toBeTruthy()
    expect(screen.getByTestId('ansi-preview-grid').children).toHaveLength(16)
    expect(screen.getByTestId('extended-ansi-preview-grid').children).toHaveLength(6)
    expect(document.documentElement.getAttribute('style')).toBe(activeBefore)
  })

  it('projects market convention and protected status preferences independently', () => {
    const family = demoThemeFamily('tinted-base16', 'Policy candidate', ['light'])
    const variant = family.variants.light!
    const { rerender } = render(<ThemeCrossSurfacePreview variant={variant} appearance={baseAppearance} />)
    const initialUp = screen.getByText('▲ +1.82%').getAttribute('style')
    const initialSuccess = screen.getByText('Success').getAttribute('style')

    rerender(<ThemeCrossSurfacePreview variant={variant} appearance={{
      ...baseAppearance,
      marketColors: 'protected',
      marketDirection: 'red-up-green-down',
      statusColors: 'protected',
    }} />)

    expect(screen.getByText('▲ +1.82%').getAttribute('style')).not.toBe(initialUp)
    expect(screen.getByText('Success').getAttribute('style')).not.toBe(initialSuccess)
    expect(screen.getByText('Destructive action').getAttribute('style')).toContain('rgb(179, 38, 30)')
  })
})
